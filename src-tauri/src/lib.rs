mod secrets;
mod startup;
mod storage;
mod update;
#[cfg(windows)]
mod webview_menu;

use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, Position, RunEvent, Size, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    window::Color,
};

const TRAY_ID: &str = "main";
const SETTINGS_LABEL: &str = "settings";

struct AppState {
    data: storage::DataDir,
    /// Commands run on a thread pool; two saves must not share the temp file at once.
    save_lock: Mutex<()>,
    /// Closing the window hides it in the tray (chats stay connected) instead of quitting.
    close_to_tray: AtomicBool,
    /// Last non-maximized outer bounds (so maximize doesn't overwrite them).
    normal_geom: Mutex<Option<storage::WindowGeom>>,
    /// Debounce window-layout writes while the user drags/resizes.
    geom_save_after: Mutex<Option<Instant>>,
    /// Set once the webview has flushed history, so ExitRequested can finish.
    allow_exit: AtomicBool,
    /// One shutdown flush and one 2s watchdog, even if close and exit both fire.
    exit_flush_started: AtomicBool,
}

fn show_main_window(app: &AppHandle) {
    // Settings disables the main window. Focusing main anyway paints a window that ignores clicks.
    if let Some(settings) = app.get_webview_window(SETTINGS_LABEL) {
        let _ = settings.unminimize();
        let _ = settings.show();
        let _ = settings.set_focus();
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    data_dir: String,
    portable: bool,
    token_store: &'static str,
    platform: &'static str,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle, state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: storage::display_path(&state.data.path),
        portable: state.data.portable,
        token_store: secrets::store_name(),
        platform: std::env::consts::OS,
    }
}

#[tauri::command]
fn settings_load(state: State<'_, AppState>) -> Result<Option<serde_json::Value>, storage::SettingsLoadError> {
    // A load can move the file aside, so it must never overlap a save.
    let _guard = state.save_lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    storage::load_settings(&state.data)
}

#[tauri::command]
fn settings_save(state: State<'_, AppState>, settings: serde_json::Value) -> Result<(), String> {
    let _guard = state.save_lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    storage::save_settings(&state.data, &settings)
}

#[tauri::command]
fn chat_history_load(state: State<'_, AppState>, channel: String) -> Result<Option<serde_json::Value>, String> {
    storage::load_chat_history(&state.data, &channel)
}

#[tauri::command]
fn chat_history_save(
    state: State<'_, AppState>,
    channel: String,
    messages: serde_json::Value,
) -> Result<(), String> {
    let _guard = state.save_lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    storage::save_chat_history(&state.data, &channel, &messages)
}

#[tauri::command]
fn chat_history_append(
    state: State<'_, AppState>,
    channel: String,
    messages: serde_json::Value,
) -> Result<u64, String> {
    let _guard = state.save_lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    storage::append_chat_history(&state.data, &channel, &messages)
}

#[tauri::command]
fn chat_history_clear(state: State<'_, AppState>, channel: Option<String>) -> Result<(), String> {
    let _guard = state.save_lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    storage::clear_chat_history(&state.data, channel.as_deref())
}

#[tauri::command]
fn session_load() -> Result<Option<String>, String> {
    secrets::load()
}

#[tauri::command]
fn session_save(payload: String) -> Result<(), String> {
    secrets::save(&payload)
}

#[tauri::command]
fn session_clear() -> Result<(), String> {
    secrets::clear()
}

/// Main window only: the history server's read token. Settings can save it but never read it back.
#[tauri::command]
fn history_token_load() -> Result<Option<String>, String> {
    secrets::load_history_token()
}

/// An empty token forgets the saved one.
#[tauri::command]
fn history_token_save(token: String) -> Result<(), String> {
    secrets::save_history_token(&token)
}

/// Whether a read token is saved, without handing it to the page.
#[tauri::command]
fn history_token_saved() -> Result<bool, String> {
    secrets::load_history_token().map(|token| token.is_some())
}

/// Login name only — for the Settings popout. Never returns tokens.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthDisplay {
    login: String,
    user_id: String,
    remembered: bool,
}

#[tauri::command]
fn auth_display() -> Result<Option<AuthDisplay>, String> {
    let Some(raw) = secrets::load()? else {
        return Ok(None);
    };
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|err| format!("Couldn't read saved login: {err}"))?;
    let login = value
        .get("login")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let user_id = value
        .get("userId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if login.is_empty() {
        return Ok(None);
    }
    Ok(Some(AuthDisplay {
        login,
        user_id,
        remembered: true,
    }))
}

#[tauri::command]
fn set_close_to_tray(state: State<'_, AppState>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn set_tray_status(app: AppHandle, mentions: u32) {
    let tooltip = match mentions {
        0 => "ZooChattr".to_string(),
        1 => "ZooChattr · 1 mention".to_string(),
        n => format!("ZooChattr · {n} mentions"),
    };
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    // Tear down Settings first so a dead/disabled popout can't keep the process alive.
    force_close_settings(&app);
    app.exit(0);
}

#[tauri::command]
fn finish_exit(app: AppHandle, state: State<'_, AppState>) {
    state.allow_exit.store(true, Ordering::Relaxed);
    app.exit(0);
}

fn request_history_flush(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    if state.allow_exit.load(Ordering::Relaxed) {
        return false;
    }
    if state.exit_flush_started.swap(true, Ordering::Relaxed) {
        return true;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("flush-history", ());
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(2));
        let state = app.state::<AppState>();
        state.allow_exit.store(true, Ordering::Relaxed);
        app.exit(0);
    });
    true
}

#[tauri::command]
fn get_launch_at_login() -> Result<bool, String> {
    startup::get_launch_at_login()
}

#[tauri::command]
fn set_launch_at_login(enabled: bool) -> Result<(), String> {
    startup::set_launch_at_login(enabled)
}

#[tauri::command]
fn check_for_update() -> Result<Option<update::UpdateInfo>, String> {
    update::check_for_update()
}

/// Downloads the portable zip, swaps only the exe (ZooChattr-data stays), then restarts.
/// Only a ZooChattr-portable zip from this repo's GitHub releases whose SHA-256 matches its published fingerprint.
#[tauri::command]
fn apply_update(app: AppHandle, download_url: String) -> Result<(), String> {
    if update::trusted_release_zip(&download_url).is_none() {
        return Err(update::SAFETY_CHECK_FAILED.to_string());
    }
    update::apply_update(&download_url)?;
    // Helper script waits for this process to exit, then launches the new exe.
    app.exit(0);
    Ok(())
}

fn request_quit_confirm(app: &AppHandle) {
    // Settings disables main; a dead white Settings webview would swallow Quit forever.
    force_close_settings(app);
    show_main_window(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_enabled(true);
        let _ = window.emit("quit-requested", ());
    }
}

fn release_main_after_settings(app: &AppHandle) {
    // Skip while a Settings window still exists (destroy-and-recreate race).
    if app.get_webview_window(SETTINGS_LABEL).is_some() {
        return;
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_enabled(true);
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

/// Destroy Settings (even if its webview is dead) and re-enable main when it's gone.
fn force_close_settings(app: &AppHandle) {
    if let Some(settings) = app.get_webview_window(SETTINGS_LABEL) {
        let _ = settings.destroy();
    }
    release_main_after_settings(app);
}

/// Opens Settings as its own window and disables the main window until it closes.
/// Always creates a fresh webview — re-showing a stuck overnight page stays blank.
fn open_settings_window(app: &AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(SETTINGS_LABEL) {
        // Don't release main here — a replacement window is about to take over.
        let _ = existing.destroy();
    }

    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window isn't open.".to_string())?;

    let state = app.state::<AppState>();
    // Plain index.html + hash: query strings have blanked WebView2 asset loads on Windows.
    // The UI also detects the `settings` window label.
    let mut builder = WebviewWindowBuilder::new(
        app,
        SETTINGS_LABEL,
        WebviewUrl::App("index.html#settings".into()),
    )
        .title("ZooChattr Settings")
        .inner_size(520.0, 740.0)
        .min_inner_size(400.0, 480.0)
        .resizable(true)
        .maximizable(false)
        // No forced theme: Tauri passes Windows' light/dark to the page, which the Auto theme follows.
        .theme(None)
        .background_color(Color(0x09, 0x0d, 0x0a, 0xff))
        .center();
    if state.data.portable {
        builder = builder.data_directory(state.data.path.join("webview-settings"));
    }
    // No .parent(): owned child webviews have shown up blank/frozen on Windows.

    let _ = main.set_enabled(false);
    let settings = match builder.build() {
        Ok(window) => window,
        Err(err) => {
            let _ = main.set_enabled(true);
            return Err(format!("Couldn't open Settings: {err}"));
        }
    };
    #[cfg(windows)]
    webview_menu::tame_webview_menu(&settings);

    let app_handle = app.clone();
    settings.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::Destroyed | WindowEvent::CloseRequested { .. }
        ) {
            release_main_after_settings(&app_handle);
        }
    });

    Ok(())
}

/// Tray "Settings…": Settings is a panel inside the main window now, so bring the main window back
/// (it may be hidden in the tray) and ask it to open the panel.
fn request_settings_panel(app: &AppHandle) {
    show_main_window(app);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("open-settings", ());
    }
}

/// Tray "Check for updates…" — toast-only path on the main webview. Does not open
/// Settings, show/focus/disable the main window, or start a download.
fn request_update_check(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("tray-update-check", ());
    }
}

/// Async so Windows doesn't deadlock creating a WebviewWindow from a sync command.
#[tauri::command]
async fn open_settings_window_cmd(app: AppHandle) -> Result<(), String> {
    open_settings_window(&app)
}

fn apply_saved_geom(window: &WebviewWindow, geom: &storage::WindowGeom) {
    if geom.maximized {
        let _ = window.set_position(Position::Physical(tauri::PhysicalPosition { x: geom.x, y: geom.y }));
        let _ = window.set_size(Size::Physical(tauri::PhysicalSize {
            width: geom.width.max(360),
            height: geom.height.max(420),
        }));
        let _ = window.maximize();
    } else {
        let _ = window.set_size(Size::Physical(tauri::PhysicalSize {
            width: geom.width.max(360),
            height: geom.height.max(420),
        }));
        let _ = window.set_position(Position::Physical(tauri::PhysicalPosition { x: geom.x, y: geom.y }));
    }
}

fn capture_window_geom(window: &WebviewWindow, state: &AppState) -> Option<storage::WindowGeom> {
    let maximized = window.is_maximized().ok()?;
    if maximized {
        let mut normal = state.normal_geom.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(prev) = normal.as_mut() {
            prev.maximized = true;
            return Some(prev.clone());
        }
        let pos = window.outer_position().ok()?;
        let size = window.outer_size().ok()?;
        return Some(storage::WindowGeom {
            x: pos.x,
            y: pos.y,
            width: size.width,
            height: size.height,
            maximized: true,
        });
    }
    let pos = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    let geom = storage::WindowGeom {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        maximized: false,
    };
    *state.normal_geom.lock().unwrap_or_else(|p| p.into_inner()) = Some(geom.clone());
    Some(geom)
}

fn persist_window_geom(window: &WebviewWindow, state: &AppState) {
    let Some(geom) = capture_window_geom(window, state) else {
        return;
    };
    let _guard = state.save_lock.lock().unwrap_or_else(|p| p.into_inner());
    let _ = storage::save_window_geom(&state.data, &geom);
}

fn schedule_window_geom_save(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    {
        let state = app.state::<AppState>();
        *state.geom_save_after.lock().unwrap_or_else(|p| p.into_inner()) =
            Some(Instant::now() + Duration::from_millis(400));
    }
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(450));
        let state = app.state::<AppState>();
        let due = {
            let guard = state.geom_save_after.lock().unwrap_or_else(|p| p.into_inner());
            match *guard {
                Some(at) if Instant::now() >= at => true,
                _ => false,
            }
        };
        if !due {
            return;
        }
        if let Some(window) = app.get_webview_window(&label) {
            persist_window_geom(&window, &state);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    // A second launch just brings the running copy (maybe hidden in the tray) forward. This plugin must
    // be registered first. On Linux it needs a `unix:` session D-Bus address and panics on anything else.
    let single_instance = cfg!(not(target_os = "linux"))
        || std::env::var("DBUS_SESSION_BUS_ADDRESS").is_ok_and(|address| address.starts_with("unix:"));
    if single_instance {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app)));
    }
    builder
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            update::forget_old_exe_later();
            let data = storage::resolve_data_dir(app.handle());
            let saved_geom = storage::load_window_geom(&data);
            let webview_dir = data.portable.then(|| data.path.join("webview"));
            app.manage(AppState {
                data,
                save_lock: Mutex::new(()),
                close_to_tray: AtomicBool::new(true),
                normal_geom: Mutex::new(saved_geom.clone().map(|mut g| {
                    g.maximized = false;
                    g
                })),
                geom_save_after: Mutex::new(None),
                allow_exit: AtomicBool::new(false),
                exit_flush_started: AtomicBool::new(false),
            });

            let window_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .cloned()
                .ok_or("tauri.conf.json is missing the main window")?;
            let mut builder = WebviewWindowBuilder::from_config(app.handle(), &window_config)?;
            if let Some(dir) = webview_dir {
                // Keeps the webview cache inside the portable folder instead of %LOCALAPPDATA%.
                builder = builder.data_directory(dir);
            }
            let window = builder.build()?;
            #[cfg(windows)]
            webview_menu::tame_webview_menu(&window);
            if let Some(geom) = &saved_geom {
                apply_saved_geom(&window, geom);
            }

            let show = MenuItem::with_id(app, "show", "Show ZooChattr", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let update = MenuItem::with_id(app, "update", "Check for updates…", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit ZooChattr", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &settings, &update, &sep, &quit])?;
            let mut tray = TrayIconBuilder::with_id(TRAY_ID)
                .tooltip("ZooChattr")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "settings" => request_settings_panel(app),
                    "update" => request_update_check(app),
                    "quit" => request_quit_confirm(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == SETTINGS_LABEL {
                if matches!(event, WindowEvent::Destroyed) {
                    release_main_after_settings(window.app_handle());
                }
                return;
            }
            if window.label() != "main" {
                return;
            }
            let Some(webview) = window.app_handle().get_webview_window(window.label()) else {
                return;
            };
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    let state = window.app_handle().state::<AppState>();
                    persist_window_geom(&webview, &state);
                    if state.close_to_tray.load(Ordering::Relaxed) {
                        api.prevent_close();
                        let _ = webview.hide();
                    } else {
                        api.prevent_close();
                        request_history_flush(window.app_handle());
                    }
                }
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                    schedule_window_geom_save(&webview);
                }
                WindowEvent::Destroyed => {
                    let state = window.app_handle().state::<AppState>();
                    persist_window_geom(&webview, &state);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            settings_load,
            settings_save,
            chat_history_load,
            chat_history_save,
            chat_history_append,
            chat_history_clear,
            session_load,
            session_save,
            session_clear,
            history_token_load,
            history_token_save,
            history_token_saved,
            auth_display,
            set_close_to_tray,
            set_tray_status,
            quit_app,
            finish_exit,
            get_launch_at_login,
            set_launch_at_login,
            check_for_update,
            apply_update,
            open_settings_window_cmd
        ])
        .build(tauri::generate_context!())
        .expect("error while running ZooChattr")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                let state = app.state::<AppState>();
                if state.allow_exit.load(Ordering::Relaxed) {
                    return;
                }
                api.prevent_exit();
                request_history_flush(app);
            }
        });
}

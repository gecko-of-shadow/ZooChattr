//! Portable updates from GitHub Releases.
//! Downloads the zip, replaces only ZooChattr.exe next to this process, and keeps ZooChattr-data.
//!
//! Safety check before anything is installed: the link must be a ZooChattr-portable zip in this repo's
//! GitHub releases, and the zip's SHA-256 must match the `<zip>.sha256` file published next to it
//! (written by .github/workflows/release.yml). Otherwise nothing is changed.

use std::{
    fs,
    io::{self, Cursor, Read},
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use sha2::{Digest, Sha256};

const REPO: &str = "gecko-of-shadow/ZooChattr";
const USER_AGENT: &str = "ZooChattr";
/// Shown (and matched by the app) when the link or the fingerprint check fails.
pub const SAFETY_CHECK_FAILED: &str = "This update didn't pass its safety check. Nothing was changed.";
/// One try a second. Closing can take a while when many chats are saved, so this is generous.
#[cfg(windows)]
const HELPER_EXIT_TRIES: u32 = 120;
/// One try a second. A virus scanner usually lets go of a fresh exe within a few seconds.
#[cfg(windows)]
const HELPER_PLACE_TRIES: u32 = 10;

/// The release file name if `url` is `https://github.com/gecko-of-shadow/ZooChattr/releases/download/<tag>/ZooChattr-portable-<version>.zip`.
/// Anything else (another host or repo, a query, `..`, odd characters) is refused.
pub fn trusted_release_zip(url: &str) -> Option<&str> {
    let prefix = format!("https://github.com/{REPO}/releases/download/");
    let rest = url.strip_prefix(prefix.as_str())?;
    let (tag, name) = rest.split_once('/')?;
    let safe = |part: &str| {
        !part.is_empty()
            && part != "."
            && part != ".."
            && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+'))
    };
    if !safe(tag) || !safe(name) {
        return None;
    }
    release_zip_version(name)?;
    Some(name)
}

/// The `<version>` of `ZooChattr-portable-<version>.zip` (prefix and suffix stripped once).
fn release_zip_version(name: &str) -> Option<&str> {
    let version = name.strip_prefix("ZooChattr-portable-")?.strip_suffix(".zip")?;
    (!version.is_empty()).then_some(version)
}

/// Lower-case hex SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Reads a `sha256sum`-style line ("<64 hex>  <file name>", or just the hex). When a name is given it must be `zip_name`.
pub fn parse_fingerprint(text: &str, zip_name: &str) -> Option<String> {
    let mut parts = text.trim().split_whitespace();
    let hex = parts.next()?.to_ascii_lowercase();
    if hex.len() != 64 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    match parts.next() {
        None => Some(hex),
        Some(name) if name.trim_start_matches('*') == zip_name && parts.next().is_none() => Some(hex),
        Some(_) => None,
    }
}

fn version_parts(version: &str) -> Vec<u64> {
    version
        .trim_start_matches(['v', 'V'])
        .split(['.', '-', '+'])
        // Like parseVersion in src/lib/updates.ts: non-numeric parts are skipped, not a stop.
        .filter_map(|part| part.parse().ok())
        .collect()
}

/// True when `candidate` is a higher version than `current` (same rule as isNewerVersion in src/lib/updates.ts).
pub fn is_newer_version(candidate: &str, current: &str) -> bool {
    let (a, b) = (version_parts(candidate), version_parts(current));
    for i in 0..a.len().max(b.len()) {
        let (left, right) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if left != right {
            return left > right;
        }
    }
    false
}

/// The fingerprint file, at most 4 KB. Not there (404 / 403): the safety message. A connection problem, rate limit
/// or GitHub error: "Couldn't reach GitHub", so a hiccup isn't mistaken for a bad release.
fn fetch_fingerprint(url: &str) -> Result<String, String> {
    let response = match ureq::get(url).set("User-Agent", USER_AGENT).timeout(Duration::from_secs(30)).call() {
        Ok(response) => response,
        Err(ureq::Error::Status(404 | 403, _)) => return Err(SAFETY_CHECK_FAILED.to_string()),
        Err(ureq::Error::Status(code, _)) => return Err(format!("Couldn't reach GitHub (status {code}). Try again in a minute.")),
        Err(err) => return Err(format!("Couldn't reach GitHub: {err}")),
    };
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(4096)
        .read_to_end(&mut bytes)
        .map_err(|err| format!("Couldn't reach GitHub: {err}"))?;
    String::from_utf8(bytes).map_err(|_| SAFETY_CHECK_FAILED.to_string())
}

/// Downloads the zip and its fingerprint file; returns the zip only when they match and it is newer than this build.
fn download_checked_zip(download_url: &str) -> Result<Vec<u8>, String> {
    let zip_name = trusted_release_zip(download_url).ok_or_else(|| SAFETY_CHECK_FAILED.to_string())?;
    // Never "update" to the same or an older release.
    let version = release_zip_version(zip_name).ok_or_else(|| SAFETY_CHECK_FAILED.to_string())?;
    if !is_newer_version(version, env!("CARGO_PKG_VERSION")) {
        return Err(SAFETY_CHECK_FAILED.to_string());
    }
    let zip_bytes = http_get(download_url)?;
    let text = fetch_fingerprint(&format!("{download_url}.sha256"))?;
    let expected = parse_fingerprint(&text, zip_name).ok_or_else(|| SAFETY_CHECK_FAILED.to_string())?;
    if sha256_hex(&zip_bytes) != expected {
        return Err(SAFETY_CHECK_FAILED.to_string());
    }
    Ok(zip_bytes)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub tag: String,
    pub version: String,
    pub download_url: String,
    pub notes: String,
    pub published_at: String,
}

fn http_get(url: &str) -> Result<Vec<u8>, String> {
    let response = ureq::get(url)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|err| format!("Couldn't reach GitHub: {err}"))?;
    let mut bytes = Vec::new();
    response
        .into_reader()
        .read_to_end(&mut bytes)
        .map_err(|err| format!("Couldn't read the response: {err}"))?;
    Ok(bytes)
}

pub fn check_for_update() -> Result<Option<UpdateInfo>, String> {
    let bytes = http_get(&format!("https://api.github.com/repos/{REPO}/releases/latest"))?;
    let body: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|err| format!("GitHub's reply wasn't JSON: {err}"))?;
    let tag = body
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if tag.is_empty() {
        return Ok(None);
    }
    let assets = body.get("assets").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let download_url = assets
        .iter()
        .find_map(|asset| {
            let name = asset.get("name")?.as_str()?;
            if name.starts_with("ZooChattr-portable-") && name.ends_with(".zip") {
                asset.get("browser_download_url")?.as_str().map(str::to_string)
            } else {
                None
            }
        })
        .ok_or_else(|| "That release has no ZooChattr-portable zip.".to_string())?;
    Ok(Some(UpdateInfo {
        version: tag.trim_start_matches('v').to_string(),
        tag,
        download_url,
        notes: body.get("body").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
        published_at: body
            .get("published_at")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    }))
}

/// The update helper leaves the old exe beside the new one as a way back. Running this long proves the new one works.
const OLD_EXE_KEPT_FOR: Duration = Duration::from_secs(30);

fn remove_old_exe(exe: &Path) {
    let _ = fs::remove_file(exe.with_extension("exe.bak"));
}

/// Called at every start. A build that dies before this runs out keeps the old exe beside it.
pub fn forget_old_exe_later() {
    let Ok(exe) = std::env::current_exe() else { return };
    std::thread::spawn(move || {
        std::thread::sleep(OLD_EXE_KEPT_FOR);
        remove_old_exe(&exe);
    });
}

fn exe_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|err| format!("Couldn't find this program: {err}"))?;
    exe.parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Couldn't find this program's folder.".to_string())
}

fn find_exe_in_zip(archive: &mut zip::ZipArchive<Cursor<Vec<u8>>>) -> Result<usize, String> {
    for i in 0..archive.len() {
        let name = archive
            .by_index(i)
            .map_err(|err| err.to_string())?
            .name()
            .replace('\\', "/")
            .to_lowercase();
        if name.ends_with("zoochattr.exe") && !name.contains("data/") {
            return Ok(i);
        }
    }
    Err("The zip didn't contain ZooChattr.exe.".to_string())
}

/// Downloads the portable zip and schedules a swap of the running exe, keeping ZooChattr-data.
/// Returns after spawning the helper; the process should then exit.
pub fn apply_update(download_url: &str) -> Result<(), String> {
    let dir = exe_dir()?;
    let exe_name = if cfg!(windows) { "ZooChattr.exe" } else { "ZooChattr" };
    let current = dir.join(exe_name);
    if !current.exists() {
        // Dev / Linux builds may be named differently.
        let fallback = std::env::current_exe().map_err(|err| err.to_string())?;
        return apply_update_to(&fallback, download_url);
    }
    apply_update_to(&current, download_url)
}

/// Cmd expands `%VAR%` inside double quotes. In a batch file, `%%` is one `%`.
#[cfg(windows)]
fn batch_escape(path: &Path) -> String {
    path.display().to_string().replace('%', "%%")
}

/// Single-quote a path for `sh`. An embedded `'` becomes `'\''`.
fn shell_single_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "'\\''"))
}

fn apply_update_to(current_exe: &Path, download_url: &str) -> Result<(), String> {
    let dir = current_exe
        .parent()
        .ok_or_else(|| "Couldn't find this program's folder.".to_string())?;
    // Checked before any file is written: a refused update leaves everything as it was.
    let zip_bytes = download_checked_zip(download_url)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    let staging = std::env::temp_dir().join(format!("zoochattr-update-{stamp}"));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|err| format!("Couldn't make a temp folder: {err}"))?;

    let mut archive = zip::ZipArchive::new(Cursor::new(zip_bytes)).map_err(|err| format!("Couldn't open the zip: {err}"))?;
    let index = find_exe_in_zip(&mut archive)?;
    let mut file = archive.by_index(index).map_err(|err| err.to_string())?;
    let new_exe = staging.join("ZooChattr.exe.new");
    {
        let mut out = fs::File::create(&new_exe).map_err(|err| format!("Couldn't write the new exe: {err}"))?;
        io::copy(&mut file, &mut out).map_err(|err| format!("Couldn't extract the new exe: {err}"))?;
    }

    let dest_new = dir.join(format!("{}.new", current_exe.file_name().unwrap().to_string_lossy()));
    fs::copy(&new_exe, &dest_new).map_err(|err| format!("Couldn't place the new exe: {err}"))?;

    if cfg!(windows) {
        write_and_spawn_windows_helper(current_exe, &dest_new)?;
    } else {
        // The script must not live in `staging`: that folder is deleted as soon as `sh` starts.
        let helper = std::env::temp_dir().join(format!("zoochattr-apply-{stamp}.sh"));
        let script = format!(
            "#!/bin/sh\nsleep 1\nmv -f {new} {current}\nchmod +x {current}\nexec {current} &\nrm -f {helper}\n",
            new = shell_single_quote(&dest_new.display().to_string()),
            current = shell_single_quote(&current_exe.display().to_string()),
            helper = shell_single_quote(&helper.display().to_string()),
        );
        fs::write(&helper, script).map_err(|err| err.to_string())?;
        Command::new("sh")
            .arg(&helper)
            .spawn()
            .map_err(|err| format!("Couldn't start the update helper: {err}"))?;
    }
    let _ = fs::remove_dir_all(&staging);
    Ok(())
}

#[cfg(windows)]
fn windows_helper_script(current_exe: &Path, new_exe: &Path, exit_tries: u32, place_tries: u32) -> String {
    let bak = current_exe.with_extension("exe.bak");
    // Wait for this process to exit, swap the exe, restart, clean up. ZooChattr-data is never touched.
    // - The backup is a copy, and `move /y` replaces the exe in one step, so ZooChattr.exe is never missing, even if
    //   this script is killed partway. If the move can't happen, the old exe simply stays where it is.
    // - This script never deletes a good backup. The new app does that itself once it has run for a while, because
    //   only that proves it works (see forget_old_exe_later). A build that fails to start or dies at once is
    //   swapped back here. Rollback copies through a temp name, because a failed `copy` deletes its destination.
    // - "Is it running" is an open for append, which fails while an exe runs. Renaming wouldn't tell: a running exe
    //   CAN be renamed. The `if not exist` comes first because `>>` would create a missing file.
    // - `start` stops on a Windows error box for a file that isn't there, hence the checks before it.
    // - Started with `start`, cmd runs this with /K and would stay open, hence the `exit`. It shares a line with
    //   the `del` because cmd can't read another line from a file it has just deleted.
    // Cmd expands %VAR% even inside quotes. A folder named "100%" would miss the real exe.
    format!(
        "@echo off\r\n\
         setlocal\r\n\
         set \"timeout=%SystemRoot%\\System32\\timeout.exe\"\r\n\
         set tries=0\r\n\
         :wait\r\n\
         \"%timeout%\" /t 1 /nobreak >nul\r\n\
         if not exist \"{current}\" goto swap\r\n\
         2>nul (>>\"{current}\" (call )) && goto swap\r\n\
         set /a tries+=1\r\n\
         if %tries% lss {exit_tries} goto wait\r\n\
         goto restart\r\n\
         :swap\r\n\
         if not exist \"{new}\" goto restart\r\n\
         if not exist \"{current}\" goto place\r\n\
         del /f /q \"{bak}\" 2>nul\r\n\
         copy /b /y \"{current}\" \"{bak}\" >nul 2>nul\r\n\
         if errorlevel 1 goto keep_old\r\n\
         :place\r\n\
         set tries=0\r\n\
         :place_again\r\n\
         move /y \"{new}\" \"{current}\" >nul 2>nul\r\n\
         if not errorlevel 1 goto placed\r\n\
         set /a tries+=1\r\n\
         if %tries% geq {place_tries} goto keep_old\r\n\
         \"%timeout%\" /t 1 /nobreak >nul\r\n\
         goto place_again\r\n\
         :placed\r\n\
         if not exist \"{current}\" goto rollback\r\n\
         start \"\" \"{current}\"\r\n\
         if errorlevel 1 goto rollback\r\n\
         \"%timeout%\" /t 3 /nobreak >nul\r\n\
         if not exist \"{current}\" goto rollback\r\n\
         2>nul (>>\"{current}\" (call )) && goto rollback\r\n\
         goto finish\r\n\
         :rollback\r\n\
         set tries=0\r\n\
         :rollback_again\r\n\
         if not exist \"{bak}\" goto restart\r\n\
         move /y \"{bak}\" \"{current}\" >nul 2>nul\r\n\
         if not errorlevel 1 goto restart\r\n\
         set /a tries+=1\r\n\
         if %tries% geq {place_tries} goto rollback_copy\r\n\
         \"%timeout%\" /t 1 /nobreak >nul\r\n\
         goto rollback_again\r\n\
         :rollback_copy\r\n\
         copy /b /y \"{bak}\" \"{bak}.tmp\" >nul 2>nul\r\n\
         if errorlevel 1 goto restart\r\n\
         move /y \"{bak}.tmp\" \"{current}\" >nul 2>nul\r\n\
         if errorlevel 1 del /f /q \"{bak}.tmp\" 2>nul\r\n\
         goto restart\r\n\
         :keep_old\r\n\
         del /f /q \"{bak}\" 2>nul\r\n\
         :restart\r\n\
         if not exist \"{current}\" goto finish\r\n\
         del /f /q \"{new}\" 2>nul\r\n\
         start \"\" \"{current}\"\r\n\
         :finish\r\n\
         del /f /q \"%~f0\" & exit\r\n",
        current = batch_escape(current_exe),
        bak = batch_escape(&bak),
        new = batch_escape(new_exe),
    )
}

#[cfg(windows)]
fn write_and_spawn_windows_helper(current_exe: &Path, new_exe: &Path) -> Result<(), String> {
    let script = windows_helper_script(current_exe, new_exe, HELPER_EXIT_TRIES, HELPER_PLACE_TRIES);
    start_windows_helper(current_exe, &script)
}

#[cfg(windows)]
fn start_windows_helper(current_exe: &Path, script: &str) -> Result<(), String> {
    use std::io::Write;
    let dir = current_exe.parent().unwrap();
    let helper = dir.join("zoochattr-update.cmd");
    {
        let mut file = fs::File::create(&helper).map_err(|err| format!("Couldn't write the update helper: {err}"))?;
        file.write_all(script.as_bytes())
            .map_err(|err| format!("Couldn't write the update helper: {err}"))?;
    }
    Command::new("cmd")
        .args(["/C", "start", "", "/MIN", &helper.to_string_lossy()])
        .spawn()
        .map_err(|err| format!("Couldn't start the update helper: {err}"))?;
    Ok(())
}

#[cfg(not(windows))]
fn write_and_spawn_windows_helper(_current_exe: &Path, _new_exe: &Path) -> Result<(), String> {
    Err("Windows-only helper".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = "https://github.com/gecko-of-shadow/ZooChattr/releases/download/v0.6.0/ZooChattr-portable-0.6.0.zip";

    #[test]
    fn accepts_only_this_repos_portable_zip() {
        assert_eq!(trusted_release_zip(GOOD), Some("ZooChattr-portable-0.6.0.zip"));
        for bad in [
            "http://github.com/gecko-of-shadow/ZooChattr/releases/download/v0.6.0/ZooChattr-portable-0.6.0.zip",
            "https://github.com/someone-else/ZooChattr/releases/download/v0.6.0/ZooChattr-portable-0.6.0.zip",
            "https://github.com.example.test/gecko-of-shadow/ZooChattr/releases/download/v0.6.0/ZooChattr-portable-0.6.0.zip",
            "https://example.test/https://github.com/gecko-of-shadow/ZooChattr/releases/download/v1/ZooChattr-portable-1.zip",
            "https://github.com/gecko-of-shadow/ZooChattr/releases/download/v0.6.0/ZooChattr-portable-0.6.0.zip?x=1",
            "https://github.com/gecko-of-shadow/ZooChattr/releases/download/v0.6.0/ZooChattr-portable-0.6.0.zip#a",
            "https://github.com/gecko-of-shadow/ZooChattr/releases/download/../ZooChattr-portable-0.6.0.zip",
            "https://github.com/gecko-of-shadow/ZooChattr/releases/download/v0.6.0/sub/ZooChattr-portable-0.6.0.zip",
            "https://github.com/gecko-of-shadow/ZooChattr/releases/download/v0.6.0/ZooChattr-portable-.zip",
            "https://github.com/gecko-of-shadow/ZooChattr/releases/download/v0.6.0/Other-0.6.0.zip",
            "https://github.com/gecko-of-shadow/ZooChattr/releases/download/v0.6.0/ZooChattr-portable-0.6.0.exe",
            "https://user@github.com/gecko-of-shadow/ZooChattr/releases/download/v0.6.0/ZooChattr-portable-0.6.0.zip",
            "",
        ] {
            assert_eq!(trusted_release_zip(bad), None, "{bad}");
        }
    }

    #[test]
    fn only_newer_versions_count() {
        assert!(is_newer_version("0.6.0", "0.5.0"));
        assert!(is_newer_version("v1.0", "0.9.9"));
        assert!(is_newer_version("0.5.1", "0.5.0"));
        assert!(!is_newer_version("0.5.0", "0.5.0"));
        assert!(!is_newer_version("0.4.9", "0.5.0"));
        assert!(!is_newer_version("..", "0.5.0"));
        // Same answer as isNewerVersion in src/lib/updates.test.ts.
        assert!(is_newer_version("0.6.0-beta.2", "0.6.0"));
    }

    #[test]
    fn version_comes_from_the_checked_name() {
        assert_eq!(release_zip_version("ZooChattr-portable-0.6.0.zip"), Some("0.6.0"));
        assert_eq!(release_zip_version("ZooChattr-portable-ZooChattr-portable-9.zip"), Some("ZooChattr-portable-9"));
        assert_eq!(release_zip_version("ZooChattr-portable-1.zip.zip"), Some("1.zip"));
        let doubled = "https://github.com/gecko-of-shadow/ZooChattr/releases/download/v9/ZooChattr-portable-ZooChattr-portable-0.zip";
        assert_eq!(download_checked_zip(doubled), Err(SAFETY_CHECK_FAILED.to_string()));
    }

    #[test]
    fn refuses_a_release_that_isnt_newer() {
        let older = "https://github.com/gecko-of-shadow/ZooChattr/releases/download/v0.0.1/ZooChattr-portable-0.0.1.zip";
        assert_eq!(download_checked_zip(older), Err(SAFETY_CHECK_FAILED.to_string()));
    }

    #[test]
    fn sha256_matches_known_values() {
        // FIPS 180-2 test vectors.
        assert_eq!(sha256_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn reads_fingerprint_files() {
        let hex = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        let name = "ZooChattr-portable-0.6.0.zip";
        assert_eq!(parse_fingerprint(&format!("{hex}  {name}\n"), name).as_deref(), Some(hex));
        assert_eq!(parse_fingerprint(&format!("{hex} *{name}"), name).as_deref(), Some(hex));
        assert_eq!(parse_fingerprint(&hex.to_uppercase(), name).as_deref(), Some(hex));
        assert_eq!(parse_fingerprint(&format!("{hex}  ZooChattr-portable-0.5.0.zip"), name), None);
        assert_eq!(parse_fingerprint(&hex[..63], name), None);
        assert_eq!(parse_fingerprint("not a hash", name), None);
        assert_eq!(parse_fingerprint("", name), None);
        assert_eq!(parse_fingerprint(&format!("{hex}  {name} extra"), name), None);
    }

    /// Dry run against files written by the release workflow's fingerprint step:
    /// `$env:ZOO_DRYRUN_ZIP = "...\ZooChattr-portable-x.zip"; cargo test -- --ignored`
    #[test]
    #[ignore]
    fn matches_a_release_fingerprint_file() {
        let zip = std::env::var("ZOO_DRYRUN_ZIP").expect("set ZOO_DRYRUN_ZIP to a zip with a .sha256 next to it");
        let name = Path::new(&zip).file_name().unwrap().to_string_lossy().to_string();
        let bytes = fs::read(&zip).unwrap();
        let text = fs::read_to_string(format!("{zip}.sha256")).unwrap();
        assert_eq!(parse_fingerprint(&text, &name), Some(sha256_hex(&bytes)));
        let mut tampered = bytes.clone();
        tampered.push(0);
        assert_ne!(parse_fingerprint(&text, &name), Some(sha256_hex(&tampered)));
    }

    #[test]
    fn refuses_untrusted_links_before_downloading() {
        assert_eq!(
            download_checked_zip("https://example.test/ZooChattr-portable-0.6.0.zip"),
            Err(SAFETY_CHECK_FAILED.to_string())
        );
    }
}

/// Runs the real helper text on fake exes in temp folders, started the same way the app starts it.
/// The fakes are copies of Windows tools with a name only this test uses, so cleanup can't reach anything else.
#[cfg(all(test, windows))]
mod swap_tests {
    use super::*;
    use std::os::windows::fs::OpenOptionsExt;
    use std::process::{Child, Stdio};
    use std::thread::sleep;
    use std::time::Instant;

    const SYSTEM: &str = r"C:\Windows\System32";

    struct Rig {
        dir: PathBuf,
        current: PathBuf,
        new: PathBuf,
        bak: PathBuf,
        helper: PathBuf,
        image: String,
        old_bytes: Vec<u8>,
        new_bytes: Vec<u8>,
    }

    impl Rig {
        fn new(case: &str) -> Self {
            Self::in_folder(case, "app")
        }

        fn in_folder(case: &str, folder: &str) -> Self {
            let pid = std::process::id();
            let root = std::env::temp_dir().join(format!("zc-swap-test-{pid}-{case}"));
            let _ = fs::remove_dir_all(&root);
            let dir = root.join(folder);
            fs::create_dir_all(&dir).unwrap();
            let image = format!("zcfake{pid}{case}.exe");
            let current = dir.join(&image);
            let new = dir.join(format!("{image}.new"));
            // cmd stays open when started with nothing to do, so a start can be seen. Bytes after the end of an exe
            // don't stop it running, so the new one runs the same way but is a different file.
            fs::copy(Path::new(SYSTEM).join("cmd.exe"), &current).unwrap();
            let mut new_build = fs::read(&current).unwrap();
            new_build.extend_from_slice(b"new build");
            fs::write(&new, new_build).unwrap();
            Rig {
                bak: current.with_extension("exe.bak"),
                helper: dir.join("zoochattr-update.cmd"),
                old_bytes: fs::read(&current).unwrap(),
                new_bytes: fs::read(&new).unwrap(),
                dir: root,
                current,
                new,
                image,
            }
        }

        /// The fake app, running for about `seconds`.
        fn run_old_app(&self, seconds: u32) -> Child {
            Command::new(&self.current)
                .args(["/c", &format!("ping -n {} 127.0.0.1 >nul", seconds + 1)])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap()
        }

        fn start_helper(&self, exit_tries: u32, place_tries: u32) {
            let script = windows_helper_script(&self.current, &self.new, exit_tries, place_tries);
            start_windows_helper(&self.current, &script).unwrap();
        }

        fn wait_for_helper(&self, seconds: u64) {
            let deadline = Instant::now() + Duration::from_secs(seconds);
            while self.helper.exists() {
                assert!(Instant::now() < deadline, "the helper never finished");
                sleep(Duration::from_millis(100));
            }
            // The last line deletes the file, then a restarted app can take a moment to show up.
            sleep(Duration::from_millis(700));
        }

        fn app_running(&self) -> bool {
            let out = Command::new("tasklist")
                .args(["/FI", &format!("IMAGENAME eq {}", self.image), "/NH"])
                .output()
                .unwrap();
            String::from_utf8_lossy(&out.stdout).contains(&self.image)
        }

        fn assert_old_kept(&self) {
            assert!(fs::read(&self.current).unwrap() == self.old_bytes, "the old exe must still be there, unchanged");
            assert!(!self.bak.exists(), "nothing should be left aside");
        }

        fn assert_swapped(&self) {
            assert!(fs::read(&self.current).unwrap() == self.new_bytes, "the new exe must be in place");
            assert!(fs::read(&self.bak).unwrap() == self.old_bytes, "the old exe stays until the new app removes it");
            assert!(!self.new.exists(), "the .new file was moved");
            assert!(self.app_running(), "the new app should be running");
        }

        fn make_new_exit_at_once(&mut self) {
            fs::copy(Path::new(SYSTEM).join("HOSTNAME.EXE"), &self.new).unwrap();
            self.new_bytes = fs::read(&self.new).unwrap();
        }
    }

    impl Drop for Rig {
        fn drop(&mut self) {
            let _ = Command::new("taskkill").args(["/F", "/IM", &self.image]).output();
            if self.helper.exists() {
                // A failed test can leave its helper waiting. Stop only the cmd whose command line names this test's folder.
                let filter = self.dir.file_name().unwrap().to_string_lossy().to_string();
                let stop = format!(
                    "Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | Where-Object {{ $_.CommandLine -like '*{filter}*' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force }}"
                );
                let _ = Command::new("powershell").args(["-NoProfile", "-Command", &stop]).output();
            }
            // A killed fake lets go of its file a moment later.
            for _ in 0..25 {
                sleep(Duration::from_millis(200));
                if fs::remove_dir_all(&self.dir).is_ok() || !self.dir.exists() {
                    break;
                }
            }
        }
    }

    #[test]
    fn swaps_and_cleans_up() {
        let rig = Rig::new("plain");
        rig.start_helper(10, 3);
        rig.wait_for_helper(20);
        rig.assert_swapped();
    }

    #[test]
    fn waits_for_the_app_to_close() {
        let rig = Rig::new("waits");
        let mut app = rig.run_old_app(5);
        rig.start_helper(30, 3);
        sleep(Duration::from_secs(3));
        // A running exe can be renamed on Windows, so this fails if the helper doesn't really wait.
        rig.assert_old_kept();
        assert!(rig.helper.exists());
        app.wait().unwrap();
        rig.wait_for_helper(20);
        rig.assert_swapped();
    }

    #[test]
    fn gives_up_when_the_app_never_closes() {
        let rig = Rig::new("stuck");
        let mut app = rig.run_old_app(40);
        rig.start_helper(3, 3);
        rig.wait_for_helper(20);
        rig.assert_old_kept();
        let _ = app.kill();
        let _ = app.wait();
    }

    #[test]
    fn a_missing_new_exe_leaves_the_old_one_running() {
        let rig = Rig::new("missing");
        fs::remove_file(&rig.new).unwrap();
        rig.start_helper(10, 3);
        rig.wait_for_helper(20);
        rig.assert_old_kept();
        assert!(rig.app_running(), "the old app should be restarted");
    }

    #[test]
    fn a_new_exe_that_stays_locked_puts_the_old_one_back() {
        let rig = Rig::new("locked");
        let hold = fs::OpenOptions::new().read(true).share_mode(0).open(&rig.new).unwrap();
        rig.start_helper(10, 2);
        rig.wait_for_helper(20);
        drop(hold);
        rig.assert_old_kept();
        assert!(rig.app_running(), "the old app should be restarted");
    }

    #[test]
    fn a_new_exe_locked_for_a_moment_still_goes_in() {
        let rig = Rig::new("brief");
        let hold = fs::OpenOptions::new().read(true).share_mode(0).open(&rig.new).unwrap();
        rig.start_helper(10, 10);
        sleep(Duration::from_millis(2500));
        // Retrying: the app must still be there the whole time, in case something stops the helper now.
        assert!(fs::read(&rig.current).unwrap() == rig.old_bytes);
        drop(hold);
        rig.wait_for_helper(20);
        rig.assert_swapped();
    }

    #[test]
    fn a_new_exe_that_dies_at_once_puts_the_old_one_back() {
        let mut rig = Rig::new("dies");
        rig.make_new_exit_at_once();
        rig.start_helper(10, 3);
        rig.wait_for_helper(20);
        rig.assert_old_kept();
        assert!(rig.app_running(), "the old app should be restarted");
    }

    #[test]
    fn a_new_exe_windows_refuses_to_run_puts_the_old_one_back() {
        let rig = Rig::new("denied");
        // S-1-1-0 is Everyone, under any Windows language.
        let deny = Command::new("icacls").args([rig.new.as_os_str(), "/deny".as_ref(), "*S-1-1-0:(X)".as_ref()]).output().unwrap();
        assert!(deny.status.success());
        rig.start_helper(10, 3);
        rig.wait_for_helper(20);
        rig.assert_old_kept();
        assert!(rig.app_running(), "the old app should be restarted");
    }

    #[test]
    fn a_locked_backup_is_still_copied_back() {
        let mut rig = Rig::new("lockedbak");
        rig.make_new_exit_at_once();
        let bak = rig.bak.clone();
        // Grabs the backup as soon as it appears, the way a scanner would: reading, no delete sharing.
        let holder = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(15);
            while Instant::now() < deadline {
                if let Ok(file) = fs::OpenOptions::new().read(true).share_mode(1 | 2).open(&bak) {
                    sleep(Duration::from_secs(12));
                    drop(file);
                    return;
                }
                sleep(Duration::from_millis(5));
            }
        });
        rig.start_helper(10, 2);
        rig.wait_for_helper(20);
        assert!(fs::read(&rig.current).unwrap() == rig.old_bytes, "the old exe must be back");
        assert!(rig.app_running(), "the old app should be restarted");
        holder.join().unwrap();
    }

    #[test]
    fn a_backup_that_cant_be_read_leaves_both_files() {
        let mut rig = Rig::new("nobak");
        rig.make_new_exit_at_once();
        let bak = rig.bak.clone();
        let holder = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(15);
            while Instant::now() < deadline {
                if let Ok(file) = fs::OpenOptions::new().read(true).share_mode(0).open(&bak) {
                    sleep(Duration::from_secs(10));
                    drop(file);
                    return;
                }
                sleep(Duration::from_millis(5));
            }
        });
        rig.start_helper(10, 2);
        rig.wait_for_helper(20);
        holder.join().unwrap();
        assert!(fs::read(&rig.current).unwrap() == rig.new_bytes, "nothing could be put back, and nothing was lost");
        assert!(fs::read(&rig.bak).unwrap() == rig.old_bytes);
    }

    #[test]
    fn a_stuck_old_exe_is_left_alone() {
        let rig = Rig::new("nomove");
        // Open for writing is allowed, so the "has it closed" check passes, but it can't be renamed.
        let hold = fs::OpenOptions::new().read(true).share_mode(1 | 2).open(&rig.current).unwrap();
        rig.start_helper(10, 3);
        rig.wait_for_helper(20);
        drop(hold);
        rig.assert_old_kept();
    }

    #[test]
    fn an_old_bak_from_before_does_not_get_in_the_way() {
        let rig = Rig::new("stale");
        fs::write(&rig.bak, b"left over").unwrap();
        let mut read_only = fs::metadata(&rig.bak).unwrap().permissions();
        read_only.set_readonly(true);
        fs::set_permissions(&rig.bak, read_only).unwrap();
        rig.start_helper(10, 3);
        rig.wait_for_helper(20);
        rig.assert_swapped();
    }

    #[test]
    fn the_new_app_removes_only_the_backup() {
        let rig = Rig::new("forget");
        fs::write(&rig.bak, b"old").unwrap();
        remove_old_exe(&rig.current);
        assert!(!rig.bak.exists());
        assert!(rig.current.exists());
        assert!(rig.new.exists());
        remove_old_exe(&rig.current);
    }

    #[test]
    // Folders with & or ^, or with ( ) ; and no space, don't get this far: the helper never starts (see the report).
    fn percent_signs_spaces_and_brackets_in_the_folder_work() {
        let rig = Rig::in_folder("odd", "100% zoo (test)");
        rig.start_helper(10, 3);
        rig.wait_for_helper(20);
        rig.assert_swapped();
    }
}

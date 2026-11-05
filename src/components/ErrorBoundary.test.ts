import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

/** Node has no DOM, so this checks what the boundary draws and does. The real catch is checked in a browser. */
function failed(props: Partial<ConstructorParameters<typeof ErrorBoundary>[0]> = {}) {
  const boundary = new ErrorBoundary({ message: "This chat can't be shown.", children: "chat", ...props });
  boundary.state = ErrorBoundary.getDerivedStateFromError();
  return boundary;
}

const sources = import.meta.glob<string>(["/src/App.tsx", "/src/main.tsx", "/src/components/layout/*.tsx"], { query: "?raw", import: "default", eager: true });

describe("ErrorBoundary", () => {
  it("draws its children until something fails", () => {
    expect(renderToStaticMarkup(createElement(ErrorBoundary, { message: "x", children: "chat" }))).toBe("chat");
  });

  it("says what failed instead of going blank", () => {
    const html = renderToStaticMarkup(failed().render());
    expect(html).toContain("This chat can&#x27;t be shown.");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again");
    expect(html).not.toContain("chat</");
  });

  it("offers a way out when it has one", () => {
    const onClear = vi.fn();
    expect(renderToStaticMarkup(failed({ onClear, clearLabel: "Clear this pane" }).render())).toContain("Clear this pane");
    expect(renderToStaticMarkup(failed().render())).not.toContain("Clear this pane");
  });

  it("tries again when what it shows changes", () => {
    const boundary = failed({ resetKey: "b" });
    const setState = vi.spyOn(boundary, "setState").mockImplementation(() => undefined);
    boundary.componentDidUpdate({ resetKey: "b" });
    expect(setState).not.toHaveBeenCalled();
    boundary.componentDidUpdate({ resetKey: "a" });
    expect(setState).toHaveBeenCalledWith({ failed: false });
  });
});

describe("where the boundaries sit", () => {
  const view = sources["/src/App.tsx"];

  it("keeps Settings out of the chat view's boundary", () => {
    const open = view.indexOf("<ErrorBoundary");
    const close = view.indexOf("</ErrorBoundary>");
    expect(open).toBeGreaterThan(-1);
    expect(view.indexOf("<GridView")).toBeGreaterThan(open);
    expect(view.indexOf("<GridView")).toBeLessThan(close);
    expect(view.indexOf("<SettingsDialog")).toBeGreaterThan(close);
    expect(view.indexOf("<BottomBar")).toBeGreaterThan(close);
  });

  it("keeps the gear out of the message box's boundary", () => {
    expect(sources["/src/components/layout/BottomBar.tsx"]).toMatch(/<ErrorBoundary[^>]*>\s*<Composer/);
  });

  it("gives every grid pane its own", () => {
    expect(sources["/src/components/layout/Views.tsx"]).toMatch(/<ErrorBoundary[\s\S]{0,300}<ChatBox/);
  });

  it("catches anything left at the top", () => {
    expect(sources["/src/main.tsx"]).toMatch(/<ErrorBoundary[\s\S]{0,200}<Root \/>/);
  });
});

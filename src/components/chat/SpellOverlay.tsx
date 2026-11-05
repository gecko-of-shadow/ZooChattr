import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { SpellSpan } from "@/lib/spell/misspellings";

interface MirrorStyle {
  font: string;
  letterSpacing: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  borderTopWidth: string;
  borderRightWidth: string;
  borderBottomWidth: string;
  borderLeftWidth: string;
  scrollLeft: number;
}

/** Wavy underlines drawn in a transparent copy of the input so they share its font, padding and scroll. */
export function SpellMirror({
  text,
  spans,
  inputRef,
}: {
  text: string;
  spans: SpellSpan[];
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [box, setBox] = useState<MirrorStyle | null>(null);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const sync = () => {
      const cs = getComputedStyle(el);
      setBox({
        font: cs.font,
        letterSpacing: cs.letterSpacing,
        paddingTop: cs.paddingTop,
        paddingRight: cs.paddingRight,
        paddingBottom: cs.paddingBottom,
        paddingLeft: cs.paddingLeft,
        borderTopWidth: cs.borderTopWidth,
        borderRightWidth: cs.borderRightWidth,
        borderBottomWidth: cs.borderBottomWidth,
        borderLeftWidth: cs.borderLeftWidth,
        scrollLeft: el.scrollLeft,
      });
    };
    sync();
    el.addEventListener("scroll", sync);
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, [inputRef, text, spans]);

  if (!box || spans.length === 0) return null;

  const parts: { key: string; text: string; miss: boolean }[] = [];
  let cursor = 0;
  spans.forEach((span, index) => {
    if (span.start > cursor) parts.push({ key: `t-${cursor}`, text: text.slice(cursor, span.start), miss: false });
    parts.push({ key: `m-${index}`, text: text.slice(span.start, span.end), miss: true });
    cursor = span.end;
  });
  if (cursor < text.length) parts.push({ key: "tail", text: text.slice(cursor), miss: false });

  return (
    <div data-testid="spell-underlines" aria-hidden className="pointer-events-none absolute inset-0 z-[1] overflow-hidden">
      <div
        className="whitespace-pre text-transparent"
        style={{
          font: box.font,
          letterSpacing: box.letterSpacing,
          paddingTop: box.paddingTop,
          paddingRight: box.paddingRight,
          paddingBottom: box.paddingBottom,
          paddingLeft: box.paddingLeft,
          borderTopWidth: box.borderTopWidth,
          borderRightWidth: box.borderRightWidth,
          borderBottomWidth: box.borderBottomWidth,
          borderLeftWidth: box.borderLeftWidth,
          borderStyle: "solid",
          borderColor: "transparent",
          transform: `translateX(-${box.scrollLeft}px)`,
        }}
      >
        {parts.map((part) =>
          part.miss ? (
            <span key={part.key} data-testid="spell-miss" className="underline decoration-wavy decoration-destructive decoration-1 underline-offset-[3px]">
              {part.text}
            </span>
          ) : (
            <span key={part.key}>{part.text}</span>
          ),
        )}
      </div>
    </div>
  );
}

export function SpellMenu({
  x,
  y,
  suggestions,
  onPick,
  onAdd,
  onIgnore,
  onClose,
}: {
  x: number;
  y: number;
  suggestions: string[];
  onPick: (word: string) => void;
  onAdd: () => void;
  onIgnore: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPress = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Comes first, wherever focus is, so the same Esc doesn't also leave the single view or close Settings.
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("pointerdown", onPress, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const left = Math.max(8, Math.min(x, window.innerWidth - 220));
  const top = Math.max(8, Math.min(y, window.innerHeight - 240));
  return (
    <div
      ref={menuRef}
      role="menu"
      // Pressing a gap between the items must not take focus from the message box.
      onMouseDown={(event) => event.preventDefault()}
      data-testid="spell-menu"
      className="fixed z-50 min-w-44 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      style={{ left, top }}
    >
      {suggestions.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">No suggestions</div>
      ) : (
        suggestions.map((word) => (
          <button
            key={word}
            type="button"
            role="menuitem"
            className="flex w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(word)}
          >
            {word}
          </button>
        ))
      )}
      <div className="my-1 h-px bg-border" />
      <button
        type="button"
        role="menuitem"
        className="flex w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onAdd}
      >
        Add to dictionary
      </button>
      <button
        type="button"
        role="menuitem"
        className="flex w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onIgnore}
      >
        Ignore
      </button>
    </div>
  );
}

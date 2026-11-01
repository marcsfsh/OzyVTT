import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/** Gap between a map menu and the viewport edge, on every side. */
const MARGIN = 8;
/** A phone's gutters either side of a menu opened from the view's foot. */
const PHONE_GUTTER = 10;

/** The map menu open now: opening another closes it, so one is open at a time. */
let openMenuClose: (() => void) | null = null;

/**
 * Where a menu opened at a pointer sits: by the pointer, moved up until its bottom fits, and when even then it cannot
 * fit, the viewport's column with the menu scrolling itself. Measured before paint and again on resize, so the
 * corrected box is the first one drawn. `again` lists what changes the menu's height.
 */
export function useMenuPlacement(
  ref: RefObject<HTMLElement | null>,
  x: number,
  y: number,
  again: readonly unknown[] = []
): CSSProperties {
  const [box, setBox] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const [foot, setFoot] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      // On a phone a map menu opens from the foot of the view, above the bottom tabs, with 10px gutters and the thing
      // left in view above it, at most 70% of the height (C2 spec 2.1).
      if (window.matchMedia?.("(max-width: 760px)").matches) {
        const tabs = document.querySelector(".app-bottom-tabs")?.getBoundingClientRect().height ?? 0;
        setFoot({
          left: PHONE_GUTTER,
          right: PHONE_GUTTER,
          top: "auto",
          bottom: tabs + PHONE_GUTTER,
          maxWidth: "none",
          maxHeight: Math.round(window.innerHeight * 0.7)
        });
        return;
      }
      setFoot(null);
      const room = window.innerHeight - MARGIN * 2;
      // Measure the natural height with the cap off, so a menu that gained room gets it back.
      const previous = el.style.maxHeight;
      el.style.maxHeight = "none";
      const height = el.offsetHeight;
      const width = el.offsetWidth;
      el.style.maxHeight = previous;
      const left = Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN));
      const top = height > room ? MARGIN : Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN));
      setBox((current) =>
        current && current.left === left && current.top === top && current.maxHeight === room
          ? current
          : { left, top, maxHeight: room }
      );
    };
    place();
    window.addEventListener("resize", place);
    // A menu whose rows grow or shrink while it is open (a form in it, a section that unfolds) is placed again.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => place());
    const el = ref.current;
    if (observer && el) for (const child of [el, ...Array.from(el.children)]) observer.observe(child);
    return () => {
      window.removeEventListener("resize", place);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `again` is the caller's list of what moves the menu.
  }, [ref, x, y, ...again]);
  if (foot) return foot;
  return box
    ? { left: box.left, top: box.top, maxHeight: box.maxHeight }
    : // First paint, before measurement: the pointer clamped to the viewport. The layout effect corrects it in the
      // same frame, so this is never seen.
      {
        left: Math.max(MARGIN, Math.min(x, window.innerWidth - MARGIN)),
        top: Math.max(MARGIN, Math.min(y, window.innerHeight - MARGIN)),
        visibility: "hidden"
      };
}

/**
 * Closes a menu on a press outside it or on Escape. The outside press waits a tick, so the opening one is not it.
 * Opening a menu closes any other map menu, and closing one gives the focus back to what had it.
 */
export function useMenuDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  // One menu at a time; and when it closes the focus goes back to what had it, the thing the menu is about.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (openMenuClose && openMenuClose !== onClose) openMenuClose();
    openMenuClose = onClose;
    return () => {
      if (openMenuClose === onClose) openMenuClose = null;
      if (opener && opener !== document.body && document.contains(opener)) opener.focus({ preventScroll: true });
    };
    // Keyed on the menu's own close, so a re-render does not count as a new menu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const armed = window.setTimeout(() => document.addEventListener("pointerdown", onPointer), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(armed);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, onClose]);
}

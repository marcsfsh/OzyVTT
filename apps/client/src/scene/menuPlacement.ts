import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/** Gap between a map menu and the viewport edge, on every side. */
const MARGIN = 8;

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
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const room = window.innerHeight - MARGIN * 2;
      // Measure the natural height with the cap off, so a menu that gained room gets it back.
      const previous = el.style.maxHeight;
      el.style.maxHeight = "none";
      const height = el.offsetHeight;
      const width = el.offsetWidth;
      el.style.maxHeight = previous;
      const left = Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN));
      const top = height > room ? MARGIN : Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN));
      setBox({ left, top, maxHeight: room });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `again` is the caller's list of what moves the menu.
  }, [ref, x, y, ...again]);
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

/** Closes a menu on a press outside it or on Escape. The outside press waits a tick, so the opening one is not it. */
export function useMenuDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void) {
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

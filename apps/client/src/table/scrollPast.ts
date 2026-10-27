import { useCallback, useEffect, useRef, useState } from "react";
import "./scroll-past.css";

/** What a phone's panel is busy with: choosing a target needs the map, and the character sheet needs the panel. */
export type SplitMoment = "choosing" | "sheet" | null;

/**
 * A phone's map-then-panel column: the map (with its tools) keeps a fixed height and scrolls away, and the panel below
 * it is one screen tall, so scrolled to the end its tabs sit under the strip above. Until the map has gone the panel's
 * own regions don't scroll, so every drag moves the column; once it has, they scroll, and a drag down from the top of
 * one brings the map back. A moment that needs the map scrolls to it, and one that needs the panel scrolls past it.
 */
export function useScrollPast(enabled: boolean, moment: SplitMoment = null) {
  const columnRef = useRef<HTMLDivElement | null>(null);
  const [atPanel, setAtPanel] = useState(false);

  const measure = useCallback(() => {
    const column = columnRef.current;
    const map = column?.querySelector<HTMLElement>(":scope > .table-bench-map");
    if (!column || !map) return setAtPanel(false);
    setAtPanel(column.scrollTop >= map.offsetHeight - 2);
  }, []);

  useEffect(() => {
    const column = columnRef.current;
    if (!enabled || !column) return;
    measure();
    column.addEventListener("scroll", measure, { passive: true });
    return () => column.removeEventListener("scroll", measure);
  }, [enabled, measure]);

  useEffect(() => {
    const column = columnRef.current;
    if (!enabled || !column || moment === null) return;
    const map = column.querySelector<HTMLElement>(":scope > .table-bench-map");
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    column.scrollTo({
      top: moment === "choosing" ? 0 : (map?.offsetHeight ?? 0),
      behavior: reduced ? "auto" : "smooth"
    });
  }, [enabled, moment]);

  const className = enabled ? `is-scroll-past scroll-y${atPanel ? " is-at-panel" : ""}` : "";
  return { columnRef, className, atPanel } as const;
}

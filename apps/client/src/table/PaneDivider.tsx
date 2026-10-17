import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { IconGrip } from "@vtt/ui";
import "./pane-divider.css";

/** The map pane's share of the table's height on a phone: never less than a fifth, never more than four fifths. */
export const SPLIT_MIN = 20;
export const SPLIT_MAX = 80;
const SPLIT_DEFAULT = 42;
const STEP = 5;
const MEMORY_KEY = "vtt.table-split";

const clamp = (value: number) => Math.round(Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, value)));

/** The split the person chose on this device, as a percent of the table's height for the map pane. */
export function useTableSplit() {
  const [split, setSplit] = useState<number>(() => {
    try {
      const stored = Number(localStorage.getItem(MEMORY_KEY));
      return Number.isFinite(stored) && stored > 0 ? clamp(stored) : SPLIT_DEFAULT;
    } catch {
      return SPLIT_DEFAULT;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(MEMORY_KEY, String(split));
    } catch {
      /* private mode: the split still works, it just won't be remembered */
    }
  }, [split]);
  return [split, (next: number) => setSplit(clamp(next))] as const;
}

/**
 * The divider between a phone's map pane and the panel under it: a real separator that a finger drags and the arrow
 * keys move, with its value the map's share of the height. Home and End go to the smallest and largest map.
 */
export function PaneDivider({
  value,
  onChange,
  container
}: Readonly<{
  value: number;
  onChange: (value: number) => void;
  /** The box the split divides, for turning a drag into a share of its height. */
  container: () => HTMLElement | null;
}>) {
  const drag = useRef<{ top: number; height: number } | null>(null);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const box = container()?.getBoundingClientRect();
    if (!box || box.height <= 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { top: box.top, height: box.height };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onChange(((event.clientY - drag.current.top) / drag.current.height) * 100);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === "ArrowUp"
        ? value - STEP
        : event.key === "ArrowDown"
          ? value + STEP
          : event.key === "Home"
            ? SPLIT_MIN
            : event.key === "End"
              ? SPLIT_MAX
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange(next);
  };
  return (
    <div
      className="pane-divider"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Map and panel split"
      aria-valuemin={SPLIT_MIN}
      aria-valuemax={SPLIT_MAX}
      aria-valuenow={value}
      aria-valuetext={`Map ${value}% of the height`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <IconGrip />
    </div>
  );
}

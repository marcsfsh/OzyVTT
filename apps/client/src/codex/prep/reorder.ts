import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useDragSurface } from "@vtt/ui";
import { moveItem } from "./sections";

/**
 * Reordering a list by a drag handle and by the keyboard. A handle drag moves the row live as the pointer crosses the
 * middle of a neighbour, and the order is committed on release; Alt with an arrow key moves the focused row one place.
 * Every row is an element with `data-reorder-row`; the list container takes `listRef`.
 */
export function useReorder<T>(items: readonly T[], onCommit: (next: T[]) => void, nameOf: (item: T) => string) {
  const listRef = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState<Readonly<{ from: number; at: number; pointerId: number }> | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const handleRef = useDragSurface<HTMLButtonElement>();

  const say = useCallback(
    (item: T, index: number, total: number) =>
      setAnnouncement(`${nameOf(item)} moved to place ${index + 1} of ${total}.`),
    [nameOf]
  );

  /** The order shown: the stored order, or the live order while a drag is under way. */
  const shown = dragging ? moveItem(items, dragging.from, dragging.at) : [...items];

  const onHandlePointerDown = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging({ from: index, at: index, pointerId: event.pointerId });
  };
  const onHandlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-reorder-row]") ?? [])];
    let at = dragging.at;
    rows.forEach((row, index) => {
      if (index === dragging.at) return;
      const box = row.getBoundingClientRect();
      const middle = box.top + box.height / 2;
      if (index < dragging.at && event.clientY < middle) at = Math.min(at, index);
      if (index > dragging.at && event.clientY > middle) at = Math.max(at, index);
    });
    if (at !== dragging.at) setDragging({ ...dragging, at });
  };
  const onHandlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const { from, at } = dragging;
    setDragging(null);
    if (event.type === "pointercancel" || from === at) return;
    const next = moveItem(items, from, at);
    onCommit(next);
    say(items[from], at, items.length);
  };

  /** Alt and an arrow key move the row with focus in it. */
  const onRowKeyDown = (index: number) => (event: KeyboardEvent<HTMLElement>) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    const to = index + (event.key === "ArrowUp" ? -1 : 1);
    if (to < 0 || to >= items.length) return;
    event.preventDefault();
    const focused = document.activeElement as HTMLElement | null;
    onCommit(moveItem(items, index, to));
    say(items[index], to, items.length);
    // Keep focus on the control that moved with its row.
    requestAnimationFrame(() => focused?.focus());
  };

  const move = (index: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    onCommit(moveItem(items, index, to));
    say(items[index], to, items.length);
  };

  return {
    listRef,
    shown,
    draggingIndex: dragging ? dragging.at : null,
    announcement,
    handleRef,
    handleProps: (index: number) => ({
      ref: handleRef,
      onPointerDown: onHandlePointerDown(index),
      onPointerMove: onHandlePointerMove,
      onPointerUp: onHandlePointerUp,
      onPointerCancel: onHandlePointerUp
    }),
    onRowKeyDown,
    move
  };
}

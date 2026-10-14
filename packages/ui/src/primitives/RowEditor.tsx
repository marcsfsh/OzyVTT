import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useId, useRef, useState } from "react";
import { cx } from "./util";
import { Button } from "./Button";
import { Menu, MenuItem } from "./Menu";
import { IconChevron, IconDrag, IconPlus, IconTrash } from "./icons";
import "./RowEditor.css";

export interface RowEditorProps<T> {
  rows: readonly T[];
  onChange: (next: readonly T[]) => void;
  /** Stable id, never the array index (see the component note). */
  rowKey: (row: T) => string;
  renderRow: (row: T, index: number) => ReactNode;
  /** The caller mints the row (with `newId()`), so the primitive never invents data. */
  onAdd: () => T;
  addLabel: string;
  /** Collapsed summary and the stem of every row-scoped accessible name. */
  rowLabel?: (row: T, index: number) => string;
  collapsible?: boolean;
  reorderable?: boolean;
  max?: number;
  maxReachedReason?: string;
  emptyText?: string;
  ariaLabel: string;
  className?: string;
}

/** The repeating-rows editor behind every `kind: "rows"` field (monster actions, equipment options, damage
    parts, granted spells).
    `rowKey` must be a stable id, not the index: keyed by index, removing a row hands its focus, open state and
    unsaved keystrokes to the next record. The caller mints the id with `newId()`, which is why `onAdd` returns
    the row.
    One ⋯ menu per row (Move up, Move down, Remove) instead of three icon targets; the drag grip is a pointer-only
    extra. Collapse state is UI-local and never stored in the draft. */
export function RowEditor<T>({
  rows,
  onChange,
  rowKey,
  renderRow,
  onAdd,
  addLabel,
  rowLabel,
  collapsible = false,
  reorderable = true,
  max,
  maxReachedReason,
  emptyText,
  ariaLabel,
  className
}: RowEditorProps<T>) {
  const autoId = useId();
  const reasonId = `${autoId}-reason`;
  const listRef = useRef<HTMLUListElement>(null);
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dragRef = useRef<{ from: number; over: number } | null>(null);

  const full = max != null && rows.length >= max;
  const labelOf = (row: T, index: number) => rowLabel?.(row, index) || `Row ${index + 1}`;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || to === from) return;
    const next = rows.slice();
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    onChange(next);
    setAnnouncement(`${labelOf(rows[from], from)} moved to position ${to + 1} of ${rows.length}.`);
  };

  const remove = (index: number) => {
    setAnnouncement(`${labelOf(rows[index], index)} removed.`);
    onChange(rows.filter((_, i) => i !== index));
  };

  const add = () => {
    if (full) return;
    const row = onAdd();
    onChange([...rows, row]);
    setExpanded((prev) => [...prev, rowKey(row)]);
    setAnnouncement(`${addLabel} — ${rows.length + 1} total.`);
  };

  /* Pointer events, not HTML5 drag-and-drop, which never fires from touch. Pointer capture keeps moves coming
     when the finger leaves the grip. */
  const onGripDown = (event: ReactPointerEvent<HTMLSpanElement>, index: number) => {
    if (!reorderable || rows.length < 2) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { from: index, over: index };
    setDragFrom(index);
    setDragOver(index);
  };
  const onGripMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = dragRef.current;
    const list = listRef.current;
    if (!drag || !list) return;
    const items = Array.from(list.children) as HTMLElement[];
    let over = drag.over;
    for (let i = 0; i < items.length; i++) {
      const box = items[i].getBoundingClientRect();
      if (event.clientY >= box.top && event.clientY <= box.bottom) { over = i; break; }
      if (i === 0 && event.clientY < box.top) over = 0;
      if (i === items.length - 1 && event.clientY > box.bottom) over = items.length - 1;
    }
    if (over !== drag.over) { drag.over = over; setDragOver(over); }
  };
  const onGripUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragFrom(null);
    setDragOver(null);
    if (drag) move(drag.from, drag.over);
  };

  return (
    <div className={cx("nh-roweditor", dragFrom !== null && "is-reordering", className)}>
      {rows.length === 0 && emptyText != null && (
        /* `.nh-empty` without its 12rem min-height, which would dwarf the fields in a form section. */
        <p className="nh-empty nh-roweditor-empty">{emptyText}</p>
      )}

      {rows.length > 0 && (
        <ul className="nh-roweditor-rows" role="list" aria-label={ariaLabel} ref={listRef}>
          {rows.map((row, index) => {
            const key = rowKey(row);
            const label = labelOf(row, index);
            const open = !collapsible || expanded.includes(key);
            const bodyId = `${autoId}-body-${key}`;
            return (
              <li
                key={key}
                className={cx(
                  "nh-roweditor-row",
                  dragFrom === index && "is-dragging",
                  dragFrom !== null && dragOver === index && dragFrom !== index && "is-drop-target"
                )}
              >
                <div className="nh-roweditor-head">
                  {reorderable && rows.length > 1 && (
                    /* Not a <button>: Enter would do nothing. Keyboard reorder is Move up / Move down in the menu. */
                    <span
                      className="nh-roweditor-grip tap-target"
                      aria-hidden="true"
                      onPointerDown={(event) => onGripDown(event, index)}
                      onPointerMove={onGripMove}
                      onPointerUp={onGripUp}
                      onPointerCancel={onGripUp}
                    >
                      <IconDrag />
                    </span>
                  )}

                  {collapsible ? (
                    <button
                      type="button"
                      className="nh-roweditor-toggle interactive"
                      aria-expanded={open}
                      aria-controls={bodyId}
                      onClick={() => setExpanded((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))}
                    >
                      <span className={cx("nh-roweditor-caret", open && "is-open")} aria-hidden="true"><IconChevron /></span>
                      <span className="nh-roweditor-label">{label}</span>
                    </button>
                  ) : (
                    <span className="nh-roweditor-label nh-roweditor-label--static">{label}</span>
                  )}

                  {/* Row-scoped names so a screen reader doesn't hear five bare "Remove"s. */}
                  <Menu icon trigger="⋯" align="end" label={`Actions for ${label}`} className="nh-roweditor-menu">
                    {reorderable && (
                      <MenuItem disabled={index === 0} onClick={() => move(index, index - 1)}>Move {label} up</MenuItem>
                    )}
                    {reorderable && (
                      <MenuItem disabled={index === rows.length - 1} onClick={() => move(index, index + 1)}>Move {label} down</MenuItem>
                    )}
                    <MenuItem tone="danger" icon={<IconTrash />} onClick={() => remove(index)}>Remove {label}</MenuItem>
                  </Menu>
                </div>

                <div className="nh-roweditor-body" id={bodyId} hidden={!open}>{renderRow(row, index)}</div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="nh-roweditor-foot">
        {/* At capacity, disable Add with its reason rather than hiding it. */}
        <Button
          variant="secondary"
          size="sm"
          className="nh-roweditor-add"
          disabled={full}
          aria-describedby={full && maxReachedReason ? reasonId : undefined}
          onClick={add}
        >
          <span className="nh-roweditor-add-icon" aria-hidden="true"><IconPlus /></span>
          {addLabel}
        </Button>
        {full && maxReachedReason && <p className="nh-roweditor-reason" id={reasonId}>{maxReachedReason}</p>}
      </div>

      <span className="nh-sr-only" role="status">{announcement}</span>
    </div>
  );
}

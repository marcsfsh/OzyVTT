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
  /** STABLE id, never the array index — see the note on the component. */
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

/** The repeating-rows editor behind every `kind: "rows"` field — monster actions,
    starting-equipment options, ability bonuses, damage parts, granted spells.

    **`rowKey` is a stable id, not the index.** Keying by index is the bug this
    primitive exists to prevent: remove row 2 of 5 and React reuses row 3's DOM for
    row 2, so the focused input, the open disclosure and any uncommitted keystrokes
    silently belong to a different record. The caller mints the id with `newId()` when
    it mints the row, which is also why `onAdd` returns the row rather than the
    primitive constructing one.

    **One ⋯ menu per row, not four icon buttons.** Move up, move down and remove are
    three targets that would each need a 44px hit area in a dense list; collapsed into
    one menu they cost one target, they match `.nh-card-tools`, and there is no gap
    budget to get wrong. The drag grip is a pointer-only ENHANCEMENT on top — every
    reorder it offers is also in the menu, so nothing here is mouse-only.

    Collapse is UI-local and derived from what the caller passes, never stored in the
    draft: there is nothing to invalidate, and a newly added row opens because you just
    asked for it. */
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

  /* Pointer drag, not HTML5 drag-and-drop: `dragstart` never fires from a touch, so a
     DnD handle would be a mouse-only affordance with the menu as its "fallback" — the
     wrong way round. Pointer capture keeps the moves coming to the grip even when the
     finger leaves it. */
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
        /* `.nh-empty` reused rather than rebuilt, with its 12rem min-height dropped:
           this one sits INSIDE a form section, where a half-screen dashed box would
           dwarf the fields around it. */
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
                    /* Not a <button>: pressing Enter on it would do nothing, and a
                       control that announces itself and then refuses to act is worse
                       than no control. Keyboard reorder is Move up / Move down below. */
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

                  {/* Row-scoped names throughout: a screen reader hearing five bare
                      "Remove"s in a list has been told nothing. */}
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
        {/* Annotate at capacity, never hide the Add button (readiness rule 1): a control
            that vanishes teaches nothing, a disabled one with its reason does. */}
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

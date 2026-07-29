import { useId, useState } from "react";
import { cx } from "./util";
import { Button } from "./Button";
import { Input } from "./forms";
import { IconCheck, IconPlus, IconTrash } from "./icons";
import "./Checklist.css";

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface ChecklistProps {
  items: readonly ChecklistItem[];
  /** Omit for a READ-ONLY list — see the note on the component. Present ⇒ editable. */
  onChange?: (next: readonly ChecklistItem[]) => void;
  /** The caller appends the item, so the primitive never invents content. Needs `onChange` to matter. */
  onAdd?: () => void;
  addLabel?: string;
  max?: number;
  /** Required: a bare list of short lines is unnavigable without a name. */
  ariaLabel: string;
  className?: string;
}

/**
 * An ordered list of short tickable lines — a quest's objectives, and any other
 * "what is still open" checklist. Deliberately exactly `{ text, done }` per item:
 * anything richer (assignees, dates, sub-items) is a different component.
 *
 * **READ-ONLY WHEN `onChange` IS ABSENT, and that is the whole point of the split.**
 * The same list serves the GM console and the player's view of a revealed record, and
 * the player must see PROGRESS without ever seeing a tickable box: no checkbox, no
 * text field, no remove, no Add, and nothing focusable at all. It is not a disabled
 * editor — a disabled checkbox still announces itself as a control the reader is being
 * refused, which is a different (and worse) statement than "this is a status".
 *
 * **Why this is not built on `RowEditor`.** Four things, and the first is fatal:
 *   1. `RowEditor.rowKey` must be a STABLE id, never the index — that is the bug it
 *      exists to prevent. A checklist item has no id and is not allowed to grow one,
 *      so there is nothing to hand it. Minting client-local ids would re-introduce
 *      exactly the identity the record deliberately refuses.
 *   2. `RowEditor` has no read-only mode: `onChange` and `onAdd` are required, and the
 *      Add button and the per-row ⋯ menu always render.
 *   3. Its shape is head + collapsible body — a whole form per row. A checklist row is
 *      one line, and giving a two-key record a drag grip and a ⋯ menu would spend three
 *      touch targets where one is needed.
 *   4. Its `onAdd` returns the new row for the primitive to append; here the caller
 *      appends, because the caller (not a UI primitive) owns what a blank item means.
 * Reach for `RowEditor` the moment a row grows a second field.
 *
 * **Order is content.** The array is rendered exactly as given and every edit preserves
 * position; nothing here sorts, dedupes, or reorders. There is no reorder affordance —
 * out of scope until something asks for it.
 *
 * **React keys are the index here, unavoidably**, because the item has no identity. That
 * is safe only because every row is fully controlled — the checkbox and the text field
 * both read straight from props, so there is no uncommitted local state that could be
 * mis-attributed when a row is removed. Do not add per-row local state without adding
 * identity first.
 */
export function Checklist({ items, onChange, onAdd, addLabel, max, ariaLabel, className }: ChecklistProps) {
  const autoId = useId();
  const reasonId = `${autoId}-reason`;
  const [announcement, setAnnouncement] = useState("");
  const editable = onChange != null;
  const full = max != null && items.length >= max;
  const nameOf = (item: ChecklistItem, index: number) => item.text.trim() || `Item ${index + 1}`;

  const setAt = (index: number, patch: Partial<ChecklistItem>) => {
    onChange?.(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const remove = (index: number) => {
    // Announced because removal has no native announcement, and row-scoped because a
    // screen reader hearing five bare "Remove"s in a list has been told nothing.
    setAnnouncement(`${nameOf(items[index], index)} removed — ${items.length - 1} left.`);
    onChange?.(items.filter((_, i) => i !== index));
  };

  return (
    <div className={cx("nh-checklist", className)}>
      {items.length > 0 && (
        <ul className={cx("nh-checklist-items", !editable && "nh-checklist-items--static")} role="list" aria-label={ariaLabel}>
          {items.map((item, index) => (
            <li key={index} className={cx("nh-checklist-item", item.done && "is-done")}>
              {editable ? (
                <>
                  {/* A replaced element cannot take a `::after`, so the 44px floor lives on
                      the wrapping <label> — which the design language names as the fix for
                      exactly this control. The label also carries the box's accessible name. */}
                  <label className="nh-checklist-tick">
                    <input type="checkbox" checked={item.done} onChange={(event) => setAt(index, { done: event.target.checked })} />
                    <span className="nh-sr-only">{nameOf(item, index)} done</span>
                  </label>
                  <Input
                    className="nh-checklist-field"
                    value={item.text}
                    aria-label={`Item ${index + 1}`}
                    onChange={(event) => setAt(index, { text: event.target.value })}
                  />
                  <button type="button" className="nh-checklist-remove interactive" aria-label={`Remove ${nameOf(item, index)}`} onClick={() => remove(index)}>
                    <IconTrash />
                  </button>
                </>
              ) : (
                <>
                  {/* State reads three ways at once and never by colour alone (design-language
                      R2): a filled cyan box, a check glyph, and the word below for a reader. */}
                  <span className="nh-checklist-mark" aria-hidden="true">{item.done && <IconCheck />}</span>
                  <span className="nh-checklist-text">{item.text}</span>
                  <span className="nh-sr-only">{item.done ? "— done" : "— not done"}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && onAdd && (
        <div className="nh-checklist-foot">
          {/* Annotate at capacity, never hide the Add: a control that vanishes teaches
              nothing, a disabled one with its reason beside it does. */}
          <Button
            variant="secondary"
            size="sm"
            className="nh-checklist-add"
            disabled={full}
            aria-describedby={full ? reasonId : undefined}
            onClick={onAdd}
          >
            <span className="nh-checklist-add-icon" aria-hidden="true"><IconPlus /></span>
            {addLabel ?? "Add item"}
          </Button>
          {full && <p className="nh-checklist-reason" id={reasonId}>{`That is the maximum of ${String(max)}.`}</p>}
        </div>
      )}

      {editable && <span className="nh-sr-only" role="status">{announcement}</span>}
    </div>
  );
}

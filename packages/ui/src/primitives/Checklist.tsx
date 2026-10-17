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

interface ChecklistProps {
  items: readonly ChecklistItem[];
  /** Omit for a read-only list (see the component note). */
  onChange?: (next: readonly ChecklistItem[]) => void;
  /** The caller appends the item, so the primitive never invents content. Needs `onChange`. */
  onAdd?: () => void;
  addLabel?: string;
  max?: number;
  /** Required: a bare list of short lines is unnavigable without a name. */
  ariaLabel: string;
  className?: string;
}

/**
 * An ordered list of short tickable lines (`{ text, done }` only), e.g. a quest's objectives.
 *
 * Read-only when `onChange` is absent: players see progress with no checkbox, field, remove, Add or anything
 * focusable, so no disabled editor announces refused controls.
 *
 * Not built on `RowEditor`, which requires a stable row id (items have none), has no read-only mode, and
 * spends a grip and menu on each row. Use `RowEditor` once a row grows a second field.
 *
 * Order is content: rendered as given, never sorted or reordered. React keys are the index because items
 * have no identity; that is safe only while every row is fully controlled, so add identity before adding
 * per-row local state.
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
    // Removal has no native announcement; name the row so "Remove" isn't announced bare.
    setAnnouncement(`${nameOf(items[index], index)} removed, ${items.length - 1} left.`);
    onChange?.(items.filter((_, i) => i !== index));
  };

  return (
    <div className={cx("nh-checklist", className)}>
      {items.length > 0 && (
        <ul
          className={cx("nh-checklist-items", !editable && "nh-checklist-items--static")}
          role="list"
          aria-label={ariaLabel}
        >
          {items.map((item, index) => (
            <li key={index} className={cx("nh-checklist-item", item.done && "is-done")}>
              {editable ? (
                <>
                  {/* A checkbox can't take `::after`, so the 44px floor and the accessible name live on the wrapping <label>. */}
                  <label className="nh-checklist-tick">
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={(event) => setAt(index, { done: event.target.checked })}
                    />
                    <span className="nh-sr-only">{nameOf(item, index)} done</span>
                  </label>
                  <Input
                    className="nh-checklist-field"
                    value={item.text}
                    aria-label={`Item ${index + 1}`}
                    onChange={(event) => setAt(index, { text: event.target.value })}
                  />
                  <button
                    type="button"
                    className="nh-checklist-remove interactive"
                    aria-label={`Remove ${nameOf(item, index)}`}
                    onClick={() => remove(index)}
                  >
                    <IconTrash />
                  </button>
                </>
              ) : (
                <>
                  {/* State reads three ways, never by colour alone: a filled box, a check glyph, and the text. */}
                  <span className="nh-checklist-mark" aria-hidden="true">
                    {item.done && <IconCheck />}
                  </span>
                  <span className="nh-checklist-text">{item.text}</span>
                  <span className="nh-sr-only">{item.done ? ", done" : ", not done"}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && onAdd && (
        <div className="nh-checklist-foot">
          {/* At capacity, disable Add and show its reason; the button stays visible. */}
          <Button
            variant="secondary"
            size="sm"
            className="nh-checklist-add"
            disabled={full}
            aria-describedby={full ? reasonId : undefined}
            onClick={onAdd}
          >
            <span className="nh-checklist-add-icon" aria-hidden="true">
              <IconPlus />
            </span>
            {addLabel ?? "Add item"}
          </Button>
          {full && <p className="nh-checklist-reason" id={reasonId}>{`That is the maximum of ${String(max)}.`}</p>}
        </div>
      )}

      {editable && (
        <span className="nh-sr-only" role="status">
          {announcement}
        </span>
      )}
    </div>
  );
}

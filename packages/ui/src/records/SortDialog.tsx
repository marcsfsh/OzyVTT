import { useState } from "react";
import { Button, IconButton } from "../primitives/Button";
import { Select } from "../primitives/forms";
import { Modal } from "../primitives/Modal";
import { Eyebrow } from "../primitives/Wordmark";
import { IconX } from "../primitives/icons";
import { cx } from "../primitives/util";
import "./SortDialog.css";

export type SortDirection = "asc" | "desc";
export type SortLevelOf<Key extends string> = Readonly<{ key: Key; direction: SortDirection }>;

/**
 * Sort by several columns in order, as a spreadsheet does: rows sort by the first level, then by each level under it.
 * The list says which columns it sorts on and how each reads in each direction.
 */
export function SortDialog<Key extends string>({
  levels,
  keys,
  keyLabel,
  directionLabel,
  firstDirection,
  maxLevels = 4,
  align = "center",
  onCancel,
  onSort
}: Readonly<{
  levels: readonly SortLevelOf<Key>[];
  /** The columns offered, in the order the menus list them. */
  keys: readonly Key[];
  keyLabel: (key: Key) => string;
  /** How a direction reads for a column: "A to Z", "Newest first". */
  directionLabel: (key: Key, direction: SortDirection) => string;
  /** The direction a column starts in when it is chosen: dates newest first, words A to Z. */
  firstDirection: (key: Key) => SortDirection;
  maxLevels?: number;
  /** A phone's list opens it as a sheet from the bottom, under the thumb. */
  align?: "center" | "bottom";
  onCancel: () => void;
  onSort: (levels: readonly SortLevelOf<Key>[]) => void;
}>) {
  const [draft, setDraft] = useState<readonly SortLevelOf<Key>[]>(levels);
  const [selected, setSelected] = useState(0);
  const unused = keys.find((key) => !draft.some((level) => level.key === key));
  const set = (index: number, patch: Partial<SortLevelOf<Key>>) =>
    setDraft((current) => current.map((level, at) => (at === index ? { ...level, ...patch } : level)));
  const moveUp = () => {
    if (selected <= 0) return;
    setDraft((current) => {
      const next = [...current];
      [next[selected - 1], next[selected]] = [next[selected], next[selected - 1]];
      return next;
    });
    setSelected(selected - 1);
  };
  return (
    <Modal
      open
      onClose={onCancel}
      size="sm"
      align={align}
      title="Sort"
      className="nh-sortdialog"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSort(draft)}>
            Sort
          </Button>
        </>
      }
    >
      <p className="nh-sortdialog-hint">
        Rows sort by the first level, then by each level under it, as in a spreadsheet.
      </p>
      <div className="nh-sortlevels" role="list">
        {draft.map((level, index) => (
          <div
            key={index}
            role="listitem"
            className={cx("nh-sortrow", selected === index && "is-on")}
            onFocus={() => setSelected(index)}
            onClick={() => setSelected(index)}
          >
            <Eyebrow>{index === 0 ? "Sort by" : "Then by"}</Eyebrow>
            <Select
              aria-label={`${index === 0 ? "Sort by" : "Then by"}: column`}
              value={level.key}
              onChange={(event) => {
                const key = event.target.value as Key;
                set(index, { key, direction: firstDirection(key) });
              }}
            >
              {keys.map((key) => (
                <option key={key} value={key} disabled={key !== level.key && draft.some((other) => other.key === key)}>
                  {keyLabel(key)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={`${index === 0 ? "Sort by" : "Then by"}: order`}
              value={level.direction}
              onChange={(event) => set(index, { direction: event.target.value as SortDirection })}
            >
              <option value="asc">{directionLabel(level.key, "asc")}</option>
              <option value="desc">{directionLabel(level.key, "desc")}</option>
            </Select>
            <IconButton
              label={`Delete this level: ${keyLabel(level.key)}`}
              size="sm"
              disabled={draft.length === 1}
              onClick={(event) => {
                event.stopPropagation();
                setDraft((current) => current.filter((_, at) => at !== index));
                setSelected(0);
              }}
            >
              <IconX />
            </IconButton>
          </div>
        ))}
      </div>
      <div className="nh-dropdown-row">
        <Button
          size="sm"
          disabled={!unused || draft.length >= maxLevels}
          onClick={() => {
            if (!unused) return;
            setDraft((current) => [...current, { key: unused, direction: firstDirection(unused) }]);
            setSelected(draft.length);
          }}
        >
          Add a level
        </Button>
        <Button size="sm" disabled={selected <= 0} onClick={moveUp}>
          Move up
        </Button>
      </div>
    </Modal>
  );
}

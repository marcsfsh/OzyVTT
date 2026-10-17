import type { KeyboardEvent } from "react";
import { useId, useRef, useState } from "react";
import { cx } from "./util";
import { Chip } from "./Chip";
import { Combobox } from "./Combobox";
import { Input } from "./forms";
import "./TagInput.css";

export interface TagInputProps {
  values: readonly string[];
  onChange: (next: readonly string[]) => void;
  /** The vocabulary this field draws on; free entry is always allowed. A `<datalist>` unless `pick` is set. */
  suggestions?: readonly string[];
  /**
   * Show the list: the entry box becomes a `Combobox` instead of an `<input list>`, whose datalist has no visible
   * affordance and renders nothing on iOS Safari. Opt in for a canonical vocabulary (the SRD damage types); leave
   * it off for a corpus of existing values (Codex tags), where typing new entries is the norm. Either way the
   * field stays open and normalised. Trade-off: in this mode Backspace on empty doesn't remove the last tag, since the
   * keyboard belongs to the listbox; each chip keeps its ✕.
   */
  pick?: boolean;
  /** How a suggestion reads in the chooser (`"very-rare"` → "Very Rare"). Display only; the stored value is the
      entry itself. */
  optionLabel?: (value: string) => string;
  /** Default: slugify to /^[a-z0-9-]+$/. Return "" to reject the entry. */
  normalize?: (raw: string) => string;
  placeholder?: string;
  max?: number;
  maxReachedReason?: string;
  id?: string;
  ariaLabel?: string;
  className?: string;
}

/** An open list of slugs (armour proficiencies, languages, damage resistances, tags), built from `Chip` +
    `Input`. Open rather than a multiselect because the schemas keep these as free slugs for homebrew.
    Enter or comma commits; Backspace on an empty input removes the last tag. Adds and removes are announced
    politely. `pick` shows a visible chooser over the same suggestions without changing what is accepted. */
export function TagInput({
  values,
  onChange,
  suggestions,
  pick = false,
  optionLabel,
  normalize = slugify,
  placeholder,
  max,
  maxReachedReason,
  id,
  ariaLabel,
  className
}: TagInputProps) {
  const autoId = useId();
  const fieldId = id ?? `nh-tags-${autoId}`;
  const hintId = `${fieldId}-hint`;
  const reasonId = `${fieldId}-reason`;
  const listId = `${fieldId}-list`;
  const [text, setText] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const full = max != null && values.length >= max;
  /* Decided by whether a list exists, not by what is left of it, so the entry component never swaps out
     under the cursor when the last option is chosen. */
  const picking = pick && suggestions !== undefined && suggestions.length > 0;
  const offered = picking ? (suggestions ?? []).filter((entry) => !values.includes(entry)) : [];
  const describedBy = cx(hintId, full && maxReachedReason ? reasonId : false);

  const add = (raw: string) => {
    const tag = normalize(raw);
    if (tag === "" || full) return;
    if (values.includes(tag)) {
      setText("");
      setAnnouncement(`${tag} is already added.`);
      return;
    }
    onChange([...values, tag]);
    setText("");
    setAnnouncement(`${tag} added.`);
  };

  const remove = (tag: string) => {
    onChange(values.filter((entry) => entry !== tag));
    setAnnouncement(`${tag} removed.`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      // Enter inside a form would submit it; comma would land in the value.
      event.preventDefault();
      add(text);
    } else if (event.key === "Backspace" && text === "" && values.length > 0) {
      event.preventDefault();
      remove(values[values.length - 1]);
    }
  };

  return (
    <div className={cx("nh-taginput", className)}>
      {values.length > 0 && (
        <ul className="nh-taginput-tags" role="list" aria-label={ariaLabel ? `${ariaLabel}, chosen` : "Chosen"}>
          {values.map((tag) => (
            <li key={tag}>
              <Chip onRemove={() => remove(tag)} removeLabel={`Remove ${tag}`}>
                {tag}
              </Chip>
            </li>
          ))}
        </ul>
      )}
      {picking ? (
        <Combobox
          id={fieldId}
          ariaLabel={ariaLabel ?? "Add"}
          /* Chosen entries drop out of the menu; `add` would refuse a duplicate anyway. */
          options={offered.map((entry) => ({ id: entry, label: optionLabel ? optionLabel(entry) : entry }))}
          /* Always null: the chips hold the values, and the box stays empty for the next entry. */
          value={null}
          onChange={(next) => {
            if (next !== null) add(next);
          }}
          placeholder={full ? undefined : placeholder}
          disabled={full}
          describedBy={describedBy}
          /* Show the whole vocabulary (the list scrolls at 17rem); a large catalog belongs in `CatalogPicker` instead. */
          limit={Math.max(offered.length, 1)}
          allowFreeText
        />
      ) : (
        <Input
          ref={inputRef}
          id={fieldId}
          className="nh-taginput-input"
          type="text"
          autoComplete="off"
          list={suggestions && suggestions.length > 0 ? listId : undefined}
          value={text}
          placeholder={full ? undefined : placeholder}
          disabled={full}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          // Commit typed text on blur so a half-entered tag isn't lost by tabbing away.
          onBlur={() => {
            if (text.trim() !== "") add(text);
          }}
        />
      )}
      {!picking && suggestions && suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((entry) => (
            <option key={entry} value={entry} />
          ))}
        </datalist>
      )}
      <p className="nh-taginput-hint" id={hintId}>
        {picking ? "Pick from the list, or type your own." : "Press Enter to add."}
      </p>
      {/* At capacity, annotate rather than hide; the reason stays full strength while the input dims. */}
      {full && maxReachedReason && (
        <p className="nh-taginput-reason" id={reasonId}>
          {maxReachedReason}
        </p>
      )}
      <span className="nh-sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
}

/** Content ids are open slugs (`/^[a-z0-9-]+$/`), so "Heavy Armour" and "heavy armour" must be the same. */
export function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

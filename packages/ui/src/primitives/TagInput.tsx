import type { KeyboardEvent } from "react";
import { useId, useRef, useState } from "react";
import { cx } from "./util";
import { Chip } from "./Chip";
import { Input } from "./forms";
import "./TagInput.css";

export interface TagInputProps {
  values: readonly string[];
  onChange: (next: readonly string[]) => void;
  /** Datalist-backed hints. Free entry is ALWAYS allowed — see the note below. */
  suggestions?: readonly string[];
  /** Default: slugify to /^[a-z0-9-]+$/. Return "" to reject the entry. */
  normalize?: (raw: string) => string;
  placeholder?: string;
  max?: number;
  maxReachedReason?: string;
  id?: string;
  ariaLabel?: string;
  className?: string;
}

/** An open list of slugs — armour proficiencies, languages, damage resistances, tags.

    Composed from `Chip` + `Input` rather than invented, and open rather than a
    multiselect on purpose: the content schemas keep these fields as free slugs so a
    homebrew author can name a proficiency the SRD never had. `suggestions` is a
    datalist, which hints without closing the set — a `Select` here would be a
    closed-world control over an open-world field.

    Enter or comma commits; Backspace on an empty input removes the last tag (the
    established chip-entry idiom, and the only reason it is safe is that the tag is one
    click from being re-added). Adds and removes are announced politely, because a chip
    appearing above the field you are typing in is otherwise silent. */
export function TagInput({
  values,
  onChange,
  suggestions,
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

  const add = (raw: string) => {
    const tag = normalize(raw);
    if (tag === "" || full) return;
    if (values.includes(tag)) { setText(""); setAnnouncement(`${tag} is already added.`); return; }
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
        <ul className="nh-taginput-tags" role="list" aria-label={ariaLabel ? `${ariaLabel} — chosen` : "Chosen"}>
          {values.map((tag) => (
            <li key={tag}>
              <Chip onRemove={() => remove(tag)} removeLabel={`Remove ${tag}`}>{tag}</Chip>
            </li>
          ))}
        </ul>
      )}
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
        aria-describedby={cx(hintId, full && maxReachedReason ? reasonId : false)}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        // Commit whatever is typed when focus leaves, so a half-entered tag is not
        // silently thrown away by tabbing on.
        onBlur={() => { if (text.trim() !== "") add(text); }}
      />
      {suggestions && suggestions.length > 0 && (
        <datalist id={listId}>{suggestions.map((entry) => <option key={entry} value={entry} />)}</datalist>
      )}
      <p className="nh-taginput-hint" id={hintId}>Press Enter to add.</p>
      {/* Annotate at capacity; never hide the field (readiness rule 1). The reason keeps
          full strength in --caution-hi — the disabled input dims, the explanation does not. */}
      {full && maxReachedReason && <p className="nh-taginput-reason" id={reasonId}>{maxReachedReason}</p>}
      <span className="nh-sr-only" role="status">{announcement}</span>
    </div>
  );
}

/** Content ids are open slugs (`/^[a-z0-9-]+$/`), so "Heavy Armour" and "heavy armour"
    must not become two different proficiencies. */
export function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

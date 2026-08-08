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
  /** The vocabulary this field draws on. Free entry is ALWAYS allowed — see the note below.
      Invisible (a `<datalist>`) unless `pick` is set. */
  suggestions?: readonly string[];
  /**
   * **Show the list.** The entry box becomes a `Combobox` instead of an `<input list>`.
   *
   * The bug it repairs is the one a `<datalist>` cannot: it has **no affordance at all** — no arrow,
   * no border cue, nothing that says a list exists — and iOS Safari renders it as *nothing*, so on a
   * phone a complete shipped vocabulary is simply invisible. The client reported both halves of this
   * (item rarity, damage types) as "the field is free-form"; it never was, it was unreadable.
   *
   * Opt-in rather than automatic, because `suggestions` here means two different things at two kinds
   * of call site. A **canonical vocabulary** (the thirteen SRD damage types) is a list a GM should be
   * choosing from and only rarely departing from — that is a chooser. A **corpus of what already
   * exists** (every tag any Codex page carries) is a type-ahead over an open-ended set where the
   * normal act is to type a new one — that is a hint, and turning it into a menu would put a wall of
   * previously-used tags in front of the box. Same prop, two intents; the call site knows which.
   *
   * Same contract either way: still open, still normalised through `normalize`, still takes a word
   * the list has never heard of.
   *
   * ONE behaviour is traded: Backspace-on-empty no longer removes the last tag, because the entry box
   * is `Combobox`'s and its keyboard belongs to the listbox. Every chip keeps its own ✕, which is the
   * removal gesture on a phone in either mode.
   */
  pick?: boolean;
  /** How a suggestion READS in the chooser — `"very-rare"` → "Very Rare". Display only: the value
      picked, normalised and stored is the entry itself. Passed in rather than derived here so the
      one deriving rule lives at the call site that owns the vocabulary, never copied into this file. */
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

/** An open list of slugs — armour proficiencies, languages, damage resistances, tags.

    Composed from `Chip` + `Input` rather than invented, and open rather than a
    multiselect on purpose: the content schemas keep these fields as free slugs so a
    homebrew author can name a proficiency the SRD never had. `suggestions` is a
    datalist, which hints without closing the set — a `Select` here would be a
    closed-world control over an open-world field.

    Enter or comma commits; Backspace on an empty input removes the last tag (the
    established chip-entry idiom, and the only reason it is safe is that the tag is one
    click from being re-added). Adds and removes are announced politely, because a chip
    appearing above the field you are typing in is otherwise silent.

    `pick` swaps the entry box for a visible chooser over the same suggestions — see the
    prop. It changes what the GM can SEE, never what the field accepts. */
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
  /* Decided by the LIST's existence, never by what is left of it: basing it on the unchosen
     remainder would swap the whole entry component out from under the cursor on the tap that
     chooses the last option. A chooser with nothing left to offer is still a text box that takes
     a word of the GM's own, which is what `Combobox allowFreeText` already is. */
  const picking = pick && suggestions !== undefined && suggestions.length > 0;
  const offered = picking ? (suggestions ?? []).filter((entry) => !values.includes(entry)) : [];
  const describedBy = cx(hintId, full && maxReachedReason ? reasonId : false);

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
      {picking ? (
        <Combobox
          id={fieldId}
          ariaLabel={ariaLabel ?? "Add"}
          /* Already-chosen entries drop out of the menu rather than sitting there inert: `add`
             refuses a duplicate anyway, so offering one is offering a tap that does nothing. */
          options={offered.map((entry) => ({ id: entry, label: optionLabel ? optionLabel(entry) : entry }))}
          /* Always null. This control is not holding a value — the CHIPS above hold them — so a
             choice is an `onChange` that lands in `values` and leaves the box empty for the next. */
          value={null}
          onChange={(next) => { if (next !== null) add(next); }}
          placeholder={full ? undefined : placeholder}
          disabled={full}
          describedBy={describedBy}
          /* The whole point is that the vocabulary is REACHABLE, so the default page of 8 would
             reintroduce "ten of the thirteen damage types" at the renderer instead of at the
             constant. `.nh-combobox-list` scrolls at 17rem, so a complete bounded list is safe;
             a 300-entry catalog is not this control, it is `searchable` + `CatalogPicker`. */
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
          // Commit whatever is typed when focus leaves, so a half-entered tag is not
          // silently thrown away by tabbing on.
          onBlur={() => { if (text.trim() !== "") add(text); }}
        />
      )}
      {!picking && suggestions && suggestions.length > 0 && (
        <datalist id={listId}>{suggestions.map((entry) => <option key={entry} value={entry} />)}</datalist>
      )}
      <p className="nh-taginput-hint" id={hintId}>{picking ? "Pick from the list, or type your own." : "Press Enter to add."}</p>
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

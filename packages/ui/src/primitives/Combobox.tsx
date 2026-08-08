import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "./util";
import { IconX } from "./icons";
import "./Combobox.css";

export interface ComboboxOption {
  id: string;
  label: string;
  /** Optional leading glyph — an entity icon, a kind mark. Purely decorative; the label names it. */
  icon?: ReactNode;
  /** Optional muted suffix ("Character", "#coast") to disambiguate two same-named records. */
  meta?: string;
}

export interface ComboboxProps {
  options: readonly ComboboxOption[];
  /** The chosen option's id, or null. A chosen value renders as a removable chip, not as typed text. */
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  ariaLabel: string;
  id?: string;
  disabled?: boolean;
  /** Cap on rows shown at once. A picker is a picker; the full list belongs in a list view. */
  limit?: number;
  className?: string;
  /**
   * Accept text that matches no option, so the control can also be a free-text field with suggestions
   * (a connection label, a downtime "who" that is not a page yet). The id handed back is the raw text.
   */
  allowFreeText?: boolean;
}

/**
 * Type-to-filter chooser: an input, a listbox, arrow-key selection, and the chosen value as a removable
 * chip. The ARIA combobox pattern, once, so the five places that need one stop hand-rolling it.
 *
 * Promoted from the Codex's `EntityPicker` and the page editor's `[[` suggestion list (D25) — two
 * bespoke listboxes that had drifted into different keyboard behaviour and different row heights.
 *
 * §4 touch floor: rows are `.nh-combobox-option` with `min-height: var(--tap-min)` — **route 1**, which
 * a stacked list must use; a route-2 `::after` would overhang into the row below and steal its taps.
 */
export function Combobox({
  options, value, onChange, placeholder = "Search…", ariaLabel, id, disabled = false, limit = 8, className, allowFreeText = false
}: ComboboxProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const selected = options.find((option) => option.id === value) ?? null;
  const freeText = value !== null && !selected && allowFreeText ? value : null;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options).slice(0, limit);
  }, [options, query, limit]);

  const pick = (nextId: string) => { onChange(nextId); setQuery(""); setOpen(false); setActive(0); };

  /**
   * **Leaving the box keeps what was typed — but only where typed text is a value.**
   *
   * `allowFreeText` says unmatched text IS the value; discarding it because focus moved contradicts
   * that, and it is the difference between a text box and this control on the one gesture people
   * actually make. Type "unique" into an open-slug field, tap the next field, and the old
   * `<input>` would have kept it while this control silently kept nothing — with no error, because
   * nothing went wrong.
   *
   * An exact label match commits the OPTION's id rather than the words: a page picker in free-text
   * mode must not store "Ireena" where `p1` belongs. Without `allowFreeText` the query is discarded
   * exactly as before — a picker over a closed set must not invent members.
   */
  const commitOnBlur = () => {
    const text = query.trim();
    if (!allowFreeText || text === "") return;
    const exact = options.find((option) => option.label.toLowerCase() === text.toLowerCase());
    pick(exact ? exact.id : text);
  };

  if (selected || freeText) {
    return (
      <div className={cx("nh-combobox", className)}>
        <span className="nh-combobox-chip">
          {selected?.icon}
          <span className="nh-combobox-chiplabel">{selected?.label ?? freeText}</span>
          <button type="button" className="nh-combobox-clear tap-target interactive" aria-label={`Clear ${selected?.label ?? freeText}`} onClick={() => onChange(null)} disabled={disabled}>
            <IconX />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className={cx("nh-combobox", className)} ref={boxRef} onBlur={(event) => { if (!boxRef.current?.contains(event.relatedTarget as Node)) { setOpen(false); commitOnBlur(); } }}>
      <input
        id={id}
        className="nh-input nh-combobox-input"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, matches.length - 1)); }
          else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
          else if (event.key === "Enter") {
            if (matches[active]) { event.preventDefault(); pick(matches[active].id); }
            else if (allowFreeText && query.trim()) { event.preventDefault(); pick(query.trim()); }
          } else if (event.key === "Escape") { setOpen(false); }
        }}
      />
      {open && matches.length > 0 && (
        <ul className="nh-combobox-list" id={listId} role="listbox" aria-label={ariaLabel}>
          {matches.map((option, index) => (
            <li key={option.id}>
              <button
                type="button" role="option" aria-selected={index === active}
                className={cx("nh-combobox-option", index === active && "is-active")}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(option.id)}
              >
                {option.icon}
                <span className="nh-combobox-optionlabel">{option.label}</span>
                {option.meta && <span className="nh-combobox-optionmeta">{option.meta}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

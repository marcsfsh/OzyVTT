import { useId, useMemo, useRef, useState } from "react";
import { IconSearch, Input, cx } from "@vtt/ui";
import { SETTINGS_SECTIONS, searchSettings, type SettingEntry } from "./sections";

const sectionLabel = (entry: SettingEntry) =>
  SETTINGS_SECTIONS.find((section) => section.id === entry.section)?.label ?? entry.section;

/** The label with the words searched for marked, as the list's results show them. */
function marked(label: string, query: string) {
  const words = query.trim();
  const at = words ? label.toLowerCase().indexOf(words.toLowerCase()) : -1;
  if (at === -1) return label;
  return (
    <>
      {label.slice(0, at)}
      <mark className="settings-search-mark">{label.slice(at, at + words.length)}</mark>
      {label.slice(at + words.length)}
    </>
  );
}

/**
 * The search over settings: a combobox whose list names each match and its section. Typing searches labels, hints
 * and the other words a setting is known by; Enter or a tap opens the section and brings the setting into view.
 * Ctrl K belongs to the app's one search (frame rule 4), which finds settings too.
 */
export function SettingsSearch({
  entries,
  onPick,
  autoFocus = false,
  className,
  variant = "popover",
  onQueryChange
}: Readonly<{
  entries: readonly SettingEntry[];
  onPick: (entry: SettingEntry) => void;
  autoFocus?: boolean;
  className?: string;
  /** "list": the matches fill Settings' list under the field, as its rows (settings spec 2.1); "popover" floats them. */
  variant?: "popover" | "list";
  /** Whether the field holds words, for the list to give way to the matches. */
  onQueryChange?: (query: string) => void;
}>) {
  const [query, setQueryState] = useState("");
  const setQuery = (next: string) => {
    setQueryState(next);
    onQueryChange?.(next);
  };
  const inList = variant === "list";
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const matches = useMemo(() => searchSettings(entries, query).slice(0, 8), [entries, query]);

  const pick = (entry: SettingEntry) => {
    setQuery("");
    setOpen(false);
    setActive(0);
    onPick(entry);
  };
  // In the list the matches stay while the field holds words; a popover closes when the field loses focus.
  const showing = (inList || open) && query.trim() !== "";

  return (
    <div
      ref={box}
      className={cx("settings-search", className)}
      onBlur={(event) => {
        if (!box.current?.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <IconSearch className="settings-search-icon" />
      <Input
        ref={input}
        type="search"
        className="settings-search-input"
        role="combobox"
        aria-label="Search settings"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing && matches[active] ? `${listId}-${matches[active].id}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="Search settings"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, Math.max(0, matches.length - 1)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && matches[active]) {
            event.preventDefault();
            pick(matches[active]);
          } else if (event.key === "Escape") {
            if (inList) setQuery("");
            setOpen(false);
          }
        }}
      />
      {showing && (
        <div className={inList ? "settings-search-list scroll-y" : "settings-search-results anim-popover"}>
          {matches.length === 0 ? (
            <p className="settings-search-empty" role="status">
              No setting matches "{query.trim()}".
            </p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Matching settings">
              {matches.map((entry, index) => (
                <li
                  key={entry.id}
                  id={`${listId}-${entry.id}`}
                  role="option"
                  aria-selected={index === active}
                  className={cx("settings-search-option", index === active && "is-active")}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(entry)}
                >
                  <span className="settings-search-label">{inList ? marked(entry.label, query) : entry.label}</span>
                  <span className="settings-search-section">{sectionLabel(entry)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { IconSearch, Input, Kbd, cx } from "@vtt/ui";
import { currentDevice, shortcutLabel } from "../lib/shortcut";
import { SETTINGS_SECTIONS, searchSettings, type SettingEntry } from "./sections";

const sectionLabel = (entry: SettingEntry) =>
  SETTINGS_SECTIONS.find((section) => section.id === entry.section)?.label ?? entry.section;

/**
 * The search over settings: a combobox whose list names each match and its section. Typing searches labels, hints
 * and the other words a setting is known by; Enter or a tap opens the section and brings the setting into view.
 * Ctrl K (Command K on a Mac) focuses it from anywhere on the page.
 */
export function SettingsSearch({
  entries,
  onPick,
  autoFocus = false,
  className
}: Readonly<{
  entries: readonly SettingEntry[];
  onPick: (entry: SettingEntry) => void;
  autoFocus?: boolean;
  className?: string;
}>) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const shortcut = useMemo(() => shortcutLabel("K", currentDevice()), []);
  const matches = useMemo(() => searchSettings(entries, query).slice(0, 8), [entries, query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = (entry: SettingEntry) => {
    setQuery("");
    setOpen(false);
    setActive(0);
    onPick(entry);
  };
  const showing = open && query.trim() !== "";

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
        aria-keyshortcuts="Control+K Meta+K"
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
            setOpen(false);
          }
        }}
      />
      {shortcut && !query && <Kbd className="settings-search-kbd">{shortcut}</Kbd>}
      {showing && (
        <div className="settings-search-results anim-popover">
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
                  <span className="settings-search-label">{entry.label}</span>
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

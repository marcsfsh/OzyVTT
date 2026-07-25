import { useMemo, useRef, useState } from "react";
import { Input } from "@vtt/ui";
import { entityIcon, type EntityType } from "./entities";

type Pickable = Readonly<{ id: string; title: string; entityType: EntityType }>;

/**
 * A type-to-filter entity chooser. A flat <select> of every page is unusable past a handful of entities;
 * this shows the picked entity as a removable chip and, when empty, a search box that filters by title
 * (with type icons, arrow-key + Enter selection). Used wherever the GM links one entity to another
 * (relationships, journal pins, map markers).
 */
export function EntityPicker({ pages, value, onChange, placeholder = "Search entities…", ariaLabel, id }: Readonly<{
  pages: readonly Pickable[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
}>) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const selected = pages.find((page) => page.id === value) ?? null;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (needle ? pages.filter((page) => page.title.toLowerCase().includes(needle)) : pages).slice(0, 8);
  }, [pages, query]);

  const pick = (pageId: string) => { onChange(pageId); setQuery(""); setOpen(false); setActive(0); };

  if (selected) {
    return (
      <div className="codex-picker">
        <span className="codex-picker-chip">
          <span aria-hidden="true">{entityIcon(selected.entityType)}</span> {selected.title}
          <button type="button" className="codex-picker-x" aria-label={`Clear ${selected.title}`} onClick={() => onChange(null)}>✕</button>
        </span>
      </div>
    );
  }

  return (
    <div className="codex-picker" ref={boxRef} onBlur={(event) => { if (!boxRef.current?.contains(event.relatedTarget as Node)) setOpen(false); }}>
      <Input id={id} aria-label={ariaLabel} value={query} placeholder={placeholder} autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)); }
          else if (event.key === "ArrowUp") { event.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (event.key === "Enter" && matches[active]) { event.preventDefault(); pick(matches[active].id); }
          else if (event.key === "Escape") { setOpen(false); }
        }} />
      {open && matches.length > 0 && (
        <ul className="codex-picker-menu" role="listbox">
          {matches.map((page, index) => (
            <li key={page.id}>
              <button type="button" role="option" aria-selected={index === active} className={`codex-picker-opt${index === active ? " is-active" : ""}`}
                onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => pick(page.id)}>
                <span aria-hidden="true">{entityIcon(page.entityType)}</span> <span className="codex-picker-opt-title">{page.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

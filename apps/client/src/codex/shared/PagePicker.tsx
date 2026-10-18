import { useEffect, useId, useMemo, useRef, useState } from "react";
import { IconChevron, cx } from "@vtt/ui";
import type { CodexEntityType } from "@vtt/domain";
import { EntityIcon } from "../icons";
import { entityDef } from "../entities";
import "./shared.css";

export type PickablePage = Readonly<{ id: string; title: string; entityType: CodexEntityType }>;

/**
 * Choose one page: a box that names the choice ("Centre on Tidebound") and opens a search over the pages the reader
 * can open, each with its kind. The pages come from the caller, so a player's picker only ever lists what that
 * player's projection holds.
 */
export function PagePicker({
  label,
  pages,
  value,
  onChange,
  placeholder = "Choose a page",
  className
}: Readonly<{
  /** The words before the choice, which also name the control. */
  label: string;
  pages: readonly PickablePage[];
  value: string | null;
  onChange: (pageId: string) => void;
  placeholder?: string;
  className?: string;
}>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const chosen = pages.find((page) => page.id === value) ?? null;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sorted = [...pages].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    return (needle ? sorted.filter((page) => page.title.toLowerCase().includes(needle)) : sorted).slice(0, 40);
  }, [pages, query]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
  };
  const pick = (pageId: string) => {
    onChange(pageId);
    close();
    boxRef.current?.querySelector<HTMLElement>(".cx-picker-box")?.focus();
  };

  return (
    <div ref={boxRef} className={cx("cx-picker", className)}>
      <button
        type="button"
        className="cx-picker-box interactive"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${chosen?.title ?? placeholder}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="cx-picker-label">{label}</span>
        {chosen && <EntityIcon type={chosen.entityType} className="cx-picker-kind" />}
        <b className="cx-picker-value">{chosen?.title ?? placeholder}</b>
        <IconChevron className="cx-picker-caret" />
      </button>
      {open && (
        <div className="cx-picker-pop anim-popover">
          <input
            ref={inputRef}
            className="nh-input cx-picker-search"
            value={query}
            placeholder="Find a page"
            aria-label="Find a page"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={matches[active] ? `${listId}-${matches[active].id}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, matches.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (matches[active]) pick(matches[active].id);
              } else if (event.key === "Escape") {
                event.preventDefault();
                close();
                boxRef.current?.querySelector<HTMLElement>(".cx-picker-box")?.focus();
              }
            }}
          />
          <ul id={listId} className="cx-picker-list scroll-y" role="listbox" aria-label={label}>
            {matches.length === 0 && <li className="cx-picker-empty">No page has that name.</li>}
            {matches.map((page, index) => (
              <li
                key={page.id}
                id={`${listId}-${page.id}`}
                role="option"
                aria-selected={page.id === value}
                className={cx("cx-picker-option", index === active && "is-active")}
                onPointerEnter={() => setActive(index)}
                onClick={() => pick(page.id)}
              >
                <EntityIcon type={page.entityType} />
                <span className="cx-picker-title">{page.title}</span>
                <span className="cx-picker-meta">{entityDef(page.entityType).label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

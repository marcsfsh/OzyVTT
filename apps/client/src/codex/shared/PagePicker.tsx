import { useEffect, useId, useMemo, useRef, useState } from "react";
import { IconChevron, Input, Modal, cx } from "@vtt/ui";
import { useMediaQuery } from "../../lib/useMediaQuery";
import type { CodexEntityType } from "@vtt/domain";
import { EntityIcon } from "../icons";
import { entityDef } from "../entities";
import "../../shell/search-dialog.css";
import "./shared.css";

export type PickablePage = Readonly<{ id: string; title: string; entityType: CodexEntityType }>;

/** The chosen name with the typed part lit, as the search dialog lights it. */
function Lit({ name, query }: Readonly<{ name: string; query: string }>) {
  const needle = query.trim().toLowerCase();
  const at = needle ? name.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, at)}
      <mark className="search-dialog-lit">{name.slice(at, at + needle.length)}</mark>
      {name.slice(at + needle.length)}
    </>
  );
}

/**
 * Choose one page: a box that names the choice ("Centre on Tidebound") and opens A's search dialog in the Codex,
 * titled for what it links and offering only pages (F finding rule 3.2). The pages come from the caller, so a
 * player's picker only ever lists what that player's projection holds.
 */
export function PagePicker({
  label,
  pages,
  value,
  onChange,
  placeholder = "Choose a page",
  className
}: Readonly<{
  /** The words before the choice, which also name the control and title the dialog. */
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
  const boxRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  // The dialog focuses its first control as it opens; the field takes focus a frame later, as the search's does.
  useEffect(() => {
    if (open) requestAnimationFrame(() => fieldRef.current?.focus());
  }, [open]);
  const listId = useId();
  const phone = useMediaQuery("(max-width: 760px)");
  const chosen = pages.find((page) => page.id === value) ?? null;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sorted = [...pages].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    return (needle ? sorted.filter((page) => page.title.toLowerCase().includes(needle)) : sorted).slice(0, 40);
  }, [pages, query]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
    boxRef.current?.focus();
  };
  const pick = (pageId: string) => {
    onChange(pageId);
    close();
  };

  return (
    <div className={cx("cx-picker", className)}>
      <button
        ref={boxRef}
        type="button"
        className="cx-picker-box interactive"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${chosen?.title ?? placeholder}`}
        onClick={() => setOpen(true)}
      >
        <span className="cx-picker-label">{label}</span>
        {chosen && <EntityIcon type={chosen.entityType} className="cx-picker-kind" />}
        <b className="cx-picker-value">{chosen?.title ?? placeholder}</b>
        <IconChevron className="cx-picker-caret" />
      </button>
      {open && (
        <Modal
          open
          onClose={close}
          title={`Link a page to ${label}`}
          size={phone ? "full" : "md"}
          className={cx("search-dialog cx-picker-dialog", phone && "is-phone")}
          {...(phone ? {} : { align: "top" as const })}
        >
          <div className="search-dialog-field">
            <Input
              ref={fieldRef}
              autoFocus
              type="search"
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
                  // A search field's Escape would clear it first; here it closes, as the search dialog does.
                  event.preventDefault();
                  close();
                }
              }}
            />
            {phone && (
              <button type="button" className="search-dialog-cancel" onClick={close}>
                Cancel
              </button>
            )}
          </div>
          <ul id={listId} className="search-dialog-rows scroll-y" role="listbox" aria-label={label}>
            {matches.map((page, index) => (
              <li
                key={page.id}
                id={`${listId}-${page.id}`}
                role="option"
                aria-selected={page.id === value}
                className={cx("search-dialog-row cx-picker-option", index === active && "is-active")}
                onPointerEnter={() => setActive(index)}
                onClick={() => pick(page.id)}
              >
                <span className="search-dialog-name">
                  <EntityIcon type={page.entityType} />
                  <span>
                    <Lit name={page.title} query={query} />
                  </span>
                </span>
                <span className="search-dialog-line">{entityDef(page.entityType).label}</span>
              </li>
            ))}
          </ul>
          {matches.length === 0 && <p className="search-dialog-none">No page has that name.</p>}
        </Modal>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { IconButton, IconPage, IconSearch, Modal } from "@vtt/ui";
import { RulesReference } from "../reference/RulesReference";
import { navigate, withQuery, type Route } from "../router";

/** The addresses that own a search of their own; there the section's Ctrl K opens it, and the shell's stands down. */
const SCOPED_HEADS = new Set(["codex", "compendium", "scenes", "settings"]);
export const hasScopedSearch = (route: Pick<Route, "segments">) => SCOPED_HEADS.has(route.segments[0] ?? "");

type Door = Readonly<{ label: string; detail: string; onSelect: () => void }>;

/**
 * The top bar's search: a small launcher, since each section keeps its own search and its own authorization. Search the
 * Codex and Search the Compendium open that section's dialog through a one-shot `openSearch=1`; Rules opens the rules
 * reference; the rest are the sections. A player gets no Compendium door.
 */
export function SearchLauncher({
  role,
  route,
  sections
}: Readonly<{
  role: "gm" | "player";
  route: Route;
  /** The sections to list, in the bar's order. */
  sections: ReadonlyArray<Readonly<{ label: string; path: string }>>;
}>) {
  const [open, setOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const scoped = hasScopedSearch(route);
  // One Ctrl K for the page: a section with its own search keeps the key.
  useEffect(() => {
    if (scoped) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scoped]);

  const go = (path: string) => {
    setOpen(false);
    void navigate(path);
  };
  const doors: Door[] = [
    {
      label: "Search the Codex",
      detail: "Pages, people, places and quests",
      onSelect: () => go(withQuery("/codex", { openSearch: 1 }))
    },
    ...(role === "gm"
      ? [
          {
            label: "Search the Compendium",
            detail: "Monsters, spells, items and your homebrew",
            onSelect: () => go(withQuery("/compendium", { openSearch: 1 }))
          }
        ]
      : []),
    {
      label: "Rules",
      detail: "The rules reference",
      onSelect: () => {
        setOpen(false);
        setRulesOpen(true);
      }
    }
  ];

  return (
    <>
      <IconButton label="Search, Ctrl K" className="app-bar-icon" onClick={() => setOpen(true)}>
        <IconSearch />
      </IconButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Search" size="sm" align="top">
        <ul className="search-launcher" aria-label="Search">
          {doors.map((door) => (
            <li key={door.label}>
              <button type="button" className="search-launcher-row interactive" onClick={door.onSelect}>
                {door.label === "Rules" ? <IconPage /> : <IconSearch />}
                <span className="search-launcher-text">
                  <b>{door.label}</b>
                  <span>{door.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <h3 className="search-launcher-heading">Go to</h3>
        <ul className="search-launcher" aria-label="Go to">
          {sections.map((section) => (
            <li key={section.path}>
              <button type="button" className="search-launcher-row interactive" onClick={() => go(section.path)}>
                <span className="search-launcher-text">
                  <b>{section.label}</b>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>
      <RulesReference open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </>
  );
}

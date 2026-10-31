import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ContentGlossaryEntry } from "@vtt/domain";
import { Input, Modal, SegmentedControl, cx } from "@vtt/ui";
import { codexDestinations, pathForHit } from "../codex/routes";
import { searchHitKey, searchHitKindLabel, searchHitTitle } from "../codex/SearchResults";
import { clippedNote, runCodexAction, useCodexActions } from "../codex/CommandPalette";
import { useCodexCommands } from "../codex/codex-commands";
import { homebrewApi, type HomebrewSearch } from "../homebrew/api";
import { useTable } from "../compendium/data";
import { kindLabel, type Kind } from "../compendium/kinds";
import { recordPath } from "../compendium/routes";
import { loadGlossary, RulesReference } from "../reference/RulesReference";
import { navigate, prepPageFor, useRoute, type Route } from "../router";
import { pathForSection as settingsPath, searchSettings, settingsFor } from "../settings/sections";
import { useMediaQuery } from "../lib/useMediaQuery";
import { closeSearch, openSearch, requestNow, useSearchRequest, type SearchPlace } from "./search-store";
import "./search-dialog.css";

/** One row of the results: what it is, its name with the typed part lit, and what opening it does. */
export type SearchRow = Readonly<{ key: string; name: string; line: string; open: () => void }>;

const PLACE_LABEL: Readonly<Record<SearchPlace, string>> = {
  codex: "Codex",
  compendium: "Compendium",
  rules: "Rules",
  goto: "Go to"
};

/** What the field asks for at each place. */
const PLACE_FIELD: Readonly<Record<SearchPlace, string>> = {
  codex: "Search the Codex",
  compendium: "Search the Compendium",
  rules: "Search the rules",
  goto: "Go to a page or setting"
};

/** Where search starts (frame spec 2.3): the section you are in, the Compendium on Prep and Play for the GM, Rules on
 *  a player's Table and Sheet, Go to everywhere else. */
export function startingPlace(role: "gm" | "player", route: Route): SearchPlace {
  const head = route.segments[0] ?? "";
  if (head === "codex") return "codex";
  if (head === "compendium") return role === "gm" ? "compendium" : "goto";
  if (role === "gm" && (head === "table" || prepPageFor(route.path) !== null)) return "compendium";
  if (role === "player" && (head === "table" || head === "me")) return "rules";
  return "goto";
}

/** The Codex's own search for this role and token, then its commands: the player's search is `searchAsPlayer`, so
 *  they see what the Codex shows them today, and only the GM, with the Codex mounted, gets its creates. */
export function useCodexSearchRows(
  query: string,
  role: "gm" | "player",
  token: string
): Readonly<{ rows: SearchRow[]; note: string | null }> {
  const commands = useCodexCommands();
  const onNavigate = useCallback((path: string) => void navigate(path), []);
  const mine = role === "gm" ? commands : null;
  const { state, actions } = useCodexActions({
    query,
    token,
    player: role === "player",
    commands: mine,
    onNavigate,
    maxHits: 30
  });
  const rows = actions.map((action, index) => ({
    key: action.kind === "hit" ? searchHitKey(action.hit) : `${action.kind}-${index}`,
    name: action.kind === "hit" ? searchHitTitle(action.hit) : action.label,
    line:
      action.kind === "hit" ? searchHitKindLabel(action.hit) : action.kind === "goto" ? "Codex page" : "Codex command",
    open: () => runCodexAction(action, { commands: mine, onOpenHit: (hit) => onNavigate(pathForHit(hit)), onNavigate })
  }));
  const note =
    state.status === "error" ? state.message : state.status === "ready" && state.truncated ? clippedNote : null;
  return { rows, note };
}

/** A kind's word starts a row's line, where the kit's words are written for the middle of a sentence. */
const upperFirst = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** The Compendium's own search, the GM's alone: names in every kind's table, then homebrew text hits. */
export function useCompendiumSearchRows(query: string, token: string, enabled: boolean): SearchRow[] {
  const all = useTable(token, null, enabled);
  const [text, setText] = useState<HomebrewSearch["hits"]>([]);
  const needle = query.trim().toLowerCase();
  useEffect(() => {
    if (!enabled || !needle) {
      setText([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      homebrewApi.search(token, needle, { limit: 20 }).then(
        (answer) => live && setText(answer.hits),
        () => live && setText([])
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled, token, needle]);
  return useMemo(() => {
    if (!enabled || !needle) return [];
    const named = (all.data ?? [])
      .filter((row) => !row.archived && row.name.toLowerCase().includes(needle))
      .sort(
        (left, right) =>
          Number(!left.name.toLowerCase().startsWith(needle)) - Number(!right.name.toLowerCase().startsWith(needle)) ||
          left.name.localeCompare(right.name)
      )
      .slice(0, 30);
    const ids = new Set(named.map((row) => row.id));
    const inText = text.filter((hit) => !hit.archived && !ids.has(hit.id) && hit.matches.length > 0);
    return [
      ...named.map((row) => ({
        key: `${row.kind}:${row.id}`,
        name: row.name,
        line: upperFirst(kindLabel(row.kind as Kind)),
        open: () => navigate(recordPath(row.kind as Kind, row.id))
      })),
      ...inText.map((hit) => ({
        key: `${hit.kind}:${hit.id}:text`,
        name: hit.name,
        line: `${upperFirst(kindLabel(hit.kind as Kind))} · ${hit.matches[0]?.line ?? ""}`,
        open: () => navigate(recordPath(hit.kind as Kind, hit.id))
      }))
    ];
  }, [enabled, needle, all.data, text]);
}

/** The rules glossary, read once, its terms by name first and then by mention. */
export function useRulesRows(query: string, onOpen: (name: string) => void): SearchRow[] {
  const [entries, setEntries] = useState<readonly ContentGlossaryEntry[]>([]);
  useEffect(() => {
    void loadGlossary().then(
      (glossary) => setEntries(glossary.entries),
      () => setEntries([])
    );
  }, []);
  const needle = query.trim().toLowerCase();
  return useMemo(() => {
    const named = needle ? entries.filter((entry) => entry.name.toLowerCase().includes(needle)) : entries;
    const mentioned = needle
      ? entries.filter((entry) => !named.includes(entry) && entry.description.toLowerCase().includes(needle))
      : [];
    return [...named, ...mentioned].slice(0, 30).map((entry) => ({
      key: entry.id,
      name: entry.name,
      line: entry.tag ? `Rules · ${entry.tag}` : "Rules",
      open: () => onOpen(entry.name)
    }));
  }, [entries, needle, onOpen]);
}

/** The sections and pages the bars list for this role, the Codex's own places and the settings index. */
export function useGoToRows(
  query: string,
  role: "gm" | "player",
  sections: readonly Readonly<{ label: string; path: string }>[]
) {
  const needle = query.trim().toLowerCase();
  return useMemo(() => {
    const places = [
      ...sections,
      ...codexDestinations(role).map((item) => ({ label: `Codex · ${item.label}`, path: item.path }))
    ];
    const shown = places.filter((place) => !needle || place.label.toLowerCase().includes(needle));
    const settings = needle ? searchSettings(settingsFor(role), needle) : [];
    return [
      ...shown.map((place) => ({
        key: `${place.label}:${place.path}`,
        name: place.label,
        line: "Page",
        open: () => navigate(place.path)
      })),
      ...settings.slice(0, 12).map((entry) => ({
        key: `setting:${entry.id}`,
        name: entry.label,
        line: "Setting",
        open: () => navigate(settingsPath(entry.section))
      }))
    ];
  }, [needle, role, sections]);
}

/** The name with the typed part lit in --cyan-hi. */
function Lit({ name, query }: Readonly<{ name: string; query: string }>): ReactNode {
  const needle = query.trim().toLowerCase();
  const at = needle ? name.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return name;
  return (
    <>
      {name.slice(0, at)}
      <mark className="search-dialog-lit">{name.slice(at, at + needle.length)}</mark>
      {name.slice(at + needle.length)}
    </>
  );
}

/**
 * The one search (frame spec 2.3): a field and, under it, where to look (Codex, Compendium for the GM, Rules, Go to).
 * It starts on the section you are in, Tab or Ctrl and the arrows change the place, the arrows move through the rows,
 * Enter opens one and Escape closes. Each place asks that section's own search with the viewer's own token.
 */
export function SearchDialog({
  role,
  token,
  sections
}: Readonly<{
  role: "gm" | "player";
  token: string;
  sections: readonly Readonly<{ label: string; path: string }>[];
}>) {
  const request = useSearchRequest();
  const route = useRoute();
  // One Ctrl K (frame rule 3.4), bound once while someone is signed in: it opens the same search on every page, the
  // Codex included, and closes it again.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (requestNow().open) closeSearch();
        else openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const phone = useMediaQuery("(max-width: 760px)");
  const places: SearchPlace[] = role === "gm" ? ["codex", "compendium", "rules", "goto"] : ["codex", "rules", "goto"];
  const [place, setPlace] = useState<SearchPlace>("goto");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [rule, setRule] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!request.open) return;
    const wanted = request.place ?? startingPlace(role, route);
    setPlace(places.includes(wanted) ? wanted : "goto");
    setQuery("");
    setActive(0);
    // The dialog's own opening focuses its first control; the field is where typing goes. Closing gives focus back to
    // what opened it, the bar's search button or the page under Ctrl K.
    const opener = request.opener;
    requestAnimationFrame(() => field.current?.focus());
    return () => {
      if (opener?.isConnected) requestAnimationFrame(() => opener.focus());
    };
    // Each request starts afresh; the route at that moment chooses the place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.at, request.open]);
  const openRule = useCallback((name: string) => setRule(name), []);
  const codex = useCodexSearchRows(place === "codex" ? query : "", role, token);
  const compendium = useCompendiumSearchRows(query, token, role === "gm" && place === "compendium" && request.open);
  const rules = useRulesRows(place === "rules" ? query : "", openRule);
  const goto = useGoToRows(query, role, sections);
  const rows = place === "codex" ? codex.rows : place === "compendium" ? compendium : place === "rules" ? rules : goto;
  useEffect(() => setActive(0), [query, place]);

  const choose = (row: SearchRow | undefined) => {
    if (!row) return;
    closeSearch();
    row.open();
  };
  const step = (by: number) => {
    const at = places.indexOf(place);
    setPlace(places[(at + by + places.length) % places.length]!);
  };

  return (
    <>
      {request.open && (
        <Modal
          open
          onClose={closeSearch}
          title="Search"
          size={phone ? "full" : "md"}
          className={cx("search-dialog", phone && "is-phone")}
          {...(phone ? {} : { align: "top" as const })}
        >
          <div className="search-dialog-field">
            <Input
              ref={field}
              type="search"
              aria-label={PLACE_FIELD[place]}
              placeholder={PLACE_FIELD[place]}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive((current) => Math.min(rows.length - 1, current + 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((current) => Math.max(0, current - 1));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  choose(rows[active]);
                } else if (event.key === "Escape") {
                  // The dialog's own cancel closes it too; this keeps a field's Escape from clearing it first.
                  event.preventDefault();
                  closeSearch();
                } else if (event.key === "Tab" && !event.shiftKey) {
                  event.preventDefault();
                  step(1);
                } else if (event.ctrlKey && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
                  event.preventDefault();
                  step(event.key === "ArrowRight" ? 1 : -1);
                }
              }}
            />
            {phone && (
              <button type="button" className="search-dialog-cancel" onClick={closeSearch}>
                Cancel
              </button>
            )}
          </div>
          <SegmentedControl
            ariaLabel="Where to look"
            className="search-dialog-places"
            value={place}
            onChange={(next) => {
              setPlace(next as SearchPlace);
              field.current?.focus();
            }}
            options={places.map((value) => ({ value, label: PLACE_LABEL[value] }))}
          />
          <ul className="search-dialog-rows scroll-y" role="listbox" aria-label={`${PLACE_LABEL[place]} results`}>
            {rows.map((row, index) => (
              <li key={row.key} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  className={cx("search-dialog-row", index === active && "is-active")}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(row)}
                >
                  <span className="search-dialog-name">
                    <Lit name={row.name} query={query} />
                  </span>
                  <span className="search-dialog-line">{row.line}</span>
                </button>
              </li>
            ))}
          </ul>
          {place === "codex" && codex.note && <p className="search-dialog-none">{codex.note}</p>}
          {query.trim() && rows.length === 0 && <p className="search-dialog-none">Nothing here matches.</p>}
        </Modal>
      )}
      {rule !== null && <RulesReference open onClose={() => setRule(null)} entry={rule} />}
    </>
  );
}

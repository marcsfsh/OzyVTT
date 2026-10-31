import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Modal, Skeleton } from "@vtt/ui";
import { SEARCH_HIT_CAP } from "./api";
import { findApi } from "./api-records";
import { SearchResultRow, searchHitKey, useCodexSearch, type AnySearchHit, type SearchState } from "./SearchResults";
import { codexDestinations, pathForSection } from "./routes";
import type { CodexCommands } from "./codex-commands";
import { withQuery } from "../router";

/**
 * The Codex's search and commands: jump to a record, go to a section, or create. The one search shows these as its
 * Codex place (frame spec 2.3); the GM's See as players preview keeps them in its own small palette, because it
 * searches as the player it shows. Create verbs run the same creates as the rails and open the new record; the
 * "Log ..." verbs navigate to the form that composes the record.
 */

export type CodexAction =
  | Readonly<{ kind: "hit"; hit: AnySearchHit }>
  | Readonly<{ kind: "create"; label: string; title: string }>
  | Readonly<{ kind: "verb"; label: string; run: () => void }>
  | Readonly<{ kind: "goto"; label: string; path: string }>;

/** The search for this audience and the actions after it. `commands` is null for a player, who writes nothing, and
 *  for the GM away from the Codex, whose creates live in the Codex. */
export function useCodexActions({
  query,
  token,
  player,
  commands,
  onNavigate,
  maxHits
}: Readonly<{
  query: string;
  token: string;
  player: boolean;
  commands: CodexCommands | null;
  onNavigate: (path: string) => void;
  maxHits: number;
}>): Readonly<{ state: SearchState; actions: CodexAction[] }> {
  const runSearch = useCallback(
    (text: string) => (player ? findApi.searchAsPlayer(token, { q: text }) : findApi.search(token, { q: text })),
    [token, player]
  );
  const state = useCodexSearch(query, runSearch);

  /** Every place the shell can open for this role, from the table the shell reads. */
  const gotoVerbs = useMemo<CodexAction[]>(
    () =>
      codexDestinations(player ? "player" : "gm").map((item) => ({
        kind: "goto" as const,
        label: `Go to ${item.label}`,
        path: item.path
      })),
    [player]
  );

  const actions = useMemo<CodexAction[]>(() => {
    const trimmed = query.trim();
    const hits = state.status === "ready" ? state.hits.slice(0, maxHits) : [];
    const list: CodexAction[] = hits.map((hit) => ({ kind: "hit" as const, hit }));
    // Offer "new page" unless a page with exactly this title came back.
    if (
      trimmed &&
      commands &&
      !hits.some((hit) => hit.kind === "page" && hit.title.toLowerCase() === trimmed.toLowerCase())
    ) {
      list.push({ kind: "create", label: `New page "${trimmed}"`, title: trimmed });
    }
    if (!trimmed) {
      if (commands) {
        list.push(
          { kind: "create", label: "New page…", title: "" },
          // These two create; the "Log ..." rows below navigate to a form.
          { kind: "verb", label: "New session", run: commands.createSession },
          { kind: "verb", label: "New quest", run: commands.createQuest },
          { kind: "verb", label: "Log a journal entry", run: () => onNavigate(pathForSection("story")) },
          {
            kind: "verb",
            label: "Log downtime",
            run: () => onNavigate(withQuery(pathForSection("story"), { kind: "downtime" }))
          }
        );
      }
      list.push(...gotoVerbs);
    }
    return list;
  }, [state, query, gotoVerbs, commands, onNavigate, maxHits]);

  return { state, actions };
}

/** Runs one action: opens the hit, starts the create, runs the verb or goes to the place. */
export function runCodexAction(
  action: CodexAction,
  {
    commands,
    onOpenHit,
    onNavigate
  }: Readonly<{
    commands: CodexCommands | null;
    onOpenHit: (hit: AnySearchHit) => void;
    onNavigate: (path: string) => void;
  }>
) {
  if (action.kind === "hit") onOpenHit(action.hit);
  else if (action.kind === "create") commands?.createPage(action.title);
  else if (action.kind === "verb") action.run();
  else onNavigate(action.path);
}

/** What the one search says under a clipped list. */
export const clippedNote = `Showing the first ${SEARCH_HIT_CAP} matches. Narrow the search.`;

/** The full result list lives in Search. */
const MAX_HITS = 8;

/** The See as players preview's palette: the player's search and Go to verbs, as the previewed player. */
export function CommandPalette({
  token,
  onOpenHit,
  onNavigate,
  onClose
}: Readonly<{
  token: string;
  onOpenHit: (hit: AnySearchHit) => void;
  onNavigate: (path: string) => void;
  onClose: () => void;
}>) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const { state, actions } = useCodexActions({
    query,
    token,
    player: true,
    commands: null,
    onNavigate,
    maxHits: MAX_HITS
  });

  useEffect(() => {
    setActive(0);
  }, [query]);

  const run = (action: CodexAction | undefined) => {
    if (!action) return;
    runCodexAction(action, { commands: null, onOpenHit, onNavigate });
    onClose();
  };

  return (
    <Modal open onClose={onClose} size="sm" align="top" ariaLabel="Search the preview" className="codex-palette-modal">
      <input
        ref={inputRef}
        className="nh-input codex-palette-input"
        value={query}
        placeholder="Search pages, entries, maps, pins, quests and sessions"
        aria-label="Search the Codex"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, actions.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            run(actions[active]);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <ul className="codex-palette-list scroll-y">
        {state.status === "loading" && (
          <li className="codex-palette-loading">
            {[0, 1].map((row) => (
              <Skeleton key={row} variant="text" />
            ))}
          </li>
        )}
        {state.status === "error" && (
          <li>
            <Alert tone="danger" title="Search failed">
              {state.message}
            </Alert>
          </li>
        )}
        {actions.length === 0 && state.status === "ready" && <li className="codex-palette-empty">No matches.</li>}
        {actions.map((action, index) => (
          <li key={action.kind === "hit" ? searchHitKey(action.hit) : `${action.kind}-${index}`}>
            {action.kind === "hit" ? (
              <SearchResultRow
                hit={action.hit}
                active={index === active}
                onOpen={() => run(action)}
                onHover={() => setActive(index)}
              />
            ) : (
              <button
                type="button"
                className={`codex-palette-item is-action${index === active ? " is-active" : ""}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => run(action)}
              >
                {action.label}
              </button>
            )}
          </li>
        ))}
        {state.status === "ready" && state.truncated && <li className="codex-search-truncated">{clippedNote}</li>}
      </ul>
    </Modal>
  );
}

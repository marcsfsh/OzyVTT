import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Skeleton } from "@vtt/ui";
import { socket } from "../socket";
import { atlasApi, codexApi, journalApi, questApi, revealAuditApi, sessionApi, standingApi, type CodexRevealAudit, type CodexRevealAuditKind, type CodexRevealAuditSection } from "./api";
import { CHRONICLE_KIND_META } from "./chronicle";
import { CodexIcon } from "./icons";

/**
 * M12 / CT-9 — the reveal audit: **one surface answering "what can the players see right now?"**
 *
 * Three things it is NOT, each of them a hard line:
 *
 *  1. **Not a second source of truth.** Every row came from the server's read-only aggregation, which
 *     decides membership by running the **player projections** — the audit reports what a player would
 *     genuinely receive, proven by the same code path that serves them. This file adds no predicate of
 *     its own: there is no `revealed === true` anywhere below, and there must never be. That distinction
 *     is the point of the screen rather than a nicety, because two kinds are not player-visible even with
 *     their own flag set — a revealed pin on a hidden map, and a revealed standing whose faction page is
 *     still secret — and an audit built on the flags alone would tell the GM their players can see things
 *     the players demonstrably cannot.
 *  2. **Not a writer of anything new.** Un-revealing goes back out through each record type's OWN reveal
 *     route, the same one its editor uses. There is no unreveal route and no bulk operation; "hide
 *     everything" is not a button, because a GM who hid the campaign by accident could not put it back.
 *  3. **Not the table's visibility system (M12-A).** Codex records only — no tokens, no fog, no shared
 *     viewer. Those have different rules, and folding them in would make this the second place that
 *     decides what a player can see.
 *
 * It is a DESTINATION laid over the content region, like the session and quest logs and for the same
 * reason: the five mode tabs already overflow a 375px strip. It is reached from the ops row beside
 * Import / Export / Preview as player, which is where the GM's other "about the whole codex" actions are.
 */

/**
 * How each kind presents, and which existing route hides one. **The only per-kind knowledge on this
 * surface** — everything else about a row (its title, whether it belongs here at all) is the server's.
 *
 * The order is the order a GM thinks about them: the world, then the map, then what happened, then the
 * campaign's own records. A kind the server sends that is missing here would be a programming error the
 * `KIND_ORDER` walk below surfaces rather than silently dropping.
 */
const AUDIT_KINDS: Readonly<Record<CodexRevealAuditKind, Readonly<{
  heading: string;
  iconId: string;
  /** What "nothing here" means for this kind, in that kind's own words. */
  emptyLabel: string;
  hide: (token: string, id: string) => Promise<unknown>;
  hideLabel: (title: string) => string;
}>>> = {
  page: {
    heading: "Pages", iconId: "scroll", emptyLabel: "No pages are shown to players.",
    hide: (token, id) => codexApi.revealPage(token, id, false),
    hideLabel: (title) => `Hide the page ${title} from players`
  },
  map: {
    heading: "Maps", iconId: "compass", emptyLabel: "No maps are shown to players.",
    hide: (token, id) => atlasApi.revealMap(token, id, false),
    hideLabel: (title) => `Hide the map ${title} from players`
  },
  marker: {
    heading: "Map pins", iconId: "pin", emptyLabel: "No map pins are shown to players.",
    hide: (token, id) => atlasApi.revealMarker(token, id, false),
    hideLabel: (title) => `Hide the pin ${title} from players`
  },
  journal: {
    // One journal table, six kinds — notes, battles, deadlines, downtime, and M12's milestones and
    // standing changes — so this section is named for the timeline they all live on rather than for
    // any one of them.
    heading: "Chronicle records", iconId: "hourglass",
    emptyLabel: "No journal entries, deadlines, downtime, milestones or standing changes are shown to players.",
    hide: (token, id) => journalApi.reveal(token, id, false),
    hideLabel: (title) => `Hide the record ${title} from players`
  },
  session: {
    heading: "Session recaps", iconId: "campfire", emptyLabel: "No session recaps are shown to players.",
    hide: (token, id) => sessionApi.reveal(token, id, false),
    hideLabel: (title) => `Hide the recap for ${title} from players`
  },
  quest: {
    heading: "Quests", iconId: "quest", emptyLabel: "No quests are shown to players.",
    hide: (token, id) => questApi.reveal(token, id, false),
    hideLabel: (title) => `Hide the quest ${title} from players`
  },
  standing: {
    heading: "Faction standing", iconId: CHRONICLE_KIND_META.standing.iconId,
    emptyLabel: "No faction standing is shown to players.",
    // A standing row is addressed by its FACTION PAGE id, which is what its reveal route takes and what
    // the audit puts in `row.id` — the standing row's own id is not an address anything here can use.
    hide: (token, factionPageId) => standingApi.reveal(token, factionPageId, false),
    hideLabel: (title) => `Hide the standing with ${title} from players`
  }
};
const KIND_ORDER = Object.keys(AUDIT_KINDS) as readonly CodexRevealAuditKind[];

export function RevealAudit({ gmToken, onClose }: Readonly<{ gmToken: string; onClose: () => void }>) {
  const [audit, setAudit] = useState<CodexRevealAudit | null>(null);
  // CF-2 at the level of the whole surface: before the first read settles, "nothing is revealed" is not
  // a claim this screen is entitled to make.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setAudit(await revealAuditApi.get(gmToken)); setError(null); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Couldn't read what players can see."); }
    finally { setLoading(false); }
  }, [gmToken]);

  useEffect(() => { void load(); }, [load]);
  // Any codex write pings every client, and un-revealing from an editor elsewhere has to reach this list
  // — an audit that went stale the moment something changed would be the least trustworthy screen here.
  useEffect(() => { const onChanged = () => { void load(); }; socket.on("codex:changed", onChanged); return () => { socket.off("codex:changed", onChanged); }; }, [load]);

  const hide = async (kind: CodexRevealAuditKind, id: string) => {
    setBusyId(`${kind}:${id}`);
    setError(null);
    try { await AUDIT_KINDS[kind].hide(gmToken, id); await load(); }
    catch (hideError) { setError(hideError instanceof Error ? hideError.message : "Couldn't hide that from players."); }
    finally { setBusyId(null); }
  };

  /**
   * All seven kinds, in this file's order, each resolved against what the server actually sent.
   *
   * `undefined` is a section the answer did NOT contain, and it is kept distinct from an empty one all
   * the way to the screen: the contract says all seven are always present, so an absent one is a
   * malformed answer rather than an empty category — and "the players cannot see any maps" and "I could
   * not find out about maps" are opposite answers a GM acts on differently (the CF-2 lesson).
   */
  const sections: ReadonlyArray<Readonly<{ kind: CodexRevealAuditKind; section: CodexRevealAuditSection | undefined }>> =
    KIND_ORDER.map((kind) => ({ kind, section: audit?.sections.find((candidate) => candidate.kind === kind) }));
  const missing = audit ? sections.filter((entry) => entry.section === undefined) : [];
  /**
   * The SERVER's whole-codex figure, not a sum of the sections. The two agree while every section is
   * present — but this surface exists to survive an answer with sections missing (see `missing` above), and
   * in exactly that case a sum silently under-counts where the server's number is still right. The comment
   * below used to call the sum "the server's own count"; it was the client's.
   */
  const revealed = audit?.revealed ?? 0;

  return (
    <>
      {/* The way out, ABOVE the content — the session and quest logs' exit row verbatim. §4: `Button
          size="sm"` is a `@vtt/ui` primitive and carries the 44px floor itself; the wrapper is layout. */}
      <div className="codex-sessions-exit"><Button variant="ghost" size="sm" onClick={onClose}>‹ Back to the Codex</Button></div>
      <div className="codex-audit">
        <header className="codex-audit-head">
          <h3 className="codex-audit-title">Everything shared with players</h3>
          {/* The server's own count, taken whole. It is what a player would genuinely RECEIVE, not how many
              records have their reveal flag set — the two differ for a pin on a hidden map and for a
              standing whose faction is still secret, and this screen exists to report the former. */}
          {!loading && <p className="codex-audit-count">{revealed} {revealed === 1 ? "record is" : "records are"} shown to players across the Codex.</p>}
          <p className="codex-audit-scope">Codex records only. Tokens, fog and the shared table view have their own visibility and are not listed here.</p>
        </header>

        {error && <Alert tone="danger" title="Couldn't read what players can see">{error}</Alert>}
        {/* A kind the answer did not carry is called out ONCE at the top and again in place below. An
            audit with a silent hole in it is worse than no audit — the GM would read "nothing revealed"
            for a category nobody actually answered. */}
        {missing.length > 0 && (
          <Alert tone="warning" title="This audit is incomplete">
            Couldn't read: {missing.map((entry) => AUDIT_KINDS[entry.kind].heading.toLowerCase()).join(", ")}. Those records may still be shown to players.
          </Alert>
        )}

        {loading && <div className="codex-list-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>}

        {!loading && sections.map(({ kind, section }) => {
          const meta = AUDIT_KINDS[kind];
          return (
            <section key={kind} className="codex-audit-section">
              <h4 className="codex-audit-h">
                <CodexIcon iconId={meta.iconId} className="codex-ent-icon codex-audit-glyph" />
                {meta.heading}
                {/* Which of the three states this kind is in, in words, before a single row is read —
                    and for a real section, how much of what EXISTS is shared, which is the question a
                    GM is actually asking when they open this screen. */}
                <span className="codex-audit-sectioncount">{section ? `${section.revealed} of ${section.total} shared` : "not read"}</span>
              </h4>
              {!section
                ? <p className="codex-list-empty">This didn't load, so nothing here can be trusted. Reopen the audit to try again.</p>
                : section.rows.length === 0
                ? <p className="codex-list-empty">{meta.emptyLabel}</p>
                : (
                  <div className="codex-audit-rows">
                    {section.rows.map((row) => (
                      /* §4 ROUTE 1 throughout this stack, and it is not a preference here: the audit is a
                         long vertical list of rows that each carry an action, which is precisely the case
                         where a `::after` hit box overhangs into the neighbouring row and steals its tap.
                         `.codex-audit-row` carries `min-height`, and the button inside it is `Button` at
                         its DEFAULT size — 44px of real paint and no `::after` at all. */
                      <div key={`${kind}:${row.id}`} className="codex-audit-row">
                        <span className="codex-list-title">{row.title}</span>
                        <Button variant="ghost" disabled={busyId === `${kind}:${row.id}`}
                          aria-label={meta.hideLabel(row.title)} onClick={() => hide(kind, row.id)}>
                          {busyId === `${kind}:${row.id}` ? "Hiding…" : "Hide"}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
            </section>
          );
        })}
      </div>
    </>
  );
}

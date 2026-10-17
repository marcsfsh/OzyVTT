import { useCallback, useMemo, useState } from "react";
import { Alert, Badge, Button, Modal, RevealSwitch, Skeleton } from "@vtt/ui";
import type { CodexRevealAuditKind, CodexRevealAuditSection } from "@vtt/domain";
import { atlasApi, calendarApi, codexApi, journalApi, questApi, revealAuditApi, sessionApi, standingApi } from "./api";
import { CHRONICLE_KIND_META, chronicleKindOfJournal } from "./chronicle";
import { CodexIcon } from "./icons";
import { useCodexQuery } from "./useCodexQuery";

/**
 * The reveal audit: what can the players see right now? Every row comes from the server, which decides
 * membership by running the player projections, so this file adds no visibility predicate of its own (a
 * revealed pin on a hidden map is correctly absent). Changes go through each record's own reveal route;
 * there is no bulk operation. Codex records only: tokens and fog have their own rules.
 */

/** The only per-kind knowledge here: presentation and which existing reveal route each kind uses. */
const AUDIT_KINDS: Readonly<
  Record<
    CodexRevealAuditKind,
    Readonly<{
      heading: string;
      iconId: string;
      emptyLabel: string;
      /** Delegates to the kind's own reveal route. */
      setRevealed: (token: string, id: string, revealed: boolean) => Promise<unknown>;
      hideLabel: (title: string) => string;
    }>
  >
> = {
  date: {
    heading: "Campaign date",
    iconId: "calendar",
    emptyLabel: "No campaign date is shown to players.",
    // Showing it again publishes the GM's clock, the only way the players' date moves.
    setRevealed: (token, _id, revealed) => (revealed ? calendarApi.publish(token) : calendarApi.unpublish(token)),
    hideLabel: (title) => `Show the date ${title} to players`
  },
  page: {
    heading: "Pages",
    iconId: "scroll",
    emptyLabel: "No pages are shown to players.",
    setRevealed: (token, id, revealed) => codexApi.revealPage(token, id, revealed),
    hideLabel: (title) => `Show the page ${title} to players`
  },
  map: {
    heading: "Maps",
    iconId: "compass",
    emptyLabel: "No maps are shown to players.",
    setRevealed: (token, id, revealed) => atlasApi.revealMap(token, id, revealed),
    hideLabel: (title) => `Show the map ${title} to players`
  },
  marker: {
    heading: "Map pins",
    iconId: "pin",
    emptyLabel: "No map pins are shown to players.",
    setRevealed: (token, id, revealed) => atlasApi.revealMarker(token, id, revealed),
    hideLabel: (title) => `Show the pin ${title} to players`
  },
  journal: {
    // One journal table carries several kinds, so the section is named for the Journal.
    heading: "Journal entries",
    iconId: "hourglass",
    emptyLabel: "No journal entries, deadlines, downtime, milestones or standing changes are shown to players.",
    setRevealed: (token, id, revealed) => journalApi.reveal(token, id, revealed),
    hideLabel: (title) => `Show the entry ${title} to players`
  },
  session: {
    heading: "Session recaps",
    iconId: "campfire",
    emptyLabel: "No session recaps are shown to players.",
    setRevealed: (token, id, revealed) => sessionApi.reveal(token, id, revealed),
    hideLabel: (title) => `Show the recap for ${title} to players`
  },
  quest: {
    heading: "Quests",
    iconId: "quest",
    emptyLabel: "No quests are shown to players.",
    setRevealed: (token, id, revealed) => questApi.reveal(token, id, revealed),
    hideLabel: (title) => `Show the quest ${title} to players`
  },
  standing: {
    heading: "Faction standing",
    iconId: CHRONICLE_KIND_META.standing.iconId,
    emptyLabel: "No faction standing is shown to players.",
    // Addressed by the faction page id, which is what the reveal route takes and what `row.id` holds.
    setRevealed: (token, factionPageId, revealed) => standingApi.reveal(token, factionPageId, revealed),
    hideLabel: (title) => `Show standing with ${title} to players`
  }
};
const KIND_ORDER = Object.keys(AUDIT_KINDS) as readonly CodexRevealAuditKind[];

export function RevealAudit({ gmToken }: Readonly<{ gmToken: string }>) {
  // Edits elsewhere must reach this list; a stale audit is worse than none. Until the first read settles,
  // "nothing is revealed" isn't a claim this screen can make.
  const {
    data: audit,
    loading,
    error: loadError,
    reload
  } = useCodexQuery(
    useCallback(() => revealAuditApi.get(gmToken), [gmToken]),
    { failure: "Couldn't read what players can see." }
  );
  const [writeError, setWriteError] = useState<string | null>(null);
  const error = writeError ?? loadError;
  const [pendingFaction, setPendingFaction] = useState<{ id: string; title: string } | null>(null);

  /**
   * Flipping a row off keeps it rendered (dimmed) until the refetch settles, so flipping it back on is
   * the undo.
   */
  const [justHidden, setJustHidden] = useState<ReadonlySet<string>>(new Set());
  const setRevealed = async (kind: CodexRevealAuditKind, id: string, title: string, revealed: boolean) => {
    const key = `${kind}:${id}`;
    setWriteError(null);
    try {
      await AUDIT_KINDS[kind].setRevealed(gmToken, id, revealed);
      setJustHidden((prev) => {
        const next = new Set(prev);
        if (revealed) next.delete(key);
        else next.add(key);
        return next;
      });
      setAnnouncement(
        revealed ? `${title} is shown to players again.` : `${title} is hidden from players. Flip to undo.`
      );
      await reload();
    } catch (failure) {
      setWriteError(failure instanceof Error ? failure.message : "Couldn't change who can see that.");
    }
  };
  const [announcement, setAnnouncement] = useState("");

  /**
   * Hiding a faction page also hides the party's standing with it. A standing row's `id` is its faction
   * page id, so the warning fires when a page row's id is among these.
   */
  const standingFactionIds = useMemo(
    () => new Set((audit?.sections.find((section) => section.kind === "standing")?.rows ?? []).map((row) => row.id)),
    [audit]
  );

  /**
   * Every kind, resolved against what the server sent. `undefined` (missing from the answer) stays distinct
   * from empty all the way to the screen: "players see no maps" and "couldn't read maps" are different answers.
   */
  const sections: ReadonlyArray<
    Readonly<{ kind: CodexRevealAuditKind; section: CodexRevealAuditSection | undefined }>
  > = KIND_ORDER.map((kind) => ({ kind, section: audit?.sections.find((candidate) => candidate.kind === kind) }));
  const missing = audit ? sections.filter((entry) => entry.section === undefined) : [];
  /** The server's total; a sum of sections would under-count when one is missing. */
  const revealed = audit?.revealed ?? 0;

  return (
    <>
      <div className="codex-audit">
        <header className="codex-audit-head">
          <h3 className="codex-audit-title">Everything shared with players</h3>
          {/* What players actually receive, which can differ from how many reveal flags are set. */}
          {!loading && (
            <p className="codex-audit-count">
              {revealed} {revealed === 1 ? "record is" : "records are"} shown to players across the Codex.
            </p>
          )}
          <p className="codex-audit-scope">
            Codex records only. Tokens, fog and the shared table view have their own visibility and are not listed here.
          </p>
        </header>

        {error && (
          <Alert tone="danger" title="Couldn't read what players can see">
            {error}
          </Alert>
        )}
        {/* Announces the undo to screen readers. */}
        <span className="nh-sr-only" role="status">
          {announcement}
        </span>
        {/* A missing kind is called out here and again in place, so no hole reads as "nothing revealed". */}
        {missing.length > 0 && (
          <Alert tone="warning" title="This audit is incomplete">
            Couldn't read: {missing.map((entry) => AUDIT_KINDS[entry.kind].heading.toLowerCase()).join(", ")}. Those
            records may still be shown to players.
          </Alert>
        )}

        {loading && (
          <div className="codex-list-loading">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} variant="text" />
            ))}
          </div>
        )}

        {!loading &&
          sections.map(({ kind, section }) => {
            const meta = AUDIT_KINDS[kind];
            return (
              <section key={kind} className="codex-audit-section">
                <h4 className="codex-audit-h">
                  <CodexIcon iconId={meta.iconId} className="codex-ent-icon codex-audit-glyph" />
                  {meta.heading}
                  {/* Shared count, or "not read" when the section is missing. */}
                  <span className="codex-audit-sectioncount">
                    {section ? `${section.revealed} of ${section.total} shared` : "not read"}
                  </span>
                </h4>
                {!section ? (
                  <p className="codex-list-empty">
                    This didn't load, so nothing here can be trusted. Reopen the audit to try again.
                  </p>
                ) : section.rows.length === 0 ? (
                  <p className="codex-list-empty">{meta.emptyLabel}</p>
                ) : (
                  <div className="codex-audit-rows">
                    {section.rows.map((row) => (
                      /* 44px rows with default-size controls: no ::after hit areas in this long stack. */
                      <div
                        key={`${kind}:${row.id}`}
                        className={`codex-audit-row${justHidden.has(`${kind}:${row.id}`) ? " is-hidden" : ""}`}
                      >
                        {/* Journal rows show their kind as a badge from the chronicle's vocabulary; `title` is the
                            record's prose and can't identify a deadline. */}
                        {row.journalKind &&
                          (() => {
                            const journalMeta = CHRONICLE_KIND_META[chronicleKindOfJournal(row.journalKind)];
                            return <Badge tone={journalMeta.tone}>{journalMeta.label}</Badge>;
                          })()}
                        <span className="codex-list-title">{row.title}</span>
                        <RevealSwitch
                          revealed={!justHidden.has(`${kind}:${row.id}`)}
                          ariaLabel={meta.hideLabel(row.title)}
                          onChange={(next) => {
                            if (!next && kind === "page" && standingFactionIds.has(row.id)) {
                              setPendingFaction({ id: row.id, title: row.title });
                              return;
                            }
                            void setRevealed(kind, row.id, row.title, next);
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
      </div>
      {/* Warn before hiding a faction page also hides its standing. */}
      {pendingFaction && (
        <Modal
          open
          onClose={() => setPendingFaction(null)}
          size="sm"
          title={`Hide ${pendingFaction.title} from players?`}
          ariaLabel="Hide this faction page"
          footer={
            <>
              <Button variant="ghost" onClick={() => setPendingFaction(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const faction = pendingFaction;
                  setPendingFaction(null);
                  void setRevealed("page", faction.id, faction.title, false);
                }}
              >
                Hide page
              </Button>
            </>
          }
        >
          <p>
            Your standing with them stops being shown to players as well. A standing is only shown while its faction
            page is.
          </p>
        </Modal>
      )}
    </>
  );
}

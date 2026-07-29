import { useMemo } from "react";
import { Alert, Badge, Button, Checklist, Skeleton, type ChecklistItem } from "@vtt/ui";
import { CodexIcon, EntityIcon } from "./icons";
import { ENTITY_DEFS, ENTITY_TYPE_LIST, entityColor, type EntityType } from "./entities";
import { sessionTitle } from "./sessions";
import { openQuests, questProgress } from "./quests";
import { CHRONICLE_KIND_META, deadlineStateLabel, deadlineStateTone } from "./chronicle";
import type { CodexChronicleKind, CodexQuestStatus } from "./api";

/**
 * CI-7: the Codex's landing surface. Formerly `World`; renamed `Campaign` because it answers
 * "where is this campaign right now", not only "what is in this world" — and because Phase 4's
 * campaign records (sessions, quests, standing) land here rather than in a sixth mode (D-10).
 *
 * **Presentational on purpose.** Both audiences render this component, so it never fetches: the GM
 * workspace feeds it GM reads and the player Codex feeds it the server's PLAYER projections. A
 * component that chose its own endpoint would be one role check away from a leak; here there is
 * nothing to check, because a caller can only hand over what its own token already returned.
 *
 * Scope: the dashboard shows data that exists TODAY — entities by type, recent journal activity,
 * atlas presence, the current in-world date. Next session / open quests / deadlines / party position /
 * faction standing are named by CI-7 but their records are Phase 4 (M8–M12); no placeholder panel
 * stands in for a record that does not exist yet.
 */

/** The minimum an entity needs to appear here — satisfied by both the GM and player page summaries. */
type CampaignEntity = Readonly<{ id: string; title: string; entityType: EntityType; tags: readonly string[]; updatedAt: string; revealedToPlayers?: boolean }>;
/**
 * One journal row, in the shape BOTH projections can supply: a GM entry carries `playerText`/`gmText`
 * and a player entry carries a single already-projected `text`, so the caller flattens to this rather
 * than the dashboard branching on a role it should not know about.
 *
 * M11: `kind` is the CHRONICLE's kind, not the journal table's — the same vocabulary `CHRONICLE_KIND_META`
 * is keyed on, so this row's glyph and word come from the one place that defines them instead of being
 * restated here. Both callers now feed this from a chronicle record and pass the kind through untouched;
 * the point of widening it past `"note" | "combat"` is that a deadline or a downtime must not arrive here
 * disguised as a note — collapsing unknown kinds to a known one is exactly how a new kind renders as the
 * wrong record, which is the failure this milestone had to fix on the server side as well.
 */
export type CampaignEntry = Readonly<{ id: string; summary: string; when: string; kind: CodexChronicleKind }>;
/** One atlas row. `revealedToPlayers` is GM-only knowledge and is simply absent from a player's maps. */
export type CampaignMap = Readonly<{ id: string; name: string; revealedToPlayers?: boolean }>;
/**
 * M9's "Next session" card, in the shape BOTH projections can supply — which is exactly the player
 * projection's four keys (`projectPlayerSession`).
 *
 * **There is deliberately no `prep` field, not even an optional one.** `prepBody` is the single most
 * secret thing on a session record and has no player-facing form; a shared type that could carry it
 * would put the GM's plan one careless `{...session}` away from a component that both audiences render.
 * The type not having the field is the guarantee — a comment saying "don't pass prep" is not.
 *
 * `status` is absent for the same reason at lower stakes: it is GM-only for now, so a player caller
 * could not fill it in and the card must not read differently for the two audiences.
 */
export type CampaignSession = Readonly<{ id: string; sessionNumber: number | null; realDate: string | null; recap: string }>;
/**
 * M10's "Open quests" card, in the shape BOTH projections can supply — a strict subset of the player
 * projection (`projectPlayerQuest`), which is itself a strict subset of the GM row.
 *
 * **There is deliberately no `gmBody` field, not even an optional one**, and no `body` either. `gmBody`
 * is why a quest is two-layer at all — "where this is really going" — and it has no player-facing form;
 * a shared type that could carry it would put the GM's plan one careless `{...quest}` away from a
 * component that BOTH audiences render. The type not having the field is the guarantee; a comment saying
 * "don't pass gmBody" is not. (`CampaignSession` above makes exactly this promise about `prep`.)
 *
 * `status` IS here, and that is the one place this differs from `CampaignSession`, which drops a
 * session's status because it is GM-only. A quest's status is player-facing: "what is still open" is the
 * entire point of the card, and it is what `openQuests` filters on for both audiences alike.
 *
 * `objectives` is `ChecklistItem[]` — the very type the `@vtt/ui` primitive that renders them publishes,
 * so the dashboard's shape is tied to the control rather than restating it.
 */
export type CampaignQuest = Readonly<{ id: string; title: string; status: CodexQuestStatus; objectives: readonly ChecklistItem[] }>;
/**
 * M11's "Deadlines" card, in the shape BOTH projections can supply — every field here is on the player's
 * chronicle record as well as the GM's.
 *
 * `fired` is the SERVER's derivation, carried across rather than recomputed: whether the campaign has
 * passed a deadline is answered against the campaign clock, and the clock is not something this component
 * is handed. A dashboard that worked it out for itself would be a second authority on it, and the one
 * that could disagree with the timeline the card links into.
 *
 * **There is deliberately no `gmText` field**, exactly as `CampaignQuest` has no `gmBody` and
 * `CampaignSession` no `prep`: this component is rendered by the player's Codex too, and the type not
 * having the field is the guarantee.
 */
export type CampaignDeadline = Readonly<{ id: string; summary: string; when: string; fired: boolean }>;

export function CampaignHome({
  pages, entries = [], maps = [], today = null, session = null, quests = [], deadlines = [],
  onPickType, onPickTag, onOpenPage, onOpenEntry, onOpenMap, onOpenSession, onOpenQuest, onCreate,
  showReveal = true, loading = false, error = null
}: Readonly<{
  pages: readonly CampaignEntity[];
  /** Newest-first is the caller's job; this renders the first few as given. */
  entries?: readonly CampaignEntry[];
  maps?: readonly CampaignMap[];
  /** The world's "now", already formatted against the campaign calendar. Null when no date is set. */
  today?: string | null;
  /**
   * M9: which session the card is about — the GM's ACTIVE session, or for a player the nearest revealed
   * one. Choosing it is the caller's job (`pickNextSession`), because only the caller knows which
   * pointer its own token was sent; this component just renders what it was handed. Null renders nothing
   * at all rather than a placeholder, exactly as the dashboard's other sections do.
   */
  session?: CampaignSession | null;
  /**
   * M10: every quest the caller's own token was sent — GM rows mapped down, or the player's revealed
   * ones. This component picks the OPEN ones itself (`openQuests`), unlike `session` above: which
   * session is "next" depends on a pointer only a GM is sent, but "still open" is one predicate on a
   * field both audiences receive, so answering it twice at two call sites could only produce drift.
   */
  quests?: readonly CampaignQuest[];
  /**
   * M11 / CT-5: the deadlines the caller's own token was sent, ALREADY ordered — passed ones first, then
   * approaching — by `campaignDeadlines`. Ordering is the caller's job here rather than this component's
   * only because the caller is the one holding the chronicle records the rule reads; the rule itself
   * lives in `chronicle.ts` and is applied identically for both audiences.
   */
  deadlines?: readonly CampaignDeadline[];
  onPickType: (type: EntityType) => void;
  onPickTag: (tag: string) => void;
  onOpenPage: (pageId: string) => void;
  /** R1: lands on the Journal with THIS entry marked, not merely "the Journal, somewhere". */
  onOpenEntry: (entryId: string) => void;
  /** R1: opens the Atlas ON this map. */
  onOpenMap: (mapId: string) => void;
  /**
   * R1: opens the session log ON this session. Omitted by the player Codex, which has no session log to
   * open — the card is then the readout it already is for them, with nothing to tap.
   */
  onOpenSession?: (sessionId: string) => void;
  /**
   * R1: opens THIS quest — the GM's quest log, or the player's quest reader. Both audiences now supply
   * it, because both have somewhere for a quest to open; it stays optional so a caller without a
   * destination still renders a card (the row falls back to a readout rather than a button that
   * navigates nowhere). Still a capability flag, never a role check: this component cannot tell, and
   * must not be able to tell, which audience it is rendering for.
   */
  onOpenQuest?: (questId: string) => void;
  onCreate?: () => void;
  showReveal?: boolean;
  /** CF-2: true while the first fetch is in flight, so the "No entries yet" invitation cannot lie. */
  loading?: boolean;
  /** R4: this mode's own failure. The dashboard reads four feeds; a silent one would be a blank panel. */
  error?: string | null;
}>) {
  const byType = useMemo(() => {
    const counts = {} as Record<EntityType, number>;
    for (const page of pages) counts[page.entityType] = (counts[page.entityType] ?? 0) + 1;
    return counts;
  }, [pages]);
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const page of pages) for (const tag of page.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [pages]);
  const recent = useMemo(() => [...pages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10), [pages]);
  const revealed = useMemo(() => pages.filter((page) => page.revealedToPlayers).length, [pages]);
  const recentEntries = useMemo(() => entries.slice(0, 5), [entries]);
  /**
   * M10: the open quests, the same predicate for both audiences (`openQuests`). Sliced to five for the
   * same reason `recentEntries` is: this is a dashboard, and a campaign with thirty live threads must
   * not push every other section below the fold.
   *
   * Deliberately still OPEN-ONLY, for both audiences. "Open quests" must not keep offering a thread the
   * party can no longer pull, so a finished quest is not smuggled in here — it lives in the full list
   * behind `onOpenQuest` (the GM's quest log, the player's quest reader), which is where every quest is.
   */
  const openQuestList = useMemo(() => openQuests(quests).slice(0, 5), [quests]);
  /**
   * M11: the deadlines, already ordered by the caller (`campaignDeadlines`) and sliced here for the same
   * reason the two lists above are — this is a dashboard, and a campaign with twenty dated threats must
   * not push everything else below the fold. The full set is on the chronicle, which every row opens.
   */
  const deadlineList = useMemo(() => deadlines.slice(0, 5), [deadlines]);

  // CF-2: settle the fetches before claiming emptiness — for either audience. A campaign with no pages
  // but a running journal or a charted atlas is NOT empty, which is why all three feeds gate this — and
  // M9 adds a fourth: a campaign whose GM has prepped a session has plainly started. M10 adds a fifth,
  // for the same reason: a campaign with a quest in it has plainly started, whatever else is missing.
  const nothingYet = pages.length === 0 && entries.length === 0 && maps.length === 0 && !session && quests.length === 0 && deadlines.length === 0;
  if (loading && nothingYet) return <div className="codex-main-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>;
  if (nothingYet) {
    return (
      <div className="codex-campaign">
        {error && <Alert tone="danger" title="Couldn't load the campaign">{error}</Alert>}
        {showReveal
          ? <div className="codex-main-empty"><h3>No entries yet</h3><p>Create characters, locations, factions and more. They'll be organized here by type and tag.</p>{onCreate && <Button variant="primary" onClick={onCreate}>New page</Button>}</div>
          : <div className="codex-main-empty"><h3>Nothing revealed yet</h3><p>Entries your GM shares appear here, organized by type and tag.</p></div>}
      </div>
    );
  }

  return (
    <div className="codex-campaign">
      {/* R4: the dashboard's own error surface. It reads the notebook, the journal, the atlas and the
          calendar; without this a failed journal fetch renders one fewer section, silently. */}
      {error && <Alert tone="danger" title="Couldn't load the campaign">{error}</Alert>}

      <div className="codex-campaign-stats">
        <div className="codex-campaign-stat"><span className="codex-campaign-statnum">{pages.length}</span><span>entities</span></div>
        {showReveal && <div className="codex-campaign-stat"><span className="codex-campaign-statnum">{revealed}</span><span>revealed to players</span></div>}
        <div className="codex-campaign-stat"><span className="codex-campaign-statnum">{tags.length}</span><span>tags</span></div>
        <div className="codex-campaign-stat"><span className="codex-campaign-statnum">{maps.length}</span><span>{maps.length === 1 ? "map" : "maps"}</span></div>
        <div className="codex-campaign-stat"><span className="codex-campaign-statnum">{entries.length}</span><span>journal {entries.length === 1 ? "entry" : "entries"}</span></div>
        {/* The same `codex-now-chip` the journal composer uses for the world's "now" — one readout, one look. */}
        {today && <div className="codex-campaign-today"><span className="codex-now-chip" title="The campaign's current date — set it in the journal's calendar">Now: {today}</span></div>}
      </div>

      {/* M9: where this campaign is right now — the session the table is pointed at (GM) or the nearest
          revealed one (player). It sits above "By type" because it is the most time-sensitive thing on
          the dashboard; it renders nothing at all when there is no session, rather than a placeholder
          panel for a record that does not exist. */}
      {session && (
        <section className="codex-campaign-section">
          {/* The two audiences are looking at different things through the same card, so it must not
              claim to be one of them for both. The GM sees the session they are prepping — "next". A
              player only ever sees a session whose recap has been revealed, which is by definition one
              that has already happened; heading that "Next session" told them the last game was the
              next one. Keyed off `onOpenSession`, the capability flag this component already uses to
              tell the two callers apart, so it still knows nothing about roles. */}
          <h3 className="codex-campaign-h">{onOpenSession ? "Next session" : "Latest recap"}</h3>
          <nav className="codex-campaign-recent" aria-label={onOpenSession ? "Next session" : "Latest recap"}>
            {/* R2: the same row chassis the journal and atlas rows above use, which is also where its
                44px floor comes from — `.codex-campaign-recentitem` is §4 route 1 (grow the paint), so
                there is no new control and no new floor to argue about here.
                A player has no session log to open, so `onOpenSession` is absent for them and the row is
                a plain readout: a button that navigates nowhere is worse than no button. */}
            {onOpenSession
              ? <button type="button" className="codex-campaign-recentitem" onClick={() => onOpenSession(session.id)}>
                  <CodexIcon iconId="hourglass" className="codex-ent-icon codex-campaign-recentglyph" />
                  <span className="codex-list-title">{sessionTitle(session)}</span>
                  {session.realDate && <span className="codex-campaign-recentwhen">{session.realDate}</span>}
                </button>
              : <div className="codex-campaign-sessionrow">
                  <CodexIcon iconId="hourglass" className="codex-ent-icon codex-campaign-recentglyph" />
                  <span className="codex-list-title">{sessionTitle(session)}</span>
                  {session.realDate && <span className="codex-campaign-recentwhen">{session.realDate}</span>}
                </div>}
          </nav>
          {/* The recap, and never the prep — the shared type has no prep field to render (see
              `CampaignSession`), so this card reads identically for both audiences by construction. */}
          {session.recap.trim() && <p className="codex-campaign-sessionrecap">{session.recap}</p>}
        </section>
      )}

      {/* M10 / CT-4: what the party is still chasing. It sits directly under the session card because
          the two together answer "where is this campaign right now"; it renders nothing at all when
          nothing is open, rather than a placeholder panel for a state that is genuinely empty. */}
      {openQuestList.length > 0 && (
        <section className="codex-campaign-section">
          {/* One heading for both audiences, unlike the session card's — "open quests" means exactly the
              same thing on either side of the table, because a quest's status is player-facing. */}
          <h3 className="codex-campaign-h">Open quests</h3>
          <nav className="codex-campaign-recent" aria-label="Open quests">
            {openQuestList.map((quest) => {
              const progress = questProgress(quest.objectives);
              return (
                <div key={quest.id} className="codex-campaign-quest">
                  {/* R2: the same row chassis every list on this surface uses, which is also where its
                      44px floor comes from — `.codex-campaign-recentitem` is §4 route 1 (grow the paint).
                      BOTH audiences pass `onOpenQuest` now, so both get the button: the GM lands in the
                      quest log, the player in their quest reader. The readout branch survives for a
                      caller with no destination — a button that navigates nowhere is worse than none. */}
                  {onOpenQuest
                    ? <button type="button" className="codex-campaign-recentitem" onClick={() => onOpenQuest(quest.id)}>
                        <CodexIcon iconId="quest" className="codex-ent-icon codex-campaign-recentglyph" />
                        <span className="codex-list-title">{quest.title}</span>
                        {progress.total > 0 && <span className="codex-campaign-questprogress">{progress.label}</span>}
                      </button>
                    : <div className="codex-campaign-questrow">
                        <CodexIcon iconId="quest" className="codex-ent-icon codex-campaign-recentglyph" />
                        <span className="codex-list-title">{quest.title}</span>
                        {progress.total > 0 && <span className="codex-campaign-questprogress">{progress.label}</span>}
                      </div>}
                  {/* READ-ONLY on purpose, for BOTH audiences: `onChange` is omitted, so the primitive
                      renders no checkbox, no field, no remove and nothing focusable at all. A player
                      must see progress and never a tickable box, and the GM's own tickable copy lives in
                      the quest log — this dashboard is presentational and writes nothing, ever. */}
                  {quest.objectives.length > 0 && (
                    <Checklist items={quest.objectives} ariaLabel={`Objectives for ${quest.title}`} className="codex-campaign-questlist" />
                  )}
                </div>
              );
            })}
          </nav>
        </section>
      )}

      {/* M11 / CT-5: what happens whether or not the party acts. It sits under the quest card because the
          three together answer "where is this campaign right now" — what we are playing next, what we are
          chasing, and what is bearing down on us. Like the two above it, it renders nothing at all when
          there is nothing to say rather than a placeholder panel. */}
      {deadlineList.length > 0 && (
        <section className="codex-campaign-section">
          {/* One heading for both audiences, like the quest card's: a revealed deadline means exactly the
              same thing on either side of the table. Not "Upcoming deadlines" — the list deliberately
              keeps the ones that have already passed, and each row says which it is. */}
          <h3 className="codex-campaign-h">Deadlines</h3>
          <nav className="codex-campaign-recent" aria-label="Deadlines">
            {deadlineList.map((deadline) => (
              /* R2: the same row chassis every list on this surface uses, which is also where its 44px
                 floor comes from — `.codex-campaign-recentitem` is §4 route 1 (grow the paint). The glyph
                 and the state WORD are imported from `chronicle.ts`, never restated here: a card that
                 spelled its own reading rules is how a dashboard starts calling a record something the
                 timeline it links into does not. */
              <button key={deadline.id} type="button" className="codex-campaign-recentitem" onClick={() => onOpenEntry(deadline.id)}>
                <CodexIcon iconId={CHRONICLE_KIND_META.deadline.iconId} className="codex-ent-icon codex-campaign-recentglyph" />
                <span className="codex-list-title">{deadline.summary || "Untitled deadline"}</span>
                <Badge tone={deadlineStateTone(deadline.fired)}>{deadlineStateLabel(deadline.fired)}</Badge>
                {deadline.when && <span className="codex-campaign-deadlinewhen">{deadline.when}</span>}
              </button>
            ))}
          </nav>
        </section>
      )}

      <section className="codex-campaign-section">
        <h3 className="codex-campaign-h">By type</h3>
        <div className="codex-campaign-types">
          {ENTITY_TYPE_LIST.filter((type) => byType[type]).map((type) => (
            <button key={type} type="button" className="codex-campaign-typecard" style={{ borderLeftColor: entityColor(type) }} onClick={() => onPickType(type)}>
              <span className="codex-campaign-typeicon" style={{ background: `color-mix(in srgb, ${entityColor(type)} 22%, transparent)` }} aria-hidden="true"><EntityIcon type={type} className="codex-campaign-typeglyph" /></span>
              <span className="codex-campaign-typelabel">{ENTITY_DEFS[type].label}</span>
              <span className="codex-campaign-typecount" style={{ color: entityColor(type) }}>{byType[type]}</span>
            </button>
          ))}
        </div>
      </section>

      {recentEntries.length > 0 && (
        <section className="codex-campaign-section">
          <h3 className="codex-campaign-h">Recent journal activity</h3>
          <nav className="codex-campaign-recent" aria-label="Recent journal activity">
            {/* R2: the same row chassis every list on this surface uses, and a record's kind reads by
                icon AND text — the glyph plus the kind's word, never by colour alone.
                M11: both come from `CHRONICLE_KIND_META` now rather than from a `kind === "combat"`
                ternary written here. The ternary was the client's copy of the very collapse that let a
                new kind render as the wrong record on the server; with four kinds in the table it would
                have drawn a deadline as a scroll and called it nothing at all. An ordinary entry still
                shows no badge — its "Entry" label is what the row's text already is. */}
            {recentEntries.map((entry) => {
              const meta = CHRONICLE_KIND_META[entry.kind];
              return (
              <button key={entry.id} type="button" className="codex-campaign-recentitem" onClick={() => onOpenEntry(entry.id)}>
                <CodexIcon iconId={meta.iconId} className="codex-ent-icon codex-campaign-recentglyph" />
                <span className="codex-list-title">{entry.summary || "Untitled entry"}</span>
                {entry.kind !== "entry" && <Badge tone={meta.tone}>{meta.label}</Badge>}
                {entry.when && <span className="codex-campaign-recentwhen">{entry.when}</span>}
              </button>
              );
            })}
          </nav>
        </section>
      )}

      {maps.length > 0 && (
        <section className="codex-campaign-section">
          <h3 className="codex-campaign-h">Atlas</h3>
          <nav className="codex-campaign-recent" aria-label="Maps in the atlas">
            {maps.map((map) => (
              <button key={map.id} type="button" className="codex-campaign-recentitem" onClick={() => onOpenMap(map.id)}>
                <CodexIcon iconId="compass" className="codex-ent-icon codex-campaign-recentglyph" />
                <span className="codex-list-title">{map.name}</span>
                {showReveal && (map.revealedToPlayers ? <Badge tone="success">Shown</Badge> : <Badge>GM only</Badge>)}
              </button>
            ))}
          </nav>
        </section>
      )}

      <section className="codex-campaign-section">
        <h3 className="codex-campaign-h">Recently updated</h3>
        <nav className="codex-campaign-recent" aria-label="Recently updated pages">
          {recent.map((page) => (
            <button key={page.id} type="button" className="codex-campaign-recentitem" onClick={() => onOpenPage(page.id)}>
              {page.entityType !== "note" && <EntityIcon type={page.entityType} />}
              <span className="codex-list-title">{page.title}</span>
              {showReveal && page.revealedToPlayers && <Badge tone="success">Shown</Badge>}
            </button>
          ))}
        </nav>
      </section>

      {tags.length > 0 && (
        <section className="codex-campaign-section">
          <h3 className="codex-campaign-h">Tags</h3>
          <div className="codex-campaign-tags">
            {tags.map(([tag, count]) => <button key={tag} type="button" className="codex-tag-chip tap-target" onClick={() => onPickTag(tag)}>{tag}<span className="codex-tag-count">{count}</span></button>)}
          </div>
        </section>
      )}
    </div>
  );
}

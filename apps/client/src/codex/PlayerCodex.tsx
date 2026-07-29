import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Checklist, Chip, Input, Skeleton, Tabs } from "@vtt/ui";
import { socket } from "../socket";
import { formatWorldDate, playerCodexApi, type CodexCalendar, type CodexLinkEdge, type CodexRelationship, type CodexRelationshipEdge, type CodexSearchHit, type PlayerCodexChronicleRecord, type PlayerCodexMap, type PlayerCodexMarker, type PlayerCodexPage, type PlayerCodexPageSummary, type PlayerCodexQuest, type PlayerCodexSession } from "./api";
import { CHRONICLE_KIND_META, campaignDeadlines, chronicleWhenLabel, deadlineFired, deadlineStateLabel, deadlineStateTone, downtimeSummaryLabel } from "./chronicle";
import { pickNextSession } from "./sessions";
import { QUEST_STATUS_LABEL, questProgress, questStatusTone } from "./quests";
import { CodexIcon } from "./icons";
import { SearchResultList, useCodexSearch } from "./SearchResults";
import { CodexMarkdown } from "./CodexMarkdown";
import { CodexImage } from "./CodexImage";
import { MapSurface } from "./MapSurface";
import { CampaignHome, type CampaignDeadline, type CampaignEntry } from "./CampaignHome";
import { RelationshipGraph } from "./RelationshipGraph";
import { EntityIcon } from "./icons";
import { ENTITY_DEFS, entityDef, relationshipLabel, type EntityType } from "./entities";
import "./codex.css";

/** CI-7: `world` is `campaign` on the player's mode bar too — one vocabulary across both audiences. */
type PlayerView = "campaign" | "lore" | "atlas" | "journal" | "graph";

/**
 * The player-facing Codex: a read-only window onto the worldbuilding the GM has revealed. Lore browses
 * revealed pages (player body only), Atlas pans revealed maps and follows revealed markers, Journal
 * shows the revealed **chronicle** — revealed journal entries AND revealed dated `event` pages (CT-11),
 * in the one row shape the GM's timeline uses (R2), and the Campaign dashboard opens a **quest reader**
 * over itself for any revealed quest. Everything here is the server's player projection; GM-secret
 * content and unrevealed records never reach this surface.
 *
 * Every read on this surface goes through `playerCodexApi` and nothing else — `questApi`, `codexApi`,
 * `journalApi` and `sessionApi` are GM feeds and are not imported here. That is the whole of this
 * surface's viewer safety: the quest reader below renders fields of rows the server chose to send THIS
 * token, so there is no GM body to hide because there was never one to receive.
 *
 * Reading rules (`chronicleWhenLabel`, `CHRONICLE_KIND_META`) are imported rather than re-stated: the two
 * readers are deliberately separate implementations (D-2), but they must not disagree about what a row
 * *says*. The lens toggle is deliberately NOT ported here - grouping by in-world year needs the sort key,
 * and widening the player projection to carry one for a feature the spec asks of the GM's Journal would
 * be paying in viewer-safety surface for a convenience nobody requested. The player's chronicle is the
 * server's single canonical chronological order.
 */

export function PlayerCodex({ token }: Readonly<{ token: string; onClose?: () => void }>) {
  const [view, setView] = useState<PlayerView>("campaign");
  const [pages, setPages] = useState<PlayerCodexPageSummary[]>([]);
  const [rels, setRels] = useState<CodexRelationshipEdge[]>([]);
  // CI-8: the player's wiki-link edges. Read from `playerCodexApi`, never `codexApi` — the server has
  // already dropped every edge touching a page this player cannot see and every edge written in a GM
  // body, and this surface renders only what its own token was sent. It adds no filter of its own,
  // because a second gate here could only ever disagree with the one that counts.
  const [links, setLinks] = useState<CodexLinkEdge[]>([]);
  const [filter, setFilter] = useState<{ type: EntityType | null; tag: string | null }>({ type: null, tag: null });
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [page, setPage] = useState<PlayerCodexPage | null>(null);
  const [pageRels, setPageRels] = useState<CodexRelationship[]>([]);
  const [maps, setMaps] = useState<PlayerCodexMap[]>([]);
  const [currentMapId, setCurrentMapId] = useState<string | null>(null);
  const [markers, setMarkers] = useState<PlayerCodexMarker[]>([]);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<PlayerCodexChronicleRecord[]>([]);
  const [focusedEntryId, setFocusedEntryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * CI-7: the campaign's current date for the dashboard. `/codex/calendar` is a role-aware read that the
   * server already answers for a player token — the same calendar behind the `inWorldLabel` every player
   * entry already carries. It is fetched, not derived, so this surface still shows only what it was sent.
   *
   * M11 / O-1: that projection now has real teeth. The GM's clock and the players' clock are two values,
   * and the player's `currentDate` IS the published one — so the "Now:" chip below keeps reading exactly
   * as it did while its source moved underneath it. Read through `playerCodexApi`, never `calendarApi`:
   * the GM method's type carries `publishedDate` beside a `currentDate` that is the GM's own prep clock,
   * and this surface must not be able to hold that shape at all.
   */
  const [calendar, setCalendar] = useState<CodexCalendar | null>(null);
  /**
   * M9 / CT-3: the sessions the GM has revealed, recap-only. This is the server's player projection —
   * four keys, no prep, no status, no attendees — so there is nothing here to filter and nothing to hide.
   */
  const [sessions, setSessions] = useState<PlayerCodexSession[]>([]);
  /**
   * M10 / CT-4: the quests the GM has revealed. The server's player projection — no `gmBody`, no `rev`,
   * and each quest's `entityIds` already filtered to pages this player may also see — so there is
   * nothing here to filter and nothing to hide. `status` IS in it, deliberately: "what is still open" is
   * the point of the record, and the dashboard's card filters on it for both audiences alike.
   */
  const [quests, setQuests] = useState<PlayerCodexQuest[]>([]);
  /**
   * The quest reader — a DESTINATION laid over the Campaign mode, not a sixth tab. The GM's quest log is
   * one for the reason stated in `QuestsView`: five modes already overflow a 375px strip and a sixth
   * would push the overflow past the point where `.codex-modetabs`' cue helps. The player's bar is the
   * same five and has no ops row to hang an extra button on, so this destination is reached ONLY by a
   * jump — from the dashboard's open-quest rows and from a quest search hit — exactly as the GM's is.
   *
   * It is scoped to `campaign` rather than laid over every mode (the GM's is global) so the mode bar
   * stays truthful: a player reading a quest is looking at the campaign, and "Campaign" is the tab lit.
   * Picking any tab closes it, so a tab can never change the surface underneath without surfacing.
   */
  const [questsOpen, setQuestsOpen] = useState(false);
  const [readQuestId, setReadQuestId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextPages, nextMaps, nextTimeline, nextRels, nextLinks, nextCalendar, nextSessions, nextQuests] = await Promise.all([
        playerCodexApi.listPages(token), playerCodexApi.listMaps(token), playerCodexApi.chronicle(token), playerCodexApi.listRelationships(token),
        // Uncaught, exactly like the typed-edge feed beside it: the two are the Graph's two halves, and
        // half a graph drawn silently is worse than the error Alert this surface already shows (R4).
        playerCodexApi.listLinks(token),
        // A missing calendar costs the dashboard one chip; it must not cost the player the whole codex.
        playerCodexApi.calendar(token).catch(() => null),
        // Same bargain for the session card: one card is worth less than the rest of the codex.
        playerCodexApi.sessions(token).catch(() => []),
        // ...and for the quest card, on the same terms.
        playerCodexApi.quests(token).catch(() => [])
      ]);
      setPages(nextPages); setMaps(nextMaps); setTimeline(nextTimeline); setRels(nextRels); setLinks(nextLinks); setCalendar(nextCalendar); setSessions(nextSessions); setQuests(nextQuests);
      setCurrentMapId((current) => current ?? nextMaps.find((map) => map.parentMapId === null)?.id ?? nextMaps[0]?.id ?? null);
      setError(null);
    } catch { setError("Couldn't load the codex - check your connection to the table."); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load().catch(() => undefined); }, [load]);
  useEffect(() => { const onChanged = () => { void load().catch(() => undefined); if (currentMapId) void playerCodexApi.listMarkers(token, currentMapId).then(setMarkers).catch(() => undefined); }; socket.on("codex:changed", onChanged); return () => { socket.off("codex:changed", onChanged); }; }, [load, token, currentMapId]);
  useEffect(() => { if (!selectedPageId) { setPage(null); setPageRels([]); return; } let live = true; void playerCodexApi.getPage(token, selectedPageId).then((result) => { if (live) { setPage(result.page); setPageRels(result.relationships); } }).catch(() => { if (live) { setPage(null); setPageRels([]); } }); return () => { live = false; }; }, [token, selectedPageId]);
  useEffect(() => { if (!currentMapId) { setMarkers([]); return; } void playerCodexApi.listMarkers(token, currentMapId).then(setMarkers).catch(() => setMarkers([])); }, [token, currentMapId]);
  // CI-1 / R8: one search over everything this player is allowed to see — revealed pages, revealed
  // entries, revealed maps and revealed pins. The server's `/search` route is role-aware and has already
  // dropped the rest (`projectPlayerSearchHit`), so this surface must NOT assume page-only and must not
  // add a filter of its own: a second, client-side gate could only ever disagree with the one that counts.
  const runSearch = useCallback((q: string) => playerCodexApi.search(token, q), [token]);
  const searchState = useCodexSearch(query, runSearch, pages);

  const openPage = useCallback((pageId: string) => { setSelectedPageId(pageId); setQuestsOpen(false); setView("lore"); }, []);
  /**
   * R1: land ON the quest, not merely "the surface quests live on". Both entrances go through here — the
   * dashboard card's rows and a quest search hit — so a tap from either lands on the same record, and a
   * quest the GM has since marked `completed` (which the open-quests card deliberately does not list)
   * is still reached by its id rather than dropped on a dashboard that no longer mentions it.
   */
  const openQuest = useCallback((questId: string) => { setReadQuestId(questId); setQuestsOpen(true); setView("campaign"); }, []);
  /** R1: a player's jump prepares its destination too — the pin's map opens first, then the pin is marked. */
  const openHit = useCallback((hit: CodexSearchHit) => {
    // Every non-quest jump also LEAVES the quest reader. It is a destination over the Campaign mode, so
    // a jump that only changed `view` would leave it armed underneath and the next "Campaign" tap would
    // land on a quest instead of the dashboard.
    setQuestsOpen(false);
    switch (hit.kind) {
      case "page": setFilter({ type: null, tag: null }); setSelectedPageId(hit.id); setView("lore"); break;
      case "map": setSelectedMarkerId(null); setCurrentMapId(hit.id); setView("atlas"); break;
      case "marker": { if (hit.mapId) setCurrentMapId(hit.mapId); setSelectedMarkerId(hit.id); setView("atlas"); break; }
      case "journal": setFocusedEntryId(hit.id); setView("journal"); break;
      // A quest hit lands ON the quest in the reader — the same destination the dashboard's rows open,
      // and the reason a `completed` quest is now findable at all: the open-quests card never lists it,
      // so before this the search result had nowhere to go and dropped the player on the dashboard.
      case "quest": openQuest(hit.id); break;
    }
  }, [openQuest]);
  useEffect(() => {
    if (!focusedEntryId) return;
    document.getElementById(`codex-player-entry-${focusedEntryId}`)?.scrollIntoView({ block: "center" });
  }, [focusedEntryId, timeline]);
  const navigate = useCallback((target: string) => { const match = pages.find((candidate) => candidate.title.toLowerCase() === target.trim().toLowerCase()); if (match) openPage(match.id); }, [pages, openPage]);
  const onMarkerClick = useCallback((markerId: string) => {
    const marker = markers.find((candidate) => candidate.id === markerId);
    if (!marker) return;
    if (marker.subMapId && maps.some((map) => map.id === marker.subMapId)) setCurrentMapId(marker.subMapId);
    else if (marker.pageIds[0]) openPage(marker.pageIds[0]);
  }, [markers, maps, openPage]);

  const filteredPages = useMemo(() => pages.filter((summary) => (!filter.type || summary.entityType === filter.type) && (!filter.tag || summary.tags.includes(filter.tag))), [pages, filter]);
  const knownTitles = useMemo(() => new Set(pages.map((summary) => summary.title.toLowerCase())), [pages]); // for wiki-link "redlinks"
  const currentMap = maps.find((map) => map.id === currentMapId) ?? null;
  const breadcrumb = useMemo(() => {
    const chain: PlayerCodexMap[] = []; let cursor = currentMap; const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) { chain.unshift(cursor); guard.add(cursor.id); cursor = maps.find((map) => map.id === cursor!.parentMapId) ?? null; }
    return chain;
  }, [currentMap, maps]);
  // Drill-down: revealed maps nested under the current one (breadcrumb goes up, these go down). `maps` is
  // already the server's revealed-only projection, so only shared child maps ever appear here.
  const childMaps = useMemo(() => (currentMapId ? maps.filter((map) => map.parentMapId === currentMapId) : []), [maps, currentMapId]);
  // Mirrors the GM atlas: the breadcrumb only climbs one chain, so several revealed top-level maps need
  // their own switcher or all but the first are unreachable. Already the revealed-only projection.
  const rootMaps = useMemo(() => maps.filter((map) => map.parentMapId === null), [maps]);
  const currentRootId = breadcrumb[0]?.id ?? null;

  /**
   * CI-7 dashboard feed. Every value here is a field of a record the SERVER chose to send this player —
   * `timeline` is already `projectPlayerJournalEntry`'d and `maps` is already the revealed-only list, so
   * nothing is filtered again on the way in. A second gate here could only ever disagree with the one
   * that counts, and `revealedToPlayers` is deliberately absent: a player's map row has no such field to
   * read, so the dashboard cannot accidentally render GM knowledge it was never handed.
   */
  const campaignEntries = useMemo<readonly CampaignEntry[]>(
    // Newest first by `createdAt` — the same notion of "recent" the GM dashboard uses, and the only one
    // a player entry can express (the timeline arrives in in-world chronological order, which is a
    // different question). The revealed set itself is the server's; this only reorders it.
    // CT-11: dated `event` pages share the chronicle but not this list. The dashboard's section is
    // "Recent journal activity" and its rows open the Journal by entry id; an event is a wiki page that
    // already appears in the entity counts above, and giving it a second home here would be the same
    // record in two places on one screen. Widening the dashboard's feed is CI-7's question, not M8's.
    // M11: `kind` travels across as it arrived. It used to be flattened through
    // `kind === "combat" ? "combat" : "note"` — the same collapse that made a new record kind cost zero
    // compile errors on the server and render as the wrong thing; with deadlines and downtime on this
    // feed it would have drawn both as ordinary notes on the player's own dashboard.
    () => timeline
      .filter((record) => record.kind !== "event")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((record) => ({ id: record.id, summary: record.text, when: chronicleWhenLabel(record), kind: record.kind })),
    [timeline]
  );
  /**
   * M11 / CT-5 + O-2: the deadlines the party has been TOLD about. Ordered by the shared rule, mapped to
   * the shared card shape — the same two lines the GM workspace runs, over whatever this token was sent.
   *
   * There is no kind filter for visibility anywhere here, and there must not be: an unrevealed deadline
   * is not in `timeline` at all, because the server's reveal gate already dropped it. A deadline the GM
   * has revealed is exactly as visible as a note they revealed.
   */
  const campaignDeadlineCards = useMemo<readonly CampaignDeadline[]>(
    () => campaignDeadlines(timeline).map((record) => ({ id: record.id, summary: record.text, when: chronicleWhenLabel(record), fired: record.fired })),
    [timeline]
  );
  const campaignToday = useMemo(() => (calendar?.currentDate ? formatWorldDate(calendar, calendar.currentDate) : null), [calendar]);

  /**
   * The quest being read, resolved out of the ONE quest feed this surface already fetched — there is no
   * second read and deliberately no `playerCodexApi.getQuest`: `/quests` already carries every field the
   * reader shows, and a per-record fetch would be a second path onto the same projection.
   */
  const readQuest = useMemo(() => quests.find((quest) => quest.id === readQuestId) ?? null, [quests, readQuestId]);
  /**
   * The pages this quest concerns, resolved against the player's OWN revealed-page list. The server has
   * already filtered `entityIds` to pages this player may see (`projectPlayerQuest`); intersecting with
   * `pages` here is not a second gate but the same lookup the GM's log does — an id with no row is simply
   * not rendered, so a stale id can never become a link to a page that is not in this player's notebook.
   */
  const questPages = useMemo(
    () => (readQuest?.entityIds ?? []).map((id) => pages.find((summary) => summary.id === id)).filter((summary): summary is PlayerCodexPageSummary => Boolean(summary)),
    [readQuest, pages]
  );

  return (
    <div className="codex-root codex-player">
      <div className="codex-modebar">
        {/* Same five-mode strip as the GM's, so it needs the same overflow cue (see `.codex-modetabs`). */}
        <div className="codex-modetabs">
          {/* Picking a mode also leaves the quest reader — it is a destination laid over Campaign, so a
              tab that changed the mode underneath it without surfacing would look like a dead tab (the
              GM's tab strip closes its two destinations for the same reason). */}
          <Tabs ariaLabel="Codex" activeId={view} onChange={(id) => { setView(id as PlayerView); setQuestsOpen(false); }}
            tabs={[{ id: "campaign", label: "Campaign" }, { id: "lore", label: "Lore" }, { id: "atlas", label: "Atlas" }, { id: "journal", label: "Journal" }, { id: "graph", label: "Graph" }]} />
        </div>
      </div>

      {error && <Alert tone="danger" title="Couldn't load the codex">{error}</Alert>}

      {view === "campaign" && questsOpen && (
        <>
          {/* The way out, ABOVE the two panes — the quest log's exit row verbatim. On a phone the rail is
              hidden while a quest is open (`has-selection`), so an exit living in it would make leaving a
              two-tap manoeuvre. §4: `Button size="sm"` is a `@vtt/ui` primitive and carries the 44px
              floor itself (route 2, `.nh-btn--sm`); the wrapper is layout, not a control. */}
          <div className="codex-sessions-exit"><Button variant="ghost" size="sm" onClick={() => setQuestsOpen(false)}>‹ Back to the campaign</Button></div>
          <div className={`codex-workspace codex-questreader${readQuest ? " has-selection" : ""}`}>
            <aside className="codex-rail">
              <div className="codex-rail-head"><strong className="codex-sessions-railtitle">Quests</strong></div>
              {/* WHERE FINISHED QUESTS LIVE. The dashboard's card is open-quests-only on purpose and stays
                  that way — "Open quests" must not keep offering a thread the party can no longer pull.
                  This rail is the other half: every quest the GM has revealed, in the server's order,
                  whatever its status, each row saying that status as a WORD. So a completed quest is
                  browsable here and reachable by id from search, without the dashboard card quietly
                  becoming a list of everything that ever happened. */}
              <nav className="codex-list" aria-label="Quests">
                {loading && quests.length === 0 && <div className="codex-list-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>}
                {!loading && quests.length === 0 && <p className="codex-list-empty">No quests revealed yet.</p>}
                {quests.map((quest) => (
                  /* `aria-current` as well as the class, the GM log's rule verbatim: the accent is the
                     visual cue, but "which quest am I reading" has to survive with the stylesheet
                     stripped. §4: `.codex-quest-row` is the GM log's own row and is already route 1. */
                  <button key={quest.id} type="button" aria-current={quest.id === readQuest?.id ? "true" : undefined}
                    className={`codex-quest-row${quest.id === readQuest?.id ? " is-active" : ""}`} onClick={() => setReadQuestId(quest.id)}>
                    <CodexIcon iconId="quest" className="codex-ent-icon codex-quest-rowglyph" />
                    <span className="codex-list-title">{quest.title}</span>
                    <Badge tone={questStatusTone(quest.status)}>{QUEST_STATUS_LABEL[quest.status]}</Badge>
                  </button>
                ))}
              </nav>
            </aside>
            <section className="codex-main">
              {readQuest && <button type="button" className="codex-back" onClick={() => setReadQuestId(null)}>‹ All quests</button>}
              {readQuest
                ? <article className="codex-reader">
                    <h2 className="codex-reader-title"><CodexIcon iconId="quest" className="codex-reader-titleicon codex-quest-rowglyph" />{readQuest.title}</h2>
                    <div className="codex-entry-meta">
                      {/* R2: the status is a WORD (`QUEST_STATUS_LABEL`); the badge tone is a scanning aid
                          only, and progress is counted in words for the same reason — never a bare ratio. */}
                      <Badge tone={questStatusTone(readQuest.status)}>{QUEST_STATUS_LABEL[readQuest.status]}</Badge>
                      {readQuest.objectives.length > 0 && <span className="codex-quest-progress">{questProgress(readQuest.objectives).label}</span>}
                    </div>
                    {/* Plain text, NOT `CodexMarkdown`, and that is a copy of the record rather than a
                        downgrade: a quest body is authored in a bare `Textarea` in the GM's log and the
                        server extracts no wiki-links from it, so rendering it as markdown would invent
                        `[[links]]` the GM was never offered and that the graph does not know about. */}
                    <div className="codex-reader-body">
                      {readQuest.body.trim() ? <p className="codex-quest-readerbody">{readQuest.body}</p> : <p className="codex-preview-empty">Nothing written here yet.</p>}
                    </div>
                    {readQuest.objectives.length > 0 && (
                      <div className="codex-quest-objectives">
                        <h4 className="codex-quest-subhead">Objectives</h4>
                        {/* READ-ONLY: `onChange` is omitted, so the primitive renders no checkbox, no
                            field, no remove and nothing focusable at all. A player sees progress and
                            never a tickable box — the GM's tickable copy lives in their quest log. */}
                        <Checklist items={readQuest.objectives} ariaLabel={`Objectives for ${readQuest.title}`} />
                      </div>
                    )}
                    {questPages.length > 0 && (
                      <div className="codex-reader-rels">
                        <h4 className="codex-backlinks-title">What this concerns</h4>
                        {/* §4: `.codex-quest-link-open` is the GM log's linked-entity row and is already
                            route 1 (grow the paint) — required here, because these are a vertical stack
                            and a route-2 `::after` would overhang into the neighbouring row's taps. */}
                        <div className="codex-quest-links">
                          {questPages.map((summary) => (
                            <button key={summary.id} type="button" className="codex-quest-link-open" onClick={() => openPage(summary.id)}>
                              {summary.entityType !== "note" && <EntityIcon type={summary.entityType} />}<span className="codex-list-title">{summary.title}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </article>
                : <div className="codex-main-empty"><h3>Pick a quest</h3><p>Everything your GM has shared with the party is here — what you are still chasing, and what you have already finished.</p></div>}
            </section>
          </div>
        </>
      )}

      {view === "campaign" && !questsOpen && (
        <CampaignHome pages={pages} entries={campaignEntries} maps={maps} today={campaignToday} loading={loading} showReveal={false} onOpenPage={openPage}
          /* M9: the nearest revealed session. A player is never sent `activeSessionId` (the server
             answers them null — it would name a record that may well be unrevealed), so the rule falls
             through to the highest-numbered session they can actually see. No `onOpenSession`: there is
             no player session log to open, and a button that navigates nowhere is worse than no button. */
          session={pickNextSession(sessions)}
          /* M10: handed straight through. `PlayerCodexQuest` is already a superset of the card's shape —
             it carries `body` and `entityIds` too — and the card renders neither, because `CampaignQuest`
             has no field for them. */
          quests={quests}
          /* M11: the revealed deadlines, through the same shared rule the GM's workspace applies. */
          deadlines={campaignDeadlineCards}
          /* R1: the card's rows now land ON the quest, in the player's own reader. Passing this flips the
             card's existing readout rows to its existing button rows (`.codex-campaign-recentitem`,
             already §4 route 1) — the dashboard itself is unchanged and still lists only OPEN quests. */
          onOpenQuest={openQuest}
          /* R1: a player's jumps prepare their destination too — the entry is marked, the map is open. */
          onOpenEntry={(entryId) => { setFocusedEntryId(entryId); setView("journal"); }}
          onOpenMap={(mapId) => { setSelectedMarkerId(null); setCurrentMapId(mapId); setView("atlas"); }}
          onPickType={(type) => { setFilter({ type, tag: null }); setView("lore"); }}
          onPickTag={(tag) => { setFilter({ type: null, tag }); setView("lore"); }} />
      )}

      {view === "graph" && (
        <RelationshipGraph loading={loading} nodes={pages.map((summary) => ({ id: summary.id, title: summary.title, entityType: summary.entityType }))} edges={rels} links={links} onOpen={openPage}
          emptyState={<><h3>Nothing connected yet</h3><p>As the GM reveals people and places, the links between them appear here.</p></>} />
      )}

      {view === "lore" && (
        <div className={`codex-workspace${selectedPageId ? " has-selection" : ""}`}>
          <aside className="codex-rail">
            <div className="codex-rail-head">
              <Input value={query} placeholder="Search what you know…" aria-label="Search the codex"
                onChange={(event) => { setQuery(event.target.value); if (event.target.value.trim()) setFilter({ type: null, tag: null }); }} />
            </div>
            <nav className="codex-list" aria-label="Revealed pages">
              {query.trim() ? (
                <SearchResultList state={searchState} selectedId={selectedPageId} onOpen={openHit} emptyLabel="Nothing you know matches that." />
              ) : (
                <>
                  {(filter.type || filter.tag) && <Chip onRemove={() => setFilter({ type: null, tag: null })} removeLabel="Clear filter">{filter.type ? `${ENTITY_DEFS[filter.type].label}s` : `#${filter.tag}`}</Chip>}
                  {loading && <div className="codex-list-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>}
                  {!loading && filteredPages.length === 0 && <p className="codex-list-empty">Nothing revealed yet.</p>}
                  {filteredPages.map((summary) => <button key={summary.id} type="button" className={`codex-list-item${summary.id === selectedPageId ? " is-active" : ""}`} onClick={() => setSelectedPageId(summary.id)}>{summary.entityType !== "note" && <EntityIcon type={summary.entityType} />}<span className="codex-list-title">{summary.title}</span></button>)}
                </>
              )}
            </nav>
          </aside>
          <section className="codex-main">
            {selectedPageId && <button type="button" className="codex-back" onClick={() => setSelectedPageId(null)}>‹ All lore</button>}
            {page
              ? <article className="codex-reader">
                  {page.bannerAssetId && <CodexImage assetId={page.bannerAssetId} token={token} alt="" className="codex-banner-img" />}
                  <h2 className="codex-reader-title">{page.entityType !== "note" && <EntityIcon type={page.entityType} className="codex-reader-titleicon" />}{page.title}</h2>
                  {Object.entries(page.fields).length > 0 && (
                    <dl className="codex-reader-fields">
                      {Object.entries(page.fields).map(([key, value]) => {
                        const def = entityDef(page.entityType).fields.find((field) => field.key === key);
                        return <div key={key} className="codex-reader-field"><dt>{def?.label ?? key}</dt><dd>{value}</dd></div>;
                      })}
                    </dl>
                  )}
                  <div className="codex-reader-body">{page.body.trim() ? <CodexMarkdown text={page.body} onNavigate={navigate} token={token} knownTitles={knownTitles} /> : <p className="codex-preview-empty">Nothing written here yet.</p>}</div>
                  {pageRels.length > 0 && (
                    <div className="codex-reader-rels">
                      <h4 className="codex-backlinks-title">Relationships</h4>
                      <ul className="codex-rels-list">
                        {pageRels.map((rel) => (
                          <li key={rel.id} className="codex-rels-item">
                            <span className="codex-rels-label">{relationshipLabel(rel.type, rel.direction)}</span>
                            <button type="button" className="codex-md-link" onClick={() => navigate(rel.otherTitle)}><EntityIcon type={rel.otherType} /> {rel.otherTitle}</button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              : <div className="codex-main-empty"><h3>Select an entry</h3><p>Choose a page from the list to read it.</p></div>}
          </section>
        </div>
      )}

      {view === "atlas" && (
        <div className="codex-atlas">
          {rootMaps.length > 1 && (
            <nav className="codex-atlas-descend" aria-label="Top-level maps">
              <span className="codex-descend-label">Top level</span>
              {rootMaps.map((root) => (
                <button key={root.id} type="button" className={`codex-descend-chip${root.id === currentRootId ? " is-current" : ""}`} aria-current={root.id === currentRootId ? "true" : undefined} onClick={() => setCurrentMapId(root.id)}>{root.name}</button>
              ))}
            </nav>
          )}
          <nav className="codex-breadcrumb" aria-label="Map path">
            {breadcrumb.length === 0 && <span className="codex-crumb is-current">Atlas</span>}
            {breadcrumb.map((map, index) => <span key={map.id}>{index > 0 && <span className="codex-crumb-sep">›</span>}<button type="button" className={`codex-crumb${map.id === currentMapId ? " is-current" : ""}`} onClick={() => setCurrentMapId(map.id)}>{map.name}</button></span>)}
          </nav>
          {childMaps.length > 0 && (
            <nav className="codex-atlas-descend" aria-label="Maps within this one">
              <span className="codex-descend-label">Drill into</span>
              {childMaps.map((child) => (
                <button key={child.id} type="button" className="codex-descend-chip" onClick={() => setCurrentMapId(child.id)}>
                  <span className="codex-descend-arrow" aria-hidden="true">↳</span>{child.name}
                </button>
              ))}
            </nav>
          )}
          <div className="codex-atlas-body">
            {currentMap
              ? <MapSurface token={token} assetId={currentMap.assetId} markers={markers} placing={false} readOnly selectedMarkerId={selectedMarkerId} onBackgroundClick={() => undefined} onMarkerClick={onMarkerClick} onMarkerDragEnd={() => undefined} />
              : <div className="codex-main-empty"><h3>No maps yet</h3><p>Maps your GM shares appear here.</p></div>}
          </div>
        </div>
      )}

      {view === "journal" && (
        <div className="codex-journal">
          <div className="codex-timeline">
            {timeline.length === 0 && <p className="codex-list-empty">No entries revealed yet.</p>}
            {/* R2: the same row shape the GM's chronicle uses — icon + kind label + date + body — so a
                record reads the same on both sides of the table, and an event is never mistaken for a
                note because the two only differed by colour. */}
            {timeline.map((record) => {
              const meta = CHRONICLE_KIND_META[record.kind];
              // M11: nearly free, as intended — the icon and the word come from the shared kind table, so
              // a revealed deadline and a revealed downtime read on this timeline the same way they read
              // on the GM's. The two extra lines are the two extra things the player projection carries:
              // a deadline's derived `fired`, and a downtime's payload MINUS `applied` (the server's
              // allow-list never sends it, and `downtimeSummaryLabel` never asks for it).
              const fired = deadlineFired(record);
              return (
              <article key={`${record.kind}-${record.id}`} id={`codex-player-entry-${record.id}`} aria-current={record.id === focusedEntryId ? "true" : undefined}
                className={`codex-entry${record.kind === "combat" ? " is-combat" : ""}${record.kind === "event" ? " is-event" : ""}${record.kind === "deadline" ? " is-deadline" : ""}${record.kind === "downtime" ? " is-downtime" : ""}${record.id === focusedEntryId ? " is-focused" : ""}`}>
                <header className="codex-entry-head codex-entry-meta">
                  <CodexIcon iconId={meta.iconId} className="codex-ent-icon codex-entry-kindglyph" />
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  {record.kind === "deadline" && <Badge tone={deadlineStateTone(fired)}>{deadlineStateLabel(fired)}</Badge>}
                  <span className="codex-entry-when">{chronicleWhenLabel(record)}</span>
                </header>
                {record.title && <h4 className="codex-entry-title">{record.title}</h4>}
                <div className="codex-entry-body"><CodexMarkdown text={record.text} onNavigate={navigate} token={token} knownTitles={knownTitles} /></div>
                {/* Who spent the time, on what, for how long. No Confirm and no proposed date: applying a
                    downtime is a GM action against the GM's own clock, and neither the control nor the
                    state that drives it exists on this surface. */}
                {record.kind === "downtime" && record.payload && <p className="codex-downtime-what">{downtimeSummaryLabel(record.payload)}</p>}
              </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Chip, Input, Skeleton, Tabs } from "@vtt/ui";
import { socket } from "../socket";
import { calendarApi, formatWorldDate, playerCodexApi, type CodexCalendar, type CodexLinkEdge, type CodexRelationship, type CodexRelationshipEdge, type CodexSearchHit, type PlayerCodexChronicleRecord, type PlayerCodexMap, type PlayerCodexMarker, type PlayerCodexPage, type PlayerCodexPageSummary, type PlayerCodexSession } from "./api";
import { CHRONICLE_KIND_META, chronicleWhenLabel } from "./chronicle";
import { pickNextSession } from "./sessions";
import { CodexIcon } from "./icons";
import { SearchResultList, useCodexSearch } from "./SearchResults";
import { CodexMarkdown } from "./CodexMarkdown";
import { CodexImage } from "./CodexImage";
import { MapSurface } from "./MapSurface";
import { CampaignHome, type CampaignEntry } from "./CampaignHome";
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
 * in the one row shape the GM's timeline uses (R2). Everything here is the server's player projection;
 * GM-secret content and unrevealed records never reach this surface.
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
  // CI-7: the campaign's current date for the dashboard. `/codex/calendar` is a role-aware read that the
  // server already answers for a player token — the same calendar behind the `inWorldLabel` every player
  // entry already carries. It is fetched, not derived, so this surface still shows only what it was sent.
  const [calendar, setCalendar] = useState<CodexCalendar | null>(null);
  /**
   * M9 / CT-3: the sessions the GM has revealed, recap-only. This is the server's player projection —
   * four keys, no prep, no status, no attendees — so there is nothing here to filter and nothing to hide.
   */
  const [sessions, setSessions] = useState<PlayerCodexSession[]>([]);

  const load = useCallback(async () => {
    try {
      const [nextPages, nextMaps, nextTimeline, nextRels, nextLinks, nextCalendar, nextSessions] = await Promise.all([
        playerCodexApi.listPages(token), playerCodexApi.listMaps(token), playerCodexApi.chronicle(token), playerCodexApi.listRelationships(token),
        // Uncaught, exactly like the typed-edge feed beside it: the two are the Graph's two halves, and
        // half a graph drawn silently is worse than the error Alert this surface already shows (R4).
        playerCodexApi.listLinks(token),
        // A missing calendar costs the dashboard one chip; it must not cost the player the whole codex.
        calendarApi.get(token).catch(() => null),
        // Same bargain for the session card: one card is worth less than the rest of the codex.
        playerCodexApi.sessions(token).catch(() => [])
      ]);
      setPages(nextPages); setMaps(nextMaps); setTimeline(nextTimeline); setRels(nextRels); setLinks(nextLinks); setCalendar(nextCalendar); setSessions(nextSessions);
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

  const openPage = useCallback((pageId: string) => { setSelectedPageId(pageId); setView("lore"); }, []);
  /** R1: a player's jump prepares its destination too — the pin's map opens first, then the pin is marked. */
  const openHit = useCallback((hit: CodexSearchHit) => {
    switch (hit.kind) {
      case "page": setFilter({ type: null, tag: null }); setSelectedPageId(hit.id); setView("lore"); break;
      case "map": setSelectedMarkerId(null); setCurrentMapId(hit.id); setView("atlas"); break;
      case "marker": { if (hit.mapId) setCurrentMapId(hit.mapId); setSelectedMarkerId(hit.id); setView("atlas"); break; }
      case "journal": setFocusedEntryId(hit.id); setView("journal"); break;
    }
  }, []);
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
    () => timeline
      .filter((record) => record.kind !== "event")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((record) => ({ id: record.id, summary: record.text, when: chronicleWhenLabel(record), kind: record.kind === "combat" ? "combat" as const : "note" as const })),
    [timeline]
  );
  const campaignToday = useMemo(() => (calendar?.currentDate ? formatWorldDate(calendar, calendar.currentDate) : null), [calendar]);

  return (
    <div className="codex-root codex-player">
      <div className="codex-modebar">
        {/* Same five-mode strip as the GM's, so it needs the same overflow cue (see `.codex-modetabs`). */}
        <div className="codex-modetabs">
          <Tabs ariaLabel="Codex" activeId={view} onChange={(id) => setView(id as PlayerView)}
            tabs={[{ id: "campaign", label: "Campaign" }, { id: "lore", label: "Lore" }, { id: "atlas", label: "Atlas" }, { id: "journal", label: "Journal" }, { id: "graph", label: "Graph" }]} />
        </div>
      </div>

      {error && <Alert tone="danger" title="Couldn't load the codex">{error}</Alert>}

      {view === "campaign" && (
        <CampaignHome pages={pages} entries={campaignEntries} maps={maps} today={campaignToday} loading={loading} showReveal={false} onOpenPage={openPage}
          /* M9: the nearest revealed session. A player is never sent `activeSessionId` (the server
             answers them null — it would name a record that may well be unrevealed), so the rule falls
             through to the highest-numbered session they can actually see. No `onOpenSession`: there is
             no player session log to open, and a button that navigates nowhere is worse than no button. */
          session={pickNextSession(sessions)}
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
              return (
              <article key={`${record.kind}-${record.id}`} id={`codex-player-entry-${record.id}`} aria-current={record.id === focusedEntryId ? "true" : undefined}
                className={`codex-entry${record.kind === "combat" ? " is-combat" : ""}${record.kind === "event" ? " is-event" : ""}${record.id === focusedEntryId ? " is-focused" : ""}`}>
                <header className="codex-entry-head codex-entry-meta">
                  <CodexIcon iconId={meta.iconId} className="codex-ent-icon codex-entry-kindglyph" />
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <span className="codex-entry-when">{chronicleWhenLabel(record)}</span>
                </header>
                {record.title && <h4 className="codex-entry-title">{record.title}</h4>}
                <div className="codex-entry-body"><CodexMarkdown text={record.text} onNavigate={navigate} token={token} knownTitles={knownTitles} /></div>
              </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

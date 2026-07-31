import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Checklist, Chip, Drawer, IconButton, Input, Kbd, Skeleton } from "@vtt/ui";
import { socket } from "../socket";
import {
  formatWorldDate, playerCodexApi,
  type CodexCalendar, type CodexSearchHit, type PlayerCodexChronicleRecord, type PlayerCodexConnection,
  type PlayerCodexMap, type PlayerCodexMarker, type PlayerCodexPage, type PlayerCodexPageConnection,
  type PlayerCodexPageSummary, type PlayerCodexQuest, type PlayerCodexSession, type PlayerCodexStanding
} from "./api";
import { CHRONICLE_KIND_META, chronicleWhenLabel, deadlineFired, deadlineStateLabel, deadlineStateTone, downtimeOf, downtimeSummaryLabel, milestoneOf, milestoneSummaryLabel, questEventLabel, questEventOf, standingChangeLabel, standingOf } from "./chronicle";
import { pickNextSession, sessionTitle } from "./sessions";
import { QUEST_STATUS_LABEL, questProgress, questStatusTone } from "./quests";
import { CodexIcon, EntityIcon } from "./icons";
import { SearchResultList, useCodexSearch } from "./SearchResults";
import { CodexMarkdown } from "./CodexMarkdown";
import { CodexImage } from "./CodexImage";
import { MapSurface } from "./MapSurface";
import { CampaignHome } from "./CampaignHome";
import { ConnectionGraph } from "./RelationshipGraph";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { PinDetails } from "./PinDetails";
import { PlayerCalendarView } from "./CalendarView";
import { PlayerDowntimeView } from "./DowntimeView";
import { CommandPalette } from "./CommandPalette";
import { SidebarNav } from "./SidebarNav";
import { TagView } from "./TagView";
import { NotFoundView } from "../components/NotFoundView";
import { playerCampaignFeedProps } from "./dashboard";
import { PLAYER_SIDEBAR, SECTION_TITLE, atlasPath, codexSectionOf, journalEntryPath, pagePath, pathForHit, pathForSection, questPath, recordIdOf, sessionPath, tagPath } from "./routes";
import { discardTransient, navigate, popTransient, pushTransient, releaseStrandedEntry, replaceQuery, useRoute } from "../router";
import { entityDef, type EntityType } from "./entities";
import "./codex.css";

/**
 * D4/D14 — the player Codex: **a first-class surface, on the same sidebar and in the same words.**
 *
 * It used to be five tabs (one called "Lore") inside a modal the player opened from a button. It is now
 * a full view of the player app with the GM's own navigation minus the Tools group, at the same
 * addresses — so a player and their GM can say "look at the Atlas" and mean one thing.
 *
 * **Every read on this surface goes through `playerCodexApi` and nothing else.** `questApi`, `codexApi`,
 * `journalApi` and `sessionApi` are GM feeds and are not imported here. That is the whole of this
 * surface's viewer safety: everything it renders is a field of a row the server chose to send THIS
 * token, so there is no GM body to hide because there was never one to receive.
 *
 * Reading rules (`chronicleWhenLabel`, `CHRONICLE_KIND_META`, `groupChronicle`) are imported rather than
 * re-stated: the two readers are separate implementations, but they must not disagree about what a row
 * *says*.
 */
export function PlayerCodex({ token, embedded = false }: Readonly<{ token: string; embedded?: boolean }>) {
  /**
   * The GM's "Preview as player" mounts this component inside a modal, on a real minted player token.
   * It must NOT drive the browser address — the GM is still on their own page — so an embedded instance
   * runs on a local route instead. Same component, same reads, same projections; only the history
   * mechanism differs, which is the one thing a preview must not share.
   */
  const globalRoute = useRoute();
  const [localPath, setLocalPath] = useState("/codex");
  const path = embedded ? localPath.split("?")[0] : globalRoute.path;
  const query = useMemo(
    () => (embedded ? new URLSearchParams(localPath.split("?")[1] ?? "") : globalRoute.query),
    [embedded, localPath, globalRoute.query]
  );
  const go = useCallback((next: string) => { if (embedded) setLocalPath(next); else navigate(next); }, [embedded]);
  const setQuery = useCallback((mutate: (params: URLSearchParams) => void) => {
    if (!embedded) { replaceQuery(mutate); return; }
    const [base, search] = localPath.split("?");
    const params = new URLSearchParams(search ?? "");
    mutate(params);
    const next = params.toString();
    setLocalPath(next ? `${base}?${next}` : base);
  }, [embedded, localPath]);

  const segments = path.split("/").filter(Boolean);
  const section = codexSectionOf(segments);
  const recordId = recordIdOf(segments);
  /**
   * Invariant §3.2: a player asking for a GM-only address gets the **not-found view**, byte-identical to
   * an unknown address. An address must never confirm that a surface exists.
   */
  const gmOnly = section === "audit" || section === "backup" || section === "settings";

  const [pages, setPages] = useState<PlayerCodexPageSummary[]>([]);
  const [connections, setConnections] = useState<PlayerCodexConnection[]>([]);
  const [page, setPage] = useState<PlayerCodexPage | null>(null);
  const [pageConnections, setPageConnections] = useState<PlayerCodexPageConnection[]>([]);
  const [maps, setMaps] = useState<PlayerCodexMap[]>([]);
  const [markers, setMarkers] = useState<PlayerCodexMarker[]>([]);
  const [timeline, setTimeline] = useState<PlayerCodexChronicleRecord[]>([]);
  const [calendar, setCalendar] = useState<CodexCalendar | null>(null);
  const [sessions, setSessions] = useState<PlayerCodexSession[]>([]);
  const [quests, setQuests] = useState<PlayerCodexQuest[]>([]);
  const [standing, setStanding] = useState<PlayerCodexStanding[]>([]);
  const [party, setParty] = useState<{ marker: PlayerCodexMarker; mapName: string } | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<EntityType | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextPages, nextMaps, nextTimeline, nextConnections, nextCalendar, nextSessions, nextQuests, nextStanding, nextParty] = await Promise.all([
        playerCodexApi.listPages(token), playerCodexApi.listMaps(token), playerCodexApi.chronicle(token),
        playerCodexApi.listConnections(token),
        // A missing calendar costs one chip; it must not cost the player the whole codex.
        playerCodexApi.calendar(token).catch(() => null),
        playerCodexApi.sessions(token).catch(() => []),
        playerCodexApi.quests(token).catch(() => []),
        playerCodexApi.standing(token).catch(() => []),
        // D15: null covers BOTH "no party pin" and "the party pin is hidden from you" — the server makes
        // those indistinguishable on purpose, and so does this card.
        playerCodexApi.party(token).catch(() => null)
      ]);
      setPages(nextPages); setMaps(nextMaps); setTimeline(nextTimeline); setConnections(nextConnections);
      setCalendar(nextCalendar); setSessions(nextSessions); setQuests(nextQuests); setStanding(nextStanding); setParty(nextParty);
      setError(null);
    } catch { setError("Couldn't load the Codex — check your connection to the table."); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load().catch(() => undefined); }, [load]);
  useEffect(() => { const onChanged = () => { void load().catch(() => undefined); }; socket.on("codex:changed", onChanged); return () => { socket.off("codex:changed", onChanged); }; }, [load]);

  // ----- Pages -----
  useEffect(() => {
    if (section !== "pages" || !recordId) { setPage(null); setPageConnections([]); return; }
    let live = true;
    void playerCodexApi.getPage(token, recordId)
      .then((result) => { if (live) { setPage(result.page); setPageConnections(result.connections); } })
      .catch(() => { if (live) { setPage(null); setPageConnections([]); } });
    return () => { live = false; };
  }, [token, section, recordId]);

  // ----- Atlas -----
  const rootMaps = useMemo(() => maps.filter((map) => map.parentMapId === null), [maps]);
  const currentMapId = section === "atlas" ? (recordId ?? rootMaps[0]?.id ?? maps[0]?.id ?? null) : null;
  useEffect(() => {
    if (!currentMapId) { setMarkers([]); return; }
    let live = true;
    void playerCodexApi.listMarkers(token, currentMapId).then((next) => { if (live) setMarkers(next); }).catch(() => { if (live) setMarkers([]); });
    return () => { live = false; };
  }, [token, currentMapId]);
  const currentMap = maps.find((map) => map.id === currentMapId) ?? null;
  const selectedPinId = query.get("pin");
  const selectedPin = markers.find((marker) => marker.id === selectedPinId) ?? null;
  const breadcrumb = useMemo(() => {
    const chain: PlayerCodexMap[] = []; let cursor = currentMap; const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) { chain.unshift(cursor); guard.add(cursor.id); cursor = maps.find((map) => map.id === cursor!.parentMapId) ?? null; }
    return chain;
  }, [currentMap, maps]);
  const childMaps = useMemo(() => (currentMapId ? maps.filter((map) => map.parentMapId === currentMapId) : []), [maps, currentMapId]);

  // ----- Search -----
  const runSearch = useCallback((text: string) => playerCodexApi.search(token, text), [token]);
  const searchState = useCodexSearch(search, runSearch, pages);
  const knownTitles = useMemo(() => new Set(pages.map((summary) => summary.title.trim().toLowerCase())), [pages]);
  const followLink = useCallback((target: string) => {
    const match = pages.find((candidate) => candidate.title.trim().toLowerCase() === target.trim().toLowerCase());
    if (match) go(pagePath(match.id));
  }, [pages, go]);

  const dash = useMemo(
    () => playerCampaignFeedProps({ records: timeline, today: calendar?.currentDate ? formatWorldDate(calendar, calendar.currentDate) : null }),
    [timeline, calendar]
  );
  const campaignStanding = useMemo(
    () => standing
      .map((row) => ({ row, summary: pages.find((candidate) => candidate.id === row.factionPageId) }))
      // A standing whose faction page has NOT been revealed is dropped rather than rendered nameless — a
      // bar reading "Hunted" with no name tells the table something is hunting them that they have never
      // heard of. The server's projection is the gate; this can only ever narrow.
      .filter((pair): pair is { row: PlayerCodexStanding; summary: PlayerCodexPageSummary } => Boolean(pair.summary))
      .map(({ row, summary }) => ({ factionPageId: row.factionPageId, name: summary.title, value: row.value })),
    [standing, pages]
  );

  const openDrawer = () => { setDrawerOpen(true); if (!embedded) pushTransient("player-codex-nav", () => setDrawerOpen(false)); };
  const closeDrawer = () => { setDrawerOpen(false); if (!embedded) popTransient("player-codex-nav"); };
  /**
   * Same fix as the GM shell: `closeDrawer` goes BACK, which raced the push and lost the destination on
   * every phone-drawer tap. Discard the entry and replace it with where we are going.
   */
  const goto = (next: string) => {
    const stranded = !embedded && discardTransient("player-codex-nav");
    setDrawerOpen(false);
    if (embedded) { setLocalPath(next); return; }
    // A vetoed navigation leaves the released drawer entry on the stack with nothing to absorb it, so
    // the next Back press would be swallowed. Same reasoning as the GM shell.
    void navigate(next, { replace: stranded }).then((moved) => { if (!moved && stranded) releaseStrandedEntry(); });
  };

  useEffect(() => {
    if (embedded) return;
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen((open) => !open); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [embedded]);

  const sidebarHeader = (
    <button type="button" className="codex-sidebar-search" onClick={() => { closeDrawer(); setPaletteOpen(true); }} aria-keyshortcuts="Meta+K Control+K">
      <CodexIcon iconId="eye" className="codex-navitem-icon codex-sidebar-searchglyph" aria-hidden="true" />
      <span className="codex-navitem-label">Search</span>
      {!embedded && <Kbd>⌘K</Kbd>}
    </button>
  );
  const nav = <SidebarNav groups={PLAYER_SIDEBAR} activePath={path} onNavigate={goto} header={sidebarHeader} />;

  return (
    <div className={`codex-root codex-player codex-shell${embedded ? " is-embedded" : ""}`}>
      <aside className="codex-shell-side">{nav}</aside>
      <Drawer open={drawerOpen} onClose={closeDrawer} side="left" title="Codex" className="codex-navdrawer">{nav}</Drawer>

      <div className="codex-shell-main">
        <div className="codex-topbar">
          <IconButton label="Codex sections" className="codex-topbar-menu" onClick={openDrawer}><CodexIcon iconId="menu" className="codex-navitem-icon" /></IconButton>
          <h2 className="codex-topbar-title">{section ? SECTION_TITLE[section] : "Codex"}</h2>
          <div className="codex-topbar-actions">
            <IconButton label="Search" className="codex-topbar-search" onClick={() => setPaletteOpen(true)}><CodexIcon iconId="eye" className="codex-navitem-icon" /></IconButton>
          </div>
        </div>

        {error && <Alert tone="danger" title="Couldn't load the Codex">{error}</Alert>}

        <div className="codex-shell-content">
          {(section === null || gmOnly) && <NotFoundView role="player" />}

          {section === "home" && !gmOnly && (
            <CampaignHome pages={pages} entries={dash.entries} maps={maps} today={dash.today} loading={loading} showReveal={false}
              /* A player only ever sees a session whose recap has been revealed, which is by definition
                 one that has already happened — so the heading is stated rather than inferred. */
              session={(() => { const next = pickNextSession(sessions); return next && { ...next, heading: "Latest recap" }; })()}
              onOpenSession={(sessionId) => go(sessionPath(sessionId))}
              quests={quests}
              onOpenQuest={(questId) => go(questPath(questId))}
              deadlines={dash.deadlines}
              party={party ? { label: party.marker.label, mapId: party.marker.mapId, mapName: party.mapName, markerId: party.marker.id } : null}
              onOpenParty={(mapId, markerId) => go(atlasPath(mapId, markerId))}
              standing={campaignStanding}
              onOpenPage={(pageId) => go(pagePath(pageId))}
              onOpenEntry={(entryId) => go(journalEntryPath(entryId))}
              onOpenMap={(mapId) => go(atlasPath(mapId))}
              onSeeAll={(target) => go(pathForSection(target === "recent" ? "pages" : target === "deadlines" ? "journal" : target === "atlas" ? "atlas" : target))}
              onPickType={(type) => { setTypeFilter(type); go(pathForSection("pages")); }}
              onPickTag={(tag) => go(tagPath(tag))} />
          )}

          {section === "pages" && (
            <div className={`codex-workspace${recordId ? " has-selection" : ""}`}>
              <aside className="codex-rail">
                <div className="codex-rail-head">
                  <Input value={search} placeholder="Search what you know…" aria-label="Search the Codex"
                    onChange={(event) => { setSearch(event.target.value); if (event.target.value.trim()) setTypeFilter(null); }} />
                </div>
                <nav className="codex-list" aria-label="Pages">
                  {search.trim()
                    ? <SearchResultList state={searchState} selectedId={recordId} onOpen={(hit) => go(pathForHit(hit))} emptyLabel="Nothing you know matches that." />
                    : <>
                        {typeFilter && <Chip onRemove={() => setTypeFilter(null)} removeLabel="Clear filter">{entityDef(typeFilter).label}s</Chip>}
                        {loading && <div className="codex-list-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>}
                        {!loading && pages.length === 0 && <p className="codex-list-empty">Nothing shared yet.</p>}
                        {pages.filter((summary) => !typeFilter || summary.entityType === typeFilter).map((summary) => (
                          <button key={summary.id} type="button" className={`codex-list-item${summary.id === recordId ? " is-active" : ""}`} onClick={() => go(pagePath(summary.id))}>
                            {summary.entityType !== "note" && <EntityIcon type={summary.entityType} />}
                            <span className="codex-list-title">{summary.title}</span>
                          </button>
                        ))}
                      </>}
                </nav>
              </aside>
              <section className="codex-main">
                {recordId && <Button variant="ghost" size="sm" className="codex-back" onClick={() => go(pathForSection("pages"))}>‹ All pages</Button>}
                {page
                  ? <article className="codex-reader">
                      {page.bannerAssetId && <CodexImage assetId={page.bannerAssetId} token={token} alt="" className="codex-banner-img" />}
                      <h2 className="codex-reader-title">{page.entityType !== "note" && <EntityIcon type={page.entityType} className="codex-reader-titleicon" />}{page.title}</h2>
                      {page.tags.length > 0 && (
                        <div className="codex-editor-tagjumps">
                          {page.tags.map((tag) => <button key={tag} type="button" className="codex-tag-chip tap-target" onClick={() => go(tagPath(tag))}>{tag}</button>)}
                        </div>
                      )}
                      {Object.entries(page.fields).length > 0 && (
                        <dl className="codex-reader-fields">
                          {Object.entries(page.fields).map(([key, value]) => {
                            const def = entityDef(page.entityType).fields.find((field) => field.key === key);
                            return <div key={key} className="codex-reader-field"><dt>{def?.label ?? key}</dt><dd>{value}</dd></div>;
                          })}
                        </dl>
                      )}
                      <div className="codex-reader-body">{page.body.trim() ? <CodexMarkdown text={page.body} onNavigate={followLink} token={token} knownTitles={knownTitles} /> : <p className="codex-preview-empty">Nothing written here yet.</p>}</div>
                      {/* D14: the SAME connections panel the GM sees, over the revealed-edges-only feed
                          and with no `write` prop — read-only by construction, not by a role check. */}
                      <div className="codex-reader-rels">
                        <ConnectionsPanel connections={pageConnections} onOpen={(kind, id) => go(
                          kind === "page" ? pagePath(id) : kind === "session" ? sessionPath(id) : kind === "quest" ? questPath(id) : journalEntryPath(id)
                        )} />
                      </div>
                    </article>
                  : <div className="codex-main-empty"><h3>Select a page</h3><p>Choose a page from the list to read it.</p></div>}
              </section>
            </div>
          )}

          {section === "atlas" && (
            <div className="codex-atlas">
              {rootMaps.length > 1 && (
                <nav className="codex-atlas-descend" aria-label="Top-level maps">
                  <span className="codex-descend-label">Top level</span>
                  {rootMaps.map((root) => (
                    <button key={root.id} type="button" className={`codex-descend-chip${root.id === breadcrumb[0]?.id ? " is-current" : ""}`}
                      aria-current={root.id === breadcrumb[0]?.id ? "true" : undefined} onClick={() => go(atlasPath(root.id))}>{root.name}</button>
                  ))}
                </nav>
              )}
              <nav className="codex-breadcrumb" aria-label="Map path">
                {breadcrumb.length === 0 && <span className="codex-crumb is-current">Atlas</span>}
                {breadcrumb.map((map, index) => <span key={map.id}>{index > 0 && <span className="codex-crumb-sep">›</span>}<button type="button" className={`codex-crumb${map.id === currentMapId ? " is-current" : ""}`} onClick={() => go(atlasPath(map.id))}>{map.name}</button></span>)}
              </nav>
              {childMaps.length > 0 && (
                <nav className="codex-atlas-descend" aria-label="Maps within this one">
                  <span className="codex-descend-label">Drill into</span>
                  {childMaps.map((child) => (
                    <button key={child.id} type="button" className="codex-descend-chip" onClick={() => go(atlasPath(child.id))}>
                      <span className="codex-descend-arrow" aria-hidden="true" />{child.name}
                    </button>
                  ))}
                </nav>
              )}
              <div className="codex-atlas-body">
                {currentMap
                  ? <MapSurface token={token} assetId={currentMap.assetId} markers={markers} placing={false} readOnly selectedMarkerId={selectedPinId}
                      onBackgroundClick={() => undefined}
                      onMarkerClick={(markerId) => setQuery((params) => params.set("pin", markerId))}
                      onMarkerDragEnd={() => undefined} />
                  : <div className="codex-main-empty"><h3>No maps yet</h3><p>Maps your GM shares appear here.</p></div>}
                {/* D14 / G24: a pin tap used to open its FIRST linked page and drop everything else. It
                    now opens details: the label, the tags, and every revealed page it links to. */}
                {selectedPin && (
                  <PinDetails pin={selectedPin} pages={pages} maps={maps}
                    onOpenPage={(pageId) => go(pagePath(pageId))}
                    onOpenMap={(mapId) => go(atlasPath(mapId))}
                    onClose={() => setQuery((params) => params.delete("pin"))} />
                )}
              </div>
            </div>
          )}

          {section === "graph" && (
            <ConnectionGraph loading={loading}
              nodes={pages.map((summary) => ({ id: summary.id, title: summary.title, entityType: summary.entityType }))}
              connections={connections} onOpen={(pageId) => go(pagePath(pageId))}
              focusPageId={query.get("focus")} onFocused={() => setQuery((params) => params.delete("focus"))}
              emptyState={<><h3>Nothing connected yet</h3><p>As your GM shares people and places, the links between them appear here.</p></>} />
          )}

          {section === "sessions" && (
            <PlayerSessions sessions={sessions} loading={loading} openId={recordId} token={token}
              onOpen={(id) => go(id ? sessionPath(id) : pathForSection("sessions"))} onNavigate={followLink} knownTitles={knownTitles} />
          )}

          {section === "quests" && (
            <PlayerQuests quests={quests} pages={pages} loading={loading} openId={recordId} token={token}
              onOpen={(id) => go(id ? questPath(id) : pathForSection("quests"))} onOpenPage={(pageId) => go(pagePath(pageId))}
              onNavigate={followLink} knownTitles={knownTitles} />
          )}

          {section === "journal" && (
            <PlayerJournal records={timeline} calendar={calendar} pages={pages} token={token}
              focusedId={query.get("entry")} onNavigate={followLink} knownTitles={knownTitles}
              quests={quests} />
          )}

          {section === "calendar" && (
            <PlayerCalendarView calendar={calendar} records={timeline}
              year={query.get("y")} month={query.get("m")}
              onMonthChange={(year, month) => setQuery((params) => { params.set("y", String(year)); params.set("m", String(month)); })}
              onOpenEntry={(entryId) => go(journalEntryPath(entryId))} />
          )}

          {section === "downtime" && (
            <PlayerDowntimeView records={timeline} pages={pages}
              onOpenEntry={(entryId) => go(journalEntryPath(entryId))} onOpenPage={(pageId) => go(pagePath(pageId))} />
          )}

          {section === "tags" && (
            <TagView gmToken={token} player tag={decodeURIComponent(segments[2] ?? "")}
              pages={pages.map((summary) => ({ ...summary, revealedToPlayers: true, entityType: summary.entityType, fields: {}, inWorldLabel: null, calendarInstant: null, inWorldDate: null, rev: 0, createdAt: summary.updatedAt })) as never}
              maps={maps.map((map) => ({ ...map, revealedToPlayers: true, sortKey: 0, createdAt: "", updatedAt: "" })) as never}
              records={timeline as never} sessions={sessions as never} quests={quests as never}
              onNavigate={go} />
          )}
        </div>
      </div>

      {paletteOpen && (
        <CommandPalette gmToken={token} player
          onOpenHit={(hit: CodexSearchHit) => go(pathForHit(hit))}
          onNavigate={go}
          onClose={() => setPaletteOpen(false)} />
      )}
    </div>
  );
}

/** D14: revealed sessions, recap rendered as markdown like every other body in the suite. */
function PlayerSessions({ sessions, loading, openId, token, onOpen, onNavigate, knownTitles }: Readonly<{
  sessions: readonly PlayerCodexSession[]; loading: boolean; openId: string | null; token: string;
  onOpen: (id: string | null) => void; onNavigate: (target: string) => void; knownTitles: ReadonlySet<string>;
}>) {
  const open = openId ? sessions.find((session) => session.id === openId) ?? null : null;
  return (
    <div className={`codex-workspace${open ? " has-selection" : ""}`}>
      <aside className="codex-rail">
        <div className="codex-rail-head"><strong className="codex-sessions-railtitle">Sessions</strong></div>
        <nav className="codex-list" aria-label="Sessions">
          {loading && sessions.length === 0 && <div className="codex-list-loading">{[0, 1].map((row) => <Skeleton key={row} variant="text" />)}</div>}
          {!loading && sessions.length === 0 && <p className="codex-list-empty">No recaps shared yet.</p>}
          {sessions.map((session) => (
            <button key={session.id} type="button" aria-current={session.id === open?.id ? "true" : undefined}
              className={`codex-session-row${session.id === open?.id ? " is-active" : ""}`} onClick={() => onOpen(session.id)}>
              <span className="codex-list-title">{sessionTitle(session)}</span>
              {session.realDate && <span className="codex-campaign-recentwhen">{session.realDate}</span>}
            </button>
          ))}
        </nav>
      </aside>
      <section className="codex-main">
        {open && <Button variant="ghost" size="sm" className="codex-back" onClick={() => onOpen(null)}>‹ All sessions</Button>}
        {open
          ? <article className="codex-reader">
              <h2 className="codex-reader-title">{sessionTitle(open)}</h2>
              {open.realDate && <div className="codex-entry-meta"><span className="codex-entry-when">{open.realDate}</span></div>}
              {open.tags.length > 0 && <div className="codex-entry-meta">{open.tags.map((tag) => <span key={tag} className="codex-hit-tag">#{tag}</span>)}</div>}
              <div className="codex-reader-body">{open.recap.trim() ? <CodexMarkdown text={open.recap} onNavigate={onNavigate} token={token} knownTitles={knownTitles} /> : <p className="codex-preview-empty">No recap written yet.</p>}</div>
            </article>
          : <div className="codex-main-empty"><h3>Pick a session</h3><p>Everything your GM has written up about a game night is here.</p></div>}
      </section>
    </div>
  );
}

/** D14: quest bodies render as markdown now, the same as every other body in the suite. */
function PlayerQuests({ quests, pages, loading, openId, token, onOpen, onOpenPage, onNavigate, knownTitles }: Readonly<{
  quests: readonly PlayerCodexQuest[]; pages: readonly PlayerCodexPageSummary[]; loading: boolean; openId: string | null; token: string;
  onOpen: (id: string | null) => void; onOpenPage: (pageId: string) => void; onNavigate: (target: string) => void; knownTitles: ReadonlySet<string>;
}>) {
  const open = openId ? quests.find((quest) => quest.id === openId) ?? null : null;
  const questPages = (open?.entityIds ?? []).map((id) => pages.find((summary) => summary.id === id)).filter((summary): summary is PlayerCodexPageSummary => Boolean(summary));
  return (
    <div className={`codex-workspace${open ? " has-selection" : ""}`}>
      <aside className="codex-rail">
        <div className="codex-rail-head"><strong className="codex-sessions-railtitle">Quests</strong></div>
        <nav className="codex-list" aria-label="Quests">
          {loading && quests.length === 0 && <div className="codex-list-loading">{[0, 1].map((row) => <Skeleton key={row} variant="text" />)}</div>}
          {!loading && quests.length === 0 && <p className="codex-list-empty">No quests shared yet.</p>}
          {quests.map((quest) => (
            <button key={quest.id} type="button" aria-current={quest.id === open?.id ? "true" : undefined}
              className={`codex-quest-row${quest.id === open?.id ? " is-active" : ""}`} onClick={() => onOpen(quest.id)}>
              <CodexIcon iconId="quest" className="codex-ent-icon codex-quest-rowglyph" />
              <span className="codex-list-title">{quest.title}</span>
              <Badge tone={questStatusTone(quest.status)}>{QUEST_STATUS_LABEL[quest.status]}</Badge>
            </button>
          ))}
        </nav>
      </aside>
      <section className="codex-main">
        {open && <Button variant="ghost" size="sm" className="codex-back" onClick={() => onOpen(null)}>‹ All quests</Button>}
        {open
          ? <article className="codex-reader">
              <h2 className="codex-reader-title"><CodexIcon iconId="quest" className="codex-reader-titleicon codex-quest-rowglyph" />{open.title}</h2>
              <div className="codex-entry-meta">
                <Badge tone={questStatusTone(open.status)}>{QUEST_STATUS_LABEL[open.status]}</Badge>
                {open.objectives.length > 0 && <span className="codex-quest-progress">{questProgress(open.objectives).label}</span>}
              </div>
              <div className="codex-reader-body">{open.body.trim() ? <CodexMarkdown text={open.body} onNavigate={onNavigate} token={token} knownTitles={knownTitles} /> : <p className="codex-preview-empty">Nothing written here yet.</p>}</div>
              {open.objectives.length > 0 && (
                <div className="codex-quest-objectives">
                  <h4 className="codex-quest-subhead">Objectives</h4>
                  {/* READ-ONLY: `onChange` omitted, so the primitive renders no checkbox and nothing focusable. */}
                  <Checklist items={open.objectives} ariaLabel={`Objectives for ${open.title}`} />
                </div>
              )}
              {questPages.length > 0 && (
                <div className="codex-reader-rels">
                  <h4 className="codex-backlinks-title">What this concerns</h4>
                  <div className="codex-quest-links">
                    {questPages.map((summary) => (
                      <button key={summary.id} type="button" className="codex-quest-link-open" onClick={() => onOpenPage(summary.id)}>
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
  );
}

/**
 * D14 — the player's Journal, with **the GM's grouping and the GM's Today marker.**
 *
 * The lens toggle used to be GM-only, on the argument that grouping by in-world year needed a sort key
 * the player projection did not carry. Ruling R3 put `calendarInstant` on the player row (a pure
 * function of already-projected data), so the same `groupChronicle` runs here unmodified — no client
 * date arithmetic, and no second chronology.
 */
function PlayerJournal({ records, calendar, pages, token, focusedId, onNavigate, knownTitles, quests }: Readonly<{
  records: readonly PlayerCodexChronicleRecord[];
  calendar: CodexCalendar | null;
  pages: readonly PlayerCodexPageSummary[];
  token: string;
  focusedId: string | null;
  onNavigate: (target: string) => void;
  knownTitles: ReadonlySet<string>;
  quests: readonly PlayerCodexQuest[];
}>) {
  useEffect(() => {
    if (!focusedId) return;
    document.getElementById(`codex-player-entry-${focusedId}`)?.scrollIntoView({ block: "center" });
  }, [focusedId, records]);

  /** Grouped by in-world YEAR, using the server's own instants — never a client re-derivation. */
  const groups = useMemo(() => {
    const buckets = new Map<number | null, PlayerCodexChronicleRecord[]>();
    const perYear = calendar ? calendar.months.reduce((sum, month) => sum + month.days, 0) || 1 : 1;
    for (const record of records) {
      const key = record.calendarInstant !== null && calendar ? Math.floor(record.calendarInstant / perYear) : null;
      const bucket = buckets.get(key) ?? [];
      bucket.push(record); buckets.set(key, bucket);
    }
    return [...buckets.keys()]
      .sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b))
      .map((key) => ({ key: key === null ? "none" : String(key), label: key === null ? "Undated" : `${key}${calendar?.yearName ? ` ${calendar.yearName}` : ""}`, records: buckets.get(key)! }));
  }, [records, calendar]);
  const todayYear = calendar?.currentDate
    ? Math.floor(((calendar.months.slice(0, calendar.currentDate.month).reduce((sum, month) => sum + month.days, 0) + calendar.currentDate.day - 1) + calendar.currentDate.year * (calendar.months.reduce((sum, month) => sum + month.days, 0) || 1)) / (calendar.months.reduce((sum, month) => sum + month.days, 0) || 1))
    : null;
  const todayLabel = calendar?.currentDate ? formatWorldDate(calendar, calendar.currentDate) : null;

  return (
    <div className="codex-journal">
      <div className="codex-timeline">
        {records.length === 0 && <p className="codex-list-empty">No entries shared yet.</p>}
        {groups.map((group) => (
          <section key={group.key} className="codex-timeline-group">
            <div className="codex-timeline-year">{group.label}</div>
            {todayYear !== null && group.key === String(todayYear) && <div className="codex-timeline-now">Today — {todayLabel}</div>}
            {group.records.map((record) => {
              const meta = CHRONICLE_KIND_META[record.kind];
              const fired = deadlineFired(record);
              const downtime = downtimeOf(record);
              const milestone = milestoneOf(record);
              const standingChange = standingOf(record);
              const questEvent = questEventOf(record);
              return (
                <article key={`${record.kind}-${record.id}`} id={`codex-player-entry-${record.id}`} aria-current={record.id === focusedId ? "true" : undefined}
                  className={`codex-entry${record.kind === "combat" ? " is-combat" : ""}${record.kind === "event" ? " is-event" : ""}${record.kind === "deadline" ? " is-deadline" : ""}${downtime ? " is-downtime" : ""}${record.id === focusedId ? " is-focused" : ""}`}>
                  <header className="codex-entry-head codex-entry-meta">
                    <CodexIcon iconId={meta.iconId} className="codex-ent-icon codex-entry-kindglyph" />
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {record.kind === "deadline" && <Badge tone={deadlineStateTone(fired)}>{deadlineStateLabel(fired)}</Badge>}
                    <span className="codex-entry-when">{chronicleWhenLabel(record)}</span>
                  </header>
                  {record.title && <h4 className="codex-entry-title">{record.title}</h4>}
                  <div className="codex-entry-body"><CodexMarkdown text={record.text} onNavigate={onNavigate} token={token} knownTitles={knownTitles} /></div>
                  {downtime && <p className="codex-downtime-what">{downtimeSummaryLabel(downtime)}</p>}
                  {milestone && <p className="codex-downtime-what">{milestoneSummaryLabel(milestone)}</p>}
                  {standingChange && <p className="codex-downtime-what">{standingChangeLabel(standingChange, pages.find((summary) => summary.id === standingChange.factionPageId)?.title ?? null)}</p>}
                  {/* D11: a quest-history row carries no prose, so this line IS the record. The title is
                      resolved against the player's OWN quest feed; an id they cannot see falls back to
                      the shared label's "A quest" rather than to a name they were never given. */}
                  {questEvent && <p className="codex-downtime-what">{questEventLabel(questEvent, quests.find((quest) => quest.id === questEvent.questId)?.title ?? null)}</p>}
                </article>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Checklist, Chip, Combobox, Drawer, IconButton, IconChevron, Input, Kbd, Select, Skeleton } from "@vtt/ui";
import { socket } from "../socket";
import {
  formatWorldDate, playerCodexApi,
  type CodexCalendar, type CodexSearchHit, type PlayerCodexChronicleRecord, type PlayerCodexConnection,
  type PlayerCodexMap, type PlayerCodexMarker, type PlayerCodexPage, type PlayerCodexPageConnection,
  type PlayerCodexPageSummary, type PlayerCodexQuest, type PlayerCodexSession, type PlayerCodexStanding
} from "./api";
import { CHRONICLE_FILTER_KINDS, CHRONICLE_KIND_META, chronicleWhenLabel, deadlineFired, deadlineStateLabel, deadlineStateTone, downtimeOf, downtimeSummaryLabel, milestoneOf, milestoneSummaryLabel, questEventLabel, questEventOf, standingChangeLabel, standingOf } from "./chronicle";
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
import { SidebarCollapseToggle, SidebarNav } from "./SidebarNav";
import { useSidebarRailBand } from "./useSidebarRail";
import { TagView } from "./TagView";
import { NotFoundView } from "../components/NotFoundView";
import { TagChip } from "./TagChip";
import { playerCampaignFeedProps } from "./dashboard";
import { PLAYER_SIDEBAR, SECTION_TITLE, atlasPath, codexSectionOf, journalEntryPath, pagePath, pathForHit, pathForSection, questPath, recordIdOf, sessionPath, tagPath } from "./routes";
import { discardTransient, navigate, popTransient, pushTransient, releaseStrandedEntry, replaceQuery, useRoute, withQuery } from "../router";
import { ENTITY_TYPE_LIST, entityDef, type EntityType } from "./entities";
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
const PLAYER_SIDEBAR_KEY = "codex-player-sidebar";

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
  /**
   * D10 — **the filters are the player's too, and they live in the address like the GM's.**
   *
   * D10's "in-place search/filter on every list" landed on the GM's five lists and none of these: the
   * kind filter was component state that only the dashboard could set (so a player who cleared it could
   * not set it again), and Sessions, Quests and the Journal had no filter at all. Same controls, same
   * words, same `?type=` / `?q=` / `?status=` / `?kind=` parameters, read through `query` so they survive
   * a refresh here exactly as they do for the GM — and through `setQuery`, so the GM's embedded preview
   * keeps its own local address rather than driving the browser's.
   */
  const typeFilter = (query.get("type") as EntityType | null) ?? null;
  const textFilter = query.get("q") ?? "";
  const statusFilter = query.get("status");
  const kindFilter = query.get("kind");
  const setFilter = useCallback((next: Readonly<Record<string, string | null>>) => {
    setQuery((params) => {
      for (const [key, value] of Object.entries(next)) { if (value) params.set(key, value); else params.delete(key); }
    });
  }, [setQuery]);

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
    } catch { setError("Couldn't load the Codex. Check your connection and try again."); }
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
  /** D10's Atlas filter, client-side over the pins already fetched for this map — it costs no read. */
  const pinTags = useMemo(() => [...new Set(markers.flatMap((pin) => pin.tags))].sort(), [markers]);
  const dimmedPinIds = useMemo(() => {
    const needle = query.get("q")?.trim().toLowerCase() ?? "";
    const tag = query.get("tag");
    if (!needle && !tag) return null;
    const matches = (pin: PlayerCodexMarker) =>
      (!needle || (pin.label ?? "").toLowerCase().includes(needle) || pin.tags.some((each) => each.includes(needle)))
      && (!tag || pin.tags.includes(tag));
    return new Set(markers.filter((pin) => !matches(pin)).map((pin) => pin.id));
  }, [markers, query]);
  const selectedPinId = query.get("pin");
  const selectedPin = markers.find((marker) => marker.id === selectedPinId) ?? null;
  const breadcrumb = useMemo(() => {
    const chain: PlayerCodexMap[] = []; let cursor = currentMap; const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) { chain.unshift(cursor); guard.add(cursor.id); cursor = maps.find((map) => map.id === cursor!.parentMapId) ?? null; }
    return chain;
  }, [currentMap, maps]);
  const childMaps = useMemo(() => (currentMapId ? maps.filter((map) => map.parentMapId === currentMapId) : []), [maps, currentMapId]);

  // ----- Pages: D10's in-place filters, client-side over the pages already fetched -----
  const playerPageTags = useMemo(() => [...new Set(pages.flatMap((summary) => summary.tags))].sort(), [pages]);
  const shownPages = useMemo(() => {
    const tag = query.get("tag");
    return pages.filter((summary) => (!typeFilter || summary.entityType === typeFilter) && (!tag || summary.tags.includes(tag)));
  }, [pages, typeFilter, query]);

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

  /**
   * The same forced rail the GM shell uses. It matters MORE here: a player has no collapse control and
   * no persisted preference, so before this an iPad in portrait gave them the crushed strip with no way
   * out of it at all. The embedded preview is exempt — it renders inside a modal, not at the viewport.
   */
  const railBand = useSidebarRailBand() && !embedded;
  /**
   * D1 says the sidebar is **collapsible**, and the player's mirrors the GM's "minus GM tools" — a
   * collapse control is not a GM tool. The player had none: a laptop player got the full 220px rail with
   * no way to reclaim the width, which is the same complaint in the opposite direction from the one the
   * band fix answered. Same control, same words, same preference, its own storage key.
   *
   * **Never inside the embedded preview.** That instance renders in the GM's modal rather than at the
   * viewport, so a rail there would describe nothing the player will see, and the preference it wrote
   * would be the GM's rather than the player's.
   */
  const [sidebarMode, setSidebarMode] = useState<"open" | "rail">(() => {
    try { return localStorage.getItem(PLAYER_SIDEBAR_KEY) === "rail" ? "rail" : "open"; } catch { return "open"; }
  });
  useEffect(() => {
    if (embedded) return;
    try { localStorage.setItem(PLAYER_SIDEBAR_KEY, sidebarMode); } catch { /* private mode - fine */ }
  }, [sidebarMode, embedded]);
  const collapsed = railBand || (!embedded && sidebarMode === "rail");
  const sidebarHeader = (
    <button type="button" className="codex-sidebar-search" onClick={() => { closeDrawer(); setPaletteOpen(true); }} aria-keyshortcuts="Meta+K Control+K"
      title={collapsed ? "Search" : undefined} aria-label={collapsed ? "Search" : undefined}>
      <CodexIcon iconId="search" className="codex-navitem-icon codex-sidebar-searchglyph" aria-hidden="true" />
      {!collapsed && <span className="codex-navitem-label">Search</span>}
      {!embedded && !collapsed && <Kbd>⌘K</Kbd>}
    </button>
  );
  /* The aside is the only place the rail applies; the phone drawer (<=760px) is always expanded. */
  const nav = (asRail: boolean) => (
    <SidebarNav groups={PLAYER_SIDEBAR} activePath={path} collapsed={asRail} onNavigate={goto} header={sidebarHeader}
      /* `railBand`, never `collapsed` — see `CodexShell`: gating this on the collapsed state is what made
         the GM's collapse a one-way door, because the control that undoes it is the control being hidden. */
      footer={railBand || drawerOpen || embedded ? undefined : <SidebarCollapseToggle collapsed={sidebarMode === "rail"} onToggle={() => setSidebarMode((mode) => (mode === "rail" ? "open" : "rail"))} />} />
  );

  return (
    <div className={`codex-root codex-player codex-shell${embedded ? " is-embedded" : ""}${collapsed ? " is-rail" : ""}`}>
      <aside className="codex-shell-side">{nav(collapsed)}</aside>
      <Drawer open={drawerOpen} onClose={closeDrawer} side="left" title="Codex" className="codex-navdrawer">{nav(false)}</Drawer>

      <div className="codex-shell-main">
        <div className="codex-topbar">
          <IconButton label="Codex sections" className="codex-topbar-menu" onClick={openDrawer}><CodexIcon iconId="menu" className="codex-navitem-icon" /></IconButton>
          {/* Invariant §3.2, and the one place it leaked: a GM-only address must be INDISTINGUISHABLE from an
              address the app does not answer. `gmOnly` gated the body but not the heading, so a player who
              opened /codex/audit read "Reveal audit" above the not-found view while /codex/zzz read
              "Codex" — three GM surfaces confirmed to exist, and named, by address alone. */}
          <h2 className="codex-topbar-title">{section && !gmOnly ? SECTION_TITLE[section] : "Codex"}</h2>
          <div className="codex-topbar-actions">
            <IconButton label="Search" className="codex-topbar-search" onClick={() => setPaletteOpen(true)}><CodexIcon iconId="search" className="codex-navitem-icon" /></IconButton>
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
              /* The card sets the same `?type=` the Pages rail's own control sets — one filter, two
                 doors, and the player can now change or clear it where they landed. */
              onPickType={(type) => go(withQuery(pathForSection("pages"), { type }))}
              onPickTag={(tag) => go(tagPath(tag))} />
          )}

          {section === "pages" && (
            <div className={`codex-workspace${recordId ? " has-selection" : ""}`}>
              <aside className="codex-rail">
                <div className="codex-rail-head">
                  <Input value={search} placeholder="Search pages" aria-label="Search the Codex"
                    onChange={(event) => { setSearch(event.target.value); if (event.target.value.trim()) setFilter({ type: null, tag: null }); }} />
                </div>
                {/* D10, the same two controls the GM's Pages rail carries, in the same order and words. */}
                {!search.trim() && (
                  <div className="codex-rail-tools">
                    <Select aria-label="Filter by kind" value={typeFilter ?? ""} onChange={(event) => setFilter({ type: event.target.value || null })}>
                      <option value="">All kinds</option>
                      {ENTITY_TYPE_LIST.map((type) => <option key={type} value={type}>{entityDef(type).label}</option>)}
                    </Select>
                  </div>
                )}
                {!search.trim() && playerPageTags.length > 0 && (
                  <div className="codex-rail-tagfilter">
                    <Combobox options={playerPageTags.map((tag) => ({ id: tag, label: `#${tag}` }))} value={query.get("tag")}
                      onChange={(tag) => setFilter({ tag })} ariaLabel="Filter by tag" placeholder="Filter by tag" />
                  </div>
                )}
                <nav className="codex-list" aria-label="Pages">
                  {search.trim()
                    ? <SearchResultList state={searchState} selectedId={recordId} onOpen={(hit) => go(pathForHit(hit))} emptyLabel="No pages match." />
                    : <>
                        <div className="codex-filter-chips">
                          {typeFilter && <Chip onRemove={() => setFilter({ type: null })} removeLabel="Clear kind filter">{entityDef(typeFilter).label}s</Chip>}
                          {query.get("tag") && <Chip onRemove={() => setFilter({ tag: null })} removeLabel="Clear tag filter">#{query.get("tag")}</Chip>}
                        </div>
                        {loading && <div className="codex-list-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>}
                        {!loading && pages.length === 0 && <p className="codex-list-empty">Nothing shared yet.</p>}
                        {!loading && pages.length > 0 && shownPages.length === 0 && <p className="codex-list-empty">No pages match these filters.</p>}
                        {shownPages.map((summary) => (
                          <button key={summary.id} type="button" className={`codex-list-item${summary.id === recordId ? " is-active" : ""}`} onClick={() => go(pagePath(summary.id))}>
                            {summary.entityType !== "note" && <EntityIcon type={summary.entityType} />}
                            <span className="codex-list-title">{summary.title}</span>
                          </button>
                        ))}
                      </>}
                </nav>
              </aside>
              <section className="codex-main">
                {recordId && <Button variant="ghost" size="sm" className="codex-back" onClick={() => go(pathForSection("pages"))}><IconChevron className="codex-chevron-left" aria-hidden="true" />All pages</Button>}
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
                  : <div className="codex-main-empty"><h3>No page selected</h3><p>Choose a page from the list to read it.</p></div>}
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
                {breadcrumb.map((map, index) => <span key={map.id}>{index > 0 && <span className="codex-crumb-sep" aria-hidden="true">›</span>}<button type="button" className={`codex-crumb${map.id === currentMapId ? " is-current" : ""}`} onClick={() => go(atlasPath(map.id))}>{map.name}</button></span>)}
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
              {/* D10: the GM's pin filter, on the player's map. Non-matching pins DIM rather than
                  disappearing, for the reason the GM's does — a map with pins removed is a different
                  picture of the world, not a filtered list of one. */}
              {currentMap && markers.length > 0 && (
                <div className="codex-atlas-filter">
                  <Input aria-label="Filter pins" placeholder="Filter pins" value={textFilter}
                    onChange={(event) => setFilter({ q: event.target.value || null })} />
                  {pinTags.length > 0 && (
                    <Combobox options={pinTags.map((tag) => ({ id: tag, label: `#${tag}` }))} value={query.get("tag")}
                      onChange={(tag) => setFilter({ tag })} ariaLabel="Filter pins by tag" placeholder="Filter by tag" />
                  )}
                  {dimmedPinIds && <span className="codex-atlas-filtercount" role="status">{markers.length - dimmedPinIds.size} of {markers.length} pins match</span>}
                </div>
              )}
              <div className="codex-atlas-body">
                {currentMap
                  ? <MapSurface token={token} assetId={currentMap.assetId} markers={markers} placing={false} readOnly selectedMarkerId={selectedPinId}
                      dimmedMarkerIds={dimmedPinIds}
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
              emptyState={<><h3>Nothing connected yet</h3><p>Connections between pages appear here once your GM shows those pages to players.</p></>} />
          )}

          {section === "sessions" && (
            <PlayerSessions sessions={sessions} loading={loading} openId={recordId} token={token}
              onOpen={(id) => go(id ? sessionPath(id) : pathForSection("sessions"))} onNavigate={followLink} knownTitles={knownTitles}
              filter={textFilter} onFilterChange={setFilter}
              onPickTag={(tag) => go(tagPath(tag))} />
          )}

          {section === "quests" && (
            <PlayerQuests quests={quests} pages={pages} loading={loading} openId={recordId} token={token}
              onOpen={(id) => go(id ? questPath(id) : pathForSection("quests"))} onOpenPage={(pageId) => go(pagePath(pageId))}
              filter={textFilter} statusFilter={statusFilter} onFilterChange={setFilter}
              onNavigate={followLink} knownTitles={knownTitles} />
          )}

          {section === "journal" && (
            <PlayerJournal records={timeline} calendar={calendar} pages={pages} token={token}
              focusedId={query.get("entry")} onNavigate={followLink} knownTitles={knownTitles}
              kindFilter={kindFilter} tagFilter={query.get("tag")} textFilter={textFilter} onFilterChange={setFilter}
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

          {/* The player's real feeds, passed as they are. `TagView`'s row types make `revealedToPlayers`
              optional, so this needs no cast and no invented field — and because the rows genuinely do
              not carry a reveal state, the view is structurally unable to badge one. */}
          {section === "tags" && (
            <TagView gmToken={token} player tag={decodeURIComponent(segments[2] ?? "")}
              pages={pages} maps={maps} records={timeline} sessions={sessions} quests={quests}
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
function PlayerSessions({ sessions, loading, openId, token, onOpen, onNavigate, knownTitles, onPickTag, filter, onFilterChange }: Readonly<{
  sessions: readonly PlayerCodexSession[]; loading: boolean; openId: string | null; token: string;
  onOpen: (id: string | null) => void; onNavigate: (target: string) => void; knownTitles: ReadonlySet<string>;
  onPickTag: (tag: string) => void;
  /** D10: the same in-place filter the GM's Sessions rail has, over the fields a player actually gets. */
  filter: string;
  onFilterChange: (next: Readonly<Record<string, string | null>>) => void;
}>) {
  const open = openId ? sessions.find((session) => session.id === openId) ?? null : null;
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((session) =>
      sessionTitle(session).toLowerCase().includes(needle)
      || (session.realDate ?? "").toLowerCase().includes(needle)
      || session.tags.some((tag) => tag.includes(needle))
      || session.recap.toLowerCase().includes(needle));
  }, [sessions, filter]);
  return (
    <div className={`codex-workspace${open ? " has-selection" : ""}`}>
      <aside className="codex-rail">
        <div className="codex-rail-head">
          <Input value={filter} placeholder="Filter sessions" aria-label="Filter sessions" onChange={(event) => onFilterChange({ q: event.target.value || null })} />
        </div>
        <nav className="codex-list" aria-label="Sessions">
          {loading && sessions.length === 0 && <div className="codex-list-loading">{[0, 1].map((row) => <Skeleton key={row} variant="text" />)}</div>}
          {!loading && sessions.length === 0 && <p className="codex-list-empty">No recaps shared yet.</p>}
          {!loading && sessions.length > 0 && shown.length === 0 && <p className="codex-list-empty">No sessions match.</p>}
          {shown.map((session) => (
            <button key={session.id} type="button" aria-current={session.id === open?.id ? "true" : undefined}
              className={`codex-session-row${session.id === open?.id ? " is-active" : ""}`} onClick={() => onOpen(session.id)}>
              <span className="codex-list-title">{sessionTitle(session)}</span>
              {session.realDate && <span className="codex-campaign-recentwhen">{session.realDate}</span>}
            </button>
          ))}
        </nav>
      </aside>
      <section className="codex-main">
        {open && <Button variant="ghost" size="sm" className="codex-back" onClick={() => onOpen(null)}><IconChevron className="codex-chevron-left" aria-hidden="true" />All sessions</Button>}
        {open
          ? <article className="codex-reader">
              <h2 className="codex-reader-title">{sessionTitle(open)}</h2>
              {open.realDate && <div className="codex-entry-meta"><span className="codex-entry-when">{open.realDate}</span></div>}
              {open.tags.length > 0 && <div className="codex-entry-meta">{open.tags.map((tag) => <TagChip key={tag} tag={tag} onPick={onPickTag} />)}</div>}
              <div className="codex-reader-body">{open.recap.trim() ? <CodexMarkdown text={open.recap} onNavigate={onNavigate} token={token} knownTitles={knownTitles} /> : <p className="codex-preview-empty">No recap written yet.</p>}</div>
            </article>
          : <div className="codex-main-empty"><h3>No session selected</h3><p>Session recaps your GM has shown to players appear here.</p></div>}
      </section>
    </div>
  );
}

/** D14: quest bodies render as markdown now, the same as every other body in the suite. */
function PlayerQuests({ quests, pages, loading, openId, token, onOpen, onOpenPage, onNavigate, knownTitles, filter, statusFilter, onFilterChange }: Readonly<{
  quests: readonly PlayerCodexQuest[]; pages: readonly PlayerCodexPageSummary[]; loading: boolean; openId: string | null; token: string;
  onOpen: (id: string | null) => void; onOpenPage: (pageId: string) => void; onNavigate: (target: string) => void; knownTitles: ReadonlySet<string>;
  /** D10: the GM's two quest filters, over the player's own feed. `status` is player-facing on a quest. */
  filter: string;
  statusFilter: string | null;
  onFilterChange: (next: Readonly<Record<string, string | null>>) => void;
}>) {
  const open = openId ? quests.find((quest) => quest.id === openId) ?? null : null;
  const questPages = (open?.entityIds ?? []).map((id) => pages.find((summary) => summary.id === id)).filter((summary): summary is PlayerCodexPageSummary => Boolean(summary));
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return quests.filter((quest) =>
      (!statusFilter || quest.status === statusFilter)
      && (!needle || quest.title.toLowerCase().includes(needle) || quest.tags.some((tag) => tag.includes(needle))));
  }, [quests, filter, statusFilter]);
  return (
    <div className={`codex-workspace${open ? " has-selection" : ""}`}>
      <aside className="codex-rail">
        <div className="codex-rail-head">
          <Input value={filter} placeholder="Filter quests" aria-label="Filter quests" onChange={(event) => onFilterChange({ q: event.target.value || null })} />
        </div>
        <div className="codex-rail-tools">
          <Select aria-label="Filter by status" value={statusFilter ?? ""} onChange={(event) => onFilterChange({ status: event.target.value || null })}>
            <option value="">All quests</option>
            <option value="active">{QUEST_STATUS_LABEL.active}</option>
            <option value="completed">{QUEST_STATUS_LABEL.completed}</option>
            <option value="failed">{QUEST_STATUS_LABEL.failed}</option>
          </Select>
        </div>
        <nav className="codex-list" aria-label="Quests">
          {loading && quests.length === 0 && <div className="codex-list-loading">{[0, 1].map((row) => <Skeleton key={row} variant="text" />)}</div>}
          {!loading && quests.length === 0 && <p className="codex-list-empty">No quests shared yet.</p>}
          {!loading && quests.length > 0 && shown.length === 0 && <p className="codex-list-empty">No quests match.</p>}
          {shown.map((quest) => (
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
        {open && <Button variant="ghost" size="sm" className="codex-back" onClick={() => onOpen(null)}><IconChevron className="codex-chevron-left" aria-hidden="true" />All quests</Button>}
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
          : <div className="codex-main-empty"><h3>No quest selected</h3><p>Quests your GM has shown to the party appear here, open and finished alike.</p></div>}
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
function PlayerJournal({ records, calendar, pages, token, focusedId, onNavigate, knownTitles, quests, kindFilter, tagFilter, textFilter, onFilterChange }: Readonly<{
  records: readonly PlayerCodexChronicleRecord[];
  calendar: CodexCalendar | null;
  pages: readonly PlayerCodexPageSummary[];
  token: string;
  focusedId: string | null;
  onNavigate: (target: string) => void;
  knownTitles: ReadonlySet<string>;
  quests: readonly PlayerCodexQuest[];
  /** D10: the GM's three Journal filters, over the player's own records. Same kinds, same order. */
  kindFilter: string | null;
  tagFilter: string | null;
  textFilter: string;
  onFilterChange: (next: Readonly<Record<string, string | null>>) => void;
}>) {
  useEffect(() => {
    if (!focusedId) return;
    document.getElementById(`codex-player-entry-${focusedId}`)?.scrollIntoView({ block: "center" });
  }, [focusedId, records]);

  /** Filter BEFORE grouping, exactly as the GM's Journal does — otherwise a year keeps an empty heading. */
  const allTags = useMemo(() => [...new Set(records.flatMap((record) => record.tags))].sort(), [records]);
  const filtered = useMemo(() => {
    const needle = textFilter.trim().toLowerCase();
    return records.filter((record) =>
      (!kindFilter || record.kind === kindFilter)
      && (!tagFilter || record.tags.includes(tagFilter))
      && (!needle || record.text.toLowerCase().includes(needle) || (record.title ?? "").toLowerCase().includes(needle)));
  }, [records, kindFilter, tagFilter, textFilter]);

  /** Grouped by in-world YEAR, using the server's own instants — never a client re-derivation. */
  const groups = useMemo(() => {
    const buckets = new Map<number | null, PlayerCodexChronicleRecord[]>();
    const perYear = calendar ? calendar.months.reduce((sum, month) => sum + month.days, 0) || 1 : 1;
    for (const record of filtered) {
      const key = record.calendarInstant !== null && calendar ? Math.floor(record.calendarInstant / perYear) : null;
      const bucket = buckets.get(key) ?? [];
      bucket.push(record); buckets.set(key, bucket);
    }
    return [...buckets.keys()]
      .sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b))
      .map((key) => ({ key: key === null ? "none" : String(key), label: key === null ? "Undated" : `${key}${calendar?.yearName ? ` ${calendar.yearName}` : ""}`, records: buckets.get(key)! }));
  }, [filtered, calendar]);
  const todayYear = calendar?.currentDate
    ? Math.floor(((calendar.months.slice(0, calendar.currentDate.month).reduce((sum, month) => sum + month.days, 0) + calendar.currentDate.day - 1) + calendar.currentDate.year * (calendar.months.reduce((sum, month) => sum + month.days, 0) || 1)) / (calendar.months.reduce((sum, month) => sum + month.days, 0) || 1))
    : null;
  const todayLabel = calendar?.currentDate ? formatWorldDate(calendar, calendar.currentDate) : null;

  return (
    <div className="codex-journal">
      {/* D10, the GM's own filter row: above the timeline and outside the groups, because all three
          govern every group. In the address, so the dashboard's deadline card can deep-link to
          "the Journal, deadlines only" for a player exactly as it does for their GM. */}
      {records.length > 0 && (
        <div className="codex-timeline-lens">
          <Select aria-label="Filter by kind" value={kindFilter ?? ""} onChange={(event) => onFilterChange({ kind: event.target.value || null })}>
            <option value="">All kinds</option>
            {CHRONICLE_FILTER_KINDS.map((kind) => <option key={kind} value={kind}>{CHRONICLE_KIND_META[kind].label}</option>)}
          </Select>
          <Input aria-label="Filter the journal" placeholder="Filter the journal" value={textFilter}
            onChange={(event) => onFilterChange({ q: event.target.value || null })} />
          {allTags.length > 0 && (
            <Select aria-label="Filter by tag" value={tagFilter ?? ""} onChange={(event) => onFilterChange({ tag: event.target.value || null })}>
              <option value="">All tags</option>
              {allTags.map((tag) => <option key={tag} value={tag}>#{tag}</option>)}
            </Select>
          )}
        </div>
      )}
      <div className="codex-timeline">
        {records.length === 0 && <p className="codex-list-empty">No entries shared yet.</p>}
        {records.length > 0 && filtered.length === 0 && <p className="codex-list-empty">Nothing in the Journal matches these filters.</p>}
        {groups.map((group) => (
          <section key={group.key} className="codex-timeline-group">
            <div className="codex-timeline-year">{group.label}</div>
            {todayYear !== null && group.key === String(todayYear) && <div className="codex-timeline-now">Today: {todayLabel}</div>}
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

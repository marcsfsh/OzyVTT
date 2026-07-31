import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, IconButton, Kbd, Modal, useToast } from "@vtt/ui";
import { socket } from "../socket";
import {
  atlasApi, calendarApi, codexApi, journalApi, questApi, sessionApi, standingApi,
  AUTOSAVE_DEFAULT,
  type CodexChronicleRecord, type CodexConnection, type CodexMap, type CodexMarker, type CodexPage,
  type CodexPageSummary, type CodexQuest, type CodexSession, type CodexSettings, type CodexStanding,
  type GmCodexCalendar
} from "./api";
import { navigate, replaceQuery, pushTransient, popTransient, discardTransient, releaseStrandedEntry, useRoute } from "../router";
import {
  CODEX_ROOT, GM_SIDEBAR, SECTION_TITLE, atlasPath, codexSectionOf, journalEntryPath, pagePath,
  pathForHit, pathForSection, questPath, recordIdOf, sessionPath, tagPath, graphPath, type CodexSection
} from "./routes";
import { SidebarCollapseToggle, SidebarNav } from "./SidebarNav";
import { useSidebarRailBand } from "./useSidebarRail";
import { CodexIcon } from "./icons";
import { NotFoundView } from "../components/NotFoundView";
import { QuickCreate, type QuickCreateRequest } from "./QuickCreate";
import { createQuest, createSession } from "./creates";
import { PagesView } from "./PagesView";
import { AtlasView } from "./AtlasView";
import { JournalView } from "./JournalView";
import { CalendarView } from "./CalendarView";
import { DowntimeView } from "./DowntimeView";
import { BackupView } from "./BackupView";
import { TagView } from "./TagView";
import { CampaignHome } from "./CampaignHome";
import { SessionsView } from "./SessionsView";
import { SessionConsole } from "./SessionConsole";
import { QuestsView } from "./QuestsView";
import { RevealAudit } from "./RevealAudit";
import { CodexSettingsView } from "./CodexSettings";
import { StandingAdjuster } from "./StandingAdjuster";
import { CommandPalette } from "./CommandPalette";
import { ConnectionGraph } from "./RelationshipGraph";
import { PlayerCodex } from "./PlayerCodex";
import { campaignFeedProps } from "./dashboard";
import "./codex.css";

/**
 * The GM Codex, D1's single sidebar over D3's real addresses.
 *
 * This is the navigation half of the old `CodexWorkspace` recut: the 5-mode tab bar, the 9-button ops
 * row and the four hidden "destination" overlays are gone, and every surface is an address the sidebar
 * lists. The FEED half is unchanged and deliberately so — one owner per feed, handed down, which is what
 * keeps two surfaces from disagreeing about which sessions exist or which one is active.
 *
 * `codex:changed` handling stays a coarse refetch; this client never reads the ping's payload (D22 made
 * it content-free, and every listener here was already payload-blind).
 */

const CONSOLE_KEY = "codex-session-console";
const SIDEBAR_KEY = "codex-sidebar";
const DRAWER_TRANSIENT = "codex-nav";

type WorkspaceScene = Readonly<{ id: string; name: string }>;
type WorkspaceActor = Readonly<{ id: string; name: string }>;

export function CodexShell({ gmToken, scenes = [], actors = [], activeSceneId = null, onActivateScene = () => {}, onOpenReplay }: Readonly<{
  gmToken: string;
  scenes?: readonly WorkspaceScene[];
  actors?: readonly WorkspaceActor[];
  activeSceneId?: string | null;
  onActivateScene?: (sceneId: string) => void;
  onOpenReplay?: (archiveId: number) => void;
}>) {
  const route = useRoute();
  const section = codexSectionOf(route.segments);
  const recordId = recordIdOf(route.segments);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickCreate, setQuickCreate] = useState<QuickCreateRequest | null>(null);
  // "What do players actually see?" — mounts the REAL player Codex against a short-lived PLAYER token
  // minted by the server, so the preview walks the same projection a player does. Never the GM token.
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [adjustingFactionId, setAdjustingFactionId] = useState<string | null>(null);
  const { toast } = useToast();

  // ----- The sidebar's own state (C2's ladder: expanded / rail / drawer) -----
  const [sidebarMode, setSidebarMode] = useState<"open" | "rail">(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === "rail" ? "rail" : "open"; } catch { return "open"; }
  });
  useEffect(() => { try { localStorage.setItem(SIDEBAR_KEY, sidebarMode); } catch { /* private mode - fine */ } }, [sidebarMode]);
  /**
   * 761-849px is a 56px grid track whatever the GM prefers, so the rail is forced there rather than
   * chosen. The PREFERENCE is untouched by the band — leaving the band restores whatever they picked.
   */
  const railBand = useSidebarRailBand();
  const collapsed = railBand || sidebarMode === "rail";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
    // The Android back gesture closes the drawer instead of leaving the section — the single worst phone
    // back-trap this shell would otherwise have.
    pushTransient(DRAWER_TRANSIENT, () => setDrawerOpen(false));
  }, []);
  const closeDrawer = useCallback(() => { setDrawerOpen(false); popTransient(DRAWER_TRANSIENT); }, []);

  const [consoleOpen, setConsoleOpen] = useState(() => {
    try { return localStorage.getItem(CONSOLE_KEY) === "open"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem(CONSOLE_KEY, consoleOpen ? "open" : "closed"); } catch { /* private mode - fine */ } }, [consoleOpen]);

  // ----- Feeds. One owner each, exactly as before the recut. -----
  const [pages, setPages] = useState<CodexPageSummary[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  /** D8: ONE edge list for the whole graph, replacing the typed-relationship and wiki-link feeds. */
  const [connections, setConnections] = useState<CodexConnection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshList = useCallback(async () => {
    try {
      const [nextPages, nextFolders, nextConnections] = await Promise.all([
        codexApi.listPages(gmToken),
        codexApi.listFolders(gmToken).catch(() => []),
        codexApi.listConnections(gmToken)
      ]);
      setPages(nextPages); setFolders(nextFolders); setConnections(nextConnections); setError(null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load the codex."); }
    finally { setLoading(false); }
  }, [gmToken]);
  useEffect(() => { void refreshList(); }, [refreshList]);

  const [sessions, setSessions] = useState<readonly CodexSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const loadSessions = useCallback(async () => {
    try {
      const data = await sessionApi.list(gmToken);
      setSessions(data.sessions); setActiveSessionId(data.activeSessionId); setSessionsError(null);
    } catch (loadError) { setSessionsError(loadError instanceof Error ? loadError.message : "Could not load the sessions."); }
    finally { setSessionsLoading(false); }
  }, [gmToken]);
  useEffect(() => { void loadSessions(); }, [loadSessions]);

  const [quests, setQuests] = useState<readonly CodexQuest[]>([]);
  const [questsLoading, setQuestsLoading] = useState(true);
  const [questsError, setQuestsError] = useState<string | null>(null);
  const loadQuests = useCallback(async () => {
    try { setQuests(await questApi.list(gmToken)); setQuestsError(null); }
    catch (loadError) { setQuestsError(loadError instanceof Error ? loadError.message : "Could not load the quests."); }
    finally { setQuestsLoading(false); }
  }, [gmToken]);
  useEffect(() => { void loadQuests(); }, [loadQuests]);

  /**
   * D6: the autosave preference, read once by the shell and handed to every editor. A per-editor read
   * would let two open editors run on two different cadences after the GM changed it.
   */
  const [settings, setSettings] = useState<CodexSettings | null>(null);
  const loadSettings = useCallback(async () => {
    try { setSettings(await codexApi.getSettings(gmToken)); } catch { /* the editors fall back to the default cadence */ }
  }, [gmToken]);
  useEffect(() => { void loadSettings(); }, [loadSettings]);
  const autosave = settings?.autosave ?? AUTOSAVE_DEFAULT;

  /**
   * The campaign feed — chronicle, atlas, calendar, standing and D15's party pin. Four sections read it
   * (Home, Calendar, Downtime and the Atlas's party card), and it stays lazy for the same reason it
   * always was: a GM working in Pages should not pay five round-trips for surfaces they have not opened.
   */
  const [campaign, setCampaign] = useState<{ records: readonly CodexChronicleRecord[]; maps: readonly CodexMap[]; calendar: GmCodexCalendar | null; party: { marker: CodexMarker; mapName: string } | null }>({ records: [], maps: [], calendar: null, party: null });
  const [standing, setStanding] = useState<readonly CodexStanding[]>([]);
  const [campaignLoading, setCampaignLoading] = useState(true);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const loadCampaign = useCallback(async () => {
    try {
      const [records, maps, calendar, nextStanding, party] = await Promise.all([
        journalApi.chronicle(gmToken), atlasApi.listMaps(gmToken), calendarApi.get(gmToken), standingApi.list(gmToken),
        // D15: one read for "where is the party?", replacing the O(maps) client-side scan. Uncaught with
        // the rest — a dashboard that silently dropped a card is the failure the shared error Alert exists
        // to prevent — but null-tolerant, because "no party pin" is the ordinary state.
        codexApi.party(gmToken)
      ]);
      setCampaign({ records, maps, calendar, party }); setStanding(nextStanding); setCampaignError(null);
    } catch (loadError) { setCampaignError(loadError instanceof Error ? loadError.message : "Could not load the campaign dashboard."); }
    finally { setCampaignLoading(false); }
  }, [gmToken]);
  const needsCampaign = section === "home" || section === "calendar" || section === "downtime" || section === "tags";
  useEffect(() => {
    if (!needsCampaign) return;
    void loadCampaign();
    const onChanged = () => { void loadCampaign(); };
    socket.on("codex:changed", onChanged);
    return () => { socket.off("codex:changed", onChanged); };
  }, [needsCampaign, loadCampaign]);

  // Live refresh: any codex write pings every client. D22 made the ping content-free; this listener was
  // already payload-blind, so nothing here reads it.
  useEffect(() => {
    const onChanged = () => { void refreshList(); void loadSessions(); void loadQuests(); };
    socket.on("codex:changed", onChanged);
    return () => { socket.off("codex:changed", onChanged); };
  }, [refreshList, loadSessions, loadQuests]);

  // Cmd/Ctrl-K opens the palette. Mounted ONLY inside this shell (D20 is explicit that the palette is
  // Codex-scoped and deliberately not app-global), so the shortcut leaves with the section.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen((open) => !open); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onPageChanged = useCallback((page: CodexPage) => {
    setPages((prev) => prev.map((row) => (row.id === page.id ? { ...row, title: page.title, folder: page.folder, tags: page.tags, entityType: page.entityType, revealedToPlayers: page.revealedToPlayers, rev: page.rev, updatedAt: page.updatedAt } : row)));
  }, []);

  const openPlayerPreview = useCallback(async () => {
    setPreviewError(null);
    try { setPreviewToken(await codexApi.createPreviewSession(gmToken)); }
    catch (previewFailure) { setPreviewError(previewFailure instanceof Error ? previewFailure.message : "Couldn't open the player preview."); }
  }, [gmToken]);

  /**
   * Navigating FROM the drawer cannot use `closeDrawer`: that calls `history.back()`, which is a task,
   * while `navigate` pushes on a microtask — so the destination was pushed and then immediately gone
   * back off, and every tap in the phone nav drawer went nowhere. Discard the transient entry instead
   * and `replace` it with the destination, so back from there returns to where the drawer was opened.
   */
  const goto = useCallback((path: string) => {
    const stranded = discardTransient(DRAWER_TRANSIENT);
    setDrawerOpen(false);
    void navigate(path, { replace: stranded }).then((moved) => {
      // The guard can say stay (D6, autosave off, dirty draft). The entry was released on the assumption
      // the destination would overwrite it, so if we did not move it is still on the stack with nothing
      // registered to absorb it — and the GM's next Back would silently do nothing.
      if (!moved && stranded) releaseStrandedEntry();
    });
  }, []);

  /**
   * D3/D10: a list's filters are part of its ADDRESS, so a filtered log is linkable and survives a
   * refresh. One writer for every list that has filters — the Journal already used this exact shape,
   * and Sessions and Quests were the two holding theirs in component state.
   */
  const setListFilter = useCallback((next: Readonly<Record<string, string | null>>) => {
    replaceQuery((query) => {
      for (const [key, value] of Object.entries(next)) { if (value) query.set(key, value); else query.delete(key); }
    });
  }, []);

  /**
   * D7: create-and-open, for the doors that are not on the record's own rail — today the palette.
   *
   * The create itself is `creates.ts`, shared with the rail buttons, so there is one answer to "what does
   * creating a session do". Failure surfaces on the shell's own Alert: the palette closes on the verb, so
   * an error raised inside it would have nowhere to render.
   */
  const newSession = useCallback(async () => {
    try {
      const session = await createSession(gmToken, sessions);
      await loadSessions();
      void navigate(sessionPath(session.id));
    } catch (createError) { setError(createError instanceof Error ? createError.message : "Couldn't create the session."); }
  }, [gmToken, sessions, loadSessions]);
  const newQuest = useCallback(async () => {
    try {
      const quest = await createQuest(gmToken);
      await loadQuests();
      void navigate(questPath(quest.id));
    } catch (createError) { setError(createError instanceof Error ? createError.message : "Couldn't create the quest."); }
  }, [gmToken, loadQuests]);

  const standingRows = useMemo(() => {
    const byFaction = new Map(standing.map((row) => [row.factionPageId, row.value]));
    return pages
      .filter((page) => page.entityType === "faction" || byFaction.has(page.id))
      .map((page) => ({ factionPageId: page.id, name: page.title, value: byFaction.get(page.id) ?? 0, revealed: page.revealedToPlayers }));
  }, [pages, standing]);
  const adjustingFaction = useMemo(() => {
    if (!adjustingFactionId) return null;
    const page = pages.find((candidate) => candidate.id === adjustingFactionId);
    if (!page) return null;
    return { page, standing: standing.find((row) => row.factionPageId === adjustingFactionId) ?? null };
  }, [adjustingFactionId, pages, standing]);

  const dash = useMemo(
    () => campaignFeedProps({ records: campaign.records, calendar: campaign.calendar }),
    [campaign.records, campaign.calendar]
  );

  const sidebarHeader = (
    <button type="button" className="codex-sidebar-search" onClick={() => { closeDrawer(); setPaletteOpen(true); }} aria-keyshortcuts="Meta+K Control+K"
      /* Collapsed, the glyph is the whole button — without these it has no accessible name at all,
         the same reason every rail nav item carries them. */
      title={collapsed ? "Search" : undefined} aria-label={collapsed ? "Search" : undefined}>
      <CodexIcon iconId="search" className="codex-navitem-icon codex-sidebar-searchglyph" aria-hidden="true" />
      {!collapsed && <><span className="codex-navitem-label">Search</span><Kbd>⌘K</Kbd></>}
    </button>
  );

  const nav = (collapsed: boolean) => (
    <SidebarNav
      groups={GM_SIDEBAR}
      activePath={route.path}
      collapsed={collapsed}
      onNavigate={goto}
      onAction={() => { closeDrawer(); void openPlayerPreview(); }}
      header={sidebarHeader}
      /* No collapse control in the forced band: there is nothing to expand INTO, and offering the
         toggle would write a preference the GM cannot see the effect of until they resize. */
      footer={collapsed || drawerOpen ? undefined : <SidebarCollapseToggle collapsed={sidebarMode === "rail"} onToggle={() => setSidebarMode((mode) => (mode === "rail" ? "open" : "rail"))} />}
    />
  );

  return (
    <div className={`codex-root codex-shell${collapsed ? " is-rail" : ""}`}>
      {/* ≥761px: the sidebar is in the layout. ≤760px it is a Drawer, opened from the top bar. */}
      <aside className="codex-shell-side">{nav(collapsed)}</aside>
      <Drawer open={drawerOpen} onClose={closeDrawer} side="left" title="Codex" className="codex-navdrawer">
        {nav(false)}
      </Drawer>

      <div className="codex-shell-main">
        <div className="codex-topbar">
          <IconButton label="Codex sections" className="codex-topbar-menu" onClick={openDrawer}>
            <CodexIcon iconId="menu" className="codex-navitem-icon" />
          </IconButton>
          <h2 className="codex-topbar-title">{section ? SECTION_TITLE[section] : "Codex"}</h2>
          <div className="codex-topbar-actions">
            <IconButton label="Search" className="codex-topbar-search" onClick={() => setPaletteOpen(true)}>
              <CodexIcon iconId="search" className="codex-navitem-icon" />
            </IconButton>
            {/* D24: the session console survives as a right-side prep drawer, renamed into the Sessions
                vocabulary family, reachable from every section exactly as it always was. */}
            <Button variant="ghost" size="sm" aria-expanded={consoleOpen} onClick={() => setConsoleOpen((open) => !open)}>Session prep</Button>
          </div>
        </div>

        {/* One error surface for the whole shell, whichever section is on screen. */}
        {error && <Alert tone="danger" title="Couldn't load the codex">{error}</Alert>}
        {previewError && <Alert tone="danger">{previewError}</Alert>}

        <div className="codex-shell-content">
          {section === null && <NotFoundView role="gm" />}

          {section === "home" && (
            <CampaignHome
              pages={pages} entries={dash.entries} maps={campaign.maps} today={dash.today}
              loading={loading || campaignLoading} error={campaignError}
              session={dash.nextSession(sessions, activeSessionId)}
              onOpenSession={(sessionId) => navigate(sessionPath(sessionId))}
              quests={quests.map((quest) => ({ id: quest.id, title: quest.title, status: quest.status, objectives: quest.objectives, revealed: quest.revealedToPlayers }))}
              onOpenQuest={(questId) => navigate(questPath(questId))}
              deadlines={dash.deadlines}
              downtimePending={dash.downtimePending}
              onOpenDowntime={() => navigate(pathForSection("downtime"))}
              /* D18: the party card states the PIN's reveal state. Deliberately the pin's own flag and
                 not a computed "can players see this": the map gates it too, and a card that folded the
                 two together would say "hidden" about a shown pin and give the GM nothing to act on.
                 The Atlas is where the map's own switch lives, one tap away via "Show the pin". */
              party={campaign.party ? { label: campaign.party.marker.label, mapId: campaign.party.marker.mapId, mapName: campaign.party.mapName, markerId: campaign.party.marker.id, revealed: campaign.party.marker.revealedToPlayers } : null}
              onOpenParty={(mapId, markerId) => navigate(atlasPath(mapId, markerId))}
              standing={standingRows}
              onAdjustStanding={setAdjustingFactionId}
              onCreate={() => setQuickCreate({})}
              onOpenPage={(id) => navigate(pagePath(id))}
              onOpenEntry={(entryId) => navigate(journalEntryPath(entryId))}
              onOpenMap={(mapId) => navigate(atlasPath(mapId))}
              onSeeAll={(target) => navigate(target)}
              onPickType={(type) => navigate(`${CODEX_ROOT}/pages?type=${type}`)}
              onPickTag={(tag) => navigate(tagPath(tag))}
            />
          )}

          {section === "pages" && (
            <PagesView
              gmToken={gmToken} pages={pages} folders={folders} loading={loading} autosave={autosave}
              selectedId={recordId} query={route.query}
              onRefresh={refreshList} onPageChanged={onPageChanged}
              onQuickCreate={setQuickCreate} onError={setError}
              onOpenReplay={onOpenReplay}
            />
          )}

          {section === "atlas" && (
            <AtlasView gmToken={gmToken} scenes={scenes} actors={actors} activeSceneId={activeSceneId}
              onActivateScene={onActivateScene} onOpenReplay={onOpenReplay}
              mapId={recordId} pinId={route.query.get("pin")} filter={route.query.get("q") ?? ""} tagFilter={route.query.get("tag")}
              autosave={autosave}
              onQuickCreate={setQuickCreate}
              onNavigate={navigate} onReplaceQuery={replaceQuery} />
          )}

          {section === "graph" && (
            <ConnectionGraph loading={loading}
              nodes={pages.map((page) => ({ id: page.id, title: page.title, entityType: page.entityType }))}
              connections={connections}
              onOpen={(pageId) => navigate(pagePath(pageId))}
              focusPageId={route.query.get("focus")}
              onFocused={() => replaceQuery((query) => query.delete("focus"))} />
          )}

          {section === "sessions" && (
            <SessionsView gmToken={gmToken} sessions={sessions} activeSessionId={activeSessionId}
              loading={sessionsLoading} error={sessionsError} onChanged={loadSessions}
              autosave={autosave} pages={pages}
              openSessionId={recordId} onOpenSession={(id) => navigate(id ? sessionPath(id) : pathForSection("sessions"))}
              filter={route.query.get("q") ?? ""} statusFilter={route.query.get("status")}
              onFilterChange={setListFilter}
              onPickTag={(tag) => navigate(tagPath(tag))} />
          )}

          {section === "quests" && (
            <QuestsView gmToken={gmToken} quests={quests} pages={pages}
              loading={questsLoading} error={questsError} onChanged={loadQuests}
              autosave={autosave}
              openQuestId={recordId} onOpenQuest={(id) => navigate(id ? questPath(id) : pathForSection("quests"))}
              onOpenPage={(pageId) => navigate(pagePath(pageId))}
              filter={route.query.get("q") ?? ""} statusFilter={route.query.get("status")}
              onFilterChange={setListFilter}
              onPickTag={(tag) => navigate(tagPath(tag))} />
          )}

          {section === "journal" && (
            <JournalView gmToken={gmToken} autosave={autosave} pages={pages}
              onOpenPage={(pageId) => navigate(pagePath(pageId))}
              onOpenMarker={(markerId) => navigate(atlasPath(null, markerId))}
              onOpenReplay={onOpenReplay}
              openEntryId={route.query.get("entry")} onOpenedEntry={() => replaceQuery((query) => query.delete("entry"))}
              kindFilter={route.query.get("kind")} tagFilter={route.query.get("tag")} textFilter={route.query.get("q") ?? ""}
              onFilterChange={setListFilter}
              sessions={sessions} activeSessionId={activeSessionId}
              onOpenSession={(sessionId) => navigate(sessionPath(sessionId))}
              onOpenCalendar={() => navigate(pathForSection("calendar"))} />
          )}

          {section === "calendar" && (
            <CalendarView gmToken={gmToken} calendar={campaign.calendar} records={campaign.records}
              loading={campaignLoading} error={campaignError} onChanged={loadCampaign}
              year={route.query.get("y")} month={route.query.get("m")}
              onMonthChange={(year, month) => replaceQuery((query) => { query.set("y", String(year)); query.set("m", String(month)); })}
              onOpenEntry={(entryId) => navigate(journalEntryPath(entryId))}
              onOpenPage={(pageId) => navigate(pagePath(pageId))} />
          )}

          {section === "downtime" && (
            <DowntimeView gmToken={gmToken} records={campaign.records} calendar={campaign.calendar} pages={pages}
              loading={campaignLoading} error={campaignError} onChanged={loadCampaign}
              onOpenEntry={(entryId) => navigate(journalEntryPath(entryId))}
              onOpenPage={(pageId) => navigate(pagePath(pageId))} />
          )}

          {section === "tags" && (
            <TagView gmToken={gmToken} tag={decodeURIComponent(route.segments[2] ?? "")}
              pages={pages} maps={campaign.maps} records={campaign.records} sessions={sessions} quests={quests}
              onNavigate={navigate} />
          )}

          {section === "audit" && <RevealAudit gmToken={gmToken} />}
          {section === "backup" && <BackupView gmToken={gmToken} onChanged={() => { void refreshList(); void loadSessions(); void loadQuests(); void loadCampaign(); }} />}
          {section === "settings" && <CodexSettingsView gmToken={gmToken} onSettingsChanged={setSettings} />}
        </div>
      </div>

      {/* D24. Always mounted, open or not: `Drawer` is non-modal and stays in the tree so the slide plays
          both ways. It reads the SAME session feed the Sessions section edits. */}
      <SessionConsole open={consoleOpen} onClose={() => setConsoleOpen(false)} gmToken={gmToken}
        session={sessions.find((session) => session.id === activeSessionId) ?? null}
        loading={sessionsLoading} error={sessionsError}
        onOpenSession={(sessionId) => { setConsoleOpen(false); navigate(sessionPath(sessionId)); }}
        onOpenSessions={() => { setConsoleOpen(false); navigate(pathForSection("sessions")); }} />

      {paletteOpen && (
        <CommandPalette gmToken={gmToken}
          onOpenHit={(hit) => navigate(pathForHit(hit))}
          onCreatePage={(title) => setQuickCreate({ title })}
          /* D7: the palette's create verbs run the SAME creates the rails do (`creates.ts`) and land on
             the new record — they used to navigate to the list and leave the GM to find the button. */
          onCreateSession={() => void newSession()}
          onCreateQuest={() => void newQuest()}
          onNavigate={navigate}
          onClose={() => setPaletteOpen(false)} />
      )}

      {quickCreate && (
        <QuickCreate gmToken={gmToken} request={quickCreate}
          onClose={() => setQuickCreate(null)}
          onOpen={(pageId) => navigate(pagePath(pageId))}
          onChanged={refreshList} />
      )}

      <Modal open={!!previewToken} onClose={() => setPreviewToken(null)} size="full" title="What players see" ariaLabel="Player Codex preview">
        <p className="codex-inspector-hint">This is the real player Codex, read through a player session — anything hidden from players is absent here, not just dimmed.</p>
        {previewToken && <PlayerCodex token={previewToken} embedded />}
      </Modal>

      {/* The GM's write control for standing. It lives HERE and never inside `CampaignHome`, which the
          player's Codex also renders — the dashboard card only asks for it by id. */}
      {adjustingFaction && (
        <StandingAdjuster key={adjustingFaction.page.id} gmToken={gmToken}
          factionPageId={adjustingFaction.page.id} factionName={adjustingFaction.page.title}
          standing={adjustingFaction.standing}
          onSaved={() => { void loadCampaign(); toast("Standing updated.", { tone: "success" }); }}
          onClose={() => setAdjustingFactionId(null)} />
      )}
    </div>
  );
}

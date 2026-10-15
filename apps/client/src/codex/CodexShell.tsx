import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, IconButton, Kbd, Modal, useToast } from "@vtt/ui";
import type { CodexPage } from "@vtt/domain";
import {
  atlasApi,
  AUTOSAVE_DEFAULT,
  calendarApi,
  codexApi,
  journalApi,
  questApi,
  sessionApi,
  standingApi
} from "./api";
import {
  navigate,
  replaceQuery,
  pushTransient,
  popTransient,
  discardTransient,
  releaseStrandedEntry,
  useRoute
} from "../router";
import {
  CODEX_ROOT,
  GM_SIDEBAR,
  SECTION_TITLE,
  atlasPath,
  codexSectionOf,
  journalEntryPath,
  pagePath,
  pathForHit,
  pathForSection,
  questPath,
  recordIdOf,
  sessionPath,
  tagPath
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
import { useCodexQuery } from "./useCodexQuery";
import "./codex.css";

/**
 * The GM Codex: one sidebar over real addresses. Each feed has one owner here and is handed down, so two
 * surfaces never disagree about, say, which session is active. `codex:changed` triggers a coarse refetch;
 * the ping carries no payload.
 */

const CONSOLE_KEY = "codex-session-console";
const SIDEBAR_KEY = "codex-sidebar";
const DRAWER_TRANSIENT = "codex-nav";

/** Stable empty feeds, so a list that has not loaded yet keeps one identity across renders. */
const EMPTY: readonly never[] = [];
const EMPTY_CAMPAIGN = {
  records: EMPTY,
  maps: EMPTY,
  calendar: null,
  standing: EMPTY,
  party: null
} as const;

type WorkspaceScene = Readonly<{ id: string; name: string }>;
/** `archived` and `kind` are optional; the character pickers read them (see `characters.ts`). */
type WorkspaceActor = Readonly<{ id: string; name: string; archived?: boolean; kind?: string }>;

export function CodexShell({
  gmToken,
  scenes = [],
  actors = [],
  activeSceneId = null,
  onActivateScene = () => {},
  onOpenReplay
}: Readonly<{
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
  // "What do players see?": mounts the real player Codex on a short-lived player token minted by the
  // server, so the preview walks the player projection. Never the GM token.
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [adjustingFactionId, setAdjustingFactionId] = useState<string | null>(null);
  const { toast } = useToast();

  // ----- Sidebar state: expanded / rail / drawer -----
  const [sidebarMode, setSidebarMode] = useState<"open" | "rail">(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "rail" ? "rail" : "open";
    } catch {
      return "open";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, sidebarMode);
    } catch {
      /* private mode - fine */
    }
  }, [sidebarMode]);
  /** 761-849px forces the rail (a 56px track). The stored preference is untouched and returns outside the band. */
  const railBand = useSidebarRailBand();
  const collapsed = railBand || sidebarMode === "rail";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
    // The Android back gesture closes the drawer instead of leaving the section.
    pushTransient(DRAWER_TRANSIENT, () => setDrawerOpen(false));
  }, []);
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    popTransient(DRAWER_TRANSIENT);
  }, []);

  const [consoleOpen, setConsoleOpen] = useState(() => {
    try {
      return localStorage.getItem(CONSOLE_KEY) === "open";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CONSOLE_KEY, consoleOpen ? "open" : "closed");
    } catch {
      /* private mode - fine */
    }
  }, [consoleOpen]);

  // ----- Feeds, one owner each -----
  /** Pages, folders and the one edge list the whole graph draws. */
  const list = useCodexQuery(
    useCallback(async () => {
      const [pages, folders, connections] = await Promise.all([
        codexApi.listPages(gmToken),
        codexApi.listFolders(gmToken).catch(() => []),
        codexApi.listConnections(gmToken)
      ]);
      return { pages, folders, connections };
    }, [gmToken]),
    { failure: "Could not load the codex." }
  );
  const pages = list.data?.pages ?? EMPTY;
  const folders = list.data?.folders ?? EMPTY;
  const connections = list.data?.connections ?? EMPTY;
  const loading = list.loading;
  const refreshList = list.reload;
  /** A failed create or move, reported by whichever surface tried it. Fresh data clears it. */
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => setActionError(null), [list.data]);

  const sessionFeed = useCodexQuery(
    useCallback(() => sessionApi.list(gmToken), [gmToken]),
    { failure: "Could not load the sessions." }
  );
  const sessions = sessionFeed.data?.sessions ?? EMPTY;
  const activeSessionId = sessionFeed.data?.activeSessionId ?? null;
  const loadSessions = sessionFeed.reload;

  const questFeed = useCodexQuery(
    useCallback(() => questApi.list(gmToken), [gmToken]),
    { failure: "Could not load the quests." }
  );
  const quests = questFeed.data ?? EMPTY;
  const loadQuests = questFeed.reload;

  /** The autosave preference, read once here and handed to every editor so they share one cadence. */
  const settingsFeed = useCodexQuery(
    useCallback(() => codexApi.getSettings(gmToken), [gmToken]),
    { live: false }
  );
  // A failed read leaves the editors on the default cadence.
  const autosave = settingsFeed.data?.autosave ?? AUTOSAVE_DEFAULT;

  /**
   * The campaign feed (chronicle, maps, calendar, standing, party pin). Loaded lazily, only for the
   * sections that read it.
   */
  const needsCampaign = section === "home" || section === "calendar" || section === "downtime" || section === "tags";
  const loadCampaignFeed = useCallback(async () => {
    const [records, maps, calendar, standing, party] = await Promise.all([
      journalApi.chronicle(gmToken),
      atlasApi.listMaps(gmToken),
      calendarApi.get(gmToken),
      standingApi.list(gmToken),
      // Not caught separately: a silently missing card is worse than the shared error Alert.
      codexApi.party(gmToken)
    ]);
    return { records, maps, calendar, standing, party };
  }, [gmToken]);
  const campaignFeed = useCodexQuery(needsCampaign ? loadCampaignFeed : null, {
    failure: "Could not load the campaign dashboard."
  });
  const campaign = campaignFeed.data ?? EMPTY_CAMPAIGN;
  const standing = campaign.standing;
  const campaignLoading = campaignFeed.loading;
  const campaignError = campaignFeed.error;
  const loadCampaign = campaignFeed.reload;

  // Cmd/Ctrl-K opens the palette. Codex-scoped by design, so the shortcut leaves with the section.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setList = list.setData;
  const onPageChanged = useCallback(
    (page: CodexPage) =>
      setList(
        (prev) =>
          prev && {
            ...prev,
            pages: prev.pages.map((row) =>
              row.id === page.id
                ? {
                    ...row,
                    title: page.title,
                    folder: page.folder,
                    tags: page.tags,
                    entityType: page.entityType,
                    revealedToPlayers: page.revealedToPlayers,
                    rev: page.rev,
                    updatedAt: page.updatedAt
                  }
                : row
            )
          }
      ),
    [setList]
  );

  const openPlayerPreview = useCallback(async () => {
    setPreviewError(null);
    try {
      setPreviewToken(await codexApi.createPreviewSession(gmToken));
    } catch (previewFailure) {
      setPreviewError(previewFailure instanceof Error ? previewFailure.message : "Couldn't open the player preview.");
    }
  }, [gmToken]);

  /**
   * Navigating from the drawer can't use `closeDrawer`: its `history.back()` runs after `navigate`'s push
   * and would undo it. Discard the transient entry and replace it with the destination instead.
   */
  const goto = useCallback((path: string) => {
    const stranded = discardTransient(DRAWER_TRANSIENT);
    setDrawerOpen(false);
    void navigate(path, { replace: stranded }).then((moved) => {
      // The unsaved-changes guard may veto; then release the stranded entry so the next Back works.
      if (!moved && stranded) releaseStrandedEntry();
    });
  }, []);

  /** A list's filters are part of its address, so a filtered list is linkable and survives a refresh. */
  const setListFilter = useCallback((next: Readonly<Record<string, string | null>>) => {
    replaceQuery((query) => {
      for (const [key, value] of Object.entries(next)) {
        if (value) query.set(key, value);
        else query.delete(key);
      }
    });
  }, []);

  /**
   * Create-and-open for the palette, sharing `creates.ts` with the rail buttons. Errors go to the shell's
   * Alert, since the palette closes on the verb.
   */
  const newSession = useCallback(async () => {
    try {
      const session = await createSession(gmToken, sessions);
      await loadSessions();
      void navigate(sessionPath(session.id));
    } catch (createError) {
      setActionError(createError instanceof Error ? createError.message : "Couldn't create the session.");
    }
  }, [gmToken, sessions, loadSessions]);
  const newQuest = useCallback(async () => {
    try {
      const quest = await createQuest(gmToken);
      await loadQuests();
      void navigate(questPath(quest.id));
    } catch (createError) {
      setActionError(createError instanceof Error ? createError.message : "Couldn't create the quest.");
    }
  }, [gmToken, loadQuests]);

  const standingRows = useMemo(() => {
    const byFaction = new Map(standing.map((row) => [row.factionPageId, row.value]));
    return pages
      .filter((page) => page.entityType === "faction" || byFaction.has(page.id))
      .map((page) => ({
        factionPageId: page.id,
        name: page.title,
        value: byFaction.get(page.id) ?? 0,
        revealed: page.revealedToPlayers
      }));
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
    <button
      type="button"
      className="codex-sidebar-search"
      onClick={() => {
        closeDrawer();
        setPaletteOpen(true);
      }}
      aria-keyshortcuts="Meta+K Control+K"
      /* Collapsed, the glyph is the whole button, so it needs an accessible name. */
      title={collapsed ? "Search" : undefined}
      aria-label={collapsed ? "Search" : undefined}
    >
      <CodexIcon iconId="search" className="codex-navitem-icon codex-sidebar-searchglyph" aria-hidden="true" />
      {!collapsed && (
        <>
          <span className="codex-navitem-label">Search</span>
          <Kbd>⌘K</Kbd>
        </>
      )}
    </button>
  );

  const nav = (asRail: boolean) => (
    <SidebarNav
      groups={GM_SIDEBAR}
      activePath={route.path}
      collapsed={asRail}
      onNavigate={goto}
      onAction={() => {
        closeDrawer();
        void openPlayerPreview();
      }}
      header={sidebarHeader}
      /**
       * Gate on `railBand`, never `collapsed`: otherwise collapsing hides the only control that expands.
       * In the forced band there is nothing to expand into. The phone drawer is always expanded.
       */
      footer={
        railBand || drawerOpen ? undefined : (
          <SidebarCollapseToggle
            collapsed={sidebarMode === "rail"}
            onToggle={() => setSidebarMode((mode) => (mode === "rail" ? "open" : "rail"))}
          />
        )
      }
    />
  );

  return (
    /* The shell is the pane: a rail column beside chrome rows over one scrolling region. */
    <div className={`codex-root codex-shell pane-frame pane-scene scanlines anim-view${collapsed ? " is-rail" : ""}`}>
      <div className="pane-sky" aria-hidden="true" />
      {/* >=761px the sidebar is in the layout; <=760px it is a Drawer opened from the top bar. */}
      <aside className="codex-shell-side">{nav(collapsed)}</aside>
      <Drawer open={drawerOpen} onClose={closeDrawer} side="left" title="Codex" className="codex-navdrawer">
        {nav(false)}
      </Drawer>

      <div className="codex-shell-main">
        <div className="codex-topbar neon-beam">
          <IconButton label="Codex sections" className="codex-topbar-menu" onClick={openDrawer}>
            <CodexIcon iconId="menu" className="codex-navitem-icon" />
          </IconButton>
          <h2 className="codex-topbar-title">{section ? SECTION_TITLE[section] : "Codex"}</h2>
          <div className="codex-topbar-actions">
            <IconButton label="Search" className="codex-topbar-search" onClick={() => setPaletteOpen(true)}>
              <CodexIcon iconId="search" className="codex-navitem-icon" />
            </IconButton>
            {/* The session prep drawer, reachable from every section. */}
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={consoleOpen}
              onClick={() => setConsoleOpen((open) => !open)}
            >
              Session prep
            </Button>
          </div>
        </div>

        {list.error && (
          <Alert tone="danger" title="Couldn't load the Codex">
            {list.error}
          </Alert>
        )}
        {actionError && <Alert tone="danger">{actionError}</Alert>}
        {previewError && <Alert tone="danger">{previewError}</Alert>}

        {/* The one scroll region. */}
        <div className="codex-shell-content scroll-y frame-fill">
          {section === null && <NotFoundView role="gm" />}

          {section === "home" && (
            <CampaignHome
              pages={pages}
              entries={dash.entries}
              maps={campaign.maps}
              today={dash.today}
              loading={loading || campaignLoading}
              error={campaignError}
              session={dash.nextSession(sessions, activeSessionId)}
              onOpenSession={(sessionId) => navigate(sessionPath(sessionId))}
              quests={quests.map((quest) => ({
                id: quest.id,
                title: quest.title,
                status: quest.status,
                objectives: quest.objectives,
                revealed: quest.revealedToPlayers
              }))}
              onOpenQuest={(questId) => navigate(questPath(questId))}
              deadlines={dash.deadlines}
              downtimePending={dash.downtimePending}
              onOpenDowntime={() => navigate(pathForSection("downtime"))}
              /* The pin's own reveal flag, not a computed visibility: the map gates it too, and the Atlas
                 is where that switch lives. */
              party={
                campaign.party
                  ? {
                      label: campaign.party.marker.label,
                      mapId: campaign.party.marker.mapId,
                      mapName: campaign.party.mapName,
                      markerId: campaign.party.marker.id,
                      revealed: campaign.party.marker.revealedToPlayers
                    }
                  : null
              }
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
              gmToken={gmToken}
              pages={pages}
              folders={folders}
              loading={loading}
              autosave={autosave}
              selectedId={recordId}
              query={route.query}
              onRefresh={refreshList}
              onPageChanged={onPageChanged}
              onQuickCreate={setQuickCreate}
              onError={setActionError}
              onOpenReplay={onOpenReplay}
            />
          )}

          {section === "atlas" && (
            <AtlasView
              gmToken={gmToken}
              scenes={scenes}
              actors={actors}
              activeSceneId={activeSceneId}
              onActivateScene={onActivateScene}
              onOpenReplay={onOpenReplay}
              mapId={recordId}
              pinId={route.query.get("pin")}
              filter={route.query.get("q") ?? ""}
              tagFilter={route.query.get("tag")}
              autosave={autosave}
              onQuickCreate={setQuickCreate}
              onNavigate={navigate}
              onReplaceQuery={replaceQuery}
            />
          )}

          {section === "graph" && (
            <ConnectionGraph
              loading={loading}
              nodes={pages.map((page) => ({ id: page.id, title: page.title, entityType: page.entityType }))}
              connections={connections}
              onOpen={(pageId) => navigate(pagePath(pageId))}
              focusPageId={route.query.get("focus")}
              onFocused={() => replaceQuery((query) => query.delete("focus"))}
            />
          )}

          {section === "sessions" && (
            <SessionsView
              gmToken={gmToken}
              sessions={sessions}
              activeSessionId={activeSessionId}
              loading={sessionFeed.loading}
              error={sessionFeed.error}
              onChanged={loadSessions}
              autosave={autosave}
              pages={pages}
              actors={actors}
              openSessionId={recordId}
              onOpenSession={(id) => navigate(id ? sessionPath(id) : pathForSection("sessions"))}
              filter={route.query.get("q") ?? ""}
              statusFilter={route.query.get("status")}
              onFilterChange={setListFilter}
              onPickTag={(tag) => navigate(tagPath(tag))}
            />
          )}

          {section === "quests" && (
            <QuestsView
              gmToken={gmToken}
              quests={quests}
              pages={pages}
              loading={questFeed.loading}
              error={questFeed.error}
              onChanged={loadQuests}
              autosave={autosave}
              openQuestId={recordId}
              onOpenQuest={(id) => navigate(id ? questPath(id) : pathForSection("quests"))}
              onOpenPage={(pageId) => navigate(pagePath(pageId))}
              filter={route.query.get("q") ?? ""}
              statusFilter={route.query.get("status")}
              onFilterChange={setListFilter}
              onPickTag={(tag) => navigate(tagPath(tag))}
            />
          )}

          {section === "journal" && (
            <JournalView
              gmToken={gmToken}
              autosave={autosave}
              pages={pages}
              onOpenPage={(pageId) => navigate(pagePath(pageId))}
              onOpenMarker={(markerId) => navigate(atlasPath(null, markerId))}
              onOpenReplay={onOpenReplay}
              openEntryId={route.query.get("entry")}
              onOpenedEntry={() => replaceQuery((query) => query.delete("entry"))}
              kindFilter={route.query.get("kind")}
              tagFilter={route.query.get("tag")}
              textFilter={route.query.get("q") ?? ""}
              onFilterChange={setListFilter}
              sessions={sessions}
              activeSessionId={activeSessionId}
              onOpenSession={(sessionId) => navigate(sessionPath(sessionId))}
              onOpenCalendar={() => navigate(pathForSection("calendar"))}
            />
          )}

          {section === "calendar" && (
            <CalendarView
              gmToken={gmToken}
              calendar={campaign.calendar}
              records={campaign.records}
              loading={campaignLoading}
              error={campaignError}
              onChanged={loadCampaign}
              year={route.query.get("y")}
              month={route.query.get("m")}
              onMonthChange={(year, month) =>
                replaceQuery((query) => {
                  query.set("y", String(year));
                  query.set("m", String(month));
                })
              }
              onOpenEntry={(entryId) => navigate(journalEntryPath(entryId))}
              onOpenPage={(pageId) => navigate(pagePath(pageId))}
            />
          )}

          {section === "downtime" && (
            <DowntimeView
              gmToken={gmToken}
              records={campaign.records}
              calendar={campaign.calendar}
              pages={pages}
              actors={actors}
              loading={campaignLoading}
              error={campaignError}
              onChanged={loadCampaign}
              onOpenEntry={(entryId) => navigate(journalEntryPath(entryId))}
              onOpenPage={(pageId) => navigate(pagePath(pageId))}
            />
          )}

          {section === "tags" && (
            <TagView
              gmToken={gmToken}
              tag={decodeURIComponent(route.segments[2] ?? "")}
              pages={pages}
              maps={campaign.maps}
              records={campaign.records}
              sessions={sessions}
              quests={quests}
              onNavigate={navigate}
            />
          )}

          {section === "audit" && <RevealAudit gmToken={gmToken} />}
          {section === "backup" && (
            <BackupView
              gmToken={gmToken}
              onChanged={() => {
                void refreshList();
                void loadSessions();
                void loadQuests();
                void loadCampaign();
              }}
            />
          )}
          {section === "settings" && <CodexSettingsView gmToken={gmToken} onSettingsChanged={settingsFeed.setData} />}
        </div>
      </div>

      {/* Always mounted so the non-modal Drawer's slide plays both ways. Reads the same session feed Sessions edits. */}
      <SessionConsole
        open={consoleOpen}
        onClose={() => setConsoleOpen(false)}
        gmToken={gmToken}
        session={sessions.find((session) => session.id === activeSessionId) ?? null}
        loading={sessionFeed.loading}
        error={sessionFeed.error}
        onOpenSession={(sessionId) => {
          setConsoleOpen(false);
          navigate(sessionPath(sessionId));
        }}
        onOpenSessions={() => {
          setConsoleOpen(false);
          navigate(pathForSection("sessions"));
        }}
      />

      {paletteOpen && (
        <CommandPalette
          gmToken={gmToken}
          onOpenHit={(hit) => navigate(pathForHit(hit))}
          onCreatePage={(title) => setQuickCreate({ title })}
          /* Palette create verbs share `creates.ts` with the rails and land on the new record. */
          onCreateSession={() => void newSession()}
          onCreateQuest={() => void newQuest()}
          onNavigate={navigate}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {quickCreate && (
        <QuickCreate
          gmToken={gmToken}
          request={quickCreate}
          onClose={() => setQuickCreate(null)}
          onOpen={(pageId) => navigate(pagePath(pageId))}
          onChanged={refreshList}
        />
      )}

      {/* `codex-preview-modal` gives the embedded shell a real height, so the atlas map has something to fill. */}
      <Modal
        open={!!previewToken}
        onClose={() => setPreviewToken(null)}
        size="full"
        title="What players see"
        ariaLabel="Player Codex preview"
        className="codex-preview-modal"
      >
        <p className="codex-inspector-hint">
          This is the real player Codex, read through a player session. Anything hidden from players is absent here, not
          dimmed.
        </p>
        {previewToken && <PlayerCodex token={previewToken} embedded />}
      </Modal>

      {/* The GM's standing write control lives here, never in `CampaignHome`, which the player Codex also renders. */}
      {adjustingFaction && (
        <StandingAdjuster
          key={adjustingFaction.page.id}
          gmToken={gmToken}
          factionPageId={adjustingFaction.page.id}
          factionName={adjustingFaction.page.title}
          standing={adjustingFaction.standing}
          onSaved={() => {
            void loadCampaign();
            toast("Standing updated.", { tone: "success" });
          }}
          onClose={() => setAdjustingFactionId(null)}
        />
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Chip, Input, Menu, MenuItem, Modal, Select, Skeleton, Tabs, useToast } from "@vtt/ui";
import { socket } from "../socket";
import { atlasApi, calendarApi, codexApi, formatWorldDate, journalApi, pageLinkKey, questApi, sessionApi, standingApi, type CodexBacklink, type CodexChronicleRecord, type CodexLinkEdge, type CodexMap, type CodexPage, type CodexPageSummary, type CodexQuest, type CodexRelationship, type CodexRelationshipEdge, type CodexSearchHit, type CodexSession, type CodexStanding, type GmCodexCalendar } from "./api";
import { PageEditor } from "./PageEditor";
import { AtlasView, type AtlasTarget } from "./AtlasView";
import { JournalView } from "./JournalView";
import { campaignDeadlines, chronicleWhenLabel } from "./chronicle";
import { CommandPalette } from "./CommandPalette";
import { SearchResultList, useCodexSearch } from "./SearchResults";
import { NotebookTree, buildFolderTree, type NotebookSort } from "./NotebookTree";
import { EntityIcon } from "./icons";
import { CampaignHome, type CampaignDeadline, type CampaignEntry, type CampaignStanding } from "./CampaignHome";
import { SessionsView } from "./SessionsView";
import { SessionConsole } from "./SessionConsole";
import { QuestsView } from "./QuestsView";
import { RevealAudit } from "./RevealAudit";
import { StandingAdjuster } from "./StandingAdjuster";
import { pickNextSession } from "./sessions";
import { RelationshipGraph } from "./RelationshipGraph";
import { PlayerCodex } from "./PlayerCodex";
import { useConfirm, usePrompt } from "../components/feedback";
import { ENTITY_DEFS, type EntityType } from "./entities";
import "./codex.css";

/**
 * The GM worldbuilding workspace (Codex tab): a searchable page list on the left, the two-layer
 * markdown editor on the right. Data is fetched over the codex REST surface and refreshed whenever a
 * `codex:changed` ping arrives; the open page is owned by the editor (not clobbered by list refreshes).
 */
/** New-entity starters: pick a type (which brings its structured fields) + a light prose scaffold. */
const TEMPLATES: ReadonlyArray<{ key: string; label: string; type: EntityType; title: string; player: string; gm: string }> = [
  { key: "blank", label: "Blank page", type: "note", title: "Untitled page", player: "", gm: "" },
  { key: "character", label: "Character", type: "character", title: "Untitled character", player: "## Description\n", gm: "## Secrets & hooks\n" },
  { key: "location", label: "Location", type: "location", title: "Untitled location", player: "## Description\n\n## Points of interest\n", gm: "## Secrets\n\n## Encounters\n" },
  { key: "faction", label: "Faction", type: "faction", title: "Untitled faction", player: "## Overview\n", gm: "## True agenda\n\n## Assets & allies\n" },
  { key: "item", label: "Item", type: "item", title: "Untitled item", player: "## Description\n", gm: "## Secrets\n" },
  { key: "religion", label: "Religion", type: "religion", title: "Untitled religion", player: "## Tenets\n", gm: "## Secrets\n" },
  { key: "species", label: "Species", type: "species", title: "Untitled species", player: "## Description\n\n## Habitat\n", gm: "## Secrets\n" },
  { key: "event", label: "Event", type: "event", title: "Untitled event", player: "## What happened\n", gm: "## The truth\n" }
];

/** M9: the console is a workbench preference — a GM who runs with it open expects it open next game. */
const CONSOLE_KEY = "codex-session-console";

type WorkspaceScene = Readonly<{ id: string; name: string }>;
type WorkspaceActor = Readonly<{ id: string; name: string }>;
export function CodexWorkspace({ gmToken, scenes = [], actors = [], activeSceneId = null, onActivateScene = () => {}, onOpenReplay }: Readonly<{ gmToken: string; scenes?: readonly WorkspaceScene[]; actors?: readonly WorkspaceActor[]; activeSceneId?: string | null; onActivateScene?: (sceneId: string) => void; onOpenReplay?: (archiveId: number) => void }>) {
  // CI-7: `world` is `campaign`. The mode is not persisted anywhere (no localStorage key, no URL), so
  // the rename needs no migration — but it IS the union the mode bar, the palette's goto targets and
  // every `setMode` call share, which is why renaming it here forces the rest to follow.
  const [mode, setMode] = useState<"campaign" | "pages" | "atlas" | "journal" | "graph">("pages");
  const [paletteOpen, setPaletteOpen] = useState(false);
  // "What do players actually see?" — mounts the REAL player Codex against a short-lived PLAYER token
  // minted by the server, so the preview walks the same projection a player does. Never the GM token:
  // the codex router resolves a GM token to role `gm` and would hand back GM projections.
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [templateMenu, setTemplateMenu] = useState(false);
  const [pageFilter, setPageFilter] = useState<{ type: EntityType | null; tag: string | null }>({ type: null, tag: null });
  const [pages, setPages] = useState<CodexPageSummary[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [edges, setEdges] = useState<CodexRelationshipEdge[]>([]);
  // CI-8: the Graph's SECOND edge kind. Loaded beside `edges` on purpose — the typed feed is already
  // fetched here for a mode the GM may not open, so the wiki-link feed sharing that path (and this
  // surface's one loading flag and one error Alert, per R4) is one round-trip, not a second pattern.
  const [links, setLinks] = useState<CodexLinkEdge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ page: CodexPage; backlinks: readonly CodexBacklink[]; relationships: readonly CodexRelationship[] } | null>(null);
  const [query, setQuery] = useState("");
  // CI-1: where a cross-mode jump is *going*, held here because the destination mode owns the landing.
  const [atlasTarget, setAtlasTarget] = useState<AtlasTarget | null>(null);
  const [journalTarget, setJournalTarget] = useState<string | null>(null);
  // CI-5: which entity the Graph should land focused on. Same latch shape as the two above.
  const [graphTarget, setGraphTarget] = useState<string | null>(null);
  /**
   * M9: the session log is a DESTINATION, not a sixth mode — `sessionsOpen` swaps the content region
   * while the mode bar stays put, so the console toggle never goes out of reach and picking any tab
   * returns to that mode. `sessionTarget` is the same latch the three above use; `null` means "open the
   * log with nothing selected", which is what the console's empty state asks for.
   */
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessionTarget, setSessionTarget] = useState<string | null>(null);
  /**
   * M10: the quest log is the SECOND such destination, and it is deliberately the same three lines. The
   * two are mutually exclusive — they lay over the same content region — so each opener closes the other
   * rather than leaving one silently stacked behind the other.
   */
  const [questsOpen, setQuestsOpen] = useState(false);
  const [questTarget, setQuestTarget] = useState<string | null>(null);
  /**
   * M12 / CT-9: the reveal audit is the THIRD such destination, on identical terms. It has no target
   * latch because nothing jumps INTO it — it is reached only from the ops row, and it lands on the whole
   * picture rather than on one record. All three lay over the same content region, so each opener closes
   * the other two rather than leaving one silently stacked behind another.
   */
  const [auditOpen, setAuditOpen] = useState(false);
  /** M12 / CT-6: which faction's standing the GM is adjusting, or null. GM-only — see `StandingAdjuster`. */
  const [adjustingFactionId, setAdjustingFactionId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("codex-notebook-collapsed") ?? "[]") as string[]); } catch { return new Set(); }
  });
  // Same lazy-initialiser + try/catch discipline as `collapsed` above and `sort` below: private mode
  // throws on both read and write, and a console that refused to open there would be a worse failure
  // than one that simply forgets it was open.
  const [consoleOpen, setConsoleOpen] = useState(() => {
    try { return localStorage.getItem(CONSOLE_KEY) === "open"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem(CONSOLE_KEY, consoleOpen ? "open" : "closed"); } catch { /* private mode - fine */ } }, [consoleOpen]);
  const [error, setError] = useState<string | null>(null);
  // CF-2: before this the first fetch showed "No pages yet" — an empty state that lies while loading.
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<NotebookSort>(() => { try { return (localStorage.getItem("codex-notebook-sort") as NotebookSort) || "name-asc"; } catch { return "name-asc"; } });
  const [movingPageId, setMovingPageId] = useState<string | null>(null);
  const { toast } = useToast();
  const { prompt, dialog: promptDialog } = usePrompt();
  const { confirm, dialog: confirmDialog } = useConfirm();

  // The rail always holds the FULL notebook (for the folder tree + [[ autocomplete)); search is a separate overlay.
  const refreshList = useCallback(async () => {
    try {
      const [nextPages, nextEdges, nextFolders, nextLinks] = await Promise.all([codexApi.listPages(gmToken), codexApi.listRelationships(gmToken), codexApi.listFolders(gmToken).catch(() => []), codexApi.listLinks(gmToken)]);
      setPages(nextPages); setEdges(nextEdges); setFolders(nextFolders); setLinks(nextLinks); setError(null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load the codex."); }
    finally { setLoading(false); }
  }, [gmToken]);

  useEffect(() => { void refreshList(); }, [refreshList]);

  /**
   * M9: **the** session feed. One read, one copy, four consumers — the Campaign card, the journal's
   * by-session lens, the console drawer and the session log. They are four views of one record set, and
   * the moment any of them fetched for itself they could disagree about which sessions exist and which
   * one is active.
   *
   * Loaded on mount rather than lazily like `loadCampaign` below, because the console is reachable from
   * EVERY mode: a feed that only arrived on the Campaign tab would leave the console empty in exactly
   * the modes it exists to serve. `activeSessionId` rides along with the list because it names a row in
   * that same list — fetching them apart is how a console ends up pointing at a session the list no
   * longer contains.
   */
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

  /**
   * M10: **the** quest feed, on the session feed's terms exactly. One read, one copy, two consumers —
   * the Campaign dashboard card and the quest log — because the moment either fetched for itself they
   * could disagree about which quests exist and which are still open.
   *
   * Loaded on mount rather than lazily like `loadCampaign` below, because the quest log is reachable
   * from EVERY mode through the ops row: a feed that only arrived on the Campaign tab would leave the
   * log empty in exactly the modes a GM reaches it from mid-game.
   */
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
   * M12 / CT-6: **the** standing feed, on the quest feed's terms. Two consumers — the Campaign card and
   * the adjust dialog it opens — and the moment either fetched for itself they could disagree about
   * where the party stands, which is the one number this feature exists to state once.
   *
   * Unlike the session and quest feeds it loads with the DASHBOARD (`loadCampaign` below) rather than on
   * mount: standing is read and written on the Campaign tab and nowhere else, so a GM who never opens it
   * should not pay a round-trip for it on the suite's most-loaded surface.
   */
  const [standing, setStanding] = useState<readonly CodexStanding[]>([]);

  /**
   * CI-7: the dashboard's own feed — the journal, the atlas and the calendar, which the notebook rail
   * never needed. Deliberately NOT folded into `refreshList`: that runs on mount and on every
   * `codex:changed`, and the workspace lands on Pages, so three extra round-trips would be paid by
   * every GM on the suite's most-loaded surface to render a mode they may not open. This fetches when
   * Campaign is actually on screen, and refreshes with the rest while it stays there.
   */
  const [campaign, setCampaign] = useState<{ records: readonly CodexChronicleRecord[]; maps: readonly CodexMap[]; calendar: GmCodexCalendar | null }>({ records: [], maps: [], calendar: null });
  const [campaignLoading, setCampaignLoading] = useState(true);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const loadCampaign = useCallback(async () => {
    try {
      // M11: the CHRONICLE, not the raw journal read this used to take. Two reasons, and the first alone
      // would decide it: whether a deadline has fired is derived by the server and lives only on a
      // chronicle record, so the deadlines card cannot be fed from `/journal` at all. The second is that
      // the player's dashboard has always read the chronicle — one feed for one dashboard means the two
      // audiences can no longer be looking at differently-assembled versions of the same card.
      // M12: standing rides this same read. It is uncaught, like the three beside it — a dashboard that
      // silently dropped the standing card would be exactly the "one fewer section, silently" failure
      // R4's error Alert exists to prevent.
      const [records, maps, calendar, nextStanding] = await Promise.all([journalApi.chronicle(gmToken), atlasApi.listMaps(gmToken), calendarApi.get(gmToken), standingApi.list(gmToken)]);
      setCampaign({ records, maps, calendar }); setStanding(nextStanding); setCampaignError(null);
    } catch (loadError) { setCampaignError(loadError instanceof Error ? loadError.message : "Could not load the campaign dashboard."); }
    finally { setCampaignLoading(false); }
  }, [gmToken]);
  useEffect(() => {
    if (mode !== "campaign") return;
    void loadCampaign();
    const onChanged = () => { void loadCampaign(); };
    socket.on("codex:changed", onChanged);
    return () => { socket.off("codex:changed", onChanged); };
  }, [mode, loadCampaign]);

  /**
   * Newest first, and flattened to the one shape the dashboard renders.
   *
   * `createdAt`, deliberately, and not the two nearer-looking alternatives. `sortKey` is an insertion
   * counter (`MAX(sort_key) + 1`), so it reads as chronology and is not; the timeline's own order is
   * in-world chronology (`calendar_instant`, then session), which answers "when did this happen in the
   * story" rather than "what has been written lately" — and it is the only one of the three the PLAYER
   * projection cannot express, since a player entry carries `createdAt` and nothing else to sort on.
   * One notion of "recent", available to both audiences.
   *
   * `playerText || gmText` because a GM-only entry has no player line and would otherwise render as a
   * blank row on the GM's own dashboard.
   */
  const campaignEntries = useMemo<readonly CampaignEntry[]>(() => [...campaign.records]
    // CT-11: dated `event` pages share the chronicle but not this list, exactly as on the player's
    // dashboard — the section is "Recent journal activity" and its rows open the Journal by entry id,
    // while an event is a wiki page already counted in the entity totals above.
    .filter((record) => record.kind !== "event")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((record) => ({ id: record.id, summary: record.text.trim() || (record.gmText ?? "").trim(), when: chronicleWhenLabel(record), kind: record.kind })), [campaign.records]);
  /**
   * M11: the deadlines, ordered by the SHARED rule (`campaignDeadlines` — passed first, then approaching)
   * and mapped down to the keys the shared card type carries. `fired` rides across from the server's
   * derivation untouched; `gmText` has nowhere to go, which is the point, since the player's Codex
   * renders this same component.
   */
  const campaignDeadlineCards = useMemo<readonly CampaignDeadline[]>(
    () => campaignDeadlines(campaign.records).map((record) => ({ id: record.id, summary: record.text.trim() || (record.gmText ?? "").trim(), when: chronicleWhenLabel(record), fired: record.fired })),
    [campaign.records]
  );
  const campaignToday = useMemo(() => (campaign.calendar?.currentDate ? formatWorldDate(campaign.calendar, campaign.calendar.currentDate) : null), [campaign.calendar]);
  /**
   * M12 / CT-6: the standing card's rows — **every faction PAGE**, not only the ones with a stored row.
   *
   * A faction the GM has written but never rated shows at 0 ("Uninvested"), because this card is the one
   * place standing is adjusted: listing only the rated ones would make a brand-new faction unreachable,
   * and "add a standing" would have to become a second control answering a question the card already
   * asks. The store's own model agrees — no row simply means nobody has taken a position yet.
   *
   * A stored row whose faction page has since been deleted has nowhere to render and is dropped here;
   * the server's cascade removes it on the next write, and the reveal audit still lists it meanwhile.
   */
  const campaignStanding = useMemo<readonly CampaignStanding[]>(() => {
    const byFaction = new Map(standing.map((row) => [row.factionPageId, row.value]));
    return pages
      .filter((page) => page.entityType === "faction")
      .map((page) => ({ factionPageId: page.id, name: page.title, value: byFaction.get(page.id) ?? 0 }));
  }, [pages, standing]);
  /** The faction the adjust dialog is open on, and its stored row (null = never rated — it starts at 0). */
  const adjustingFaction = useMemo(() => {
    if (!adjustingFactionId) return null;
    const page = pages.find((candidate) => candidate.id === adjustingFactionId);
    if (!page) return null;
    return { page, standing: standing.find((row) => row.factionPageId === adjustingFactionId) ?? null };
  }, [adjustingFactionId, pages, standing]);

  // CI-1 / R8: the rail's search is the SUITE's search — pages, journal entries, maps and markers in one
  // list. It overlays the tree while a query is active and re-runs when the notebook changes.
  const runSearch = useCallback((q: string) => codexApi.search(gmToken, q), [gmToken]);
  const searchState = useCodexSearch(query, runSearch, pages);

  /**
   * R1: every cross-mode jump prepares its destination. A page lands on Pages with the notebook filter
   * cleared and the page open; a map opens the Atlas on that map; a MARKER opens the Atlas on its map and
   * then selects the pin (both halves, which is why the hit carries `mapId`); a journal entry lands on
   * the Journal with that entry marked. The query itself is kept on purpose — it is the list the GM is
   * working through, not stale state.
   */
  const openHit = useCallback((hit: CodexSearchHit) => {
    switch (hit.kind) {
      case "page": setPageFilter({ type: null, tag: null }); setMode("pages"); setSelectedId(hit.id); break;
      case "map": setAtlasTarget({ mapId: hit.id, markerId: null }); setMode("atlas"); break;
      // A hit normally names the pin's map. If the server ever hands one back without it, the target
      // still travels: since CI-6 the Atlas resolves a map-less pin itself rather than the click being
      // silently swallowed (which is what `setAtlasTarget(null)` used to do here).
      case "marker": setAtlasTarget({ mapId: hit.mapId, markerId: hit.id }); setMode("atlas"); break;
      case "journal": setJournalTarget(hit.id); setMode("journal"); break;
      // M10: a quest hit lands ON the quest in the log, the same latch every other jump uses. It also
      // closes the session log, since the two destinations share one region.
      case "quest": setSessionsOpen(false); setQuestTarget(hit.id); setQuestsOpen(true); break;
    }
  }, []);

  const toggleFolder = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      try { localStorage.setItem("codex-notebook-collapsed", JSON.stringify([...next])); } catch { /* private mode - fine */ }
      return next;
    });
  }, []);

  // Live refresh: any codex write pings every client. Refresh the list only - the editor owns the open page.
  // The session feed rides the same ping: a session write from another device (or from the session log
  // here) has to reach the console and the journal lens, which read no other source.
  useEffect(() => {
    const onChanged = () => { void refreshList(); void loadSessions(); void loadQuests(); };
    socket.on("codex:changed", onChanged);
    return () => { socket.off("codex:changed", onChanged); };
  }, [refreshList, loadSessions, loadQuests]);

  // Cmd/Ctrl-K toggles the quick-switcher.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen((open) => !open); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    let live = true;
    void codexApi.getPage(gmToken, selectedId).then((result) => { if (live) setSelected(result); }).catch(() => { if (live) setSelected(null); });
    return () => { live = false; };
  }, [gmToken, selectedId]);

  // Refetch the open page (e.g. after a relationship edit) to pull its fresh backlinks + relationships.
  const refreshSelected = useCallback(() => {
    if (!selectedId) return;
    void codexApi.getPage(gmToken, selectedId).then(setSelected).catch(() => undefined);
  }, [gmToken, selectedId]);

  const createPage = async () => {
    try { const page = await codexApi.createPage(gmToken, { title: "Untitled page" }); await refreshList(); setSelectedId(page.id); }
    catch (createError) { setError(createError instanceof Error ? createError.message : "Could not create the page."); }
  };
  const createPageTitled = async (title: string) => {
    try { const page = await codexApi.createPage(gmToken, { title }); await refreshList(); setMode("pages"); setSelectedId(page.id); }
    catch (createError) { setError(createError instanceof Error ? createError.message : "Could not create the page."); }
  };
  const createFromTemplate = async (template: (typeof TEMPLATES)[number]) => {
    setTemplateMenu(false);
    try { const page = await codexApi.createPage(gmToken, { title: template.title, entityType: template.type, playerBody: template.player, gmBody: template.gm }); await refreshList(); setMode("pages"); setSelectedId(page.id); }
    catch (createError) { setError(createError instanceof Error ? createError.message : "Could not create the page."); }
  };
  const createInFolder = async (folder: string) => {
    try { const page = await codexApi.createPage(gmToken, { title: "Untitled page", folder }); await refreshList(); setMode("pages"); setSelectedId(page.id); }
    catch (createError) { setError(createError instanceof Error ? createError.message : "Could not create the page."); }
  };
  const openPlayerPreview = async () => {
    setPreviewError(null);
    try { setPreviewToken(await codexApi.createPreviewSession(gmToken)); }
    catch (previewFailure) { setPreviewError(previewFailure instanceof Error ? previewFailure.message : "Couldn't open the player preview."); }
  };
  const importInputRef = useRef<HTMLInputElement>(null);
  const exportCodex = async () => {
    try {
      const data = await codexApi.exportBundle(gmToken);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = "codex-export.json"; link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) { setError(exportError instanceof Error ? exportError.message : "Export failed."); }
  };
  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    let imported = 0; const failed: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const title = file.name.replace(/\.(md|markdown|txt)$/i, "").trim();
        await codexApi.createPage(gmToken, { title: title || "Imported page", playerBody: text });
        imported += 1;
      } catch { failed.push(file.name); }
    }
    await refreshList();
    if (failed.length) { setError(`Imported ${imported} of ${files.length}. Couldn't import: ${failed.join(", ")}.`); }
    else { setError(null); toast(`Imported ${imported} page${imported === 1 ? "" : "s"}.`, { tone: "success" }); }
  };

  const navigate = useCallback(async (target: string) => {
    const key = pageLinkKey(target.replace(/^(page|actor|monster|spell|map|marker):/i, ""));
    const existing = pages.find((page) => pageLinkKey(page.title) === key);
    if (existing) { setSelectedId(existing.id); return; }
    try { const page = await codexApi.createPage(gmToken, { title: target.replace(/^page:/i, "").trim() || "Untitled page" }); await refreshList(); setSelectedId(page.id); }
    catch { /* ignore - navigation to a missing page is best-effort */ }
  }, [pages, gmToken, refreshList]);

  const onPageChanged = useCallback((page: CodexPage) => {
    setSelected((prev) => (prev ? { ...prev, page } : prev));
    setPages((prev) => prev.map((row) => (row.id === page.id ? { ...row, title: page.title, folder: page.folder, tags: page.tags, revealedToPlayers: page.revealedToPlayers, rev: page.rev, updatedAt: page.updatedAt } : row)));
  }, []);

  const onPageDeleted = useCallback(() => { setSelectedId(null); setSelected(null); void refreshList(); }, [refreshList]);

  const tree = useMemo(() => buildFolderTree(pages, folders), [pages, folders]);
  const filteredPages = useMemo(() => pages.filter((page) => (!pageFilter.type || page.entityType === pageFilter.type) && (!pageFilter.tag || page.tags.includes(pageFilter.tag))), [pages, pageFilter]);
  // Every folder path (records + those implied by page paths, with ancestors), for the "move to folder" picker.
  const allFolders = useMemo(() => {
    const set = new Set<string>(folders);
    for (const page of pages) { let path = ""; for (const segment of (page.folder ?? "").split("/").map((part) => part.trim()).filter(Boolean)) { path = path ? `${path}/${segment}` : segment; set.add(path); } }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [pages, folders]);

  const changeSort = (next: NotebookSort) => { setSort(next); try { localStorage.setItem("codex-notebook-sort", next); } catch { /* private mode */ } };
  const movePage = useCallback(async (id: string, folder: string | null) => {
    try { const page = await codexApi.updatePage(gmToken, id, { folder }); onPageChanged(page); await refreshList(); }
    catch (moveError) { setError(moveError instanceof Error ? moveError.message : "Couldn't move that page."); }
  }, [gmToken, onPageChanged, refreshList]);
  // Drag a folder onto another folder (nest it) or the top level. moveFolder re-paths every note + subfolder
  // under it, so the whole subtree travels with the folder.
  const moveFolderTo = useCallback(async (fromPath: string, toParent: string | null) => {
    const name = fromPath.split("/").pop() ?? fromPath;
    const to = toParent ? `${toParent}/${name}` : name;
    if (to === fromPath) return; // dropped on its current parent — no change
    try { await codexApi.moveFolder(gmToken, fromPath, to); await refreshList(); }
    catch (moveError) { setError(moveError instanceof Error ? moveError.message : "Couldn't move that folder."); }
  }, [gmToken, refreshList]);
  const doMove = async (folder: string | null) => { const id = movingPageId; setMovingPageId(null); if (id) await movePage(id, folder); };
  const doMoveToNew = async () => {
    const id = movingPageId; setMovingPageId(null);
    if (!id) return;
    const name = await prompt({ title: "New folder", body: "Name a folder to move this note into.", placeholder: "e.g. NPCs/Villains", confirmLabel: "Move here" });
    if (!name) return;
    try { await codexApi.createFolder(gmToken, name); } catch { /* best-effort - the move still files the note there */ }
    await movePage(id, name);
  };
  const openFolder = (path: string) => setCollapsed((prev) => { if (!prev.has(path)) return prev; const next = new Set(prev); next.delete(path); try { localStorage.setItem("codex-notebook-collapsed", JSON.stringify([...next])); } catch { /* private mode */ } return next; });
  // Folders are real records now, so an empty one persists (created here with no note inside - add notes with ＋).
  const newFolder = async () => {
    const name = await prompt({ title: "New folder", body: "Name the folder. It starts empty - add notes to it with the ＋ on its row.", placeholder: "e.g. NPCs", confirmLabel: "Create" });
    if (!name) return;
    try { await codexApi.createFolder(gmToken, name); await refreshList(); }
    catch (folderError) { setError(folderError instanceof Error ? folderError.message : "Couldn't create the folder."); }
  };
  const newSubfolder = async (parentPath: string) => {
    const name = await prompt({ title: "New subfolder", body: `Add a subfolder inside "${parentPath}". It starts empty.`, placeholder: "e.g. Villains", confirmLabel: "Create" });
    if (!name) return;
    const child = name.split("/").map((segment) => segment.trim()).filter(Boolean).join("/");
    if (!child) return;
    try { await codexApi.createFolder(gmToken, `${parentPath}/${child}`); openFolder(parentPath); await refreshList(); }
    catch (folderError) { setError(folderError instanceof Error ? folderError.message : "Couldn't create the subfolder."); }
  };
  const renameFolder = async (path: string) => {
    const current = path.split("/").pop() ?? path;
    const name = await prompt({ title: "Rename folder", body: `Rename "${path}". Type a name, or a full path to move it.`, defaultValue: current, confirmLabel: "Rename" });
    if (!name || name === current) return;
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const to = name.includes("/") ? name : parent ? `${parent}/${name}` : name;
    try { await codexApi.moveFolder(gmToken, path, to); await refreshList(); }
    catch (renameError) { setError(renameError instanceof Error ? renameError.message : "Couldn't rename that folder."); }
  };
  const deleteFolder = async (path: string) => {
    const inside = pages.filter((page) => page.folder === path || (page.folder ?? "").startsWith(`${path}/`)).length;
    const note = inside > 0 ? ` Its ${inside} note${inside === 1 ? "" : "s"} move to the top level (nothing is deleted).` : "";
    if (!(await confirm({ title: "Delete folder", body: `Delete the folder "${path}"?${note}`, confirmLabel: "Delete folder", danger: true }))) return;
    try { await codexApi.deleteFolder(gmToken, path); await refreshList(); }
    catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Couldn't delete that folder."); }
  };

  return (
    <div className="codex-root">
      <div className="codex-modebar">
        {/* The wrapper exists only to hang the overflow cue on — five modes do not fit a 375px strip, and
            the tabs themselves are the primitive's and stay untouched. See `.codex-modetabs` in codex.css. */}
        <div className="codex-modetabs">
          {/* Picking a mode also leaves the session log: the log is a destination laid over the modes,
              so a tab that changed the mode underneath it without surfacing would look like a dead tab. */}
          <Tabs ariaLabel="Codex view" activeId={mode} onChange={(id) => { setMode(id as typeof mode); setSessionsOpen(false); setQuestsOpen(false); setAuditOpen(false); }}
            tabs={[{ id: "campaign", label: "Campaign" }, { id: "pages", label: "Pages" }, { id: "atlas", label: "Atlas" }, { id: "journal", label: "Journal" }, { id: "graph", label: "Graph" }]} />
        </div>
        <div className="codex-modebar-ops">
          <Button variant="ghost" size="sm" onClick={() => setPaletteOpen(true)} aria-keyshortcuts="Meta+K Control+K">Search</Button>
          {/* M9's two, and M10's third. Every one is `Button size="sm"` — a `@vtt/ui` primitive that
              carries the 44px floor itself (§4 route 2, `.nh-btn--sm`), so there is no new control here
              and no new floor to argue about. They live in the ops row rather than as extra tabs because
              the five modes already overflow a 375px strip; this row wraps, which a tab strip does not. */}
          <Button variant="ghost" size="sm" onClick={() => { setQuestsOpen(false); setAuditOpen(false); setSessionTarget(null); setSessionsOpen(true); }}>Sessions</Button>
          <Button variant="ghost" size="sm" onClick={() => { setSessionsOpen(false); setAuditOpen(false); setQuestTarget(null); setQuestsOpen(true); }}>Quests</Button>
          <Button variant="ghost" size="sm" aria-expanded={consoleOpen} onClick={() => setConsoleOpen((open) => !open)}>Session console</Button>
          {/* M12 / CT-9. It belongs beside "Preview as player" rather than with the mode tabs because the
              two answer halves of one question — that one shows what a player sees, this one lists what
              they are allowed to. `Button size="sm"` is a `@vtt/ui` primitive and carries the 44px floor
              itself (§4 route 2, `.nh-btn--sm`); the row wraps, where a tab strip would not.
              Called "Reveal audit" and NOT "What players see", which is already the player-preview
              modal's title — two buttons a thumb apart with the same words would be worse than a
              slightly technical one. */}
          <Button variant="ghost" size="sm" onClick={() => { setSessionsOpen(false); setQuestsOpen(false); setAuditOpen(true); }}>Reveal audit</Button>
          <Button variant="ghost" size="sm" onClick={openPlayerPreview}>Preview as player</Button>
          <Button variant="ghost" size="sm" onClick={() => importInputRef.current?.click()}>Import</Button>
          <Button variant="ghost" size="sm" onClick={exportCodex}>Export</Button>
          <input ref={importInputRef} type="file" accept=".md,.markdown,.txt" multiple hidden onChange={(event) => { void importFiles(event.target.files); event.target.value = ""; }} />
        </div>
      </div>
      {/* CF-2: one error surface for the whole workspace. It previously lived inside the Pages rail, so a
          failed load was invisible in Campaign, Atlas, Journal and Graph. */}
      {error && <Alert tone="danger" title="Couldn't load the codex">{error}</Alert>}
      {auditOpen
        ? <RevealAudit gmToken={gmToken} onClose={() => setAuditOpen(false)} />
        : sessionsOpen
        ? <SessionsView gmToken={gmToken} sessions={sessions} activeSessionId={activeSessionId}
            loading={sessionsLoading} error={sessionsError} onChanged={loadSessions}
            openSessionId={sessionTarget} onOpenedSession={() => setSessionTarget(null)}
            onClose={() => setSessionsOpen(false)} />
        : questsOpen
        ? <QuestsView gmToken={gmToken} quests={quests} pages={pages}
            loading={questsLoading} error={questsError} onChanged={loadQuests}
            openQuestId={questTarget} onOpenedQuest={() => setQuestTarget(null)}
            /* R1: a linked entity opens the notebook ON that page, which means leaving this destination. */
            onOpenPage={(pageId) => { setQuestsOpen(false); setMode("pages"); setSelectedId(pageId); }}
            onClose={() => setQuestsOpen(false)} />
        : mode === "campaign"
        ? <CampaignHome pages={pages} entries={campaignEntries} maps={campaign.maps} today={campaignToday}
            loading={loading || campaignLoading} error={campaignError}
            /* M9: the GM's card is the session the table is POINTED at — `activeSessionId` is an answer
               only a GM token receives, so the choice is made here and the presentational dashboard is
               handed a result. `recapBody` is renamed on the way in to the one shared shape a player
               projection can also produce; `prepBody` has nowhere to go, which is the point. */
            session={(() => { const next = pickNextSession(sessions, activeSessionId); return next && { id: next.id, sessionNumber: next.sessionNumber, realDate: next.realDate, recap: next.recapBody }; })()}
            onOpenSession={(sessionId) => { setSessionTarget(sessionId); setSessionsOpen(true); }}
            /* M10: mapped down to the four keys the shared card type carries, exactly as the session is
               above. `gmBody` has nowhere to go — the type has no field for it — which is the point:
               this component is rendered by the player's Codex too. */
            quests={quests.map((quest) => ({ id: quest.id, title: quest.title, status: quest.status, objectives: quest.objectives }))}
            onOpenQuest={(questId) => { setQuestTarget(questId); setQuestsOpen(true); }}
            /* M11: a deadline is a journal record, so its row opens through the SAME jump an ordinary
               journal row uses (`onOpenEntry` below) — the Journal, with that record marked. */
            deadlines={campaignDeadlineCards}
            /* M12 / CT-6: every faction and where it stands. `onAdjustStanding` is the capability flag
               that turns the card's readout rows into adjustable ones — the player's Codex passes no
               such callback, and the shared card type carries no reveal flag for it to leak. */
            standing={campaignStanding}
            onAdjustStanding={setAdjustingFactionId}
            onCreate={() => { setMode("pages"); void createPage(); }} onOpenPage={(id) => { setMode("pages"); setSelectedId(id); }}
            /* R1: both new jumps prepare their destination — the entry is marked on the timeline, the
               map is the one that opens — reusing the very latches search already lands through. */
            onOpenEntry={(entryId) => { setJournalTarget(entryId); setMode("journal"); }}
            onOpenMap={(mapId) => { setAtlasTarget({ mapId, markerId: null }); setMode("atlas"); }}
            onPickType={(type) => { setPageFilter({ type, tag: null }); setQuery(""); setSelectedId(null); setMode("pages"); }}
            onPickTag={(tag) => { setPageFilter({ type: null, tag }); setQuery(""); setSelectedId(null); setMode("pages"); }} />
        : mode === "atlas"
        ? <AtlasView gmToken={gmToken} scenes={scenes} actors={actors} activeSceneId={activeSceneId} onActivateScene={onActivateScene} onOpenReplay={onOpenReplay} onOpenPage={(pageId) => { setMode("pages"); setSelectedId(pageId); }}
            openTarget={atlasTarget} onOpenedTarget={() => setAtlasTarget(null)} />
        : mode === "journal"
        ? <JournalView gmToken={gmToken} onOpenReplay={onOpenReplay} onOpenPage={(pageId) => { setMode("pages"); setSelectedId(pageId); }}
            /* CI-6: the entry knows its pin but not the pin's map — the Atlas resolves that half. */
            onOpenMarker={(markerId) => { setAtlasTarget({ mapId: null, markerId }); setMode("atlas"); }}
            openEntryId={journalTarget} onOpenedEntry={() => setJournalTarget(null)}
            /* M9: the workspace's own session feed, so the by-session lens can tell a heading with a
               real record behind it from a legacy number that has none (there is no backfill). */
            sessions={sessions} onOpenSession={(sessionId) => { setSessionTarget(sessionId); setSessionsOpen(true); }} />
        : mode === "graph"
        ? <RelationshipGraph loading={loading} nodes={pages.map((page) => ({ id: page.id, title: page.title, entityType: page.entityType }))} edges={edges} links={links}
            onOpen={(pageId) => { setMode("pages"); setSelectedId(pageId); }}
            focusPageId={graphTarget} onFocused={() => setGraphTarget(null)} />
        : <div className={`codex-workspace${selectedId ? " has-selection" : ""}`}>
      <aside className="codex-rail">
        <div className="codex-rail-head">
          <Input value={query} placeholder="Search the notebook…" aria-label="Search the notebook" onChange={(event) => { setQuery(event.target.value); if (event.target.value.trim()) setPageFilter({ type: null, tag: null }); }} />
          <Menu label="New page from a template" trigger="New" className="codex-newpage">
            {TEMPLATES.map((template) => (
              <MenuItem key={template.key} icon={<EntityIcon type={template.type} />} onClick={() => void createFromTemplate(template)}>{template.label}</MenuItem>
            ))}
          </Menu>
        </div>
        {!query.trim() && !pageFilter.type && !pageFilter.tag && (
          <div className="codex-rail-tools">
            <Select aria-label="Sort notes" value={sort} onChange={(event) => changeSort(event.target.value as NotebookSort)}>
              <option value="name-asc">Name A–Z</option>
              <option value="name-desc">Name Z–A</option>
              <option value="recent">Recently edited</option>
            </Select>
            <Button variant="ghost" size="sm" onClick={newFolder}>＋ Folder</Button>
          </div>
        )}
        <nav className="codex-list" aria-label="Campaign notebook">
          {(pageFilter.type || pageFilter.tag) && !query.trim() ? (
            <>
              <Chip onRemove={() => setPageFilter({ type: null, tag: null })} removeLabel="Clear filter">{pageFilter.type ? `${ENTITY_DEFS[pageFilter.type].label}s` : `#${pageFilter.tag}`}</Chip>
              {filteredPages.length === 0
                ? <p className="codex-list-empty">Nothing here yet.</p>
                : filteredPages.map((page) => (
                    <button key={page.id} type="button" className={`codex-list-item${page.id === selectedId ? " is-active" : ""}`} onClick={() => setSelectedId(page.id)}>
                      <span className="codex-list-title">{page.title}</span>
                      {page.revealedToPlayers && <Badge tone="success">Shown</Badge>}
                    </button>
                  ))}
            </>
          ) : query.trim()
            ? <SearchResultList state={searchState} selectedId={selectedId} onOpen={openHit} emptyLabel="Nothing in the codex matches." />
            : loading
                ? <div className="codex-list-loading">{[0, 1, 2, 3].map((row) => <Skeleton key={row} variant="text" />)}</div>
            : pages.length === 0
                ? (!error && <p className="codex-list-empty">No pages yet.</p>)
                : <NotebookTree node={tree} sort={sort} collapsed={collapsed} selectedId={selectedId} onToggle={toggleFolder} onSelect={setSelectedId} onNewInFolder={createInFolder} onNewSubfolder={newSubfolder} onRenameFolder={renameFolder} onDeleteFolder={deleteFolder} onMovePage={movePage} onMoveFolder={moveFolderTo} onRequestMove={setMovingPageId} />}
        </nav>
      </aside>
      <section className="codex-main">
        {selectedId && <button type="button" className="codex-back" onClick={() => setSelectedId(null)}>‹ All pages</button>}
        {selected
          ? <PageEditor key={selected.page.id} gmToken={gmToken} page={selected.page} pages={pages} backlinks={selected.backlinks} relationships={selected.relationships} onChange={onPageChanged} onDeleted={onPageDeleted} onNavigate={navigate} onOpenReplay={onOpenReplay} onRelationshipsChanged={refreshSelected}
              /* CI-3 / CI-4 / CI-5, R1: the page's three return edges, each landing on a PREPARED
                 destination — through the very same latches search and the dashboard already jump
                 through, so there is one way into each mode rather than a second parallel one. A pin
                 knows its own map (the GM projection carries `mapId`), so both halves travel together
                 and the Atlas never has to go hunting. */
              onOpenEntry={(entryId) => { setJournalTarget(entryId); setMode("journal"); }}
              onOpenMarker={(markerId, mapId) => { setAtlasTarget({ mapId, markerId }); setMode("atlas"); }}
              onShowInGraph={(pageId) => { setGraphTarget(pageId); setMode("graph"); }} />
          : <div className="codex-main-empty"><h3>Select a page</h3><p>Every page has a player-facing side and a GM-only side. Choose one from the list, or create a new page.</p><Button variant="primary" onClick={createPage}>New page</Button></div>}
      </section>
        </div>}
      {/* M9. Always mounted, open or not: `Drawer` is non-modal and stays in the tree (inert, translated
          off-screen) so the slide plays both ways. It reads the SAME `sessions` feed the log edits and
          calls no write endpoint of its own — it is a view of one record, not a second copy of it. */}
      <SessionConsole open={consoleOpen} onClose={() => setConsoleOpen(false)} gmToken={gmToken}
        session={sessions.find((session) => session.id === activeSessionId) ?? null}
        loading={sessionsLoading} error={sessionsError}
        /* The console is mounted in every mode AND over both destinations, so this is the one session
           jump that has to close the quest log on its way (M10: the two destinations share one region). */
        onOpenSession={(sessionId) => { setConsoleOpen(false); setQuestsOpen(false); setSessionTarget(sessionId); setSessionsOpen(true); }} />
      {/* Same `openHit` the rail uses: one search, one result list, one set of destinations (R8 + R1). */}
      {paletteOpen && <CommandPalette gmToken={gmToken} onOpenHit={openHit} onCreatePage={createPageTitled} onGoto={(target) => setMode(target)} onClose={() => setPaletteOpen(false)} />}
      <Modal open={!!movingPageId} onClose={() => setMovingPageId(null)} title="Move to folder" size="sm" ariaLabel="Move to folder">
        <div className="codex-move-list">
          <button type="button" className="codex-move-opt" onClick={() => void doMove(null)}>Top level</button>
          {allFolders.map((path) => <button key={path} type="button" className="codex-move-opt" onClick={() => void doMove(path)}>{path}</button>)}
          <button type="button" className="codex-move-opt is-new" onClick={() => void doMoveToNew()}>+ New folder…</button>
        </div>
      </Modal>
      {previewError && <Alert tone="danger">{previewError}</Alert>}
      <Modal open={!!previewToken} onClose={() => setPreviewToken(null)} size="lg" title="What players see" ariaLabel="Player Codex preview">
        <p className="codex-inspector-hint">This is the real player Codex, read through a player session — anything hidden from players is absent here, not just dimmed.</p>
        {previewToken && <PlayerCodex token={previewToken} />}
      </Modal>
      {/* M12 / CT-6: the GM's write control for standing. It lives HERE and never inside `CampaignHome`,
          which the player's Codex also renders — the dashboard card only asks for it by id. */}
      {adjustingFaction && (
        <StandingAdjuster key={adjustingFaction.page.id} gmToken={gmToken}
          factionPageId={adjustingFaction.page.id} factionName={adjustingFaction.page.title}
          standing={adjustingFaction.standing}
          onSaved={loadCampaign} onClose={() => setAdjustingFactionId(null)} />
      )}
      {promptDialog}
      {confirmDialog}
    </div>
  );
}

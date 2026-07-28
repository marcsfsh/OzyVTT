import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Chip, Input, Menu, MenuItem, Modal, Select, Skeleton, Tabs, useToast } from "@vtt/ui";
import { socket } from "../socket";
import { atlasApi, calendarApi, codexApi, formatWorldDate, journalApi, pageLinkKey, type CodexBacklink, type CodexCalendar, type CodexJournalEntry, type CodexLinkEdge, type CodexMap, type CodexPage, type CodexPageSummary, type CodexRelationship, type CodexRelationshipEdge, type CodexSearchHit } from "./api";
import { PageEditor } from "./PageEditor";
import { AtlasView, type AtlasTarget } from "./AtlasView";
import { JournalView, journalWhenLabel } from "./JournalView";
import { CommandPalette } from "./CommandPalette";
import { SearchResultList, useCodexSearch } from "./SearchResults";
import { NotebookTree, buildFolderTree, type NotebookSort } from "./NotebookTree";
import { EntityIcon } from "./icons";
import { CampaignHome, type CampaignEntry } from "./CampaignHome";
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
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("codex-notebook-collapsed") ?? "[]") as string[]); } catch { return new Set(); }
  });
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
   * CI-7: the dashboard's own feed — the journal, the atlas and the calendar, which the notebook rail
   * never needed. Deliberately NOT folded into `refreshList`: that runs on mount and on every
   * `codex:changed`, and the workspace lands on Pages, so three extra round-trips would be paid by
   * every GM on the suite's most-loaded surface to render a mode they may not open. This fetches when
   * Campaign is actually on screen, and refreshes with the rest while it stays there.
   */
  const [campaign, setCampaign] = useState<{ entries: readonly CodexJournalEntry[]; maps: readonly CodexMap[]; calendar: CodexCalendar | null }>({ entries: [], maps: [], calendar: null });
  const [campaignLoading, setCampaignLoading] = useState(true);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const loadCampaign = useCallback(async () => {
    try {
      const [entries, maps, calendar] = await Promise.all([journalApi.timeline(gmToken), atlasApi.listMaps(gmToken), calendarApi.get(gmToken)]);
      setCampaign({ entries, maps, calendar }); setCampaignError(null);
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
  const campaignEntries = useMemo<readonly CampaignEntry[]>(() => [...campaign.entries]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((entry) => ({ id: entry.id, summary: entry.playerText.trim() || (entry.gmText ?? "").trim(), when: journalWhenLabel(entry), kind: entry.kind })), [campaign.entries]);
  const campaignToday = useMemo(() => (campaign.calendar?.currentDate ? formatWorldDate(campaign.calendar, campaign.calendar.currentDate) : null), [campaign.calendar]);

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
  useEffect(() => {
    const onChanged = () => { void refreshList(); };
    socket.on("codex:changed", onChanged);
    return () => { socket.off("codex:changed", onChanged); };
  }, [refreshList]);

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
        <Tabs ariaLabel="Codex view" activeId={mode} onChange={(id) => setMode(id as typeof mode)}
          tabs={[{ id: "campaign", label: "Campaign" }, { id: "pages", label: "Pages" }, { id: "atlas", label: "Atlas" }, { id: "journal", label: "Journal" }, { id: "graph", label: "Graph" }]} />
        <div className="codex-modebar-ops">
          <Button variant="ghost" size="sm" onClick={() => setPaletteOpen(true)} aria-keyshortcuts="Meta+K Control+K">Search</Button>
          <Button variant="ghost" size="sm" onClick={openPlayerPreview}>Preview as player</Button>
          <Button variant="ghost" size="sm" onClick={() => importInputRef.current?.click()}>Import</Button>
          <Button variant="ghost" size="sm" onClick={exportCodex}>Export</Button>
          <input ref={importInputRef} type="file" accept=".md,.markdown,.txt" multiple hidden onChange={(event) => { void importFiles(event.target.files); event.target.value = ""; }} />
        </div>
      </div>
      {/* CF-2: one error surface for the whole workspace. It previously lived inside the Pages rail, so a
          failed load was invisible in Campaign, Atlas, Journal and Graph. */}
      {error && <Alert tone="danger" title="Couldn't load the codex">{error}</Alert>}
      {mode === "campaign"
        ? <CampaignHome pages={pages} entries={campaignEntries} maps={campaign.maps} today={campaignToday}
            loading={loading || campaignLoading} error={campaignError}
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
            openEntryId={journalTarget} onOpenedEntry={() => setJournalTarget(null)} />
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
      {promptDialog}
      {confirmDialog}
    </div>
  );
}

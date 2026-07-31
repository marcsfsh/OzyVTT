import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Chip, Combobox, IconChevron, IconPlus, Input, MenuItem, Modal, Select, Skeleton } from "@vtt/ui";
import { codexApi, type CodexAutosaveSettings, type CodexPage, type CodexPageConnection, type CodexPageSummary } from "./api";
import { PageEditor } from "./PageEditor";
import { NotebookTree, buildFolderTree, type NotebookSort } from "./NotebookTree";
import { SearchResultList, useCodexSearch } from "./SearchResults";
import { VisibilityBadge } from "./SecretMarkers";
import { EntityIcon } from "./icons";
import { ENTITY_DEFS, ENTITY_TYPE_LIST, type EntityType } from "./entities";
import { MissingRecordNotice } from "../components/NotFoundView";
import { navigate, replaceQuery, withQuery } from "../router";
import { atlasPath, graphPath, pagePath, pathForHit, pathForSection, tagPath } from "./routes";
import { useConfirm, usePrompt } from "../components/feedback";
import type { QuickCreateRequest } from "./QuickCreate";

/**
 * Pages — the notebook rail and the two-layer editor, lifted whole out of `CodexWorkspace`.
 *
 * The mechanics are the ones that already worked (the folder tree, the suite search overlay, the
 * single-owner page feed handed down from the shell). What changed is the vocabulary — every "note" and
 * "entity" naming a page is now "page" (D5) — and that selection, filters and search all live in the
 * URL, so a page is a bookmarkable address rather than a latch inside a component.
 */
export type PagesViewProps = Readonly<{
  gmToken: string;
  pages: readonly CodexPageSummary[];
  folders: readonly string[];
  loading: boolean;
  autosave: CodexAutosaveSettings;
  /** From `/codex/pages/:id`. Null is the list with nothing open. */
  selectedId: string | null;
  query: URLSearchParams;
  onRefresh: () => Promise<void>;
  onPageChanged: (page: CodexPage) => void;
  onQuickCreate: (request: QuickCreateRequest) => void;
  onError: (message: string | null) => void;
  onOpenReplay?: (archiveId: number) => void;
}>;

export function PagesView({
  gmToken, pages, folders, loading, autosave, selectedId, query, onRefresh, onPageChanged, onQuickCreate, onError, onOpenReplay
}: PagesViewProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{ page: CodexPage; connections: readonly CodexPageConnection[] } | null>(null);
  const [missing, setMissing] = useState(false);
  const [movingPageId, setMovingPageId] = useState<string | null>(null);
  const [sort, setSort] = useState<NotebookSort>(() => { try { return (localStorage.getItem("codex-notebook-sort") as NotebookSort) || "name-asc"; } catch { return "name-asc"; } });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("codex-notebook-collapsed") ?? "[]") as string[]); } catch { return new Set(); }
  });
  const { prompt, dialog: promptDialog } = usePrompt();
  const { confirm, dialog: confirmDialog } = useConfirm();

  // D10: the filters live in the URL, so a dashboard "By type" card and a tag chip navigate here rather
  // than reaching into this component's state.
  const typeFilter = (query.get("type") as EntityType | null) ?? null;
  const tagFilter = query.get("tag");

  useEffect(() => {
    if (!selectedId) { setSelected(null); setMissing(false); return; }
    let live = true;
    setMissing(false);
    void codexApi.getPage(gmToken, selectedId)
      .then((result) => { if (live) { setSelected(result); setMissing(false); } })
      .catch(() => { if (live) { setSelected(null); setMissing(true); } });
    return () => { live = false; };
  }, [gmToken, selectedId]);

  /** Refetch the open page after a connection edit, to pull its fresh rows. */
  const refreshSelected = useCallback(() => {
    if (!selectedId) return;
    void codexApi.getPage(gmToken, selectedId).then(setSelected).catch(() => undefined);
  }, [gmToken, selectedId]);

  const runSearch = useCallback((text: string) => codexApi.search(gmToken, text).then((result) => result), [gmToken]);
  const searchState = useCodexSearch(search, runSearch, pages);

  const tree = useMemo(() => buildFolderTree(pages, folders), [pages, folders]);
  const filteredPages = useMemo(
    () => pages.filter((page) => (!typeFilter || page.entityType === typeFilter) && (!tagFilter || page.tags.includes(tagFilter))),
    [pages, typeFilter, tagFilter]
  );
  const allTags = useMemo(() => [...new Set(pages.flatMap((page) => page.tags))].sort(), [pages]);
  const allFolders = useMemo(() => {
    const set = new Set<string>(folders);
    for (const page of pages) { let path = ""; for (const segment of (page.folder ?? "").split("/").map((part) => part.trim()).filter(Boolean)) { path = path ? `${path}/${segment}` : segment; set.add(path); } }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [pages, folders]);

  const setFilter = (next: Readonly<{ type?: string | null; tag?: string | null }>) => {
    replaceQuery((params) => {
      if ("type" in next) { if (next.type) params.set("type", next.type); else params.delete("type"); }
      if ("tag" in next) { if (next.tag) params.set("tag", next.tag); else params.delete("tag"); }
    });
  };

  const toggleFolder = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      try { localStorage.setItem("codex-notebook-collapsed", JSON.stringify([...next])); } catch { /* private mode - fine */ }
      return next;
    });
  }, []);
  const openFolder = (path: string) => setCollapsed((prev) => { if (!prev.has(path)) return prev; const next = new Set(prev); next.delete(path); try { localStorage.setItem("codex-notebook-collapsed", JSON.stringify([...next])); } catch { /* private mode */ } return next; });
  const changeSort = (next: NotebookSort) => { setSort(next); try { localStorage.setItem("codex-notebook-sort", next); } catch { /* private mode */ } };

  const movePage = useCallback(async (id: string, folder: string | null) => {
    try { const page = await codexApi.updatePage(gmToken, id, { folder }); onPageChanged(page); await onRefresh(); }
    catch (moveError) { onError(moveError instanceof Error ? moveError.message : "Couldn't move that page."); }
  }, [gmToken, onPageChanged, onRefresh, onError]);
  const moveFolderTo = useCallback(async (fromPath: string, toParent: string | null) => {
    const name = fromPath.split("/").pop() ?? fromPath;
    const to = toParent ? `${toParent}/${name}` : name;
    if (to === fromPath) return;
    try { await codexApi.moveFolder(gmToken, fromPath, to); await onRefresh(); }
    catch (moveError) { onError(moveError instanceof Error ? moveError.message : "Couldn't move that folder."); }
  }, [gmToken, onRefresh, onError]);
  const doMove = async (folder: string | null) => { const id = movingPageId; setMovingPageId(null); if (id) await movePage(id, folder); };
  const doMoveToNew = async () => {
    const id = movingPageId; setMovingPageId(null);
    if (!id) return;
    const name = await prompt({ title: "New folder", body: "Name a folder to move this page into.", placeholder: "e.g. NPCs/Villains", confirmLabel: "Move here" });
    if (!name) return;
    try { await codexApi.createFolder(gmToken, name); } catch { /* best-effort — the move still files the page there */ }
    await movePage(id, name);
  };
  const newFolder = async () => {
    const name = await prompt({ title: "New folder", body: "Name the folder. It starts empty - add pages to it from its row menu.", placeholder: "e.g. NPCs", confirmLabel: "Create" });
    if (!name) return;
    try { await codexApi.createFolder(gmToken, name); await onRefresh(); }
    catch (folderError) { onError(folderError instanceof Error ? folderError.message : "Couldn't create the folder."); }
  };
  const newSubfolder = async (parentPath: string) => {
    const name = await prompt({ title: "New subfolder", body: `Add a subfolder inside "${parentPath}". It starts empty.`, placeholder: "e.g. Villains", confirmLabel: "Create" });
    if (!name) return;
    const child = name.split("/").map((segment) => segment.trim()).filter(Boolean).join("/");
    if (!child) return;
    try { await codexApi.createFolder(gmToken, `${parentPath}/${child}`); openFolder(parentPath); await onRefresh(); }
    catch (folderError) { onError(folderError instanceof Error ? folderError.message : "Couldn't create the subfolder."); }
  };
  const renameFolder = async (path: string) => {
    const current = path.split("/").pop() ?? path;
    const name = await prompt({ title: "Rename folder", body: `Rename "${path}". Type a name, or a full path to move it.`, defaultValue: current, confirmLabel: "Rename" });
    if (!name || name === current) return;
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const to = name.includes("/") ? name : parent ? `${parent}/${name}` : name;
    try { await codexApi.moveFolder(gmToken, path, to); await onRefresh(); }
    catch (renameError) { onError(renameError instanceof Error ? renameError.message : "Couldn't rename that folder."); }
  };
  const deleteFolder = async (path: string) => {
    const inside = pages.filter((page) => page.folder === path || (page.folder ?? "").startsWith(`${path}/`)).length;
    const note = inside > 0 ? ` Its ${inside} page${inside === 1 ? "" : "s"} move to the top level (nothing is deleted).` : "";
    if (!(await confirm({ title: "Delete folder", body: `Delete the folder "${path}"?${note}`, confirmLabel: "Delete folder", danger: true }))) return;
    try { await codexApi.deleteFolder(gmToken, path); await onRefresh(); }
    catch (deleteError) { onError(deleteError instanceof Error ? deleteError.message : "Couldn't delete that folder."); }
  };
  /**
   * D7 / G22 — clicking an unresolved `[[link]]` used to CREATE an untyped page, silently, with no
   * dialog. It now opens quick-create with the link's text prefilled; cancelling creates nothing.
   */
  const followLink = useCallback((target: string) => {
    const bare = target.replace(/^(page|actor|monster|spell|map|marker):/i, "").trim();
    const existing = pages.find((page) => page.title.trim().toLowerCase() === bare.toLowerCase());
    if (existing) { navigate(pagePath(existing.id)); return; }
    onQuickCreate({ title: bare, note: "This link doesn't match a page yet. Create it, or cancel and fix the link." });
  }, [pages, onQuickCreate]);

  const filtering = Boolean(typeFilter || tagFilter);

  return (
    <div className={`codex-workspace${selectedId ? " has-selection" : ""}`}>
      <aside className="codex-rail">
        <div className="codex-rail-head">
          <Input value={search} placeholder="Search the Codex…" aria-label="Search the Codex"
            onChange={(event) => { setSearch(event.target.value); if (event.target.value.trim()) setFilter({ type: null, tag: null }); }} />
{/* D25, one primary per view. With autosave OFF the editor's Save is the primary act on this
              screen, and the empty state's own create is the primary when there is nothing to select
              — the rail's create steps down rather than competing with either. Two magenta-filled
              buttons at once (twice with the identical label "New page") make neither one the
              answer to "what do I do here". */}
          <Button variant={selectedId ? (autosave.enabled ? "primary" : "secondary") : "secondary"} size="sm" className="codex-newpage" onClick={() => onQuickCreate({})}><IconPlus /> New page</Button>
        </div>
        {!search.trim() && (
          <div className="codex-rail-tools">
            <Select aria-label="Sort pages" value={sort} onChange={(event) => changeSort(event.target.value as NotebookSort)}>
              <option value="name-asc">Name A–Z</option>
              <option value="name-desc">Name Z–A</option>
              <option value="recent">Recently edited</option>
            </Select>
            {/* D10: filters in place, on every list. */}
            <Select aria-label="Filter by kind" value={typeFilter ?? ""} onChange={(event) => setFilter({ type: event.target.value || null })}>
              <option value="">All kinds</option>
              {ENTITY_TYPE_LIST.map((type) => <option key={type} value={type}>{ENTITY_DEFS[type].label}</option>)}
            </Select>
            <Button variant="ghost" size="sm" onClick={newFolder}><IconPlus /> Folder</Button>
          </div>
        )}
        {!search.trim() && allTags.length > 0 && (
          <div className="codex-rail-tagfilter">
            <Combobox options={allTags.map((tag) => ({ id: tag, label: `#${tag}` }))} value={tagFilter} onChange={(tag) => setFilter({ tag })}
              ariaLabel="Filter by tag" placeholder="Filter by tag…" />
          </div>
        )}
        <nav className="codex-list" aria-label="Campaign pages">
          {filtering && !search.trim() ? (
            <>
              <div className="codex-filter-chips">
                {typeFilter && <Chip onRemove={() => setFilter({ type: null })} removeLabel="Clear kind filter">{ENTITY_DEFS[typeFilter].label}s</Chip>}
                {tagFilter && <Chip onRemove={() => setFilter({ tag: null })} removeLabel="Clear tag filter">#{tagFilter}</Chip>}
              </div>
              {filteredPages.length === 0
                ? <p className="codex-list-empty">Nothing here yet.</p>
                : filteredPages.map((page) => (
                    <button key={page.id} type="button" className={`codex-list-item${page.id === selectedId ? " is-active" : ""}`} onClick={() => navigate(pagePath(page.id))}>
                      <span className="codex-list-title">{page.title}</span>
                      <VisibilityBadge revealed={page.revealedToPlayers} />
                    </button>
                  ))}
            </>
          ) : search.trim()
            ? <SearchResultList state={searchState} selectedId={selectedId} onOpen={(hit) => navigate(pathForHit(hit))} emptyLabel="Nothing in the Codex matches." />
            : loading
                ? <div className="codex-list-loading">{[0, 1, 2, 3].map((row) => <Skeleton key={row} variant="text" />)}</div>
            : pages.length === 0
                ? <p className="codex-list-empty">No pages yet.</p>
                : <NotebookTree node={tree} sort={sort} collapsed={collapsed} selectedId={selectedId} onToggle={toggleFolder}
                    onSelect={(id) => navigate(pagePath(id))}
                    onNewInFolder={(folder) => onQuickCreate({ folder })}
                    onNewSubfolder={newSubfolder} onRenameFolder={renameFolder} onDeleteFolder={deleteFolder}
                    onMovePage={movePage} onMoveFolder={moveFolderTo} onRequestMove={setMovingPageId}
                    onRequestMoveFolder={(path) => void moveFolderTo(path, null)} />}
        </nav>
      </aside>

      <section className="codex-main">
        {selectedId && (
          /* D25/G17: the bespoke `.codex-back` link becomes the ghost Button primitive, which carries the
             44px floor itself (route 2, `.nh-btn--sm` + `.tap-target`). */
          <Button variant="ghost" size="sm" className="codex-back" onClick={() => navigate(pathForSection("pages"))}><IconChevron className="codex-chevron-left" aria-hidden="true" />All pages</Button>
        )}
        {missing && <MissingRecordNotice noun="page" />}
        {selected
          ? <PageEditor key={selected.page.id} gmToken={gmToken} page={selected.page} pages={pages}
              connections={selected.connections} autosave={autosave}
              onChange={onPageChanged}
              onDeleted={() => { void onRefresh(); navigate(pathForSection("pages")); }}
              onNavigate={followLink} onOpenReplay={onOpenReplay}
              onConnectionsChanged={refreshSelected}
              onPickTag={(tag) => navigate(tagPath(tag))}
              onOpenMarker={(markerId, mapId) => navigate(atlasPath(mapId, markerId))}
              onShowInGraph={(pageId) => navigate(graphPath(pageId))}
              onOpenConnection={(kind, id) => navigate(
                kind === "page" ? pagePath(id)
                : kind === "session" ? `/codex/sessions/${id}`
                : kind === "quest" ? `/codex/quests/${id}`
                : withQuery("/codex/journal", { entry: id })
              )} />
          : !missing && <div className="codex-main-empty">
              <h3>Select a page</h3>
              <p>Every page has a player-facing side and a GM-only side. Choose one from the list, or create a new page.</p>
              <Button variant="primary" onClick={() => onQuickCreate({})}>New page</Button>
            </div>}
      </section>

      <Modal open={!!movingPageId} onClose={() => setMovingPageId(null)} title="Move to folder" size="sm" ariaLabel="Move to folder">
        {/* D25: the bespoke `.codex-move-opt` rows become `MenuItem`, which carries route 1 (grow the
            paint) — required here, because these are a vertical stack. */}
        <div className="codex-move-list">
          <MenuItem onClick={() => void doMove(null)}>Top level</MenuItem>
          {allFolders.map((path) => <MenuItem key={path} onClick={() => void doMove(path)}>{path}</MenuItem>)}
          <MenuItem onClick={() => void doMoveToNew()}><IconPlus /> New folder…</MenuItem>
        </div>
      </Modal>

      {promptDialog}
      {confirmDialog}
    </div>
  );
}

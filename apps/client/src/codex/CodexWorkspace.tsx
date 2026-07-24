import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Input, SegmentedControl } from "@vtt/ui";
import { socket } from "../socket";
import { codexApi, pageLinkKey, type CodexBacklink, type CodexPage, type CodexPageSummary, type CodexRelationship } from "./api";
import { PageEditor } from "./PageEditor";
import { AtlasView } from "./AtlasView";
import { JournalView } from "./JournalView";
import { CommandPalette } from "./CommandPalette";
import { NotebookTree, buildFolderTree } from "./NotebookTree";
import { type EntityType } from "./entities";
import "./codex.css";

/**
 * The GM worldbuilding workspace (Codex tab): a searchable page list on the left, the two-layer
 * markdown editor on the right. Data is fetched over the codex REST surface and refreshed whenever a
 * `codex:changed` ping arrives; the open page is owned by the editor (not clobbered by list refreshes).
 */
/** New-entity starters: pick a type (which brings its structured fields) + a light prose scaffold. */
const TEMPLATES: ReadonlyArray<{ key: string; label: string; type: EntityType; title: string; player: string; gm: string }> = [
  { key: "blank", label: "📄 Blank page", type: "note", title: "Untitled page", player: "", gm: "" },
  { key: "character", label: "🧑 Character", type: "character", title: "Untitled character", player: "## Description\n", gm: "## Secrets & hooks\n" },
  { key: "location", label: "🏰 Location", type: "location", title: "Untitled location", player: "## Description\n\n## Points of interest\n", gm: "## Secrets\n\n## Encounters\n" },
  { key: "faction", label: "⚔️ Faction", type: "faction", title: "Untitled faction", player: "## Overview\n", gm: "## True agenda\n\n## Assets & allies\n" },
  { key: "item", label: "🗡️ Item", type: "item", title: "Untitled item", player: "## Description\n", gm: "## Secrets\n" },
  { key: "religion", label: "🕯️ Religion", type: "religion", title: "Untitled religion", player: "## Tenets\n", gm: "## Secrets\n" }
];

type WorkspaceScene = Readonly<{ id: string; name: string }>;
export function CodexWorkspace({ gmToken, scenes = [], activeSceneId = null, onActivateScene = () => {} }: Readonly<{ gmToken: string; scenes?: readonly WorkspaceScene[]; activeSceneId?: string | null; onActivateScene?: (sceneId: string) => void }>) {
  const [mode, setMode] = useState<"pages" | "atlas" | "journal">("pages");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [templateMenu, setTemplateMenu] = useState(false);
  const [pages, setPages] = useState<CodexPageSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ page: CodexPage; backlinks: readonly CodexBacklink[]; relationships: readonly CodexRelationship[] } | null>(null);
  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<CodexPageSummary[] | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("codex-notebook-collapsed") ?? "[]") as string[]); } catch { return new Set(); }
  });
  const [error, setError] = useState<string | null>(null);

  // The rail always holds the FULL notebook (for the folder tree + [[ autocomplete)); search is a separate overlay.
  const refreshList = useCallback(async () => {
    try { setPages(await codexApi.listPages(gmToken)); setError(null); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load the codex."); }
  }, [gmToken]);

  useEffect(() => { void refreshList(); }, [refreshList]);

  // Full-text search overlays the tree while a query is active; re-runs when the notebook changes.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setSearchHits(null); return; }
    let live = true;
    void codexApi.search(gmToken, q).then((hits) => { if (live) setSearchHits(hits); }).catch(() => { if (live) setSearchHits([]); });
    return () => { live = false; };
  }, [query, gmToken, pages]);

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
    setError(failed.length ? `Imported ${imported} of ${files.length}. Couldn't import: ${failed.join(", ")}.` : null);
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

  const tree = useMemo(() => buildFolderTree(pages), [pages]);

  return (
    <div className="codex-root">
      <div className="codex-modebar">
        <SegmentedControl ariaLabel="Codex view" value={mode} onChange={(value) => setMode(value as "pages" | "atlas" | "journal")}
          options={[{ value: "pages", label: "Pages" }, { value: "atlas", label: "Atlas" }, { value: "journal", label: "Journal" }]} />
        <div className="codex-modebar-ops">
          <Button variant="ghost" size="sm" onClick={() => setPaletteOpen(true)} aria-keyshortcuts="Meta+K Control+K">Search</Button>
          <Button variant="ghost" size="sm" onClick={() => importInputRef.current?.click()}>Import</Button>
          <Button variant="ghost" size="sm" onClick={exportCodex}>Export</Button>
          <input ref={importInputRef} type="file" accept=".md,.markdown,.txt" multiple hidden onChange={(event) => { void importFiles(event.target.files); event.target.value = ""; }} />
        </div>
      </div>
      {mode === "atlas"
        ? <AtlasView gmToken={gmToken} scenes={scenes} activeSceneId={activeSceneId} onActivateScene={onActivateScene} onOpenPage={(pageId) => { setMode("pages"); setSelectedId(pageId); }} />
        : mode === "journal"
        ? <JournalView gmToken={gmToken} onOpenPage={(pageId) => { setMode("pages"); setSelectedId(pageId); }} />
        : <div className={`codex-workspace${selectedId ? " has-selection" : ""}`}>
      <aside className="codex-rail">
        <div className="codex-rail-head">
          <Input value={query} placeholder="Search the notebook…" aria-label="Search the notebook" onChange={(event) => setQuery(event.target.value)} />
          <div className="codex-newpage">
            <Button variant="primary" size="sm" aria-haspopup="menu" aria-expanded={templateMenu} onClick={() => setTemplateMenu((open) => !open)}>New ▾</Button>
            {templateMenu && (
              <>
                <button type="button" className="codex-menu-scrim" aria-hidden="true" tabIndex={-1} onClick={() => setTemplateMenu(false)} />
                <div className="codex-template-menu" role="menu">
                  {TEMPLATES.map((template) => (
                    <button key={template.key} type="button" role="menuitem" className="codex-template-item" onClick={() => void createFromTemplate(template)}>{template.label}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        {error && <p className="codex-rail-error" role="alert">{error}</p>}
        <nav className="codex-list" aria-label="Campaign notebook">
          {query.trim()
            ? (searchHits && searchHits.length > 0
                ? searchHits.map((page) => (
                    <button key={page.id} type="button" className={`codex-list-item${page.id === selectedId ? " is-active" : ""}`} onClick={() => setSelectedId(page.id)}>
                      <span className="codex-list-title">{page.title}</span>
                      {page.revealedToPlayers && <Badge tone="success">Shown</Badge>}
                    </button>
                  ))
                : <p className="codex-list-empty">{searchHits === null ? "Searching…" : "No notes match."}</p>)
            : pages.length === 0
                ? (!error && <p className="codex-list-empty">No notes yet. Create your first.</p>)
                : <NotebookTree node={tree} collapsed={collapsed} selectedId={selectedId} onToggle={toggleFolder} onSelect={setSelectedId} onNewInFolder={createInFolder} />}
        </nav>
      </aside>
      <section className="codex-main">
        {selectedId && <button type="button" className="codex-back" onClick={() => setSelectedId(null)}>‹ All pages</button>}
        {selected
          ? <PageEditor key={selected.page.id} gmToken={gmToken} page={selected.page} pages={pages} backlinks={selected.backlinks} relationships={selected.relationships} onChange={onPageChanged} onDeleted={onPageDeleted} onNavigate={navigate} onRelationshipsChanged={refreshSelected} />
          : <div className="codex-main-empty"><h3>Your world, written down</h3><p>Select a page, or create one. Each page has a player-facing side and a GM-secret side - reveal it when the party earns it.</p><Button variant="primary" onClick={createPage}>New page</Button></div>}
      </section>
        </div>}
      {paletteOpen && <CommandPalette gmToken={gmToken} onOpenPage={(id) => { setMode("pages"); setSelectedId(id); }} onCreatePage={createPageTitled} onGoto={(target) => setMode(target)} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

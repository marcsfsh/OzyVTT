import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Input, SegmentedControl } from "@vtt/ui";
import { socket } from "../socket";
import { codexApi, pageLinkKey, type CodexBacklink, type CodexPage, type CodexPageSummary } from "./api";
import { PageEditor } from "./PageEditor";
import { AtlasView } from "./AtlasView";
import { JournalView } from "./JournalView";
import { CommandPalette } from "./CommandPalette";
import "./codex.css";

/**
 * The GM worldbuilding workspace (Codex tab): a searchable page list on the left, the two-layer
 * markdown editor on the right. Data is fetched over the codex REST surface and refreshed whenever a
 * `codex:changed` ping arrives; the open page is owned by the editor (not clobbered by list refreshes).
 */
type WorkspaceScene = Readonly<{ id: string; name: string }>;
export function CodexWorkspace({ gmToken, scenes = [], activeSceneId = null, onActivateScene = () => {} }: Readonly<{ gmToken: string; scenes?: readonly WorkspaceScene[]; activeSceneId?: string | null; onActivateScene?: (sceneId: string) => void }>) {
  const [mode, setMode] = useState<"pages" | "atlas" | "journal">("pages");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pages, setPages] = useState<CodexPageSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ page: CodexPage; backlinks: readonly CodexBacklink[] } | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    try {
      const rows = query.trim() ? await codexApi.search(gmToken, query.trim()) : await codexApi.listPages(gmToken);
      setPages(rows);
      setError(null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load the codex."); }
  }, [gmToken, query]);

  useEffect(() => { void refreshList(); }, [refreshList]);

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

  const createPage = async () => {
    try { const page = await codexApi.createPage(gmToken, { title: "Untitled page" }); await refreshList(); setSelectedId(page.id); }
    catch (createError) { setError(createError instanceof Error ? createError.message : "Could not create the page."); }
  };
  const createPageTitled = async (title: string) => {
    try { const page = await codexApi.createPage(gmToken, { title }); await refreshList(); setMode("pages"); setSelectedId(page.id); }
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
    try {
      for (const file of Array.from(files)) {
        const text = await file.text();
        const title = file.name.replace(/\.(md|markdown|txt)$/i, "").trim();
        await codexApi.createPage(gmToken, { title: title || "Imported page", playerBody: text });
      }
      await refreshList();
    } catch (importError) { setError(importError instanceof Error ? importError.message : "Import failed."); }
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

  const grouped = useMemo(() => {
    const byFolder = new Map<string, CodexPageSummary[]>();
    for (const page of pages) {
      const key = page.folder ?? "";
      const bucket = byFolder.get(key) ?? [];
      bucket.push(page);
      byFolder.set(key, bucket);
    }
    return [...byFolder.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  }, [pages]);

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
          <Input value={query} placeholder="Search the codex…" aria-label="Search the codex" onChange={(event) => setQuery(event.target.value)} />
          <Button variant="primary" size="sm" onClick={createPage}>New page</Button>
        </div>
        {error && <p className="codex-rail-error" role="alert">{error}</p>}
        <nav className="codex-list" aria-label="Codex pages">
          {pages.length === 0 && !error && <p className="codex-list-empty">{query.trim() ? "No pages match." : "No pages yet. Create your first."}</p>}
          {grouped.map(([folder, rows]) => (
            <div key={folder || "_unfiled"} className="codex-list-group">
              {folder && <div className="codex-list-folder">{folder}</div>}
              {rows.map((page) => (
                <button key={page.id} type="button" className={`codex-list-item${page.id === selectedId ? " is-active" : ""}`} onClick={() => setSelectedId(page.id)}>
                  <span className="codex-list-title">{page.title}</span>
                  {page.revealedToPlayers && <Badge tone="success">Shown</Badge>}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <section className="codex-main">
        {selectedId && <button type="button" className="codex-back" onClick={() => setSelectedId(null)}>‹ All pages</button>}
        {selected
          ? <PageEditor key={selected.page.id} gmToken={gmToken} page={selected.page} backlinks={selected.backlinks} onChange={onPageChanged} onDeleted={onPageDeleted} onNavigate={navigate} />
          : <div className="codex-main-empty"><h3>Your world, written down</h3><p>Select a page, or create one. Each page has a player-facing side and a GM-secret side - reveal it when the party earns it.</p><Button variant="primary" onClick={createPage}>New page</Button></div>}
      </section>
        </div>}
      {paletteOpen && <CommandPalette gmToken={gmToken} onOpenPage={(id) => { setMode("pages"); setSelectedId(id); }} onCreatePage={createPageTitled} onGoto={(target) => setMode(target)} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

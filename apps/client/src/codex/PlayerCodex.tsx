import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, SegmentedControl } from "@vtt/ui";
import { socket } from "../socket";
import { playerCodexApi, type CodexRelationship, type PlayerCodexJournalEntry, type PlayerCodexMap, type PlayerCodexMarker, type PlayerCodexPage, type PlayerCodexPageSummary } from "./api";
import { CodexMarkdown } from "./CodexMarkdown";
import { CodexImage } from "./CodexImage";
import { MapSurface } from "./MapSurface";
import { entityDef, entityIcon, relationshipLabel } from "./entities";
import "./codex.css";

/**
 * The player-facing Codex: a read-only window onto the worldbuilding the GM has revealed. Lore browses
 * revealed pages (player body only), Atlas pans revealed maps and follows revealed markers, Journal
 * shows the revealed timeline. Everything here is the server's player projection - GM-secret content and
 * unrevealed entities never reach this surface.
 */
function whenLabel(entry: PlayerCodexJournalEntry): string {
  return entry.inWorldLabel ?? (entry.sessionNumber !== null ? `Session ${entry.sessionNumber}` : entry.realDate ?? new Date(entry.createdAt).toLocaleDateString());
}

export function PlayerCodex({ token, onClose }: Readonly<{ token: string; onClose?: () => void }>) {
  const [view, setView] = useState<"lore" | "atlas" | "journal">("lore");
  const [pages, setPages] = useState<PlayerCodexPageSummary[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [page, setPage] = useState<PlayerCodexPage | null>(null);
  const [pageRels, setPageRels] = useState<CodexRelationship[]>([]);
  const [maps, setMaps] = useState<PlayerCodexMap[]>([]);
  const [currentMapId, setCurrentMapId] = useState<string | null>(null);
  const [markers, setMarkers] = useState<PlayerCodexMarker[]>([]);
  const [timeline, setTimeline] = useState<PlayerCodexJournalEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextPages, nextMaps, nextTimeline] = await Promise.all([playerCodexApi.listPages(token), playerCodexApi.listMaps(token), playerCodexApi.timeline(token)]);
      setPages(nextPages); setMaps(nextMaps); setTimeline(nextTimeline);
      setCurrentMapId((current) => current ?? nextMaps.find((map) => map.parentMapId === null)?.id ?? nextMaps[0]?.id ?? null);
      setError(null);
    } catch { setError("Couldn't load the codex - check your connection to the table."); }
  }, [token]);

  useEffect(() => { void load().catch(() => undefined); }, [load]);
  useEffect(() => { const onChanged = () => { void load().catch(() => undefined); if (currentMapId) void playerCodexApi.listMarkers(token, currentMapId).then(setMarkers).catch(() => undefined); }; socket.on("codex:changed", onChanged); return () => { socket.off("codex:changed", onChanged); }; }, [load, token, currentMapId]);
  useEffect(() => { if (!selectedPageId) { setPage(null); setPageRels([]); return; } let live = true; void playerCodexApi.getPage(token, selectedPageId).then((result) => { if (live) { setPage(result.page); setPageRels(result.relationships); } }).catch(() => { if (live) { setPage(null); setPageRels([]); } }); return () => { live = false; }; }, [token, selectedPageId]);
  useEffect(() => { if (!currentMapId) { setMarkers([]); return; } void playerCodexApi.listMarkers(token, currentMapId).then(setMarkers).catch(() => setMarkers([])); }, [token, currentMapId]);

  const openPage = useCallback((pageId: string) => { setSelectedPageId(pageId); setView("lore"); }, []);
  const navigate = useCallback((target: string) => { const match = pages.find((candidate) => candidate.title.toLowerCase() === target.trim().toLowerCase()); if (match) openPage(match.id); }, [pages, openPage]);
  const onMarkerClick = useCallback((markerId: string) => {
    const marker = markers.find((candidate) => candidate.id === markerId);
    if (!marker) return;
    if (marker.subMapId && maps.some((map) => map.id === marker.subMapId)) setCurrentMapId(marker.subMapId);
    else if (marker.pageId) openPage(marker.pageId);
  }, [markers, maps, openPage]);

  const currentMap = maps.find((map) => map.id === currentMapId) ?? null;
  const breadcrumb = useMemo(() => {
    const chain: PlayerCodexMap[] = []; let cursor = currentMap; const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) { chain.unshift(cursor); guard.add(cursor.id); cursor = maps.find((map) => map.id === cursor!.parentMapId) ?? null; }
    return chain;
  }, [currentMap, maps]);

  return (
    <div className="codex-root codex-player">
      <div className="codex-modebar">
        <SegmentedControl ariaLabel="Codex" value={view} onChange={(value) => setView(value as "lore" | "atlas" | "journal")}
          options={[{ value: "lore", label: "Lore" }, { value: "atlas", label: "Atlas" }, { value: "journal", label: "Journal" }]} />
        {onClose && <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>}
      </div>

      {error && <p className="codex-rail-error" role="alert">{error}</p>}

      {view === "lore" && (
        <div className={`codex-workspace${selectedPageId ? " has-selection" : ""}`}>
          <aside className="codex-rail">
            <nav className="codex-list" aria-label="Revealed pages">
              {pages.length === 0 && <p className="codex-list-empty">Nothing revealed yet.</p>}
              {pages.map((summary) => <button key={summary.id} type="button" className={`codex-list-item${summary.id === selectedPageId ? " is-active" : ""}`} onClick={() => setSelectedPageId(summary.id)}><span className="codex-list-title">{summary.title}</span></button>)}
            </nav>
          </aside>
          <section className="codex-main">
            {selectedPageId && <button type="button" className="codex-back" onClick={() => setSelectedPageId(null)}>‹ All lore</button>}
            {page
              ? <article className="codex-reader">
                  {page.bannerAssetId && <CodexImage assetId={page.bannerAssetId} token={token} alt="" className="codex-banner-img" />}
                  <h2 className="codex-reader-title">{page.entityType !== "note" && <span aria-hidden="true">{entityIcon(page.entityType)} </span>}{page.title}</h2>
                  {Object.entries(page.fields).length > 0 && (
                    <dl className="codex-reader-fields">
                      {Object.entries(page.fields).map(([key, value]) => {
                        const def = entityDef(page.entityType).fields.find((field) => field.key === key);
                        return <div key={key} className="codex-reader-field"><dt>{def?.label ?? key}</dt><dd>{value}</dd></div>;
                      })}
                    </dl>
                  )}
                  <div className="codex-reader-body">{page.body.trim() ? <CodexMarkdown text={page.body} onNavigate={navigate} token={token} /> : <p className="codex-preview-empty">Nothing written here yet.</p>}</div>
                  {pageRels.length > 0 && (
                    <div className="codex-reader-rels">
                      <h3 className="codex-backlinks-title">Connections</h3>
                      <ul className="codex-rels-list">
                        {pageRels.map((rel) => (
                          <li key={rel.id} className="codex-rels-item">
                            <span className="codex-rels-label">{relationshipLabel(rel.type, rel.direction)}</span>
                            <button type="button" className="codex-md-link" onClick={() => navigate(rel.otherTitle)}>{entityIcon(rel.otherType)} {rel.otherTitle}</button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              : <div className="codex-main-empty"><h3>The world, as you know it</h3><p>Select a page to read what your party has learned.</p></div>}
          </section>
        </div>
      )}

      {view === "atlas" && (
        <div className="codex-atlas">
          <nav className="codex-breadcrumb" aria-label="Map path">
            {breadcrumb.length === 0 && <span className="codex-crumb is-current">Atlas</span>}
            {breadcrumb.map((map, index) => <span key={map.id}>{index > 0 && <span className="codex-crumb-sep">›</span>}<button type="button" className={`codex-crumb${map.id === currentMapId ? " is-current" : ""}`} onClick={() => setCurrentMapId(map.id)}>{map.name}</button></span>)}
          </nav>
          <div className="codex-atlas-body">
            {currentMap
              ? <MapSurface token={token} assetId={currentMap.assetId} markers={markers} placing={false} readOnly selectedMarkerId={null} onBackgroundClick={() => undefined} onMarkerClick={onMarkerClick} onMarkerDragEnd={() => undefined} />
              : <div className="codex-main-empty"><h3>No maps yet</h3><p>When the GM reveals a map, it appears here to explore.</p></div>}
          </div>
        </div>
      )}

      {view === "journal" && (
        <div className="codex-journal">
          <div className="codex-timeline">
            {timeline.length === 0 && <p className="codex-list-empty">No entries revealed yet.</p>}
            {timeline.map((entry) => (
              <article key={entry.id} className={`codex-entry${entry.kind === "combat" ? " is-combat" : ""}`}>
                <header className="codex-entry-head"><span className="codex-entry-when">{whenLabel(entry)}</span></header>
                <div className="codex-entry-body"><CodexMarkdown text={entry.text} onNavigate={navigate} token={token} /></div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

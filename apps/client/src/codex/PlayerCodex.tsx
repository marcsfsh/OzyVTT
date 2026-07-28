import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Chip, Input, Skeleton, Tabs } from "@vtt/ui";
import { socket } from "../socket";
import { playerCodexApi, type CodexRelationship, type CodexRelationshipEdge, type PlayerCodexJournalEntry, type PlayerCodexMap, type PlayerCodexMarker, type PlayerCodexPage, type PlayerCodexPageSummary } from "./api";
import { CodexMarkdown } from "./CodexMarkdown";
import { CodexImage } from "./CodexImage";
import { MapSurface } from "./MapSurface";
import { WorldHome } from "./WorldHome";
import { RelationshipGraph } from "./RelationshipGraph";
import { EntityIcon } from "./icons";
import { ENTITY_DEFS, entityDef, relationshipLabel, type EntityType } from "./entities";
import "./codex.css";

type PlayerView = "world" | "lore" | "atlas" | "journal" | "graph";

/**
 * The player-facing Codex: a read-only window onto the worldbuilding the GM has revealed. Lore browses
 * revealed pages (player body only), Atlas pans revealed maps and follows revealed markers, Journal
 * shows the revealed timeline. Everything here is the server's player projection - GM-secret content and
 * unrevealed entities never reach this surface.
 */
function whenLabel(entry: PlayerCodexJournalEntry): string {
  return entry.inWorldLabel ?? (entry.sessionNumber !== null ? `Session ${entry.sessionNumber}` : entry.realDate ?? new Date(entry.createdAt).toLocaleDateString());
}

export function PlayerCodex({ token }: Readonly<{ token: string; onClose?: () => void }>) {
  const [view, setView] = useState<PlayerView>("world");
  const [pages, setPages] = useState<PlayerCodexPageSummary[]>([]);
  const [rels, setRels] = useState<CodexRelationshipEdge[]>([]);
  const [filter, setFilter] = useState<{ type: EntityType | null; tag: string | null }>({ type: null, tag: null });
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [page, setPage] = useState<PlayerCodexPage | null>(null);
  const [pageRels, setPageRels] = useState<CodexRelationship[]>([]);
  const [maps, setMaps] = useState<PlayerCodexMap[]>([]);
  const [currentMapId, setCurrentMapId] = useState<string | null>(null);
  const [markers, setMarkers] = useState<PlayerCodexMarker[]>([]);
  const [timeline, setTimeline] = useState<PlayerCodexJournalEntry[]>([]);
  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<PlayerCodexPageSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [nextPages, nextMaps, nextTimeline, nextRels] = await Promise.all([playerCodexApi.listPages(token), playerCodexApi.listMaps(token), playerCodexApi.timeline(token), playerCodexApi.listRelationships(token)]);
      setPages(nextPages); setMaps(nextMaps); setTimeline(nextTimeline); setRels(nextRels);
      setCurrentMapId((current) => current ?? nextMaps.find((map) => map.parentMapId === null)?.id ?? nextMaps[0]?.id ?? null);
      setError(null);
    } catch { setError("Couldn't load the codex - check your connection to the table."); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load().catch(() => undefined); }, [load]);
  useEffect(() => { const onChanged = () => { void load().catch(() => undefined); if (currentMapId) void playerCodexApi.listMarkers(token, currentMapId).then(setMarkers).catch(() => undefined); }; socket.on("codex:changed", onChanged); return () => { socket.off("codex:changed", onChanged); }; }, [load, token, currentMapId]);
  useEffect(() => { if (!selectedPageId) { setPage(null); setPageRels([]); return; } let live = true; void playerCodexApi.getPage(token, selectedPageId).then((result) => { if (live) { setPage(result.page); setPageRels(result.relationships); } }).catch(() => { if (live) { setPage(null); setPageRels([]); } }); return () => { live = false; }; }, [token, selectedPageId]);
  useEffect(() => { if (!currentMapId) { setMarkers([]); return; } void playerCodexApi.listMarkers(token, currentMapId).then(setMarkers).catch(() => setMarkers([])); }, [token, currentMapId]);
  // Search overlays the revealed-page list while a query is active. The server's `/search` route is
  // role-aware, so a player search only ever indexes player-facing bodies of revealed pages.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) { setSearchHits(null); return; }
    let live = true;
    void playerCodexApi.search(token, trimmed).then((hits) => { if (live) setSearchHits(hits); }).catch(() => { if (live) setSearchHits([]); });
    return () => { live = false; };
  }, [query, token, pages]);

  const openPage = useCallback((pageId: string) => { setSelectedPageId(pageId); setView("lore"); }, []);
  const navigate = useCallback((target: string) => { const match = pages.find((candidate) => candidate.title.toLowerCase() === target.trim().toLowerCase()); if (match) openPage(match.id); }, [pages, openPage]);
  const onMarkerClick = useCallback((markerId: string) => {
    const marker = markers.find((candidate) => candidate.id === markerId);
    if (!marker) return;
    if (marker.subMapId && maps.some((map) => map.id === marker.subMapId)) setCurrentMapId(marker.subMapId);
    else if (marker.pageIds[0]) openPage(marker.pageIds[0]);
  }, [markers, maps, openPage]);

  const filteredPages = useMemo(() => pages.filter((summary) => (!filter.type || summary.entityType === filter.type) && (!filter.tag || summary.tags.includes(filter.tag))), [pages, filter]);
  const knownTitles = useMemo(() => new Set(pages.map((summary) => summary.title.toLowerCase())), [pages]); // for wiki-link "redlinks"
  const currentMap = maps.find((map) => map.id === currentMapId) ?? null;
  const breadcrumb = useMemo(() => {
    const chain: PlayerCodexMap[] = []; let cursor = currentMap; const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) { chain.unshift(cursor); guard.add(cursor.id); cursor = maps.find((map) => map.id === cursor!.parentMapId) ?? null; }
    return chain;
  }, [currentMap, maps]);
  // Drill-down: revealed maps nested under the current one (breadcrumb goes up, these go down). `maps` is
  // already the server's revealed-only projection, so only shared child maps ever appear here.
  const childMaps = useMemo(() => (currentMapId ? maps.filter((map) => map.parentMapId === currentMapId) : []), [maps, currentMapId]);
  // Mirrors the GM atlas: the breadcrumb only climbs one chain, so several revealed top-level maps need
  // their own switcher or all but the first are unreachable. Already the revealed-only projection.
  const rootMaps = useMemo(() => maps.filter((map) => map.parentMapId === null), [maps]);
  const currentRootId = breadcrumb[0]?.id ?? null;

  return (
    <div className="codex-root codex-player">
      <div className="codex-modebar">
        <Tabs ariaLabel="Codex" activeId={view} onChange={(id) => setView(id as PlayerView)}
          tabs={[{ id: "world", label: "World" }, { id: "lore", label: "Lore" }, { id: "atlas", label: "Atlas" }, { id: "journal", label: "Journal" }, { id: "graph", label: "Graph" }]} />
      </div>

      {error && <Alert tone="danger" title="Couldn't load the codex">{error}</Alert>}

      {view === "world" && (
        <WorldHome pages={pages} showReveal={false} onOpenPage={openPage}
          onPickType={(type) => { setFilter({ type, tag: null }); setView("lore"); }}
          onPickTag={(tag) => { setFilter({ type: null, tag }); setView("lore"); }} />
      )}

      {view === "graph" && (
        <RelationshipGraph nodes={pages.map((summary) => ({ id: summary.id, title: summary.title, entityType: summary.entityType }))} edges={rels} onOpen={openPage}
          emptyState={<><h3>Nothing connected yet</h3><p>As the GM reveals people and places, the links between them appear here.</p></>} />
      )}

      {view === "lore" && (
        <div className={`codex-workspace${selectedPageId ? " has-selection" : ""}`}>
          <aside className="codex-rail">
            <div className="codex-rail-head">
              <Input value={query} placeholder="Search what you know…" aria-label="Search the codex"
                onChange={(event) => { setQuery(event.target.value); if (event.target.value.trim()) setFilter({ type: null, tag: null }); }} />
            </div>
            <nav className="codex-list" aria-label="Revealed pages">
              {query.trim() ? (
                searchHits === null
                  ? <p className="codex-list-empty">Searching…</p>
                  : searchHits.length === 0
                    ? <p className="codex-list-empty">Nothing you know matches that.</p>
                    : searchHits.map((summary) => <button key={summary.id} type="button" className={`codex-list-item${summary.id === selectedPageId ? " is-active" : ""}`} onClick={() => setSelectedPageId(summary.id)}>{summary.entityType !== "note" && <EntityIcon type={summary.entityType} />}<span className="codex-list-title">{summary.title}</span></button>)
              ) : (
                <>
                  {(filter.type || filter.tag) && <Chip onRemove={() => setFilter({ type: null, tag: null })} removeLabel="Clear filter">{filter.type ? `${ENTITY_DEFS[filter.type].label}s` : `#${filter.tag}`}</Chip>}
                  {loading && <div className="codex-list-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>}
                  {!loading && filteredPages.length === 0 && <p className="codex-list-empty">Nothing revealed yet.</p>}
                  {filteredPages.map((summary) => <button key={summary.id} type="button" className={`codex-list-item${summary.id === selectedPageId ? " is-active" : ""}`} onClick={() => setSelectedPageId(summary.id)}>{summary.entityType !== "note" && <EntityIcon type={summary.entityType} />}<span className="codex-list-title">{summary.title}</span></button>)}
                </>
              )}
            </nav>
          </aside>
          <section className="codex-main">
            {selectedPageId && <button type="button" className="codex-back" onClick={() => setSelectedPageId(null)}>‹ All lore</button>}
            {page
              ? <article className="codex-reader">
                  {page.bannerAssetId && <CodexImage assetId={page.bannerAssetId} token={token} alt="" className="codex-banner-img" />}
                  <h2 className="codex-reader-title">{page.entityType !== "note" && <EntityIcon type={page.entityType} className="codex-reader-titleicon" />}{page.title}</h2>
                  {Object.entries(page.fields).length > 0 && (
                    <dl className="codex-reader-fields">
                      {Object.entries(page.fields).map(([key, value]) => {
                        const def = entityDef(page.entityType).fields.find((field) => field.key === key);
                        return <div key={key} className="codex-reader-field"><dt>{def?.label ?? key}</dt><dd>{value}</dd></div>;
                      })}
                    </dl>
                  )}
                  <div className="codex-reader-body">{page.body.trim() ? <CodexMarkdown text={page.body} onNavigate={navigate} token={token} knownTitles={knownTitles} /> : <p className="codex-preview-empty">Nothing written here yet.</p>}</div>
                  {pageRels.length > 0 && (
                    <div className="codex-reader-rels">
                      <h4 className="codex-backlinks-title">Relationships</h4>
                      <ul className="codex-rels-list">
                        {pageRels.map((rel) => (
                          <li key={rel.id} className="codex-rels-item">
                            <span className="codex-rels-label">{relationshipLabel(rel.type, rel.direction)}</span>
                            <button type="button" className="codex-md-link" onClick={() => navigate(rel.otherTitle)}><EntityIcon type={rel.otherType} /> {rel.otherTitle}</button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              : <div className="codex-main-empty"><h3>Select an entry</h3><p>Choose a page from the list to read it.</p></div>}
          </section>
        </div>
      )}

      {view === "atlas" && (
        <div className="codex-atlas">
          {rootMaps.length > 1 && (
            <nav className="codex-atlas-descend" aria-label="Top-level maps">
              <span className="codex-descend-label">Top level</span>
              {rootMaps.map((root) => (
                <button key={root.id} type="button" className={`codex-descend-chip${root.id === currentRootId ? " is-current" : ""}`} aria-current={root.id === currentRootId ? "true" : undefined} onClick={() => setCurrentMapId(root.id)}>{root.name}</button>
              ))}
            </nav>
          )}
          <nav className="codex-breadcrumb" aria-label="Map path">
            {breadcrumb.length === 0 && <span className="codex-crumb is-current">Atlas</span>}
            {breadcrumb.map((map, index) => <span key={map.id}>{index > 0 && <span className="codex-crumb-sep">›</span>}<button type="button" className={`codex-crumb${map.id === currentMapId ? " is-current" : ""}`} onClick={() => setCurrentMapId(map.id)}>{map.name}</button></span>)}
          </nav>
          {childMaps.length > 0 && (
            <nav className="codex-atlas-descend" aria-label="Maps within this one">
              <span className="codex-descend-label">Drill into</span>
              {childMaps.map((child) => (
                <button key={child.id} type="button" className="codex-descend-chip" onClick={() => setCurrentMapId(child.id)}>
                  <span className="codex-descend-arrow" aria-hidden="true">↳</span>{child.name}
                </button>
              ))}
            </nav>
          )}
          <div className="codex-atlas-body">
            {currentMap
              ? <MapSurface token={token} assetId={currentMap.assetId} markers={markers} placing={false} readOnly selectedMarkerId={null} onBackgroundClick={() => undefined} onMarkerClick={onMarkerClick} onMarkerDragEnd={() => undefined} />
              : <div className="codex-main-empty"><h3>No maps yet</h3><p>Maps your GM shares appear here.</p></div>}
          </div>
        </div>
      )}

      {view === "journal" && (
        <div className="codex-journal">
          <div className="codex-timeline">
            {timeline.length === 0 && <p className="codex-list-empty">No entries revealed yet.</p>}
            {timeline.map((entry) => (
              <article key={entry.id} className={`codex-entry${entry.kind === "combat" ? " is-combat" : ""}`}>
                <header className="codex-entry-head codex-entry-meta">{entry.kind === "combat" && <Badge tone="caution">Battle</Badge>}<span className="codex-entry-when">{whenLabel(entry)}</span></header>
                <div className="codex-entry-body"><CodexMarkdown text={entry.text} onNavigate={navigate} token={token} knownTitles={knownTitles} /></div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

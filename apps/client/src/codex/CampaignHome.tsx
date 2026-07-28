import { useMemo } from "react";
import { Alert, Badge, Button, Skeleton } from "@vtt/ui";
import { CodexIcon, EntityIcon } from "./icons";
import { ENTITY_DEFS, ENTITY_TYPE_LIST, entityColor, type EntityType } from "./entities";

/**
 * CI-7: the Codex's landing surface. Formerly `World`; renamed `Campaign` because it answers
 * "where is this campaign right now", not only "what is in this world" — and because Phase 4's
 * campaign records (sessions, quests, standing) land here rather than in a sixth mode (D-10).
 *
 * **Presentational on purpose.** Both audiences render this component, so it never fetches: the GM
 * workspace feeds it GM reads and the player Codex feeds it the server's PLAYER projections. A
 * component that chose its own endpoint would be one role check away from a leak; here there is
 * nothing to check, because a caller can only hand over what its own token already returned.
 *
 * Scope: the dashboard shows data that exists TODAY — entities by type, recent journal activity,
 * atlas presence, the current in-world date. Next session / open quests / deadlines / party position /
 * faction standing are named by CI-7 but their records are Phase 4 (M8–M12); no placeholder panel
 * stands in for a record that does not exist yet.
 */

/** The minimum an entity needs to appear here — satisfied by both the GM and player page summaries. */
type CampaignEntity = Readonly<{ id: string; title: string; entityType: EntityType; tags: readonly string[]; updatedAt: string; revealedToPlayers?: boolean }>;
/**
 * One journal row, in the shape BOTH projections can supply: a GM entry carries `playerText`/`gmText`
 * and a player entry carries a single already-projected `text`, so the caller flattens to this rather
 * than the dashboard branching on a role it should not know about.
 */
export type CampaignEntry = Readonly<{ id: string; summary: string; when: string; kind: "note" | "combat" }>;
/** One atlas row. `revealedToPlayers` is GM-only knowledge and is simply absent from a player's maps. */
export type CampaignMap = Readonly<{ id: string; name: string; revealedToPlayers?: boolean }>;

export function CampaignHome({
  pages, entries = [], maps = [], today = null,
  onPickType, onPickTag, onOpenPage, onOpenEntry, onOpenMap, onCreate,
  showReveal = true, loading = false, error = null
}: Readonly<{
  pages: readonly CampaignEntity[];
  /** Newest-first is the caller's job; this renders the first few as given. */
  entries?: readonly CampaignEntry[];
  maps?: readonly CampaignMap[];
  /** The world's "now", already formatted against the campaign calendar. Null when no date is set. */
  today?: string | null;
  onPickType: (type: EntityType) => void;
  onPickTag: (tag: string) => void;
  onOpenPage: (pageId: string) => void;
  /** R1: lands on the Journal with THIS entry marked, not merely "the Journal, somewhere". */
  onOpenEntry: (entryId: string) => void;
  /** R1: opens the Atlas ON this map. */
  onOpenMap: (mapId: string) => void;
  onCreate?: () => void;
  showReveal?: boolean;
  /** CF-2: true while the first fetch is in flight, so the "No entries yet" invitation cannot lie. */
  loading?: boolean;
  /** R4: this mode's own failure. The dashboard reads four feeds; a silent one would be a blank panel. */
  error?: string | null;
}>) {
  const byType = useMemo(() => {
    const counts = {} as Record<EntityType, number>;
    for (const page of pages) counts[page.entityType] = (counts[page.entityType] ?? 0) + 1;
    return counts;
  }, [pages]);
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const page of pages) for (const tag of page.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [pages]);
  const recent = useMemo(() => [...pages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10), [pages]);
  const revealed = useMemo(() => pages.filter((page) => page.revealedToPlayers).length, [pages]);
  const recentEntries = useMemo(() => entries.slice(0, 5), [entries]);

  // CF-2: settle the fetches before claiming emptiness — for either audience. A campaign with no pages
  // but a running journal or a charted atlas is NOT empty, which is why all three feeds gate this.
  const nothingYet = pages.length === 0 && entries.length === 0 && maps.length === 0;
  if (loading && nothingYet) return <div className="codex-main-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>;
  if (nothingYet) {
    return (
      <div className="codex-campaign">
        {error && <Alert tone="danger" title="Couldn't load the campaign">{error}</Alert>}
        {showReveal
          ? <div className="codex-main-empty"><h3>No entries yet</h3><p>Create characters, locations, factions and more. They'll be organized here by type and tag.</p>{onCreate && <Button variant="primary" onClick={onCreate}>New page</Button>}</div>
          : <div className="codex-main-empty"><h3>Nothing revealed yet</h3><p>Entries your GM shares appear here, organized by type and tag.</p></div>}
      </div>
    );
  }

  return (
    <div className="codex-campaign">
      {/* R4: the dashboard's own error surface. It reads the notebook, the journal, the atlas and the
          calendar; without this a failed journal fetch renders one fewer section, silently. */}
      {error && <Alert tone="danger" title="Couldn't load the campaign">{error}</Alert>}

      <div className="codex-campaign-stats">
        <div className="codex-campaign-stat"><span className="codex-campaign-statnum">{pages.length}</span><span>entities</span></div>
        {showReveal && <div className="codex-campaign-stat"><span className="codex-campaign-statnum">{revealed}</span><span>revealed to players</span></div>}
        <div className="codex-campaign-stat"><span className="codex-campaign-statnum">{tags.length}</span><span>tags</span></div>
        <div className="codex-campaign-stat"><span className="codex-campaign-statnum">{maps.length}</span><span>{maps.length === 1 ? "map" : "maps"}</span></div>
        <div className="codex-campaign-stat"><span className="codex-campaign-statnum">{entries.length}</span><span>journal {entries.length === 1 ? "entry" : "entries"}</span></div>
        {/* The same `codex-now-chip` the journal composer uses for the world's "now" — one readout, one look. */}
        {today && <div className="codex-campaign-today"><span className="codex-now-chip" title="The campaign's current date — set it in the journal's calendar">Now: {today}</span></div>}
      </div>

      <section className="codex-campaign-section">
        <h3 className="codex-campaign-h">By type</h3>
        <div className="codex-campaign-types">
          {ENTITY_TYPE_LIST.filter((type) => byType[type]).map((type) => (
            <button key={type} type="button" className="codex-campaign-typecard" style={{ borderLeftColor: entityColor(type) }} onClick={() => onPickType(type)}>
              <span className="codex-campaign-typeicon" style={{ background: `color-mix(in srgb, ${entityColor(type)} 22%, transparent)` }} aria-hidden="true"><EntityIcon type={type} className="codex-campaign-typeglyph" /></span>
              <span className="codex-campaign-typelabel">{ENTITY_DEFS[type].label}</span>
              <span className="codex-campaign-typecount" style={{ color: entityColor(type) }}>{byType[type]}</span>
            </button>
          ))}
        </div>
      </section>

      {recentEntries.length > 0 && (
        <section className="codex-campaign-section">
          <h3 className="codex-campaign-h">Recent journal activity</h3>
          <nav className="codex-campaign-recent" aria-label="Recent journal activity">
            {/* R2: the same row chassis every list on this surface uses, and a record's kind reads by
                icon AND text — the battle glyph plus a "Battle" badge, never by colour alone. */}
            {recentEntries.map((entry) => (
              <button key={entry.id} type="button" className="codex-campaign-recentitem" onClick={() => onOpenEntry(entry.id)}>
                <CodexIcon iconId={entry.kind === "combat" ? "battle" : "hourglass"} className="codex-ent-icon codex-campaign-recentglyph" />
                <span className="codex-list-title">{entry.summary || "Untitled entry"}</span>
                {entry.kind === "combat" && <Badge tone="caution">Battle</Badge>}
                {entry.when && <span className="codex-campaign-recentwhen">{entry.when}</span>}
              </button>
            ))}
          </nav>
        </section>
      )}

      {maps.length > 0 && (
        <section className="codex-campaign-section">
          <h3 className="codex-campaign-h">Atlas</h3>
          <nav className="codex-campaign-recent" aria-label="Maps in the atlas">
            {maps.map((map) => (
              <button key={map.id} type="button" className="codex-campaign-recentitem" onClick={() => onOpenMap(map.id)}>
                <CodexIcon iconId="compass" className="codex-ent-icon codex-campaign-recentglyph" />
                <span className="codex-list-title">{map.name}</span>
                {showReveal && (map.revealedToPlayers ? <Badge tone="success">Shown</Badge> : <Badge>GM only</Badge>)}
              </button>
            ))}
          </nav>
        </section>
      )}

      <section className="codex-campaign-section">
        <h3 className="codex-campaign-h">Recently updated</h3>
        <nav className="codex-campaign-recent" aria-label="Recently updated pages">
          {recent.map((page) => (
            <button key={page.id} type="button" className="codex-campaign-recentitem" onClick={() => onOpenPage(page.id)}>
              {page.entityType !== "note" && <EntityIcon type={page.entityType} />}
              <span className="codex-list-title">{page.title}</span>
              {showReveal && page.revealedToPlayers && <Badge tone="success">Shown</Badge>}
            </button>
          ))}
        </nav>
      </section>

      {tags.length > 0 && (
        <section className="codex-campaign-section">
          <h3 className="codex-campaign-h">Tags</h3>
          <div className="codex-campaign-tags">
            {tags.map(([tag, count]) => <button key={tag} type="button" className="codex-tag-chip tap-target" onClick={() => onPickTag(tag)}>{tag}<span className="codex-tag-count">{count}</span></button>)}
          </div>
        </section>
      )}
    </div>
  );
}

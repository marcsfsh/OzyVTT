import { useMemo } from "react";
import { Badge } from "@vtt/ui";
import { type CodexPageSummary } from "./api";
import { ENTITY_DEFS, ENTITY_TYPE_LIST, entityIcon, type EntityType } from "./entities";

/**
 * The world at a glance: every entity grouped by type, a tag cloud, and what changed recently - one
 * landing that answers "what's in this world" and jumps into a filtered notebook. Derived entirely from
 * the page list (the entity store), so it's always current.
 */
export function WorldHome({ pages, onPickType, onPickTag, onOpenPage }: Readonly<{
  pages: readonly CodexPageSummary[];
  onPickType: (type: EntityType) => void;
  onPickTag: (tag: string) => void;
  onOpenPage: (pageId: string) => void;
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

  if (pages.length === 0) {
    return <div className="codex-main-empty"><h3>Your world begins here</h3><p>Create characters, locations, factions and more in the Pages tab - they'll gather here, grouped by type, with a tag cloud and recent changes.</p></div>;
  }

  return (
    <div className="codex-world">
      <div className="codex-world-stats">
        <div className="codex-world-stat"><span className="codex-world-statnum">{pages.length}</span><span>entities</span></div>
        <div className="codex-world-stat"><span className="codex-world-statnum">{revealed}</span><span>revealed to players</span></div>
        <div className="codex-world-stat"><span className="codex-world-statnum">{tags.length}</span><span>tags</span></div>
      </div>

      <section className="codex-world-section">
        <h3 className="codex-world-h">By type</h3>
        <div className="codex-world-types">
          {ENTITY_TYPE_LIST.filter((type) => byType[type]).map((type) => (
            <button key={type} type="button" className="codex-world-typecard" onClick={() => onPickType(type)}>
              <span className="codex-world-typeicon" aria-hidden="true">{entityIcon(type)}</span>
              <span className="codex-world-typelabel">{ENTITY_DEFS[type].label}</span>
              <span className="codex-world-typecount">{byType[type]}</span>
            </button>
          ))}
        </div>
      </section>

      {tags.length > 0 && (
        <section className="codex-world-section">
          <h3 className="codex-world-h">Tags</h3>
          <div className="codex-world-tags">
            {tags.map(([tag, count]) => <button key={tag} type="button" className="codex-tag-chip" onClick={() => onPickTag(tag)}>{tag}<span className="codex-tag-count">{count}</span></button>)}
          </div>
        </section>
      )}

      <section className="codex-world-section">
        <h3 className="codex-world-h">Recently updated</h3>
        <div className="codex-world-recent">
          {recent.map((page) => (
            <button key={page.id} type="button" className="codex-world-recentitem" onClick={() => onOpenPage(page.id)}>
              {page.entityType !== "note" && <span aria-hidden="true">{entityIcon(page.entityType)}</span>}
              <span className="codex-list-title">{page.title}</span>
              {page.revealedToPlayers && <Badge tone="success">Shown</Badge>}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

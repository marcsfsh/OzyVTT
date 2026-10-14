import { Button, IconButton, IconX } from "@vtt/ui";
import { CodexIcon, EntityIcon, pinSwatchVar } from "./icons";
import type { PlayerCodexMap, PlayerCodexMarker, PlayerCodexPageSummary } from "./api";

/**
 * What a player sees on tapping a pin: its label, tags and every revealed link. Everything comes from
 * `PlayerCodexMarker` (already filtered server-side) plus the player's own page list; unknown ids are skipped.
 */
export function PinDetails({
  pin,
  pages,
  maps,
  onOpenPage,
  onOpenMap,
  onClose
}: Readonly<{
  pin: PlayerCodexMarker;
  pages: readonly PlayerCodexPageSummary[];
  maps: readonly PlayerCodexMap[];
  onOpenPage: (pageId: string) => void;
  onOpenMap: (mapId: string) => void;
  onClose: () => void;
}>) {
  const linked = pin.pageIds
    .map((id) => pages.find((summary) => summary.id === id))
    .filter((summary): summary is PlayerCodexPageSummary => Boolean(summary));
  const subMap = pin.subMapId ? (maps.find((map) => map.id === pin.subMapId) ?? null) : null;

  return (
    /* A bottom sheet at <=760px, a side panel above. Rows are 44px tall in this vertical stack. */
    <aside className="codex-pindetails" aria-label="Pin details">
      <div className="codex-inspector-head">
        <strong>
          <CodexIcon iconId={pin.iconId} className="codex-ent-icon" style={{ color: pinSwatchVar(pin.iconColor) }} />
          {pin.label?.trim() || "Unlabelled pin"}
        </strong>
        <IconButton label="Close" size="sm" onClick={onClose}>
          <IconX />
        </IconButton>
      </div>

      {pin.isParty && <p className="codex-inspector-hint">The party is here.</p>}

      {pin.tags.length > 0 && (
        <div className="codex-entry-meta">
          {pin.tags.map((tag) => (
            <span key={tag} className="codex-hit-tag">
              #{tag}
            </span>
          ))}
        </div>
      )}

      {linked.length > 0 && (
        <div className="codex-marker-links">
          {linked.map((summary) => (
            <button
              key={summary.id}
              type="button"
              className="codex-marker-link-open"
              onClick={() => onOpenPage(summary.id)}
            >
              {summary.entityType !== "note" && <EntityIcon type={summary.entityType} />}
              <span className="codex-list-title">{summary.title}</span>
            </button>
          ))}
        </div>
      )}

      {subMap && (
        <Button variant="secondary" size="sm" arrow onClick={() => onOpenMap(subMap.id)}>
          Open {subMap.name}
        </Button>
      )}

      {linked.length === 0 && !subMap && (
        <p className="codex-page-timeline-empty">Nothing has been shared about this place yet.</p>
      )}
    </aside>
  );
}

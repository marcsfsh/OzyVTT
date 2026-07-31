import { Button, IconButton, IconX } from "@vtt/ui";
import { CodexIcon, EntityIcon, pinSwatchVar } from "./icons";
import type { PlayerCodexMap, PlayerCodexMarker, PlayerCodexPageSummary } from "./api";

/**
 * D14 / G24 — what a player gets when they tap a pin.
 *
 * Before this, a tap opened the pin's **first** linked page and dropped everything else on the floor:
 * a pin's label, its tags and its second, third and fourth links were all unreachable, and a pin with
 * no linked page did nothing at all. Now the tap opens the pin, and the pin says what it is.
 *
 * **No projection change.** Everything here is already on `PlayerCodexMarker` — the server filtered
 * `pageIds` to the revealed subset and gated `subMapId` before it ever reached this client — plus page
 * titles resolved against the player's own revealed page list. An id with no row is simply not rendered.
 */
export function PinDetails({ pin, pages, maps, onOpenPage, onOpenMap, onClose }: Readonly<{
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
  const subMap = pin.subMapId ? maps.find((map) => map.id === pin.subMapId) ?? null : null;

  return (
    /* ≤760 this is a bottom sheet, above that a side panel — one component, one CSS class, the ladder
       does the rest. Its rows are §4 route 1 (`min-height`), which a vertical stack must use. */
    <aside className="codex-pindetails" aria-label="Pin details">
      <div className="codex-inspector-head">
        <strong>
          <CodexIcon iconId={pin.iconId} className="codex-ent-icon" style={{ color: pinSwatchVar(pin.iconColor) }} />
          {pin.label?.trim() || "Unlabelled pin"}
        </strong>
        <IconButton label="Close" size="sm" onClick={onClose}><IconX /></IconButton>
      </div>

      {pin.isParty && <p className="codex-inspector-hint">The party is here.</p>}

      {pin.tags.length > 0 && (
        <div className="codex-entry-meta">{pin.tags.map((tag) => <span key={tag} className="codex-hit-tag">#{tag}</span>)}</div>
      )}

      {linked.length > 0 && (
        <div className="codex-marker-links">
          {linked.map((summary) => (
            <button key={summary.id} type="button" className="codex-marker-link-open" onClick={() => onOpenPage(summary.id)}>
              {summary.entityType !== "note" && <EntityIcon type={summary.entityType} />}
              <span className="codex-list-title">{summary.title}</span>
            </button>
          ))}
        </div>
      )}

      {subMap && <Button variant="secondary" size="sm" arrow onClick={() => onOpenMap(subMap.id)}>Open {subMap.name}</Button>}

      {linked.length === 0 && !subMap && <p className="codex-page-timeline-empty">Nothing has been shared about this place yet.</p>}
    </aside>
  );
}

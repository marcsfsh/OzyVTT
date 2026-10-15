import { useCallback } from "react";
import type { PlayerCodexMap, PlayerCodexPageSummary } from "@vtt/domain";
import { playerCodexApi } from "./api";
import { AtlasBreadcrumb, AtlasChildren, AtlasRoots, PinFilter, useDimmedPins, useMapTree } from "./AtlasNav";
import { MapSurface } from "./MapSurface";
import { PinDetails } from "./PinDetails";
import { atlasPath, pagePath } from "./routes";
import { useCodexQuery } from "./useCodexQuery";

const NO_PINS: readonly never[] = [];

/** The player's Atlas: revealed maps and pins only, read-only, with the GM's ways around. */
export function PlayerAtlas({
  token,
  maps,
  pages,
  mapId,
  query,
  onFilterChange,
  onQueryChange,
  onOpen
}: Readonly<{
  token: string;
  maps: readonly PlayerCodexMap[];
  pages: readonly PlayerCodexPageSummary[];
  /** From `/codex/atlas/:mapId`. Null opens the first root map. */
  mapId: string | null;
  query: URLSearchParams;
  onFilterChange: (next: Readonly<Record<string, string | null>>) => void;
  onQueryChange: (mutate: (params: URLSearchParams) => void) => void;
  onOpen: (path: string) => void;
}>) {
  const roots = maps.filter((map) => map.parentMapId === null);
  const currentMapId = mapId ?? roots[0]?.id ?? maps[0]?.id ?? null;
  const currentMap = maps.find((map) => map.id === currentMapId) ?? null;
  const { rootMaps, breadcrumb, childMaps } = useMapTree(maps, currentMapId);

  const readPins = useCallback(() => playerCodexApi.listMarkers(token, currentMapId ?? ""), [token, currentMapId]);
  const pins = useCodexQuery(currentMapId ? readPins : null);
  const markers = currentMapId && !pins.error ? (pins.data ?? NO_PINS) : NO_PINS;
  const text = query.get("q") ?? "";
  const tag = query.get("tag");
  const dimmed = useDimmedPins(markers, text, tag);
  const selectedPinId = query.get("pin");
  const selectedPin = markers.find((marker) => marker.id === selectedPinId) ?? null;
  const enter = (id: string) => onOpen(atlasPath(id));

  return (
    <div className="codex-atlas">
      <AtlasRoots roots={rootMaps} currentRootId={breadcrumb[0]?.id ?? null} onEnter={enter} />
      <AtlasBreadcrumb chain={breadcrumb} currentMapId={currentMapId} onEnter={enter} />
      <AtlasChildren maps={childMaps} onEnter={enter} />
      {currentMap && markers.length > 0 && (
        <PinFilter pins={markers} text={text} tag={tag} dimmed={dimmed} onChange={onFilterChange} />
      )}
      <div className="codex-atlas-body">
        {currentMap ? (
          <MapSurface
            token={token}
            assetId={currentMap.assetId}
            markers={markers}
            placing={false}
            readOnly
            selectedMarkerId={selectedPinId}
            dimmedMarkerIds={dimmed}
            onBackgroundClick={() => undefined}
            onMarkerClick={(markerId) => onQueryChange((params) => params.set("pin", markerId))}
            onMarkerDragEnd={() => undefined}
          />
        ) : (
          <div className="codex-main-empty">
            <h3>No maps yet</h3>
            <p>Maps your GM shares appear here.</p>
          </div>
        )}
        {/* A pin tap opens its details: label, tags and every revealed page it links. */}
        {selectedPin && (
          <PinDetails
            pin={selectedPin}
            pages={pages}
            maps={maps}
            onOpenPage={(pageId) => onOpen(pagePath(pageId))}
            onOpenMap={enter}
            onClose={() => onQueryChange((params) => params.delete("pin"))}
          />
        )}
      </div>
    </div>
  );
}

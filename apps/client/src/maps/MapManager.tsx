import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Eyebrow, IconChevronLeft, useToast } from "@vtt/ui";
import { useAuthorizedMapImage } from "../scene/mapImage";
import { apiRequest } from "../lib/api";
import { CalibrationPane } from "./CalibrationPane";
import { MapRail } from "./MapRail";
import { MapUploadForm } from "./MapUploadForm";
import type { MapAsset, MapKind } from "./map-catalog";
import "./map-manager.css";

/** The map a surface is using, as the shell passes it between the library, the table and the viewer. */
export type MapSelection = Readonly<{
  id: string;
  name: string;
  kind: MapKind;
  width: number;
  height: number;
  calibration: MapAsset["calibration"];
  scale: MapAsset["scale"];
}>;

/**
 * The maps library, as a frame: `back · heading · upload row` above a body with a rail of maps beside
 * the selected map's calibration pane (`CalibrationPane.tsx`).
 */
export function MapManager({
  gmToken,
  preferredMapId,
  openOnPreferred = false,
  onSelectionChange,
  onBack,
  next
}: Readonly<{
  gmToken: string;
  preferredMapId?: string | null;
  /** The GM came here to set this map's grid, so a phone opens straight on its calibration. */
  openOnPreferred?: boolean;
  onSelectionChange?: (map: MapSelection | null) => void;
  /** The frame's back row; the shell passes the door in. */
  onBack?: () => void;
  /** Where to go once a grid is set: back to whatever sent the GM here. */
  next?: Readonly<{ label: string; go: () => void }>;
}>) {
  const [maps, setMaps] = useState<readonly MapAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Below 850px the rail and the pane share one column, so one of them is showing. Separate from
      `selectedId`: "All maps" must not deselect the map the shell is using. */
  const [narrowView, setNarrowView] = useState<"rail" | "pane">("rail");
  const { toast } = useToast();
  const selected = maps.find((map) => map.id === selectedId) ?? null;
  const image = useAuthorizedMapImage(selected?.id ?? null, gmToken);
  const previewUrl = image.status === "ready" ? image.url : null;
  const folderNames = Array.from(
    new Set(maps.map((map) => map.folder).filter((folder): folder is string => folder !== null))
  ).sort((a, b) => a.localeCompare(b));

  const refresh = useCallback(
    async (preferId?: string) => {
      const data = await apiRequest<{ assets: readonly MapAsset[] }>("/api/v1/map-assets", {
        token: gmToken,
        failure: "Map request failed."
      });
      setMaps(data.assets);
      setSelectedId(
        (current) =>
          preferId ??
          (current && data.assets.some((map) => map.id === current) ? current : (data.assets[0]?.id ?? null))
      );
    },
    [gmToken]
  );
  useEffect(() => {
    void refresh().catch((error: Error) => toast(error.message, { tone: "error" }));
  }, [refresh, toast]);
  useEffect(() => {
    if (image.status === "error") toast(image.message, { tone: "error" });
  }, [image, toast]);
  /** The combat's map is the opening selection only. The effect also runs on `maps` (the id arrives
      before the list), so each id is asserted once; otherwise every `refresh()` would yank the GM back
      to the combat's map. */
  const assertedPreferredId = useRef<string | null>(null);
  useEffect(() => {
    if (!preferredMapId || assertedPreferredId.current === preferredMapId) return;
    if (!maps.some((map) => map.id === preferredMapId)) return;
    assertedPreferredId.current = preferredMapId;
    setSelectedId(preferredMapId);
    if (openOnPreferred) setNarrowView("pane");
  }, [preferredMapId, maps, openOnPreferred]);
  useEffect(() => {
    if (!onSelectionChange) return;
    onSelectionChange(
      selected
        ? {
            id: selected.id,
            name: selected.name,
            kind: selected.kind,
            width: selected.width,
            height: selected.height,
            calibration: selected.calibration,
            scale: selected.scale
          }
        : null
    );
  }, [selected, onSelectionChange]);

  return (
    <section
      className="map-manager scenes-maps-view pane-frame frame-col anim-view"
      aria-labelledby="map-manager-heading"
    >
      <header className="map-manager-head">
        {onBack && (
          <Button variant="ghost" className="map-manager-back" onClick={onBack}>
            <IconChevronLeft /> Back to scenes
          </Button>
        )}
        <div className="map-manager-title">
          <div>
            <Eyebrow>GM map library</Eyebrow>
            <h2 id="map-manager-heading">Maps</h2>
          </div>
          <p>
            One collection: the same maps the scene-prep picker offers. Add an image, set its grid, then use it in a
            scene.
          </p>
        </div>
        <MapUploadForm
          gmToken={gmToken}
          folderNames={folderNames}
          onUploaded={async (mapId) => {
            await refresh(mapId);
            setNarrowView("pane");
          }}
        />
      </header>

      <div className="map-body frame-fill" data-view={narrowView}>
        <MapRail
          maps={maps}
          folderNames={folderNames}
          selectedId={selectedId}
          gmToken={gmToken}
          onSelect={(mapId) => {
            setSelectedId(mapId);
            setNarrowView("pane");
          }}
        />
        {selected ? (
          <CalibrationPane
            key={selected.id}
            map={selected}
            previewUrl={previewUrl}
            gmToken={gmToken}
            folderNames={folderNames}
            onSaved={refresh}
            onShowRail={() => setNarrowView("rail")}
            {...(next ? { next } : {})}
          />
        ) : (
          <div className="map-pane map-pane-empty">
            <p className="map-empty">No maps uploaded yet. Add one above to set its grid here.</p>
          </div>
        )}
      </div>
    </section>
  );
}

import { useCallback, useMemo, useState } from "react";
import { IconChevronLeft, SegmentedControl, Tabs } from "@vtt/ui";
import type { PlayerCodexMap, PlayerCodexPageSummary } from "@vtt/domain";
import { playerCodexApi } from "../api";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { atlasPath, pagePath } from "../routes";
import { useCodexQuery } from "../useCodexQuery";
import { CodexPhoneBar } from "../shell/PhoneBar";
import { AtlasMap } from "./AtlasMap";
import { AtlasCrumbs, LayerChips, LayersMenu, MapsInside, PinFilter, PinTable } from "./AtlasPanel";
import { ATLAS_PHONE_QUERY } from "./AtlasView";
import { factionGround, peopleAtPins, useAtlasLayers } from "./layers";
import { PinView } from "./PinView";
import { defaultMapId, mapKindLine, useDimmedPins, useMapTree } from "./tree";
import "./atlas.css";

const NO_PINS: readonly never[] = [];
type PanelTab = "pins" | "maps";
type PhoneView = "map" | PanelTab;

/**
 * The players' atlas: the maps and pins the server shares with this player, read-only. Every pin's links are already
 * cut to pages this player can read, so its people and faction layers can only show what the player knows.
 */
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
  /** From `/codex/atlas/:mapId`. Null opens the first top-level map. */
  mapId: string | null;
  query: URLSearchParams;
  onFilterChange: (next: Readonly<Record<string, string | null>>) => void;
  onQueryChange: (mutate: (params: URLSearchParams) => void) => void;
  onOpen: (path: string) => void;
}>) {
  const phone = useMediaQuery(ATLAS_PHONE_QUERY);
  const currentMapId = mapId ?? defaultMapId(maps);
  const currentMap = maps.find((map) => map.id === currentMapId) ?? null;
  const { roots, chain, children } = useMapTree(maps, currentMapId);
  const parentName = currentMap?.parentMapId
    ? (maps.find((map) => map.id === currentMap.parentMapId)?.name ?? null)
    : null;

  const readPins = useCallback(() => playerCodexApi.listMarkers(token, currentMapId ?? ""), [token, currentMapId]);
  const pinFeed = useCodexQuery(currentMapId ? readPins : null);
  const pins = currentMapId && !pinFeed.error ? (pinFeed.data ?? NO_PINS) : NO_PINS;
  const text = query.get("q") ?? "";
  const tag = query.get("tag");
  const dimmed = useDimmedPins(pins, text, tag);
  const selectedId = query.get("pin");
  const selected = pins.find((pin) => pin.id === selectedId) ?? null;
  const [layers, toggleLayer] = useAtlasLayers();
  const people = useMemo(() => (layers.people ? peopleAtPins(pins, pages) : undefined), [layers.people, pins, pages]);
  const ground = useMemo(
    () => (layers.factions ? factionGround(pins, pages) : undefined),
    [layers.factions, pins, pages]
  );
  const [tab, setTab] = useState<PanelTab>("pins");
  const [phoneView, setPhoneView] = useState<PhoneView>("map");
  const [centerOn, setCenterOn] = useState<string | null>(null);

  const enter = (id: string) => onOpen(atlasPath(id));
  const select = (pinId: string) => onQueryChange((params) => params.set("pin", pinId));
  const close = () => onQueryChange((params) => params.delete("pin"));
  const pageTitle = (id: string) => pages.find((page) => page.id === id)?.title ?? null;
  const mapName = (id: string) => maps.find((map) => map.id === id)?.name ?? null;

  const map = currentMap ? (
    <AtlasMap
      token={token}
      assetId={currentMap.assetId}
      ariaLabel={currentMap.name}
      pins={pins}
      selectedPinId={selectedId}
      dimmedPinIds={dimmed}
      people={people}
      ground={ground}
      readOnly
      centerOnPinId={centerOn}
      onCentered={() => setCenterOn(null)}
      onPinClick={select}
    />
  ) : (
    <div className="atlas-firstmap">
      <h3>No maps yet</h3>
      <p>Maps your GM shares appear here.</p>
    </div>
  );
  const pinSide = selected && (
    <PinView
      pin={selected}
      pages={pages}
      mapName={mapName}
      onOpenPage={(pageId) => onOpen(pagePath(pageId))}
      onOpenMap={enter}
      onClose={close}
    />
  );
  const pinsBody = (
    <>
      {pins.length > 0 && <PinFilter pins={pins} text={text} tag={tag} dimmed={dimmed} onChange={onFilterChange} />}
      <PinTable
        pins={pins}
        pageTitle={pageTitle}
        mapName={mapName}
        selectedPinId={selectedId}
        dimmed={dimmed}
        gm={false}
        onSelect={(pinId) => {
          select(pinId);
          setCenterOn(pinId);
          if (phone) setPhoneView("map");
        }}
      />
    </>
  );
  const mapsBody = (
    <MapsInside children={children} roots={roots} currentRootId={chain[0]?.id ?? null} gm={false} onEnter={enter} />
  );

  if (phone)
    return (
      <div className="atlas is-phone">
        <CodexPhoneBar
          title={currentMap?.name ?? "Atlas"}
          onBack={chain.length > 1 ? () => enter(chain[chain.length - 2].id) : undefined}
          actions={<LayersMenu layers={layers} onToggle={toggleLayer} gm={false} />}
        />
        <SegmentedControl
          ariaLabel="Atlas view"
          className="atlas-phoneswitch"
          value={phoneView}
          onChange={(next) => setPhoneView(next as PhoneView)}
          options={[
            { value: "map", label: "Map" },
            { value: "pins", label: "Pins" },
            { value: "maps", label: "Maps inside" }
          ]}
        />
        {phoneView === "map" && (
          <div className="atlas-phonemap">
            {map}
            {pinSide && <div className="atlas-sheet scroll-y">{pinSide}</div>}
          </div>
        )}
        {phoneView === "pins" && <div className="atlas-phonelist scroll-y">{pinsBody}</div>}
        {phoneView === "maps" && <div className="atlas-phonelist scroll-y">{mapsBody}</div>}
      </div>
    );

  return (
    <div className="atlas">
      <div className="atlas-stage">
        <div className="atlas-toolbar">
          <AtlasCrumbs chain={chain} onEnter={enter} />
          <span className="atlas-grow" />
          <LayerChips layers={layers} onToggle={toggleLayer} gm={false} />
        </div>
        <div className="atlas-mapframe">{map}</div>
      </div>
      <aside className="atlas-panel" aria-label={currentMap ? currentMap.name : "Atlas"}>
        {currentMap && (
          <header className="atlas-panel-head">
            <div className="atlas-panel-titles">
              <h2 className="atlas-panel-title">{currentMap.name}</h2>
              <span className="atlas-panel-kind">{mapKindLine(currentMap.kind, parentName)}</span>
            </div>
          </header>
        )}
        {pinSide ? (
          <div className="atlas-panel-body scroll-y">
            <button type="button" className="atlas-back" onClick={close}>
              <IconChevronLeft /> All pins
            </button>
            {pinSide}
          </div>
        ) : (
          currentMap && (
            <>
              <Tabs
                className="atlas-panel-tabs"
                ariaLabel="Map panel"
                idBase="atlas-panel"
                activeId={tab}
                onChange={(next) => setTab(next as PanelTab)}
                tabs={[
                  { id: "pins", label: "Pins" },
                  { id: "maps", label: "Maps inside" }
                ]}
              />
              <div
                className="atlas-panel-body scroll-y"
                role="tabpanel"
                id={`atlas-panel-panel-${tab}`}
                aria-labelledby={`atlas-panel-tab-${tab}`}
              >
                {tab === "pins" ? pinsBody : mapsBody}
              </div>
            </>
          )
        )}
      </aside>
    </div>
  );
}

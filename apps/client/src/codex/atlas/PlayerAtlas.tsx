import { useCallback, useMemo, useState } from "react";
import { Button, IconChevronLeft, Modal, EmptyState, cx } from "@vtt/ui";
import { countOf } from "@vtt/domain";
import type { PlayerCodexMap, PlayerCodexPageSummary } from "@vtt/domain";
import { playerCodexApi } from "../api";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { atlasPath, pagePath } from "../routes";
import { useCodexQuery } from "../useCodexQuery";
import { CodexPhoneBar } from "../shell/PhoneBar";
import { AtlasMap } from "./AtlasMap";
import { AtlasCrumbs, LayerRows, LayersMenu, MapTree, PinFilter, PinTable, treeOrder } from "./AtlasPanel";
import { ATLAS_PHONE_QUERY } from "./AtlasView";
import { factionGround, peopleAtPins, useAtlasLayers } from "./layers";
import { PinView } from "./PinView";
import { defaultMapId, mapKindLine, useDimmedPins, useMapTree } from "./tree";
import "./atlas.css";

const NO_PINS: readonly never[] = [];
type PhoneView = "map" | "pins";

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
  onOpen,
  partyMapId = null
}: Readonly<{
  token: string;
  maps: readonly PlayerCodexMap[];
  /** The map the party pin is on, when this player can see it: the atlas opens there. */
  partyMapId?: string | null;
  pages: readonly PlayerCodexPageSummary[];
  /** From `/codex/atlas/:mapId`. Null opens the first top-level map. */
  mapId: string | null;
  query: URLSearchParams;
  onFilterChange: (next: Readonly<Record<string, string | null>>) => void;
  onQueryChange: (mutate: (params: URLSearchParams) => void) => void;
  onOpen: (path: string) => void;
}>) {
  const phone = useMediaQuery(ATLAS_PHONE_QUERY);
  const currentMapId = mapId ?? defaultMapId(maps, partyMapId);
  const currentMap = maps.find((map) => map.id === currentMapId) ?? null;
  const { chain } = useMapTree(maps, currentMapId);
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
  const partyPin = pins.find((pin) => pin.isParty) ?? null;
  const partyFocus = useMemo(() => (partyPin ? { x: partyPin.x, y: partyPin.y } : null), [partyPin?.id]); // eslint-disable-line react-hooks/exhaustive-deps
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
      initialFocus={partyFocus}
      selectedPinId={selectedId}
      dimmedPinIds={dimmed}
      people={people}
      ground={ground}
      readOnly
      centerOnPinId={centerOn}
      onCentered={() => setCenterOn(null)}
      onPinClick={select}
      pinMenu={(pinId) => {
        const pin = pins.find((candidate) => candidate.id === pinId);
        if (!pin) return null;
        // A player's menu changes nothing: it only opens what the pin leads to (F3 atlas rule 6).
        const items = [
          ...(pin.pageIds[0]
            ? [
                {
                  id: "page",
                  label: "Open its page",
                  iconId: "scroll",
                  onSelect: () => onOpen(pagePath(pin.pageIds[0]!))
                }
              ]
            : []),
          ...(pin.subMapId
            ? [{ id: "map", label: "Open the map inside", iconId: "compass", onSelect: () => enter(pin.subMapId!) }]
            : [])
        ];
        return items.length > 0
          ? { name: pin.label?.trim() || "Unlabelled pin", line: mapName(pin.mapId) ?? "", items }
          : null;
      }}
    />
  ) : (
    <EmptyState className="atlas-firstmap">No maps yet. Maps your GM shares appear here.</EmptyState>
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
  const mapGlass = currentMap && (
    <div className="atlas-glass is-top">
      <AtlasCrumbs chain={chain} onEnter={enter} />
      <span className="atlas-mapline">
        {[mapKindLine(currentMap.kind, parentName), countOf(pins.length, "pin")].join(" · ")}
      </span>
    </div>
  );

  if (phone)
    return (
      <div className="atlas is-phone">
        <CodexPhoneBar
          title="Codex"
          back={
            chain.length > 1
              ? { label: chain[chain.length - 2].name, onClick: () => enter(chain[chain.length - 2].id) }
              : undefined
          }
          actions={<LayersMenu layers={layers} onToggle={toggleLayer} gm={false} />}
        />
        <div className="nh-filterchips atlas-mapchips" role="group" aria-label="Maps">
          {treeOrder(maps).map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={cx("nh-filterchip", "interactive", entry.id === currentMapId && "is-on")}
              aria-pressed={entry.id === currentMapId}
              onClick={() => enter(entry.id)}
            >
              {entry.name}
            </button>
          ))}
        </div>
        <div className="atlas-phonemap">
          {map}
          {pinSide && <div className="atlas-sheet scroll-y">{pinSide}</div>}
          {!pinSide && currentMap && (
            <Button className="atlas-pinsbutton" onClick={() => setPhoneView("pins")}>
              {`Pins · ${pins.length}`}
            </Button>
          )}
        </div>
        {phoneView === "pins" && currentMap && (
          <Modal open size="md" align="bottom" title={`Pins · ${pins.length}`} onClose={() => setPhoneView("map")}>
            {pinsBody}
          </Modal>
        )}
      </div>
    );

  return (
    <div className="atlas atlas-cols">
      <nav className="atlas-tree scroll-y" aria-label="Maps and layers">
        <MapTree maps={maps} currentMapId={currentMapId} pinCount={pins.length} gm={false} onEnter={enter} />
        <LayerRows layers={layers} onToggle={toggleLayer} gm={false} />
      </nav>
      <div className="atlas-stage">
        <div className="atlas-mapframe">
          {map}
          {mapGlass}
        </div>
      </div>
      <aside className="atlas-panel" aria-label={currentMap ? currentMap.name : "Atlas"}>
        {pinSide ? (
          <div className="atlas-panel-body scroll-y">
            <button type="button" className="atlas-back" onClick={close}>
              <IconChevronLeft /> All pins
            </button>
            {pinSide}
          </div>
        ) : (
          currentMap && (
            <div className="atlas-panel-body scroll-y">
              <div className="atlas-pins-head">
                <h2 className="atlas-pins-title">{`Pins · ${pins.length}`}</h2>
              </div>
              {pinsBody}
            </div>
          )
        )}
      </aside>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  IconEyeOff,
  IconChevronLeft,
  IconMore,
  IconPlus,
  Menu,
  MenuItem,
  Modal,
  Skeleton,
  cx,
  useToast,
  EVERYONE,
  HIDDEN,
  AudienceChip,
  EmptyState
} from "@vtt/ui";
import {
  countOf,
  type CodexAutosaveSettings,
  type CodexMap,
  type CodexMapKind,
  type CodexMarker,
  type CodexPageSummary
} from "@vtt/domain";
import { atlasApi, codexApi } from "../api";
import { partyApi } from "../prep/api";
import { useConfirm, usePrompt } from "../../components/feedback";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { withQuery } from "../../router";
import { DEFAULT_COLOR, DEFAULT_ICON, CodexIcon } from "../icons";
import { entityDef } from "../entities";
import { CODEX_ROOT, atlasPath, pagePath } from "../routes";
import type { QuickCreateRequest } from "../QuickCreate";
import { useCodexQuery } from "../useCodexQuery";
import { CodexPhoneBar } from "../shell/PhoneBar";
import { AtlasMap, type MapMenuItem, type MapPoint } from "./AtlasMap";
import { AtlasCrumbs, LayerRows, LayersMenu, MapTree, PinFilter, PinTable, treeOrder } from "./AtlasPanel";
import { factionGround, peopleAtPins, useAtlasLayers } from "./layers";
import { MapDetails, MapPicker } from "./MapDetails";
import { PinEditor } from "./PinEditor";
import { PinView } from "./PinView";
import { defaultMapId, mapKindLine, useDimmedPins, useMapTree } from "./tree";
import "./atlas.css";

/** A stable empty feed, so a list that has not loaded yet keeps one identity across renders. */
const EMPTY: readonly never[] = [];
/** Below this width the atlas is a phone's: the map, the pins and the maps inside as one switch. */
export const ATLAS_PHONE_QUERY = "(max-width: 760px)";

type AtlasScene = Readonly<{ id: string; name: string }>;
type AtlasActor = Readonly<{ id: string; name: string }>;
type AtlasMeta = Readonly<{
  maps: readonly CodexMap[];
  pages: readonly CodexPageSummary[];
  /** The map the party pin is on, which the atlas opens on. */
  partyMapId: string | null;
}>;
/** The right column: the pins, or the map's details from its More (a pin and its editor take it over). */
type PanelTab = "pins" | "details";
type PhoneView = "map" | "pins" | "details";

export type AtlasViewProps = Readonly<{
  gmToken: string;
  scenes: readonly AtlasScene[];
  actors?: readonly AtlasActor[];
  activeEncounterId: string | null;
  onActivateScene: (encounterId: string) => void;
  onOpenReplay?: (archiveId: number) => void;
  /** From `/codex/atlas/:mapId`. Null opens the first top-level map. */
  mapId: string | null;
  /** From `?pin=`. A pin with no map in the address finds its map through `GET /codex/markers/{id}`. */
  pinId: string | null;
  /** The pin filter, in the address so a tag chip can link to it. */
  filter?: string;
  tagFilter?: string | null;
  autosave: CodexAutosaveSettings;
  onQuickCreate: (request: QuickCreateRequest) => void;
  onNavigate: (path: string) => void;
  onReplaceQuery: (mutate: (query: URLSearchParams) => void) => void;
}>;

/**
 * The GM's atlas: the map with its layers beside a panel of pins, maps inside and details. Set party position is a
 * button and then a tap, or a right-click (a long press on a phone) at the spot. A selected pin reads first and edits
 * on Edit pin. Every write goes to the server, and `codex:changed` refreshes what is shown.
 */
export function AtlasView({
  gmToken,
  scenes,
  actors = [],
  activeEncounterId,
  onActivateScene,
  onOpenReplay,
  mapId,
  pinId,
  filter = "",
  tagFilter = null,
  autosave,
  onQuickCreate,
  onNavigate,
  onReplaceQuery
}: AtlasViewProps) {
  const phone = useMediaQuery(ATLAS_PHONE_QUERY);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { prompt, dialog: promptDialog } = usePrompt();
  const { toast } = useToast();
  const meta = useCodexQuery(
    useCallback(async (): Promise<AtlasMeta> => {
      const [maps, pages, party] = await Promise.all([
        atlasApi.listMaps(gmToken),
        codexApi.listPages(gmToken),
        codexApi.party(gmToken).catch(() => null)
      ]);
      return { maps, pages, partyMapId: party?.marker.mapId ?? null };
    }, [gmToken]),
    { failure: "Could not load the atlas." }
  );
  const maps = meta.data?.maps ?? EMPTY;
  const pages = meta.data?.pages ?? EMPTY;
  const loading = meta.loading;
  const setMeta = meta.setData;

  /** The address names the map; this mirror also holds the map a `?pin=` link resolved to. */
  const [chosenMapId, setChosenMapId] = useState<string | null>(mapId);
  useEffect(() => {
    if (mapId) setChosenMapId(mapId);
  }, [mapId]);
  const currentMapId = chosenMapId ?? defaultMapId(maps, meta.data?.partyMapId ?? null);
  const readPins = useCallback(() => atlasApi.listMarkers(gmToken, currentMapId ?? ""), [gmToken, currentMapId]);
  const pinFeed = useCodexQuery(currentMapId ? readPins : null);
  const markers = currentMapId && !pinFeed.error ? (pinFeed.data ?? EMPTY) : EMPTY;
  const setMarkers = (update: (prev: readonly CodexMarker[]) => readonly CodexMarker[]) =>
    pinFeed.setData((prev) => [...update(prev ?? EMPTY)]);

  const [layers, toggleLayer] = useAtlasLayers();
  const [tab, setTab] = useState<PanelTab>("pins");
  const [phoneView, setPhoneView] = useState<PhoneView>("map");
  const [placing, setPlacing] = useState<"pin" | "party" | null>(null);
  /** The pin whose editor is open. Keyed to the pin, so a guarded move to another pin never drops a draft first. */
  const [editingPinId, setEditingPinId] = useState<string | null>(null);
  const editing = editingPinId !== null && editingPinId === pinId;
  const setEditing = (open: boolean) => setEditingPinId(open ? pinId : null);
  const [picking, setPicking] = useState(false);
  const [nestNew, setNestNew] = useState(true);
  const [centerOnPinId, setCenterOnPinId] = useState<string | null>(null);
  const [actionError, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [meta.data]);
  const error = actionError ?? meta.error;

  /** The selected pin is the `?pin=` address, so it survives a refresh and a change runs the unsaved-draft guard. */
  const pinHref = useCallback(
    (markerId: string | null) =>
      withQuery(currentMapId ? `${CODEX_ROOT}/atlas/${currentMapId}` : `${CODEX_ROOT}/atlas`, {
        q: filter || null,
        tag: tagFilter,
        pin: markerId
      }),
    [currentMapId, filter, tagFilter]
  );
  const selectPin = useCallback((markerId: string) => onNavigate(pinHref(markerId)), [onNavigate, pinHref]);
  const deselectPin = useCallback(() => {
    if (pinId) onNavigate(pinHref(null));
  }, [onNavigate, pinHref, pinId]);
  /** Clears the selection with no guard, for a pin that is gone with nothing left to save. */
  const clearPin = useCallback(() => onReplaceQuery((query) => query.delete("pin")), [onReplaceQuery]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (placing) setPlacing(null);
      else if (!editing) deselectPin();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deselectPin, placing, editing]);

  /** A `?pin=` link with no map in it (a journal entry, some search hits): find the map from the pin. */
  const resolvedPinRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pinId || mapId || loading || resolvedPinRef.current === pinId) return;
    resolvedPinRef.current = pinId;
    let live = true;
    void codexApi
      .marker(gmToken, pinId)
      .then((marker) => {
        if (!live) return;
        setChosenMapId(marker.mapId);
        onNavigate(atlasPath(marker.mapId, pinId));
      })
      .catch(() => {
        if (!live) return;
        setError("That pin is no longer in the atlas.");
        clearPin();
      });
    return () => {
      live = false;
    };
  }, [pinId, mapId, loading, gmToken, onNavigate, clearPin]);

  const currentMap = maps.find((map) => map.id === currentMapId) ?? null;
  const selected = markers.find((marker) => marker.id === pinId) ?? null;
  const { chain, children } = useMapTree(maps, currentMapId);
  const parentName = currentMap?.parentMapId
    ? (maps.find((map) => map.id === currentMap.parentMapId)?.name ?? null)
    : null;
  const dimmed = useDimmedPins(markers, filter, tagFilter);
  const shownPins = useMemo(
    () => (layers.hiddenPins ? markers : markers.filter((marker) => marker.revealedToPlayers || marker.id === pinId)),
    [markers, layers.hiddenPins, pinId]
  );
  const people = useMemo(
    () => (layers.people ? peopleAtPins(shownPins, pages) : undefined),
    [layers.people, shownPins, pages]
  );
  const ground = useMemo(
    () => (layers.factions ? factionGround(shownPins, pages) : undefined),
    [layers.factions, shownPins, pages]
  );
  const partyPin = markers.find((marker) => marker.isParty) ?? null;
  // The map opens on the party when it is here; once open, the camera is the reader's.
  const partyFocus = useMemo(() => (partyPin ? { x: partyPin.x, y: partyPin.y } : null), [partyPin?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const hiddenPinCount = markers.filter((marker) => !marker.revealedToPlayers).length;
  const hiddenMapCount = children.filter((map) => !map.revealedToPlayers).length;
  const pageTitle = useCallback((id: string) => pages.find((page) => page.id === id)?.title ?? null, [pages]);
  const mapName = useCallback((id: string) => maps.find((map) => map.id === id)?.name ?? null, [maps]);
  const tagSuggestions = useMemo(
    () => [...new Set([...pages.flatMap((page) => page.tags), ...maps.flatMap((map) => map.tags)])].sort(),
    [pages, maps]
  );

  const enterMap = useCallback(
    (next: string) => {
      setPlacing(null);
      onNavigate(atlasPath(next));
    },
    [onNavigate]
  );
  const showPinOnMap = (markerId: string) => {
    selectPin(markerId);
    setCenterOnPinId(markerId);
    if (phone) setPhoneView("map");
  };

  // ----- Writes -----
  const onMapReplace = (map: CodexMap) =>
    setMeta(
      (prev) => prev && { ...prev, maps: prev.maps.map((existing) => (existing.id === map.id ? map : existing)) }
    );
  const mapWrite = async (run: () => Promise<CodexMap>, failure: string) => {
    try {
      onMapReplace(await run());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    }
  };
  const createMapFrom = async (
    input: Readonly<{ assetId: string; name: string; kind: CodexMapKind; parentMapId: string | null }>
  ) => {
    try {
      const map = await atlasApi.createMap(gmToken, input);
      setPicking(false);
      await meta.reload();
      onNavigate(atlasPath(map.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the map.");
    }
  };
  const renameMap = async () => {
    if (!currentMap) return;
    const name = await prompt({ title: "Rename the map", defaultValue: currentMap.name, confirmLabel: "Rename" });
    if (name && name !== currentMap.name)
      void mapWrite(() => atlasApi.updateMap(gmToken, currentMap.id, { name }), "Couldn't rename the map.");
  };
  const deleteMap = async () => {
    if (
      !currentMap ||
      !(await confirm({
        title: `Delete map "${currentMap.name}"?`,
        body: "Its pins are removed with it.",
        confirmLabel: "Delete",
        danger: true
      }))
    )
      return;
    try {
      await atlasApi.deleteMap(gmToken, currentMap.id);
      const parent = currentMap.parentMapId;
      await meta.reload();
      onNavigate(parent ? atlasPath(parent) : `${CODEX_ROOT}/atlas`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't delete the map.");
    }
  };
  const addPinAt = async (point: MapPoint) => {
    if (!currentMapId) return;
    setPlacing(null);
    try {
      const marker = await atlasApi.createMarker(gmToken, currentMapId, {
        x: point.x,
        y: point.y,
        iconId: DEFAULT_ICON,
        iconColor: DEFAULT_COLOR
      });
      setMarkers((prev) => [...prev, marker]);
      setEditingPinId(marker.id);
      selectPin(marker.id);
      if (phone) setPhoneView("map");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not place the pin.");
    }
  };
  /** Moves the party pin here in one write, or makes one when the atlas has none. */
  const setPartyAt = async (mapIdForParty: string, point: MapPoint) => {
    setPlacing(null);
    setError(null);
    try {
      const { marker } = await partyApi.set(gmToken, { mapId: mapIdForParty, x: point.x, y: point.y });
      await pinFeed.reload();
      const where = mapName(marker.mapId) ?? "this map";
      toast(`The party is on ${where}.`, { tone: "success" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't set the party's position.");
    }
  };
  const moveMarker = async (markerId: string, point: MapPoint) => {
    setMarkers((prev) =>
      prev.map((marker) => (marker.id === markerId ? { ...marker, x: point.x, y: point.y } : marker))
    );
    try {
      await atlasApi.moveMarker(gmToken, markerId, point.x, point.y);
    } catch {
      void pinFeed.reload();
    }
  };
  const onMarkerUpdated = (marker: CodexMarker) =>
    setMarkers((prev) => prev.map((existing) => (existing.id === marker.id ? marker : existing)));
  // A pin's own writes, from its menu and its page's switches: today's routes, one call each.
  const pinWrite = async (run: () => Promise<CodexMarker>, failure: string) => {
    try {
      onMarkerUpdated(await run());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    }
  };
  const setPinParty = async (marker: CodexMarker, isParty: boolean) => {
    try {
      await atlasApi.setPartyMarker(gmToken, marker.id, isParty);
      // Making one pin the party's clears the pin that held it, so the map reads its pins again.
      await pinFeed.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't change the party's position.");
    }
  };
  const setPinRevealed = (marker: CodexMarker, revealed: boolean) =>
    void pinWrite(() => atlasApi.revealMarker(gmToken, marker.id, revealed), "Couldn't change who sees the pin.");
  const deletePin = async (marker: CodexMarker) => {
    const ok = await confirm({
      title: "Delete this pin?",
      body: "This cannot be undone.",
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) return;
    try {
      await atlasApi.deleteMarker(gmToken, marker.id);
      setMarkers((prev) => prev.filter((existing) => existing.id !== marker.id));
      if (pinId === marker.id) clearPin();
    } catch {
      setError("Couldn't delete the pin.");
    }
  };
  /** What a pin is, in a line: its linked page's kind, the map it opens. */
  const pinLine = (marker: CodexMarker) => {
    const page = pages.find((candidate) => candidate.id === marker.pageIds[0]);
    const opens = marker.subMapId ? mapName(marker.subMapId) : null;
    return [page ? entityDef(page.entityType).label : "Pin", opens ? `Opens ${opens}` : null]
      .filter(Boolean)
      .join(" · ");
  };
  /** A pin's menu (F3 atlas spec 2.2): its page, its map, Edit pin, the party, who sees it and Delete pin. */
  const pinActions = (marker: CodexMarker, withEdit: boolean): MapMenuItem[] => [
    ...(marker.pageIds[0]
      ? [
          {
            id: "page",
            label: "Open its page",
            iconId: "scroll",
            onSelect: () => onNavigate(pagePath(marker.pageIds[0]!))
          }
        ]
      : []),
    ...(marker.subMapId
      ? [{ id: "map", label: "Open the map inside", iconId: "compass", onSelect: () => enterMap(marker.subMapId!) }]
      : []),
    ...(withEdit
      ? [
          {
            id: "edit",
            label: "Edit pin",
            iconId: "pencil",
            onSelect: () => {
              setEditingPinId(marker.id);
              selectPin(marker.id);
            }
          }
        ]
      : []),
    {
      id: "party",
      label: "Set party position here",
      iconId: "flag",
      onSelect: () => void setPartyAt(marker.mapId, { x: marker.x, y: marker.y })
    },
    {
      id: "reveal",
      label: marker.revealedToPlayers ? "Hide from players" : "Show to players",
      iconId: marker.revealedToPlayers ? "eyeoff" : "eye",
      onSelect: () => setPinRevealed(marker, !marker.revealedToPlayers)
    },
    { id: "delete", label: "Delete pin", iconId: "trash", onSelect: () => void deletePin(marker) }
  ];
  const pinMenu = (id: string) => {
    const marker = markers.find((candidate) => candidate.id === id);
    if (!marker) return null;
    return { name: marker.label?.trim() || "Unlabelled pin", line: pinLine(marker), items: pinActions(marker, true) };
  };
  const createPageForMarker = (marker: CodexMarker) =>
    onQuickCreate({
      title: marker.label?.trim() || "",
      entityType: "location",
      onCreated: async (page) => {
        onMarkerUpdated(await atlasApi.updateMarker(gmToken, marker.id, { pageIds: [...marker.pageIds, page.id] }));
        await meta.reload();
      }
    });
  const revealLinkedPage = async (pageIdToReveal: string) => {
    try {
      await codexApi.revealPage(gmToken, pageIdToReveal, true);
      await meta.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reveal the page.");
    }
  };

  const spotMenu: readonly MapMenuItem[] = currentMapId
    ? [
        {
          id: "party",
          label: "Set party position here",
          iconId: "flag",
          onSelect: (point) => void setPartyAt(currentMapId, point)
        },
        { id: "pin", label: "Add a pin here", iconId: "pin", onSelect: (point) => void addPinAt(point) }
      ]
    : [];

  const partyButton = currentMap && (
    <Button
      variant="secondary"
      size="sm"
      aria-pressed={placing === "party"}
      onClick={() => setPlacing((now) => (now === "party" ? null : "party"))}
    >
      <CodexIcon iconId="flag" className="atlas-btnicon" />
      {placing === "party" ? "Choose the spot" : "Set party position"}
    </Button>
  );

  const map = currentMap ? (
    <AtlasMap
      token={gmToken}
      assetId={currentMap.assetId}
      ariaLabel={currentMap.name}
      pins={shownPins}
      initialFocus={partyFocus}
      selectedPinId={pinId}
      dimmedPinIds={dimmed}
      people={people}
      ground={ground}
      placing={placing}
      centerOnPinId={centerOnPinId}
      onCentered={() => setCenterOnPinId(null)}
      onPinClick={selectPin}
      onPinDragEnd={(markerId, point) => void moveMarker(markerId, point)}
      onPlace={(point) => void (placing === "party" ? setPartyAt(currentMap.id, point) : addPinAt(point))}
      menu={spotMenu}
      pinMenu={pinMenu}
      hint={
        placing === "party"
          ? "Tap or click the map where the party is. Esc cancels."
          : "Tap or click the map where the pin goes. Esc cancels."
      }
      overlay={phone ? partyButton : undefined}
    />
  ) : loading ? (
    <div className="atlas-loading">
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} variant="text" />
      ))}
    </div>
  ) : (
    <EmptyState className="atlas-firstmap" action={<Button onClick={() => setPicking(true)}>New map</Button>}>
      No map yet. An atlas is built from uploaded map images. Add a map, drop pins on it, and link each pin to a page or
      a map inside it.
    </EmptyState>
  );

  const pinSide = selected ? (
    editing ? (
      <PinEditor
        key={selected.id}
        gmToken={gmToken}
        marker={selected}
        pages={pages}
        maps={maps}
        scenes={scenes}
        actors={actors}
        activeEncounterId={activeEncounterId}
        autosave={autosave}
        onUpdated={onMarkerUpdated}
        onDeleted={(markerId) => {
          setMarkers((prev) => prev.filter((marker) => marker.id !== markerId));
          setEditing(false);
          clearPin();
        }}
        onPartyChanged={async () => {
          await pinFeed.reload();
        }}
        onOpenMap={enterMap}
        onOpenPage={(id) => onNavigate(pagePath(id))}
        onCreatePage={() => createPageForMarker(selected)}
        onRevealPage={(id) => void revealLinkedPage(id)}
        onRevealMap={() =>
          void mapWrite(() => atlasApi.revealMap(gmToken, selected.mapId, true), "Couldn't show the map.")
        }
        onActivateScene={onActivateScene}
        onDone={() => setEditing(false)}
      />
    ) : (
      <PinView
        gmToken={gmToken}
        pin={selected}
        pages={pages}
        mapName={mapName}
        scenes={scenes}
        activeEncounterId={activeEncounterId}
        onOpenPage={(id) => onNavigate(pagePath(id))}
        onOpenMap={enterMap}
        onEdit={() => setEditing(true)}
        onToggleParty={(on) => void setPinParty(selected, on)}
        onToggleReveal={(on) => setPinRevealed(selected, on)}
        more={pinActions(selected, false)}
        onActivateScene={onActivateScene}
        onOpenReplay={onOpenReplay}
        onClose={deselectPin}
      />
    )
  ) : null;

  const pinsBody = (
    <>
      {markers.length > 0 && (
        <PinFilter
          pins={markers}
          text={filter}
          tag={tagFilter}
          dimmed={dimmed}
          onChange={(next) =>
            onReplaceQuery((query) => {
              for (const [key, value] of Object.entries(next)) {
                if (value) query.set(key, value);
                else query.delete(key);
              }
            })
          }
        />
      )}
      <PinTable
        pins={markers}
        pageTitle={pageTitle}
        mapName={mapName}
        selectedPinId={pinId}
        dimmed={dimmed}
        gm
        onSelect={showPinOnMap}
        onAddPin={() => {
          setPlacing("pin");
          if (phone) setPhoneView("map");
        }}
      />
    </>
  );
  const detailsBody = currentMap && (
    <MapDetails
      map={currentMap}
      maps={maps}
      tagSuggestions={tagSuggestions}
      placingPin={placing === "pin"}
      onReveal={(revealed) =>
        void mapWrite(
          () => atlasApi.revealMap(gmToken, currentMap.id, revealed),
          "Couldn't change who can see this map."
        )
      }
      onRename={(name) =>
        void mapWrite(() => atlasApi.updateMap(gmToken, currentMap.id, { name }), "Couldn't rename the map.")
      }
      onRetype={(kind: CodexMapKind) =>
        void mapWrite(() => atlasApi.updateMap(gmToken, currentMap.id, { kind }), "Couldn't change the map kind.")
      }
      onReparent={(parentMapId) =>
        void mapWrite(async () => {
          const moved = await atlasApi.setMapParent(gmToken, currentMap.id, parentMapId);
          await meta.reload();
          return moved;
        }, "Couldn't move the map.")
      }
      onRetag={(tags) =>
        void mapWrite(() => atlasApi.updateMap(gmToken, currentMap.id, { tags }), "Couldn't save the tags.")
      }
      onAddPin={() => {
        setPlacing((now) => (now === "pin" ? null : "pin"));
        if (phone) setPhoneView("map");
      }}
      onAddMap={() => {
        setNestNew(true);
        setPicking(true);
      }}
      onDelete={() => void deleteMap()}
    />
  );

  const visibilityLine = currentMap && (
    <div className="atlas-visline">
      <AudienceChip value={currentMap.revealedToPlayers ? EVERYONE : HIDDEN} party={[]} />
      {(hiddenPinCount > 0 || hiddenMapCount > 0) && (
        <span className="nh-aud is-hidden">
          <IconEyeOff className="nh-aud-icon" />
          {[
            hiddenPinCount > 0 ? countOf(hiddenPinCount, "pin") : null,
            hiddenMapCount > 0 ? countOf(hiddenMapCount, "map") : null
          ]
            .filter(Boolean)
            .join(" and ")}{" "}
          hidden
        </span>
      )}
    </div>
  );

  const dialogs = (
    <>
      <MapPicker
        open={picking}
        token={gmToken}
        maps={maps}
        defaultParentId={nestNew ? currentMapId : null}
        onCreate={(input) => void createMapFrom(input)}
        onClose={() => setPicking(false)}
      />
      {promptDialog}
      {confirmDialog}
    </>
  );

  const pinsHead = currentMap && (
    <div className="atlas-pins-head">
      <h2 className="atlas-pins-title">{`Pins · ${markers.length}`}</h2>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setPlacing((now) => (now === "pin" ? null : "pin"));
          if (phone) setPhoneView("map");
        }}
      >
        <IconPlus /> Add a pin
      </Button>
      <Menu icon align="end" label={`More for ${currentMap.name}`} trigger={<IconMore />}>
        <MenuItem onClick={() => void renameMap()}>Rename…</MenuItem>
        <MenuItem onClick={() => (phone ? setPhoneView("details") : setTab("details"))}>
          Map details (kind, sits inside, tags)
        </MenuItem>
        <MenuItem
          onClick={() =>
            void mapWrite(
              () => atlasApi.revealMap(gmToken, currentMap.id, !currentMap.revealedToPlayers),
              "Couldn't change who can see this map."
            )
          }
        >
          {currentMap.revealedToPlayers ? "Hide from players" : "Show to players"}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setNestNew(true);
            setPicking(true);
          }}
        >
          Add a map inside
        </MenuItem>
        <MenuItem tone="danger" onClick={() => void deleteMap()}>
          Delete map
        </MenuItem>
      </Menu>
    </div>
  );
  const pinsHint = markers.length > 0 && (
    <p className="atlas-hint">Right-click a pin to open it, or the map to add a pin there.</p>
  );
  // Where you are, the map's line and the party's button, on glass over the map (F3 atlas spec 2.1).
  const mapGlass = currentMap && (
    <div className="atlas-glass is-top">
      <AtlasCrumbs chain={chain} onEnter={enterMap} />
      <span className="atlas-mapline">
        {[
          mapKindLine(currentMap.kind, parentName),
          countOf(markers.length, "pin"),
          hiddenPinCount > 0 ? `${hiddenPinCount} hidden` : null
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
      {partyButton}
    </div>
  );

  if (phone)
    return (
      <div className="atlas is-phone">
        <CodexPhoneBar
          title="Codex"
          back={
            chain.length > 1
              ? { label: chain[chain.length - 2].name, onClick: () => enterMap(chain[chain.length - 2].id) }
              : undefined
          }
          actions={<LayersMenu layers={layers} onToggle={toggleLayer} gm />}
        />
        {/* The maps as a row of chips, the open one lit (F3 atlas spec 2.1). */}
        <div className="nh-filterchips atlas-mapchips" role="group" aria-label="Maps">
          {treeOrder(maps).map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={cx("nh-filterchip", "interactive", entry.id === currentMapId && "is-on")}
              aria-pressed={entry.id === currentMapId}
              onClick={() => enterMap(entry.id)}
            >
              {entry.name}
            </button>
          ))}
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="atlas-phonemap">
          {map}
          {pinSide && <div className={`atlas-sheet${editing ? " is-tall" : ""} scroll-y`}>{pinSide}</div>}
          {!pinSide && currentMap && (
            <Button className="atlas-pinsbutton" onClick={() => setPhoneView("pins")}>
              {`Pins · ${markers.length}`}
            </Button>
          )}
        </div>
        {/* The pins rise from the foot as a sheet; the map's details take it from its More. */}
        {phoneView !== "map" && currentMap && (
          <Modal
            open
            size="md"
            align="bottom"
            title={phoneView === "details" ? currentMap.name : `Pins · ${markers.length}`}
            onClose={() => setPhoneView("map")}
          >
            {phoneView === "details" ? (
              <>
                {visibilityLine}
                {detailsBody}
              </>
            ) : (
              <>
                {pinsHead}
                {pinsBody}
              </>
            )}
          </Modal>
        )}
        {dialogs}
      </div>
    );

  return (
    <div className="atlas atlas-cols">
      <nav className="atlas-tree scroll-y" aria-label="Maps and layers">
        <MapTree maps={maps} currentMapId={currentMapId} pinCount={markers.length} gm onEnter={enterMap} />
        <LayerRows layers={layers} onToggle={toggleLayer} gm />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setNestNew(false);
            setPicking(true);
          }}
        >
          <IconPlus /> Add a map
        </Button>
      </nav>
      <div className="atlas-stage">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="atlas-mapframe">
          {map}
          {mapGlass}
        </div>
      </div>
      <aside className="atlas-panel" aria-label={currentMap ? currentMap.name : "Atlas"}>
        {pinSide ? (
          <div className="atlas-panel-body scroll-y">
            <button type="button" className="atlas-back" onClick={deselectPin}>
              <IconChevronLeft /> All pins
            </button>
            {pinSide}
          </div>
        ) : tab === "details" && currentMap ? (
          <div className="atlas-panel-body scroll-y">
            <button type="button" className="atlas-back" onClick={() => setTab("pins")}>
              <IconChevronLeft /> All pins
            </button>
            <h2 className="atlas-panel-title">{currentMap.name}</h2>
            {visibilityLine}
            {detailsBody}
          </div>
        ) : (
          currentMap && (
            <div className="atlas-panel-body scroll-y">
              {pinsHead}
              {pinsBody}
              {pinsHint}
            </div>
          )
        )}
      </aside>
      {dialogs}
    </div>
  );
}

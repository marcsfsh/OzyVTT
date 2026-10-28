import { useEffect, useMemo, useRef } from "react";
import type { GmView } from "@vtt/domain";
import { Button, Combobox, IconButton, IconMap, IconPlus, IconScene, Kbd, Tabs, cx } from "@vtt/ui";
import { currentDevice, shortcutLabel } from "../lib/shortcut";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useMapLibrary, type MapAsset } from "../maps/map-catalog";
import { navigate, useRoute } from "../router";
import { PrepBarSlot } from "../shell/AppBar";
import { ScenesContext, useSceneLinks, type ScenesContextValue } from "./context";
import { SCENES_PATHS, pathForMap, pathForScene, scenesViewOf, sectionOf, type ScenesSection } from "./routes";
import { SceneList } from "./SceneList";
import { SceneDocument } from "./SceneDocument";
import { SceneEditor } from "./SceneEditor";
import { MapList } from "../maps/MapList";
import { MapDocument } from "../maps/MapDocument";
import { MapEditor } from "../maps/MapEditor";
import "./scenes.css";

/** The front page's two views, in the order they are drawn. */
const LIST_TABS: ReadonlyArray<{ id: ScenesSection; label: string; path: string }> = [
  { id: "maps", label: "Maps", path: SCENES_PATHS.maps },
  { id: "scenes", label: "Encounters", path: SCENES_PATHS.list }
];

/**
 * Prep's front page above its lists: New map and New scene side by side, then the Maps and Scenes views. The lists
 * under it keep their own filters and sort.
 */
function ListHead({ section }: Readonly<{ section: ScenesSection }>) {
  return (
    <div className="sc-front-head">
      <div className="sc-front-new">
        <Button variant="secondary" onClick={() => void navigate(SCENES_PATHS.newMap)}>
          <IconMap /> New map
        </Button>
        <Button variant="primary" onClick={() => void navigate(SCENES_PATHS.newScene)}>
          <IconScene /> New encounter
        </Button>
      </div>
      <Tabs
        ariaLabel="Maps and encounters"
        className="sc-front-tabs"
        activeId={section}
        onChange={(id) => void navigate(LIST_TABS.find((tab) => tab.id === id)!.path)}
        tabs={LIST_TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
      />
    </div>
  );
}

const PHONE_QUERY = "(max-width: 760px)";
const NARROW_QUERY = "(max-width: 979px)";

/** Finds a scene or a map by name and opens it. Ctrl K (Command K on a Mac) puts the cursor in it. */
function FindBox({ state, maps }: Readonly<{ state: GmView; maps: readonly MapAsset[] | null }>) {
  const box = useRef<HTMLDivElement>(null);
  const shortcut = useMemo(() => shortcutLabel("K", currentDevice()), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        box.current?.querySelector("input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const options = [
    ...state.combat.encounters.map((scene) => ({
      id: `scene:${scene.id}`,
      label: scene.name,
      icon: <IconScene />,
      meta: scene.id === state.combat.activeEncounterId ? "Encounter · Live" : "Encounter"
    })),
    ...(maps ?? []).map((map) => ({ id: `map:${map.id}`, label: map.name, icon: <IconMap />, meta: "Map" }))
  ];
  return (
    <div className="sc-find" ref={box}>
      <Combobox
        options={options}
        value={null}
        placeholder="Find an encounter or a map"
        ariaLabel="Find an encounter or a map"
        onChange={(id) => {
          if (!id) return;
          const [kind, recordId] = id.split(":");
          navigate(kind === "scene" ? pathForScene(recordId!) : pathForMap(recordId!));
        }}
      />
      {shortcut && <Kbd className="sc-find-key">{shortcut}</Kbd>}
    </div>
  );
}

/**
 * Prep's Scenes and Maps pages: the view the address names under Prep's section bar, whose right end holds the
 * find box (and a secondary New while a record is open). The lists open under New map, New scene and their tabs. A scene or map that is open takes the pane
 * as one document; on a phone its workbench fills the pane and Back returns to the list.
 */
export function ScenesShell({
  state,
  token,
  onLibraryChanged,
  onOpenMap
}: Readonly<{
  state: GmView;
  token: string;
  /** The library changed here, so the table's and the shared screen's copies are read again. */
  onLibraryChanged: () => void;
  onOpenMap: (map: MapAsset) => void;
}>) {
  const route = useRoute();
  const view = scenesViewOf(route.segments, route.query) ?? { view: "scenes" as const };
  const section = sectionOf(view);
  const phone = useMediaQuery(PHONE_QUERY);
  const narrow = useMediaQuery(NARROW_QUERY);
  const library = useMapLibrary(token);
  const sceneLinks = useSceneLinks(token);
  const { reload } = library;
  const context = useMemo<ScenesContextValue>(
    () => ({
      state,
      token,
      maps: library.maps,
      reloadMaps: async () => {
        const maps = await reload();
        onLibraryChanged();
        return maps;
      },
      links: sceneLinks.links,
      reloadLinks: sceneLinks.reload,
      phone,
      narrow,
      go: (path) => void navigate(path),
      onOpenMap
    }),
    [
      state,
      token,
      library.maps,
      reload,
      onLibraryChanged,
      sceneLinks.links,
      sceneLinks.reload,
      phone,
      narrow,
      onOpenMap
    ]
  );

  // The front page has its own New map and New scene; an open record keeps a secondary New in the bar.
  const listing = view.view === "scenes" || view.view === "maps";
  const primary =
    section === "maps"
      ? { label: "New map", path: SCENES_PATHS.newMap }
      : { label: "New encounter", path: SCENES_PATHS.newScene };

  const content = (() => {
    switch (view.view) {
      case "scenes":
        return (
          <>
            <ListHead section="scenes" />
            <SceneList />
          </>
        );
      case "scene":
        return view.step === null && view.encounterId ? (
          <SceneDocument key={view.encounterId} encounterId={view.encounterId} />
        ) : (
          <SceneEditor key={view.encounterId ?? "new"} encounterId={view.encounterId} step={view.step ?? "map"} />
        );
      case "maps":
        return (
          <>
            <ListHead section="maps" />
            <MapList />
          </>
        );
      case "map":
        return view.step === null && view.mapId ? (
          <MapDocument key={view.mapId} mapId={view.mapId} />
        ) : (
          <MapEditor key={view.mapId ?? "new"} mapId={view.mapId} step={view.step ?? "upload"} />
        );
    }
  })();

  return (
    <ScenesContext.Provider value={context}>
      <div className={cx("sc-shell anim-view", phone ? "is-phone" : "is-laptop")}>
        {/* Prep's section bar names the page; its right end holds this page's views, the find box and the primary. */}
        <PrepBarSlot>
          {!phone && <FindBox state={state} maps={library.maps} />}
          {!listing &&
            (phone ? (
              <IconButton label={primary.label} onClick={() => void navigate(primary.path)}>
                <IconPlus />
              </IconButton>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => void navigate(primary.path)}>
                <IconPlus /> {primary.label}
              </Button>
            ))}
        </PrepBarSlot>
        <div className="sc-content">{content}</div>
      </div>
    </ScenesContext.Provider>
  );
}

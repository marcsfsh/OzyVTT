import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { GmView } from "@vtt/domain";
import {
  Button,
  Combobox,
  IconButton,
  IconHome,
  IconMap,
  IconPlus,
  IconScene,
  Kbd,
  SegmentedControl,
  cx
} from "@vtt/ui";
import { currentDevice, shortcutLabel } from "../lib/shortcut";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useMapLibrary, type MapAsset } from "../maps/map-catalog";
import { navigate, useRoute } from "../router";
import { PrepBarSlot } from "../shell/AppBar";
import { ScenesContext, useSceneLinks, type ScenesContextValue } from "./context";
import { SCENES_PATHS, pathForMap, pathForScene, scenesViewOf, sectionOf, type ScenesSection } from "./routes";
import { ScenesOverview } from "./ScenesOverview";
import { SceneList } from "./SceneList";
import { SceneDocument } from "./SceneDocument";
import { SceneEditor } from "./SceneEditor";
import { MapList } from "../maps/MapList";
import { MapDocument } from "../maps/MapDocument";
import { MapEditor } from "../maps/MapEditor";
import "./scenes.css";

const SECTIONS: ReadonlyArray<{ id: ScenesSection; label: string; path: string; icon: ReactNode }> = [
  { id: "overview", label: "Overview", path: SCENES_PATHS.overview, icon: <IconHome /> },
  { id: "scenes", label: "Scenes", path: SCENES_PATHS.list, icon: <IconScene /> },
  { id: "maps", label: "Maps", path: SCENES_PATHS.maps, icon: <IconMap /> }
];

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
    ...state.combat.scenes.map((scene) => ({
      id: `scene:${scene.id}`,
      label: scene.name,
      icon: <IconScene />,
      meta: scene.id === state.combat.activeSceneId ? "Scene · Live" : "Scene"
    })),
    ...(maps ?? []).map((map) => ({ id: `map:${map.id}`, label: map.name, icon: <IconMap />, meta: "Map" }))
  ];
  return (
    <div className="sc-find" ref={box}>
      <Combobox
        options={options}
        value={null}
        placeholder="Find a scene or a map"
        ariaLabel="Find a scene or a map"
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
 * Overview and All scenes switch, the find box and the page's one primary. A scene or map that is open takes the pane
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
  const view = scenesViewOf(route.segments, route.query) ?? { view: "overview" as const };
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

  const primary =
    section === "maps"
      ? { label: "Add a map", path: SCENES_PATHS.newMap }
      : { label: "New scene", path: SCENES_PATHS.newScene };
  // A record's own primary is in its footer, so the bar's New steps down to a secondary while one is open.
  const barPrimary = view.view === "overview" || view.view === "scenes" || view.view === "maps";

  const content = (() => {
    switch (view.view) {
      case "overview":
        return <ScenesOverview />;
      case "scenes":
        return <SceneList />;
      case "scene":
        return view.step === null && view.sceneId ? (
          <SceneDocument key={view.sceneId} sceneId={view.sceneId} />
        ) : (
          <SceneEditor key={view.sceneId ?? "new"} sceneId={view.sceneId} step={view.step ?? "map"} />
        );
      case "maps":
        return <MapList />;
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
          {section !== "maps" && (
            <SegmentedControl
              ariaLabel="Scenes views"
              size="sm"
              value={section}
              onChange={(value) => void navigate(value === "overview" ? SCENES_PATHS.overview : SCENES_PATHS.list)}
              options={SECTIONS.filter((item) => item.id !== "maps").map((item) => ({
                value: item.id,
                label: item.id === "scenes" ? "All scenes" : item.label
              }))}
            />
          )}
          {!phone && <FindBox state={state} maps={library.maps} />}
          {phone ? (
            <IconButton label={primary.label} onClick={() => void navigate(primary.path)}>
              <IconPlus />
            </IconButton>
          ) : (
            <Button
              variant={barPrimary ? "primary" : "secondary"}
              size="sm"
              onClick={() => void navigate(primary.path)}
            >
              <IconPlus /> {primary.label}
            </Button>
          )}
        </PrepBarSlot>
        <div className="sc-content">{content}</div>
      </div>
    </ScenesContext.Provider>
  );
}

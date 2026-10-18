import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { GmView } from "@vtt/domain";
import { Button, Combobox, IconHome, IconMap, IconPlus, IconScene, Kbd, cx } from "@vtt/ui";
import { currentDevice, shortcutLabel } from "../lib/shortcut";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useMapLibrary, type MapAsset } from "../maps/map-catalog";
import { navigate, useRoute } from "../router";
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
 * The Scenes tab: a section bar (Overview, Scenes, Maps, the find box and the view's one primary) over the view the
 * address names, and on a phone the same sections in a tab bar under the thumb. A scene or map that is open takes the
 * pane as one document; on a phone its workbench fills the pane and Back returns to the list.
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

  // An open scene or map is a document of its own: the bottom tabs give way to its workbench on a phone.
  const recordOpen =
    (view.view === "scene" && view.sceneId !== null && view.step === null) ||
    (view.view === "map" && view.mapId !== null && view.step === null);
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
        {!phone && (
          <div className="sc-bar">
            <h2 className="sc-bar-title">Scenes</h2>
            <nav className="sc-bar-sections nh-tabs nh-tabs--horizontal" aria-label="Scenes sections">
              {SECTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cx("nh-tab sc-bar-tab", section === item.id && "nh-tab--active")}
                  aria-current={section === item.id ? "page" : undefined}
                  onClick={() => void navigate(item.path)}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </nav>
            <span className="sc-grow" />
            <FindBox state={state} maps={library.maps} />
            <Button variant={barPrimary ? "primary" : "secondary"} onClick={() => void navigate(primary.path)}>
              <IconPlus /> {primary.label}
            </Button>
          </div>
        )}
        <div className="sc-content">{content}</div>
        {phone && !recordOpen && (
          <nav className="sc-tabbar" aria-label="Scenes sections">
            {[
              ...SECTIONS.slice(0, 2),
              { id: "new" as const, label: "New", path: SCENES_PATHS.newScene, icon: <IconPlus /> },
              SECTIONS[2]!
            ].map((item) => {
              const on =
                item.id === "new"
                  ? view.view === "scene" && view.sceneId === null
                  : section === item.id && !(view.view === "scene" && view.sceneId === null);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cx("sc-tabbar-tab", on && "is-on")}
                  aria-current={on ? "page" : undefined}
                  onClick={() => void navigate(item.path)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </ScenesContext.Provider>
  );
}

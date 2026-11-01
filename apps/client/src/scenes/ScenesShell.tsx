import { useMemo, useRef } from "react";
import type { GmView } from "@vtt/domain";
import { Button, Combobox, IconButton, IconMap, IconPlus, IconScene, Kbd, cx } from "@vtt/ui";
import { currentDevice, shortcutLabel } from "../lib/shortcut";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useMapLibrary, type MapAsset } from "../maps/map-catalog";
import { navigate, useRoute } from "../router";
import { PrepBarSlot } from "../shell/AppBar";
import { ScenesContext, useSceneLinks, type ScenesContextValue } from "./context";
import { SCENES_PATHS, pathForMap, pathForScene, scenesViewOf, sectionOf } from "./routes";
import { SceneList } from "./SceneList";
import { SceneDocument } from "./SceneDocument";
import { SceneEditor } from "./SceneEditor";
import { MapList } from "../maps/MapList";
import { MapDocument } from "../maps/MapDocument";
import { MapEditor } from "../maps/MapEditor";
import "./scenes.css";
import { BarPrimary } from "../shell/SectionBar";

const PHONE_QUERY = "(max-width: 760px)";
const NARROW_QUERY = "(max-width: 979px)";

/** Finds a scene or a map by name and opens it. Ctrl K (Command K on a Mac) puts the cursor in it. */
function FindBox({ state, maps }: Readonly<{ state: GmView; maps: readonly MapAsset[] | null }>) {
  const box = useRef<HTMLDivElement>(null);
  const shortcut = useMemo(() => shortcutLabel("K", currentDevice()), []);
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
 * Prep's Encounters and Maps pages: the view the address names under Prep's section bar, whose right end holds the
 * find box and New encounter, the Cup on the lists and a Base line control on a record. An encounter or map that is
 * open takes the pane as one document; on a phone its workbench fills the pane and Back returns to the list.
 */
export function ScenesShell({
  state,
  token,
  onLibraryChanged,
  onOpenMap
}: Readonly<{
  state: GmView;
  token: string;
  /** The library changed here, so the table's and the table screen's copies are read again. */
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
        return <SceneList />;
      case "scene":
        return view.step === null && view.encounterId ? (
          <SceneDocument key={view.encounterId} encounterId={view.encounterId} />
        ) : (
          <SceneEditor key={view.encounterId ?? "new"} encounterId={view.encounterId} step={view.step ?? "map"} />
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
          {!phone && <FindBox state={state} maps={library.maps} />}
          {/* One Cup in Prep's bar (Prep rule 3.1): New encounter on the lists, stepping down on a record. Maps and
              Encounters are pages in the bar (rule 3.6); New map sits in the shelf's toolbar, and in the bar on Maps. */}
          {phone ? (
            <>
              {section === "maps" && (
                <IconButton label="New map" onClick={() => void navigate(SCENES_PATHS.newMap)}>
                  <IconMap />
                </IconButton>
              )}
              <IconButton label="New encounter" onClick={() => void navigate(SCENES_PATHS.newScene)}>
                <IconPlus />
              </IconButton>
            </>
          ) : (
            <>
              {view.view === "maps" && (
                <Button variant="secondary" size="sm" onClick={() => void navigate(SCENES_PATHS.newMap)}>
                  <IconPlus /> New map
                </Button>
              )}
              {listing ? (
                <BarPrimary label="New encounter" onClick={() => void navigate(SCENES_PATHS.newScene)} />
              ) : (
                <Button variant="secondary" size="sm" onClick={() => void navigate(primary.path)}>
                  <IconPlus /> {primary.label}
                </Button>
              )}
            </>
          )}
        </PrepBarSlot>
        <div className="sc-content">{content}</div>
      </div>
    </ScenesContext.Provider>
  );
}

import { useEffect, useState } from "react";
import { rosterActors } from "@vtt/domain";
import {
  Button,
  Crumb,
  Drawer,
  IconEye,
  IconButton,
  IconCopy,
  IconMap,
  IconMore,
  IconPencil,
  IconPlay,
  IconTrash,
  Menu,
  MenuItem,
  TitleLine,
  cx
} from "@vtt/ui";
import { EncounterMap } from "../scene/EncounterMap";
import { armPlacement, openMapToolGroup } from "../scene/tableGeometry";
import { DockToolsTarget } from "../table/dockTools";
import { TablePanel, useRememberedTab } from "../table/TablePanel";
import { pathForGmTab } from "../router";
import { useScenes } from "./context";
import { arrivingScenes, pathForMap, pathForScene, SCENES_PATHS, type SceneStep } from "./routes";
import { useSceneActions } from "./sceneActions";
import { factsOf, modifiedAt, readinessOf, tokensLine, whenLabel, type SceneFacts } from "./sceneFacts";
import { StateChip } from "./pieces";
import { stateTagOf } from "./stateTag";
import { FightSettings, ReadyLines, WhoTheyFace } from "./SceneEncounterTab";
import { ScenePreview, type SeeAs } from "./ScenePreview";
import { SceneTokens, SceneHistory, SceneLight, SceneMapFacts, SceneSound } from "./SceneQuestions";
import "./scene-page.css";
import "../table/table-header.css";

/** The panel's tab an old step's link opens (`?step=` and the ready lines' Go to it). */
export function tabForStep(step: SceneStep | null | undefined): EncounterTab {
  return step === "map" || step === "light" || step === "sound" ? "light" : step === "tokens" ? "who" : "who";
}
export type EncounterTab = "who" | "rules" | "light";
const TAB_IDS: readonly EncounterTab[] = ["who", "rules", "light"];
/** A phone's Switch adds the map as its first view. */
const PHONE_TAB_IDS: readonly string[] = ["map", ...TAB_IDS];
const TAB_KEY = "vtt.scene-tab";
/** Before this page had its three tabs, the remembered tab was Combat, Setup or Tokens. */
const OLD_TAB: Readonly<Record<string, EncounterTab>> = { encounter: "rules", scene: "light", tokens: "who" };

/**
 * An encounter's page is the Workbench (Prep frame 2.2, ADR-0053): the record's title row, then the table's own frame
 * (C 2.1): the tools as a dock at the left, the map with its Tray chip and controls, and a 380px panel with Who is in
 * it, Rules, and Light and sound, its foot holding what is ready over Make live. See as, in the More menu, switches the
 * map in place to what the table screen or one character's player would receive.
 */
export function SceneDocument({
  encounterId,
  initialTab
}: Readonly<{ encounterId: string; initialTab?: EncounterTab }>) {
  const { state, token, maps, links, go, narrow, phone } = useScenes();
  const scene = state.combat.encounters.find((candidate) => candidate.id === encounterId) ?? null;
  const [seeAs, setSeeAs] = useState<SeeAs>("gm");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dockTools, setDockTools] = useState<HTMLElement | null>(null);
  const actions = useSceneActions(state.combat.encounters, {
    combatActive: state.combat.active,
    onDeleted: () => go(SCENES_PATHS.list),
    onDuplicated: (copyId) => go(pathForScene(copyId))
  });
  useState(() => {
    // Once, before the tab is read: an old remembered tab becomes the new one that holds what it held.
    try {
      const old = localStorage.getItem(TAB_KEY);
      if (old && OLD_TAB[old]) localStorage.setItem(TAB_KEY, OLD_TAB[old]);
      if (initialTab) localStorage.setItem(TAB_KEY, initialTab);
    } catch {
      /* private mode: the page opens on Who is in it */
    }
    return null;
  });
  const [tab, setTab] = useRememberedTab(TAB_KEY, narrow ? PHONE_TAB_IDS : TAB_IDS, initialTab ?? "who", encounterId);
  useEffect(() => {
    if (scene) arrivingScenes.delete(scene.id);
  }, [scene]);
  if (!scene)
    return arrivingScenes.has(encounterId) ? (
      <p className="sc-missing" role="status">
        Opening the encounter…
      </p>
    ) : (
      <div className="sc-missing">
        <p role="status">That encounter no longer exists. It may have been deleted.</p>
        <Button onClick={() => go(SCENES_PATHS.list)}>All encounters</Button>
      </div>
    );
  const facts: SceneFacts = factsOf(state, scene, maps);
  const party = rosterActors(state.actors).filter((actor) => actor.kind === "player-character" && !actor.archived);
  const tag = stateTagOf(facts, readinessOf(facts, maps));
  const link = links.get(scene.id);
  const codexLine =
    link && link.sessions.length > 0
      ? `In the Codex: ${link.sessions.map((session) => (session.sessionNumber === null ? "a session" : `Session ${session.sessionNumber}`)).join(", ")}`
      : null;

  const header = (
    <header className={cx("sc-rec-head", seeAs !== "gm" && "is-preview")} aria-label="The encounter">
      <div className="sc-rec-main">
        {/* The crumb on the title's line (theme rule 14): back to the encounters. */}
        <TitleLine crumb={<Crumb label="Encounters" onClick={() => go(SCENES_PATHS.list)} />}>
          <h2 className="sc-scene-title">{scene.name}</h2>
          <StateChip tag={tag} />
          <IconButton label={`Rename ${scene.name}`} size="sm" onClick={() => void actions.rename(scene)}>
            <IconPencil />
          </IconButton>
        </TitleLine>
        {!phone && (
          <p className="sc-rec-line">
            {[
              facts.map?.name ?? "Map not in the library",
              tokensLine(facts),
              `Changed ${whenLabel(modifiedAt(scene)).toLowerCase()}`,
              codexLine
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>
      <div className="sc-rec-actions">
        {!phone && (
          <>
            <Button size="sm" onClick={() => actions.duplicate(scene)}>
              <IconCopy /> Duplicate
            </Button>
            <Button size="sm" onClick={() => go(pathForMap(scene.mapAssetId))}>
              <IconMap /> Edit the map
            </Button>
          </>
        )}
        <Menu trigger={<IconMore />} icon label={`${scene.name} actions`} align="end">
          <MenuItem icon={<IconPencil />} onClick={() => void actions.rename(scene)}>
            Rename
          </MenuItem>
          {phone && (
            <MenuItem icon={<IconCopy />} onClick={() => actions.duplicate(scene)}>
              Duplicate
            </MenuItem>
          )}
          {seeAs !== "gm" && (
            <MenuItem icon={<IconEye />} onClick={() => setSeeAs("gm")}>
              See as you, the GM
            </MenuItem>
          )}
          <MenuItem icon={<IconEye />} onClick={() => setSeeAs("screen")}>
            See as the table screen
          </MenuItem>
          {party.map((actor) => (
            <MenuItem
              key={actor.id}
              icon={<IconEye />}
              onClick={() => setSeeAs({ actorId: actor.id, name: actor.name })}
            >
              See as {actor.name}
            </MenuItem>
          ))}
          <MenuItem onClick={() => setHistoryOpen(true)}>History</MenuItem>
          {!facts.live && (
            <MenuItem icon={<IconTrash />} tone="danger" onClick={() => void actions.remove(scene)}>
              Delete encounter
            </MenuItem>
          )}
        </Menu>
      </div>
    </header>
  );

  const map =
    seeAs === "gm" ? (
      <EncounterMap
        assetId={scene.mapAssetId}
        token={token}
        altText={facts.live ? scene.name : `Preparing ${scene.name}`}
        role="gm"
        actors={state.actors}
        tokens={facts.combat.tokens}
        annotations={facts.live ? state.combat.annotations : []}
        revision={state.revision}
        activeActorId={facts.live ? state.combat.turnActorId : null}
        fog={facts.combat.fog}
        terrain={facts.combat.terrain}
        vision={facts.combat.vision}
        healthDisplay={facts.combat.healthDisplay}
        state={state}
        {...(facts.live ? {} : { moveSceneId: scene.id })}
      />
    ) : (
      <ScenePreview facts={facts} seeAs={seeAs} token={token} revision={state.revision} />
    );
  const previewBanner =
    seeAs === "gm" ? null : (
      <div className="map-seeing-as sc-preview-banner" role="status">
        <span>
          {seeAs === "screen"
            ? `What the table screen shows${facts.live ? "" : " once this encounter is live"}.`
            : `What ${seeAs.name}'s player sees${facts.live ? "" : " once this encounter is live"}.`}
        </span>
        <Button variant="secondary" size="sm" onClick={() => setSeeAs("gm")}>
          Back to your view
        </Button>
      </div>
    );
  const mapView = (
    <>
      {previewBanner}
      <DockToolsTarget.Provider value={narrow ? null : dockTools}>{map}</DockToolsTarget.Provider>
    </>
  );

  const whoTab = (
    <div className="sc-meta">
      <SceneTokens
        facts={facts}
        onPlace={(actorId) => {
          // A preview shows no workbench map, so it goes back to the GM's own view first.
          setSeeAs("gm");
          if (narrow) setTab("map");
          window.setTimeout(() => armPlacement(actorId), 0);
        }}
      />
      <WhoTheyFace facts={facts} />
    </div>
  );
  const rulesTab = (
    <div className="sc-meta">
      {facts.scene.replayOf ? (
        <p className="sc-hint">A replay keeps the rules of the encounter it replays.</p>
      ) : (
        <FightSettings facts={facts} />
      )}
    </div>
  );
  const lightTab = (
    <div className="sc-meta">
      <section className="sc-meta-section" aria-label="Map">
        <h3 className="sc-encounter-label">Map</h3>
        <SceneMapFacts facts={facts} back={pathForScene(facts.scene.id)} />
      </section>
      <section className="sc-meta-section" aria-label="Walls and light">
        <h3 className="sc-encounter-label">Walls and light</h3>
        <SceneLight
          facts={facts}
          onOpenTools={(group) => {
            setSeeAs("gm");
            if (narrow) setTab("map");
            openMapToolGroup(group);
          }}
        />
      </section>
      <section className="sc-meta-section" aria-label="Sound">
        <h3 className="sc-encounter-label">Sound</h3>
        <SceneSound facts={facts} />
      </section>
    </div>
  );

  // Making this encounter live parks the one that is live now, which the line under Make live says.
  const liveNow = state.combat.encounters.find((candidate) => candidate.id === state.combat.activeEncounterId) ?? null;
  const footer = (
    <div className="sc-make-live">
      <ReadyLines facts={facts} onGo={(step) => setTab(tabForStep(step))} />
      {facts.live ? (
        <Button variant="primary" block onClick={() => go(pathForGmTab("table"))}>
          <IconPlay /> Go to the table
        </Button>
      ) : (
        <>
          <Button variant="primary" block onClick={() => void actions.makeLive(scene)}>
            Make live
          </Button>
          {liveNow && <p className="sc-make-live-note">{liveNow.name} stops being live.</p>}
        </>
      )}
    </div>
  );

  const tabs = [
    ...(narrow
      ? [
          {
            id: "map",
            label: "Map",
            content: <div className="table-bench-map is-view">{mapView}</div>,
            scrolls: false,
            keep: true
          }
        ]
      : []),
    { id: "who", label: narrow ? "Who" : `Who is in it · ${facts.tokens}`, content: whoTab },
    { id: "rules", label: "Rules", content: rulesTab },
    { id: "light", label: narrow ? "Light" : "Light and sound", content: lightTab }
  ];

  return (
    <div className="sc-scene-page">
      {header}
      <div className={cx("table-bench gm sc-scene-bench", !facts.live && "is-staging")}>
        {!narrow && (
          <aside className="table-dock sc-scene-dock" aria-label="Tools">
            <div className="table-dock-head">
              <span className="sc-dock-state">{facts.live ? "Live at the table" : "Preparing"}</span>
            </div>
            <div className="table-dock-tools" ref={setDockTools} />
          </aside>
        )}
        <div className="table-bench-split">
          {!narrow && <div className="table-bench-map">{mapView}</div>}
          <div className="table-bench-panel">
            <TablePanel
              label={`About ${scene.name}`}
              tabs={tabs}
              active={tab}
              onActive={setTab}
              footer={footer}
              phone={narrow}
            />
          </div>
        </div>
      </div>
      <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)} title="History">
        <SceneHistory facts={facts} />
      </Drawer>
      {actions.dialogs}
    </div>
  );
}

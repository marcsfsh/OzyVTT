import { useEffect, useId, useState, type ReactNode } from "react";
import { rosterActors } from "@vtt/domain";
import { Button, Field, IconChevronLeft, IconList, IconMap, IconPlay, Input, cx, useToast } from "@vtt/ui";
import { command } from "../lib/command";
import { MapPicker, type PickerMap } from "../maps/MapPicker";
import { EncounterMap } from "../scene/EncounterMap";
import { armPlacement, openMapToolGroup } from "../scene/tableGeometry";
import { navigate, pathForGmTab, useRoute } from "../router";
import { useScenes } from "./context";
import { MapThumb, SceneListFlyout } from "./pieces";
import { arrivingScenes, pathForMap, pathForScene, SCENE_STEPS, SCENES_PATHS, type SceneStep } from "./routes";
import { useSceneActions } from "./sceneActions";
import {
  count,
  tokensLine,
  factsOf,
  gridLine,
  gridStateOf,
  drawnLine,
  lightLine,
  needsOf,
  type SceneFacts
} from "./sceneFacts";
import { SceneTokens, SceneLight, SceneMapFacts, SceneSound } from "./SceneQuestions";
import { useAutoArrange } from "../settings/preferences";
import { EditorFrame } from "./EditorFrame";
import "./scene-page.css";

const STEP_LABEL: Readonly<Record<SceneStep, string>> = {
  map: "Map",
  tokens: "Tokens and monsters",
  light: "Walls and light",
  sound: "Sound",
  review: "Review and make live"
};
const STEP_SHORT: Readonly<Record<SceneStep, string>> = {
  map: "Map",
  tokens: "Tokens",
  light: "Light",
  sound: "Sound",
  review: "Review"
};
const STEP_ASK: Readonly<Record<SceneStep, string>> = {
  map: "Pick the battle map the scene is played on.",
  tokens: "Put the party and the monsters on the map. Each one waits in the tray until you place it.",
  light: "Say whether sight matters here, and how bright it is. Walls and lights are drawn on the map with its tools.",
  sound: "Save the music and ambience that start when the scene goes live.",
  review: "Check what is left, then make the scene live or keep it for later."
};

/** Which steps are answered: a step reads as unfinished while the scene still needs something it answers. */
function stepStates(facts: SceneFacts | null): Readonly<Record<SceneStep, "done" | "incomplete">> {
  const needs = facts ? needsOf(facts) : [];
  const open = (step: SceneStep) => needs.some((need) => need.step === step);
  return {
    map: facts && !open("map") ? "done" : "incomplete",
    tokens: facts && !open("tokens") ? "done" : "incomplete",
    light: facts && !open("light") ? "done" : "incomplete",
    sound: "done",
    review: facts && needs.length === 0 ? "done" : "incomplete"
  };
}

/** The first step: the map from the library (or uploaded here) and the scene's name. Continue makes the scene. */
function NewSceneMap({
  picked,
  onPick,
  name,
  onName
}: Readonly<{
  picked: PickerMap | null;
  onPick: (map: PickerMap) => void;
  name: string;
  onName: (name: string) => void;
}>) {
  const { token, reloadMaps, go } = useScenes();
  const nameId = useId();
  return (
    <div className="sc-q">
      <Field label="Scene name" htmlFor={nameId} help="Optional. A scene with no name takes its map's name.">
        <Input
          id={nameId}
          value={name}
          maxLength={120}
          placeholder={picked?.name ?? "Goblin ambush"}
          onChange={(event) => onName(event.target.value)}
        />
      </Field>
      <MapPicker
        token={token}
        selectedId={picked?.id ?? null}
        onSelect={(map) => onPick(map)}
        onUploaded={() => void reloadMaps()}
        onSetGrid={(mapId) => go(pathForMap(mapId, "grid", SCENES_PATHS.newScene))}
      />
      {picked && (
        <p className={cx("sc-hint", gridStateOf(picked) === "none" && "sc-caution")}>
          {picked.name} · {gridLine(gridStateOf(picked), picked)}
        </p>
      )}
    </div>
  );
}

/** The scene's name on its own steps. A rename is one command. */
function SceneName({ facts }: Readonly<{ facts: SceneFacts }>) {
  const [name, setName] = useState(facts.scene.name);
  const nameId = useId();
  const { toast } = useToast();
  useEffect(() => setName(facts.scene.name), [facts.scene.name]);
  const save = () => {
    const next = name.trim().slice(0, 120);
    if (!next || next === facts.scene.name) return setName(facts.scene.name);
    void command("scene:rename", { sceneId: facts.scene.id, name: next }).then((result) => {
      if (!result.ok) toast(result.message ?? "The scene could not be renamed.", { tone: "error" });
    });
  };
  return (
    <Field label="Scene name" htmlFor={nameId}>
      <Input
        id={nameId}
        value={name}
        maxLength={120}
        onChange={(event) => setName(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
        }}
      />
    </Field>
  );
}

/** The last step: what is still open, step by step, and Make live. */
function Review({ facts }: Readonly<{ facts: SceneFacts }>) {
  const { go } = useScenes();
  const needs = needsOf(facts);
  return (
    <div className="sc-q">
      <SceneName facts={facts} />
      {needs.length === 0 ? (
        <p className="sc-hint">Nothing is left. The scene is ready to go live.</p>
      ) : (
        <ul className="sc-meta-needs">
          {needs.map((need) => (
            <li key={need.id}>
              <span>
                <strong>{STEP_LABEL[need.step]}</strong> · {need.text}
              </span>
              <Button size="sm" onClick={() => go(pathForScene(facts.scene.id, need.step))}>
                Go to it
              </Button>
            </li>
          ))}
        </ul>
      )}
      <dl className="sc-dl">
        <div>
          <dt>Map</dt>
          <dd>
            {facts.map?.name ?? "Not in the library"} · {gridLine(facts.grid, facts.map)}
          </dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd>{tokensLine(facts)}</dd>
        </div>
        <div>
          <dt>Light</dt>
          <dd>{lightLine(facts)}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Making or editing a scene as steps: Map, Tokens and monsters, Walls and light, Sound, and Review. The steps run
 * down the left, each marked done or unfinished; the step's questions fill the middle; the map is pinned on the
 * right, drawn and edited as the table draws it. Choosing the map makes the scene, privately, so every later step edits the real one.
 * On a phone the steps are a strip across the top and the map is a bar over the bottom tabs that opens full screen.
 */
export function SceneEditor({ sceneId, step }: Readonly<{ sceneId: string | null; step: SceneStep }>) {
  const { state, token, maps, go, narrow } = useScenes();
  const scene = sceneId ? (state.combat.scenes.find((candidate) => candidate.id === sceneId) ?? null) : null;
  const facts = scene ? factsOf(state, scene, maps) : null;
  const [picked, setPicked] = useState<PickerMap | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const { toast } = useToast();
  const actions = useSceneActions(state.combat.scenes, { combatActive: state.combat.active });
  const autoArrange = useAutoArrange();
  // "New scene on this map" arrives with `?map=`, picked once the library has it.
  const wanted = useRoute().query.get("map");
  useEffect(() => {
    if (sceneId || picked || !wanted) return;
    const map = maps?.find((candidate) => candidate.id === wanted);
    if (map)
      setPicked({
        id: map.id,
        name: map.name,
        kind: map.kind,
        folder: map.folder,
        width: map.width,
        height: map.height,
        calibration: map.calibration,
        scale: map.scale
      });
  }, [sceneId, picked, wanted, maps]);
  useEffect(() => {
    if (scene) arrivingScenes.delete(scene.id);
  }, [scene]);

  if (sceneId && !scene)
    return arrivingScenes.has(sceneId) ? (
      <p className="sc-missing" role="status">
        Opening the scene…
      </p>
    ) : (
      <div className="sc-missing">
        <p role="status">That scene no longer exists. It may have been deleted.</p>
        <Button onClick={() => go(SCENES_PATHS.list)}>All scenes</Button>
      </div>
    );

  const current = scene ? step : "map";
  const index = SCENE_STEPS.indexOf(current);
  const states = stepStates(facts);
  const stepPath = (next: SceneStep) => (scene ? pathForScene(scene.id, next) : SCENES_PATHS.newScene);

  const create = () => {
    if (!picked) return;
    const party = rosterActors(state.actors)
      .filter((actor) => actor.kind === "player-character" && !actor.archived)
      .map((actor) => actor.id);
    setCreating(true);
    void command("scene:create", {
      name: (name.trim() || picked.name).slice(0, 120),
      mapAssetId: picked.id,
      combatantIds: party
    }).then((result) => {
      setCreating(false);
      if (!result.ok || !result.sceneId) {
        toast(result.message ?? "The scene could not be made.", { tone: "error" });
        return;
      }
      arrivingScenes.add(result.sceneId);
      // Settings can keep a new scene closed: it is then only listed, to arrange later.
      void navigate(autoArrange ? pathForScene(result.sceneId, "tokens") : SCENES_PATHS.list, { replace: true });
    });
  };

  /** Opens the map: on a phone it takes the screen, on a laptop it is already beside the questions. */
  const showMap = () => {
    if (narrow) setMapOpen(true);
  };
  const place = (actorId: string) => {
    showMap();
    window.setTimeout(() => armPlacement(actorId), 0);
  };
  const tools = (group: "walls" | "light" | "fog") => {
    showMap();
    window.setTimeout(() => openMapToolGroup(group), 0);
  };

  const questions: ReactNode = (() => {
    if (!facts) return <NewSceneMap picked={picked} onPick={setPicked} name={name} onName={setName} />;
    switch (current) {
      case "map":
        return (
          <div className="sc-q">
            <SceneName facts={facts} />
            <SceneMapFacts facts={facts} back={pathForScene(facts.scene.id, "map")} />
            <p className="sc-hint">
              A scene keeps its map for life, since its tokens, walls and fog sit on that map. Prepare another scene to
              use another map.
            </p>
          </div>
        );
      case "tokens":
        return <SceneTokens facts={facts} onPlace={place} />;
      case "light":
        return <SceneLight facts={facts} onOpenTools={tools} />;
      case "sound":
        return <SceneSound facts={facts} />;
      case "review":
        return <Review facts={facts} />;
    }
  })();

  const next = SCENE_STEPS[index + 1];
  const primary = !facts ? (
    <Button variant="primary" disabled={!picked || creating} onClick={create}>
      {creating ? "Making the scene…" : "Continue"}
    </Button>
  ) : current === "review" ? (
    facts.live ? (
      <Button variant="primary" onClick={() => go(pathForGmTab("table"))}>
        <IconPlay /> Go to the table
      </Button>
    ) : (
      <Button variant="primary" onClick={() => void actions.makeLive(facts.scene)}>
        <IconPlay /> Make live
      </Button>
    )
  ) : (
    <Button variant="primary" onClick={() => go(stepPath(next!))}>
      Next: {STEP_SHORT[next!]}
    </Button>
  );
  const secondary =
    facts && current === "review" ? (
      <Button variant="secondary" onClick={() => go(pathForScene(facts.scene.id))}>
        Done for now
      </Button>
    ) : index > 0 ? (
      <Button variant="secondary" onClick={() => go(stepPath(SCENE_STEPS[index - 1]!))}>
        Back
      </Button>
    ) : null;

  const workbench = facts ? (
    <EncounterMap
      assetId={facts.scene.mapAssetId}
      token={token}
      altText={`Preparing ${facts.scene.name}`}
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
      {...(facts.live ? {} : { moveSceneId: facts.scene.id })}
    />
  ) : picked ? (
    <EncounterMap
      assetId={picked.id}
      token={token}
      altText={picked.name}
      role="gm"
      actors={[]}
      tokens={[]}
      annotations={[]}
      revision={state.revision}
      activeActorId={null}
      readOnly
      showGrid
    />
  ) : (
    <p className="sc-preview-note">The map you pick shows here, as the table draws it.</p>
  );
  const title = facts ? facts.scene.name : "New scene";
  const doneCount = facts ? SCENE_STEPS.filter((candidate) => states[candidate] === "done").length : 0;

  return (
    <>
      <EditorFrame
        className="sc-scene-editor"
        narrow={narrow}
        head={
          <>
            {narrow ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={facts ? `Back to ${facts.scene.name}` : "Back to the scenes"}
                onClick={() => go(facts ? pathForScene(facts.scene.id) : SCENES_PATHS.list)}
              >
                <IconChevronLeft />
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setListOpen(true)} aria-expanded={listOpen}>
                <IconList /> Scenes
              </Button>
            )}
            <span className="sc-ring tabular" aria-label={`${doneCount} of ${SCENE_STEPS.length} steps done`}>
              {doneCount}/{SCENE_STEPS.length}
            </span>
            <h2 className="sc-scene-title">{title}</h2>
            <span className="sc-grow" />
            {facts && !narrow && (
              <Button variant="ghost" size="sm" onClick={() => go(pathForScene(facts.scene.id))}>
                Open the scene
              </Button>
            )}
          </>
        }
        steps={SCENE_STEPS.map((candidate) => ({
          id: candidate,
          label: STEP_LABEL[candidate],
          short: STEP_SHORT[candidate],
          ...(facts ? { state: states[candidate] } : { locked: candidate !== "map" })
        }))}
        current={current}
        onStep={(id) => facts && go(stepPath(id as SceneStep))}
        title={STEP_LABEL[current]}
        ask={STEP_ASK[current]}
        questions={questions}
        foot={
          <>
            {secondary}
            {primary}
          </>
        }
        map={workbench}
        mapLabel={facts ? `The map of ${facts.scene.name}, as the table draws it` : "The map, as the table draws it"}
        peek={{
          icon: facts ? <MapThumb mapAssetId={facts.scene.mapAssetId} /> : <IconMap />,
          name: facts?.map?.name ?? picked?.name ?? "No map yet",
          detail: facts
            ? `${count(facts.placed, "token")} on the map · ${drawnLine(facts)}`
            : "The map shows here once picked."
        }}
        mapOpen={mapOpen}
        onMapOpen={setMapOpen}
      />
      {!narrow && <SceneListFlyout open={listOpen} onClose={() => setListOpen(false)} currentId={sceneId} />}
      {actions.dialogs}
    </>
  );
}

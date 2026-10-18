import { useRef, useState } from "react";
import { rosterActors } from "@vtt/domain";
import {
  Button,
  IconChevronLeft,
  IconCopy,
  IconList,
  IconPencil,
  IconPlay,
  IconTrash,
  Menu,
  MenuItem,
  Select,
  cx
} from "@vtt/ui";
import { EncounterMap } from "../scene/EncounterMap";
import { armPlacement, openMapToolGroup } from "../scene/tableGeometry";
import { PaneDivider, useMomentShare } from "../table/PaneDivider";
import { TablePanel, useRememberedTab } from "../table/TablePanel";
import { pathForGmTab } from "../router";
import { useScenes } from "./context";
import { pathForScene, SCENES_PATHS, type SceneStep } from "./routes";
import { useSceneActions } from "./sceneActions";
import { factsOf, needsOf, type SceneFacts } from "./sceneFacts";
import { SceneListFlyout, StateChip } from "./pieces";
import { ScenePreview, type SeeAs } from "./ScenePreview";
import { SceneCodex, SceneTokens, SceneHistory, SceneLight, SceneMapFacts, SceneSound } from "./SceneQuestions";
import "./scene-page.css";

/** A section of the metadata panel: a heading, and Edit when a step answers it. */
function Section({
  title,
  step,
  sceneId,
  children
}: Readonly<{ title: string; step?: SceneStep; sceneId: string; children: React.ReactNode }>) {
  const { go } = useScenes();
  return (
    <section className="sc-meta-section" aria-label={title}>
      <header className="sc-meta-head">
        <h3>{title}</h3>
        {step && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => go(pathForScene(sceneId, step))}
            aria-label={`Edit ${title.toLowerCase()}`}
          >
            <IconPencil /> Edit
          </Button>
        )}
      </header>
      {children}
    </section>
  );
}

/**
 * A scene as one document, built as the table's docked workbench: the header bar, the map with its tool rail (the
 * same component the table draws, edited with the same tools), and a panel of what the GM asks about the scene, with
 * Make live as its one primary. See as switches the map in place to what the table screen or one character's player
 * would receive.
 */
export function SceneDocument({ sceneId }: Readonly<{ sceneId: string }>) {
  const { state, token, maps, go, narrow } = useScenes();
  const scene = state.combat.scenes.find((candidate) => candidate.id === sceneId) ?? null;
  const [listOpen, setListOpen] = useState(false);
  const [seeAs, setSeeAs] = useState<SeeAs>("gm");
  const splitRef = useRef<HTMLDivElement | null>(null);
  const [mapShare, moveSplit] = useMomentShare(null);
  const actions = useSceneActions(state.combat.scenes, {
    combatActive: state.combat.active,
    onDeleted: () => go(SCENES_PATHS.list),
    onDuplicated: (copyId) => go(pathForScene(copyId))
  });
  const [tab, setTab] = useRememberedTab("vtt.scene-tab", ["scene", "tokens"], "scene", sceneId);
  if (!scene)
    return (
      <div className="sc-missing">
        <p role="status">That scene no longer exists. It may have been deleted.</p>
        <Button onClick={() => go(SCENES_PATHS.list)}>All scenes</Button>
      </div>
    );
  const facts: SceneFacts = factsOf(state, scene, maps);
  const party = rosterActors(state.actors).filter((actor) => actor.kind === "player-character" && !actor.archived);
  const needs = needsOf(facts);
  const seeAsValue = seeAs === "gm" || seeAs === "screen" ? seeAs : seeAs.actorId;

  const header = (
    <header className={cx("table-header sc-scene-head", seeAs !== "gm" && "is-preview")} aria-label="The scene">
      {narrow ? (
        <Button variant="ghost" size="sm" onClick={() => go(SCENES_PATHS.list)} aria-label="Back to the scenes">
          <IconChevronLeft />
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setListOpen(true)} aria-expanded={listOpen}>
          <IconList /> Scenes
        </Button>
      )}
      <h2 className="sc-scene-title">{scene.name}</h2>
      <StateChip facts={facts} />
      <span className="sc-grow" />
      <label className="sc-see-as">
        <span className="sc-see-as-label">See as</span>
        <Select
          value={seeAsValue}
          aria-label="See as"
          onChange={(event) => {
            const value = event.target.value;
            if (value === "gm" || value === "screen") setSeeAs(value);
            else {
              const actor = party.find((candidate) => candidate.id === value);
              if (actor) setSeeAs({ actorId: actor.id, name: actor.name });
            }
          }}
        >
          <option value="gm">You, the GM</option>
          <option value="screen">The table screen</option>
          {party.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name}
            </option>
          ))}
        </Select>
      </label>
      <Menu trigger="⋯" label={`${scene.name} actions`} align="end" hideCaret>
        <MenuItem icon={<IconPencil />} onClick={() => go(pathForScene(scene.id, "map"))}>
          Edit its steps
        </MenuItem>
        <MenuItem icon={<IconPencil />} onClick={() => void actions.rename(scene)}>
          Rename
        </MenuItem>
        <MenuItem icon={<IconCopy />} onClick={() => actions.duplicate(scene)}>
          Duplicate
        </MenuItem>
        {!facts.live && (
          <MenuItem icon={<IconTrash />} tone="danger" onClick={() => void actions.remove(scene)}>
            Delete scene
          </MenuItem>
        )}
      </Menu>
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
            ? `What the table screen shows${facts.live ? "" : " once this scene is live"}.`
            : `What ${seeAs.name}'s player sees${facts.live ? "" : " once this scene is live"}.`}
        </span>
        <Button variant="secondary" size="sm" onClick={() => setSeeAs("gm")}>
          Back to your view
        </Button>
      </div>
    );

  const sceneTab = (
    <div className="sc-meta">
      <Section title="State" sceneId={scene.id}>
        <p className="sc-hint">
          {facts.live
            ? state.combat.active
              ? `Players and the table screen see it now. A fight is on, round ${state.combat.round}.`
              : "Players and the table screen see it now."
            : facts.state === "parked"
              ? `A fight is parked here at round ${facts.combat.round}. It resumes when the scene goes live.`
              : "Prepared. Players and the table screen see none of it until you make it live."}
        </p>
        {needs.length > 0 && (
          <ul className="sc-meta-needs">
            {needs.map((need) => (
              <li key={need.id}>
                <span>{need.text}</span>
                <Button size="sm" onClick={() => go(pathForScene(scene.id, need.step))}>
                  Go to it
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Map" step="map" sceneId={scene.id}>
        <SceneMapFacts facts={facts} />
      </Section>
      <Section title="Walls and light" step="light" sceneId={scene.id}>
        <SceneLight
          facts={facts}
          onOpenTools={(group) => {
            setSeeAs("gm");
            openMapToolGroup(group);
          }}
        />
      </Section>
      <Section title="Sound" step="sound" sceneId={scene.id}>
        <SceneSound facts={facts} />
      </Section>
      <Section title="In the Codex" sceneId={scene.id}>
        <SceneCodex facts={facts} />
      </Section>
      <Section title="History" sceneId={scene.id}>
        <SceneHistory facts={facts} />
      </Section>
    </div>
  );

  const footer = facts.live ? (
    <Button variant="primary" onClick={() => go(pathForGmTab("table"))}>
      <IconPlay /> Go to the table
    </Button>
  ) : (
    <Button variant="primary" onClick={() => void actions.makeLive(scene)}>
      <IconPlay /> Make live
    </Button>
  );

  return (
    <div className={cx("table-bench gm sc-scene-bench", !facts.live && "is-staging")}>
      {header}
      <div
        className="table-bench-split"
        ref={splitRef}
        style={narrow ? ({ "--map-share": `${mapShare}%` } as React.CSSProperties) : undefined}
      >
        <div className="table-bench-map">
          {previewBanner}
          {map}
        </div>
        {narrow && <PaneDivider value={mapShare} onChange={moveSplit} container={() => splitRef.current} />}
        <div className="table-bench-panel">
          <TablePanel
            label={`About ${scene.name}`}
            tabs={[
              { id: "scene", label: "Scene", content: sceneTab },
              {
                id: "tokens",
                label: `Tokens · ${facts.tokens}`,
                content: (
                  <SceneTokens
                    facts={facts}
                    onPlace={(actorId) => {
                      // A preview shows no workbench map, so it goes back to the GM's own view first.
                      setSeeAs("gm");
                      window.setTimeout(() => armPlacement(actorId), 0);
                    }}
                  />
                )
              }
            ]}
            active={tab}
            onActive={setTab}
            footer={footer}
            phone={narrow}
          />
        </div>
      </div>
      {!narrow && <SceneListFlyout open={listOpen} onClose={() => setListOpen(false)} currentId={scene.id} />}
      {actions.dialogs}
    </div>
  );
}

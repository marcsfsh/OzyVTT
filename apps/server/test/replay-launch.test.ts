import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { loadActorFixture } from "@vtt/test-fixtures";
import { launchReplay } from "../src/replay-launch.js";
import { activateScene, createScene } from "../src/scenes.js";
import { startEncounter } from "../src/encounter.js";
import type { EncounterArchiveDocument } from "../src/encounter-archive.js";

/**
 * LAUNCH FROM HERE (D25 / director ruling R3).
 *
 * The behaviour under test is "one table": the current fight PARKS exactly as it does on a scene
 * switch, the recorded moment goes live, and the parked scene resumes through the ordinary
 * `scene.activate`. The id-cloning is data safety and is asserted as such - tonight's characters
 * must come back from the replay with the hit points they had when it started.
 */

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  goblin: "10000000-0000-4000-8000-000000000002",
  archivedHero: "10000000-0000-4000-8000-00000000000a",
  archivedGoblin: "10000000-0000-4000-8000-00000000000b",
  session: "30000000-0000-4000-8000-000000000001",
  map: "20000000-0000-5000-8000-000000000001",
  otherMap: "20000000-0000-5000-8000-000000000002",
  scene: "40000000-0000-4000-8000-000000000001",
  launchScene: "40000000-0000-4000-8000-000000000002",
  implicit: "40000000-0000-4000-8000-000000000003"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

let minted = 0;
const newActorId = () => `70000000-0000-4000-8000-0000000000${String(++minted).padStart(2, "0")}`;

/** The live campaign: the hero is battered and claimed, exactly as tonight left them. */
function liveState(): GameState {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.hero, name: "Borin", kind: "player-character", visibility: "public", hp: { current: 4, maximum: 30 }, ownerSessionId: IDS.session, definitionId: "import-borin" },
    { id: IDS.goblin, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 7, maximum: 7 } }
  ], definitions: [{ id: "import-borin", definition: heroDefinition("Borin", 30) }] });
}

/** A real, schema-valid definition (the shared fixture) with one field varied, so the collision rule has two distinguishable bodies. */
function heroDefinition(name: string, maximum: number): ActorDefinition {
  const base = ActorDefinitionSchema.parse(loadActorFixture("player-character"));
  return { ...base, name, hitPoints: { ...base.hitPoints, maximum } };
}

/** The archived moment: the hero at FULL health, a hidden ambusher, and an effect linking the two. */
function archivedState(): GameState {
  const state = GameStateSchema.parse({ schemaVersion: 1, actors: [
    {
      id: IDS.archivedHero, name: "Borin", kind: "player-character", visibility: "public",
      hp: { current: 30, maximum: 30 }, ownerSessionId: IDS.session, definitionId: "import-borin",
      conditions: [{ id: "prone" }],
      effects: [{ id: "grapple-1", name: "Grappled", tags: ["grapple"], sourceActorId: IDS.archivedGoblin, sourceName: "Grick", sourceActionId: null, startedRound: 1, duration: { type: "manual" }, modifiers: [], linkedConditionIds: ["grappled"], onEnd: [] }]
    },
    { id: IDS.archivedGoblin, name: "Grick", kind: "monster", visibility: "gm-only", hp: { current: 20, maximum: 20 }, definitionId: "import-grick" }
  ], definitions: [
    { id: "import-borin", definition: heroDefinition("Borin", 44) },
    { id: "import-grick", definition: heroDefinition("Grick", 20) }
  ] });
  startEncounter(state, { mapAssetId: IDS.otherMap, entries: [{ actorId: IDS.archivedHero, score: 18 }, { actorId: IDS.archivedGoblin, score: 12 }] }, () => 1, GEOMETRY);
  state.combat = { ...state.combat, reactionsUsed: [IDS.archivedHero], legendaryUsed: { [IDS.archivedGoblin]: 1 }, turn: { ...state.combat.turn, turnUses: { [`${IDS.archivedHero}:second-wind`]: 1 } } };
  return state;
}

function documentWith(turns: readonly { revision: number; state: GameState }[]): EncounterArchiveDocument {
  const first = turns[0]?.state ?? archivedState();
  return {
    archiveSchemaVersion: 3, startedAt: "2026-07-01T20:00:00.000Z", endedAt: "2026-07-01T21:30:00.000Z",
    turnCount: turns.length,
    turns: turns.map((turn, index) => ({ index, kind: "turn" as const, label: "Grick's turn", revision: turn.revision, at: `2026-07-01T20:0${index}:00.000Z`, state: turn.state })),
    log: [], journal: [], finalState: first, postEncounterState: first, rolls: [],
    definitions: [
      { id: "import-borin", source: "imported", definition: heroDefinition("Borin", 44) },
      { id: "import-grick", source: "imported", definition: heroDefinition("Grick", 20) }
    ],
    attribution: null
  };
}

const launch = (state: GameState, document: EncounterArchiveDocument, turnIndex = 0) =>
  launchReplay(state, { archiveId: 7, document, turnIndex, sceneId: IDS.launchScene, implicitSceneId: IDS.implicit, newActorId });

describe("replay.launch - one table, parked and resumed", () => {
  it("parks the live scene, goes live on the recorded moment, and resumes on the ordinary scene switch", () => {
    const state = liveState();
    createScene(state, { sceneId: IDS.scene, name: "Tonight", mapAssetId: IDS.map, combatantIds: [IDS.hero, IDS.goblin] }, GEOMETRY);
    activateScene(state, IDS.scene, IDS.implicit);
    startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.hero, score: 20 }, { actorId: IDS.goblin, score: 5 }] }, () => 1, GEOMETRY);
    state.combat = { ...state.combat, round: 4 };

    const outcome = launch(state, documentWith([{ revision: 10, state: archivedState() }]));

    // Live on the replay, and the map went with it.
    expect(state.combat.activeSceneId).toBe(IDS.launchScene);
    expect(state.combat.mapAssetId).toBe(IDS.otherMap);
    expect(state.combat.round).toBe(1);
    expect(state.combat.initiative.map((entry) => entry.actorId)).toEqual(outcome.actorIds);

    // The table that was live is PARKED, not lost - the same park/resume motion as a scene switch.
    const parked = state.combat.scenes.find((scene) => scene.id === IDS.scene)!;
    expect(parked.combat.round).toBe(4);
    expect(parked.combat.initiative.map((entry) => entry.actorId)).toEqual([IDS.hero, IDS.goblin]);

    activateScene(state, IDS.scene, IDS.implicit);
    expect(state.combat.activeSceneId).toBe(IDS.scene);
    expect(state.combat.round).toBe(4);
    expect(state.combat.mapAssetId).toBe(IDS.map);
  });

  it("clones the combatants under new ids and never rewrites tonight's characters", () => {
    const state = liveState();
    const outcome = launch(state, documentWith([{ revision: 10, state: archivedState() }]));

    // The live hero is untouched: same id, same battered hit points, same claim.
    const live = state.actors.find((actor) => actor.id === IDS.hero)!;
    expect(live.hp).toMatchObject({ current: 4, maximum: 30 });
    expect(live.ownerSessionId).toBe(IDS.session);

    expect(outcome.actorIds).toHaveLength(2);
    expect(outcome.actorIds).not.toContain(IDS.hero);
    const clonedHero = state.actors.find((actor) => actor.id === outcome.actorIds[0])!;
    expect(clonedHero.name).toBe("Borin (replay)");
    expect(clonedHero.hp).toMatchObject({ current: 30, maximum: 30 });
    // Claims do not resurrect - the player owns their LIVE character, not the replay copy.
    expect(clonedHero.ownerSessionId).toBeNull();
    expect(clonedHero.conditions.map((condition) => condition.id)).toEqual(["prone"]);
  });

  it("remaps every actor reference inside the restored fight - effects, economy keys, pools", () => {
    const state = liveState();
    const outcome = launch(state, documentWith([{ revision: 10, state: archivedState() }]));
    const [heroId, grickId] = outcome.actorIds;

    const clonedHero = state.actors.find((actor) => actor.id === heroId)!;
    // The grapple still points at the creature that made it - the CLONE, never the archived id.
    expect(clonedHero.effects[0].sourceActorId).toBe(grickId);
    expect(state.combat.reactionsUsed).toEqual([heroId]);
    expect(Object.keys(state.combat.legendaryUsed)).toEqual([grickId]);
    expect(Object.keys(state.combat.turn.turnUses)).toEqual([`${heroId}:second-wind`]);
    expect(state.combat.tokens.map((token) => token.actorId).sort()).toEqual([...outcome.actorIds].sort());
    // Nothing anywhere in the restored fight still names an archived id.
    expect(JSON.stringify(state.combat)).not.toContain(IDS.archivedHero);
    expect(JSON.stringify(state.combat)).not.toContain(IDS.archivedGoblin);
  });

  it("never overwrites a definition the campaign is using now", () => {
    const state = liveState();
    const outcome = launch(state, documentWith([{ revision: 10, state: archivedState() }]));

    // `import-borin` exists live with a DIFFERENT body (30 max vs the archive's 44) - the campaign's
    // copy stays exactly as it was and the replay's copy gets its own namespaced id.
    expect(state.definitions.find((entry) => entry.id === "import-borin")!.definition.hitPoints.maximum).toBe(30);
    const replayCopy = state.definitions.find((entry) => entry.id === "replay-7-import-borin")!;
    expect(replayCopy.definition.hitPoints.maximum).toBe(44);
    expect(state.actors.find((actor) => actor.id === outcome.actorIds[0])!.definitionId).toBe("replay-7-import-borin");
    // A definition the campaign does NOT have keeps its own id.
    expect(state.definitions.some((entry) => entry.id === "import-grick")).toBe(true);
  });

  it("refuses while the GM is reviewing history, and when the recording has nothing to launch", () => {
    const reviewing = liveState();
    reviewing.combat = { ...reviewing.combat, historyCursor: 2 };
    expect(() => launch(reviewing, documentWith([{ revision: 10, state: archivedState() }]))).toThrow(/reviewing the combat history/i);

    expect(() => launch(liveState(), documentWith([]))).toThrow(/no turns to launch/i);
    expect(() => launch(liveState(), documentWith([{ revision: 10, state: archivedState() }]), 5)).toThrow(/not in this recording/i);
  });

  it("refuses up front when there is no room to park the table AND stage the replay", () => {
    const state = liveState();
    // 19 prepared scenes plus a live unbound encounter: parking needs one slot, the replay needs
    // another, and the cap is 20 - so this is refused BEFORE anything is cloned.
    for (let index = 0; index < 19; index += 1) {
      createScene(state, { sceneId: `40000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`, name: `Scene ${index}`, mapAssetId: IDS.map, combatantIds: [] }, GEOMETRY);
    }
    startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.hero, score: 20 }] }, () => 1, GEOMETRY);
    const before = state.actors.length;
    expect(() => launch(state, documentWith([{ revision: 10, state: archivedState() }]))).toThrow(/Remove a prepared scene first/i);
    expect(state.actors).toHaveLength(before);
    expect(state.combat.scenes).toHaveLength(19);
  });

  it("clamps the (replay) suffix when a replay is itself replayed", () => {
    // Launch once, then archive THAT table and launch it again: names must not stack suffixes.
    const first = liveState();
    const once = launch(first, documentWith([{ revision: 10, state: archivedState() }]));
    expect(first.actors.find((actor) => actor.id === once.actorIds[0])!.name).toBe("Borin (replay)");

    const document = documentWith([{ revision: 20, state: structuredClone(first) }]);
    const second = launch(liveState(), document);
    const names = second.actorIds.map((id) => document.turns[0].state.actors.find(() => true) && id);
    expect(names).toHaveLength(second.actorIds.length);
    const relaunched = liveState();
    const outcome = launch(relaunched, document);
    for (const id of outcome.actorIds) {
      const name = relaunched.actors.find((actor) => actor.id === id)!.name;
      expect(name.split("(replay)")).toHaveLength(2);
    }
  });
});

import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import type { EffectNarration } from "../src/effects.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { RulesBlockedError } from "../src/game-store.js";
import { laterRowOf } from "../src/item-actions.js";
import { movementCost } from "../src/terrain.js";
import { zoneMovementOptions } from "../src/zone-ground.js";
import { checkAimInArea, stageRefusal, withAreaDice } from "../src/zone-later.js";
import { zonesAfterMove, zonesAtTurnEnd } from "../src/spell-zones.js";
import { deflectingWall } from "../src/zone-walls.js";
import { build, catalog, druidInput, fight, FOE, FOE2, HERO, heroTurnAgain, view } from "./spell-casters.js";
import { answer } from "./spell-lifetimes-kit.js";
import {
  carry,
  cell,
  drawArea,
  druidAt,
  GRID,
  hpOf,
  MAP,
  place,
  savesOf,
  turnDeps,
  wizardAt,
  zoneDeps
} from "./zone-fixtures.js";

// SRD 5.2.1 areas that change with time: Storm of Vengeance ("At the start of each of your later turns, the storm
// produces different effects"), Symbol ("The glyph is nearly imperceptible ... Once triggered, the glyph glows, filling
// a 60-foot-radius Sphere with Dim Light for 10 minutes"), Time Stop ending when "any effects that you create during it,
// affects a creature other than you", and Call Lightning's bolts "under the cloud", 1d10 stronger in a storm.

const CAST = "6b000000-0000-4000-8000-000000000001";
const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;
const texts = (events: readonly EffectNarration[]) => events.map((event) => event.text);

describe("Storm of Vengeance's turns", () => {
  const druid = druidAt(17, ["storm-of-vengeance"]);

  /** The storm over the goblin and the orc; the druid stands outside it. */
  function storm() {
    const caster = fight(druid);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(20, 20), [FOE2]: cell(22, 20) });
    caster.resolve("spell-storm-of-vengeance", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [20, 20], 10);
    return caster;
  }
  /** The druid's next turn, its start told. */
  function nextTurn(state: GameState, faces: number[] = []): EffectNarration[] {
    const events: EffectNarration[] = [];
    for (let step = 0; step < 4; step++) {
      nextInitiativeTurn(state, events, turnDeps(faces));
      if (state.combat.turnActorId === HERO) return events;
    }
    throw new Error("The druid never came up again.");
  }

  it("rains acid on every creature under the cloud on its second turn", () => {
    const { state } = storm();
    const events = nextTurn(state, Array(20).fill(2));
    expect(texts(events)).toContain("Storm of Vengeance turns to its acid rain.");
    expect(hpOf(state, FOE)).toBe(200 - 8);
    expect(hpOf(state, FOE2)).toBe(200 - 8);
  });

  it("lets the druid aim six bolts at creatures under the cloud on its third turn, once", () => {
    const caster = storm();
    nextTurn(caster.state);
    const spell = view.spellRecord("storm-of-vengeance")!;
    const bolts = laterRowOf(spell, "spell-storm-of-vengeance-then-bolts")!;
    expect(stageRefusal(caster.state, HERO, bolts, spell, catalog)).toMatch(/come only with its lightning/);
    nextTurn(caster.state);
    expect(stageRefusal(caster.state, HERO, bolts, spell, catalog)).toBeNull();
    const aim = (targetIds: string[]) =>
      checkAimInArea(
        caster.state,
        {
          casterId: HERO,
          action: caster.action("spell-storm-of-vengeance-then-bolts"),
          spell,
          point: null,
          targetIds,
          override: null,
          option: undefined
        },
        zoneDeps()
      );
    expect(aim([FOE, FOE2])).toBeNull();
    caster.state.combat.tokens = caster.state.combat.tokens.map((token) =>
      token.actorId === FOE2 ? { ...token, position: cell(45, 45) } : token
    );
    expect(() => aim([FOE, FOE2])).toThrow(RulesBlockedError);
  });

  it("brings freezing rain from its fifth turn: Cold damage, Difficult Terrain, Heavily Obscured, no shots", () => {
    const { state } = storm();
    for (let turn = 2; turn < 5; turn++) nextTurn(state, Array(20).fill(1));
    const before = hpOf(state, FOE);
    const events = nextTurn(state, Array(20).fill(1));
    expect(texts(events)).toContain("Storm of Vengeance turns to its freezing rain.");
    expect(hpOf(state, FOE)).toBe(before - 1);
    const cost = movementCost(
      state,
      GRID,
      FOE,
      cell(20, 20),
      cell(21, 20),
      zoneMovementOptions(state, FOE, zoneDeps())
    )!.feet;
    expect(cost).toBe(10);
    expect(state.combat.vision.areas).toEqual([expect.objectContaining({ kind: "heavily-obscured" })]);
    expect(deflectingWall(state, HERO, FOE, zoneDeps())).toBe("Storm of Vengeance");
  });
});

describe("Symbol: a hidden glyph that glows when set off", () => {
  const wizard = wizardAt(13, ["symbol", "magic-missile"]);

  /** A Symbol of Stunning on the floor at (10,10), inscribed before the fight; the orc waits 25 feet from it. */
  function glyph(option = "stunning") {
    const caster = fight(wizard, { combat: false });
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(20, 10), [FOE2]: cell(15, 10) });
    carry(caster.state, HERO, "Diamond dust");
    caster.resolve("spell-symbol", { targetIds: [], commandId: CAST, areaPlaced: true, option });
    drawArea(caster.state, CAST, [10, 10], 1);
    startEncounter(
      caster.state,
      {
        mapAssetId: MAP,
        entries: [
          { actorId: HERO, score: 20 },
          { actorId: FOE, score: 10 },
          { actorId: FOE2, score: 9 }
        ]
      },
      () => 10,
      GRID
    );
    return caster;
  }

  it("acts on no one until a creature comes onto it", () => {
    const { state } = glyph();
    expect(state.combat.spellZones).toHaveLength(1);
    zonesAtTurnEnd(state, FOE2, zoneDeps());
    expect(savesOf(state, FOE2)).toEqual([]);
    // Drawn for the GM and its caster alone until it glows.
    expect(laterRowOf(view.spellRecord("symbol")!, state.combat.spellZones[0]!.laterActionId)?.zone?.hidden).toBe(true);
  });

  it("glows when stepped on: every creature in its 60-foot Sphere makes the save against its effect", () => {
    const { state } = glyph();
    const events = zonesAfterMove(
      state,
      {
        moverId: FOE,
        path: [cell(20, 10), cell(15, 11), cell(11, 10)]
      },
      zoneDeps()
    );
    expect(texts(events)).toContain("Goblin sets off Symbol, and the glyph glows.");
    expect(savesOf(state, FOE)).toEqual([expect.objectContaining({ ability: "wis", conditionIds: ["stunned"] })]);
    expect(savesOf(state, FOE2)).toEqual([expect.objectContaining({ ability: "wis" })]);
    // It is drawn for everyone now, as the 60-foot Sphere its Dim Light fills, for 10 minutes.
    const area = state.combat.annotations.find((annotation) => annotation.id === CAST)!;
    expect(area.visibility).toBe("public");
    expect(area.geometry.target.x - area.geometry.origin.x).toBe(600);
    expect(state.combat.vision.lights).toEqual([expect.objectContaining({ dimFeet: 60, annotationId: CAST })]);
    expect(actor(state, HERO).effects.find((effect) => effect.spell?.id === "symbol")?.duration).toEqual({
      type: "rounds",
      remaining: 100
    });
  });

  it("sends a creature its Fear frightens at least 30 feet away from the glyph on each of its turns", () => {
    // "While Frightened, the target must move at least 30 feet away from the glyph on each of its turns, if able."
    const { state } = glyph("fear");
    zonesAfterMove(state, { moverId: FOE, path: [cell(20, 10), cell(15, 11), cell(11, 10)] }, zoneDeps());
    answer(state, FOE, 2);
    const origin = state.combat.annotations.find((annotation) => annotation.id === CAST)!.geometry.origin;
    expect(actor(state, FOE).effects.find((effect) => effect.name === "Symbol of Fear")?.compelled).toEqual({
      way: "away",
      minFeet: 30,
      fromArea: true,
      point: { x: origin.x, y: origin.y }
    });
  });
});

describe("Time Stop and the areas made during it", () => {
  it("ends when a hound conjured during it bites another creature", () => {
    const caster = fight(wizardAt(17, ["time-stop", "faithful-hound"]));
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(5, 1), [FOE2]: cell(40, 40) });
    caster.resolve("spell-time-stop", { targetIds: [] }, [3]);
    expect(caster.state.combat.timeStop).toMatchObject({ actorId: HERO });
    nextInitiativeTurn(caster.state, [], turnDeps());
    expect(caster.state.combat.turnActorId).toBe(HERO);
    caster.resolve("spell-faithful-hound", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [4, 1], 1);
    const events: EffectNarration[] = [];
    nextInitiativeTurn(caster.state, events, turnDeps());
    expect(texts(events)).toContain("Time Stop ends: Ansel made Faithful Hound, which affected another creature.");
    expect(caster.state.combat.timeStop).toBeNull();
  });
});

describe("Call Lightning's cloud", () => {
  const druid = build(druidInput(["call-lightning"]));
  const spell = () => view.spellRecord("call-lightning")!;

  function cloud(option?: string) {
    const caster = fight(druid);
    place(caster.state, { [HERO]: cell(10, 10), [FOE]: cell(15, 10), [FOE2]: cell(40, 40) });
    caster.resolve("spell-call-lightning", { targetIds: [], commandId: CAST, ...(option ? { option } : {}) });
    heroTurnAgain(caster.state);
    return caster;
  }
  const aimBolt = (caster: ReturnType<typeof cloud>, at: readonly [number, number]) =>
    checkAimInArea(
      caster.state,
      {
        casterId: HERO,
        action: caster.action("spell-call-lightning-then-bolt"),
        spell: spell(),
        point: cell(...at),
        targetIds: [],
        override: null,
        option: undefined
      },
      zoneDeps()
    );

  it("calls a later bolt down under the cloud, where the caster stood as it cast", () => {
    const caster = cloud();
    caster.state.combat.tokens = caster.state.combat.tokens.map((token) =>
      token.actorId === HERO ? { ...token, position: cell(30, 10) } : token
    );
    expect(aimBolt(caster, [20, 10])).toBeNull();
    expect(() => aimBolt(caster, [25, 10])).toThrow(RulesBlockedError);
  });

  it("strikes 1d10 harder, on the cast and every later bolt, when cast in a storm", () => {
    const caster = cloud("storm");
    const cast = caster.action("spell-call-lightning");
    expect(withAreaDice(caster.state, HERO, cast, spell(), "storm", catalog).damage[0]!.formula).toBe("4d10");
    expect(withAreaDice(caster.state, HERO, cast, spell(), "clear", catalog).damage[0]!.formula).toBe("3d10");
    const bolt = caster.action("spell-call-lightning-then-bolt");
    expect(withAreaDice(caster.state, HERO, bolt, spell(), undefined, catalog).damage[0]!.formula).toBe("4d10");
  });
});

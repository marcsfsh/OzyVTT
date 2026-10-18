import { describe, expect, it } from "vitest";
import type { GameState, SpellZone } from "@vtt/domain";
import { addAnnotation } from "../src/annotations.js";
import { endEffect } from "../src/effects.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { burstEndedZones, zonesAfterMove, type ZoneDeps } from "../src/spell-zones.js";
import type { TokenMapGeometry } from "../src/token-placement.js";
import { ALLY, catalog, FOE, FOE2, HERO } from "./spell-casters.js";
import { actorOf, answer, cast, caster, laterAction, resolveAs } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 later actions with no action of their own, run by the server at their trigger: Faithful Hound "At the
// start of each of your turns, the hound attempts to bite one enemy within 5 feet of it"; Delayed Blast Fireball "When
// the spell ends, the bead explodes ... The spell's base damage is 12d6, and the damage increases by 1d6 whenever your
// turn ends and the spell hasn't ended"; Conjure Elemental's save, "if the spirit has no creature Restrained".

/** 50px cells, 5 ft each: cell (c,r) centre = (25 + 50c, 25 + 50r). */
const GRID: TokenMapGeometry = {
  width: 2000,
  height: 2000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
};
const cell = (column: number, row: number) => ({ x: 25 + 50 * column, y: 25 + 50 * row });

const zoneDeps = (faces: number[] = []): ZoneDeps => ({
  geometry: GRID,
  resolveDefinition: () => undefined,
  catalog,
  rollDie: () => faces.shift() ?? 3,
  newId: () => crypto.randomUUID(),
  now: () => "2026-10-18T00:00:00.000Z"
});
const turnDeps = (faces: number[] = []) => ({
  ...zoneDeps(faces),
  geometry: GRID,
  resolveDefinition: () => undefined
});

function place(state: GameState, positions: Readonly<Record<string, readonly [number, number]>>): void {
  state.combat.tokens = state.combat.tokens.map((token) => {
    const at = positions[token.actorId];
    return { ...token, position: at ? cell(at[0], at[1]) : token.position, sizeCells: 1 };
  });
}

/** The circle a cast's template drew: `radius` cells around `center`, under the cast's own id. */
function drawArea(state: GameState, id: string, center: readonly [number, number], radius: number): void {
  addAnnotation(
    state,
    {
      id,
      kind: "shape",
      shape: "circle",
      origin: cell(center[0], center[1]),
      target: cell(center[0] + radius, center[1]),
      visibility: "public",
      actor: { sessionId: "30000000-0000-4000-8000-00000000000a", role: "gm" },
      now: 0
    },
    GRID
  );
}

const zoneOf = (state: GameState, spellId: string) =>
  state.combat.spellZones.find((zone) => zone.spellId === spellId) as SpellZone;

describe("Faithful Hound", () => {
  it("bites the enemy nearest it within 5 feet as its caster's turn starts", () => {
    const table = caster();
    cast(table, "faithful-hound", { targetIds: [], areaPlaced: true, commandId: "hound" });
    drawArea(table.state, "hound", [10, 10], 1);
    place(table.state, { [HERO]: [2, 2], [FOE]: [11, 10], [FOE2]: [20, 20], [ALLY]: [10, 9] });
    const events: Parameters<typeof nextInitiativeTurn>[1] = [];
    for (let step = 0; step < 4; step += 1) nextInitiativeTurn(table.state, events, turnDeps([5, 5, 5, 5]));
    expect(table.state.combat.turnActorId).toBe(HERO);
    expect(table.state.combat.pendingSaves).toMatchObject([
      { targetActorId: FOE, ability: "dex", dc: 15, proposedDamage: 20, actionName: "Faithful Hound" }
    ]);
    expect(events.map((event) => event.text)).toContain(
      "Goblin is set upon by Faithful Hound and makes a DEX save (DC 15)."
    );
  });

  it("refuses the bite by hand while the hound isn't up", () => {
    const table = caster();
    expect(() => resolveAs(table, laterAction("faithful-hound", "bite"), { targetIds: [FOE] })).toThrow(
      "Ansel doesn't have Faithful Hound up. Cast it first."
    );
  });
});

describe("Delayed Blast Fireball", () => {
  it("bursts when the spell ends, 12d6 and 1d6 for each of its caster's turns that ended, on everyone in it", () => {
    const table = caster();
    cast(table, "delayed-blast-fireball", { targetIds: [], areaPlaced: true, commandId: "bead" });
    drawArea(table.state, "bead", [10, 10], 4);
    place(table.state, { [HERO]: [2, 2], [FOE]: [11, 10], [FOE2]: [12, 12], [ALLY]: [30, 30] });
    const bead = zoneOf(table.state, "delayed-blast-fireball");
    expect(bead).toMatchObject({ burstsOnEnd: true });
    // Two of the caster's turns end while it lasts.
    for (let step = 0; step < 8; step += 1) nextInitiativeTurn(table.state, [], turnDeps());
    expect(zoneOf(table.state, "delayed-blast-fireball").grown).toBe(2);
    const concentration = actorOf(table.state, HERO).effects.find((effect) => effect.tags.includes("concentrating"))!;
    endEffect(table.state, HERO, concentration.id);
    expect(zoneOf(table.state, "delayed-blast-fireball")).toMatchObject({ bursting: true });
    const told = burstEndedZones(table.state, zoneDeps());
    expect(table.state.combat.spellZones).toEqual([]);
    expect(table.state.combat.pendingSaves.map((save) => [save.targetActorId, save.proposedDamage])).toEqual([
      [FOE, 42],
      [FOE2, 42]
    ]);
    expect(told.map((event) => event.text)).toEqual([
      "Delayed Blast Fireball explodes: Goblin, Orc make a DEX save (DC 15)."
    ]);
  });
});

describe("Conjure Elemental", () => {
  it("makes a creature entering the spirit save in the element chosen, and waits while it holds one Restrained", () => {
    const table = caster();
    cast(table, "conjure-elemental", { targetIds: [], areaPlaced: true, commandId: "spirit", damageType: "fire" });
    drawArea(table.state, "spirit", [10, 10], 2);
    place(table.state, { [HERO]: [2, 2], [FOE]: [16, 10], [FOE2]: [10, 16], [ALLY]: [30, 30] });
    const walk = (actorId: string, path: ReadonlyArray<readonly [number, number]>) => {
      table.state.combat.tokens = table.state.combat.tokens.map((token) =>
        token.actorId === actorId ? { ...token, position: cell(...path[path.length - 1]!) } : token
      );
      return zonesAfterMove(table.state, { moverId: actorId, path: path.map(([c, r]) => cell(c, r)) }, zoneDeps());
    };
    walk(FOE, [
      [16, 10],
      [12, 10]
    ]);
    expect(table.state.combat.pendingSaves).toMatchObject([
      { targetActorId: FOE, ability: "dex", proposedDamage: 24, proposedDamageParts: [{ type: "fire", amount: 24 }] }
    ]);
    answer(table.state, FOE, 2);
    expect(actorOf(table.state, FOE).conditions.map((condition) => condition.id)).toContain("restrained");
    // The spirit holds the goblin, so the orc walks in unchallenged.
    expect(
      walk(FOE2, [
        [10, 16],
        [10, 12]
      ])
    ).toEqual([]);
  });
});

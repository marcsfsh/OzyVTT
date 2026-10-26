import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { setAltitude } from "../src/altitude.js";
import { builtinActionFor, builtinActionsFor } from "../src/builtin-actions.js";
import { needsSettling } from "../src/falling.js";
import { CommandRejectedError, RulesBlockedError } from "../src/game-store.js";
import { dropGrappled, offerHideAfterMove } from "../src/granted-moves.js";
import { dragAlong } from "../src/movement-rules.js";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { moveEncounterToken, type TokenMapGeometry } from "../src/token-placement.js";
import { actor, conditionsOf, IDS, NOW, nextId, table, use, type Table } from "./monster-table.js";

// SRD 5.2.1 stat-block moves that do more as they end, and an attack a hit opens: a roc's Swoop carries the creature it
// grapples aloft and drops it, a weretiger's Prowl ends with a free Hide, and an allosaurus's charge that knocks its
// target Prone lets it make one Bite against that target.

const GRID = {
  width: 1000,
  height: 1000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
} as const satisfies TokenMapGeometry;
const cell = (column: number, row: number) => ({ x: (column + 0.5) * 50, y: (row + 0.5) * 50 });
const tokenOf = (state: GameState, actorId: string) => state.combat.tokens.find((token) => token.actorId === actorId)!;

describe("a roc's Swoop", () => {
  it("is refused while the roc grapples nothing", () => {
    const built = table("roc");
    expect(() => use(built, "swoop-recharge-5-6", [])).toThrow(CommandRejectedError);
  });

  it("carries the grappled creature up with the roc, and drops it to fall as the flight ends", () => {
    const built = table("roc");
    for (const [id, at] of [
      [IDS.monster, cell(2, 2)],
      [IDS.hero, cell(4, 2)],
      [IDS.ally, cell(12, 12)]
    ] as const)
      moveEncounterToken(built.state, id, at, GRID);
    use(built, "talons", [IDS.hero], [19]);
    expect(conditionsOf(built, IDS.hero)).toContain("grappled");
    use(built, "swoop-recharge-5-6", []);
    const grant = actor(built, IDS.monster).effects.find((effect) => effect.grantedMove)?.grantedMove;
    expect(grant).toMatchObject({ mode: "fly", provokes: false, dropsHeld: true });
    // The roc flies 60 feet up and across, its prey with it.
    const from = tokenOf(built.state, IDS.monster).position!;
    moveEncounterToken(built.state, IDS.monster, cell(6, 2), GRID);
    setAltitude(built.state, IDS.monster, 60, "fly");
    dragAlong(built.state, [IDS.hero], from, tokenOf(built.state, IDS.monster).position!, GRID, 60);
    expect(tokenOf(built.state, IDS.hero).altitudeFeet).toBe(60);
    const deps = { resolveDefinition: built.resolveDefinition };
    expect(needsSettling(built.state, deps)).toBe(false);
    const events = dropGrappled(built.state, IDS.monster);
    expect(events.map((event) => event.text)).toContain("Roc drops Hero.");
    expect(conditionsOf(built, IDS.hero)).not.toContain("grappled");
    expect(needsSettling(built.state, deps)).toBe(true);
  });
});

describe("a weretiger's Prowl", () => {
  const hideBonus = (built: Table) => builtinActionFor(built.definition, "hide-bonus", actor(built, IDS.monster));

  it("offers no Hide as a Bonus Action of its own", () => {
    const built = table("weretiger");
    expect(hideBonus(built)).toBeUndefined();
  });

  it("offers a Hide that takes no action once its move ends, and only once", () => {
    const built = table("weretiger");
    built.state.combat = { ...built.state.combat, turn: { ...built.state.combat.turn, bonusActionUsed: true } };
    offerHideAfterMove(built.state, IDS.monster, "Prowl (Tiger or Hybrid Form Only)");
    const hide = hideBonus(built)!;
    expect(hide.name).toBe("Prowl: Hide");
    const resolve = () =>
      resolveDefinitionAction(
        built.state,
        hide,
        { actorId: IDS.monster, targetIds: [], commandId: nextId(), builtin: true },
        {
          random: () => 15,
          newRollId: nextId,
          gmSessionId: IDS.gm,
          now: NOW,
          definition: built.definition,
          resolveDefinition: built.resolveDefinition
        }
      );
    resolve();
    expect(builtinActionsFor(built.definition, actor(built, IDS.monster)).some((a) => a.id === "hide-bonus")).toBe(
      false
    );
  });
});

describe("an allosaurus's charge", () => {
  const strike = (built: Table, actionId: string, targetId: string, extra = {}) => {
    const action = built.definition.actions.find((entry) => entry.id === actionId)!;
    return resolveDefinitionAction(
      built.state,
      action,
      { actorId: IDS.monster, targetIds: [targetId], commandId: nextId(), ...extra },
      {
        random: (sides) => Math.min(sides, 15),
        newRollId: nextId,
        gmSessionId: IDS.gm,
        now: NOW,
        definition: built.definition,
        resolveDefinition: built.resolveDefinition
      }
    );
  };

  it("lets it make one Bite against the target its charge knocked Prone, and no other", () => {
    const built = table("allosaurus");
    strike(built, "claws", IDS.hero, { hitOptions: [{ id: "charge" }] });
    expect(conditionsOf(built, IDS.hero)).toContain("prone");
    expect(() => strike(built, "bite", IDS.ally)).toThrow(RulesBlockedError);
    expect(strike(built, "bite", IDS.hero).attack?.outcome).toBeDefined();
    expect(() => strike(built, "bite", IDS.hero)).toThrow(RulesBlockedError);
  });

  it("opens no Bite after a hit with no charge", () => {
    const built = table("allosaurus");
    strike(built, "claws", IDS.hero);
    expect(() => strike(built, "bite", IDS.hero)).toThrow(RulesBlockedError);
  });
});

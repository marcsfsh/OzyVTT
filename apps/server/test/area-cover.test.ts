import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveInput } from "../src/action-resolution.js";
import { castAreaOf } from "../src/item-actions.js";
import { castOf, view } from "./spell-casters.js";
import { cell, DIVIDER, GOBLIN, HERO, ORC, visionGame, wall } from "./vision-fixtures.js";

// SRD 5.2.1 Cover: "A target can benefit from cover only when an attack or other effect originates on the opposite
// side of the cover", so an area's Dexterity saves read the walls between its point of origin and each creature. And
// Spells, "A Clear Path to the Target": each creature picked for a spell of several targets can't be behind Total Cover.

let count = 0;
const id = (prefix: string) => `${prefix}-0000-4000-8000-${String(++count).padStart(12, "0")}`;

function cast(state: GameState, spellId: string, input: Partial<ResolveInput>) {
  const spell = view.spellRecord(spellId)!;
  const base = castOf(spellId);
  const action = { ...base, ...castAreaOf(spell, base) } as ActorAction;
  return resolveDefinitionAction(
    state,
    action,
    { actorId: HERO, targetIds: [GOBLIN], commandId: id("60000000"), ...input },
    {
      random: () => 3,
      newRollId: () => id("40000000"),
      gmSessionId: "30000000-0000-4000-8000-00000000000a",
      now: () => "2026-10-19T00:00:00.000Z",
      resolveDefinition: () => undefined
    }
  );
}

const bonusOf = (state: GameState, targetId: string) =>
  state.combat.pendingSaves.find((save) => save.targetActorId === targetId)?.saveBonus;

// A Fireball centred at cell (8, 8), three cells below the goblin at (8, 5). A stretch of wall at y = 320 hides three
// of the goblin's corners from that point; the orc at (11, 8) stands in the open.
const LOW_WALL = () => wall({ x: 380, y: 320 }, { x: 441, y: 320 });
const ORIGIN = cell(8, 8);

describe("cover from an area's point of origin", () => {
  it("gives the goblin Three-Quarters Cover (+5) against the Fireball, and the orc in the open none", () => {
    const state = visionGame({ walls: [LOW_WALL()], positions: { [ORC]: cell(11, 8) } });
    cast(state, "fireball", { targetIds: [GOBLIN, ORC], areaPlaced: true, areaOrigin: ORIGIN });
    expect(bonusOf(state, GOBLIN)).toBe(5);
    expect(bonusOf(state, ORC) ?? 0).toBe(0);
  });

  it("reads the origin from the template drawn with the cast's command when the cast resolves later", () => {
    const commandId = id("60000000");
    const state = visionGame({
      walls: [LOW_WALL()],
      positions: { [ORC]: cell(11, 8) },
      annotations: [
        {
          id: commandId,
          kind: "shape",
          shape: "circle",
          geometry: { origin: ORIGIN, target: cell(12, 8), sizeFeet: 20 },
          ownerSessionId: "30000000-0000-4000-8000-00000000000a",
          createdByRole: "gm",
          visibility: "public",
          visibleToActorId: null,
          movableByOthers: false,
          color: "#58c3ff",
          label: null,
          createdAt: 0,
          expiresAt: null
        }
      ]
    });
    cast(state, "fireball", { targetIds: [GOBLIN, ORC], areaPlaced: true, commandId });
    expect(bonusOf(state, GOBLIN)).toBe(5);
  });

  it("gives nothing with the scene's vision off", () => {
    const state = visionGame({ enabled: false, walls: [LOW_WALL()], positions: { [ORC]: cell(11, 8) } });
    cast(state, "fireball", { targetIds: [GOBLIN, ORC], areaPlaced: true, areaOrigin: ORIGIN });
    expect(bonusOf(state, GOBLIN) ?? 0).toBe(0);
  });
});

describe("a clear path to each picked target", () => {
  it("refuses Bless on two creatures when a wall leaves one of them Total Cover", () => {
    const state = visionGame({ walls: [DIVIDER()], positions: { [ORC]: cell(3, 5) } });
    expect(() => cast(state, "bless", { targetIds: [ORC, GOBLIN] })).toThrow(
      /A target has Total Cover and can.t be targeted directly/
    );
    expect(() =>
      cast(visionGame({ positions: { [ORC]: cell(3, 5) } }), "bless", { targetIds: [ORC, GOBLIN] })
    ).not.toThrow();
  });
});

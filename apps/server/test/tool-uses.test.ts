import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { deriveActorSheet } from "../src/actor-derived.js";
import { rollAbilityCheck, type CheckRollDependencies } from "../src/check-rolls.js";
import { useDoor } from "../src/doors.js";
import { effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { withFastHands } from "../src/fast-hands.js";
import { rollItemUse, rollUtilizeCheck, spendFastHandsCheck } from "../src/tool-uses.js";
import { utilizeUses } from "../src/utilize.js";
import { catalog, catalogRow, library } from "./equipment-table.js";
import { cell, FRIEND, HERO, visionGame, wall } from "./vision-fixtures.js";

// SRD 5.2.1 Tools: "Utilize. This entry lists things you can do with the tool when you take the Utilize action ...
// This entry also provides the DC for the action." A tool or a piece of gear works only while it is carried; in a fight
// each use takes the action, and a Thief's Fast Hands takes it as a Bonus Action instead.

const PIP = "10000000-0000-4000-8000-0000000000d1";
const BREN = "10000000-0000-4000-8000-0000000000d2";
const SESSION = "30000000-0000-4000-8000-0000000000d1";
const PLAYER = { role: "player", sessionId: SESSION } as const;
const GM = { role: "gm" } as const;

/** Pip: Dex 16, PB 3, proficient with Sleight of Hand, Thieves' Tools and Cobbler's Tools. */
const pipSheet = (features: string[] = []): ActorDefinition =>
  ({
    name: "Pip",
    armorClass: 14,
    proficiencyBonus: 3,
    abilityScores: { str: 10, dex: 16, con: 12, int: 10, wis: 14, cha: 12 },
    hitPoints: { maximum: 30 },
    speedFeet: 30,
    actions: [],
    extensions: {},
    character: {
      classes: [{ id: "rogue", name: "Rogue", level: 5, subclass: { id: "thief", name: "Thief" } }],
      feats: [],
      features: features.map((id) => ({ id, kind: "subclass", sourceId: "thief" }))
    },
    proficiencies: {
      saves: ["dex", "int"],
      skills: [{ id: "sleight-of-hand", proficiency: "proficient" }],
      tools: ["thieves-tools", "cobblers-tools"]
    }
  }) as unknown as ActorDefinition;

function table(options: Readonly<{ inventory?: unknown[]; fight?: boolean; features?: string[] }> = {}) {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: PIP,
        name: "Pip",
        kind: "player-character",
        visibility: "public",
        hp: { current: 30, maximum: 30 },
        definitionId: "pip-def",
        ownerSessionId: SESSION,
        inventory: options.inventory ?? []
      },
      {
        id: BREN,
        name: "Bren",
        kind: "player-character",
        visibility: "public",
        hp: { current: 30, maximum: 30 },
        definitionId: "bren-def"
      }
    ],
    combat: options.fight
      ? {
          active: true,
          round: 1,
          turnActorId: PIP,
          initiative: [
            { actorId: PIP, score: 20 },
            { actorId: BREN, score: 10 }
          ]
        }
      : {}
  }) as GameState;
  const sheet = pipSheet(options.features ?? []);
  let id = 0;
  const faces: number[] = [];
  const deps: CheckRollDependencies = {
    random: (sides) => Math.min(sides, faces.shift() ?? 10),
    newId: () => `40000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    sessionId: SESSION,
    now: () => "2026-10-19T00:00:00.000Z",
    resolveDefinition: (definitionId) => (definitionId === "pip-def" ? sheet : undefined),
    catalog,
    names: { tool: (toolId) => catalog.equipmentRecord(toolId)?.name }
  };
  return { state, deps, faces, sheet, pip: () => state.actors.find((actor) => actor.id === PIP)! };
}

const commandId = "50000000-0000-4000-8000-0000000000d1";
const toolUse = (itemId: string, use: number, extra: Record<string, unknown> = {}) => ({
  commandId,
  actorId: PIP,
  itemId,
  use,
  visibility: "public" as const,
  ...extra
});

describe("a tool's printed Utilize uses", () => {
  it("reads each tool's uses, DCs and ability from its record", () => {
    expect(utilizeUses(catalog.equipmentRecord("thieves-tools"))).toEqual([
      { label: "Pick a lock", dc: 15, ability: "dex", tool: "thieves-tools", skill: "sleight-of-hand" },
      { label: "Disarm a trap", dc: 15, ability: "dex", tool: "thieves-tools", skill: "sleight-of-hand" }
    ]);
    expect(utilizeUses(catalog.equipmentRecord("cooks-utensils"))).toEqual([
      { label: "Improve food's flavor", dc: 10, ability: "wis", tool: "cooks-utensils" },
      { label: "Detect spoiled or poisoned food", dc: 15, ability: "wis", tool: "cooks-utensils" }
    ]);
    expect(utilizeUses(catalog.equipmentRecord("grappling-hook"))).toEqual([
      { label: "Throw the hook at a catch within 50 feet", dc: 13, ability: "dex", skill: "acrobatics" }
    ]);
  });

  it("gives every SRD tool at least one use with its ability", () => {
    const tools = library.equipmentSummaries().filter((item) => item.category === "tool");
    expect(tools.length).toBeGreaterThanOrEqual(37);
    for (const tool of tools) expect(utilizeUses(catalog.equipmentRecord(tool.id)).length, tool.id).toBeGreaterThan(0);
  });

  it("rolls the record's DC with the tool's proficiency, and Advantage with the skill it uses", () => {
    const { state, deps } = table({ inventory: [catalogRow("thieves-tools", { equipped: false })] });
    const result = rollItemUse(state, PLAYER, toolUse("thieves-tools", 0), deps);
    expect(result.outcome).toMatchObject({
      label: "Pick a lock (Thieves' Tools)",
      dc: 15,
      // Dex +3, the Proficiency Bonus once (+3); Sleight of Hand and the tool together give Advantage.
      total: 16,
      rollMode: { mode: "advantage" }
    });
  });

  it("names a long use's roll by the use alone, so the name stays whole", () => {
    const { state, deps } = table({ inventory: [catalogRow("calligraphers-supplies")] });
    const result = rollItemUse(state, PLAYER, toolUse("calligraphers-supplies", 0), deps);
    expect(result.outcome?.label).toBe("Write text with impressive flourishes that guard against forgery");
  });

  it("refuses a use of a tool that isn't in the pack", () => {
    const { state, deps } = table();
    expect(() => rollItemUse(state, PLAYER, toolUse("thieves-tools", 0), deps)).toThrowError(
      "Pip needs Thieves' Tools in the pack to do that."
    );
  });

  it("refuses a use the record doesn't print", () => {
    const { state, deps } = table({ inventory: [catalogRow("thieves-tools")] });
    expect(() => rollItemUse(state, PLAYER, toolUse("thieves-tools", 4), deps)).toThrowError(
      "That item has no such use."
    );
  });

  it("spends nothing outside a fight", () => {
    const { state, deps } = table({ inventory: [catalogRow("thieves-tools")] });
    rollItemUse(state, PLAYER, toolUse("thieves-tools", 0), deps);
    rollItemUse(state, PLAYER, toolUse("thieves-tools", 1), deps);
    expect(state.combat.turn.actionUsed).toBe(false);
  });

  it("takes the Utilize action in a fight, and strict rules refuse a second", () => {
    const { state, deps } = table({ inventory: [catalogRow("thieves-tools")], fight: true });
    rollItemUse(state, PLAYER, toolUse("thieves-tools", 0), deps);
    expect(state.combat.turn.actionUsed).toBe(true);
    expect(() => rollItemUse(state, PLAYER, toolUse("thieves-tools", 1), deps)).toThrowError(
      "Pip has already used an Action this turn."
    );
  });

  it("refuses a player's use on another creature's turn", () => {
    const { state, deps } = table({ inventory: [catalogRow("thieves-tools")], fight: true });
    state.combat = { ...state.combat, turnActorId: BREN };
    expect(() => rollItemUse(state, PLAYER, toolUse("thieves-tools", 0), deps)).toThrowError(
      "Pick a lock (Thieves' Tools) on Pip's turn."
    );
  });

  it("takes the action for a tool check against a DC too, the tool carried", () => {
    const { state, deps } = table({ inventory: [catalogRow("cobblers-tools")], fight: true });
    rollUtilizeCheck(
      state,
      PLAYER,
      {
        commandId,
        actorId: PIP,
        itemId: "cobblers-tools",
        subject: { ability: "dex", tool: "cobblers-tools" },
        dc: 10,
        label: "Cobbler's Tools (Dexterity)",
        visibility: "public"
      },
      deps
    );
    expect(state.combat.turn.actionUsed).toBe(true);
  });
});

describe("a piece of gear's Utilize check", () => {
  it("throws a Grappling Hook with a DC 13 Dexterity (Acrobatics) check, taking the Utilize action", () => {
    const { state, deps, faces } = table({ inventory: [catalogRow("grappling-hook")], fight: true });
    faces.push(9);
    const result = rollItemUse(state, PLAYER, toolUse("grappling-hook", 0), deps);
    expect(result.outcome).toMatchObject({
      label: "Throw the hook at a catch within 50 feet (Grappling Hook)",
      dc: 13,
      total: 12,
      success: false
    });
    expect(state.combat.turn.actionUsed).toBe(true);
  });

  it("offers a carried hook's use on the sheet with the check's bonus", () => {
    const { pip, sheet } = table({ inventory: [catalogRow("grappling-hook")] });
    const derived = deriveActorSheet(pip(), sheet, deriveEquipment(pip(), sheet, catalog), [], catalog);
    expect(derived.gearUses).toEqual([
      {
        id: "grappling-hook",
        name: "Grappling Hook",
        uses: [
          expect.objectContaining({
            label: "Throw the hook at a catch within 50 feet",
            dc: 13,
            ability: "dex",
            bonus: 3
          })
        ]
      }
    ]);
  });

  it("lists a tool the character carries without proficiency, and whether each tool is carried", () => {
    const { pip, sheet } = table({ inventory: [catalogRow("herbalism-kit")] });
    const derived = deriveActorSheet(pip(), sheet, deriveEquipment(pip(), sheet, catalog), [], catalog);
    expect(derived.tools.find((tool) => tool.id === "herbalism-kit")).toMatchObject({
      proficient: false,
      carried: true,
      bonus: 0
    });
    expect(derived.tools.find((tool) => tool.id === "thieves-tools")).toMatchObject({
      proficient: true,
      carried: false
    });
  });
});

describe("Cobbler's Tools' modified footwear", () => {
  it("gives the wearer Advantage on its next Dexterity (Acrobatics) check only", () => {
    const { state, deps, faces } = table({ inventory: [catalogRow("cobblers-tools")] });
    faces.push(10);
    const modified = rollItemUse(state, PLAYER, toolUse("cobblers-tools", 0, { forActorId: BREN }), deps);
    expect(modified.outcome.success).toBe(true);
    const bren = state.actors.find((actor) => actor.id === BREN)!;
    expect(bren.effects.map((effect) => effect.name)).toEqual(["Modified footwear"]);
    const brenDeps = { ...deps, resolveDefinition: () => undefined };
    const check = (skill: string) =>
      rollAbilityCheck(
        state,
        GM,
        { commandId, actorId: BREN, subject: { ability: "dex", skill }, dc: null, visibility: "public" },
        brenDeps
      );
    expect(check("stealth").outcome.rollMode).toBeUndefined();
    expect(check("acrobatics").outcome.rollMode).toMatchObject({ mode: "advantage" });
    expect(check("acrobatics").outcome.rollMode).toBeUndefined();
    expect(bren.effects).toEqual([]);
  });

  it("leaves nothing on a failure", () => {
    const { state, deps, faces } = table({ inventory: [catalogRow("cobblers-tools")] });
    faces.push(1);
    const modified = rollItemUse(state, PLAYER, toolUse("cobblers-tools", 0, { forActorId: BREN }), deps);
    expect(modified.outcome.success).toBe(false);
    expect(state.actors.find((actor) => actor.id === BREN)!.effects).toEqual([]);
  });

  it("refuses a wearer beyond 5 feet when the map can tell", () => {
    const { state, deps } = table({ inventory: [catalogRow("cobblers-tools")] });
    expect(() =>
      rollItemUse(state, PLAYER, toolUse("cobblers-tools", 0, { forActorId: BREN }), {
        ...deps,
        distanceFeet: () => 15
      })
    ).toThrowError("Bren is too far away. Move within 5 feet first.");
  });
});

describe("Fast Hands", () => {
  it("takes a Thief's tool use as a Bonus Action, leaving the action", () => {
    const { state, deps } = table({ inventory: [catalogRow("thieves-tools")], fight: true, features: ["fast-hands"] });
    rollItemUse(state, PLAYER, toolUse("thieves-tools", 0, { bonusAction: true }), deps);
    expect(state.combat.turn).toMatchObject({ actionUsed: false, bonusActionUsed: true });
  });

  it("refuses the Bonus Action to a creature without Fast Hands", () => {
    const { state, deps } = table({ inventory: [catalogRow("thieves-tools")], fight: true });
    expect(() => rollItemUse(state, PLAYER, toolUse("thieves-tools", 0, { bonusAction: true }), deps)).toThrowError(
      "Pip has no Fast Hands to take this as a Bonus Action."
    );
  });

  it("makes a Sleight of Hand check as a Bonus Action, and no other check", () => {
    const { state, deps } = table({ fight: true, features: ["fast-hands"] });
    expect(() => spendFastHandsCheck(state, PLAYER, PIP, { ability: "dex", skill: "stealth" }, deps)).toThrowError(
      "Fast Hands makes a Dexterity (Sleight of Hand) check as a Bonus Action."
    );
    spendFastHandsCheck(state, PLAYER, PIP, { ability: "dex", skill: "sleight-of-hand" }, deps);
    expect(state.combat.turn).toMatchObject({ actionUsed: false, bonusActionUsed: true });
  });

  it("picks a door's lock as a Bonus Action", () => {
    const entrance = {
      ...wall({ x: 250, y: 250 }, { x: 250, y: 300 }, "door", false),
      door: { fastenings: [{ kind: "lock" as const }] }
    };
    const state = visionGame({
      walls: [entrance],
      positions: { [HERO]: cell(4, 5), [FRIEND]: cell(4, 4) },
      actors: { [HERO]: { inventory: [catalogRow("thieves-tools")], definitionId: "pip-def" } }
    });
    state.combat = {
      ...state.combat,
      active: true,
      turnActorId: HERO,
      initiative: [
        { actorId: HERO, score: 20, tieBreaker: 0 },
        { actorId: FRIEND, score: 10, tieBreaker: 0 }
      ]
    };
    const sheet = pipSheet(["fast-hands"]);
    let id = 0;
    useDoor(
      state,
      { wallId: entrance.id, actorId: HERO, how: "pick", visibility: "public", bonusAction: true },
      { role: "gm" },
      {
        random: () => 20,
        newId: () => `40000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
        commandId,
        sessionId: SESSION,
        now: () => "2026-10-19T00:00:00.000Z",
        resolveDefinition: (definitionId) => (definitionId === "pip-def" ? sheet : undefined),
        catalog
      }
    );
    expect(state.combat.turn).toMatchObject({ actionUsed: false, bonusActionUsed: true });
  });

  it("uses a wand's Magic action as a Bonus Action and keeps the action", () => {
    const { state, sheet, pip } = table({
      inventory: [catalogRow("wand-of-magic-missiles", { equipped: true })],
      fight: true,
      features: ["fast-hands"]
    });
    const wand = effectiveActions(sheet, pip(), catalog).find((action) => action.spellId === "magic-missile")!;
    expect(wand.activation).toBe("action");
    let id = 0;
    resolveDefinitionAction(
      state,
      withFastHands(wand, pip(), sheet),
      { actorId: PIP, targetIds: [BREN], commandId },
      {
        random: () => 1,
        newRollId: () => `40000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
        gmSessionId: SESSION,
        now: () => "2026-10-19T00:00:00.000Z",
        catalog,
        definition: sheet,
        resolveDefinition: (definitionId) => (definitionId === "pip-def" ? sheet : undefined)
      }
    );
    expect(state.combat.turn).toMatchObject({ actionUsed: false, bonusActionUsed: true });
  });

  it("refuses a weapon attack and a creature without the feature", () => {
    const { sheet, pip } = table({ inventory: [catalogRow("dagger", { equipped: true })] });
    const dagger = effectiveActions(sheet, pip(), catalog).find((action) => action.id.includes("dagger"))!;
    expect(() => withFastHands(dagger, pip(), pipSheet(["fast-hands"]))).toThrowError(
      /Fast Hands takes an item's Utilize or Magic action as a Bonus Action/
    );
    expect(() => withFastHands(dagger, pip(), sheet)).toThrowError(
      "Pip has no Fast Hands to take this as a Bonus Action."
    );
  });
});

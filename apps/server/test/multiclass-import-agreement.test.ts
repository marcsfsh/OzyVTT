import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import { buildDefinition, validateDraft, type Widget } from "@vtt/dndbeyond-pdf";
import type { ActorDefinition } from "@vtt/schemas";
import { abilityModifier } from "@vtt/rules-5e";
import { buildCharacterDefinition } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { importActorDefinition, pactSlotMaximum, spellSlotMaxima, withDerivedSlots } from "../src/actor-roster.js";
import { ContentLibrary } from "../src/content-library.js";

// A multiclass character built here and the same character imported from a D&D Beyond PDF must play the same: the
// Hit Dice pool, spell slots, Pact Magic, proficiency bonus and hit point maximum the server derives from each sheet
// agree. The PDF side runs the real extraction over the form fields D&D Beyond prints for that character.

const library = new ContentLibrary().forAudience("gm");
const policy = BuilderPolicySchema.parse({});
const ACTOR_ID = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10";

/** A seeded stand-in for `context.random` (mulberry32). */
function seeded(seed: number): (sides: number) => number {
  let state = seed >>> 0;
  return (sides: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (((mixed ^ (mixed >>> 14)) >>> 0) % sides) + 1;
  };
}

/** The multiclass character built from choices, with the fixed hit points D&D Beyond's average setting uses. */
function built(plan: ReadonlyArray<{ classId: string; level: number }>): ActorDefinition {
  const level = plan.reduce((total, entry) => total + entry.level, 0);
  const { request } = generateCharacterRequest({ level, classes: plan }, library, policy, seeded(5));
  return buildCharacterDefinition({ ...request, hp: { mode: "average" } }, library, policy);
}

const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

/** The form fields D&D Beyond prints for a sheet, as the PDF reader returns them. */
function sheetWidgets(sheet: {
  classLevel: string;
  scores: ActorDefinition["abilityScores"];
  maxHp: number;
  hitDice: string;
  proficiencyBonus: number;
  slots: readonly number[];
  casting: { ability: string; classes: string };
}): Widget[] {
  const field = (name: string, value: string, page = 1, y = 100): Widget => ({ name, value, page, x: 40, y });
  const scores = (["str", "dex", "con", "int", "wis", "cha"] as const).map((ability, index) =>
    field(ability.toUpperCase(), String(sheet.scores[ability]), 1, 150 + index * 70)
  );
  const slotHeaders = sheet.slots.flatMap((count, index) => [
    field(`spellHeader${index + 1}`, `=== ${ORDINAL[index + 1]} LEVEL ===`, 5, 200 + index * 100),
    field(`spellSlotHeader${index + 1}`, `${count} Slots ${"O".repeat(count)}`, 5, 200 + index * 100)
  ]);
  return [
    field("CharacterName", "Imported"),
    field("CLASS  LEVEL", sheet.classLevel),
    ...scores,
    field("AC", "16"),
    field("MaxHP", String(sheet.maxHp)),
    field("Total", sheet.hitDice),
    field("ProfBonus", `+${sheet.proficiencyBonus}`),
    field("Speed", "30 ft. (Walking)"),
    field("spellHeader0", "=== CANTRIPS ===", 5, 150),
    field("spellSlotHeader0", "(At Will)", 5, 150),
    ...slotHeaders,
    field("spellCastingAbility0", sheet.casting.ability, 5, 56),
    field("spellCastingClass0", sheet.casting.classes, 5, 65)
  ];
}

/** What the server derives from a sheet once it is on the table. */
function derived(definition: ActorDefinition) {
  const state = GameStateSchema.parse({ schemaVersion: 1 }) as GameState;
  const landed = withDerivedSlots(definition, library.classProgressionTable());
  importActorDefinition(state, landed, ACTOR_ID, "public");
  const actor = state.actors.find((entry) => entry.id === ACTOR_ID)!;
  return {
    hitDice: actor.hitDice?.entries,
    hitPoints: actor.hp.maximum,
    proficiencyBonus: landed.proficiencyBonus,
    slots: spellSlotMaxima(landed),
    pact: pactSlotMaximum(landed)
  };
}

function imported(widgets: Widget[]): ActorDefinition {
  const { draft, warnings } = buildDefinition(widgets);
  const result = validateDraft(draft, warnings);
  if (!result.definition) throw new Error(result.issues.join("; "));
  return result.definition;
}

describe("a built multiclass character and its D&D Beyond import agree", () => {
  it("Cleric 5 / Paladin 5: 5d8 + 5d10, the shared table at caster level 8, proficiency +4", () => {
    const sheet = built([
      { classId: "cleric", level: 5 },
      { classId: "paladin", level: 5 }
    ]);
    const con = abilityModifier(sheet.abilityScores.con);
    const pdf = imported(
      sheetWidgets({
        classLevel: "Cleric 5 / Paladin 5",
        scores: sheet.abilityScores,
        // D&D Beyond's fixed hit points: the Cleric's d8 maximum once, then 5 per Cleric level and 6 per Paladin level.
        maxHp: 8 + con + 4 * (5 + con) + 5 * (6 + con),
        hitDice: "5d8 + 5d10",
        proficiencyBonus: 4,
        slots: [4, 3, 3, 2],
        casting: { ability: "WIS / CHA", classes: "Cleric / Paladin" }
      })
    );
    expect(derived(sheet)).toEqual(derived(pdf));
    expect(derived(sheet).slots.map((slot) => slot.max)).toEqual([4, 3, 3, 2]);
  });

  it("Fighter 3 / Wizard 2: the Wizard's own table, 3d10 + 2d6, proficiency +3", () => {
    const sheet = built([
      { classId: "fighter", level: 3 },
      { classId: "wizard", level: 2 }
    ]);
    const con = abilityModifier(sheet.abilityScores.con);
    const pdf = imported(
      sheetWidgets({
        classLevel: "Fighter 3 / Wizard 2",
        scores: sheet.abilityScores,
        maxHp: 10 + con + 2 * (6 + con) + 2 * (4 + con),
        hitDice: "3d10 + 2d6",
        proficiencyBonus: 3,
        slots: [3],
        casting: { ability: "INT", classes: "Wizard" }
      })
    );
    expect(derived(sheet)).toEqual(derived(pdf));
    expect(derived(sheet).hitDice).toEqual([
      { die: "d10", maximum: 3, remaining: 3 },
      { die: "d6", maximum: 2, remaining: 2 }
    ]);
  });
});

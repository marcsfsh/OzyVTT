import { describe, expect, it } from "vitest";
import { BuilderPolicySchema } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { STANDARD_ARRAY } from "@vtt/rules-5e";
import { builderOffers } from "../src/builder-offers.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";
import { sheetAbilityScores, sheetSourceOf } from "../src/sheet-abilities.js";

// A sheet built before the choice ledger recorded its ability scores still has to level: the Level flow seeds the
// builder from the base scores and background increase that rebuild its totals, and the rebuild may re-send them.
// Totals carry riders the client cannot see (Primal Champion's and Body and Mind's +4), so the server works them out.

const library = new ContentLibrary().forAudience("gm");
const policy = BuilderPolicySchema.parse({});

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

function built(input: { level: number; classId?: string; classes?: Array<{ classId: string; level: number }> }) {
  const { request } = generateCharacterRequest(input, library, policy, seeded(9));
  return { request, definition: buildCharacterDefinition(request, library, policy) };
}

/** The same sheet as one built before the ledger kept its ability scores. */
const withoutRecordedScores = (definition: ActorDefinition): ActorDefinition => ({
  ...definition,
  character: {
    ...definition.character!,
    choices: definition.character!.choices!.filter((row) => row.kind !== "ability-scores")
  }
});

/** The sheet rebuilt from the found scores: its totals must come back exactly. */
function rebuiltScores(
  request: CharacterCreateRequestInput,
  found: NonNullable<ReturnType<typeof sheetAbilityScores>>
) {
  return buildCharacterDefinition(
    {
      ...request,
      abilityMethod: found.abilityMethod,
      baseScores: found.baseScores,
      backgroundBonusAllocation: found.backgroundBonusAllocation,
      keepsRecordedScores: true
    },
    library,
    policy
  ).abilityScores;
}

describe("a sheet's ability scores for a rebuild", () => {
  it("reads the ledger's own record when it has one", () => {
    const { request, definition } = built({ level: 5, classId: "fighter" });
    expect(sheetAbilityScores(sheetSourceOf(definition)!, library)).toEqual({
      abilityMethod: "standard-array",
      baseScores: request.baseScores,
      backgroundBonusAllocation: request.backgroundBonusAllocation,
      derived: false
    });
  });

  for (const [classId, raised] of [
    ["barbarian", ["str", "con"]],
    ["monk", ["dex", "wis"]]
  ] as const)
    it(`works a level 20 ${classId}'s base scores back from totals that carry its capstone's +4`, () => {
      const { request, definition } = built({ level: 20, classId });
      const found = sheetAbilityScores(sheetSourceOf(withoutRecordedScores(definition))!, library);
      expect(found).toMatchObject({ derived: true, abilityMethod: "standard-array" });
      // The capstone's +4 is not part of the base: these are the standard array, which tops out at 15.
      expect(
        Object.values(found!.baseScores)
          .sort((left, right) => right - left)
          .join(",")
      ).toBe(STANDARD_ARRAY.join(","));
      for (const ability of raised)
        expect(definition.abilityScores[ability] - found!.baseScores[ability]).toBeGreaterThanOrEqual(4);
      expect(rebuiltScores(request, found!)).toEqual(definition.abilityScores);
    });

  it("follows a multiclass sheet's own class order", () => {
    const { request, definition } = built({
      level: 8,
      classes: [
        { classId: "fighter", level: 4 },
        { classId: "wizard", level: 4 }
      ]
    });
    const found = sheetAbilityScores(sheetSourceOf(withoutRecordedScores(definition))!, library);
    expect(found?.derived).toBe(true);
    expect(rebuiltScores(request, found!)).toEqual(definition.abilityScores);
  });

  it("finds nothing when no base scores could have made the totals", () => {
    const { definition } = built({ level: 3, classId: "fighter" });
    const edited = { ...withoutRecordedScores(definition), abilityScores: { ...definition.abilityScores, str: 30 } };
    expect(sheetAbilityScores(sheetSourceOf(edited)!, library)).toBeNull();
  });

  it("answers in the builder's offers only for a draft that sends its sheet", () => {
    const { definition } = built({ level: 20, classId: "barbarian" });
    const older = withoutRecordedScores(definition);
    const draft = {
      speciesId: older.character!.race!.id,
      backgroundId: older.character!.background!.id,
      classId: "barbarian",
      level: 19,
      choices: older.character!.choices!
    };
    expect(builderOffers(draft, library).abilities).toBeNull();
    const reply = builderOffers({ ...draft, sheet: { level: 20, abilityScores: older.abilityScores } }, library);
    expect(reply.abilities).toMatchObject({ abilityMethod: "standard-array", derived: true });
  });
});

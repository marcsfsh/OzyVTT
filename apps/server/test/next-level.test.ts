import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { BuilderPolicySchema, type GameState, type NextLevelReply } from "@vtt/domain";
import { abilityModifier } from "@vtt/rules-5e";
import { importActorDefinition, storedDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition } from "../src/character-build.js";
import { generateCharacterRequest, type GenerateCharacterInput } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";
import { createInitialGameState, PLACEHOLDER_ACTOR_IDS } from "../src/initial-game-state.js";
import { nextLevelOf } from "../src/next-level.js";
import { bootServer } from "./boot-server.js";

// What a character's next level brings, read from the builder's own survey at the next level: the lines the sheet's
// Level box and Features tab show, and who may ask.

const library = new ContentLibrary().forAudience("gm");
const policy = BuilderPolicySchema.parse({});
const { fighter: BORIN, wizard: LYRA } = PLACEHOLDER_ACTOR_IDS;

/** A character the random generator rolls from a fixed seed, so every run builds the same one. */
function rolled(input: GenerateCharacterInput) {
  let seed = 12345;
  const random = (sides: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return 1 + (seed % sides);
  };
  return buildCharacterDefinition(generateCharacterRequest(input, library, policy, random).request, library, policy);
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function table(mutate: (state: GameState) => void = () => {}) {
  const state = createInitialGameState();
  mutate(state);
  const booted = await bootServer(state);
  cleanups.push(booted.close);
  const read = async (actorId: string, token: string) => {
    const response = await fetch(booted.base + GAME_PATHS.characterNextLevel.replace("{actorId}", actorId), {
      headers: { authorization: `Bearer ${token}` }
    });
    const body = (await response.json()) as { data?: NextLevelReply; error?: { message: string } };
    return { status: response.status, data: body.data, message: body.error?.message };
  };
  const claim = (token: string, actorId: string) =>
    booted.post(GAME_PATHS.claims, token, { commandId: randomUUID(), actorId });
  return { ...booted, read, claim };
}

describe("what the next level brings", () => {
  it("reads Lyra's level 8 off the Wizard table and the builder's offers", async () => {
    const t = await table();
    const { status, data } = await t.read(LYRA, t.gmToken);
    expect(status).toBe(200);
    expect(data).toEqual({
      level: 8,
      classId: "wizard",
      className: "Wizard",
      classLevel: 8,
      lines: [
        "Ability Score Improvement",
        "A second level 4 spell slot",
        "One more prepared spell (12)",
        "Two Wizard spells for the spellbook",
        "Hit Points: 1d6 + 2, or the average of 6"
      ]
    });
  });

  it("names a subclass feature, a new slot level, one more cantrip and the Proficiency Bonus as they come", () => {
    const evoker = rolled({
      level: 9,
      classId: "wizard",
      subclassId: "evoker",
      speciesId: "human",
      backgroundId: "sage"
    });
    const ten = nextLevelOf(evoker, evoker, library, policy);
    expect(ten.lines).toEqual(
      expect.arrayContaining([
        "Empowered Evocation",
        "A second level 5 spell slot",
        "One more prepared spell (15)",
        "One more cantrip (5)",
        "Two Wizard spells for the spellbook"
      ])
    );
    const thief = rolled({
      level: 4,
      classId: "rogue",
      subclassId: "thief",
      speciesId: "human",
      backgroundId: "criminal"
    });
    expect(nextLevelOf(thief, thief, library, policy).lines[0]).toBe("Proficiency Bonus +3");
  });

  it("shows the subclass to choose at the level that asks for it", () => {
    const cleric = rolled({ level: 2, classId: "cleric", speciesId: "human", backgroundId: "acolyte" });
    const three = nextLevelOf(cleric, cleric, library, policy);
    expect(three.lines).toEqual(
      expect.arrayContaining(["Cleric Subclass", "A fourth level 1 spell slot", "Two level 2 spell slots"])
    );
  });

  it("adds the per-level Hit Points a feature gives to the class's die and Constitution", () => {
    const sorcerer = rolled({
      level: 3,
      classId: "sorcerer",
      subclassId: "draconic-sorcery",
      speciesId: "human",
      backgroundId: "sage"
    });
    // Draconic Resilience: 1 more Hit Point for each Sorcerer level.
    const bonus = abilityModifier(sorcerer.abilityScores.con) + 1;
    const line = nextLevelOf(sorcerer, sorcerer, library, policy).lines.at(-1);
    expect(line).toBe(`Hit Points: 1d6 + ${bonus}, or the average of ${4 + bonus}`);
  });

  it("levels a multiclass character in the class of its last level, and names that class's spells", () => {
    const both = rolled({
      level: 5,
      classes: [
        { classId: "cleric", level: 3 },
        { classId: "paladin", level: 2 }
      ],
      speciesId: "human",
      backgroundId: "acolyte"
    });
    const six = nextLevelOf(both, both, library, policy);
    expect(six).toMatchObject({ level: 6, classId: "paladin", className: "Paladin", classLevel: 3 });
    expect(six.lines).toEqual(
      expect.arrayContaining(["Paladin Subclass", "Two level 3 spell slots", "One more prepared Paladin spell (4)"])
    );
    expect(six.lines.at(-1)).toMatch(/^Hit Points: 1d10 /);
  });
});

describe("who may ask, and when there is no next level", () => {
  it("answers a player about their own character while the builder is open, and no other", async () => {
    const t = await table();
    const owner = t.server.auth.issuePlayerSession();
    const stranger = t.server.auth.issuePlayerSession();
    expect((await t.claim(owner, LYRA)).status).toBe(200);
    expect((await t.read(LYRA, owner)).status).toBe(200);
    expect(await t.read(LYRA, stranger)).toMatchObject({
      status: 403,
      message: "You can only read your own character's next level."
    });
    // A missing character gets the same answer as someone else's.
    expect((await t.read("00000000-0000-4000-8000-0000000000aa", stranger)).status).toBe(403);
    expect((await t.read("00000000-0000-4000-8000-0000000000aa", t.gmToken)).status).toBe(404);
  });

  it("refuses a player while the GM builds the characters, and answers the GM", async () => {
    const t = await table((state) => {
      state.builderPolicy = { ...state.builderPolicy, playerBuilder: "gm-only" };
    });
    const owner = t.server.auth.issuePlayerSession();
    expect((await t.claim(owner, LYRA)).status).toBe(200);
    expect(await t.read(LYRA, owner)).toMatchObject({
      status: 403,
      message: "Your GM builds the characters at this table."
    });
    expect((await t.read(LYRA, t.gmToken)).status).toBe(200);
  });

  it("refuses at the table's highest level, and for a sheet not built here", async () => {
    const t = await table((state) => {
      state.builderPolicy = { ...state.builderPolicy, maxLevel: 7 };
      // An import keeps no choices ledger, so the Level page can't read it back.
      const borin = state.actors.find((actor) => actor.id === BORIN)!;
      const { choices: _ledger, ...character } = storedDefinition(state, borin.definitionId!)!.character!;
      importActorDefinition(
        state,
        { ...storedDefinition(state, borin.definitionId!)!, name: "Imported Borin", character },
        "00000000-0000-4000-8000-0000000000bb",
        "public"
      );
    });
    expect(await t.read(LYRA, t.gmToken)).toMatchObject({
      status: 409,
      message: "This table builds characters up to level 7."
    });
    expect(await t.read("00000000-0000-4000-8000-0000000000bb", t.gmToken)).toMatchObject({
      status: 409,
      message: "Imported Borin wasn't built here, so the Level page can't read the next level."
    });
  });
});

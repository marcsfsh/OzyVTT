import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { BuilderPolicySchema, GameStateSchema } from "@vtt/domain";
import type { CharacterChoice } from "@vtt/schemas";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { CommandRejectedError } from "../src/game-store.js";
import { checkPlayerLevelChange } from "../src/level-up-picks.js";
import { bootServer } from "./boot-server.js";

// SRD 5.2.1 Bard: "Whenever you gain a Bard level, you can replace one of your cantrips with another cantrip of your
// choice from the Bard spell list", and "you can replace one spell on your list with another Bard spell for which you
// have spell slots". Every other earlier pick stays; changing it is a respec, which is the GM's.

const library = new ContentLibrary().forAudience("play");
const policy = BuilderPolicySchema.parse({});
const BARD = "72000000-0000-4000-8000-000000000001";

function seeded(seed: number): (sides: number) => number {
  let state = seed >>> 0;
  return (sides: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (((mixed ^ (mixed >>> 14)) >>> 0) % sides) + 1;
  };
}

/** The class's own spell rows of a kind: no feature made them. */
const classRows = (request: CharacterCreateRequestInput, kind: "cantrip" | "spell") =>
  request.choices.filter((row) => row.kind === kind && row.payload?.featureId === undefined);

/** A Bard 4's request and the Bard 3 it levels up from: the same picks, less the level 4 ones (a third cantrip, a
 *  seventh spell and the Ability Score Improvement). */
function bard() {
  const { request: four } = generateCharacterRequest({ classId: "bard", level: 4 }, library, policy, seeded(5));
  const added = new Set([classRows(four, "cantrip").at(-1), classRows(four, "spell").at(-1)]);
  const three: CharacterCreateRequestInput = {
    ...four,
    level: 3,
    choices: four.choices.filter((row) => row.level <= 3 && !added.has(row)),
    hp: four.hp.mode === "entries" ? { mode: "entries", entries: four.hp.entries!.slice(0, 2) } : four.hp
  };
  return { four, sheet: buildCharacterDefinition(three, library, policy) };
}

/** The earlier rows of a kind, which the level up keeps unless it replaces them. */
const earlierRows = (request: CharacterCreateRequestInput, kind: "cantrip" | "spell") =>
  classRows(request, kind).slice(0, -1);

/** The Bard spell list's cantrips and spells of `level` that the request hasn't taken. */
function unused(request: CharacterCreateRequestInput, level: number): string[] {
  const taken = new Set(request.choices.map((row) => row.id));
  return library
    .spellSummaries()
    .filter((spell) => spell.level === level && spell.classes.includes("bard") && !taken.has(spell.id))
    .map((spell) => spell.id);
}

function swap(request: CharacterCreateRequestInput, rows: readonly CharacterChoice[], into: readonly string[]) {
  const swapped = new Map(rows.map((row, index) => [row, into[index]!]));
  return {
    ...request,
    choices: request.choices.map((row) => (swapped.has(row) ? { ...row, id: swapped.get(row)! } : row))
  };
}

const check = (sheet: ReturnType<typeof bard>["sheet"], request: CharacterCreateRequestInput) =>
  checkPlayerLevelChange(sheet, request, library, policy);

describe("what a player's level up may change", () => {
  it("adds the new level's picks", () => {
    const { four, sheet } = bard();
    expect(() => check(sheet, four)).not.toThrow();
  });

  it("replaces one cantrip and one spell at a Bard level", () => {
    const { four, sheet } = bard();
    const oneEach = swap(
      four,
      [earlierRows(four, "cantrip")[0]!, earlierRows(four, "spell")[0]!],
      [unused(four, 0)[0]!, unused(four, 1)[0]!]
    );
    expect(() => check(sheet, oneEach)).not.toThrow();
  });

  it("refuses a second cantrip replaced at the same level up", () => {
    const { four, sheet } = bard();
    const two = swap(four, earlierRows(four, "cantrip").slice(0, 2), unused(four, 0).slice(0, 2));
    expect(() => check(sheet, two)).toThrowError(/may replace 1 of Bard cantrips, and the rebuild replaces 2/);
  });

  it("refuses a changed skill, a changed background and new ability scores", () => {
    const { four, sheet } = bard();
    const skill = four.choices.find((row) => row.kind === "skill" && row.level === 1)!;
    const taken = new Set(four.choices.filter((row) => row.kind === "skill").map((row) => row.id));
    const other = library.skillSummaries().find((candidate) => !taken.has(candidate.id))!.id;
    const reskilled = { ...four, choices: four.choices.map((row) => (row === skill ? { ...row, id: other } : row)) };
    expect(() => check(sheet, reskilled)).toThrowError(CommandRejectedError);
    expect(() => check(sheet, { ...four, backgroundId: four.backgroundId === "sage" ? "soldier" : "sage" })).toThrow(
      /keeps the species, background and first class/
    );
    const scores = { ...four.baseScores, str: four.baseScores.str === 8 ? 10 : 8 };
    expect(() => check(sheet, { ...four, baseScores: scores })).toThrow(/keeps the ability scores/);
  });

  it("refuses a rebuild at the same level that changes a pick", () => {
    const { four, sheet } = bard();
    const added = new Set([classRows(four, "cantrip").at(-1), classRows(four, "spell").at(-1)]);
    const three = { ...four, level: 3, choices: four.choices.filter((row) => row.level <= 3 && !added.has(row)) };
    const hp = sheet
      .character!.choices!.filter((row) => row.kind === "hp-roll")
      .map((row) => row.payload!.roll as number);
    const same = { ...three, hp: { mode: "entries" as const, entries: hp } };
    expect(() => check(sheet, same)).not.toThrow();
    const swapped = swap(same, [earlierRows(four, "cantrip")[0]!], [unused(four, 0)[0]!]);
    expect(() => check(sheet, swapped)).toThrow(/without a level up/);
  });
});

describe("the rebuild command", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("refuses a player's level up that respecs, and takes the GM's", async () => {
    const { four, sheet } = bard();
    const state = GameStateSchema.parse({ schemaVersion: 1 });
    importActorDefinition(state, sheet, BARD, "public", equipmentCatalogOf(library));
    const { server, gmToken, post, close } = await bootServer(state);
    cleanups.push(close);
    const player = server.auth.issuePlayerSession();
    expect((await post(GAME_PATHS.claims, player, { commandId: randomUUID(), actorId: BARD })).status).toBe(200);
    const skill = four.choices.find((row) => row.kind === "skill" && row.level === 1)!;
    const taken = new Set(four.choices.filter((row) => row.kind === "skill").map((row) => row.id));
    const other = library.skillSummaries().find((candidate) => !taken.has(candidate.id))!.id;
    const {
      name: _name,
      keepsRecordedScores: _kept,
      ...build
    } = {
      ...four,
      choices: four.choices.map((row) => (row === skill ? { ...row, id: other } : row))
    };
    const rebuild = (token: string) =>
      post(GAME_PATHS.characterRebuild.replace("{actorId}", BARD), token, { commandId: randomUUID(), ...build });

    const refused = await rebuild(player);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.details.reason).toBe("level_up_limit");
    expect((await rebuild(gmToken)).status).toBe(200);
  });
});

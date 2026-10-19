import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { importActorDefinition } from "../src/actor-roster.js";
import { setCharacterProficiencies } from "../src/character-edit.js";
import { buildCharacterDefinition } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";
import { CONTENT_STAMP } from "../src/content-stamp.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { buildRequestOf } from "../src/ledger-rechoice.js";
import { refreshBuiltSheets } from "../src/sheet-refresh.js";
import { SHEET_PROFICIENCIES_KIND } from "../src/sheet-proficiency-edits.js";
import { bootServer } from "./boot-server.js";

// A built sheet bakes in what its content gave when it was built, so every stored character is rebuilt from its
// choices ledger at the same level when the content it was built from changes.

const library = new ContentLibrary().forAudience("play");
const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});
const RANGER = "71000000-0000-4000-8000-000000000001";
const MOVE_MARK = /^spell-hunters-mark-then-/;

/** A seeded stand-in for the dice (mulberry32), so the generated character is the same every run. */
function seeded(seed: number): (sides: number) => number {
  let state = seed >>> 0;
  return (sides: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (((mixed ^ (mixed >>> 14)) >>> 0) % sides) + 1;
  };
}

function ranger(level = 3): ActorDefinition {
  const { request } = generateCharacterRequest({ classId: "ranger", level }, library, policy, seeded(11));
  return buildCharacterDefinition(request, library, policy);
}

/** The sheet as an older bundle built it: no Hunter's Mark move, and an older stamp. */
function builtBefore(definition: ActorDefinition): ActorDefinition {
  return {
    ...definition,
    source: { ...definition.source, version: "1" },
    actions: definition.actions.filter((action) => !MOVE_MARK.test(action.id))
  };
}

/** A table holding the character, with live state the rebuild must keep. */
function table(definition: ActorDefinition): GameState {
  const state = GameStateSchema.parse({ schemaVersion: 1 });
  importActorDefinition(state, definition, RANGER, "public", catalog);
  const hero = state.actors[0]!;
  hero.hp = { ...hero.hp, current: hero.hp.current - 7, temporary: 3 };
  hero.actionUses = { "favored-enemy": 1 };
  hero.spellSlots = hero.spellSlots!.map((slot) =>
    slot.level === 1 ? { ...slot, remaining: slot.remaining - 1 } : slot
  );
  hero.conditions = [{ id: "poisoned" }];
  hero.notes = "Owes the ferryman.";
  hero.inventory = [...hero.inventory, { id: "torch", name: "Torch", quantity: 3, equipped: false, attuned: false }];
  return state;
}

const stored = (state: GameState) => state.definitions.find((entry) => entry.id === `import-${RANGER}`)!.definition;

describe("rebuilding stored sheets when the content changes", () => {
  it("gives a character built against an older bundle the action added since, keeping its live state", () => {
    const state = table(builtBefore(ranger()));
    const before = structuredClone(state.actors[0]!);
    expect(stored(state).actions.some((action) => MOVE_MARK.test(action.id))).toBe(false);

    const refresh = refreshBuiltSheets(state, { library, policy, catalog });

    expect(refresh.rebuilt).toEqual([RANGER]);
    expect(stored(state).actions.some((action) => MOVE_MARK.test(action.id))).toBe(true);
    expect(stored(state).source.version).toBe(CONTENT_STAMP);
    const hero = state.actors[0]!;
    expect(hero.hp).toEqual(before.hp);
    expect(hero.actionUses).toEqual(before.actionUses);
    expect(hero.spellSlots).toEqual(before.spellSlots);
    expect(hero.conditions).toEqual(before.conditions);
    expect(hero.notes).toBe(before.notes);
    expect(hero.inventory).toEqual(before.inventory);
  });

  it("keeps the counters a rule holds outside a pool through the rebuild", () => {
    const state = table(builtBefore(ranger()));
    const hero = state.actors[0]!;
    const counters = {
      "relentless-rage": 2,
      overchannel: 1,
      "torch-uses": 3,
      "conversion-nature-magician": 1,
      "pearl-of-power-row-1": 1,
      "casts-since-rest-augury": 2
    };
    hero.actionUses = { ...hero.actionUses, ...counters };

    expect(refreshBuiltSheets(state, { library, policy, catalog }).rebuilt).toEqual([RANGER]);

    expect(state.actors[0]!.actionUses).toEqual({ "favored-enemy": 1, ...counters });
  });

  it("only stamps a sheet the current content builds the same", () => {
    const sheet = ranger();
    const state = table({ ...sheet, source: { ...sheet.source, version: "1" } });
    const refresh = refreshBuiltSheets(state, { library, policy, catalog });
    expect(refresh).toMatchObject({ rebuilt: [], stamped: [RANGER] });
    expect(stored(state).source.version).toBe(CONTENT_STAMP);
    expect(refreshBuiltSheets(state, { library, policy, catalog })).toMatchObject({ rebuilt: [], stamped: [] });
  });

  it("leaves the old sheet when the current content refuses its build, and says why", () => {
    const sheet = builtBefore(ranger());
    const choices = sheet.character!.choices!.map((row) =>
      row.kind === "subclass" ? { ...row, id: "no-such-conclave" } : row
    );
    const broken = { ...sheet, character: { ...sheet.character!, choices } };
    const state = table(broken);
    const refresh = refreshBuiltSheets(state, { library, policy, catalog });
    expect(refresh.rebuilt).toEqual([]);
    expect(refresh.failed).toEqual([
      expect.objectContaining({ actorId: RANGER, reason: expect.stringMatching(/subclass/i) })
    ]);
    expect(stored(state)).toEqual(broken);
  });

  it("waits for the fight to end before rebuilding a character in it", () => {
    const state = table(builtBefore(ranger()));
    state.combat = { ...state.combat, active: true, initiative: [{ actorId: RANGER, score: 12, tieBreaker: 0 }] };
    const refresh = refreshBuiltSheets(state, { library, policy, catalog });
    expect(refresh).toMatchObject({ rebuilt: [], waiting: [RANGER] });
    expect(stored(state).source.version).toBe("1");
  });

  it("keeps the names given on the sheet and a hand edit of its proficiencies", () => {
    const sheet = builtBefore(ranger());
    const skills = [
      ...(sheet.proficiencies?.skills ?? []),
      { id: "history" as const, proficiency: "expertise" as const }
    ];
    const classes = sheet.character!.classes.map((row) => ({ ...row, name: "Warden" }));
    const edited = {
      ...sheet,
      proficiencies: { ...sheet.proficiencies!, skills },
      character: { ...sheet.character!, classes }
    };
    const state = table(edited);
    refreshBuiltSheets(state, { library, policy, catalog });
    expect(stored(state).character?.classes[0]?.name).toBe("Warden");
    expect(stored(state).proficiencies?.skills).toContainEqual({ id: "history", proficiency: "expertise" });
    expect(stored(state).character?.choices).toContainEqual(
      expect.objectContaining({ kind: SHEET_PROFICIENCIES_KIND })
    );
  });
});

describe("a hand edit of a built sheet's proficiencies", () => {
  it("is kept in the ledger as a difference, so a rebuild keeps it and still takes the build's own", () => {
    const state = table(ranger());
    const sheet = stored(state);
    const saves = [...sheet.proficiencies!.saves, "cha" as const];
    const skills = [...sheet.proficiencies!.skills, { id: "arcana" as const, proficiency: "proficient" as const }];
    setCharacterProficiencies(state, RANGER, { saves, skills }, catalog, { library, policy });
    const edit = stored(state).character!.choices!.find((row) => row.kind === SHEET_PROFICIENCIES_KIND);
    expect(edit?.payload).toEqual({
      saves: { add: ["cha"], remove: [] },
      skills: [{ id: "arcana", proficiency: "proficient" }]
    });
    const rebuilt = buildCharacterDefinition(buildRequestOf(stored(state), library)!, library, policy);
    expect(rebuilt.proficiencies?.saves).toEqual(expect.arrayContaining(["str", "dex", "cha"]));
    expect(rebuilt.proficiencies?.skills).toContainEqual({ id: "arcana", proficiency: "proficient" });
  });
});

describe("the refresh on the running table", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("rebuilds at start, tells the GM, and rebuilds a character the fight held once it ends", async () => {
    const state = table(builtBefore(ranger()));
    const second = "71000000-0000-4000-8000-000000000002";
    importActorDefinition(state, builtBefore(ranger(4)), second, "public", catalog);
    state.combat = { ...state.combat, active: true, initiative: [{ actorId: second, score: 12, tieBreaker: 0 }] };
    const { base, server, gmToken, post, close } = await bootServer(state);
    cleanups.push(close);
    const definitionOf = (actorId: string) =>
      server.store.snapshot.definitions.find((entry) => entry.id === `import-${actorId}`)!.definition;
    const log = async () =>
      (
        (await (await fetch(base + GAME_PATHS.log, { headers: { authorization: `Bearer ${gmToken}` } })).json()).data
          .entries as ReadonlyArray<{ text: string }>
      ).map((entry) => entry.text);

    expect(definitionOf(RANGER).actions.some((action) => MOVE_MARK.test(action.id))).toBe(true);
    expect(definitionOf(second).source.version).toBe("1");
    const name = server.store.snapshot.actors.find((actor) => actor.id === RANGER)!.name;
    expect(await log()).toContain(`Rebuilt with the current rules, keeping hit points, spent uses and gear: ${name}.`);

    expect((await post(GAME_PATHS.encounterEnd, gmToken, { commandId: randomUUID() })).status).toBe(200);
    await expect.poll(() => definitionOf(second).source.version).toBe(CONTENT_STAMP);
    expect(definitionOf(second).actions.some((action) => MOVE_MARK.test(action.id))).toBe(true);
  });
});

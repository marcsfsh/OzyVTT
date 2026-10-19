import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, resolveCatalogChoice, type GameState } from "@vtt/domain";
import { GAME_PATHS } from "@vtt/api-contract";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { rechoicesOf, rechooseInLedger } from "../src/ledger-rechoice.js";
import { holdsFeature } from "../src/class-features.js";
import { applyRest } from "../src/rests.js";
import { bootServer } from "./boot-server.js";

// SRD 5.2.1 Weapon Mastery. Barbarian: "two kinds of Simple or Martial Melee weapons of your choice ... Whenever you
// finish a Long Rest, you can practice weapon drills and change one of those weapon choices." Rogue: "two kinds of
// weapons of your choice with which you have proficiency ... Whenever you finish a Long Rest, you can change the kinds
// of weapons you chose."

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});
const FIGHTER = "5d0f3c1e-8a52-4c1b-9b7e-0c6a1f2d3e5a";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const fighter = buildCharacterDefinition(
  generateCharacterRequest({ classId: "fighter", level: 4 }, library, policy, () => 1).request,
  library,
  policy
);
const masteriesOf = (definition = fighter) =>
  (definition.character?.choices ?? []).filter((row) => row.kind === "weapon-mastery").map((row) => row.id);

describe("which weapons a mastery may name", () => {
  it("offers a Barbarian melee weapons only, and a Rogue the weapons it is proficient with", () => {
    const catalogs = library.catalogChoiceCatalogs();
    const melee = resolveCatalogChoice("melee-weapons", catalogs).map((option) => option.id);
    expect(melee).toContain("greataxe");
    expect(melee).not.toContain("longbow");
    const rogue = resolveCatalogChoice(
      "simple-weapons-or-martial-finesse-weapons-or-martial-light-weapons",
      catalogs
    ).map((option) => option.id);
    expect(rogue).toEqual(expect.arrayContaining(["dagger", "rapier", "shortbow", "scimitar", "shortsword"]));
    expect(rogue).not.toContain("greatsword");
    expect(
      library.classRecord("barbarian")!.features.find((feature) => feature.id === "weapon-mastery")?.choice
    ).toMatchObject({ fromCatalog: "melee-weapons" });
  });
});

describe("changing a mastery after a Long Rest", () => {
  it("lets a Fighter's player swap one mastery in the step a Long Rest opens, and only one", async () => {
    const state: GameState = GameStateSchema.parse({ schemaVersion: 1 });
    importActorDefinition(state, fighter, FIGHTER, "public", catalog);
    state.actors[0]!.kind = "player-character";
    const held = masteriesOf();
    expect(held.length).toBe(4);
    const offer = rechoicesOf(state.actors[0]!, fighter, library).find(
      (entry) => entry.offer === "feature:weapon-mastery"
    );
    expect(offer).toMatchObject({ per: "long-rest", held, swaps: 1 });
    const fresh = offer!.options.map((option) => option.id).filter((id) => !held.includes(id));

    const { server, gmToken, post, close } = await bootServer(state);
    cleanups.push(close);
    const player = server.auth.issuePlayerSession();
    expect((await post(GAME_PATHS.claims, player, { commandId: randomUUID(), actorId: FIGHTER })).status).toBe(200);
    const swap = (replacing: string, id: string) =>
      post(GAME_PATHS.actorRechoose.replace("{actorId}", FIGHTER), player, {
        commandId: randomUUID(),
        offer: "feature:weapon-mastery",
        id,
        replacing
      });
    const early = await swap(held[0]!, fresh[0]!);
    expect(early.status).toBe(409);
    expect((await early.json()).error.message).toMatch(/after finishing a Long Rest/);

    expect(
      (
        await post(GAME_PATHS.actorRest.replace("{actorId}", FIGHTER), gmToken, {
          commandId: randomUUID(),
          kind: "long"
        })
      ).status
    ).toBe(200);
    expect((await swap(held[0]!, held[1]!)).status).toBe(409);
    expect((await swap(held[0]!, fresh[0]!)).status).toBe(200);
    const sheet = () => server.store.snapshot.definitions.find((entry) => entry.id === `import-${FIGHTER}`)!.definition;
    expect(masteriesOf(sheet())).toEqual([fresh[0], ...held.slice(1)]);
    const again = await swap(held[1]!, fresh[1]!);
    expect(again.status).toBe(409);
    expect((await again.json()).error.message).toMatch(/changed one of Weapon Mastery this rest already/);
  });
});

// SRD 5.2.1 Wizard Spellcasting: "Whenever you finish a Long Rest, you can replace one of your cantrips from this feature
// with another Wizard cantrip of your choice."
describe("a Wizard's cantrip swap after a Long Rest", () => {
  it("offers the Wizard's cantrips as one swap, and the rebuilt sheet casts the new one", () => {
    const WIZARD = "5d0f3c1e-8a52-4c1b-9b7e-0c6a1f2d3e5b";
    const wizard = buildCharacterDefinition(
      generateCharacterRequest({ classId: "wizard", level: 4 }, library, policy, () => 1).request,
      library,
      policy
    );
    const state: GameState = GameStateSchema.parse({ schemaVersion: 1 });
    importActorDefinition(state, wizard, WIZARD, "public", catalog);
    state.actors[0]!.kind = "player-character";
    const offer = rechoicesOf(state.actors[0]!, wizard, library).find(
      (entry) => entry.offer === "class-cantrips:wizard"
    );
    expect(offer).toMatchObject({ per: "long-rest", swaps: 1, label: "Wizard cantrips" });
    const held = offer!.held!;
    expect(held.length).toBe(4);
    const fresh = offer!.options.map((option) => option.id).find((id) => !held.includes(id))!;
    expect(rechooseInLedger(state, WIZARD, "class-cantrips:wizard", fresh, { library, policy, catalog }, held[0])).toBe(
      true
    );
    const sheet = state.definitions.find((entry) => entry.id === `import-${WIZARD}`)!.definition;
    expect(sheet.actions.some((action) => action.id === `spell-${fresh}`)).toBe(true);
    expect(sheet.actions.some((action) => action.id === `spell-${held[0]}`)).toBe(false);
  });
});

// SRD 5.2.1 Hunter, Defensive Tactics: "Whenever you finish a Short or Long Rest, you can replace the chosen option with
// the other one." Hunter's Prey says the same.
describe("a Hunter's options after a rest", () => {
  it("swaps Defensive Tactics for the other option, and the rebuilt sheet holds it", () => {
    const HUNTER = "5d0f3c1e-8a52-4c1b-9b7e-0c6a1f2d3e5c";
    const hunter = buildCharacterDefinition(
      generateCharacterRequest({ classId: "ranger", level: 7, subclassId: "hunter" }, library, policy, () => 1).request,
      library,
      policy
    );
    const state: GameState = GameStateSchema.parse({ schemaVersion: 1 });
    importActorDefinition(state, hunter, HUNTER, "public", catalog);
    state.actors[0]!.kind = "player-character";
    const offers = rechoicesOf(state.actors[0]!, hunter, library);
    const tactics = offers.find((entry) => entry.offer === "feature:defensive-tactics")!;
    expect(tactics).toMatchObject({ per: "short-rest" });
    expect(offers.some((entry) => entry.offer === "feature:hunters-prey")).toBe(true);
    const other = tactics.options.find((option) => option.id !== tactics.chosen)!.id;
    expect(rechooseInLedger(state, HUNTER, "feature:defensive-tactics", other, { library, policy, catalog })).toBe(
      true
    );
    const sheet = state.definitions.find((entry) => entry.id === `import-${HUNTER}`)!.definition;
    expect(holdsFeature(sheet, other, "")).toBe(true);
    expect(holdsFeature(sheet, tactics.chosen!, "")).toBe(false);
  });
});

// SRD 5.2.1 Memorize Spell (Wizard 5): "Whenever you finish a Short Rest, you can study your spellbook and replace one of
// the level 1+ Wizard spells you have prepared for your Spellcasting feature with another level 1+ spell from the book."
describe("Memorize Spell", () => {
  it("opens a one-change prepare step when a Wizard 5 finishes a Short Rest, and none for a Wizard 4", () => {
    const after = (level: number) => {
      const state: GameState = GameStateSchema.parse({ schemaVersion: 1 });
      const wizard = buildCharacterDefinition(
        generateCharacterRequest({ classId: "wizard", level }, library, policy, () => 1).request,
        library,
        policy
      );
      const id = "5d0f3c1e-8a52-4c1b-9b7e-0c6a1f2d3e5d";
      importActorDefinition(state, wizard, id, "public", catalog);
      applyRest(state, id, "short", (definitionId) => (definitionId === `import-${id}` ? wizard : undefined), catalog);
      return state.actors[0]!.preparation;
    };
    expect(after(5)).toEqual({ changesLeft: 1 });
    expect(after(4)).toBeNull();
  });
});

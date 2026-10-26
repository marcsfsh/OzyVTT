import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition } from "@vtt/schemas";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { addToSpellbook, paid, spellChoicesOf } from "../src/spell-choices.js";
import { bootServer } from "./boot-server.js";

// SRD Spell Preparation by Class: after a Long Rest a Cleric replaces spells on its list "with other Cleric spells for
// which you have spell slots", a Ranger or Paladin one, and a Wizard "with spells from your spellbook". The spellbook
// "starts with six level 1 Wizard spells" and gains two each Wizard level; "Copying a Spell into the Book ... For each
// level of the spell, the transcription takes 2 hours and costs 50 GP", and from a Spell Scroll "the copier must
// succeed on an Intelligence (Arcana) check with a DC equal to 10 plus the spell's level ... Whether the check succeeds
// or fails, the Spell Scroll is destroyed."

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});
const HERO = "70000000-0000-4000-8000-000000000002";

function seeded(seed: number): (sides: number) => number {
  let state = seed >>> 0;
  return (sides: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (((mixed ^ (mixed >>> 14)) >>> 0) % sides) + 1;
  };
}

function built(classId: string, level: number): ActorDefinition {
  const { request } = generateCharacterRequest({ classId, level }, library, policy, seeded(11));
  return buildCharacterDefinition(request, library, policy);
}

function table(definition: ActorDefinition, extra: (state: GameState) => void = () => {}): GameState {
  const state = GameStateSchema.parse({ schemaVersion: 1 });
  importActorDefinition(state, definition, HERO, "public", catalog);
  extra(state);
  return state;
}

const classSpells = (definition: ActorDefinition | undefined, classId: string) =>
  (definition?.spellcasting?.spells ?? []).filter(
    (spell) => spell.classId === classId && spell.level > 0 && !spell.alwaysPrepared
  );

describe("what a prepared caster may change", () => {
  it("offers a Cleric every Cleric spell it has slots for, and nothing above them", () => {
    const sheet = built("cleric", 3);
    const choices = spellChoicesOf({ spellbook: [] }, sheet, library, policy)!;
    const cleric = choices.swaps.find((entry) => entry.classId === "cleric")!;
    // Level 1 and 2 Cleric spells the build didn't prepare are offered; which ones the dice prepared varies.
    const held = new Set(classSpells(sheet, "cleric").map((spell) => spell.id));
    const unprepared = ["shield-of-faith", "spiritual-weapon", "guiding-bolt", "sanctuary", "command", "hold-person"]
      .filter((id) => !held.has(id))
      .slice(0, 2);
    expect(unprepared).toHaveLength(2);
    expect(cleric.spellIds).toEqual(expect.arrayContaining(unprepared));
    expect(cleric.spellIds).not.toContain("spirit-guardians");
    for (const spell of classSpells(sheet, "cleric")) expect(cleric.spellIds).not.toContain(spell.id);
    expect(choices.spellbook).toBeNull();
  });

  it("keeps a Wizard's book at six spells and two a level, and swaps only from it", () => {
    const sheet = built("wizard", 3);
    // The six the build prepared count against the ten its levels give; Evocation Savant's two are free.
    const prepared = (sheet.character?.choices ?? []).filter((row) => row.kind === "spell" && !row.payload).length;
    expect(prepared).toBe(6);
    const choices = spellChoicesOf({ spellbook: [] }, sheet, library, policy)!;
    expect(choices.spellbook).toMatchObject({ freeLeft: 6 + 2 * 2 - prepared, maxLevel: 2 });
    expect(choices.spellbook!.addable).toContain("misty-step");
    expect(choices.spellbook!.addable).not.toContain("fireball");
    const wizard = choices.swaps.find((entry) => entry.classId === "wizard")!;
    expect(wizard.spellIds).toEqual([]);
    // What Evocation Savant put in the book isn't a pick the class prepares, so nothing replaces it.
    expect(wizard.replaces).toHaveLength(6);
    expect(wizard.replaces).not.toContain("darkness");
    const withShield = spellChoicesOf({ spellbook: [{ id: "web" }] }, sheet, library, policy)!;
    expect(withShield.swaps.find((entry) => entry.classId === "wizard")!.spellIds).toEqual(["web"]);
  });

  it("is nothing for an imported sheet, which can't be rebuilt here", () => {
    const sheet = built("cleric", 3);
    const imported = { ...sheet, character: { ...sheet.character!, choices: [] } };
    expect(spellChoicesOf({ spellbook: [] }, imported, library, policy)).toBeNull();
  });
});

// SRD Evocation Savant: "whenever you gain access to a new level of spell slots in this class, you can add one Wizard
// spell from the Evocation school to your spellbook for free".
describe("an Evoker's free Evocation spells", () => {
  const add = (state: GameState, spellId: string) =>
    addToSpellbook(
      state,
      HERO,
      { spellId, from: "level" },
      { role: "gm" },
      {
        library,
        policy,
        catalog,
        random: () => 1,
        roll: { id: randomUUID(), commandId: randomUUID(), sessionId: randomUUID(), createdAt: "2026-10-19T00:00:00Z" }
      }
    );

  it("gives one each time a new level of spell slots opens, beyond the levels' two", () => {
    const three = spellChoicesOf({ spellbook: [] }, built("wizard", 3), library, policy)!;
    expect(three.spellbook!.freeOfSchool).toEqual({ school: "evocation", left: 0 });
    const five = spellChoicesOf({ spellbook: [] }, built("wizard", 5), library, policy)!;
    expect(five.spellbook!.freeOfSchool).toEqual({ school: "evocation", left: 1 });
  });

  it("adds Fireball free once the levels' spells are spent, and no spell of another school", () => {
    const sheet = built("wizard", 5);
    const state = table(sheet);
    const actor = state.actors[0]!;
    const before = spellChoicesOf(actor, sheet, library, policy)!.spellbook!;
    const others = before.addable.filter((id) => library.spellRecord(id)?.school !== "evocation");
    actor.spellbook = others.slice(0, before.freeLeft).map((id) => ({ id }));
    expect(spellChoicesOf(actor, sheet, library, policy)!.spellbook).toMatchObject({
      freeLeft: 0,
      freeOfSchool: { school: "evocation", left: 1 }
    });
    expect(() => add(state, others[before.freeLeft]!)).toThrow(/free spells left are for the evocation school/);
    expect(add(state, "fireball")).toMatch(/adds Fireball to the spellbook/);
    expect(spellChoicesOf(actor, sheet, library, policy)!.spellbook!.freeOfSchool).toEqual({
      school: "evocation",
      left: 0
    });
    expect(() => add(state, "lightning-bolt")).toThrow(/already holds the spells the Wizard's levels give/);
  });
});

describe("paying for a copy", () => {
  it("pays in gold, then breaks larger and smaller coins, with change in gold, silver and copper", () => {
    expect(paid({ cp: 0, sp: 0, ep: 0, gp: 120, pp: 0 }, 100)).toEqual({ cp: 0, sp: 0, ep: 0, gp: 20, pp: 0 });
    expect(paid({ cp: 0, sp: 0, ep: 0, gp: 20, pp: 4 }, 50)).toEqual({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 1 });
    expect(paid({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 1 }, 5)).toEqual({ cp: 0, sp: 0, ep: 0, gp: 5, pp: 0 });
    expect(paid({ cp: 50, sp: 45, ep: 0, gp: 0, pp: 0 }, 5)).toEqual({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
    expect(paid({ cp: 0, sp: 0, ep: 0, gp: 49, pp: 0 }, 50)).toBeNull();
  });
});

describe("over the wire", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function boot(state: GameState) {
    const booted = await bootServer(state);
    cleanups.push(booted.close);
    const player = booted.server.auth.issuePlayerSession();
    await booted.post(GAME_PATHS.claims, player, { commandId: randomUUID(), actorId: HERO });
    const hero = () => booted.server.store.snapshot.actors.find((actor) => actor.id === HERO)!;
    const stored = () =>
      booted.server.store.snapshot.definitions.find((entry) => entry.id === hero().definitionId)?.definition;
    const send = (path: string, token: string, body: Record<string, unknown>) =>
      booted.post(path.replace("{actorId}", HERO), token, { commandId: randomUUID(), actorId: HERO, ...body });
    const longRest = () => send(GAME_PATHS.actorRest, booted.gmToken, { kind: "long" });
    const log = async () =>
      (
        (
          await (
            await fetch(booted.base + GAME_PATHS.log, { headers: { authorization: `Bearer ${booted.gmToken}` } })
          ).json()
        ).data.entries as ReadonlyArray<{ text: string }>
      ).map((entry) => entry.text);
    return { ...booted, player, hero, stored, send, longRest, log };
  }

  it("lets a Cleric swap in another Cleric spell after a Long Rest, rebuilt and prepared", async () => {
    const sheet = built("cleric", 3);
    const out = classSpells(sheet, "cleric")[0]!;
    const into = spellChoicesOf({ spellbook: [] }, sheet, library, policy)!.swaps[0]!.spellIds[0]!;
    const { player, hero, stored, send, longRest, log } = await boot(table(sheet));
    const swap = () => send(GAME_PATHS.characterSwapSpell, player, { spellId: into, replaces: out.id });

    const early = await swap();
    expect(early.status).toBe(409);
    expect((await early.json()).error.message).toBe("You change your prepared spells when you finish a Long Rest.");

    expect((await longRest()).status).toBe(200);
    expect((await swap()).status).toBe(200);
    expect(stored()!.spellcasting!.spells.map((spell) => spell.id)).toContain(into);
    expect(stored()!.spellcasting!.spells.map((spell) => spell.id)).not.toContain(out.id);
    expect(stored()!.actions.some((action) => action.spellId === into)).toBe(true);
    expect(hero().preparedSpellIds).toContain(into);
    expect(hero().preparedSpellIds).not.toContain(out.id);
    const name = library.spellRecord(into)!.name;
    expect(await log()).toContain(`${hero().name} prepares ${name} in place of ${out.name}.`);

    // A spell the class has no slots for is refused, named.
    const high = await send(GAME_PATHS.characterSwapSpell, player, {
      spellId: "spirit-guardians",
      replaces: classSpells(stored(), "cleric")[0]!.id
    });
    expect(high.status).toBe(409);
    expect((await high.json()).error.message).toBe(
      `Spirit Guardians isn't a Cleric spell ${hero().name} has slots for.`
    );
  });

  it("lets a Ranger swap only one spell a Long Rest", async () => {
    const sheet = built("ranger", 5);
    const choices = spellChoicesOf({ spellbook: [] }, sheet, library, policy)!.swaps[0]!.spellIds;
    const listed = classSpells(sheet, "ranger");
    const { player, send, longRest } = await boot(table(sheet));
    expect((await longRest()).status).toBe(200);
    const first = await send(GAME_PATHS.characterSwapSpell, player, { spellId: choices[0], replaces: listed[0]!.id });
    expect(first.status).toBe(200);
    const second = await send(GAME_PATHS.characterSwapSpell, player, { spellId: choices[1], replaces: listed[1]!.id });
    expect(second.status).toBe(409);
    expect((await second.json()).error.message).toBe(
      "You've changed as many prepared spells as this Long Rest allows."
    );
  });

  it("fills a Wizard's book from its levels, prepares from it, and keeps the swapped spell in it", async () => {
    const sheet = built("wizard", 3);
    const out = classSpells(sheet, "wizard")[0]!;
    const { player, gmToken, hero, stored, send, longRest } = await boot(table(sheet));
    const add = (token: string, body: Record<string, unknown>) => send(GAME_PATHS.characterAddToSpellbook, token, body);

    expect((await add(player, { spellId: "web", from: "level" })).status).toBe(200);
    expect(hero().spellbook).toEqual([{ id: "web" }]);
    const again = await add(player, { spellId: "web", from: "level" });
    expect((await again.json()).error.message).toBe(`Web is already in ${hero().name}'s spellbook.`);
    const fireball = await add(player, { spellId: "fireball", from: "level" });
    expect((await fireball.json()).error.message).toBe(
      `${hero().name} can't prepare level 3 spells yet, so Fireball can't go in the spellbook.`
    );
    // A player doesn't say what another book holds.
    expect((await add(player, { spellId: "misty-step", from: "book" })).status).toBe(403);

    expect((await longRest()).status).toBe(200);
    const notInBook = await send(GAME_PATHS.characterSwapSpell, player, { spellId: "misty-step", replaces: out.id });
    expect((await notInBook.json()).error.message).toBe(
      `Misty Step isn't in ${hero().name}'s spellbook. Copy it in first.`
    );
    expect((await send(GAME_PATHS.characterSwapSpell, player, { spellId: "web", replaces: out.id })).status).toBe(200);
    expect(hero().preparedSpellIds).toContain("web");
    expect(stored()!.spellcasting!.spells.some((spell) => spell.id === out.id)).toBe(false);
    expect(hero().spellbook).toEqual([{ id: out.id }]);

    // The levels' picks run out; then only a copy adds one.
    const free = spellChoicesOf(hero(), stored(), library, policy)!.spellbook!.freeLeft;
    const addable = spellChoicesOf(hero(), stored(), library, policy)!.spellbook!.addable;
    for (const id of addable.slice(0, free))
      expect((await add(player, { spellId: id, from: "level" })).status).toBe(200);
    const full = await add(player, { spellId: addable[free], from: "level" });
    expect((await full.json()).error.message).toBe(
      `${hero().name}'s spellbook already holds the spells the Wizard's levels give. Copy others in.`
    );
    // The GM copies from a book the party found, for 2 hours and 50 GP a level.
    const purse = { currency: { cp: 0, sp: 0, ep: 0, gp: 120, pp: 0 } };
    expect((await send(GAME_PATHS.characterSetCurrency, gmToken, purse)).status).toBe(200);
    expect((await add(gmToken, { spellId: addable[free], from: "book" })).status).toBe(200);
    expect(hero().currency.gp).toBe(120 - 50 * library.spellRecord(addable[free]!)!.level);
    expect(hero().spellbook.at(-1)).toEqual({ id: addable[free], copied: true });
  });

  it("copies from a Spell Scroll with an Arcana check, and the scroll is gone either way", async () => {
    const sheet = built("wizard", 3);
    const scroll = (id: string) =>
      InventoryItemSchema.parse({
        id,
        name: "Spell Scroll",
        quantity: 1,
        equipped: false,
        attuned: false,
        category: library.equipmentRecord("spell-scroll")!.category,
        spellId: "misty-step"
      });
    const { player, hero, send, log, server } = await boot(
      table(sheet, (state) => {
        const actor = state.actors.find((candidate) => candidate.id === HERO)!;
        actor.currency = { cp: 0, sp: 0, ep: 0, gp: 300, pp: 0 };
        actor.inventory = [...actor.inventory, scroll("spell-scroll")];
      })
    );
    const copy = await send(GAME_PATHS.characterAddToSpellbook, player, {
      spellId: "misty-step",
      from: "scroll",
      itemId: "spell-scroll"
    });
    expect(copy.status).toBe(200);
    expect(hero().inventory.some((row) => row.id === "spell-scroll")).toBe(false);
    expect(hero().currency.gp).toBe(200);
    const check = server.store.snapshot.rolls.find((roll) => roll.label?.startsWith("Intelligence (Arcana)"))!;
    expect(check.label).toBe("Intelligence (Arcana) check to copy Misty Step");
    const lines = await log();
    if (check.total >= 12) {
      expect(hero().spellbook).toEqual([{ id: "misty-step", copied: true }]);
      expect(lines).toContain(
        `${hero().name} copies Misty Step from the scroll into the spellbook (4 hours and 100 GP), and the scroll is destroyed.`
      );
    } else {
      expect(hero().spellbook).toEqual([]);
      expect(lines).toContain(
        `${hero().name} fails to copy Misty Step (Arcana ${check.total} against DC 12), and the scroll is destroyed. The 4 hours and 100 GP are spent.`
      );
    }
    // Without the scroll in the pack there is nothing to copy from.
    const gone = await send(GAME_PATHS.characterAddToSpellbook, player, {
      spellId: "misty-step",
      from: "scroll",
      itemId: "spell-scroll"
    });
    expect(gone.status).toBe(409);
  });
});

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import type { ActionAvailability, AvailableActionsReply, GameState } from "@vtt/domain";
import { actionAvailability } from "../src/action-resolution.js";
import { storedDefinition } from "../src/actor-roster.js";
import { unavailableReason } from "../src/availability-reasons.js";
import { builtinActionsFor } from "../src/builtin-actions.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { createInitialGameState, PLACEHOLDER_ACTOR_IDS } from "../src/initial-game-state.js";
import { RULE_IDS } from "../src/rules-families.js";
import { bootServer } from "./boot-server.js";

// What the sheet's turn list reads off `actor:available-actions`: the mastery each mastered swing carries, the
// Weapon Mastery block of the Features tab, one short reason on each option that can't be used now, and the flag on
// what belongs off the turn list. Borin, Mirena and Lyra are the sample party.

const { fighter: BORIN, cleric: MIRENA, wizard: LYRA } = PLACEHOLDER_ACTOR_IDS;
const catalog = equipmentCatalogOf(new ContentLibrary().forAudience("gm"));

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function table() {
  const booted = await bootServer(createInitialGameState());
  cleanups.push(booted.close);
  const read = async (actorId: string, token: string) => {
    const response = await fetch(booted.base + GAME_PATHS.actorAvailableActions.replace("{actorId}", actorId), {
      headers: { authorization: `Bearer ${token}` }
    });
    return { status: response.status, body: (await response.json()) as { data: AvailableActionsReply } };
  };
  return { ...booted, read };
}

/** The availability rows the read builds, worked out in place against a state a test has changed. */
function rowsFor(state: GameState, actorId: string): ActionAvailability[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId)!;
  const definition = storedDefinition(state, actor.definitionId!);
  const own = effectiveActions(definition, actor, catalog);
  const builtins = builtinActionsFor(definition).filter(
    (candidate) => !own.some((action) => action.id === candidate.id)
  );
  return [
    ...actionAvailability(state, actor, own, definition, false, own, catalog),
    ...actionAvailability(state, actor, builtins, definition, true, own, catalog)
  ];
}
const row = (rows: readonly ActionAvailability[], id: string) => rows.find((entry) => entry.id === id)!;

/** Lyra's turn in a running fight. */
function lyrasTurn(state: GameState, turn: Partial<GameState["combat"]["turn"]> = {}): GameState {
  state.combat = {
    ...state.combat,
    active: true,
    round: 1,
    turnActorId: LYRA,
    initiative: [{ actorId: LYRA, score: 15, tieBreaker: 0 }],
    turn: { ...state.combat.turn, ...turn }
  };
  return state;
}

describe("weapon mastery on the sheet", () => {
  it("names the mastery property on each swing of a weapon kind Borin mastered, and on no other", async () => {
    const t = await table();
    const { status, body } = await t.read(BORIN, t.gmToken);
    expect(status).toBe(200);
    const mastery = (id: string) => body.data.actions.find((entry) => entry.id === id)?.mastery;
    expect(mastery("item-greatsword")).toEqual({ id: "graze", name: "Graze" });
    expect(mastery("item-flail")).toEqual({ id: "sap", name: "Sap" });
    expect(mastery("item-javelin")).toEqual({ id: "slow", name: "Slow" });
    expect(mastery("item-shortbow")).toEqual({ id: "vex", name: "Vex" });
    // The Spear's kind isn't one of Borin's picks, so neither of its grips carries Sap.
    expect(mastery("item-spear")).toBeUndefined();
    expect(mastery("item-spear-two-handed")).toBeUndefined();
    expect(body.data.actions.filter((entry) => entry.mastery !== undefined)).toHaveLength(4);
  });

  it("lists the weapon kinds Borin chose with the property each grants and what it does", async () => {
    const t = await table();
    const { body } = await t.read(BORIN, t.gmToken);
    expect(body.data.derived.weaponMasteries.map((entry) => [entry.weaponName, entry.mastery.name])).toEqual([
      ["Greatsword", "Graze"],
      ["Flail", "Sap"],
      ["Javelin", "Slow"],
      ["Shortbow", "Vex"]
    ]);
    expect(body.data.derived.weaponMasteries[0]).toMatchObject({ weaponId: "greatsword", mastery: { id: "graze" } });
    expect(body.data.derived.weaponMasteries[0]!.mastery.description).toMatch(
      /^If your attack roll with this weapon misses a creature/
    );
    // A Wizard makes no Weapon Mastery picks.
    expect((await t.read(LYRA, t.gmToken)).body.data.derived.weaponMasteries).toEqual([]);
  });

  it("reaches the character's owner, and another player is refused the read", async () => {
    const t = await table();
    const owner = t.server.auth.issuePlayerSession();
    const stranger = t.server.auth.issuePlayerSession();
    expect((await t.post(GAME_PATHS.claims, owner, { commandId: randomUUID(), actorId: BORIN })).status).toBe(200);
    const mine = await t.read(BORIN, owner);
    expect(mine.status).toBe(200);
    expect(mine.body.data.derived.weaponMasteries).toHaveLength(4);
    expect((await t.read(BORIN, stranger)).status).toBe(403);
  });
});

describe("why an option can't be used now", () => {
  it("says a spell isn't prepared", () => {
    const state = createInitialGameState();
    const lyra = state.actors.find((actor) => actor.id === LYRA)!;
    lyra.preparedSpellIds = lyra.preparedSpellIds.filter((id) => id !== "fireball");
    expect(row(rowsFor(state, LYRA), "spell-fireball")).toMatchObject({ available: false, reason: "Not prepared." });
  });

  it("names the slot level that ran out, or every level from the spell's up", () => {
    const state = createInitialGameState();
    const lyra = state.actors.find((actor) => actor.id === LYRA)!;
    // Level 4 is Lyra's highest, so an empty level 4 is the whole story for Greater Invisibility.
    lyra.spellSlots = lyra.spellSlots!.map((slot) => (slot.level === 4 ? { ...slot, remaining: 0 } : slot));
    expect(row(rowsFor(state, LYRA), "spell-greater-invisibility").reason).toBe("No level 4 spell slots left.");
    // Misty Step could go up a level while one is left, so only every level from 2 up running out stops it.
    lyra.spellSlots = lyra.spellSlots.map((slot) => (slot.level >= 2 ? { ...slot, remaining: 0 } : slot));
    expect(row(rowsFor(state, LYRA), "spell-misty-step").reason).toBe("No spell slots of level 2 or higher left.");
  });

  it("says the Bonus Action is spent, off turn says whose turn it isn't, and the option's own reason comes first", () => {
    const spent = lyrasTurn(createInitialGameState(), { bonusActionUsed: true });
    expect(row(rowsFor(spent, LYRA), "spell-misty-step").reason).toBe("You used your Bonus Action this turn.");
    expect(row(rowsFor(spent, LYRA), "spell-fire-bolt").available).toBe(true);
    expect(row(rowsFor(spent, LYRA), "spell-fire-bolt")).not.toHaveProperty("reason");

    const offTurn = lyrasTurn(createInitialGameState());
    offTurn.combat = { ...offTurn.combat, turnActorId: BORIN };
    expect(row(rowsFor(offTurn, LYRA), "spell-fire-bolt").reason).toBe("It isn't your turn.");
    const lyra = offTurn.actors.find((actor) => actor.id === LYRA)!;
    lyra.preparedSpellIds = lyra.preparedSpellIds.filter((id) => id !== "fireball");
    expect(row(rowsFor(offTurn, LYRA), "spell-fireball").reason).toBe("Not prepared.");
  });

  it("puts a reason on every unavailable row and on no available one", () => {
    const state = lyrasTurn(createInitialGameState(), { actionUsed: true, bonusActionUsed: true });
    for (const actorId of [BORIN, MIRENA, LYRA])
      for (const entry of rowsFor(state, actorId))
        expect(entry.reason !== undefined, `${entry.id}: ${entry.reason}`).toBe(!entry.available);
  });

  it("has a short plain sentence for every rule the engine can raise", () => {
    const state = createInitialGameState();
    const actor = state.actors.find((candidate) => candidate.id === LYRA)!;
    const action = effectiveActions(storedDefinition(state, actor.definitionId!), actor, catalog)[0]!;
    for (const rule of RULE_IDS) {
      const reason = unavailableReason([{ rule }], {
        state,
        attacker: actor,
        action,
        siblings: [action],
        spell: undefined
      });
      expect(reason, rule).toMatch(/^[A-Z].*\.$/);
      expect(reason, rule).not.toMatch(/ - |\u2013|\u2014|[\u2018\u2019\u201c\u201d]/);
    }
  });
});

describe("what stays off the turn list", () => {
  it("flags riders, rest features and what the server runs, and leaves everything taken on a turn unflagged", () => {
    const state = createInitialGameState();
    const borin = rowsFor(state, BORIN);
    const mirena = rowsFor(state, MIRENA);
    const lyra = rowsFor(state, LYRA);
    expect(row(borin, "savage-attacker").passive).toBe("rider");
    expect(row(mirena, "divine-strike")).toMatchObject({ passive: "rider", ridesAHit: true });
    expect(row(mirena, "spell-spirit-guardians-then-save").passive).toBe("automatic");
    expect(row(lyra, "arcane-recovery").passive).toBe("rest");
    for (const id of ["action-surge", "second-wind", "item-greatsword", "dash", "unarmed-strike"])
      expect(row(borin, id), id).not.toHaveProperty("passive");
    for (const id of ["spell-fireball", "spell-counterspell", "spell-misty-step", "spell-detect-magic-ritual"])
      expect(row(lyra, id), id).not.toHaveProperty("passive");
    // Spiritual Weapon's later attack is a Bonus Action Mirena takes, so it stays on the list.
    expect(row(mirena, "spell-spiritual-weapon-then-attack")).not.toHaveProperty("passive");
  });
});

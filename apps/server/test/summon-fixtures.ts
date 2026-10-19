import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { addActorFromDefinition, importActorDefinition } from "../src/actor-roster.js";
import { spellCastMechanics } from "../src/item-actions.js";
import { bootMovementServer, cell } from "./movement-fixtures.js";
import { build, catalog, view, wizardInput } from "./spell-casters.js";

// A built Wizard who knows the summoning spells, a bandit to fight and the dead to raise, on a calibrated 50px grid,
// for the summons tests that go through the commands.

export const CASTER = "70000000-0000-4000-8000-0000000000c1";
export const BANDIT = "70000000-0000-4000-8000-0000000000c2";
export const CORPSE = "70000000-0000-4000-8000-0000000000c3";
export const CORPSE_TWO = "70000000-0000-4000-8000-0000000000c4";
export const WOLF = "70000000-0000-4000-8000-0000000000c5";

/** The cast numbers the test Wizard's spell actions carry: attack +7, DC 15, spellcasting modifier +4. */
export const NUMBERS = { attackBonus: 7, saveDc: 15, bearersDc: true, modifier: 4 } as const;

/** A spell's cast action as a sheet mints it, at the test Wizard's numbers. */
export function castActionOf(spellId: string): ActorAction {
  const spell = view.spellRecord(spellId)!;
  return {
    id: `spell-${spellId}`,
    name: spell.name,
    activation: /bonus/i.test(spell.castingTime) ? "bonus-action" : "action",
    description: spell.description.slice(0, 12000),
    ...spellCastMechanics(spell, NUMBERS),
    ...(spell.level > 0 ? { spellSlot: { level: spell.level } } : {}),
    spellId
  } as ActorAction;
}

export const SUMMON_SPELLS = [
  "summon-dragon",
  "giant-insect",
  "animate-dead",
  "animate-objects",
  "create-undead",
  "find-familiar",
  "find-steed",
  "phantom-steed",
  "unseen-servant",
  "dominate-person",
  "dominate-beast"
] as const;

/** The Wizard's sheet with a cast action for every summoning spell. */
export const summoner: ActorDefinition = (() => {
  const built = build(wizardInput(["magic-missile", "shield"]));
  return { ...built, actions: [...built.actions, ...SUMMON_SPELLS.map(castActionOf)] };
})();

const monsterActor = (state: GameState, monsterId: string, id: string, hp?: number) => {
  addActorFromDefinition(state, view.monster(monsterId)!, id, "public", catalog);
  const actor = state.actors.find((candidate) => candidate.id === id)!;
  if (hp !== undefined) actor.hp = { ...actor.hp, current: hp };
};

/** The table: the Wizard with three slots of every level, a living bandit and a wolf, and two dead bandits; spell
 *  components left to the GM so the tests need no priced materials. `extraActions` go on the Wizard's sheet (a
 *  feature's free casting). */
export function summonTable(extraActions: readonly ActorAction[] = []): GameState {
  const state = GameStateSchema.parse({ schemaVersion: 1 });
  importActorDefinition(
    state,
    { ...summoner, actions: [...summoner.actions, ...extraActions] },
    CASTER,
    "public",
    catalog
  );
  const caster = state.actors.find((actor) => actor.id === CASTER)!;
  caster.spellSlots = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => ({ level, remaining: 3 }));
  monsterActor(state, "bandit", BANDIT);
  monsterActor(state, "wolf", WOLF);
  monsterActor(state, "bandit", CORPSE, 0);
  monsterActor(state, "bandit", CORPSE_TWO, 0);
  state.rulesPolicy = { dial: "strict", exceptions: { components: "freeform" } };
  return state;
}

/** The table booted on the grid, the fight started with the Wizard first, and helpers for the summons commands. */
export async function bootSummons(cleanups: Array<() => Promise<void>>, state: GameState = summonTable()) {
  const booted = await bootMovementServer(state, cleanups);
  await booted.startFight([CASTER, BANDIT, WOLF, CORPSE, CORPSE_TWO], {
    [CASTER]: cell(2, 2),
    [BANDIT]: cell(8, 2),
    [WOLF]: cell(8, 4),
    [CORPSE]: cell(3, 2),
    [CORPSE_TWO]: cell(3, 3)
  });
  const snapshot = () => booted.server.store.snapshot;
  const actor = (id: string) => snapshot().actors.find((candidate) => candidate.id === id);
  const named = (name: string) => snapshot().actors.filter((candidate) => candidate.name.startsWith(name));
  const resolve = (body: Record<string, unknown>, token = booted.gmToken) =>
    booted.post(GAME_PATHS.actionResolve, token, { actorId: CASTER, ...body });
  const endTurn = (token = booted.gmToken) => booted.post(GAME_PATHS.turnEnd, token);
  return { ...booted, snapshot, actor, named, resolve, endTurn };
}

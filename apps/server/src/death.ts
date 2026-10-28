import { isDead, ROUNDS_PER_MINUTE, type GameState } from "@vtt/domain";
import type { ActorDefinition, DeathRecord } from "@vtt/schemas";
import {
  endEffect,
  endEffectIfPresent,
  ENDS_ON_DEATH_TAG,
  reduceExhaustion,
  removeConditionDirect,
  type EffectNarration
} from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { clockMinutesOf } from "./game-time.js";
import { reconcileEquipment } from "./inventory.js";

/**
 * SRD "Dead": when a creature died and what is left of it, and its return to life. The server stamps the time of death
 * as a creature dies (`keepDeathRecords` after every command, or the rule that kills it, which also says how) and
 * clears it once the creature lives again. Revival spells read how long ago that was in game time: a fight's rounds
 * while it runs, and the game clock after.
 */

type Actor = GameState["actors"][number];

/** The tag on Gentle Repose's effect on a corpse: time under it doesn't count against a revival's limit. */
export const GENTLE_REPOSE_TAG = "gentle-repose";

/** The game clock in rounds, ten to the minute. */
export const clockRoundsOf = (state: GameState): number => clockMinutesOf(state) * ROUNDS_PER_MINUTE;

/** The round of the fight in `encounterId` while that fight runs, live or parked; null once it has ended. */
function fightRoundIn(state: GameState, encounterId: string | null): number | null {
  if (state.combat.active && state.combat.activeEncounterId === encounterId) return state.combat.round;
  const parked = encounterId === null ? undefined : state.combat.encounters.find((scene) => scene.id === encounterId);
  return parked && parked.id !== state.combat.activeEncounterId && parked.combat.active ? parked.combat.round : null;
}

/** Stamps the time `actor` died, now, unless it has a stamp already; what killed it and whether its body is gone are
 *  added either way. */
export function stampDeath(
  state: GameState,
  actor: Actor,
  details: Readonly<{ cause?: string; bodyGone?: boolean; headLost?: boolean }> = {}
): void {
  const fighting = state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actor.id);
  const record: DeathRecord = actor.death ?? {
    clockRound: clockRoundsOf(state),
    ...(fighting ? { fightRound: state.combat.round, encounterId: state.combat.activeEncounterId } : {})
  };
  actor.death = {
    ...record,
    ...(details.cause !== undefined ? { cause: details.cause.slice(0, 120) } : {}),
    ...(details.bodyGone ? { bodyGone: true as const } : {}),
    ...(details.headLost ? { headLost: true as const } : {})
  };
}

/** How many rounds of game time ago `actor` died, less the time its body lay under Gentle Repose. Null when the time
 *  of death isn't known (it died before the server kept it). */
export function roundsDead(state: GameState, actor: Pick<Actor, "death">): number | null {
  const death = actor.death;
  if (!death) return null;
  const fightNow = death.fightRound !== undefined ? fightRoundIn(state, death.encounterId ?? null) : null;
  const inFight = fightNow !== null ? Math.max(0, fightNow - death.fightRound!) : 0;
  return Math.max(0, clockRoundsOf(state) - death.clockRound + inFight - (death.reposedRounds ?? 0));
}

/** A span of game time in rounds as the table reads it: "3 rounds", "12 minutes", "2 hours", "11 days", "3 years". */
export function timeWords(rounds: number): string {
  const count = (amount: number, unit: string) => `${amount} ${unit}${amount === 1 ? "" : "s"}`;
  if (rounds < 10 * ROUNDS_PER_MINUTE) return count(rounds, "round");
  const minutes = Math.floor(rounds / ROUNDS_PER_MINUTE);
  if (minutes < 120) return count(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 72) return count(hours, "hour");
  const days = Math.floor(hours / 24);
  return days < 730 ? count(days, "day") : count(Math.floor(days / 365), "year");
}

/** A revival's printed limit in minutes as its text says it: "1 minute", "10 days", "100 years". */
export function limitWords(minutes: number): string {
  const count = (amount: number, unit: string) => `${amount} ${unit}${amount === 1 ? "" : "s"}`;
  if (minutes < 60) return count(minutes, "minute");
  if (minutes % (365 * 24 * 60) === 0) return count(minutes / (365 * 24 * 60), "year");
  if (minutes % (24 * 60) === 0) return count(minutes / (24 * 60), "day");
  return count(Math.floor(minutes / 60), "hour");
}

/**
 * Keeps every creature's death record true after a command (run with the state before it): a creature that died
 * without the rule that killed it stamping it gets its stamp now, and one that lives again loses it. When a fight
 * ends, the rounds it ran after a death move onto the death's clock time. Time the clock passed while a corpse lay
 * under Gentle Repose is added to the time no limit counts.
 */
export function keepDeathRecords(state: GameState, before: GameState): void {
  const passed = clockRoundsOf(state) - clockRoundsOf(before);
  for (const actor of state.actors) {
    if (actor.replayEncounterId !== undefined) continue;
    if (!isDead(actor)) {
      if (actor.death) delete actor.death;
      continue;
    }
    if (!actor.death) {
      stampDeath(state, actor);
      // What lasts until its bearer dies ends with the death (a pact weapon's bond).
      for (const effect of actor.effects.filter((candidate) => candidate.tags.includes(ENDS_ON_DEATH_TAG)))
        endEffectIfPresent(state, actor.id, effect.id);
    }
    const death = actor.death!;
    if (death.fightRound !== undefined && fightRoundIn(state, death.encounterId ?? null) === null) {
      const ended = fightRoundIn(before, death.encounterId ?? null);
      const { fightRound, encounterId: _scene, ...rest } = death;
      actor.death = { ...rest, clockRound: rest.clockRound - Math.max(0, (ended ?? fightRound) - fightRound) };
    }
    if (passed > 0) {
      const held = before.actors
        .find((candidate) => candidate.id === actor.id)
        ?.effects.find((effect) => effect.tags.includes(GENTLE_REPOSE_TAG));
      const left = held?.duration.type === "minutes" ? held.duration.remaining * ROUNDS_PER_MINUTE : held ? passed : 0;
      const reposed = Math.min(passed, left);
      if (reposed > 0) actor.death = { ...actor.death!, reposedRounds: (actor.death!.reposedRounds ?? 0) + reposed };
    }
  }
}

/**
 * SRD "Dead": a creature brought back to life. It returns with `hitPoints` (at least 1, at most its maximum), its dying
 * state and the Unconscious it brought end, a creature that died with Exhaustion comes back one level lower, and it is
 * no longer attuned to any magic item. Other conditions stay.
 */
export function returnToLife(
  actor: Actor,
  hitPoints: number,
  deps: Readonly<{ definition: ActorDefinition | undefined; catalog?: EquipmentCatalog }>
): EffectNarration[] {
  actor.hp = { ...actor.hp, current: Math.max(1, Math.min(actor.hp.maximum, hitPoints)) };
  actor.deathSaves = null;
  delete actor.death;
  if (!actor.effects.some((effect) => effect.linkedConditionIds.includes("unconscious")))
    removeConditionDirect(actor, "unconscious");
  reduceExhaustion(actor);
  if (actor.inventory.some((item) => item.attuned)) {
    actor.inventory = actor.inventory.map((item) => (item.attuned ? { ...item, attuned: false } : item));
    // Attunement feeds stored AC and slot maxima, so the loadout is reconciled as an inventory write would be.
    reconcileEquipment(actor, deps.definition, { catalog: deps.catalog, role: "gm" });
  }
  const regained = actor.hp.current;
  return [
    {
      kind: "condition",
      text: `${actor.name} returns to life with ${regained} ${regained === 1 ? "hit point" : "hit points"}.`,
      actorId: actor.id
    }
  ];
}

/** The tag on the D20 Test penalty a revival leaves (Raise Dead's and Resurrection's -4). */
export const ORDEAL_TAG = "ordeal";

/** The D20 Test bonuses an ordeal carries. */
const D20_PENALTIES: ReadonlySet<string> = new Set(["attack-bonus", "save-bonus", "check-bonus"]);

/**
 * SRD Raise Dead: "The target takes a -4 penalty to D20 Tests. Every time the target finishes a Long Rest, the penalty
 * is reduced by 1 until it becomes 0." Moves each ordeal on `actor` one toward 0 as a Long Rest ends, and ends it at 0.
 */
export function easeOrdeals(state: GameState, actor: Actor): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const effect of [...actor.effects]) {
    if (!effect.tags.includes(ORDEAL_TAG)) continue;
    const penaltyOf = (modifier: (typeof effect.modifiers)[number]) =>
      D20_PENALTIES.has(modifier.type) && "amount" in modifier ? (modifier.amount ?? 0) : 0;
    const modifiers = effect.modifiers.map((modifier) =>
      penaltyOf(modifier) < 0 ? { ...modifier, amount: penaltyOf(modifier) + 1 } : modifier
    );
    const left = modifiers.map(penaltyOf).find((amount) => amount < 0);
    if (left === undefined) {
      events.push(...endEffect(state, actor.id, effect.id));
      continue;
    }
    actor.effects = actor.effects.map((candidate) =>
      candidate.id === effect.id ? { ...effect, modifiers } : candidate
    );
    events.push({ kind: "effect", text: `${actor.name}'s ${effect.name} eases to ${left}.`, actorId: actor.id });
  }
  return events;
}

import { isDead, type GameState } from "@vtt/domain";
import { abilityModifier } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { exhaustionLevel } from "./condition-rules.js";
import { addEffect, applyCondition, conditionGained, makeEffect, type EffectNarration } from "./effects.js";
import { STATBLOCK_EXTENSION } from "./statblock-facts.js";

/**
 * SRD Suffocation: "A creature can hold its breath for a number of minutes equal to 1 plus its Constitution modifier
 * (minimum of 30 seconds) before suffocation begins. When a creature runs out of breath or is choking, it gains 1
 * Exhaustion level at the end of each of its turns. When a creature can breathe again, it removes all levels of
 * Exhaustion it gained from suffocating." One effect carries it: the rounds of breath left, then the levels it gave,
 * which go when it ends (`endEffectInternal`).
 */

type Actor = GameState["actors"][number];

export const HOLDING_BREATH_TAG = "holding-breath";
/** The tag on an effect that lets its bearer breathe water (the Water Breathing spell). */
export const WATER_BREATHING_TAG = "water-breathing";

/** A round is 6 seconds. */
const ROUNDS_PER_MINUTE = 10;
/** "Minimum of 30 seconds". */
const LEAST_BREATH_ROUNDS = 5;
/** Traits that let a creature breathe water. */
const WATER_BREATHERS = /^(amphibious|water breathing|limited amphibiousness)$/i;
/** What lets its wearer breathe underwater: "You can breathe underwater" (Cloak of the Manta Ray), "you can breathe
 *  normally in any environment" (Necklace of Adaptation, attuned). */
const BREATHING_ITEMS: Readonly<Record<string, "worn" | "attuned">> = {
  "cloak-of-the-manta-ray": "worn",
  "necklace-of-adaptation": "attuned"
};

function traitsOf(definition: ActorDefinition | undefined): ReadonlyArray<Readonly<{ name: string; text: string }>> {
  const bag = (definition?.extensions ?? {})[STATBLOCK_EXTENSION] as { traits?: unknown } | undefined;
  const traits = Array.isArray(bag?.traits) ? bag.traits : [];
  return traits.flatMap((trait: unknown) => {
    const { name, description } = trait as { name?: unknown; description?: unknown };
    return typeof name === "string" ? [{ name, text: typeof description === "string" ? description : "" }] : [];
  });
}

/** It breathes water: a trait (Amphibious, Water Breathing), the Water Breathing spell, or what it wears. */
export function breathesWater(actor: Actor, definition: ActorDefinition | undefined): boolean {
  if (traitsOf(definition).some((trait) => WATER_BREATHERS.test(trait.name))) return true;
  if (actor.effects.some((effect) => effect.tags.includes(WATER_BREATHING_TAG))) return true;
  return actor.inventory.some((row) => {
    const need = BREATHING_ITEMS[row.recordId ?? row.id];
    return need !== undefined && row.equipped && (need === "worn" || row.attuned);
  });
}

/** How long it can hold its breath, in rounds: 1 plus its Constitution modifier minutes, at least 30 seconds, or what
 *  a Hold Breath trait prints ("can hold its breath for 1 hour"). */
export function breathRounds(definition: ActorDefinition | undefined): number {
  for (const trait of traitsOf(definition)) {
    if (!/^hold breath$/i.test(trait.name)) continue;
    const printed = /hold its breath for (\d+) (minute|hour)/i.exec(trait.text);
    if (printed) return Number(printed[1]) * (printed[2]!.toLowerCase() === "hour" ? 60 : 1) * ROUNDS_PER_MINUTE;
  }
  const minutes = 1 + abilityModifier(definition?.abilityScores.con ?? 10);
  return Math.max(LEAST_BREATH_ROUNDS, minutes * ROUNDS_PER_MINUTE);
}

/** The creature starts holding its breath (a dive, an engulfing, a choking cloud): nothing happens to one that breathes
 *  water or already holds it. */
export function startHoldingBreath(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined
): EffectNarration[] {
  if (isDead(actor) || breathesWater(actor, definition)) return [];
  if (actor.effects.some((effect) => effect.breath !== undefined)) return [];
  const rounds = breathRounds(definition);
  const events: EffectNarration[] = [];
  addEffect(
    state,
    actor.id,
    makeEffect({
      id: `${HOLDING_BREATH_TAG}:${actor.id}`,
      name: "Holding Breath",
      tags: [HOLDING_BREATH_TAG],
      startedRound: state.combat.round,
      duration: { type: "manual" },
      breath: { roundsLeft: rounds, exhaustionGained: 0 }
    }),
    events
  );
  events.push({
    kind: "effect",
    text: `${actor.name} holds its breath: ${rounds} rounds before it starts to suffocate.`,
    actorId: actor.id
  });
  return events;
}

/** `rounds` of the creature's time pass: its breath runs down, and each round after it runs out costs a level of
 *  Exhaustion. */
function spendBreath(state: GameState, actor: Actor, rounds: number): EffectNarration[] {
  const effect = actor.effects.find((candidate) => candidate.breath !== undefined);
  if (!effect || rounds <= 0 || isDead(actor)) return [];
  const breath = effect.breath!;
  const events: EffectNarration[] = [];
  const spent = Math.min(rounds, breath.roundsLeft);
  let roundsLeft = breath.roundsLeft - spent;
  let gained = breath.exhaustionGained;
  if (breath.roundsLeft > 0 && roundsLeft === 0)
    events.push({
      kind: "effect",
      text: `${actor.name} runs out of breath and starts to suffocate.`,
      actorId: actor.id
    });
  for (let round = spent; round < rounds && !isDead(actor) && exhaustionLevel(actor) < 6; round += 1) {
    const before = exhaustionLevel(actor);
    if (applyCondition(actor, "exhaustion") !== "applied") break;
    gained += 1;
    events.push({ kind: "condition", text: `${actor.name} suffocates: Exhaustion ${before + 1}.`, actorId: actor.id });
    events.push(...conditionGained(state, actor, "exhaustion", before));
  }
  roundsLeft = Math.max(0, roundsLeft);
  actor.effects = actor.effects.map((candidate) =>
    candidate.id === effect.id
      ? {
          ...candidate,
          name: roundsLeft > 0 ? "Holding Breath" : "Suffocating",
          breath: { roundsLeft, exhaustionGained: Math.min(6, gained) }
        }
      : candidate
  );
  return events;
}

/** Its turn ends: a round of breath. */
export function breathAtTurnEnd(state: GameState, actor: Actor): EffectNarration[] {
  return spendBreath(state, actor, 1);
}

/** Time passes outside a fight: ten rounds a minute for each creature in time. */
export function breathOverTime(state: GameState, actorIds: ReadonlySet<string>, minutes: number): EffectNarration[] {
  return state.actors
    .filter((actor) => actorIds.has(actor.id))
    .flatMap((actor) => spendBreath(state, actor, minutes * ROUNDS_PER_MINUTE));
}

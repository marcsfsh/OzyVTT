import type { CheckSubject, GameState } from "@vtt/domain";
import { collectRiders } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { checkPlan } from "./ability-checks.js";
import { rollSettledCheck } from "./check-rolls.js";
import { applyCondition, type EffectNarration } from "./effects.js";
import { deriveEquipment, type EquipmentDerivation } from "./equipment-derivation.js";
import type { FallDeps } from "./falling.js";

/**
 * Jumping (SRD 5.2.1 glossary: Long Jump, High Jump). A Long Jump covers up to the Strength score in feet, a High Jump
 * 3 + the Strength modifier, each halved from a standing start (no 10 feet moved right before it). Each foot jumped
 * costs a foot of movement. Riders change the numbers: Second-Story Work jumps by Dexterity, the Jump spell triples the
 * distance and Step of the Wind doubles it, and Boots of Striding and Springing leap 30 feet for 10 feet of movement once
 * a turn. Landing in Difficult Terrain takes a DC 10 Dexterity (Acrobatics) check or leaves the jumper Prone.
 */

type Actor = GameState["actors"][number];

export type JumpLimits = Readonly<{ longFeet: number; highFeet: number }>;

const movementRiders = (derivation: EquipmentDerivation) =>
  collectRiders(derivation.carriers, { ...derivation.context, moment: null }).flatMap((rider) =>
    rider.modifier.type === "movement" ? [rider.modifier] : []
  );

/** A stat block's jump traits (SRD 5.2.1): a cat's Jumper ("using its Dexterity rather than its Strength"), a lion's
 *  Running Leap ("With a 10-foot running start, the lion can Long Jump up to 25 feet") and a frog's Standing Leap ("Long
 *  Jump is up to 10 feet and its High Jump is up to 5 feet with or without a running start"). Read from the printed
 *  traits, as senses are. */
function jumpTraits(definition: ActorDefinition | undefined) {
  const traits = (definition?.extensions["open5e.srd-2024"] as { traits?: unknown } | undefined)?.traits;
  const list = Array.isArray(traits) ? (traits as Array<{ name?: unknown; description?: unknown }>) : [];
  const text = (name: string) => {
    const trait = list.find((entry) => entry.name === name);
    return typeof trait?.description === "string" ? trait.description : null;
  };
  const standing = /Long Jump is up to (\d+) feet and its High Jump is up to (\d+) feet/.exec(
    text("Standing Leap") ?? ""
  );
  const running = /can Long Jump up to (\d+) feet/.exec(text("Running Leap") ?? "");
  return {
    byDexterity: text("Jumper") !== null,
    standing: standing ? { longFeet: Number(standing[1]), highFeet: Number(standing[2]) } : null,
    runningLongFeet: running ? Number(running[1]) : null
  };
}

/** How far a creature can jump now: across and up, in feet, with a run-up or from a standing start. */
export function jumpLimits(
  definition: ActorDefinition | undefined,
  derivation: EquipmentDerivation,
  ranUp: boolean
): JumpLimits {
  const riders = movementRiders(derivation);
  const traits = jumpTraits(definition);
  const strength = definition?.abilityScores.str ?? 10;
  const dexterity = definition?.abilityScores.dex ?? 10;
  // "You can determine your jump distance using your Dexterity rather than your Strength."
  const byDexterity = traits.byDexterity || riders.some((rider) => rider.rule === "jump-by-dexterity");
  const score = byDexterity ? Math.max(strength, dexterity) : strength;
  const times = riders
    .filter((rider) => rider.rule === "jump-multiplier")
    .reduce((product, rider) => product * (rider.times ?? 1), 1);
  const run = ranUp ? 1 : 0.5;
  if (traits.standing)
    return { longFeet: traits.standing.longFeet * times, highFeet: traits.standing.highFeet * times };
  const longScore = traits.runningLongFeet ?? score;
  const long = Math.floor(longScore * times * run);
  const high = Math.floor(Math.max(0, 3 + Math.floor((score - 10) / 2)) * times * run);
  return { longFeet: long, highFeet: high };
}

/** A rider's cheap leap (Boots of Striding and Springing: "once on each of your turns, you can jump up to 30 feet by
 *  expending only 10 feet of movement"), when the creature has one it hasn't used this turn. */
export function leapRider(
  state: GameState,
  actor: Actor,
  derivation: EquipmentDerivation
): Readonly<{ feet: number; costFeet: number; useKey: string }> | null {
  const leap = movementRiders(derivation).find((rider) => rider.rule === "leap");
  if (!leap || leap.feet === undefined) return null;
  const useKey = `${actor.id}:leap`;
  if ((state.combat.turn.turnUses[useKey] ?? 0) > 0) return null;
  return { feet: leap.feet, costFeet: leap.costFeet ?? 0, useKey };
}

/** A jump that lands in Difficult Terrain: a DC 10 Dexterity (Acrobatics) check, the server's roll, or Prone. */
export function landJump(state: GameState, actor: Actor, deps: FallDeps, events: EffectNarration[]): void {
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  const subject: CheckSubject = { ability: "dex", skill: "acrobatics" };
  const plan = checkPlan(actor, definition, deriveEquipment(actor, definition, deps.catalog), subject);
  const roll = rollSettledCheck(
    state,
    actor,
    plan,
    {
      id: deps.newId(),
      commandId: deps.commandId ?? deps.newId(),
      sessionId: deps.roller?.sessionId ?? "00000000-0000-4000-8000-000000000000",
      role: deps.roller?.role ?? "gm",
      label: `${plan.label} to land the jump`,
      visibility: actor.visibility === "gm-only" ? "gm-only" : "public",
      createdAt: deps.now()
    },
    deps.random
  );
  const prone = roll.total < 10 && applyCondition(actor, "prone") === "applied";
  events.push({
    kind: "condition",
    text: `${actor.name} lands in difficult terrain: ${roll.total} against DC 10, ${prone ? "and falls Prone" : "and keeps its feet"}.`,
    actorId: actor.id
  });
}

import { makeEffect } from "../effects.js";
import { CommandRejectedError } from "../game-store.js";
import { applyRest } from "../rests.js";
import type { ResolveContext } from "./context.js";

/**
 * SRD Prayer of Healing: "Up to five creatures of your choice who remain within range for the spell's entire casting
 * gain the benefits of a Short Rest and also regain 2d8 Hit Points. A creature can't be affected by this spell again
 * until that creature finishes a Long Rest." The healing is the cast's own; this gives the Short Rest and marks each
 * creature until its Long Rest.
 */
const PRAYED_FOR_TAG = "prayed-for";
const isPrayer = (ctx: ResolveContext) => ctx.action.spellId === "prayer-of-healing";

/** Refused before anything is paid when a target was healed by it since its last Long Rest. */
export function refuseThePrayedFor(ctx: ResolveContext): void {
  if (!isPrayer(ctx)) return;
  const again = ctx.targets.filter((target) => target.effects.some((effect) => effect.tags.includes(PRAYED_FOR_TAG)));
  if (again.length === 0) return;
  const names = again.map((target) => target.name).join(" and ");
  throw new CommandRejectedError(
    `${names} can't be affected by Prayer of Healing again until finishing a Long Rest. Choose other creatures.`
  );
}

/** Each target gains a Short Rest's benefits, as a rest gives them, and is marked until its Long Rest. */
export function prayerShortRest(ctx: ResolveContext): void {
  if (!isPrayer(ctx) || ctx.input.commit === false) return;
  const { state, deps, warnings, input } = ctx;
  for (const target of ctx.targets) {
    target.effects = [
      ...target.effects,
      makeEffect({
        id: `${input.commandId}:${target.id}:prayed-for`,
        name: "Prayer of Healing",
        tags: [PRAYED_FOR_TAG],
        sourceActorId: ctx.attacker.id,
        sourceName: ctx.attacker.name,
        startedRound: state.combat.round,
        duration: { type: "until-rest", rest: "long" }
      })
    ];
    if (!deps.resolveDefinition) continue;
    try {
      applyRest(state, target.id, "short", deps.resolveDefinition, deps.catalog);
      warnings.push(`${target.name} gains the benefits of a Short Rest.`);
    } catch (error) {
      if (!(error instanceof CommandRejectedError)) throw error;
      warnings.push(`${target.name} gets no Short Rest from Prayer of Healing: ${error.message}`);
    }
  }
}

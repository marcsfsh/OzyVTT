import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import { endEffect } from "../effects.js";
import { sensesOf } from "../vision/senses.js";
import { recordRoll, type ResolveContext } from "./context.js";

/**
 * SRD Mirror Image: "Each time a creature hits you with an attack roll during the spell's duration, roll a d6 for each
 * of your remaining duplicates. If any of the d6s rolls a 3 or higher, one of the duplicates is hit instead of you, and
 * the duplicate is destroyed ... The spell ends when all three duplicates are destroyed. A creature is unaffected by
 * this spell if it has the Blinded condition, Blindsight, or Truesight." The duplicates left ride the effect's tags
 * (`mirror-image-3`), since the effect holds no count of its own.
 */
export const MIRROR_IMAGE_TAG = "mirror-image";
const COUNT_PREFIX = "mirror-image-";

/** Rolled once a hit on the bearer is settled: a duplicate taking it turns the hit into a miss. */
export function strikeADuplicate(ctx: ResolveContext): void {
  const { attack, attacker, state, deps, warnings, targets } = ctx;
  if (attack === null || (attack.outcome !== "hit" && attack.outcome !== "crit")) return;
  const target = targets.find((candidate) => candidate.id === attack.targetId) ?? targets[0];
  const images = target?.effects.find((effect) => effect.tags.includes(MIRROR_IMAGE_TAG));
  if (!target || !images) return;
  if (attacker.conditions.some((condition) => condition.id === "blinded")) return;
  const senses = sensesOf(state, attacker, {
    ...(deps.resolveDefinition ? { definition: deps.resolveDefinition } : {}),
    ...(deps.catalog ? { catalog: deps.catalog } : {})
  });
  if (senses.blindsight > 0 || senses.truesight > 0) return;
  const counted = images.tags.find((tag) => tag.startsWith(COUNT_PREFIX));
  const left = counted ? Number(counted.slice(COUNT_PREFIX.length)) : 3;
  if (!(left > 0)) return;
  const faces: number[] = [];
  for (let duplicate = 0; duplicate < left; duplicate += 1) {
    const rolled = resolveDice(parseDiceFormula("1d6"), deps.random);
    recordRoll(ctx, rolled, "manual", "Mirror Image");
    faces.push(rolled.total);
  }
  if (!faces.some((face) => face >= 3)) {
    warnings.push(`Mirror Image: the d6s show ${faces.join(", ")}, so the attack hits ${target.name}.`);
    return;
  }
  ctx.attack = { ...attack, outcome: "miss" };
  const remaining = left - 1;
  if (remaining === 0) {
    endEffect(state, target.id, images.id);
    warnings.push(`Mirror Image: the attack hits ${target.name}'s last duplicate, and the spell ends.`);
    return;
  }
  target.effects = target.effects.map((effect) =>
    effect.id === images.id
      ? {
          ...effect,
          tags: [...effect.tags.filter((tag) => !tag.startsWith(COUNT_PREFIX)), `${COUNT_PREFIX}${remaining}`]
        }
      : effect
  );
  warnings.push(
    `Mirror Image: the attack hits a duplicate instead of ${target.name}. ${remaining} duplicate${remaining === 1 ? "" : "s"} left.`
  );
}

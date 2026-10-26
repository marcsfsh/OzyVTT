import { isEthereal, planeOf } from "../ethereal.js";
import { CommandRejectedError } from "../game-store.js";
import { sightRules } from "../vision/rules.js";
import type { ResolveContext } from "./context.js";

/**
 * What a monster's spell holds to beyond the spell's own rules (`ActionSchema.castRiders`), as a night hag's Nightmare
 * Haunting casts Dream: "While on the Ethereal Plane, the hag casts Dream ... the target must be a creature the hag
 * can see on the Material Plane. The spell fails and is wasted if the target is under the effect of the Protection
 * from Evil and Good spell or within a Magic Circle spell." What its damage later does rides the effect it leaves
 * (`rest-triggers.ts`).
 */

/** Refuses the cast off the Border Ethereal, or at a creature that isn't on the Material Plane. */
export function checkCastRiders(ctx: ResolveContext): void {
  const riders = ctx.action.castRiders;
  if (!riders?.fromEthereal) return;
  if (!isEthereal(ctx.attacker))
    throw new CommandRejectedError(`${ctx.attacker.name} uses ${ctx.action.name} only while on the Ethereal Plane.`);
  const away = ctx.targets.find((target) => planeOf(target) !== "material");
  if (away)
    throw new CommandRejectedError(
      `${ctx.action.name} reaches only a creature on the Material Plane, and ${ctx.hiddenFromInitiator(away.id) ? "that creature" : away.name} isn't there.`
    );
  const sight = sightRules(
    ctx.state,
    {
      ...(ctx.deps.resolveDefinition ? { definition: ctx.deps.resolveDefinition } : {}),
      ...(ctx.deps.catalog ? { catalog: ctx.deps.catalog } : {})
    },
    ctx.deps.distanceFeet
  );
  const unseen = ctx.targets.find((target) => !sight.canSee(ctx.attacker.id, target.id));
  if (unseen)
    throw new CommandRejectedError(
      `${ctx.action.name} needs a creature ${ctx.attacker.name} can see, and it can't see ${ctx.hiddenFromInitiator(unseen.id) ? "that creature" : unseen.name}.`
    );
}

/** The cast fails and is wasted when a target holds a ward it names (Protection from Evil and Good, a Magic Circle):
 *  true after telling the table, so its use is spent and nothing else happens. */
export function wastedByWard(ctx: ResolveContext): boolean {
  const wards = ctx.action.castRiders?.failsUnder;
  if (!wards || ctx.input.commit === false) return false;
  for (const target of ctx.targets) {
    const ward = target.effects.find(
      (effect) => wards.some((id) => effect.tags.includes(id)) || (effect.spell && wards.includes(effect.spell.id))
    );
    if (!ward) continue;
    ctx.tableNarration.push({
      kind: "effect",
      text: `${ctx.action.name} fails and is wasted: ${target.name} is warded by ${ward.name}.`,
      actorIds: [ctx.attacker.id, target.id]
    });
    return true;
  }
  return false;
}

import { traitOf } from "../statblock-traits.js";
import { attackUsedAsRanged } from "./attack.js";
import type { LiveActor, ResolveContext, ResolveInput } from "./context.js";

/**
 * SRD 5.2.1 tarrasque, Reflective Carapace: "If the tarrasque is targeted by a Magic Missile spell or a spell that
 * requires a ranged attack roll, roll 1d6. On a 1-5, the tarrasque is unaffected. On a 6, the tarrasque is unaffected
 * and reflects the spell, turning the caster into the target." The server rolls the d6 for each such target as the
 * spell resolves. An unaffected one leaves the spell (its Magic Missile darts are lost), and a reflection puts the
 * caster in its place, as a Redirect Attack hands an attack on (`redirect.ts`).
 *
 * Returns true when the spell has no target left, so nothing more of it happens.
 */
export function reflectOffCarapace(ctx: ResolveContext): boolean {
  const { action, attacker, deps } = ctx;
  if (ctx.input.commit === false || action.spellId === undefined || !deps.resolveDefinition) return false;
  const missile = action.spellId === "magic-missile";
  const resolve = deps.resolveDefinition;
  const turned = new Map<string, "unaffected" | "reflected">();
  for (const target of ctx.targets) {
    if (turned.has(target.id) || target.id === attacker.id) continue;
    const trait = target.definitionId ? traitOf(resolve(target.definitionId), "reflective-carapace") : undefined;
    if (!trait) continue;
    const ranged =
      action.attack !== undefined &&
      attackUsedAsRanged(action.attack, deps.distanceFeet?.(attacker.id, target.id) ?? null);
    if (!missile && !ranged) continue;
    const die = deps.random(6);
    turned.set(target.id, die === 6 ? "reflected" : "unaffected");
    ctx.tableNarration.push({
      kind: "effect",
      text:
        die === 6
          ? `${target.name}'s ${trait.name} reflects ${action.name} (rolled 6): ${attacker.name} becomes the target.`
          : `${target.name} is unaffected by ${action.name} (${trait.name}: rolled ${die}).`,
      actorIds: [attacker.id, target.id]
    });
  }
  if (turned.size === 0) return false;
  const swap = (id: string) => (turned.get(id) === "reflected" ? attacker.id : id);
  // Darts aimed at an unaffected tarrasque stay aimed there and strike no one (`dartDamageTargetsOf`).
  const targetIds = ctx.input.targetIds.map(swap);
  const kept: LiveActor[] = [];
  for (const target of ctx.targets) {
    const next = turned.get(target.id) === "reflected" ? attacker : turned.has(target.id) ? null : target;
    if (next && !kept.some((actor) => actor.id === next.id)) kept.push(next);
  }
  (ctx as { input: ResolveInput }).input = { ...ctx.input, targetIds };
  (ctx as { targets: readonly LiveActor[] }).targets = kept;
  return kept.length === 0;
}

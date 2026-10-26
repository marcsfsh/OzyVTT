import { endEffect, POSSESSED_TAG } from "../effects.js";
import { endCasterSpell } from "../spell-endings.js";
import { creatureTypeOf } from "../statblock-facts.js";
import { endedEffect, tableLineOf, type ResolveContext } from "./context.js";

/**
 * SRD 5.2.1 Dispel Evil and Good's special functions, each a Magic action that ends the spell. Break Enchantment: "you
 * touch a creature that is possessed by or has the Charmed or Frightened condition from one or more creatures of the
 * types above. The target is no longer possessed, Charmed, or Frightened by such creatures." Dismissal's save and its
 * sending home are the action's own save (`failureBanishes`, `fatal-saves.ts`).
 */

const ENCHANTMENTS: ReadonlySet<string> = new Set(["charmed", "frightened"]);

/** Ends what creatures of the action's types charmed, frightened or possessed its target with. */
export function breakEnchantment(ctx: ResolveContext): void {
  const rule = ctx.action.breaksEnchantment;
  const target = ctx.targets[0];
  if (!rule || !target || ctx.input.commit === false) return;
  const { state, deps } = ctx;
  const fromWarded = (sourceActorId: string | null) => {
    const source = state.actors.find((candidate) => candidate.id === sourceActorId);
    const definition = source?.definitionId ? deps.resolveDefinition?.(source.definitionId) : undefined;
    const type = source ? creatureTypeOf(source, definition) : null;
    return type !== null && rule.creatureTypes.includes(type);
  };
  const lifted = target.effects.filter(
    (effect) =>
      (effect.tags.includes(POSSESSED_TAG) || effect.linkedConditionIds.some((id) => ENCHANTMENTS.has(id))) &&
      fromWarded(effect.sourceActorId)
  );
  for (const effect of lifted) {
    ctx.effectsEnded.push(endedEffect(target, effect));
    for (const event of endEffect(state, target.id, effect.id)) ctx.tableNarration.push(tableLineOf(ctx, event));
  }
  ctx.tableNarration.push({
    kind: "effect",
    text:
      lifted.length > 0
        ? `${target.name} is free of ${lifted.map((effect) => effect.name).join(" and ")} (${ctx.action.name}).`
        : `Nothing such a creature gave ${target.name} holds it, so ${ctx.action.name} ends nothing.`,
    actorIds: [target.id]
  });
}

/** An action that ends its spell as it is taken ("You can end the spell early by using either of the following special
 *  functions"): the caster's Concentration on it and what it left end; a save it opened stays owed. */
export function endOwnSpell(ctx: ResolveContext): void {
  const { action, attacker, input } = ctx;
  if (!action.endsOwnSpell || !action.spellId || input.commit === false) return;
  for (const event of endCasterSpell(ctx.state, attacker.id, action.spellId))
    ctx.tableNarration.push(tableLineOf(ctx, event));
}

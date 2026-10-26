import { endEffect } from "../effects.js";
import { itemActionId, TWO_HANDED_SUFFIX } from "../item-actions.js";
import { tableLineOf, type ResolveContext } from "./context.js";

/**
 * SRD 5.2.1 True Strike: "you make one attack with the weapon used in the spell's casting", as part of the cast's Magic
 * action. The cast binds the weapon (its spellcasting ability, Radiant damage, the extra Radiant by level) and leaves
 * its action open for one attack with that weapon alone; the binding ends with that attack.
 */

/** The binding an attacks-now cast just made on its caster, if any. */
function strikeOf(ctx: Pick<ResolveContext, "state" | "attacker" | "action">) {
  const caster = ctx.state.actors.find((actor) => actor.id === ctx.attacker.id);
  return caster?.effects.find(
    (effect) => effect.sourceActionId === ctx.action.id && effect.itemId !== undefined && effect.weapon !== undefined
  );
}

/** After the cast's economy: its action stays open for one attack with the bound weapon, one-handed or two. */
export function openStrike(ctx: ResolveContext): void {
  const { state, action, attacker, input } = ctx;
  if (input.commit === false || !action.grants?.bindsWeapon?.attacksNow) return;
  const bound = strikeOf(ctx);
  if (!bound?.itemId) return;
  const row = attacker.inventory.find((entry) => entry.id === bound.itemId);
  if (state.combat.active) {
    const key = `${itemActionId(bound.itemId)}|${itemActionId(bound.itemId, TWO_HANDED_SUFFIX)}`;
    const current = state.combat.turn.actionInstance;
    state.combat = {
      ...state.combat,
      turn: {
        ...state.combat.turn,
        actionInstance: {
          ...(current && current.actorId === attacker.id ? current : {}),
          actorId: attacker.id,
          components: { [key]: 1 }
        }
      }
    };
  }
  ctx.tableNarration.push({
    kind: "effect",
    text: `${attacker.name} makes one attack with ${row?.name ?? "the weapon"} as part of casting ${action.name}.`,
    actorIds: [attacker.id]
  });
}

/** The attack made with a weapon a True Strike bound: the binding ends with it. */
export function spendStrike(ctx: ResolveContext): void {
  const { state, action, attacker, input } = ctx;
  if (input.commit === false || !action.attack || action.spellId !== undefined) return;
  const caster = state.actors.find((actor) => actor.id === attacker.id);
  const bound = caster?.effects.find(
    (effect) =>
      effect.tags.includes("true-strike") &&
      effect.itemId !== undefined &&
      (action.id === itemActionId(effect.itemId) || action.id === itemActionId(effect.itemId, TWO_HANDED_SUFFIX))
  );
  if (!bound) return;
  for (const event of endEffect(state, attacker.id, bound.id)) ctx.tableNarration.push(tableLineOf(ctx, event));
}

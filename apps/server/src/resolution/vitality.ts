import { isDead, type GameState, type PendingSave } from "@vtt/domain";
import type { EffectNarration } from "../effects.js";
import { CommandRejectedError } from "../game-store.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import type { ResolveContext } from "./context.js";

/**
 * An action's `vitality` (SRD Improved Blessed Strikes, Potent Spellcasting): "When you cast a Cleric cantrip and deal
 * damage to a creature with it, you can give vitality to yourself or another creature within 60 feet of yourself,
 * granting a number of Temporary Hit Points equal to twice your Wisdom modifier." The creature is picked with the cast
 * (`vitalityTo`, the caster when absent) and checked before anything rolls; the Temporary Hit Points land once the
 * cast's damage does, once for the cast.
 */

/** Who the action's Temporary Hit Points go to, refused when out of range; null for an action without `vitality`. */
export function vitalityRecipient(ctx: ResolveContext): string | null {
  const vitality = ctx.action.vitality;
  if (!vitality) {
    if (ctx.input.vitalityTo !== undefined)
      throw new CommandRejectedError(`${ctx.action.name} gives no Temporary Hit Points to pick a creature for.`);
    return null;
  }
  const recipientId = ctx.input.vitalityTo ?? ctx.attacker.id;
  if (recipientId === ctx.attacker.id) return recipientId;
  const recipient = ctx.state.actors.find((actor) => actor.id === recipientId);
  if (!recipient || isDead(recipient))
    throw new CommandRejectedError("Choose a living creature on the table for the Temporary Hit Points.");
  const apart = ctx.deps.distanceFeet?.(ctx.attacker.id, recipientId) ?? null;
  if (apart !== null && apart > vitality.rangeFeet + DISTANCE_TOLERANCE_FEET)
    throw new CommandRejectedError(
      `${recipient.name} is more than ${vitality.rangeFeet} feet from ${ctx.attacker.name}, too far for the Temporary Hit Points.`
    );
  return recipientId;
}

/** What a cast's saves carry so the first one to deal damage gives the Temporary Hit Points. */
export function vitalityOfCast(ctx: ResolveContext): PendingSave["vitality"] | undefined {
  const recipient = vitalityRecipient(ctx);
  if (recipient === null || !ctx.action.vitality) return undefined;
  return { actorId: recipient, amount: ctx.action.vitality.amount, key: ctx.input.commandId };
}

/** Gives the Temporary Hit Points, keeping the higher (SRD Temporary Hit Points), and clears them from the cast's other
 *  saves, so the cast gives them once. */
export function giveVitality(state: GameState, vitality: NonNullable<PendingSave["vitality"]>): EffectNarration[] {
  state.combat = {
    ...state.combat,
    pendingSaves: state.combat.pendingSaves.map((save) => {
      if (save.vitality?.key !== vitality.key) return save;
      const { vitality: _given, ...rest } = save;
      return rest;
    })
  };
  const recipient = state.actors.find((actor) => actor.id === vitality.actorId);
  if (!recipient || isDead(recipient) || recipient.hp.temporary >= vitality.amount) return [];
  recipient.hp = { ...recipient.hp, temporary: vitality.amount };
  return [
    {
      kind: "effect",
      text: `${recipient.name} gains ${vitality.amount} Temporary Hit Points (Potent Spellcasting).`,
      actorId: recipient.id
    }
  ];
}

/** A cantrip's attack that hit and dealt damage gives its Temporary Hit Points as it is confirmed. */
export function vitalityOnHit(ctx: ResolveContext): void {
  const { attack, input } = ctx;
  if (!ctx.action.vitality || attack === null || input.commit === false) return;
  if ((attack.outcome !== "hit" && attack.outcome !== "crit") || ctx.damage.every((part) => part.total <= 0)) return;
  const given = vitalityOfCast(ctx);
  if (!given) return;
  for (const event of giveVitality(ctx.state, given)) ctx.warnings.push(event.text);
}

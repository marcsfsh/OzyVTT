import { catalogIdOf, type EndedBy } from "@vtt/schemas";
import type { CheckSubject } from "../ability-checks.js";
import { addEffect, endEffect, makeEffect } from "../effects.js";
import {
  ENDED_BY_PREFIX,
  ENDING_LOCKOUT_TAG,
  endingOptions,
  endingSlug,
  lockoutMarkId,
  type EndingOption
} from "../ending-actions.js";
import { CommandRejectedError } from "../game-store.js";
import { applyDamageDetailed } from "../hit-points.js";
import { itemRowOfAction } from "../item-charges.js";
import { setInventoryItem } from "../inventory.js";
import { openEndingSave } from "../save-stages.js";
import { carriedRow } from "../utilize.js";
import { rollCheck } from "./builtins.js";
import { endedEffect, tableLineOf, type LiveActor, type ResolveContext } from "./context.js";
import { rollPlain } from "./hit-rider-outcomes.js";

/**
 * Ending an effect by the action its text prints (SRD 5.2.1): the generic End an Effect on the creature targeted, and
 * the bearer's own named ways out (escaping or bursting a Chain, slipping Manacles). A check must succeed; a tool the
 * means names must be carried, and its proficiency counts; a failure can hurt the bearer (a Hunting Trap's 1 Piercing)
 * or lock the taker out (Iron Bands' 24 hours); a success can destroy the item that made the effect (Iron Bands).
 */

/**
 * End an Effect: the action an effect's text prints to end it, on the one creature targeted (the user itself when none
 * is), by the means `optionId` names or else the first one open to the user. Repeating a save by action opens that
 * save (a success ends it, as any repeat does).
 */
export function endAnEffect(ctx: ResolveContext): void {
  const { state, attacker, input, deps } = ctx;
  const bearer = ctx.targets[0] ?? attacker;
  const options = endingOptions(attacker, bearer, deps.distanceFeet).filter(
    (option) => input.effectId == null || option.effect.id === input.effectId
  );
  const chosen =
    input.optionId != null
      ? options.find((option) => option.kind === "ended-by" && endingSlug(option.ending) === input.optionId)
      : options[0];
  if (!chosen)
    throw new CommandRejectedError(
      bearer.id === attacker.id
        ? `${attacker.name} has no effect it can end with an action.`
        : `${bearer.name} has no effect ${attacker.name} can end from where it stands.`
    );
  if (chosen.kind === "repeat") {
    const line = openEndingSave(state, bearer, chosen.effect, chosen.effect.repeatSave!, "repeats", {
      newId: deps.newRollId,
      now: deps.now,
      rollDie: deps.random
    });
    ctx.tableNarration.push(tableLineOf(ctx, line));
    return;
  }
  takeEnding(ctx, chosen);
}

/** A bearer's own named way out ("ended-by-burst-the-chain"), on the first of its effects that offers it. */
export function namedEnding(ctx: ResolveContext): void {
  const { attacker, action } = ctx;
  const slug = action.id.slice(ENDED_BY_PREFIX.length);
  const chosen = endingOptions(attacker, attacker).find(
    (option): option is Extract<EndingOption, { kind: "ended-by" }> =>
      option.kind === "ended-by" && endingSlug(option.ending) === slug
  );
  if (!chosen) throw new CommandRejectedError(`${attacker.name} has nothing it can end that way.`);
  takeEnding(ctx, chosen);
}

/** Whether an action id is one of a bearer's named ways out. */
export const isNamedEnding = (actionId: string): boolean => actionId.startsWith(ENDED_BY_PREFIX);

function takeEnding(ctx: ResolveContext, chosen: Extract<EndingOption, { kind: "ended-by" }>): void {
  const { state, attacker } = ctx;
  const { bearer, effect, ending } = chosen;
  if (ending.check) {
    const subject = subjectOf(ctx, ending);
    // "Any further attempts made by that creature automatically fail until 24 hours have elapsed."
    const locked = attacker.effects.some((mark) => mark.id === lockoutMarkId(bearer.id, effect.id));
    if (locked) {
      ctx.tableNarration.push({
        kind: "effect",
        text: `${attacker.name}'s attempt (${ending.name}) fails: an earlier one failed within ${ending.lockoutHours ?? 24} hours.`,
        actorIds: [attacker.id, bearer.id]
      });
      return;
    }
    if (rollCheck(ctx, subject, ending.check.dc ?? null, `${ending.name}: check`) !== true) {
      failedTry(ctx, bearer, effect.id, effect.sourceName ?? effect.name, ending);
      return;
    }
  }
  endEffect(state, bearer.id, effect.id);
  ctx.effectsEnded.push(endedEffect(bearer, effect));
  ctx.tableNarration.push({
    kind: "effect",
    text: `${attacker.name} ends ${effect.name} on ${bearer.name} (${ending.name}).`,
    actorIds: [attacker.id, bearer.id]
  });
  if (ending.destroysItem) destroySourceItem(ctx, effect);
  // "The puller takes 10 (3d6) Acid damage."
  for (const part of ending.takerDamage ?? []) hurt(ctx, attacker, part, effect.sourceName ?? effect.name, ending.name);
}

/** The check a means takes: its ability and skill, and the tool whose proficiency counts, which the taker must carry. */
function subjectOf(ctx: ResolveContext, ending: EndedBy): CheckSubject {
  const check = ending.check!;
  if (ending.tool !== undefined && !carriedRow(ctx.attacker, ending.tool)) {
    const name = ctx.deps.catalog?.equipmentRecord(ending.tool)?.name ?? ending.tool;
    throw new CommandRejectedError(`${ctx.attacker.name} needs ${name} in the pack to do that.`);
  }
  return {
    ability: check.ability,
    ...(check.skill !== undefined ? { skill: check.skill } : {}),
    ...(ending.tool !== undefined ? { tool: ending.tool } : {})
  };
}

/** What a failed try costs: the bearer's damage (a Hunting Trap), and the taker's lockout (Iron Bands). */
function failedTry(
  ctx: ResolveContext,
  bearer: LiveActor,
  effectId: string,
  sourceName: string,
  ending: EndedBy
): void {
  for (const part of ending.failureDamage ?? []) hurt(ctx, bearer, part, sourceName, ending.name);
  if (ending.lockoutHours === undefined) return;
  addEffect(
    ctx.state,
    ctx.attacker.id,
    makeEffect({
      id: lockoutMarkId(bearer.id, effectId),
      name: `${ending.name} failed`.slice(0, 120),
      tags: [ENDING_LOCKOUT_TAG],
      sourceActorId: ctx.attacker.id,
      sourceName: ctx.attacker.name,
      startedRound: ctx.state.combat.round,
      duration: { type: "minutes", remaining: ending.lockoutHours * 60 }
    })
  );
}

function hurt(
  ctx: ResolveContext,
  victim: LiveActor,
  part: Readonly<{ formula: string; type: string }>,
  sourceName: string,
  what: string
): void {
  const { state, deps } = ctx;
  const rolled = rollPlain(ctx, part.formula, part.type, what);
  const { application, events } = applyDamageDetailed(
    state,
    victim.id,
    { amount: rolled.amount, parts: [rolled], sourceName },
    { role: "gm" },
    {
      resolveDefinition: deps.resolveDefinition ?? (() => undefined),
      newId: deps.newRollId,
      now: deps.now,
      rollDie: deps.random,
      ...(deps.catalog ? { catalog: deps.catalog } : {})
    }
  );
  ctx.tableNarration.push({
    kind: "effect",
    text: `${victim.name} takes ${application.totalApplied} ${part.type[0]!.toUpperCase()}${part.type.slice(1)} damage (${what}).`,
    actorIds: [victim.id]
  });
  for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
}

/** "On a successful check, the item is destroyed": one of the row whose action made the effect leaves its user. */
function destroySourceItem(ctx: ResolveContext, effect: LiveActor["effects"][number]): void {
  const { state, deps } = ctx;
  const owner = state.actors.find((actor) => actor.id === effect.sourceActorId);
  const row = owner && effect.sourceActionId ? itemRowOfAction(effect.sourceActionId, owner.inventory) : null;
  if (!owner || !row || !deps.resolveDefinition) return;
  setInventoryItem(state, owner.id, { ...row, quantity: Math.max(0, row.quantity - 1) }, deps.resolveDefinition, {
    ...(deps.catalog ? { catalog: deps.catalog } : {}),
    role: "gm"
  });
  const name = deps.catalog?.equipmentRecord(catalogIdOf(row))?.name ?? row.name;
  ctx.tableNarration.push({ kind: "effect", text: `${name} is destroyed.`, actorIds: [owner.id] });
}

/** An item's command that releases what its other actions hold (Iron Bands: "until you take a Bonus Action to issue a
 *  command that releases it"; a Rope of Entanglement's): each such effect its user's row left on a creature ends. */
export function releaseItemEffects(ctx: ResolveContext): void {
  const { state, action, attacker, input } = ctx;
  if (!action.endsItemEffects || input.commit === false) return;
  const row = itemRowOfAction(action.id, attacker.inventory);
  if (!row) return;
  const released = state.actors.flatMap((bearer) =>
    bearer.effects
      .filter(
        (effect) =>
          effect.sourceActorId === attacker.id &&
          effect.sourceActionId !== null &&
          effect.sourceActionId !== action.id &&
          itemRowOfAction(effect.sourceActionId, attacker.inventory)?.id === row.id
      )
      .map((effect) => ({ bearer, effect }))
  );
  if (released.length === 0) ctx.warnings.push(`${row.name} holds no one to release.`);
  for (const { bearer, effect } of released) {
    endEffect(state, bearer.id, effect.id);
    ctx.effectsEnded.push(endedEffect(bearer, effect));
    ctx.tableNarration.push({
      kind: "effect",
      text: `${attacker.name} releases ${bearer.name} from ${effect.name}.`,
      actorIds: [attacker.id, bearer.id]
    });
  }
}

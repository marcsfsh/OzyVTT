import { addEffect, makeEffect, turnEndDuration, type EffectNarration } from "../effects.js";
import { deriveEquipment } from "../equipment-derivation.js";
import { currentSpeedFeet } from "../speed.js";
import type { ResolveContext } from "./context.js";

/** Granted effects (Rage, Reckless Attack on self; Help on an ally): replace-on-refresh, ending when the
 *  granter drops to 0 HP. */
export function applyGrant(ctx: ResolveContext): void {
  const { state, action, attacker, targets, input, deps, warnings } = ctx;
  const grant = action.grants;
  if (!grant) return;
  const recipient = grant.target === "target" ? targets[0] : attacker;
  // A concentration grant may end the granter's previous concentration; surfaced as a warning line.
  const replaced: EffectNarration[] = [];
  // Dash grants a quantity measured now, so a later Slow this turn doesn't shrink it. Keyed on the
  // `dashing` tag so homebrew actions match.
  const recipientDefinition =
    recipient.id === attacker.id
      ? deps.definition
      : recipient.definitionId
        ? deps.resolveDefinition?.(recipient.definitionId)
        : undefined;
  const grantedMovement = grant.tags.includes("dashing")
    ? {
        movementGrantFeet:
          currentSpeedFeet(recipient, deriveEquipment(recipient, recipientDefinition, deps.catalog)) ?? 0
      }
    : {};
  const effect = addEffect(
    state,
    recipient.id,
    makeEffect({
      id: `${input.commandId}:grant`,
      name: ctx.builtin?.grantName?.(ctx) ?? grant.name ?? action.name,
      tags: grant.tags,
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      sourceActionId: action.id,
      startedRound: state.combat.round,
      duration:
        grant.duration.type === "rounds"
          ? { type: "rounds", remaining: grant.duration.rounds }
          : grant.duration.type === "until-source-turn-end"
            ? turnEndDuration(state, "until-source-turn-end", attacker.id)
            : grant.duration,
      endsWhenSourceDefeated: true,
      voidWhileIncapacitated: grant.voidWhileIncapacitated,
      modifiers: grant.modifiers,
      onEnd: grant.onEnd,
      endsWithTag: grant.endsWithTag ?? null,
      concentration: grant.concentration,
      ...grantedMovement
    }),
    replaced,
    deps
  );
  warnings.push(...replaced.map((event) => event.text));
  if (grant.target === "target")
    ctx.effectsApplied.push({
      targetId: recipient.id,
      targetName: recipient.name,
      name: effect.name,
      conditionIds: []
    });
  else ctx.effectGranted = { name: effect.name, tags: effect.tags };
}

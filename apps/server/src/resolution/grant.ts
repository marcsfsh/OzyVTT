import type { GameState } from "@vtt/domain";
import { addEffect, makeEffect, turnEndDuration, type EffectNarration } from "../effects.js";
import { deriveEquipment } from "../equipment-derivation.js";
import { currentSpeedFeet } from "../speed.js";
import type { DefinitionAction, LiveActor, ResolveContext } from "./context.js";

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
      ...(grant.damageUses !== undefined ? { damageUses: grant.damageUses } : {}),
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

/** An item's self grant used outside a fight (Antitoxin drunk before the dungeon, a blade coated on the road): the
 *  same effect on its user, counted once a fight's turns start. Nothing for a grant aimed at a target. */
export function grantOutsideFight(
  state: GameState,
  actor: LiveActor,
  action: DefinitionAction,
  commandId: string
): EffectNarration[] {
  const grant = action.grants;
  if (!grant || grant.target === "target") return [];
  const events: EffectNarration[] = [];
  const effect = addEffect(
    state,
    actor.id,
    makeEffect({
      id: `${commandId}:grant`,
      name: grant.name ?? action.name,
      tags: grant.tags,
      sourceActorId: actor.id,
      sourceName: actor.name,
      sourceActionId: action.id,
      startedRound: state.combat.round,
      duration:
        grant.duration.type === "rounds"
          ? { type: "rounds", remaining: grant.duration.rounds }
          : grant.duration.type === "until-source-turn-end"
            ? turnEndDuration(state, "until-source-turn-end", actor.id)
            : grant.duration,
      endsWhenSourceDefeated: true,
      voidWhileIncapacitated: grant.voidWhileIncapacitated,
      modifiers: grant.modifiers,
      onEnd: grant.onEnd,
      endsWithTag: grant.endsWithTag ?? null,
      concentration: grant.concentration,
      ...(grant.damageUses !== undefined ? { damageUses: grant.damageUses } : {})
    }),
    events
  );
  return [{ kind: "effect", text: `${actor.name} gains ${effect.name}.`, actorId: actor.id }, ...events];
}

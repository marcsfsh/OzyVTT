import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import { addEffect, CONCENTRATING_TAG, endEffect } from "../effects.js";
import { laterSpellActionId } from "../item-actions.js";
import { spellOf } from "./concentration.js";
import type { LiveActor, ResolveContext } from "./context.js";

/** The later action of a spell that moves its mark (Hunter's Mark, Hex), when `actionId` is one. */
export function markMoveOf(spell: SpellReference, actionId: string) {
  return (spell.effect?.laterActions ?? []).find(
    (row) => row.movesGrant === true && laterSpellActionId(spell.id, row.name) === actionId
  );
}

/** The marks a caster's Concentration on a spell holds: its grant on creatures, from the cast still concentrated on. */
export function castMarks(
  state: GameState,
  caster: LiveActor,
  spell: SpellReference
): ReadonlyArray<Readonly<{ bearer: LiveActor; effect: LiveActor["effects"][number] }>> {
  const tags = spell.effect?.grant?.tags ?? [];
  const held = new Set(
    caster.effects
      .filter((effect) => effect.tags.includes(CONCENTRATING_TAG) && effect.castId !== undefined)
      .map((effect) => effect.castId)
  );
  return state.actors.flatMap((bearer) =>
    bearer.effects
      .filter(
        (effect) =>
          effect.sourceActorId === caster.id &&
          effect.castId !== undefined &&
          held.has(effect.castId) &&
          tags.some((tag) => effect.tags.includes(tag))
      )
      .map((effect) => ({ bearer, effect }))
  );
}

/** SRD Hunter's Mark and Hex: "If the target drops to 0 Hit Points before this spell ends, you can take a Bonus Action
 *  to move the mark to a new creature". The cast's mark leaves the downed creature for this action's target, still
 *  held by the caster's Concentration on that cast. True when the action was such a move. */
export function moveMark(ctx: ResolveContext): boolean {
  const spell = spellOf(ctx);
  if (!spell || !markMoveOf(spell, ctx.action.id)) return false;
  const { state, attacker, targets, input } = ctx;
  const target = targets[0];
  const marks = castMarks(state, attacker, spell);
  if (!target || marks.length === 0) return true;
  for (const { bearer, effect } of marks) endEffect(state, bearer.id, effect.id);
  const mark = addEffect(state, target.id, {
    ...marks[0].effect,
    id: `${input.commandId}:mark`,
    startedRound: state.combat.round
  });
  ctx.effectsApplied.push({ targetId: target.id, targetName: target.name, name: mark.name, conditionIds: [] });
  ctx.tableNarration.push({
    kind: "effect",
    text: `${attacker.name} moves ${spell.name} to ${target.name}.`,
    actorIds: [attacker.id, target.id]
  });
  return true;
}

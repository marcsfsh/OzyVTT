import { laterRowOf } from "../item-actions.js";
import { pickedZoneRow } from "../spell-zones.js";
import { applyCastSight } from "../vision/cast-sight.js";
import { RING_FEET } from "../zone-shapes.js";
import { spellEffectDuration, spellOf } from "./concentration.js";
import { tableLineOf, type ResolveContext } from "./context.js";

/**
 * What a cast or an action does to light and sight (the spell's or the action's `sight`): the light it makes and the
 * area of fog or magical Darkness it fills, kept by the caster's Concentration on this cast, by the effect the cast or
 * action leaves on its user, or by the spell's own duration in rounds, and the spell light or Darkness it dispels.
 * Runs after the cast's Concentration, its marker, its zone and its grant are in place, so what it makes ends with them.
 */
export function placeCastSight(ctx: ResolveContext): void {
  const spell = spellOf(ctx);
  const declared = ctx.action.sight ?? spell?.sight;
  if (!declared) return;
  // Moving Moonbeam or hurling Produce Flame is no new cast.
  if (spell && laterRowOf(spell, ctx.action.id) !== undefined) return;
  const { state, attacker, input } = ctx;
  const own = (id: string) => attacker.effects.some((effect) => effect.id === id);
  const effectId = own(`${input.commandId}:spell`)
    ? `${input.commandId}:spell`
    : ctx.castId === null && own(`${input.commandId}:grant`)
      ? `${input.commandId}:grant`
      : null;
  // With nothing else to keep it, a spell's light lasts its printed rounds (Fire Shield's 10 minutes).
  const duration =
    spell && ctx.castId === null && effectId === null
      ? spellEffectDuration(spell, ctx.plan.castLevel ?? spell.level)
      : null;
  const sight =
    declared.rounds === undefined && duration?.type === "rounds" && duration.remaining > 0
      ? { ...declared, rounds: duration.remaining }
      : declared;
  // A ringed wall blocks sight on its edge alone (Wall of Fire's ring).
  const ringed = spell ? pickedZoneRow(spell, input.option)?.zone?.ring === true : false;
  const events = applyCastSight(state, {
    commandId: input.commandId,
    casterId: attacker.id,
    sight,
    ...(spell ? { spellId: spell.id, level: ctx.plan.castLevel ?? spell.level } : { actionId: ctx.action.id }),
    castId: ctx.castId,
    effectId,
    targetIds: ctx.targets.map((target) => target.id),
    areaPlaced: input.areaPlaced === true,
    widthFeet: ctx.action.area?.widthFeet ?? spell?.area?.widthFeet ?? null,
    ...(ringed ? { ringFeet: RING_FEET } : {}),
    ...(input.areaAt && ctx.action.area
      ? { centredAt: { x: input.areaAt.x, y: input.areaAt.y, sizeFeet: ctx.action.area.sizeFeet } }
      : {})
  });
  for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
}

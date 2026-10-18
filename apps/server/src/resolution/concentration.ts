import type { SpellReference } from "@vtt/content-srd-5.2.1";
import { spellDurationAt, spellSpanOf } from "@vtt/content-srd-5.2.1/spell-effect";
import type { EffectInstance, SpellZone } from "@vtt/domain";
import { MAX_EFFECT_MINUTES, type SaveFailureDuration } from "@vtt/schemas";
import { addEffect, CONCENTRATING_TAG, makeEffect, type EffectNarration } from "../effects.js";
import { laterRowOf, laterSpellActionId } from "../item-actions.js";
import { castThisTurnKey } from "../lasting-spells.js";
import { endZone } from "../spell-zone-state.js";
import { zoneRowOf } from "../spell-zones.js";
import { tableLineOf, type ResolveContext } from "./context.js";

type SpellLifetime = Pick<SpellReference, "duration" | "concentration" | "upcastDurations">;

/** A spell's duration at the level it is cast, as the text and its higher-level rows print it (Dominate Beast from a
 *  level 6 slot lasts up to 1 hour): up to ten minutes in rounds, longer in minutes of game time, and one that lasts
 *  until dispelled or is instantaneous with no end of its own. */
export function spellSaveDuration(spell: SpellLifetime, level: number): SaveFailureDuration | undefined {
  const span = spellSpanOf(spellDurationAt(spell, level).duration);
  if (!span) return undefined;
  return "rounds" in span
    ? { type: "rounds", rounds: Math.min(100, span.rounds) }
    : { type: "minutes", minutes: Math.min(MAX_EFFECT_MINUTES, span.minutes) };
}

/** The same as an effect's duration. */
export function spellEffectDuration(spell: SpellLifetime, level: number): EffectInstance["duration"] {
  const duration = spellSaveDuration(spell, level);
  if (!duration) return { type: "manual" };
  return duration.type === "rounds"
    ? { type: "rounds", remaining: duration.rounds }
    : { type: "minutes", remaining: (duration as { minutes: number }).minutes };
}

/** Whether a cast at this level needs Concentration: Major Image from a level 4 slot doesn't. */
export const castsWithConcentration = (spell: SpellLifetime, level: number) =>
  spellDurationAt(spell, level).concentration;

/** Conditions a failure leaves bare, which no effect holds (Prone ends by standing up). */
const BARE_CONDITIONS: ReadonlySet<string> = new Set(["prone", "exhaustion"]);

/** A spell that is nothing but what it leaves on creatures: a grant, a failure's effect or its held conditions, with
 *  no later actions, area or summons of its own (`persistsWithoutTargets`). Its Concentration ends once no creature
 *  keeps any of it (`endIdleConcentration`). */
function onlyOnCreatures(spell: SpellReference): boolean {
  const effect = spell.effect;
  if (!effect || effect.persistsWithoutTargets || (effect.laterActions ?? []).length > 0) return false;
  return (
    effect.grant !== undefined ||
    effect.failureEffect !== undefined ||
    (spell.save?.failureConditions ?? []).some((conditionId) => !BARE_CONDITIONS.has(conditionId))
  );
}

/** The spell an action casts, when the catalog knows it. */
export function spellOf(ctx: Pick<ResolveContext, "action" | "deps">): SpellReference | undefined {
  return ctx.action.spellId ? ctx.deps.catalog?.spellRecord?.(ctx.action.spellId) : undefined;
}

/** The level this resolve casts its spell at: the slot it spends, else the spell's own. */
const castLevelOf = (ctx: ResolveContext, spell: SpellReference) => ctx.plan.castLevel ?? spell.level;

/** Whether this action is one of the things the spell lets its caster do later (Spirit Guardians' save, moving Hex).
 *  Such an action is no new cast. */
const isLaterAction = (ctx: ResolveContext, spell: SpellReference) => laterRowOf(spell, ctx.action.id) !== undefined;

/**
 * SRD Concentration: casting a Concentration spell starts it, and starting it ends any other the caster holds. The
 * caster carries "Concentrating on X" (which a damage check, Incapacitation or 0 HP ends through the existing
 * rules), and every condition a failed save of this cast imposes is linked to it by `castId`, so they end together.
 */
export function startConcentration(ctx: ResolveContext): void {
  const spell = spellOf(ctx);
  if (!spell || !castsWithConcentration(spell, castLevelOf(ctx, spell))) return;
  // What the spell lets its caster do once it is up (Spirit Guardians' save, moving Hex) is no new cast.
  if (isLaterAction(ctx, spell)) return;
  ctx.castId = ctx.input.commandId;
  beginConcentration(ctx, spell, ctx.castId, castLevelOf(ctx, spell));
}

/** The caster's "Concentrating on X" for one cast, whether the spell is the resolved action or rides its hit (a
 *  smite); what the cast puts on others carries the same `castId`. It names the spell and its level, so what the
 *  spell lets its caster do on later turns is offered at that level while it lasts. */
export function beginConcentration(ctx: ResolveContext, spell: SpellReference, castId: string, level: number): void {
  const { state, attacker, deps } = ctx;
  const ended: EffectNarration[] = [];
  addEffect(
    state,
    attacker.id,
    makeEffect({
      id: `${castId}:concentration`,
      name: `Concentrating on ${spell.name}`,
      tags: [CONCENTRATING_TAG],
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      startedRound: state.combat.round,
      duration: spellEffectDuration(spell, level),
      endsWhenSourceDefeated: true,
      concentration: true,
      castId,
      spell: { id: spell.id, level },
      ...(onlyOnCreatures(spell) ? { endsWhenUnaffected: true as const } : {})
    }),
    ended,
    deps
  );
  ctx.effectsApplied.push({
    targetId: attacker.id,
    targetName: attacker.name,
    name: `Concentrating on ${spell.name}`,
    conditionIds: []
  });
  // The previous Concentration ending is the table's news.
  for (const event of ended) ctx.tableNarration.push(tableLineOf(ctx, event));
}

/** Marks the cast on its caster's own turn when the spell has something taken only on later turns. */
export function markCastTurn(ctx: ResolveContext): void {
  const spell = spellOf(ctx);
  const { state, attacker } = ctx;
  if (!spell || isLaterAction(ctx, spell) || state.combat.turnActorId !== attacker.id) return;
  if (!(spell.effect?.laterActions ?? []).some((row) => row.laterTurnsOnly)) return;
  const key = castThisTurnKey(attacker.id, spell.id);
  state.combat = {
    ...state.combat,
    turn: { ...state.combat.turn, turnUses: { ...state.combat.turn.turnUses, [key]: 1 } }
  };
}

/** A spell with no Concentration that its caster acts with on later turns (Produce Flame's hurl, Guardian of Faith's
 *  area): the cast leaves an effect on the caster naming it and its level, for its duration. Casting it again
 *  replaces the last ("The spell ends if you cast it again"). */
export function markSpellUp(ctx: ResolveContext): void {
  const spell = spellOf(ctx);
  if (!spell || !(spell.effect?.laterActions ?? []).length || isLaterAction(ctx, spell)) return;
  if (castsWithConcentration(spell, castLevelOf(ctx, spell))) return;
  const { state, attacker, input } = ctx;
  addEffect(
    state,
    attacker.id,
    makeEffect({
      id: `${input.commandId}:spell`,
      name: spell.name,
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      sourceActionId: ctx.action.id,
      startedRound: state.combat.round,
      duration: spellEffectDuration(spell, castLevelOf(ctx, spell)),
      spell: { id: spell.id, level: castLevelOf(ctx, spell) }
    })
  );
  ctx.effectsApplied.push({ targetId: attacker.id, targetName: attacker.name, name: spell.name, conditionIds: [] });
}

/** The cast's save DC, for the zone's later saves: the cast's own, the caster's later action's, or the caster's spell
 *  save DC. */
function zoneDc(ctx: ResolveContext, spell: SpellReference, rowName: string): number {
  const later = ctx.siblings.find((action) => action.id === laterSpellActionId(spell.id, rowName));
  return ctx.action.save?.dc ?? later?.save?.dc ?? ctx.deps.definition?.spellcasting?.saveDc ?? 10;
}

/**
 * A cast that leaves an area acting on creatures later (Spirit Guardians, Moonbeam, Web): its zone, on the area the
 * GM placed with the cast, or around the caster for an Emanation. Cast without a template (a player's cast), the area
 * waits for the GM to place it. The creatures the cast itself caught have made this turn's save already.
 */
export function openSpellZone(ctx: ResolveContext): void {
  const spell = spellOf(ctx);
  const row = spell ? zoneRowOf(spell) : undefined;
  if (!spell || !row?.zone || isLaterAction(ctx, spell) || !ctx.state.combat.active) return;
  const { state, attacker, input, targets } = ctx;
  const aroundCaster = row.zone.around === "caster";
  const duration = spellEffectDuration(spell, castLevelOf(ctx, spell));
  const caught = ctx.action.save !== undefined || ctx.action.damage.length > 0;
  const zone: SpellZone = {
    id: input.commandId,
    spellId: spell.id,
    name: spell.name,
    laterActionId: laterSpellActionId(spell.id, row.name),
    casterId: attacker.id,
    castId: ctx.castId,
    rounds: ctx.castId === null && duration.type === "rounds" ? Math.max(1, duration.remaining) : null,
    startedRound: state.combat.round,
    level: castLevelOf(ctx, spell),
    dc: zoneDc(ctx, spell, row.name),
    annotationId: !aroundCaster && input.areaPlaced === true ? input.commandId : null,
    area: aroundCaster ? null : (spell.area ?? null),
    damageDealt: 0,
    entered: [],
    affected: caught ? targets.map((target) => target.id) : []
  };
  // The same caster's earlier cast of this spell is gone ("The spell ends if you cast it again"; a new Concentration
  // ended the old one anyway).
  for (const existing of state.combat.spellZones)
    if (existing.spellId === spell.id && existing.casterId === attacker.id) endZone(state, existing.id);
  state.combat = { ...state.combat, spellZones: [...state.combat.spellZones, zone].slice(-20) };
  if (!aroundCaster && zone.annotationId === null)
    ctx.warnings.push(`Place ${spell.name}'s area on the map (Spell areas), and the server will run it.`);
}

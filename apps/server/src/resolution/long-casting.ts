import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import { addEffect, makeEffect, type EffectNarration } from "../effects.js";
import { CommandRejectedError } from "../game-store.js";
import { laterRowOf, ritualSpellActionId } from "../item-actions.js";
import { tableLineOf, type DefinitionAction, type ResolveContext, type ResolveInput } from "./context.js";
import { commitEconomy } from "./economy.js";

/**
 * SRD 5.2.1 "Longer Casting Times": "When you cast a spell with a casting time longer than a single action or
 * Reaction, you must spend your action on each turn casting the spell, and you must maintain your Concentration while
 * you do so. If your Concentration is broken, the spell fails, but you don't expend a spell slot." And a Ritual "takes
 * 10 minutes longer to cast than normal".
 *
 * In a fight the first cast starts "Casting X" on the caster, a Concentration that holds the targets and the slot
 * level picked. Each later turn the caster casts it again, which spends that turn's action; the last one resolves the
 * spell, and only then are its slot and its consumed materials spent. A turn that ends without that action lets the
 * casting lapse (`lapseLongCasts`). Outside a fight the cast completes at once and the game clock moves by its whole
 * hours (`commands/actions.ts`).
 */

/** The tag of the effect a casting in progress leaves on its caster. */
export const LONG_CASTING_TAG = "long-casting";

/** Rounds in a minute (SRD: a round is about 6 seconds). */
const ROUNDS_PER_MINUTE = 10;

/** The minutes a cast takes: the spell's casting time when it is a minute or more, and 10 more as a Ritual. An action,
 *  Bonus Action or Reaction casting time counts 0 (Plant Growth's "Action or 8 hours" is cast with its Action). */
export function castingMinutesOf(spell: SpellReference, actionId: string): number {
  const ritual = actionId === ritualSpellActionId(spell.id) ? 10 : 0;
  if (/^(?:action|bonus action|reaction)\b/i.test(spell.castingTime.trim())) return ritual;
  const match = /(\d+)\s*(minute|hour)s?\b/i.exec(spell.castingTime);
  if (!match) return ritual;
  return Number(match[1]) * (match[2]!.toLowerCase() === "hour" ? 60 : 1) + ritual;
}

type Casting = NonNullable<GameState["actors"][number]["effects"][number]["longCast"]>;

/** Where a cast of a long spell stands on this tap: the first ("start"), one of the turns between ("continue"), or
 *  the last, which resolves it ("finish"); with the input the resolver reads (the targets and slot of the start). */
export type LongCastStep = Readonly<{
  phase: "start" | "continue" | "finish";
  input: ResolveInput;
  spell: SpellReference;
  rounds: number;
}>;

/** The step a tap of this action takes, or null for a cast that resolves at once: outside a fight, a readied cast, a
 *  replay of one already paid for, and anything shorter than a minute. An item's cast takes its turns too, and its
 *  charges or its scroll are spent on the last ("If the casting is interrupted, the scroll isn't lost"). */
export function longCastStepOf(
  state: GameState,
  action: DefinitionAction,
  input: ResolveInput,
  spell: SpellReference | undefined
): LongCastStep | null {
  if (!state.combat.active || !spell || action.spellId === undefined) return null;
  if (input.economyPaid === true || input.ready === true || input.commit === false) return null;
  if (laterRowOf(spell, action.id) !== undefined) return null;
  const minutes = castingMinutesOf(spell, action.id);
  if (minutes === 0) return null;
  const rounds = minutes * ROUNDS_PER_MINUTE;
  const caster = state.actors.find((actor) => actor.id === input.actorId);
  const casting = caster?.effects.find((effect) => effect.longCast?.actionId === action.id)?.longCast;
  // One action a turn keeps it going; a casting a whole round went without has lapsed and starts over.
  if (casting && casting.lastRound >= state.combat.round)
    throw new CommandRejectedError(`${caster!.name} has already spent this turn's action casting ${spell.name}.`);
  if (!casting || casting.lastRound < state.combat.round - 1) return { phase: "start", input, spell, rounds };
  // The targets and slot are the ones picked when the casting began.
  const carried: ResolveInput = {
    ...input,
    targetIds: [...casting.targetIds],
    ...(casting.slotLevel !== null ? { slotLevel: casting.slotLevel } : {}),
    ...(casting.areaPlaced ? { areaPlaced: true } : {}),
    ...(casting.optionId !== undefined ? { optionId: casting.optionId } : {}),
    ...(casting.shaping ? { shaping: casting.shaping } : {})
  };
  return { phase: casting.turnsLeft <= 1 ? "finish" : "continue", input: carried, spell, rounds };
}

/** The first turn or one between: the action is spent, nothing else is. Returns the line the table reads. */
export function stepLongCast(ctx: ResolveContext, step: LongCastStep): void {
  const { state, attacker, input, deps } = ctx;
  // The slot, a limited use, consumed materials and Metamagic's points wait for the last turn; the action is this
  // turn's.
  commitEconomy({
    ...ctx,
    plan: { ...ctx.plan, spendSpellSlot: null, spendUse: null, componentSpends: [], shaping: null }
  });
  const name = step.spell.name;
  if (step.phase === "start") {
    const casting: Casting = {
      actionId: ctx.action.id,
      targetIds: ctx.targets.map((target) => target.id),
      slotLevel: ctx.plan.spendSpellSlot?.level ?? null,
      areaPlaced: input.areaPlaced === true,
      ...(input.optionId != null ? { optionId: input.optionId } : {}),
      ...(input.shaping && input.shaping.length > 0 ? { shaping: input.shaping.map((entry) => ({ ...entry })) } : {}),
      turnsLeft: step.rounds - 1,
      lastRound: state.combat.round
    };
    const ended: EffectNarration[] = [];
    // A Concentration of its own, so starting it ends another the caster holds and a broken one ends the casting.
    addEffect(
      state,
      attacker.id,
      makeEffect({
        id: `${input.commandId}:casting`,
        name: `Casting ${name}`,
        tags: [LONG_CASTING_TAG],
        sourceActorId: attacker.id,
        sourceName: attacker.name,
        startedRound: state.combat.round,
        duration: { type: "manual" },
        concentration: true,
        castId: `${input.commandId}:casting`,
        longCast: casting
      }),
      ended,
      deps
    );
    for (const event of ended) ctx.tableNarration.push(tableLineOf(ctx, event));
    ctx.tableNarration.push(
      tableLineOf(ctx, {
        kind: "effect",
        actorId: attacker.id,
        text: `${attacker.name} begins casting ${name}${ctx.action.id === ritualSpellActionId(step.spell.id) ? " as a Ritual" : ""}. It takes the action on each of ${attacker.name}'s next ${casting.turnsLeft} turns, with Concentration held.`
      })
    );
    return;
  }
  const effect = attacker.effects.find((candidate) => candidate.longCast?.actionId === ctx.action.id)!;
  const turnsLeft = effect.longCast!.turnsLeft - 1;
  effect.longCast = { ...effect.longCast!, turnsLeft, lastRound: state.combat.round };
  ctx.tableNarration.push(
    tableLineOf(ctx, {
      kind: "effect",
      actorId: attacker.id,
      text: `${attacker.name} keeps casting ${name}: ${turnsLeft} more ${turnsLeft === 1 ? "turn" : "turns"}.`
    })
  );
}

/** The last turn: the casting's Concentration gives way to the spell's own, which resolves now. */
export function finishLongCast(ctx: ResolveContext): void {
  ctx.attacker.effects = ctx.attacker.effects.filter((effect) => effect.longCast?.actionId !== ctx.action.id);
}

/**
 * A caster whose turn ends without the action that keeps a casting going loses it (SRD: "you must spend your action on
 * each turn casting the spell"). Nothing was spent, so nothing comes back.
 */
export function lapseLongCasts(state: GameState, actorId: string, events: EffectNarration[]): void {
  const caster = state.actors.find((actor) => actor.id === actorId);
  if (!caster) return;
  const lapsed = caster.effects.filter(
    (effect) => effect.longCast !== undefined && effect.longCast.lastRound < state.combat.round
  );
  if (lapsed.length === 0) return;
  caster.effects = caster.effects.filter((effect) => !lapsed.includes(effect));
  for (const effect of lapsed)
    events.push({
      kind: "effect",
      actorId,
      text: `${caster.name} took no action to keep casting ${effect.name.replace(/^Casting /, "")}, so the spell fails. No spell slot is spent.`
    });
}

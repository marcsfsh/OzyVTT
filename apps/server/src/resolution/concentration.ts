import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { EffectInstance } from "@vtt/domain";
import { addEffect, CONCENTRATING_TAG, makeEffect, type EffectNarration } from "../effects.js";
import { laterSpellActionId } from "../item-actions.js";
import type { ResolveContext } from "./context.js";

/** A spell's printed duration as an effect duration: up to ten minutes counts rounds; longer ones last until
 *  ended (the engine keeps no clock outside a fight). */
export function spellEffectDuration(duration: string): EffectInstance["duration"] {
  const match = duration.match(/^(?:up to )?(\d+) (round|minute|hour|day)s?$/i);
  if (!match) return { type: "manual" };
  const count = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const rounds = unit === "round" ? count : unit === "minute" ? count * 10 : Infinity;
  return rounds <= 100 ? { type: "rounds", remaining: rounds } : { type: "manual" };
}

/** The spell an action casts, when the catalog knows it. */
export function spellOf(ctx: Pick<ResolveContext, "action" | "deps">): SpellReference | undefined {
  return ctx.action.spellId ? ctx.deps.catalog?.spellRecord?.(ctx.action.spellId) : undefined;
}

/**
 * SRD Concentration: casting a Concentration spell starts it, and starting it ends any other the caster holds. The
 * caster carries "Concentrating on X" (which a damage check, Incapacitation or 0 HP ends through the existing
 * rules), and every condition a failed save of this cast imposes is linked to it by `castId`, so they end together.
 */
export function startConcentration(ctx: ResolveContext): void {
  const spell = spellOf(ctx);
  if (!spell?.concentration) return;
  // What the spell lets its caster do once it is up (Spirit Guardians' save, moving Hex) is no new cast.
  if ((spell.effect?.laterActions ?? []).some((row) => laterSpellActionId(spell.id, row.name) === ctx.action.id))
    return;
  ctx.castId = ctx.input.commandId;
  beginConcentration(ctx, spell, ctx.castId);
}

/** The caster's "Concentrating on X" for one cast, whether the spell is the resolved action or rides its hit (a
 *  smite); what the cast puts on others carries the same `castId`. */
export function beginConcentration(ctx: ResolveContext, spell: SpellReference, castId: string): void {
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
      duration: spellEffectDuration(spell.duration),
      endsWhenSourceDefeated: true,
      concentration: true,
      castId
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
  for (const event of ended) ctx.tableNarration.push({ kind: "effect", text: event.text, actorIds: [event.actorId] });
}

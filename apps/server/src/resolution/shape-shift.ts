import type { EffectInstance, PendingSave } from "@vtt/domain";
import type { ActorDefinition, Form } from "@vtt/schemas";
import { holdsFeature } from "../class-features.js";
import { CANT_SPEAK_TAG, makeEffect } from "../effects.js";
import { effectNameOf } from "../effect-names.js";
import { CommandRejectedError } from "../game-store.js";
import { endForm, takeForm } from "../transform/assume.js";
import { formEffectOf, trueDefinitionIdOf } from "../transform/forms.js";
import { laterRowOf } from "../item-actions.js";
import { classLevelOf, formChoice, formRecord } from "../transform/options.js";
import { NO_SHAPE_SHIFT_TAG } from "../transform/rules.js";
import { spellEffectDuration, spellOf } from "./concentration.js";
import { tableLineOf, type LiveActor, type ResolveContext } from "./context.js";

/** The definition a creature has in its true form, whatever form it is in now. */
function trueDefinitionOf(ctx: ResolveContext, actor: LiveActor): ActorDefinition | undefined {
  const id = trueDefinitionIdOf(actor);
  return id ? ctx.deps.resolveDefinition?.(id) : undefined;
}

/** The form each creature the action shape-shifts is to take: one per target where the action names a form per
 *  target (Animal Shapes), else the one form picked. */
function choiceFor(ctx: ResolveContext, target: LiveActor): string | undefined {
  return ctx.input.targetForms?.find((entry) => entry.targetId === target.id)?.form ?? ctx.input.form;
}

/** Who a shape-shift reaches: each target (Animal Shapes, or each one a save tests: Polymorph), or its user. */
function recipientsOf(ctx: ResolveContext): readonly LiveActor[] {
  const shift = ctx.action.shapeShift!;
  return shift.onTargets || ctx.action.save ? ctx.targets : [ctx.attacker];
}

/** The choice checked against what the action allows for one creature (refused with a sentence), or null for a
 *  printed form's user returning to its true form. */
function checkedChoice(ctx: ResolveContext, target: LiveActor) {
  const shift = ctx.action.shapeShift!;
  if (!ctx.deps.resolveDefinition) throw new CommandRejectedError("Shape-shifting needs the bestiary.");
  return formChoice(shift, choiceFor(ctx, target), {
    user: ctx.attacker,
    userDefinition: trueDefinitionOf(ctx, ctx.attacker),
    target,
    targetDefinition: trueDefinitionOf(ctx, target),
    resolveDefinition: ctx.deps.resolveDefinition,
    catalog: ctx.deps.catalog,
    actionName: ctx.action.name
  });
}

/**
 * Checks every form the action would give before anything is spent: a known form the user knows (Wild Shape), a Beast
 * within the target's Challenge Rating (Polymorph), one of the stat block's printed forms. A user with no known forms is
 * told to pick them first.
 */
export function checkShapeShift(ctx: ResolveContext): void {
  const shift = ctx.action.shapeShift;
  if (!shift) return;
  // Moonbeam: "can't shape-shift until it leaves the Cylinder".
  const held = recipientsOf(ctx).find((target) =>
    target.effects.some((effect) => effect.tags.includes(NO_SHAPE_SHIFT_TAG))
  );
  if (held && !ctx.action.save)
    throw new CommandRejectedError(`${held.name} can't shape-shift while held in its true form.`);
  if (shift.from === "known" && (ctx.attacker.knownForms?.ids ?? []).length === 0)
    throw new CommandRejectedError(
      `${ctx.attacker.name} knows no forms yet. Choose the known forms on the sheet first.`
    );
  for (const target of recipientsOf(ctx)) checkedChoice(ctx, target);
}

/** The Temporary Hit Points a form gives: its stat block's Hit Points, for each form (Polymorph) or the first form a
 *  cast gives (Animal Shapes, Shapechange), so a later new form gives none. */
function formHitPoints(ctx: ResolveContext, statBlockId: string | undefined): number | undefined {
  const temp = ctx.action.shapeShift?.temporaryHitPoints;
  if (!temp || statBlockId === undefined) return undefined;
  const spell = spellOf(ctx);
  if (temp === "first-form" && spell && laterRowOf(spell, ctx.action.id)) return undefined;
  return ctx.deps.resolveDefinition?.(statBlockId)?.hitPoints.maximum;
}

/** How long the form lasts: half the user's level in the class in hours (Wild Shape), the spell's duration at its level,
 *  or until it ends. */
function formDuration(ctx: ResolveContext): EffectInstance["duration"] {
  const shift = ctx.action.shapeShift!;
  if (shift.hoursPerTwoLevelsOf) {
    const level = classLevelOf(trueDefinitionOf(ctx, ctx.attacker), shift.hoursPerTwoLevelsOf);
    return { type: "minutes", remaining: Math.max(60, Math.floor(level / 2) * 60) };
  }
  const spell = spellOf(ctx);
  return spell ? spellEffectDuration(spell, ctx.plan.castLevel ?? spell.level) : { type: "manual" };
}

/** The form record for one creature, from the choice and the action's terms. */
function formFor(ctx: ResolveContext, target: LiveActor): Form | null {
  const chosen = checkedChoice(ctx, target);
  if (!chosen) return null;
  const shift = ctx.action.shapeShift!;
  // SRD Beast Spells (Druid 18): spells in a Beast form, but not one with a costly or consumed Material component.
  const beastSpells =
    shift.from === "known" && holdsFeature(trueDefinitionOf(ctx, ctx.attacker), "beast-spells", "Beast Spells");
  const temporaryHitPoints = formHitPoints(ctx, chosen.statBlockId);
  return formRecord(shift, chosen, {
    ...(ctx.input.gear ? { gear: ctx.input.gear } : {}),
    ...(temporaryHitPoints !== undefined ? { temporaryHitPoints } : {}),
    ...(beastSpells ? { beastSpells: true } : {})
  });
}

/** The name the form's effect goes by: the action's and the form's ("Wild Shape (Wolf)"). */
const formEffectName = (ctx: ResolveContext, form: Form) =>
  `${effectNameOf(ctx.action.name)} (${form.name})`.slice(0, 120);

/**
 * What the action shape-shifts, as it resolves: its user leaving its form (`endsForm`), or its user or each target it
 * names taking the form picked for it. A form tested by a save (Polymorph) rides the failed save instead
 * (`failureFormOf`). A printed form's user picking its true form returns to it.
 */
export function applyShapeShift(ctx: ResolveContext): void {
  const { state, action, attacker, input } = ctx;
  if (action.endsForm) {
    for (const event of endForm(state, attacker)) ctx.tableNarration.push(tableLineOf(ctx, event));
    return;
  }
  const shift = action.shapeShift;
  if (!shift || action.save) return;
  for (const recipient of recipientsOf(ctx)) {
    const form = formFor(ctx, recipient);
    if (!form) {
      for (const event of endForm(state, recipient)) ctx.tableNarration.push(tableLineOf(ctx, event));
      continue;
    }
    const spell = spellOf(ctx);
    const castLevel = spell ? (ctx.plan.castLevel ?? spell.level) : null;
    // A new form while the spell lasts (Shapechange's Magic action) keeps the cast's lifetime and Concentration.
    const lasting = spell && laterRowOf(spell, action.id) ? formEffectOf(recipient) : undefined;
    const kept = lasting?.spell?.id === spell?.id ? lasting : undefined;
    const effect = makeEffect({
      id: `${input.commandId}:form:${recipient.id}`,
      name: formEffectName(ctx, form),
      tags: form.noSpeech ? [CANT_SPEAK_TAG] : [],
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      sourceActionId: kept?.sourceActionId ?? action.id,
      startedRound: kept?.startedRound ?? state.combat.round,
      duration: kept?.duration ?? formDuration(ctx),
      form,
      ...(kept?.castId !== undefined
        ? { castId: kept.castId, concentration: kept.concentration }
        : ctx.castId !== null
          ? { castId: ctx.castId, concentration: true }
          : {}),
      ...(kept?.spell
        ? { spell: { ...kept.spell }, magical: true as const }
        : spell && castLevel !== null
          ? { spell: { id: spell.id, level: castLevel }, magical: true as const }
          : {})
    });
    const events = takeForm(state, recipient.id, effect, {
      resolveDefinition: ctx.deps.resolveDefinition!,
      ...(ctx.deps.catalog ? { catalog: ctx.deps.catalog } : {})
    });
    for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
    if (recipient.id !== attacker.id)
      ctx.effectsApplied.push({
        targetId: recipient.id,
        targetName: recipient.name,
        name: effect.name,
        conditionIds: []
      });
    else ctx.effectGranted = { name: effect.name, tags: effect.tags };
  }
}

/** The form a failed save gives (Polymorph's Beast), with the Temporary Hit Points the stat block's Hit Points give and
 *  the tag that keeps it from speaking. Undefined for an action that shape-shifts nothing on a save. */
export function failureFormOf(
  ctx: ResolveContext
): Pick<NonNullable<PendingSave["onFailEffect"]>, "form" | "tags" | "name"> | undefined {
  const shift = ctx.action.shapeShift;
  if (!shift || !ctx.action.save || ctx.targets.length === 0) return undefined;
  const form = formFor(ctx, ctx.targets[0]!);
  if (!form) return undefined;
  return { form, tags: form.noSpeech ? [CANT_SPEAK_TAG] : [], name: formEffectName(ctx, form) };
}

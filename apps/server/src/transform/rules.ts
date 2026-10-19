import { isDead, type Actor, type GameState } from "@vtt/domain";
import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { addEffect, endEffect, makeEffect, type EffectNarration } from "../effects.js";
import { isIncapacitated } from "../condition-rules.js";
import { currentFormId, formEffectOf } from "./forms.js";

/** What a form forbids, rule by rule (rule ids from `rules-families.ts`). */
type FormViolation = Readonly<{ rule: "form.no-spells" | "form.no-actions" | "form.wrong-form"; message: string }>;

/** A spell whose Material component has a cost or is consumed, which Beast Spells leaves out. */
const costlyMaterial = (spell: SpellReference | undefined): boolean =>
  spell !== undefined && (spell.components.materialConsumed || (spell.components.costly ?? []).length > 0);

/** The name a printed form goes by, from the stat block's Shape-Shift; its id otherwise. */
function formName(definition: ActorDefinition | undefined, id: string): string {
  if (id === "true") return "true";
  for (const action of definition?.actions ?? []) {
    const printed = action.shapeShift?.printed?.find((entry) => entry.id === id);
    if (printed) return printed.name.toLowerCase().replace(/ form$/, "");
  }
  return id;
}

/** "A", "A or B", "A, B or C". */
const either = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;

/**
 * What a creature's form keeps it from doing (SRD 5.2.1, each form's own text): casting spells (Wild Shape, Polymorph;
 * Beast Spells lets a Druid 18 cast all but a spell with a costly or consumed Material component), taking actions (a
 * vampire's mist), and an action printed for some forms only ("Bite (Wolf or Hybrid Form Only)").
 */
export function formViolations(
  actor: Actor,
  action: ActorAction,
  definition: ActorDefinition | undefined,
  spell: SpellReference | undefined
): FormViolation[] {
  const violations: FormViolation[] = [];
  const form = formEffectOf(actor)?.form;
  if (form?.noSpells && action.spellId !== undefined) {
    if (!form.beastSpells)
      violations.push({ rule: "form.no-spells", message: `${actor.name} can't cast spells in ${form.name} form.` });
    else if (costlyMaterial(spell))
      violations.push({
        rule: "form.no-spells",
        message: `${actor.name} can't cast ${spell?.name ?? action.name} in ${form.name} form: Beast Spells leaves out a spell whose Material component has a cost or is consumed.`
      });
  }
  if (form?.noActions && action.activation === "action")
    violations.push({ rule: "form.no-actions", message: `${actor.name} can't take actions in ${form.name} form.` });
  if (action.formOnly && !action.formOnly.includes(currentFormId(actor))) {
    const names = action.formOnly.map((id) => formName(definition, id));
    violations.push({
      rule: "form.wrong-form",
      message: `${action.name} works only in the ${either(names)} form.`
    });
  }
  return violations;
}

/**
 * What ends a form as damage lands: "The spell ends early on the target if it has no Temporary Hit Points left"
 * (Polymorph), the Incapacitated condition (Wild Shape), and death ("You revert to your true form if you die").
 */
export function formsAfterDamage(state: GameState, actor: Actor): EffectNarration[] {
  const held = formEffectOf(actor);
  const form = held?.form;
  if (!held || !form) return [];
  const ends =
    isDead(actor) ||
    (form.endsWithoutTemporaryHitPoints === true && actor.hp.temporary <= 0) ||
    (form.endsOnIncapacitated === true && (isIncapacitated(actor) || actor.hp.current <= 0));
  if (!ends) return [];
  const reason = isDead(actor)
    ? `${actor.name} dies and returns to its true form.`
    : form.endsWithoutTemporaryHitPoints && actor.hp.temporary <= 0
      ? `${actor.name} has no Temporary Hit Points left, so ${held.name} ends.`
      : `${actor.name} is Incapacitated, so ${held.name} ends.`;
  return [{ kind: "effect", text: reason, actorId: actor.id }, ...endEffect(state, actor.id, held.id)];
}

/** The bearer can't shape-shift while this lasts (Moonbeam: "can't shape-shift until it leaves the Cylinder"). */
export const NO_SHAPE_SHIFT_TAG = "no-shape-shift";

/**
 * A failed save that returns a shape-shifted creature to its true form (SRD Moonbeam: "it reverts to its true form and
 * can't shape-shift until it leaves the Cylinder"). The form ends, and an effect that ends with the spell keeps it from
 * shape-shifting again; leaving the Cylinder before then is the GM's to mark, by ending that effect.
 */
export function revertOnFailure(
  state: GameState,
  target: Actor,
  cause: Readonly<{ sourceActorId: string | null; sourceName: string; spellName: string; castId?: string; id: string }>
): EffectNarration[] {
  const held = formEffectOf(target);
  if (!held) return [];
  const events: EffectNarration[] = [
    { kind: "effect", text: `${target.name} reverts to its true form (${cause.spellName}).`, actorId: target.id },
    ...endEffect(state, target.id, held.id)
  ];
  addEffect(
    state,
    target.id,
    makeEffect({
      id: cause.id,
      name: `Held in ${cause.spellName}`.slice(0, 120),
      tags: [NO_SHAPE_SHIFT_TAG],
      sourceActorId: cause.sourceActorId,
      sourceName: cause.sourceName,
      startedRound: state.combat.round,
      duration: { type: "manual" },
      ...(cause.castId !== undefined ? { castId: cause.castId } : {})
    }),
    events
  );
  return events;
}

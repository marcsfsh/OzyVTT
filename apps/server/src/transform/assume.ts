import type { Actor, EffectInstance, GameState } from "@vtt/domain";
import type { ActorDefinition, Form } from "@vtt/schemas";
import { storedArmorClass } from "../actor-roster.js";
import { addEffect, endEffect, type ConditionImmunitySource, type EffectNarration } from "../effects.js";
import type { EquipmentCatalog } from "../equipment-derivation.js";
import { CommandRejectedError } from "../game-store.js";
import { composeOwnForm, composeStatBlockForm } from "./compose.js";
import { formDefinitionId, formEffectOf, refreshSize, type CreatureSize } from "./forms.js";

/** What taking a form reads: stat blocks (the bearer's own and the form's) and the catalog its Armor Class needs. */
export type FormDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
}>;

/** The size the bearer has before any effect changed it: kept on an effect already changing it, else its own. */
export function ownSizeOf(actor: Actor): NonNullable<EffectInstance["ownSize"]> {
  const kept = actor.effects.find((effect) => effect.ownSize !== undefined)?.ownSize;
  if (kept) return kept;
  return {
    ...(actor.size !== undefined ? { size: actor.size } : {}),
    ...(actor.sizeCells !== undefined ? { sizeCells: actor.sizeCells } : {})
  };
}

/** Ends the form a creature has taken, which returns it to its true form; nothing when it has none. */
export function endForm(state: GameState, actor: Actor): EffectNarration[] {
  const held = formEffectOf(actor);
  return held ? endEffect(state, actor.id, held.id) : [];
}

/**
 * The bearer takes the form `effect` holds (SRD Rules Glossary, Shape-Shifting): a form it has already taken ends
 * first, the effect lands, and the bearer's statistics become the stat block's with what it keeps of its own, or its own
 * with the printed form's size and speeds. Its definition is stored as `form-<actorId>` and every rule reads that, its
 * Speed and (for a stat block) its Armor Class are the form's, it gains the Temporary Hit Points the form gives when
 * they beat what it has, and its size and token follow. Conditions and other effects on it carry over.
 */
export function takeForm(
  state: GameState,
  actorId: string,
  effect: EffectInstance,
  deps: FormDeps,
  immunities?: ConditionImmunitySource
): EffectNarration[] {
  const form = effect.form;
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (!form) {
    addEffect(state, actorId, effect, undefined, immunities);
    return [];
  }
  const events: EffectNarration[] = [];
  // One form at a time: "until you use Wild Shape again". A new form from the same spell (Shapechange's Magic action)
  // keeps the Temporary Hit Points its first form gave, which vanish only when the spell ends.
  const previous = formEffectOf(actor);
  const sameSpell = previous?.spell !== undefined && previous.spell.id === effect.spell?.id;
  const carried = sameSpell ? { temporary: actor.hp.temporary, given: previous?.form?.temporaryHitPoints } : null;
  events.push(...endForm(state, actor));
  if (carried && carried.temporary > actor.hp.temporary) actor.hp = { ...actor.hp, temporary: carried.temporary };
  const trueId = actor.definitionId;
  const own = trueId ? deps.resolveDefinition(trueId) : undefined;
  if (!trueId || !own) throw new CommandRejectedError(`${actor.name} has no stat block for a form to change.`);
  const statBlock = form.statBlockId !== undefined ? deps.resolveDefinition(form.statBlockId) : undefined;
  if (form.statBlockId !== undefined && !statBlock)
    throw new CommandRejectedError("That form's stat block is no longer in the bestiary.");
  const composed = statBlock ? composeStatBlockForm(own, statBlock, form) : composeOwnForm(own, form);
  const size = statBlock ? (statBlock.size as CreatureSize) : (form.size as CreatureSize | undefined);
  const taken: Form = {
    ...form,
    ...(carried?.given !== undefined && form.temporaryHitPoints === undefined
      ? { temporaryHitPoints: carried.given }
      : {}),
    ...(size !== undefined ? { size } : {}),
    trueDefinitionId: trueId,
    trueStats: {
      ...(actor.speedFeet !== undefined ? { speedFeet: actor.speedFeet } : {}),
      ...(actor.armorClass !== undefined && statBlock ? { armorClass: actor.armorClass } : {})
    }
  };
  const placed = addEffect(
    state,
    actorId,
    { ...effect, form: taken, ...(size !== undefined ? { ownSize: ownSizeOf(actor) } : {}) },
    events,
    immunities
  );
  const formId = formDefinitionId(actorId);
  state.definitions = [
    ...state.definitions.filter((entry) => entry.id !== formId),
    { id: formId, definition: composed }
  ];
  actor.definitionId = formId;
  if (statBlock || form.speeds) actor.speedFeet = composed.speedFeet;
  // The stat block's Armor Class, which worn gear that still works may raise.
  if (statBlock && actor.armorClassOverride === undefined)
    actor.armorClass = storedArmorClass(actor, composed, deps.catalog);
  if (form.temporaryHitPoints !== undefined && form.temporaryHitPoints > actor.hp.temporary)
    actor.hp = { ...actor.hp, temporary: form.temporaryHitPoints };
  if (size !== undefined) refreshSize(state, actor);
  events.push({
    kind: "effect",
    text: `${actor.name} shape-shifts into ${placed.form?.name ?? form.name}.`,
    actorId
  });
  return events;
}

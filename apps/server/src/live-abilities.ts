import type { GameState } from "@vtt/domain";
import {
  abilityModifier,
  collectRiders,
  type RiderAbility,
  type RiderCarrier,
  type RiderModifier
} from "@vtt/rules-5e";
import { resolveSpellcasting, type ActorDefinition } from "@vtt/schemas";
import { spellClassOf } from "./class-features.js";
import { itemIsActive, type EquipmentCatalog } from "./equipment-derivation.js";
import { copyKeyOf, rowRecord } from "./item-records.js";
import { isFormDefinitionId } from "./transform/forms.js";
import { catalogIdOf } from "@vtt/schemas";

/**
 * Ability scores a magic item sets or raises while it is worn ("Your Strength is 19 while you wear these gauntlets",
 * an Ioun Stone's "Your Dexterity increases by 2, to a maximum of 20") and an effect sets or lowers while it lasts (a
 * Potion of Giant Strength, a shadow's Strength drain), read live: the character's stored definition keeps its own
 * scores, and the definition every rule
 * reads (`withLiveAbilityScores`, which the command kit's definition lookup applies) has the raised ones, with the
 * numbers the build baked from them moved to match (spell save DC and attack bonus, Initiative, the Hit Point maximum).
 * Taking the item off, or the effect ending, gives the scores back.
 */

type Actor = GameState["actors"][number];
type Scores = Record<RiderAbility, number>;

const ABILITIES: readonly RiderAbility[] = ["str", "dex", "con", "int", "wis", "cha"];

/** Where an overlaid definition keeps the scores it was built with, so a second reading starts from them. */
const BASE_SCORES = "vtt.base-ability-scores";

/** Where an overlaid definition keeps the Proficiency Bonus it was built with. */
const BASE_PROFICIENCY = "vtt.base-proficiency-bonus";

const sameScores = (live: Scores, definition: ActorDefinition) =>
  ABILITIES.every((ability) => live[ability] === definition.abilityScores[ability]);

/** The scores the definition was built with, before any item or effect. */
export function baseAbilityScoresOf(definition: ActorDefinition): Scores {
  const kept = definition.extensions?.[BASE_SCORES] as Scores | undefined;
  return { ...(kept ?? definition.abilityScores) };
}

const RIDER_TYPES: ReadonlySet<string> = new Set([
  "ability-score",
  "ability-score-minimum",
  "granted-score-bonus",
  "proficiency-bonus",
  "hit-points-per-level"
]);

/** The worn items and live effects whose riders set or raise a score, as carriers. */
function scoreCarriers(actor: Actor, catalog: EquipmentCatalog | undefined): RiderCarrier[] {
  const carriers: RiderCarrier[] = [];
  const attunedRecords = new Set<string>();
  for (const item of catalog ? actor.inventory : []) {
    if (item.quantity <= 0) continue;
    const record = rowRecord(catalog, item);
    // One copy of an item can be attuned (SRD Attunement), so a second gives nothing.
    const copy = copyKeyOf(record, item);
    const secondCopy = item.attuned && record?.attunement?.required === true && attunedRecords.has(copy);
    if (item.attuned && record?.attunement?.required === true) attunedRecords.add(copy);
    if (!record || secondCopy || !itemIsActive(item, record)) continue;
    const modifiers = record.modifiers.filter((modifier) => RIDER_TYPES.has(modifier.type));
    if (modifiers.length > 0) carriers.push({ label: record.name, modifiers, sourceItemId: item.id });
  }
  for (const effect of actor.effects) {
    const modifiers = effect.modifiers.filter((modifier) => RIDER_TYPES.has(modifier.type));
    if (modifiers.length > 0) carriers.push({ label: effect.name, modifiers, sourceEffectId: effect.id });
  }
  return carriers;
}

/** The scores every rule reads now: the definition's own, raised by worn items (each increase to its maximum, 20 when
 *  it names none, never lowering a score already past it), then set to at least what an item or effect makes it. */
export function liveAbilityScores(
  actor: Actor,
  definition: ActorDefinition,
  catalog: EquipmentCatalog | undefined
): Scores {
  const scores = baseAbilityScoresOf(definition);
  // What an effect took off a score (a shadow's Strength drain) comes off first, to 1 at least; an item that sets a
  // score still sets it.
  for (const effect of actor.effects)
    if (effect.abilityReduction)
      scores[effect.abilityReduction.ability] = Math.max(
        1,
        scores[effect.abilityReduction.ability] - effect.abilityReduction.amount
      );
  const riders = liveRiders(actor, catalog);
  if (riders.length === 0) return scores;
  const raises = riders.filter((rider) => rider.modifier.type === "ability-score");
  const floors = riders.filter((rider) => rider.modifier.type === "ability-score-minimum");
  const lifts = riders.filter((rider) => rider.modifier.type === "granted-score-bonus");
  for (const { modifier } of raises) raise(scores, modifier);
  const raised = { ...scores };
  for (const { modifier } of floors) {
    if (!modifier.ability || modifier.score === undefined) continue;
    // What raises the score this item sets (Hammer of Thunderbolts' Might of Giants: +4, to 30), only where the item
    // bestows it, its score above the creature's own.
    const lift = lifts
      .filter((rider) => rider.modifier.ability === modifier.ability)
      .reduce(
        (best, rider) =>
          Math.max(best, Math.min(modifier.score! + (rider.modifier.amount ?? 0), rider.modifier.maximum ?? 30)),
        modifier.score
      );
    const set = modifier.score > raised[modifier.ability] ? lift : modifier.score;
    scores[modifier.ability] = Math.max(scores[modifier.ability], set);
  }
  return scores;
}

/** The live riders of the worn items and effects that set scores, the Proficiency Bonus and the Hit Point maximum. */
function liveRiders(actor: Actor, catalog: EquipmentCatalog | undefined) {
  const carriers = scoreCarriers(actor, catalog);
  if (carriers.length === 0) return [];
  return collectRiders(carriers, {
    moment: null,
    attunedItemIds: actor.inventory.filter((item) => item.attuned).map((item) => item.id),
    attunedCatalogIds: actor.inventory.filter((item) => item.attuned).map((item) => catalogIdOf(item)),
    effectTags: actor.effects.flatMap((effect) => effect.tags),
    bearerConditionIds: actor.conditions.map((condition) => condition.id)
  });
}

/** What worn items and effects add to the Proficiency Bonus now (an Ioun Stone of Mastery's 1). */
export function liveProficiencyBonus(actor: Actor, catalog: EquipmentCatalog | undefined): number {
  return liveRiders(actor, catalog)
    .filter((rider) => rider.modifier.type === "proficiency-bonus")
    .reduce((sum, rider) => sum + (rider.modifier.amount ?? 0), 0);
}

/** "Increases by 2, to a maximum of 20": never past the maximum, and never lowering a score already past it. A penalty
 *  takes its amount off, to 1 at least. */
function raise(scores: Scores, modifier: RiderModifier): void {
  const ability = modifier.ability;
  const amount = modifier.amount ?? 0;
  if (!ability || amount === 0) return;
  const score = scores[ability];
  scores[ability] =
    amount > 0 ? Math.max(score, Math.min(score + amount, modifier.maximum ?? 20)) : Math.max(1, score + amount);
}

/** The character's total level, which the Hit Point maximum's Constitution counts once per; a stat block has none. */
const characterLevel = (definition: ActorDefinition) =>
  (definition.character?.classes ?? []).reduce((sum, entry) => sum + entry.level, 0);

/** What a changed Constitution adds to the Hit Point maximum: its modifier's change, once per character level (SRD Hit
 *  Points: "If your Constitution modifier changes, your Hit Point maximum changes as well"). */
export function liveHitPointBonus(actor: Actor, definition: ActorDefinition, catalog: EquipmentCatalog | undefined) {
  const base = baseAbilityScoresOf(definition).con;
  const live = liveAbilityScores(actor, definition, catalog).con;
  // An item's Hit Points per level ("your Hit Point maximum increases by 1 for each level you have attained", a
  // Berserker Axe), counted while it is worn.
  const perLevel = liveRiders(actor, catalog)
    .filter((rider) => rider.modifier.type === "hit-points-per-level" && rider.sourceItemId !== undefined)
    .reduce((sum, rider) => sum + (rider.modifier.amount ?? 0), 0);
  return (abilityModifier(live) - abilityModifier(base) + perLevel) * characterLevel(definition);
}

/**
 * The definition with the live scores, and what the build baked from them moved to match: the spell save DC and spell
 * attack bonus of each spellcasting class by its ability's change, the spells on the sheet cast with them, and
 * Initiative by Dexterity's. The same definition when nothing changes a score.
 */
export function withLiveAbilityScores(
  definition: ActorDefinition,
  actor: Actor,
  catalog: EquipmentCatalog | undefined
): ActorDefinition {
  const base = baseAbilityScoresOf(definition);
  const live = liveAbilityScores(actor, definition, catalog);
  // The Proficiency Bonus an item adds moves every number built from it, as an ability's change moves its own.
  const basePb = (definition.extensions?.[BASE_PROFICIENCY] as number | undefined) ?? definition.proficiencyBonus;
  const pb = liveProficiencyBonus(actor, catalog);
  if (definition.proficiencyBonus === basePb + pb && sameScores(live, definition)) return definition;
  const change = (ability: RiderAbility) => abilityModifier(live[ability]) - abilityModifier(base[ability]) + pb;
  const casting = definition.spellcasting;
  const moved = (value: number | undefined, ability: RiderAbility) =>
    value === undefined ? undefined : value + change(ability);
  const spellcasting = casting
    ? {
        ...casting,
        ...(casting.saveDc !== undefined ? { saveDc: moved(casting.saveDc, casting.ability) } : {}),
        ...(casting.attackBonus !== undefined ? { attackBonus: moved(casting.attackBonus, casting.ability) } : {}),
        ...(casting.classes
          ? {
              classes: casting.classes.map((entry) => ({
                ...entry,
                ...(entry.saveDc !== undefined ? { saveDc: moved(entry.saveDc, entry.ability) } : {}),
                ...(entry.attackBonus !== undefined ? { attackBonus: moved(entry.attackBonus, entry.ability) } : {})
              }))
            }
          : {})
      }
    : undefined;
  // The sheet's own spell casts carry the numbers the build baked; each moves with its class's ability.
  const actions = definition.actions.map((action) => {
    if (action.spellId === undefined || !casting) return action;
    const ability = resolveSpellcasting(casting, spellClassOf(definition, action.spellId) ?? undefined)?.ability;
    const by = ability ? change(ability as RiderAbility) : 0;
    if (by === 0) return action;
    return {
      ...action,
      ...(action.attack ? { attack: { ...action.attack, bonus: action.attack.bonus + by } } : {}),
      ...(action.save?.spellcasting
        ? { save: { ...action.save, dc: Math.max(1, Math.min(40, action.save.dc + by)) } }
        : {})
    };
  });
  return {
    ...definition,
    abilityScores: live,
    proficiencyBonus: basePb + pb,
    initiativeBonus: definition.initiativeBonus + change("dex") - pb,
    ...(spellcasting ? { spellcasting } : {}),
    actions,
    extensions: { ...(definition.extensions ?? {}), [BASE_SCORES]: base, [BASE_PROFICIENCY]: basePb }
  };
}

/** A stored character's definition as every rule reads it, with the scores its one creature's worn items and effects
 *  give it now. A definition several creatures share (a copy in a replay) is read as stored, and so is a form, which
 *  took its scores from the definition as it was read when the form was taken. */
export function liveDefinitionIn(
  state: GameState,
  definitionId: string,
  definition: ActorDefinition,
  catalog: EquipmentCatalog | undefined
): ActorDefinition {
  if (isFormDefinitionId(definitionId)) return definition;
  const holders = state.actors.filter((actor) => actor.definitionId === definitionId);
  return holders.length === 1 ? withLiveAbilityScores(definition, holders[0]!, catalog) : definition;
}

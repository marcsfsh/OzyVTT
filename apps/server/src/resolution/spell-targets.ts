import { wordsOfCreation } from "./action-targets.js";
import type { SpellReference } from "@vtt/content-srd-5.2.1";
import { spellRangeFeet } from "@vtt/content-srd-5.2.1/spell-effect";
import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import type { EquipmentCatalog } from "../equipment-derivation.js";
import { laterRowOf } from "../item-actions.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { potentRangeFeet } from "../class-features.js";
import type { RuleId } from "../rules-families.js";
import { sightRules } from "../vision/rules.js";
import { areAllies } from "../creature-sides.js";
import { sizeAtMost, type DefinitionAction, type LiveActor } from "./context.js";
import { spellWardOf } from "./spell-wards.js";

type Violation = Readonly<{ rule: RuleId; message: string }>;

const rounded = (feet: number) => Math.round(feet * 10) / 10;
const titled = (word: string) => `${word[0]!.toUpperCase()}${word.slice(1)}`;

/** A spell's range in feet as a cast measures it: Touch is 5 feet, and a cantrip's range that doubles with its tiers
 *  (Spare the Dying) is doubled at character levels 5, 11 and 17. Null for Self, Sight and the ranges a map can't
 *  measure. */
export function castRangeFeet(spell: SpellReference, characterLevel: number): number | null {
  // Wish's range is Self, and its uses reach the creatures its caster can see.
  if (spell.effect?.wishUses) return null;
  const base = spellRangeFeet(spell.range) ?? (/^touch\b/i.test(spell.range.text ?? "") ? 5 : null);
  if (base === null || !spell.effect?.rangeDoubles) return base;
  const tiers = [5, 11, 17].filter((level) => characterLevel >= level).length;
  return base * 2 ** tiers;
}

/** How far apart two creatures can be and still both stand in one of the spell's areas, and how far past its range
 *  one can be: a Sphere's or Cylinder's diameter and radius, a Cube's diagonal. Null for an area that starts at its
 *  caster, whose reach is its size. */
function areaSpan(area: NonNullable<SpellReference["area"]>): Readonly<{ across: number; past: number }> | null {
  if (area.shape === "sphere" || area.shape === "cylinder") return { across: area.sizeFeet * 2, past: area.sizeFeet };
  if (area.shape === "cube") {
    const diagonal = Math.ceil(area.sizeFeet * Math.SQRT2);
    return { across: diagonal, past: diagonal };
  }
  return null;
}

/**
 * A spell's own targeting (SRD 5.2.1 Spells, "Range" and "Targets"), for the creatures the caster picks: no more of
 * them than it targets at this slot; where the text says "that you can see", one the caster sees (`sightRules`); each
 * within its range (Touch is 5 feet). A spell whose targets are
 * picked among the creatures in its area ("up to six creatures of your choice in a 40-foot Cube", Mass Cure Wounds'
 * Sphere) takes them within its range plus the area's reach, and no two farther apart than one area can hold. A
 * template's catch is whoever it covers, and only its count is checked; an attack's range is the attack's; a later
 * action's trigger is wherever the creature is.
 */
export function spellTargetViolations(
  input: Readonly<{
    state: GameState;
    attacker: LiveActor;
    action: DefinitionAction;
    spell: SpellReference;
    targetIds: readonly string[];
    castLevel: number;
    /** The targets are whoever a placed template covers. */
    areaPlaced: boolean;
    characterLevel: number;
    distanceFeet: ((actorIdA: string, actorIdB: string) => number | null) | undefined;
    resolveDefinition: ((definitionId: string) => ActorDefinition | undefined) | undefined;
    catalog: EquipmentCatalog | undefined;
  }>
): Violation[] {
  const { state, attacker, action, spell, castLevel, distanceFeet } = input;
  if (laterRowOf(spell, action.id) !== undefined) return [];
  const violations: Violation[] = [];
  const effect = spell.effect;
  const unique = [...new Set(input.targetIds)];
  const picked = !input.areaPlaced;
  const nameOf = (actorId: string) => state.actors.find((candidate) => candidate.id === actorId)?.name ?? "The target";

  const words = wordsOfCreation(attacker, spell.id, unique, input.resolveDefinition, distanceFeet, nameOf);
  if (words.violation) violations.push(words.violation);
  const targets = effect?.targets;
  if (targets && action.darts === undefined && (!action.area || effect?.picksInArea)) {
    const limit = targets.count + (targets.perSlot ?? 0) * Math.max(0, castLevel - spell.level) + words.extra;
    if (unique.length > limit)
      violations.push({
        rule: "target.too-many",
        message: `${spell.name} targets ${limit === 1 ? "one creature" : `up to ${limit} creatures`}${castLevel > spell.level ? ` with a level ${castLevel} slot` : ""}; ${unique.length} ${input.areaPlaced ? "are in its area. Pick the targets instead of placing the area" : "were chosen"}.`
      });
  }
  if (!picked) return violations;

  // "Choose a Humanoid": a creature of another type is still a target, which the spell doesn't affect (`type-gates.ts`).
  const content = { resolveDefinition: input.resolveDefinition, catalog: input.catalog };
  for (const targetId of unique) {
    const target = state.actors.find((candidate) => candidate.id === targetId);
    if (!target) continue;
    // "A Tiny Beast" (Animal Messenger): a creature's size shows on the map.
    if (effect?.targetMaxSize && !sizeAtMost(target.size, effect.targetMaxSize))
      violations.push({
        rule: "target.not-allowed",
        message: `${target.name} is too large for ${spell.name}, which targets a ${titled(effect.targetMaxSize)} creature or smaller.`
      });
    // "An object that isn't being worn or carried by someone else", "a willing creature": the caster or its side.
    if (effect?.willingTargets && target.id !== attacker.id && !areAllies(attacker, target, input.resolveDefinition))
      violations.push({
        rule: "target.not-allowed",
        message: `${spell.name} targets ${attacker.name} or a willing creature, and ${target.name} isn't willing.`
      });
    // "The target can't be targeted by any Divination spell" (Nondetection).
    if (spellWardOf(state, target, spell, attacker.id, content) !== null)
      violations.push({
        rule: "target.not-allowed",
        message: `A ward keeps ${spell.name} from targeting ${target.name}.`
      });
  }
  // "A creature that you can see": the map answers with its vision on, and the conditions and the senses by distance
  // with it off (a Blinded caster, an Invisible target).
  if (effect?.seenTargets) {
    const sight = sightRules(
      state,
      {
        ...(input.resolveDefinition ? { definition: input.resolveDefinition } : {}),
        ...(input.catalog ? { catalog: input.catalog } : {})
      },
      distanceFeet
    );
    for (const targetId of unique)
      if (targetId !== attacker.id && !sight.canSee(attacker.id, targetId))
        violations.push({
          rule: "target.unseen",
          message: `${attacker.name} can't see ${nameOf(targetId)}, and ${spell.name} needs a target ${attacker.name} can see.`
        });
  }

  if (action.attack !== undefined || !distanceFeet) return violations;
  const cast = castRangeFeet(spell, input.characterLevel);
  // Improved Potent Spellcasting: a Druid cantrip of 10 feet or more reaches 300 feet farther.
  const definition = attacker.definitionId ? input.resolveDefinition?.(attacker.definitionId) : undefined;
  const range = cast !== null && cast >= 10 ? cast + potentRangeFeet(definition, spell) : cast;
  const span = effect?.picksInArea && spell.area ? areaSpan(spell.area) : null;
  const selfArea = effect?.picksInArea && spell.area && span === null ? spell.area.sizeFeet : null;
  const reach = selfArea ?? (range === null ? null : range + (span?.past ?? 0));
  if (reach !== null)
    for (const targetId of unique) {
      if (targetId === attacker.id) continue;
      const distance = distanceFeet(attacker.id, targetId);
      if (distance === null || distance <= reach + DISTANCE_TOLERANCE_FEET) continue;
      violations.push({
        rule: "range.out-of-range",
        message: span
          ? `${nameOf(targetId)} is ${rounded(distance)} ft away, beyond the ${spell.area!.sizeFeet}-foot ${spell.area!.shape} ${spell.name} centers within ${range} ft.`
          : selfArea !== null
            ? `${nameOf(targetId)} is ${rounded(distance)} ft away, outside ${spell.name}'s ${selfArea}-foot ${spell.area!.shape}.`
            : `${nameOf(targetId)} is ${rounded(distance)} ft away, beyond ${spell.name}'s ${range === 5 ? "touch" : `${range} ft range`}.`
      });
    }
  // Chain Lightning's bolts leap from the first target to others within its reach of it.
  const chain = effect?.chainFeet;
  if (chain !== undefined && unique.length > 1)
    for (const targetId of unique.slice(1)) {
      const apart = distanceFeet(unique[0]!, targetId);
      if (apart === null || apart <= chain + DISTANCE_TOLERANCE_FEET) continue;
      violations.push({
        rule: "target.outside-area",
        message: `${nameOf(targetId)} is ${rounded(apart)} ft from ${nameOf(unique[0]!)}, and ${spell.name} leaps only ${chain} ft from its first target.`
      });
    }
  // One area holds them all: no two of the picked creatures farther apart than it spans.
  if (span)
    for (const [index, first] of unique.entries())
      for (const second of unique.slice(index + 1)) {
        const apart = distanceFeet(first, second);
        if (apart === null || apart <= span.across + DISTANCE_TOLERANCE_FEET) continue;
        violations.push({
          rule: "target.outside-area",
          message: `${nameOf(first)} and ${nameOf(second)} are ${rounded(apart)} ft apart, too far for one ${spell.area!.sizeFeet}-foot ${spell.area!.shape} of ${spell.name}.`
        });
        return violations;
      }
  return violations;
}

import { CONDITION_IDS } from "@vtt/content-srd-5.2.1";
import type { GameState, KnownDefences } from "@vtt/domain";
import { choiceOverrideDefenses } from "./choice-overrides.js";
import { holdsFeature } from "./class-features.js";
import { immuneToCondition } from "./effects.js";
import { deriveEquipment } from "./equipment-derivation.js";
import { standingDefences } from "./hit-points.js";
import type { SightContent } from "./vision/senses.js";

/**
 * SRD 5.2.1 Hunter's Lore (Hunter 3): "While a creature is marked by your Hunter's Mark, you know whether that creature
 * has any Immunities, Resistances, or Vulnerabilities, and if the creature has any, you know what they are." What one
 * player learns of one creature: its damage Immunities, Resistances and Vulnerabilities and its condition Immunities,
 * read live, while a Hunter of theirs with Hunter's Lore keeps its Hunter's Mark on it. Null for any other player and
 * once the mark ends (`projections.ts`).
 */

type Actor = GameState["actors"][number];

const HUNTERS_MARK_TAG = "hunters-mark";

export function huntersLoreOf(
  state: GameState,
  creature: Actor,
  playerCharacterIds: ReadonlySet<string>,
  content: SightContent
): KnownDefences | null {
  const marked = creature.effects.some((effect) => {
    if (!effect.tags.includes(HUNTERS_MARK_TAG) || effect.sourceActorId === null) return false;
    if (!playerCharacterIds.has(effect.sourceActorId)) return false;
    const hunter = state.actors.find((actor) => actor.id === effect.sourceActorId);
    const definition = hunter?.definitionId ? definitionOf(state, hunter.definitionId, content) : undefined;
    return holdsFeature(definition, "hunters-lore", "Hunter's Lore");
  });
  if (!marked) return null;
  const definition = creature.definitionId ? definitionOf(state, creature.definitionId, content) : undefined;
  const derivation = deriveEquipment(creature, definition, content.catalog);
  const defences = standingDefences(
    definition,
    choiceOverrideDefenses(definition, creature.choiceOverrides, content.catalog?.featureRecord),
    derivation
  );
  const source = {
    ...(content.definition ? { resolveDefinition: content.definition } : {}),
    ...(content.catalog ? { catalog: content.catalog } : {})
  };
  return {
    damageImmunities: defences.immunities.map((row) => row.type),
    damageResistances: defences.resistances.map((row) => row.type),
    damageVulnerabilities: defences.vulnerabilities.map((row) => row.type),
    // The stat block's own, which the creature holds from the moment it is placed, and what its gear and effects add.
    conditionImmunities: CONDITION_IDS.filter(
      (conditionId) =>
        (definition?.conditionImmunities ?? []).includes(conditionId) ||
        immuneToCondition(creature, conditionId, source)
    )
  };
}

const definitionOf = (state: GameState, definitionId: string, content: SightContent) =>
  state.definitions.find((entry) => entry.id === definitionId)?.definition ?? content.definition?.(definitionId);

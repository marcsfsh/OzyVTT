import type { Actor, GameState } from "@vtt/domain";
import { abilityModifier } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { holdsFeature } from "./class-features.js";
import { isIncapacitated } from "./condition-rules.js";
import { areAllies, areEnemies } from "./creature-sides.js";
import { creatureTypeOf } from "./statblock-facts.js";

/**
 * What a Paladin's Aura of Protection carries to the Paladin and its allies inside it (SRD 5.2.1 Paladin): its reach,
 * the conditions Aura of Courage and Aura of Devotion ward off, Holy Nimbus's burn and ward, and Smite of
 * Protection's Half Cover. "The aura is inactive while you have the Incapacitated condition."
 */

/** Who stands where: without `distanceFeet` (no map) only a Paladin's own aura is known to reach it. */
export type AuraContext = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
}>;

/** Aura of Protection's Emanation: 10 feet, 30 with Aura Expansion. */
export function auraReachFeet(definition: ActorDefinition | undefined): number {
  return holdsFeature(definition, "aura-expansion", "Aura Expansion") ? 30 : 10;
}

/** The Paladin itself, or an ally the map shows inside its aura. A hidden Paladin's aura never shows on a visible
 *  creature, which would reveal it. */
export function inPaladinAura(
  paladin: Actor,
  definition: ActorDefinition | undefined,
  target: Actor,
  context: AuraContext
): boolean {
  if (paladin.archived || (paladin.visibility !== "public" && target.visibility === "public")) return false;
  if (paladin.id === target.id) return true;
  if (!areAllies(paladin, target, context.resolveDefinition)) return false;
  const distance = context.distanceFeet?.(paladin.id, target.id) ?? null;
  return distance !== null && distance <= auraReachFeet(definition) + 1e-6;
}

const WARDS = [
  { featureId: "aura-of-courage", name: "Aura of Courage", conditionId: "frightened" },
  { featureId: "aura-of-devotion", name: "Aura of Devotion", conditionId: "charmed" }
] as const;

/**
 * SRD Aura of Courage and Aura of Devotion: "You and your allies have Immunity to the Frightened [Charmed] condition
 * while in your Aura of Protection. If a Frightened ally enters the aura, that condition has no effect on that ally
 * while there." The aura that wards `conditionId` off `target` now, named for the table, or null.
 */
export function wardingAura(state: GameState, target: Actor, conditionId: string, context: AuraContext): string | null {
  const ward = WARDS.find((entry) => entry.conditionId === conditionId);
  if (!ward) return null;
  for (const paladin of state.actors) {
    const definition = paladin.definitionId ? context.resolveDefinition(paladin.definitionId) : undefined;
    if (isIncapacitated(paladin) || !holdsFeature(definition, ward.featureId, ward.name)) continue;
    if (!inPaladinAura(paladin, definition, target, context)) continue;
    return paladin.id === target.id ? ward.name : `${paladin.name}'s ${ward.name}`;
  }
  return null;
}

/** The conditions `target` holds that an aura keeps from having any effect while it stands there. */
export function wardedConditions(state: GameState, target: Actor, context: AuraContext): string[] {
  return target.conditions
    .map((condition) => condition.id)
    .filter((conditionId) => wardingAura(state, target, conditionId, context) !== null);
}

/** Holy Nimbus on the Paladin who took it, for its 10 minutes. */
export const HOLY_NIMBUS_TAG = "holy-nimbus";
/** Smite of Protection after a Divine Smite, until the start of the Paladin's next turn. */
export const SMITE_OF_PROTECTION_TAG = "smite-of-protection";

const carries = (paladin: Actor, tag: string) =>
  paladin.effects.some((effect) => effect.tags.includes(tag) && effect.sourceActorId === paladin.id);

/** Every Paladin whose aura is active and carries `tag` (its Holy Nimbus, a Smite of Protection), with its sheet. */
function paladinsCarrying(
  state: GameState,
  tag: string,
  context: AuraContext
): Array<Readonly<{ paladin: Actor; definition: ActorDefinition | undefined }>> {
  return state.actors.flatMap((paladin) => {
    if (!carries(paladin, tag) || isIncapacitated(paladin) || paladin.hp.current <= 0) return [];
    const definition = paladin.definitionId ? context.resolveDefinition(paladin.definitionId) : undefined;
    return [{ paladin, definition }];
  });
}

/** SRD Holy Nimbus, Radiant Damage: "Whenever an enemy starts its turn in the aura, that creature takes Radiant damage
 *  equal to your Charisma modifier plus your Proficiency Bonus." The Paladins whose nimbus burns `target` as its turn
 *  starts, with the damage each deals. */
export function holyNimbusBurns(
  state: GameState,
  target: Actor,
  context: AuraContext
): Array<Readonly<{ paladin: Actor; amount: number }>> {
  return paladinsCarrying(state, HOLY_NIMBUS_TAG, context).flatMap(({ paladin, definition }) => {
    if (paladin.id === target.id || target.hp.current <= 0 || !areEnemies(paladin, target, context.resolveDefinition))
      return [];
    if (paladin.visibility !== "public" && target.visibility === "public") return [];
    const distance = context.distanceFeet?.(paladin.id, target.id) ?? null;
    if (distance === null || distance > auraReachFeet(definition) + 1e-6) return [];
    const amount = abilityModifier(definition?.abilityScores.cha ?? 10) + (definition?.proficiencyBonus ?? 0);
    return amount > 0 ? [{ paladin, amount }] : [];
  });
}

/** SRD Holy Nimbus, Holy Ward: "You have Advantage on any saving throw you are forced to make by a Fiend or an
 *  Undead." The claim on a save `target` makes against the creature that forced it, or null. */
export function holyWardClaim(
  state: GameState,
  target: Actor,
  sourceActorId: string | null,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined
): Readonly<{ source: string; label: string }> | null {
  if (sourceActorId === null || !carries(target, HOLY_NIMBUS_TAG)) return null;
  const forcer = state.actors.find((actor) => actor.id === sourceActorId);
  if (!forcer) return null;
  const type = creatureTypeOf(forcer, forcer.definitionId ? resolveDefinition(forcer.definitionId) : undefined);
  return type === "fiend" || type === "undead" ? { source: "holy-ward", label: "Holy Nimbus (Holy Ward)" } : null;
}

/** SRD Smite of Protection: "Whenever you cast Divine Smite, you and your allies have Half Cover while in your Aura of
 *  Protection", until the start of the Paladin's next turn. Half when such an aura reaches `target`, else null. */
export function smiteOfProtectionCover(state: GameState, target: Actor, context: AuraContext): "half" | null {
  return paladinsCarrying(state, SMITE_OF_PROTECTION_TAG, context).some(({ paladin, definition }) =>
    inPaladinAura(paladin, definition, target, context)
  )
    ? "half"
    : null;
}

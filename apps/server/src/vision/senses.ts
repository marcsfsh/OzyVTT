import type { GameState } from "@vtt/domain";
import { catalogIdOf, type ActorDefinition, type Modifier } from "@vtt/schemas";
import { itemIsActive, type EquipmentCatalog } from "../equipment-derivation.js";

/**
 * What a creature perceives with, in feet (SRD 5.2.1 Rules Glossary: Darkvision, Blindsight, Tremorsense, Truesight),
 * and the light it carries. Read live from the content every time, like every other rider, so an unequipped Torch or
 * a rebuilt sheet needs no undo.
 */
export type Senses = Readonly<{ darkvision: number; blindsight: number; tremorsense: number; truesight: number }>;
export const NO_SENSES: Senses = { darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0 };

/** What the vision engine reads from outside the game state: bundled and homebrew stat blocks, and the catalog the
 *  species features and light-shedding items are in. Absent pieces mean fewer senses, never more. */
export type SightContent = Readonly<{
  definition?: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
}>;

type Actor = GameState["actors"][number];
const SENSE_NAMES = ["darkvision", "blindsight", "tremorsense", "truesight"] as const;

/** A stat block's printed senses ("darkvision 60 ft.", "Blindsight 10 ft. (blind beyond this radius)"). */
function printedSenses(definition: ActorDefinition | undefined): Partial<Record<keyof Senses, number>> {
  const senses = (definition?.extensions["open5e.srd-2024"] as { senses?: unknown } | undefined)?.senses;
  const found: Partial<Record<keyof Senses, number>> = {};
  if (!Array.isArray(senses)) return found;
  for (const entry of senses) {
    if (typeof entry !== "string") continue;
    const match = entry.trim().match(/^(darkvision|blindsight|tremorsense|truesight)\s+(\d+)/i);
    if (!match) continue;
    const name = match[1]!.toLowerCase() as keyof Senses;
    found[name] = Math.max(found[name] ?? 0, Number.parseInt(match[2]!, 10));
  }
  return found;
}

/** A modifier block's senses: `darkvision` riders, and `sense` riders naming one of the four. */
function riderSenses(modifiers: readonly Modifier[], into: Record<keyof Senses, number>) {
  for (const modifier of modifiers) {
    if (modifier.type === "darkvision") into.darkvision = Math.max(into.darkvision, modifier.feet);
    if (modifier.type === "sense" && (SENSE_NAMES as readonly string[]).includes(modifier.sense)) {
      const name = modifier.sense as keyof Senses;
      into[name] = Math.max(into[name], modifier.feet);
    }
  }
}

export function definitionOf(state: GameState, actor: Actor, content: SightContent): ActorDefinition | undefined {
  if (!actor.definitionId) return undefined;
  return (
    state.definitions.find((entry) => entry.id === actor.definitionId)?.definition ??
    content.definition?.(actor.definitionId)
  );
}

/** The best of each sense the creature has: its stat block's printed senses, its species, lineage and feats, and
 *  the active items it carries. */
export function sensesOf(state: GameState, actor: Actor, content: SightContent): Senses {
  const definition = definitionOf(state, actor, content);
  const senses: Record<keyof Senses, number> = { ...NO_SENSES, ...printedSenses(definition) };
  const catalog = content.catalog;
  if (catalog) {
    for (const held of definition?.character?.features ?? []) {
      const record = catalog.featureRecord?.(held);
      if (record) riderSenses(record.modifiers, senses);
    }
    for (const held of definition?.character?.feats ?? []) {
      const record = catalog.featRecord?.(held.id);
      if (record) riderSenses(record.feature.modifiers, senses);
    }
    for (const item of actor.inventory) {
      const record = catalog.equipmentRecord(catalogIdOf(item));
      if (record && itemIsActive(item, record)) riderSenses(record.modifiers, senses);
    }
  }
  return senses;
}

/** The light the creature carries: the brightest of its equipped light-shedding items (an equipped Torch is a lit
 *  one). Null when it carries none. */
export function carriedLightOf(actor: Actor, content: SightContent): { brightFeet: number; dimFeet: number } | null {
  const catalog = content.catalog;
  if (!catalog) return null;
  let best: { brightFeet: number; dimFeet: number } | null = null;
  for (const item of actor.inventory) {
    if (!item.equipped || item.quantity <= 0) continue;
    const light = catalog.equipmentRecord(catalogIdOf(item))?.light;
    if (light && (!best || light.brightFeet + light.dimFeet > best.brightFeet + best.dimFeet)) best = { ...light };
  }
  return best;
}

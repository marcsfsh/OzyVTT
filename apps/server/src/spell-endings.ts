import type { GameState, SpellZone } from "@vtt/domain";
import { CONCENTRATING_TAG, CURSE_TAG, endEffectIfPresent, type EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { endZone } from "./spell-zone-state.js";

type Actor = GameState["actors"][number];

/**
 * Ending spells by the rules that end spells (SRD Dispel Magic, Remove Curse, and anything that ends "a spell on a
 * creature"): what a spell left on a creature is the effects that name it (`spell`), grouped by the cast that made
 * them, and a spell area is its zone. Ending one ends only that: what the cast left elsewhere stays, unless it was all
 * that was left of a Concentration spell, whose Concentration then ends (`endIdleConcentration`).
 */

/** One spell ongoing on a creature: its cast, the spell, the level it was cast at, and the effects it left there. */
export type SpellOnCreature = Readonly<{
  key: string;
  spellId: string;
  level: number;
  name: string;
  casterId: string | null;
  effectIds: readonly string[];
}>;

/** The spells on a creature, by the effects they left on it (a caster's own Concentration marker is no spell on it:
 *  that is the caster keeping the spell up). Each is named as the catalog names it. */
export function spellsOn(actor: Actor, catalog?: EquipmentCatalog): SpellOnCreature[] {
  const byCast = new Map<string, SpellOnCreature>();
  for (const effect of actor.effects) {
    if (!effect.spell || effect.tags.includes(CONCENTRATING_TAG)) continue;
    const key = effect.castId ?? effect.id;
    const known = byCast.get(key);
    byCast.set(key, {
      key,
      spellId: effect.spell.id,
      level: Math.max(known?.level ?? 0, effect.spell.level),
      name: catalog?.spellRecord?.(effect.spell.id)?.name ?? effect.name,
      casterId: effect.sourceActorId,
      effectIds: [...(known?.effectIds ?? []), effect.id]
    });
  }
  return [...byCast.values()];
}

/** Ends one spell on a creature: every effect it left there. */
export function endSpellOn(state: GameState, actorId: string, spell: SpellOnCreature): EffectNarration[] {
  return spell.effectIds.flatMap((effectId) => endEffectIfPresent(state, actorId, effectId));
}

/** Ends the spell a spell area is: the area, and the Concentration that holds it, which ends the rest of the cast. */
export function endSpellZone(state: GameState, zone: SpellZone): EffectNarration[] {
  const holder =
    zone.castId === null
      ? undefined
      : state.actors.find((actor) =>
          actor.effects.some((effect) => effect.castId === zone.castId && effect.tags.includes(CONCENTRATING_TAG))
        );
  const marker = holder?.effects.find(
    (effect) => effect.castId === zone.castId && effect.tags.includes(CONCENTRATING_TAG)
  );
  const events = holder && marker ? endEffectIfPresent(state, holder.id, marker.id) : [];
  endZone(state, zone.id);
  return [...events, { kind: "effect", text: `${zone.name} ends.`, actorId: zone.casterId }];
}

/** SRD Remove Curse: "all curses affecting one creature ... end". The curses on a creature, each a spell or an effect
 *  tagged a curse (a homebrew curse), ended. */
export function endCursesOn(state: GameState, actorId: string): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return [];
  return actor.effects
    .filter((effect) => effect.tags.includes(CURSE_TAG))
    .flatMap((effect) => endEffectIfPresent(state, actorId, effect.id));
}

import type { GameState } from "@vtt/domain";

/**
 * SRD 5.2.1 Antimagic Field: "No one can cast spells, take Magic actions, or create other magical effects inside the
 * aura, and those things can't target or otherwise affect anything inside it. Magical properties of magic items don't
 * work inside the aura or on anything inside it." A creature inside holds the field's aura effect with this tag
 * (`zone-auras.ts`): its magic items give nothing and its ongoing spells' modifiers are suppressed
 * (`equipment-derivation.ts`), it can't cast or take the Magic action (`resolution/economy.ts`), and a spell's ward on
 * every school keeps spells off it (`resolution/spell-wards.ts`).
 */

export const ANTIMAGIC_TAG = "antimagic";

type Actor = GameState["actors"][number];

/** Whether the creature stands in an Antimagic Field. */
export const underAntimagic = (actor: Pick<Actor, "effects">): boolean =>
  actor.effects.some((effect) => effect.tags.includes(ANTIMAGIC_TAG));

/** An effect the field suppresses on a creature inside: one an ongoing spell left, but never the field's own. */
export const suppressedByAntimagic = (effect: Readonly<{ spell?: unknown; tags: readonly string[] }>): boolean =>
  effect.spell !== undefined && !effect.tags.includes(ANTIMAGIC_TAG);

/** A summoned creature the field's aura winked out while its space is inside (`zone-auras.ts`). */
export const WINKED_OUT_TAG = "antimagic-winked";

import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { commanderOf } from "./authorization.js";
import { traitOf } from "./statblock-traits.js";

/**
 * Damage one creature passes to another as it lands (SRD 5.2.1):
 * - a creature holding another by an effect it left that says so halves the damage it takes, rounded down, and the
 *   creature it holds takes the same amount (a cloaker attached, an animated rug smothering);
 * - a shield guardian within 60 feet of its amulet's wearer takes half of any damage the wearer takes, rounded up
 *   (Bound). The wearer is the creature that commands the guardian.
 * What is passed on lands as untyped damage and isn't passed on again.
 */

/** On the effect a creature's hold leaves: the holder halves its damage and the held creature takes the same. */
export const SHARES_SOURCE_DAMAGE_TAG = "shares-source-damage";

type Actor = GameState["actors"][number];
export type DamageShare = Readonly<{ actorId: string; amount: number; via: string }>;

/** What `actor` keeps of `amount`, and who takes a share of it. */
export function damageShares(
  state: GameState,
  actor: Actor,
  amount: number,
  deps:
    | Readonly<{
        resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
        distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
      }>
    | undefined
): Readonly<{ kept: number; shares: readonly DamageShare[] }> {
  if (amount <= 0) return { kept: amount, shares: [] };
  // "The cloaker halves the damage it takes (round down), and the target takes the same amount."
  for (const bearer of state.actors) {
    const hold = bearer.effects.find(
      (effect) => effect.sourceActorId === actor.id && effect.tags.includes(SHARES_SOURCE_DAMAGE_TAG)
    );
    if (!hold || bearer.id === actor.id || bearer.hp.current <= 0) continue;
    const half = Math.floor(amount / 2);
    return { kept: half, shares: half > 0 ? [{ actorId: bearer.id, amount: half, via: hold.name }] : [] };
  }
  // "Half of any damage the wearer takes (round up) is transferred to the guardian."
  if (!deps) return { kept: amount, shares: [] };
  for (const guardian of state.actors) {
    if (guardian.id === actor.id || guardian.hp.current <= 0 || commanderOf(state, guardian)?.id !== actor.id) continue;
    const definition = guardian.definitionId ? deps.resolveDefinition(guardian.definitionId) : undefined;
    const bound = traitOf(definition, "shares-wearer-damage");
    if (!bound) continue;
    const apart = deps.distanceFeet?.(guardian.id, actor.id) ?? null;
    if (apart !== null && apart > bound.withinFeet) continue;
    const share = Math.ceil(amount / 2);
    return { kept: amount - share, shares: [{ actorId: guardian.id, amount: share, via: bound.name }] };
  }
  return { kept: amount, shares: [] };
}

import type { GmView, PlayerView } from "@vtt/domain";
import { conditionBadgeLabel, conditionTone, healthBandFor } from "../encounter/conditions";
import { turnTiles } from "./TurnTiles";

export type HealthBand = "healthy" | "bloodied" | "down";

/** One row of the Ladder: the tile's place in the round, plus what this audience may see of its health. */
export type LadderEntry = ReturnType<typeof turnTiles>[number] &
  Readonly<{
    /** Exact hit points: every row for the GM, the party's rows for a player. */
    hp: Readonly<{ current: number; maximum: number; temporary: number }> | null;
    /** A foe's health as a word for a player (Healthy, Bloodied, Down): the band the projection gives. */
    band: HealthBand | null;
    party: boolean;
    conditions: readonly Readonly<{ id: string; label: string; harmful: boolean }>[];
  }>;

export const BAND_WORDS: Readonly<Record<HealthBand, string>> = {
  healthy: "Healthy",
  bloodied: "Bloodied",
  down: "Down"
};

/**
 * The turn order as the Ladder draws it (table spec 2.2, rule 5), read only from what each view already holds: the GM
 * sees every creature's hit points; a player sees the party's and, for a foe, the health band as its word, never a
 * number. Conditions come from the actor for the GM and from the projection's own labels for a player.
 */
export function turnLadder(
  view: Readonly<{ role: "gm"; state: GmView } | { role: "player"; state: PlayerView }>
): readonly LadderEntry[] {
  const tiles = turnTiles(view);
  if (view.role === "gm")
    return tiles.map((tile) => {
      const actor = view.state.actors.find((candidate) => candidate.id === tile.actorId);
      return {
        ...tile,
        hp: actor ? actor.hp : null,
        band: null,
        party: actor?.kind === "player-character",
        conditions: (actor?.conditions ?? []).map((instance) => ({
          id: instance.id,
          label: conditionBadgeLabel(instance),
          harmful: conditionTone(instance.id) === "harmful"
        }))
      };
    });
  return tiles.map((tile) => {
    const actor = view.state.actors.find((candidate) => candidate.id === tile.actorId);
    const entry = view.state.combat.initiative.find((candidate) => candidate.actorId === tile.actorId);
    const party = actor?.kind === "player-character";
    const exact = actor && "kind" in actor.hp && actor.hp.kind === "exact" ? actor.hp : null;
    return {
      ...tile,
      // A foe never shows a number to a player, even where a view carries one.
      hp: party && exact ? { current: exact.current, maximum: exact.maximum, temporary: exact.temporary } : null,
      band: party ? null : (entry?.health ?? (actor ? healthBandFor(actor.hp) : null)),
      party,
      conditions: (entry?.conditionIds ?? []).map((id, index) => ({
        id,
        label: entry?.conditions[index] ?? id,
        harmful: conditionTone(id) === "harmful"
      }))
    };
  });
}

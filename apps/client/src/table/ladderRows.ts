import type { GmView, PlayerView } from "@vtt/domain";
import { conditionBadgeLabel, conditionTone, healthBandFor } from "../encounter/conditions";

type OrderEntry = Readonly<{
  actorId: string;
  name: string;
  score: number;
  acting: boolean;
  next: boolean;
  acted: boolean;
  hidden: boolean;
}>;

/**
 * The turn order as this audience sees it. The GM gets the real order; a player gets only the entries their
 * projection holds. NEXT is the next entry in that list after the acting one, wrapping at the round's end; during a
 * hidden turn a player can't tell where the round is, so nothing is marked acting, next or done.
 */
export function orderEntries(
  view: Readonly<{ role: "gm"; state: GmView } | { role: "player"; state: PlayerView }>
): readonly OrderEntry[] {
  const { combat } = view.state;
  const entries =
    view.role === "gm"
      ? combat.initiative.map((entry) => ({
          actorId: entry.actorId,
          name: view.state.actors.find((actor) => actor.id === entry.actorId)?.name ?? "Unknown",
          score: entry.score
        }))
      : view.state.combat.initiative.map((entry) => ({ actorId: entry.actorId, name: entry.name, score: entry.score }));
  const hiddenTurn = view.role === "player" && view.state.combat.hiddenTurn;
  const at = hiddenTurn ? -1 : entries.findIndex((entry) => entry.actorId === combat.turnActorId);
  const nextAt = at === -1 || entries.length < 2 ? -1 : (at + 1) % entries.length;
  return entries.map((entry, index) => {
    const actor = view.state.actors.find((candidate) => candidate.id === entry.actorId);
    return {
      ...entry,
      acting: index === at,
      next: index === nextAt,
      // The next one at the round's end leads the next round, so it isn't dimmed as done.
      acted: at !== -1 && index < at && index !== nextAt,
      hidden: view.role === "gm" && actor?.visibility === "gm-only"
    };
  });
}

export type HealthBand = "healthy" | "bloodied" | "down";

/** One row of the Ladder: the tile's place in the round, plus what this audience may see of its health. */
export type LadderEntry = OrderEntry &
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
  const tiles = orderEntries(view);
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

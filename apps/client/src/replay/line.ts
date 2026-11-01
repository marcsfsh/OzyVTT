import type { HealthBand } from "@vtt/domain";

/** What the line marks under a turn: hit points lost, hit points back, or a creature at 0. */
export type LineMark = "damage" | "heal" | "down";

/** One creature's health at a turn, as the viewer may read it: exact hit points, or a band for a player's monster. */
export type Health = Readonly<{ current: number }> | Readonly<{ band: HealthBand }>;

/** One turn on the line: its round, and each creature's health by id. */
export type LineTurn = Readonly<{ round: number; health: ReadonlyMap<string, Health> }>;

const BAND_RANK: Readonly<Record<HealthBand, number>> = { down: 0, bloodied: 1, healthy: 2 };

const rank = (health: Health) => ("current" in health ? health.current : BAND_RANK[health.band]);
const isDown = (health: Health) => ("current" in health ? health.current <= 0 : health.band === "down");

/**
 * The mark each turn earns against the turn before it. A creature reaching 0 outweighs the damage that put it there,
 * and damage outweighs healing in the same turn, so the line shows the turn's worst news. The first turn has nothing to
 * compare with and no mark.
 */
export function lineMarks(turns: readonly LineTurn[]): ReadonlyArray<LineMark | null> {
  return turns.map((turn, index) => {
    const before = turns[index - 1];
    if (!before) return null;
    let mark: LineMark | null = null;
    for (const [id, now] of turn.health) {
      const then = before.health.get(id);
      if (!then) continue;
      if (isDown(now) && !isDown(then)) return "down";
      if (rank(now) < rank(then)) mark = "damage";
      else if (rank(now) > rank(then) && mark === null) mark = "heal";
    }
    return mark;
  });
}

/** The rounds as sections of the line: each round's number with the first turn and how many turns it holds. */
export function lineRounds(
  turns: readonly LineTurn[]
): ReadonlyArray<Readonly<{ round: number; start: number; length: number }>> {
  const rounds: Array<{ round: number; start: number; length: number }> = [];
  turns.forEach((turn, index) => {
    const last = rounds[rounds.length - 1];
    if (last && last.round === turn.round) last.length += 1;
    else rounds.push({ round: turn.round, start: index, length: 1 });
  });
  return rounds;
}

/** The turn under a point on the line, from its fraction across: the nearest tick, kept inside the fight. */
export function turnAt(fraction: number, count: number): number {
  if (count < 2) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(fraction * (count - 1))));
}

/** "Turn 08 of 15": the count beside the line, padded so it does not jump as the turn changes. */
export function turnCount(index: number, count: number): string {
  const width = String(count).length < 2 ? 2 : String(count).length;
  return `Turn ${String(index + 1).padStart(width, "0")} of ${count}`;
}

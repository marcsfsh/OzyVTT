import type { CharacterChoice } from "@vtt/schemas";

/**
 * Ability Score Improvement rows taken as the ASI feat's two +1 picks, each into the first ability in `order`
 * still under 20 (`scores` holds each one's score before the first). The build refuses a pick past 20 rather
 * than dropping it, so a fixture that keeps raising one ability must move on.
 */
export function asiRows(
  classId: string | null,
  levels: readonly number[],
  order: readonly string[],
  scores: Readonly<Record<string, number>>
): CharacterChoice[] {
  const running: Record<string, number> = { ...scores };
  return levels.flatMap((level) => [
    { level, ...(classId ? { classId } : {}), kind: "asi-or-feat", id: "ability-score-improvement" },
    ...[0, 1].map(() => {
      const id = order.find((ability) => (running[ability] ?? 10) < 20) ?? order[order.length - 1];
      running[id] = (running[id] ?? 10) + 1;
      return { level, kind: "ability-score", id, payload: { featureId: "ability-score-improvement" } };
    })
  ]);
}

import { useEffect, useState } from "react";
import type { ContentMonsterSummary, GmActor } from "@vtt/domain";
import { encounterBudget, encounterDifficulty, type EncounterDifficulty } from "@vtt/rules-5e";
import { loadMonsterCatalog } from "./monster-catalog";

const DIFFICULTY: Record<EncounterDifficulty, string> = {
  "under-low": "Below Low",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  "over-high": "Beyond High"
};

/**
 * The staged fight against the SRD's XP budget: the monsters' XP total and the difficulty it reaches for
 * the staged characters, by their levels. A GM aid while staging, so it says nothing until a monster is staged.
 */
export function EncounterBudgetLine({
  actors,
  staged
}: Readonly<{ actors: readonly GmActor[]; staged: readonly string[] }>) {
  const [monsters, setMonsters] = useState<readonly ContentMonsterSummary[] | null>(null);
  useEffect(() => {
    void loadMonsterCatalog().then(
      (loaded) => setMonsters(loaded.monsters),
      () => setMonsters([])
    );
  }, []);
  const stagedActors = staged.flatMap((id) => actors.filter((actor) => actor.id === id));
  const foes = stagedActors.filter((actor) => actor.kind !== "player-character");
  if (foes.length === 0 || monsters === null) return null;
  const xpById = new Map(monsters.map((monster) => [monster.id, monster.experiencePoints]));
  const totalXp = foes.reduce((sum, actor) => sum + (xpById.get(actor.definitionId ?? "") ?? 0), 0);
  // A character's level is its Hit Dice maximum: one die per level.
  const levels = stagedActors.flatMap((actor) =>
    actor.kind === "player-character" && actor.hitDice ? [actor.hitDice.maximum] : []
  );
  if (levels.length === 0)
    return (
      <p className="encounter-budget">
        This encounter is worth <strong>{totalXp.toLocaleString()}</strong> XP. Stage the characters to see how hard it
        is.
      </p>
    );
  const budget = encounterBudget(levels);
  return (
    <p className="encounter-budget">
      This encounter is worth <strong>{totalXp.toLocaleString()}</strong> XP:{" "}
      {`${DIFFICULTY[encounterDifficulty(totalXp, budget)]} for ${levels.length} ${levels.length === 1 ? "character" : "characters"}`}
      <small>
        Low {budget.low.toLocaleString()} · Moderate {budget.moderate.toLocaleString()} · High{" "}
        {budget.high.toLocaleString()}
      </small>
    </p>
  );
}

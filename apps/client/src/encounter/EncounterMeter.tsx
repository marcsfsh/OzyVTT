import { useEffect, useState } from "react";
import type { ContentMonsterSummary, GmActor, GmView } from "@vtt/domain";
import { encounterBudget, encounterDifficulty, type EncounterBudget, type EncounterDifficulty } from "@vtt/rules-5e";
import { ActorPortrait, frameOf } from "../actors/ActorPortrait";
import { loadMonsterCatalog } from "./monster-catalog";
import "./encounter-meter.css";

export const DIFFICULTY_WORD: Readonly<Record<EncounterDifficulty, string>> = {
  "under-low": "Below Low",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  "over-high": "Beyond High"
};

type Group = Readonly<{ key: string; name: string; actor: GmActor; count: number; xp: number | null }>;

export type EncounterReading =
  | Readonly<{ kind: "no-foes" }>
  | Readonly<{ kind: "unknown-xp"; groups: readonly Group[]; missing: readonly string[] }>
  | Readonly<{ kind: "no-party"; groups: readonly Group[]; xp: number }>
  | Readonly<{
      kind: "reading";
      groups: readonly Group[];
      xp: number;
      levels: readonly number[];
      budget: EncounterBudget;
      difficulty: EncounterDifficulty;
    }>;

/**
 * The staged fight against the SRD's XP budget, from the staged actors and the monster catalog: the monsters grouped
 * by stat block with their XP, and where the total falls for the staged characters' levels. A monster the catalog
 * gives no XP leaves the reading out, so the meter never shows a difficulty it can't back.
 */
export function readEncounter(
  actors: readonly GmActor[],
  staged: readonly string[],
  monsters: readonly ContentMonsterSummary[]
): EncounterReading {
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  const stagedActors = staged.map((id) => byId.get(id)).filter((actor) => actor !== undefined);
  const foes = stagedActors.filter((actor) => actor.kind !== "player-character");
  if (foes.length === 0) return { kind: "no-foes" };
  const xpOf = new Map(monsters.map((monster) => [monster.id, monster.experiencePoints]));
  const groups = new Map<string, { key: string; name: string; actor: GmActor; count: number; xp: number | null }>();
  for (const actor of foes) {
    const key = actor.definitionId ?? actor.id;
    const xp = actor.definitionId ? (xpOf.get(actor.definitionId) ?? null) : null;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { key, name: actor.name.replace(/\s+\d+$/, ""), actor, count: 1, xp });
  }
  const list = [...groups.values()];
  const missing = list.filter((group) => group.xp === null).map((group) => group.name);
  if (missing.length > 0) return { kind: "unknown-xp", groups: list, missing };
  const xp = list.reduce((sum, group) => sum + (group.xp ?? 0) * group.count, 0);
  // A character's level is its Hit Dice maximum: one die per level.
  const levels = stagedActors.flatMap((actor) =>
    actor.kind === "player-character" && actor.hitDice ? [actor.hitDice.maximum] : []
  );
  if (levels.length === 0) return { kind: "no-party", groups: list, xp };
  const budget = encounterBudget(levels);
  return { kind: "reading", groups: list, xp, levels, budget, difficulty: encounterDifficulty(xp, budget) };
}

/** "3 level 7 characters", or "3 characters of levels 5, 7 and 7". */
function partyWords(levels: readonly number[]): string {
  const noun = levels.length === 1 ? "character" : "characters";
  if (levels.every((level) => level === levels[0])) return `${levels.length} level ${levels[0]} ${noun}`;
  const sorted = [...levels].sort((a, b) => a - b);
  return `${levels.length} ${noun} of levels ${sorted.slice(0, -1).join(", ")} and ${sorted.at(-1)}`;
}

/**
 * The scene's encounter: each monster group with its count and XP, then the difficulty meter with the budget's
 * thresholds for the staged party, or what keeps it from reading.
 */
export function EncounterMeter({
  state,
  token,
  staged
}: Readonly<{ state: GmView; token: string | null; staged: readonly string[] }>) {
  const [monsters, setMonsters] = useState<readonly ContentMonsterSummary[] | null>(null);
  useEffect(() => {
    void loadMonsterCatalog().then(
      (loaded) => setMonsters(loaded.monsters),
      () => setMonsters([])
    );
  }, []);
  if (monsters === null) return <p className="encounter-meter-note">Loading the monster catalog.</p>;
  const reading = readEncounter(state.actors, staged, monsters);
  if (reading.kind === "no-foes") return <p className="encounter-meter-note">No monsters staged yet.</p>;
  return (
    <div className="encounter-meter">
      <ul className="encounter-meter-groups">
        {reading.groups.map((group) => (
          <li key={group.key}>
            <ActorPortrait
              actor={group.actor}
              token={token}
              definitions={state.definitions}
              frame={frameOf(group.actor, "gm")}
              size="xs"
            />
            <span className="encounter-meter-name">{group.name}</span>
            <span className="encounter-meter-count">x{group.count}</span>
            <span className="encounter-meter-xp">
              {group.xp === null ? "--" : (group.xp * group.count).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
      {reading.kind === "unknown-xp" && (
        <p className="encounter-meter-note">
          The catalog gives no XP for {reading.missing.join(", ")}, so the fight&apos;s difficulty can&apos;t be read.
        </p>
      )}
      {reading.kind === "no-party" && (
        <p className="encounter-meter-note">
          This fight is worth <b>{reading.xp.toLocaleString()} XP</b>. Stage the characters to see how hard it is.
        </p>
      )}
      {reading.kind === "reading" && <Meter reading={reading} />}
    </div>
  );
}

function Meter({ reading }: Readonly<{ reading: Extract<EncounterReading, { kind: "reading" }> }>) {
  const { budget, xp } = reading;
  // The track runs past High by a quarter, or to the total when it is further still.
  const end = Math.max(budget.high * 1.25, xp, 1);
  const at = (value: number) => Math.min(100, (value / end) * 100);
  const label = `${DIFFICULTY_WORD[reading.difficulty]}, ${xp.toLocaleString()} XP`;
  return (
    <div className="encounter-meter-reading">
      <p className="encounter-meter-head">
        <b>{DIFFICULTY_WORD[reading.difficulty]}</b>
        <span className="encounter-meter-total">{xp.toLocaleString()} XP</span>
      </p>
      <div className="encounter-meter-track" role="img" aria-label={label}>
        <span
          className="encounter-meter-band is-low"
          style={{ left: `${at(budget.low)}%`, right: `${100 - at(budget.moderate)}%` }}
        />
        <span
          className="encounter-meter-band is-moderate"
          style={{ left: `${at(budget.moderate)}%`, right: `${100 - at(budget.high)}%` }}
        />
        <span className="encounter-meter-band is-high" style={{ left: `${at(budget.high)}%`, right: 0 }} />
        <span className="encounter-meter-mark" style={{ left: `${at(xp)}%` }} />
      </div>
      <p className="encounter-meter-note">
        For {partyWords(reading.levels)}, Low starts at {budget.low.toLocaleString()} XP, Moderate at{" "}
        {budget.moderate.toLocaleString()} and High at {budget.high.toLocaleString()}.
      </p>
    </div>
  );
}

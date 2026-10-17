/** The SRD's own stat blocks of the chosen challenge rating, set beside the monster's numbers for the GM to judge.
    The server works out the median, lowest and highest from the bundled stat blocks (`content:monster-benchmarks`),
    so every figure is one the SRD prints. */

import { useEffect, useState } from "react";
import type { ContentMonsterBenchmark } from "@vtt/domain";
import { statblockNumbers } from "@vtt/rules-5e";
import { read } from "../../lib/command";
import type { Draft } from "../schema";
import { challengeOf } from "./monster-build";

let loaded: Promise<readonly ContentMonsterBenchmark[]> | null = null;

/** Fetched once per page load and shared; a failed read is forgotten so the next one retries. */
export function useMonsterBenchmarks(): readonly ContentMonsterBenchmark[] | null {
  const [benchmarks, setBenchmarks] = useState<readonly ContentMonsterBenchmark[] | null>(null);
  useEffect(() => {
    let live = true;
    loaded ??= read("content:monster-benchmarks", {}).then((result) => {
      if (!result.ok || !result.benchmarks) {
        loaded = null;
        return [];
      }
      return result.benchmarks;
    });
    void loaded.then((rows) => {
      if (live) setBenchmarks(rows);
    });
    return () => {
      live = false;
    };
  }, []);
  return benchmarks;
}

export type BenchmarkKey = "armorClass" | "hitPoints" | "attackBonus" | "saveDc" | "damagePerRound";

const WORDS: Readonly<Record<BenchmarkKey, string>> = {
  armorClass: "Armor Class",
  hitPoints: "Hit Points",
  attackBonus: "Attack bonus",
  saveDc: "Save DC",
  damagePerRound: "Damage per round"
};

const signedIf = (key: BenchmarkKey, value: number) => (key === "attackBonus" && value >= 0 ? `+${value}` : `${value}`);

/** This monster's own numbers, read the way the benchmarks read the SRD's. */
export const monsterNumbers = (draft: Draft) =>
  statblockNumbers({
    armorClass: typeof draft.armorClass === "number" ? draft.armorClass : 0,
    hitPoints: { maximum: (draft.hitPoints as { maximum?: number } | undefined)?.maximum ?? 0 },
    actions: Array.isArray(draft.actions) ? (draft.actions as Parameters<typeof statblockNumbers>[0]["actions"]) : []
  });

/** One line per number: "median 15 · 11 to 18 · yours 12". */
export function MonsterBenchmarks({ draft, keys }: Readonly<{ draft: Draft; keys: readonly BenchmarkKey[] }>) {
  const benchmarks = useMonsterBenchmarks();
  const rating = challengeOf(draft);
  if (rating === null) return null;
  const label = rating === 0.125 ? "1/8" : rating === 0.25 ? "1/4" : rating === 0.5 ? "1/2" : String(rating);
  if (benchmarks === null)
    return (
      <p className="nh-field-help" role="status">
        Loading the SRD's stat blocks…
      </p>
    );
  const row = benchmarks.find((entry) => entry.challengeRating === rating);
  if (!row) return <p className="nh-field-help">The SRD has no stat block of CR {label} to compare with.</p>;
  const yours = monsterNumbers(draft);
  return (
    <div className="hb-bench" role="group" aria-label={`SRD monsters of CR ${label}`}>
      <p className="hb-bench-title">
        The SRD's {row.count} {row.count === 1 ? "stat block" : "stat blocks"} of CR {label}
      </p>
      <dl className="hb-bench-rows">
        {keys.map((key) => {
          const spread = row[key];
          const mine = yours[key];
          return (
            <div key={key} className="hb-bench-row">
              <dt>{WORDS[key]}</dt>
              <dd className="tabular">
                {spread ? (
                  <>
                    median {signedIf(key, spread.median)} · {signedIf(key, spread.min)} to {signedIf(key, spread.max)}
                  </>
                ) : (
                  "None of them has one"
                )}
                {mine !== null && (
                  <span className="hb-bench-yours">
                    {" "}
                    · yours {signedIf(key, mine)}
                    {spread && (mine < spread.min || mine > spread.max)
                      ? mine < spread.min
                        ? ", below them all"
                        : ", above them all"
                      : ""}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

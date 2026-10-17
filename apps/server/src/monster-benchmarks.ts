import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { challengeBenchmarks, type ChallengeBenchmark } from "@vtt/rules-5e";
import { statblockFacts } from "./statblock-facts.js";

/**
 * What the bundled SRD stat blocks of each challenge rating have, so a GM writing a homebrew monster can judge its
 * numbers against the book's. SRD only: the GM's own creatures would bend the comparison towards themselves. The
 * bundle never changes while the server runs, so this is worked out once.
 */
let benchmarks: readonly ChallengeBenchmark[] | null = null;

export function srdMonsterBenchmarks(): readonly ChallengeBenchmark[] {
  benchmarks ??= challengeBenchmarks(
    loadMonsterDefinitions().flatMap((definition) => {
      const challengeRating = statblockFacts(definition).challengeRating;
      return challengeRating === null ? [] : [{ challengeRating, statblock: definition }];
    })
  );
  return benchmarks;
}

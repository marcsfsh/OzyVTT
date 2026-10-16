// Encounter building (SRD 5.2.1 Gameplay Toolbox, "Combat Encounters"): XP by challenge rating, and the XP
// budget per character that sets an encounter's difficulty.

/** XP by challenge rating, as stat blocks print it beside the CR. */
const XP_BY_CHALLENGE: ReadonlyMap<number, number> = new Map([
  [0, 10],
  [0.125, 25],
  [0.25, 50],
  [0.5, 100],
  [1, 200],
  [2, 450],
  [3, 700],
  [4, 1100],
  [5, 1800],
  [6, 2300],
  [7, 2900],
  [8, 3900],
  [9, 5000],
  [10, 5900],
  [11, 7200],
  [12, 8400],
  [13, 10000],
  [14, 11500],
  [15, 13000],
  [16, 15000],
  [17, 18000],
  [18, 20000],
  [19, 22000],
  [20, 25000],
  [21, 33000],
  [22, 41000],
  [23, 50000],
  [24, 62000],
  [25, 75000],
  [26, 90000],
  [27, 105000],
  [28, 120000],
  [29, 135000],
  [30, 155000]
]);

/** A creature's XP from its challenge rating; null for a rating the SRD doesn't list. */
export function experienceForChallenge(challengeRating: number): number | null {
  return XP_BY_CHALLENGE.get(challengeRating) ?? null;
}

/** XP Budget per Character, by character level: Low, Moderate and High difficulty. */
const BUDGET_PER_CHARACTER: ReadonlyArray<readonly [number, number, number]> = [
  [50, 75, 100],
  [100, 150, 200],
  [150, 225, 400],
  [250, 375, 500],
  [500, 750, 1100],
  [600, 1000, 1400],
  [750, 1300, 1700],
  [1000, 1700, 2100],
  [1300, 2000, 2600],
  [1600, 2300, 3100],
  [1900, 2900, 4100],
  [2200, 3700, 4700],
  [2600, 4200, 5400],
  [2900, 4900, 6200],
  [3300, 5400, 7800],
  [3800, 6100, 9800],
  [4500, 7200, 11700],
  [5000, 8700, 14200],
  [5500, 10700, 17200],
  [6400, 13200, 22000]
];

export type EncounterBudget = Readonly<{ low: number; moderate: number; high: number }>;

/** The party's XP budget: each character's row for their own level, summed (the SRD's mixed-level advice). */
export function encounterBudget(characterLevels: readonly number[]): EncounterBudget {
  return characterLevels.reduce<EncounterBudget>(
    (sum, level) => {
      const [low, moderate, high] = BUDGET_PER_CHARACTER[Math.min(20, Math.max(1, Math.trunc(level))) - 1];
      return { low: sum.low + low, moderate: sum.moderate + moderate, high: sum.high + high };
    },
    { low: 0, moderate: 0, high: 0 }
  );
}

export type EncounterDifficulty = "under-low" | "low" | "moderate" | "high" | "over-high";

/** Where an encounter's total XP falls against the budget: the highest difficulty it reaches. */
export function encounterDifficulty(totalXp: number, budget: EncounterBudget): EncounterDifficulty {
  if (totalXp > budget.high) return "over-high";
  if (totalXp >= budget.high) return "high";
  if (totalXp >= budget.moderate) return "moderate";
  if (totalXp >= budget.low) return "low";
  return "under-low";
}

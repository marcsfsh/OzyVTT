export type CoverageState = "enforced" | "guided" | "reference";
export type CuratedCoverage = Readonly<{ state: CoverageState; note: string }>;
export const CONDITION_COVERAGE: Readonly<Record<string, CuratedCoverage>> = {};
export const GLOSSARY_COVERAGE: Readonly<Record<string, CuratedCoverage>> = {};
export const MONSTER_TRAIT_COVERAGE: Readonly<Record<string, CuratedCoverage>> = {};
export const RECORD_OVERRIDES: Readonly<Record<string, CuratedCoverage>> = {};

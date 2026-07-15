/** Declarative operation vocabulary only. Imported content can describe it but never execute code. */
export type RollVisibility = "public" | "gm-only" | "blind" | "self-only";
export type DiceIntent = { formula: string; visibility: RollVisibility; purpose: "attack" | "save" | "check" | "damage" | "manual" };

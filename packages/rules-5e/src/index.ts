export * from "./dice.js";

/** Declarative operation vocabulary only. Imported content can describe it but never execute code. */
export type DiceIntent = { formula: string; purpose: "attack" | "save" | "check" | "damage" | "manual" };

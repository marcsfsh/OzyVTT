export * from "./dice.js";
export * from "./combat.js";
export * from "./character.js";
export * from "./ability-scores.js";
export * from "./class-data.js";
export * from "./progression.js";

/** Declarative operation vocabulary only. Imported content can describe it but never execute code. */
export type DiceIntent = { formula: string; purpose: "attack" | "save" | "check" | "damage" | "manual" };

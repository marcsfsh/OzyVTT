import { useSyncExternalStore } from "react";

/**
 * One per-browser dice-input preference shared by every roll surface - the character sheet, saving throws,
 * death saves, attacks, the initiative-list action runner, and the dice panel - so a player who sets it
 * once gets the same manual/auto experience everywhere (the user's "one consistent experience" ask). It is
 * presentation only: the server always rolls authoritatively (ADR-0012); this choice is just whether THIS
 * browser auto-rolls or waits for a typed physical die, and (for the sheet's own-formula rolls) whether a
 * typed d20 gets its bonus auto-added or is already the final total.
 *
 * Backed by localStorage under the character sheet's original keys, so an existing preference carries over
 * and the sheet's toggle and the dice-panel toggle stay in lockstep. Supersedes the old table-wide,
 * GM-set `combat.rollMode` (now inert) - the preference is per person, per the product decision.
 */
export type RollInput = "digital" | "manual";
export type BonusMode = "auto" | "total";
/** Where a player's structured attack from the OPEN character sheet resolves in combat: "inline" renders the
 * target picker + result on the sheet; "jump" hops to the initiative view to pick/confirm, then back. */
export type SheetAttackMode = "jump" | "inline";

const INPUT_KEY = "vtt.sheet.rollInput";
const BONUS_KEY = "vtt.sheet.bonusMode";
const ATTACK_KEY = "vtt.sheet.attackMode";
const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable; the choice stays in-session */ } };

let rollInput: RollInput = read(INPUT_KEY) === "manual" ? "manual" : "digital";
let bonusMode: BonusMode = read(BONUS_KEY) === "total" ? "total" : "auto";
let sheetAttackMode: SheetAttackMode = read(ATTACK_KEY) === "jump" ? "jump" : "inline";
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function setRollInput(mode: RollInput) { if (mode !== rollInput) { rollInput = mode; write(INPUT_KEY, mode); emit(); } }
export function setBonusMode(mode: BonusMode) { if (mode !== bonusMode) { bonusMode = mode; write(BONUS_KEY, mode); emit(); } }
export function setSheetAttackMode(mode: SheetAttackMode) { if (mode !== sheetAttackMode) { sheetAttackMode = mode; write(ATTACK_KEY, mode); emit(); } }

/** The auto/manual choice as the "auto"|"manual" shape the shared RollControls widget already speaks. */
export function rollModeOf(input: RollInput): "auto" | "manual" { return input === "manual" ? "manual" : "auto"; }

/** Reactive access for components; re-renders on any surface when the shared preference changes anywhere. */
export function useRollPreference() {
  const input = useSyncExternalStore(subscribe, () => rollInput, () => rollInput);
  const bonus = useSyncExternalStore(subscribe, () => bonusMode, () => bonusMode);
  const attack = useSyncExternalStore(subscribe, () => sheetAttackMode, () => sheetAttackMode);
  return { rollInput: input, bonusMode: bonus, sheetAttackMode: attack, rollMode: rollModeOf(input), setRollInput, setBonusMode, setSheetAttackMode };
}

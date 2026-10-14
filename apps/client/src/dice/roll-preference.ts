import { useSyncExternalStore } from "react";

/**
 * One per-browser dice-input preference shared by every roll surface (sheet, saves, death saves,
 * attacks, the action runner, the dice panel). Presentation only: the server always rolls
 * (ADR-0012). It decides whether this browser auto-rolls or waits for a typed physical die, and
 * whether a typed d20 on the sheet gets its bonus added or is already the total.
 *
 * Stored in localStorage under the sheet's original keys, so the sheet and dice-panel toggles stay
 * in lockstep. Per person; the old table-wide `combat.rollMode` is inert.
 */
export type RollInput = "digital" | "manual";
export type BonusMode = "auto" | "total";
/** Where an attack from the open character sheet resolves in combat: "inline" renders the target
 * picker and result on the sheet; "jump" goes to the initiative view and back. */
export type SheetAttackMode = "jump" | "inline";

const INPUT_KEY = "vtt.sheet.rollInput";
const BONUS_KEY = "vtt.sheet.bonusMode";
const ATTACK_KEY = "vtt.sheet.attackMode";
const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable; the choice stays in-session */
  }
};

let rollInput: RollInput = read(INPUT_KEY) === "manual" ? "manual" : "digital";
let bonusMode: BonusMode = read(BONUS_KEY) === "total" ? "total" : "auto";
let sheetAttackMode: SheetAttackMode = read(ATTACK_KEY) === "jump" ? "jump" : "inline";
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function setRollInput(mode: RollInput) {
  if (mode !== rollInput) {
    rollInput = mode;
    write(INPUT_KEY, mode);
    emit();
  }
}
export function setBonusMode(mode: BonusMode) {
  if (mode !== bonusMode) {
    bonusMode = mode;
    write(BONUS_KEY, mode);
    emit();
  }
}
export function setSheetAttackMode(mode: SheetAttackMode) {
  if (mode !== sheetAttackMode) {
    sheetAttackMode = mode;
    write(ATTACK_KEY, mode);
    emit();
  }
}

/** The choice in the "auto"|"manual" shape the shared RollControls widget uses. */
export function rollModeOf(input: RollInput): "auto" | "manual" {
  return input === "manual" ? "manual" : "auto";
}

/** Reactive access; re-renders when the shared preference changes anywhere. */
export function useRollPreference() {
  const input = useSyncExternalStore(
    subscribe,
    () => rollInput,
    () => rollInput
  );
  const bonus = useSyncExternalStore(
    subscribe,
    () => bonusMode,
    () => bonusMode
  );
  const attack = useSyncExternalStore(
    subscribe,
    () => sheetAttackMode,
    () => sheetAttackMode
  );
  return {
    rollInput: input,
    bonusMode: bonus,
    sheetAttackMode: attack,
    rollMode: rollModeOf(input),
    setRollInput,
    setBonusMode,
    setSheetAttackMode
  };
}

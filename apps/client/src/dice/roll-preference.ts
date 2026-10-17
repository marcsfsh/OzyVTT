import { useSyncExternalStore } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import { socket } from "../socket";

/**
 * One per-browser dice-input preference shared by every roll surface (sheet, saves, death saves,
 * attacks, the action runner, the dice panel). Presentation only: the server always rolls or reads
 * a typed face and adds the bonus itself (ADR-0012). It decides whether this browser has the server
 * throw the dice or waits for the face a physical die shows.
 *
 * The table has the last word: while the GM keeps players' dice on the server (`typedRolls`), a
 * player's browser throws digitally whatever it chose. Stored in localStorage under the sheet's
 * original keys, so the sheet and dice-panel toggles stay in lockstep.
 */
export type RollInput = "digital" | "manual";
/** Where an attack from the open character sheet resolves in combat: "inline" renders the target
 * picker and result on the sheet; "jump" goes to the initiative view and back. */
export type SheetAttackMode = "jump" | "inline";

const INPUT_KEY = "vtt.sheet.rollInput";
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
let sheetAttackMode: SheetAttackMode = read(ATTACK_KEY) === "jump" ? "jump" : "inline";
/** Whether this tab may type its dice: the GM always, a player while the table lets players type theirs. */
let mayType = true;
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
export function setSheetAttackMode(mode: SheetAttackMode) {
  if (mode !== sheetAttackMode) {
    sheetAttackMode = mode;
    write(ATTACK_KEY, mode);
    emit();
  }
}

/** Follows the table's setting for typed dice from a pushed view. Only the GM's view carries the stat blocks. */
export function followTable(view: GmView | PlayerView) {
  const next = "definitions" in view || view.builderPolicy?.typedRolls !== "gm-only";
  if (next !== mayType) {
    mayType = next;
    emit();
  }
}
socket.on("state:updated", followTable);

/** The choice in the "auto"|"manual" shape the shared RollControls widget uses. */
export function rollModeOf(input: RollInput): "auto" | "manual" {
  return input === "manual" ? "manual" : "auto";
}

/** Reactive access; re-renders when the shared preference or the table's setting changes. */
export function useRollPreference() {
  const chosen = useSyncExternalStore(
    subscribe,
    () => rollInput,
    () => rollInput
  );
  const typing = useSyncExternalStore(
    subscribe,
    () => mayType,
    () => mayType
  );
  const attack = useSyncExternalStore(
    subscribe,
    () => sheetAttackMode,
    () => sheetAttackMode
  );
  const input: RollInput = typing ? chosen : "digital";
  return {
    /** How this browser rolls now: its choice, unless the table keeps players' dice on the server. */
    rollInput: input,
    /** Whether this browser may type a die's face at all. */
    mayType: typing,
    sheetAttackMode: attack,
    rollMode: rollModeOf(input),
    setRollInput,
    setSheetAttackMode
  };
}

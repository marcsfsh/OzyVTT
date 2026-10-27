import { useSyncExternalStore } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import { socket } from "../socket";

/**
 * How every roll surface (sheet, saves, death saves, attacks, the action runner, the dice panel) takes its dice.
 * Presentation only: the server always rolls, or reads a typed face or total and checks it (ADR-0012, ADR-0043).
 *
 * The table has the last word for players: its d20 mode has the server throw, or asks for the die's face, or for the
 * total. The GM keeps a per-browser choice, stored in localStorage under the sheet's original keys so the sheet and
 * dice-panel toggles stay in lockstep.
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
/** The latest view pushed to this tab: the table's dice modes and who is played at the table come from it. */
let view: GmView | PlayerView | null = null;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version += 1;
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

/** Follows the table's dice modes from a pushed view. Only the GM's view carries the stat blocks. */
export function followTable(next: GmView | PlayerView) {
  view = next;
  emit();
}
socket.on("state:updated", followTable);

/** What a typed number is: a die's face, or the roll's total with the bonus included (ADR-0043). */
export type TypeAs = "face" | "total";

/** How one roll is entered on this tab. */
export type RollEntry = Readonly<{
  /** How this browser rolls now. */
  rollInput: RollInput;
  /** Whether a typed number is taken at all. */
  mayType: boolean;
  typeAs: TypeAs;
  /** Whether this browser picks between rolling and typing (the GM's own rolls); otherwise the table decides. */
  chooses: boolean;
}>;

/** Whether the GM's view has this character played at the table now (ADR-0042). */
function atTable(gm: GmView, actorId: string): boolean {
  // Read defensively: the first view a signing-in GM receives can still be player-shaped.
  const chosen = gm.combat?.active ? gm.combat.atTable?.[actorId] : undefined;
  return chosen ?? gm.actors?.find((actor) => actor.id === actorId)?.playedAtTable === true;
}

/**
 * A roll's entry: a player's follows the table's d20 mode (the server throws, or they type the face, or the total);
 * the GM chooses, except for a character played at the table, whose total the GM types as its player reports it.
 */
export function entryFor(current: GmView | PlayerView | null, chosen: RollInput, actorId?: string): RollEntry {
  if (current === null || "definitions" in current) {
    if (current !== null && actorId !== undefined && atTable(current, actorId))
      return { rollInput: "manual", mayType: true, typeAs: "total", chooses: false };
    return { rollInput: chosen, mayType: true, typeAs: "face", chooses: true };
  }
  const mode = current.playerDice?.d20 ?? "die";
  if (mode === "app") return { rollInput: "digital", mayType: false, typeAs: "face", chooses: false };
  return { rollInput: "manual", mayType: true, typeAs: mode === "total" ? "total" : "face", chooses: false };
}

/** What the table asks of a player's dice, said where a GM would see the choice. */
export function tableDiceLine(entry: RollEntry): string {
  if (!entry.mayType) return "At this table the app rolls players' dice, and only the GM can change that.";
  return entry.typeAs === "total"
    ? "At this table you type the total you rolled, your bonus included. Only the GM can change that."
    : "At this table you type what your d20 shows, and the app adds your bonus. Only the GM can change that.";
}

type TypedField = "face" | "natural" | "naturalRoll" | "attackNatural";
/**
 * The field a typed d20 goes in, for this tab and character: the face where the table takes faces, the total
 * (`rolledTotal`, or `attackRolledTotal` for an attack) where it takes totals. The server checks either. A reroll's
 * face stays a face.
 */
export function typedDie<F extends TypedField>(
  field: F,
  value: number,
  actorId?: string
): Partial<Record<F, number>> &
  (F extends "attackNatural" ? { attackRolledTotal?: number } : { rolledTotal?: number }) {
  const { typeAs } = entryFor(view, rollInput, actorId);
  if (typeAs === "face") return { [field]: value } as never;
  return (field === "attackNatural" ? { attackRolledTotal: value } : { rolledTotal: value }) as never;
}

/** The choice in the "auto"|"manual" shape the shared RollControls widget uses. */
export function rollModeOf(input: RollInput): "auto" | "manual" {
  return input === "manual" ? "manual" : "auto";
}

/** Reactive access, for one character's rolls when `actorId` is given; re-renders when the shared preference or the
 *  table's modes change. */
export function useRollPreference(actorId?: string) {
  const chosen = useSyncExternalStore(
    subscribe,
    () => rollInput,
    () => rollInput
  );
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version
  );
  const attack = useSyncExternalStore(
    subscribe,
    () => sheetAttackMode,
    () => sheetAttackMode
  );
  const entry = entryFor(view, chosen, actorId);
  return {
    ...entry,
    /** Whether this tab may type a damage number (an amended save's damage): the GM always, a player while the
     *  table's damage mode takes typed numbers. */
    mayTypeDamage: view === null || "definitions" in view || (view.playerDice?.damage ?? "app") !== "app",
    sheetAttackMode: attack,
    rollMode: rollModeOf(entry.rollInput),
    setRollInput,
    setSheetAttackMode
  };
}

import { useState } from "react";
import { usePrompt } from "../components/feedback";
import { useRollPreference } from "../dice/roll-preference";
import { command } from "../lib/command";
import { signed } from "./format";

const d20 = (bonus: number) => (bonus === 0 ? "1d20" : `1d20 ${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}`);
const combineBonus = (die: number, bonus: number) =>
  bonus === 0 ? String(die) : `${die} ${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}`;

/**
 * Tap-to-roll from the sheet into the shared dice history. The server allows a player to roll for
 * their own claimed actor. Manual entry records the typed result as a flat roll (constants are valid
 * dice), so it lands in the log like any roll; `bonusMode` "auto" adds the bonus ("15 + 7"), "total"
 * sends it as is.
 */
export function useSheetRolls(actorId: string, onFeedback: (text: string) => void) {
  const { rollInput, bonusMode } = useRollPreference();
  const [rolling, setRolling] = useState(false);
  const { prompt, dialog } = usePrompt();
  const emitRollFormula = (formula: string, purpose: "check" | "save" | "attack" | "damage", label: string) => {
    setRolling(true);
    // The specific label ("Athletics check", "Fireball at 3rd") lets the log show the roll's kind.
    // Capped to the record's 80-char limit.
    void command("dice:roll", { formula, purpose, visibility: "public", label: label.slice(0, 80), actorId }).then(
      (result) => {
        setRolling(false);
        onFeedback(
          result.ok ? `Rolled ${label} (${formula}) - see the dice log.` : (result.message ?? "The roll was rejected.")
        );
      }
    );
  };
  const manualValue = async (title: string, body: string, placeholder: string): Promise<number | null> => {
    const entered = await prompt({ title, body, placeholder, confirmLabel: "Record" });
    if (entered === null) return null;
    const value = Number(entered);
    if (!Number.isInteger(value) || value < -99 || value > 999) {
      onFeedback("Enter a whole number for the roll.");
      return null;
    }
    return value;
  };
  /** A d20 roll with a known bonus: digital rolls 1d20+bonus; manual prompts for the die or total. */
  const rollD20 = async (bonus: number, purpose: "check" | "save" | "attack", label: string) => {
    if (rollInput === "digital") {
      emitRollFormula(d20(bonus), purpose, label);
      return;
    }
    const value = await manualValue(
      `Record ${label}`,
      bonusMode === "auto"
        ? `Enter your d20 result - your ${signed(bonus)} bonus is added automatically.`
        : `Enter your final total (your ${signed(bonus)} bonus already included).`,
      bonusMode === "auto" ? "d20 result" : "final total"
    );
    if (value === null) return;
    emitRollFormula(bonusMode === "auto" ? combineBonus(value, bonus) : String(value), purpose, `${label} (manual)`);
  };
  /** A flat roll (damage): manual mode records the typed total. */
  const rollFlat = async (formula: string, purpose: "damage", label: string) => {
    if (rollInput === "digital") {
      emitRollFormula(formula, purpose, label);
      return;
    }
    const value = await manualValue(`Record ${label}`, `Enter your rolled total for ${formula}.`, "rolled total");
    if (value === null) return;
    emitRollFormula(String(value), purpose, `${label} (manual)`);
  };
  return { rolling, rollD20, rollFlat, dialog };
}

export type SheetRolls = ReturnType<typeof useSheetRolls>;

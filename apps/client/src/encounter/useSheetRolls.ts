import { useState } from "react";
import type { AbilityId, CheckRollOutcome, CheckSubject, RollVisibility } from "@vtt/domain";
import { parseDiceFormula } from "@vtt/rules-5e";
import { usePrompt } from "../components/feedback";
import { useRollPreference } from "../dice/roll-preference";
import { command } from "../lib/command";
import { modeWords } from "./roll-mode-notes";

const ABILITY_WORDS: Readonly<Record<AbilityId, string>> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};

/** A check's result as the sheet says it: the total, the d20, and whatever changed how it was rolled. */
export function checkLine(outcome: CheckRollOutcome): string {
  const verdict = outcome.success === null ? "" : ` vs DC ${outcome.dc} - ${outcome.success ? "success" : "failure"}`;
  const talent = outcome.reliableTalent ? " · Reliable Talent" : "";
  return `${outcome.label}: ${outcome.total} (d20 ${outcome.natural}${outcome.typed ? ", typed" : ""})${verdict}${modeWords(outcome.rollMode)}${talent}.`;
}

/** The constant a formula adds after its dice ("2d6 + 3" gives 3), so a typed sum of the dice can take it. */
function flatPart(formula: string): number {
  try {
    return parseDiceFormula(formula).terms.reduce(
      (sum, term) => (term.kind === "modifier" ? sum + term.sign * term.value : sum),
      0
    );
  } catch {
    return 0;
  }
}

const withBonus = (value: number, bonus: number) =>
  bonus === 0 ? String(value) : `${value} ${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}`;

/**
 * Rolls from the sheet. A check or a save is named, never composed: the server works out its bonus and its Advantage or
 * Disadvantage, so the chip can't disagree with the roll (ADR-0012). A player who rolls physical dice types the face
 * the die shows, and the server adds the rest. The free rolls left here (an attack or damage outside a fight) go to the
 * dice history like the dice panel's.
 */
export function useSheetRolls(actorId: string, onFeedback: (text: string) => void) {
  const { rollMode } = useRollPreference();
  const [rolling, setRolling] = useState(false);
  const [visibility, setVisibility] = useState<RollVisibility>("public");
  // The check this sheet rolled last, which a reroll throws again while it is still the character's latest roll.
  const [lastCheck, setLastCheck] = useState<CheckRollOutcome | null>(null);
  const { prompt, dialog } = usePrompt();

  /** Asks for the face a physical d20 shows; null when cancelled or not a face. */
  const typedFace = async (title: string): Promise<number | null> => {
    const entered = await prompt({
      title,
      body: "Type the number your d20 shows. Your bonus is added for you.",
      placeholder: "1 to 20",
      inputMode: "numeric",
      confirmLabel: "Roll"
    });
    if (entered === null) return null;
    const face = Number(entered.trim());
    if (!Number.isInteger(face) || face < 1 || face > 20) {
      onFeedback("Type the d20's face, a whole number from 1 to 20.");
      return null;
    }
    return face;
  };

  const rollCheck = async (subject: CheckSubject, label: string, findActorId?: string) => {
    const face = rollMode === "manual" ? await typedFace(`Roll ${label}`) : undefined;
    if (face === null) return;
    setRolling(true);
    const result = await command("check:roll", {
      actorId,
      ability: subject.ability,
      ...(subject.skill ? { skill: subject.skill } : {}),
      ...(subject.tool ? { tool: subject.tool } : {}),
      visibility,
      ...(face !== undefined ? { face } : {}),
      ...(findActorId ? { findActorId } : {})
    });
    setRolling(false);
    setLastCheck(result.ok && result.check ? result.check : null);
    if (!result.ok) onFeedback(result.message ?? "The check was refused.");
    else if (result.hiddenFromRoller) onFeedback(`${label}: rolled for the GM's eyes only.`);
    else if (result.check) onFeedback(checkLine(result.check));
  };

  /** Rerolls the check this sheet rolled last: Heroic Inspiration for a player, free for the GM. A typed check is
   *  rerolled with the face the physical reroll shows. */
  const rerollCheck = async () => {
    const face = lastCheck?.typed ? await typedFace("Reroll the check") : undefined;
    if (face === null) return;
    setRolling(true);
    const result = await command("check:reroll", { actorId, ...(face !== undefined ? { face } : {}) });
    setRolling(false);
    if (!result.ok) {
      onFeedback(result.message ?? "The reroll was refused.");
      return;
    }
    setLastCheck(result.check ?? null);
    if (result.hiddenFromRoller) onFeedback("Rerolled for the GM's eyes only.");
    else if (result.check) onFeedback(checkLine(result.check));
  };

  /** A saving throw from the sheet: it answers the matching save the character owes, or rolls a loose one. */
  const rollSave = async (ability: AbilityId) => {
    const name = `${ABILITY_WORDS[ability]} save`;
    const face = rollMode === "manual" ? await typedFace(`Roll a ${name}`) : undefined;
    if (face === null) return;
    setRolling(true);
    const result = await command("save:roll", { actorId, ability, ...(face !== undefined ? { face } : {}) });
    setRolling(false);
    if (!result.ok) {
      onFeedback(result.message ?? "The saving throw was refused.");
      return;
    }
    const outcome = result.outcome;
    if (!outcome) return;
    if (outcome.autoFailed) {
      onFeedback(`${name}: fails automatically.`);
      return;
    }
    // An owed save was answered: it had a DC and its outcome has landed.
    const verdict = "dc" in outcome ? ` vs DC ${outcome.dc} - ${outcome.success ? "success" : "failure"}` : "";
    const natural = outcome.natural !== undefined ? ` (d20 ${outcome.natural})` : "";
    onFeedback(`${name}: ${outcome.total}${natural}${verdict}${modeWords(outcome.rollMode)}.`);
  };

  const emitRollFormula = (formula: string, purpose: "attack" | "damage", label: string) => {
    setRolling(true);
    // The label lets the log show the roll's kind; capped to the record's 80 characters.
    void command("dice:roll", { formula, purpose, visibility, label: label.slice(0, 80), actorId }).then((result) => {
      setRolling(false);
      onFeedback(
        result.ok ? `Rolled ${label} (${formula}) - see the dice log.` : (result.message ?? "The roll was rejected.")
      );
    });
  };

  /** A free attack roll outside a fight: the d20 thrown, or the typed face, with the bonus the sheet shows. */
  const rollD20 = async (bonus: number, purpose: "attack", label: string) => {
    if (rollMode !== "manual") {
      emitRollFormula(`1d20${bonus === 0 ? "" : ` ${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}`}`, purpose, label);
      return;
    }
    const face = await typedFace(`Roll ${label}`);
    if (face !== null) emitRollFormula(withBonus(face, bonus), purpose, `${label} (typed)`);
  };

  /** A free damage roll: thrown, or the dice's typed sum with the formula's own bonus added. */
  const rollFlat = async (formula: string, purpose: "damage", label: string) => {
    if (rollMode !== "manual") {
      emitRollFormula(formula, purpose, label);
      return;
    }
    const bonus = flatPart(formula);
    const entered = await prompt({
      title: `Roll ${label}`,
      body: `Type the sum your dice show for ${formula}.${bonus !== 0 ? " The bonus is added for you." : ""}`,
      placeholder: "dice total",
      inputMode: "numeric",
      confirmLabel: "Roll"
    });
    if (entered === null) return;
    const value = Number(entered.trim());
    if (!Number.isInteger(value) || value < 0 || value > 999) {
      onFeedback("Type the dice's sum as a whole number.");
      return;
    }
    emitRollFormula(withBonus(value, bonus), purpose, `${label} (typed)`);
  };

  return {
    rolling,
    visibility,
    setVisibility,
    lastCheck,
    rollCheck,
    rerollCheck,
    rollSave,
    rollD20,
    rollFlat,
    dialog
  };
}

export type SheetRolls = ReturnType<typeof useSheetRolls>;

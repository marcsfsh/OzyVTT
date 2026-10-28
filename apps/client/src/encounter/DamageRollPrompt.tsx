import { useState } from "react";
import type { PlayerDamageRoll } from "@vtt/domain";
import { Button, Input } from "@vtt/ui";
import { command } from "../lib/command";

/** Each die of the roll, in the order the server reads the faces: "d8", "d8", "d6". */
const diceOf = (roll: Pick<PlayerDamageRoll, "dice">) =>
  roll.dice.flatMap((die) => Array.from({ length: die.count }, () => die.sides));

/** What the prompt asks for, under its title. */
export function damageRollLine(roll: Pick<PlayerDamageRoll, "formula" | "mode" | "fixed">): string {
  if (roll.mode === "total") return `Roll ${roll.formula} and type the total, bonus included.`;
  return roll.fixed === 0
    ? `Roll ${roll.formula} and type what each die shows.`
    : `Roll ${roll.formula} and type what each die shows. The app adds ${roll.fixed}.`;
}

/**
 * A player's damage waiting for their dice (ADR-0043): one field for the total, or one per die. The server checks the
 * numbers against the dice; the GM may type it instead from the Needs you queue.
 */
export function DamageRollPrompt({
  roll,
  onFeedback
}: Readonly<{
  roll: Pick<PlayerDamageRoll, "id" | "dice" | "mode" | "fixed" | "formula">;
  onFeedback: (text: string) => void;
}>) {
  const dice = diceOf(roll);
  const [entries, setEntries] = useState<string[]>(() => (roll.mode === "total" ? [""] : dice.map(() => "")));
  const [busy, setBusy] = useState(false);
  const filled = entries.every((entry) => entry.trim() !== "");
  const send = async () => {
    const numbers = entries.map((entry) => Number(entry.trim()));
    if (numbers.some((value) => !Number.isInteger(value))) {
      onFeedback("Type whole numbers.");
      return;
    }
    setBusy(true);
    const result = await command(
      "damage:report",
      roll.mode === "total" ? { rollId: roll.id, total: numbers[0]! } : { rollId: roll.id, faces: numbers }
    );
    setBusy(false);
    if (!result.ok) onFeedback(result.message ?? "The damage roll was refused.");
  };
  const field = (index: number, label: string) => (
    <Input
      key={index}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={3}
      aria-label={label}
      placeholder={roll.mode === "total" ? "your total" : label}
      value={entries[index] ?? ""}
      disabled={busy}
      onChange={(event) => {
        const next = [...entries];
        next[index] = event.target.value.replace(/[^0-9]/g, "");
        setEntries(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && filled) void send();
      }}
    />
  );
  return (
    <span className="save-prompt-actions damage-roll">
      <span className="save-prompt-manual">
        {roll.mode === "total"
          ? field(0, "Damage total")
          : dice.map((sides, index) => field(index, `d${sides}, die ${index + 1}`))}
      </span>
      <Button type="button" variant="primary" disabled={busy || !filled} onClick={() => void send()}>
        Send the damage
      </Button>
    </span>
  );
}

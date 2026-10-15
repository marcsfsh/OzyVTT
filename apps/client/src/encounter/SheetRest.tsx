import { useState } from "react";
import { Button, Stepper } from "@vtt/ui";
import { command } from "../lib/command";

/**
 * Short and long rest on this character (players on their own, the GM on anyone). A short rest can
 * spend Hit Dice (each heals its roll + Con mod); a long rest restores HP, hit dice, slots, prepared
 * spells and limited uses. The server refuses either during a running encounter.
 */
export function SheetRest({
  actorId,
  hitDice,
  onFeedback
}: Readonly<{
  actorId: string;
  hitDice?: Readonly<{ die: string; maximum: number; remaining: number }> | null;
  onFeedback: (text: string) => void;
}>) {
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const chosen = hitDice ? Math.max(1, Math.min(count, Math.max(1, hitDice.remaining))) : 1;
  const rest = (kind: "short" | "long") => {
    setBusy(true);
    void command("actor:rest", { actorId, kind }).then((result) => {
      setBusy(false);
      onFeedback(result.ok ? `Completed a ${kind} rest.` : (result.message ?? "The rest could not be applied."));
    });
  };
  const spendDice = () => {
    setBusy(true);
    void command("actor:spend-hit-dice", { actorId, count: chosen }).then((result) => {
      setBusy(false);
      onFeedback(
        result.ok
          ? `Spent ${chosen} Hit ${chosen === 1 ? "Die" : "Dice"} - the heal is in the dice log.`
          : (result.message ?? "The Hit Dice could not be spent.")
      );
      if (result.ok) setCount(1);
    });
  };
  return (
    <div className="sheet-rest">
      {hitDice &&
        (hitDice.remaining > 0 ? (
          <div className="sheet-rest-dice" role="group" aria-label="Spend Hit Dice">
            <span
              className="sheet-rest-pool"
              title="Hit Point Dice - spend on a short rest; each die heals its roll plus your Constitution modifier (minimum 1)."
            >
              Hit Dice {hitDice.remaining}/{hitDice.maximum} ({hitDice.die})
            </span>
            <Stepper
              value={chosen}
              onChange={setCount}
              min={1}
              max={hitDice.remaining}
              disabled={busy}
              aria-label="Number of Hit Dice to spend"
            />
            <Button size="sm" disabled={busy} onClick={spendDice}>
              Roll &amp; heal
            </Button>
          </div>
        ) : (
          <span className="sheet-rest-pool empty">Hit Dice 0/{hitDice.maximum} — a long rest restores them.</span>
        ))}
      <div className="sheet-rest-buttons" role="group" aria-label="Rest">
        <Button
          size="sm"
          disabled={busy}
          title="Re-arms short-rest and recharge pools; heal by spending Hit Dice above."
          onClick={() => rest("short")}
        >
          Short rest
        </Button>
        <Button
          size="sm"
          disabled={busy}
          title="Full HP, all spell slots and Hit Dice restored, prepared spells reset, one less Exhaustion level."
          onClick={() => rest("long")}
        >
          Long rest
        </Button>
      </div>
    </div>
  );
}

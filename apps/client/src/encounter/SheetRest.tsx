import { useState } from "react";
import { Button, Stepper } from "@vtt/ui";
import { command } from "../lib/command";

type HitDice = Readonly<{ die: string; maximum: number; remaining: number }>;

/** Spend Hit Point Dice: each heals its roll plus the Constitution modifier (minimum 1). The sheet and the party's
 *  Short Rest prompt share it. */
export function HitDiceSpender({
  actorId,
  hitDice,
  onFeedback
}: Readonly<{ actorId: string; hitDice: HitDice; onFeedback: (text: string) => void }>) {
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const chosen = Math.max(1, Math.min(count, Math.max(1, hitDice.remaining)));
  const spendDice = () => {
    setBusy(true);
    void command("actor:spend-hit-dice", { actorId, count: chosen }).then((result) => {
      setBusy(false);
      onFeedback(
        result.ok
          ? `Spent ${chosen} Hit ${chosen === 1 ? "Die" : "Dice"}. The heal is in the dice log.`
          : (result.message ?? "The Hit Dice could not be spent.")
      );
      if (result.ok) setCount(1);
    });
  };
  if (hitDice.remaining === 0)
    return <span className="sheet-rest-pool empty">Hit Dice 0/{hitDice.maximum} · a Long Rest restores them.</span>;
  return (
    <div className="sheet-rest-dice" role="group" aria-label="Spend Hit Dice">
      <span
        className="sheet-rest-pool"
        title="Hit Point Dice. Spend them on a Short Rest. Each die heals its roll plus your Constitution modifier (minimum 1)."
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
  );
}

/**
 * Rests on this character. The GM gives either rest to anyone. A player takes a Short Rest and asks the GM for a
 * Long Rest, which the GM approves. The server refuses a rest during a running encounter, at 0 Hit Points, and a
 * Long Rest within 16 hours of game time after the last one, and says why.
 */
export function SheetRest({
  actorId,
  role,
  hitDice,
  asked = false,
  onFeedback
}: Readonly<{
  actorId: string;
  role: "gm" | "player";
  hitDice?: HitDice | null;
  /** The player already asked the GM for a Long Rest. */
  asked?: boolean;
  onFeedback: (text: string) => void;
}>) {
  const [busy, setBusy] = useState(false);
  const rest = (kind: "short" | "long") => {
    setBusy(true);
    void command("actor:rest", { actorId, kind }).then((result) => {
      setBusy(false);
      onFeedback(result.ok ? `Completed a ${kind} rest.` : (result.message ?? "The rest could not be applied."));
    });
  };
  const ask = (withdraw: boolean) => {
    setBusy(true);
    void command("rest:ask", { actorId, ...(withdraw ? { withdraw } : {}) }).then((result) => {
      setBusy(false);
      onFeedback(
        result.ok
          ? withdraw
            ? "You took back your Long Rest request."
            : "Asked the GM for a Long Rest."
          : (result.message ?? "The request could not be sent.")
      );
    });
  };
  return (
    <div className="sheet-rest">
      {hitDice && <HitDiceSpender actorId={actorId} hitDice={hitDice} onFeedback={onFeedback} />}
      <div className="sheet-rest-buttons" role="group" aria-label="Rest">
        <Button
          size="sm"
          disabled={busy}
          title="Re-arms short-rest and recharge pools; heal by spending Hit Dice."
          onClick={() => rest("short")}
        >
          Short Rest
        </Button>
        {role === "gm" ? (
          <Button
            size="sm"
            disabled={busy}
            title="Full HP, all spell slots and Hit Dice restored, prepared spells reset, one less Exhaustion level."
            onClick={() => rest("long")}
          >
            Long Rest
          </Button>
        ) : asked ? (
          <>
            <span className="sheet-rest-asked">Long Rest asked</span>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => ask(true)}>
              Take back
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            disabled={busy}
            title="The GM approves it: full HP, all spell slots and Hit Dice back, one less Exhaustion level."
            onClick={() => ask(false)}
          >
            Ask for a Long Rest
          </Button>
        )}
      </div>
    </div>
  );
}

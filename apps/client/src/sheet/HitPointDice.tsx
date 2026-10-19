import { useState } from "react";
import type { HitDiceEntry } from "@vtt/schemas";
import { Button, Stepper } from "@vtt/ui";
import { command } from "../lib/command";

type HitDice = Readonly<{ remaining: number; maximum: number; entries: readonly HitDiceEntry[] }>;

/** "3 of 3 d10 · 1 of 2 d8": what is left of each die size. */
export const hitDiceLine = (hitDice: Pick<HitDice, "entries">) =>
  hitDice.entries.map((entry) => `${entry.remaining} of ${entry.maximum} ${entry.die}`).join(" · ");

/** One die size as boxes, the filled ones still to spend. */
function DieBoxes({ entry }: Readonly<{ entry: HitDiceEntry }>) {
  return (
    <span className="cs-hd-die" role="img" aria-label={`${entry.remaining} of ${entry.maximum} ${entry.die}`}>
      <span className="cs-hd-die-name" aria-hidden="true">
        {entry.die}
      </span>
      <span className="cs-boxes" aria-hidden="true">
        {Array.from({ length: entry.maximum }, (_, index) => (
          <i key={index} className={index < entry.remaining ? "is-on" : undefined} />
        ))}
      </span>
    </span>
  );
}

/**
 * Hit Point Dice per die size, and spending some: each heals its roll plus the Constitution modifier (at least 1). The
 * server picks which dice go, largest first. `boxes` draws each die size as a row of boxes; otherwise one line names
 * what is left of each. The sheet and the party's Short Rest share it. A player spends them only during a Short Rest
 * (`canSpend`); the server checks it.
 */
export function HitPointDice({
  actorId,
  hitDice,
  constitution = null,
  boxes = false,
  canSpend = true,
  onFeedback
}: Readonly<{
  actorId: string;
  hitDice: HitDice;
  /** The Constitution modifier each die adds, when the sheet knows it. */
  constitution?: number | null;
  boxes?: boolean;
  /** Whether Spend is offered now: the GM, or a player whose character is in a Short Rest. */
  canSpend?: boolean;
  onFeedback: (text: string) => void;
}>) {
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const chosen = Math.max(1, Math.min(count, Math.max(1, hitDice.remaining)));
  const spend = () => {
    setBusy(true);
    void command("actor:spend-hit-dice", { actorId, count: chosen }).then((result) => {
      setBusy(false);
      onFeedback(
        result.ok
          ? `Spent ${chosen} Hit Point ${chosen === 1 ? "Die" : "Dice"}. The healing is in the dice log.`
          : (result.message ?? "The Hit Point Dice could not be spent.")
      );
      if (result.ok) setCount(1);
    });
  };
  const each =
    constitution === null
      ? null
      : hitDice.entries
          .map(
            (entry) =>
              `${entry.die}${constitution === 0 ? "" : ` ${constitution > 0 ? "+" : "-"} ${Math.abs(constitution)}`}`
          )
          .join(" or ");
  return (
    <div className="cs-hd" role="group" aria-label="Hit Point Dice">
      <div className="cs-hd-text">
        <span className="cs-eyebrow">Hit Point Dice</span>
        {boxes ? (
          <span className="cs-hd-dice">
            {hitDice.entries.map((entry) => (
              <DieBoxes key={entry.die} entry={entry} />
            ))}
          </span>
        ) : (
          <span className="cs-hd-line">{hitDiceLine(hitDice)}</span>
        )}
        {each && hitDice.remaining > 0 && <span className="cs-sub">Spend on a Short Rest · {each} each</span>}
        {hitDice.remaining === 0 && <span className="cs-sub">None left. A Long Rest gives them back.</span>}
      </div>
      {hitDice.remaining > 0 && canSpend && (
        <div className="cs-hd-spend">
          {/* The phone's boxes spend one die a tap, as a Short Rest spends them one at a time. */}
          {hitDice.remaining > 1 && !boxes && (
            <Stepper
              value={chosen}
              onChange={setCount}
              min={1}
              max={hitDice.remaining}
              disabled={busy}
              aria-label="How many Hit Point Dice to spend"
            />
          )}
          <Button size="sm" disabled={busy} onClick={spend}>
            Spend
          </Button>
        </div>
      )}
    </div>
  );
}

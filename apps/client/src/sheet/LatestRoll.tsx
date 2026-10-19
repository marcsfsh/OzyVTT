import type { PlayerRollRecord } from "@vtt/domain";
import { Button, IconStar } from "@vtt/ui";
import { AnswerOffers } from "../encounter/RollControls";
import type { SheetRolls } from "./useSheetRolls";
import type { SheetState } from "./sheet-model";
import { useSheetRollIds } from "./sheet-roll-ids";

/** The newest roll for this character that a sheet on this page made this session, or null. An initiative roll belongs
 *  to its fight, so it leaves the line once the fight ends. */
export function useSessionRoll(state: SheetState | undefined, actorId: string): PlayerRollRecord | null {
  const mine = useSheetRollIds();
  const rolls = (state?.rolls ?? []) as readonly PlayerRollRecord[];
  const latest =
    [...rolls].reverse().find((roll) => roll.actorId === actorId && mine.has(roll.id) && roll.purpose !== "builder") ??
    null;
  if (latest?.label === "Initiative" && state?.combat.active !== true) return null;
  return latest;
}

/**
 * A roll's result under the sheet's header: what was rolled, the total, the math, and Reroll while the character
 * holds Heroic Inspiration (the GM's Reroll is free). A tap on it opens the dice log.
 */
export function LatestRoll({
  roll,
  role,
  rolls,
  canReroll,
  onOpenLog
}: Readonly<{
  roll: PlayerRollRecord;
  role: "gm" | "player";
  rolls: SheetRolls;
  canReroll: boolean;
  onOpenLog: (() => void) | null;
}>) {
  const faces = roll.dice.map((die) => (die.kept ? String(die.face) : `(${die.face})`)).join(" ");
  const body = (
    <>
      <span className="cs-lastroll-text">
        <strong className="cs-lastroll-label">{roll.label ?? roll.purpose}</strong>
        <span className="cs-lastroll-math">
          {roll.formula}
          {faces ? ` · rolled ${faces}` : ""}
          {roll.typed ? " · typed" : ""}
        </span>
      </span>
      <strong className="cs-lastroll-total">{roll.total}</strong>
    </>
  );
  return (
    <div className="cs-lastroll" role="status" aria-label={`Latest roll: ${roll.label ?? roll.purpose}, ${roll.total}`}>
      {onOpenLog ? (
        <button type="button" className="cs-lastroll-open" title="Open the dice log" onClick={onOpenLog}>
          {body}
        </button>
      ) : (
        <span className="cs-lastroll-open">{body}</span>
      )}
      {canReroll && (
        <Button size="sm" variant="secondary" disabled={rolls.rolling} onClick={() => void rolls.rerollCheck()}>
          {role === "gm" ? (
            "Reroll"
          ) : (
            <>
              <IconStar /> Reroll · Heroic Inspiration
            </>
          )}
        </Button>
      )}
      {rolls.lastCheck?.rollId === roll.id && <CheckAnswers rolls={rolls} />}
    </div>
  );
}

/** What the check this sheet rolled last may still take (Bardic Inspiration, Stroke of Luck), as buttons. */
export function CheckAnswers({ rolls }: Readonly<{ rolls: SheetRolls }>) {
  const check = rolls.lastCheck;
  if (!check?.answers?.length) return null;
  return (
    <span className="save-prompt-confirm cs-lastroll-answers">
      <AnswerOffers
        offers={check.answers}
        typed={check.typed}
        busy={rolls.rolling}
        onAnswer={(answer) => void rolls.answerCheck(answer)}
      />
    </span>
  );
}

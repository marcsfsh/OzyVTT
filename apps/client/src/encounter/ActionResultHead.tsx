import { IconX } from "@vtt/ui";
import type { ReactNode } from "react";
import type { ActionResolution } from "@vtt/domain";
import { clearTargeting, setTargetingResult } from "./targeting";

/** A resolved action's heading: its name, any extra controls, and a close button (which cancels a roll still in preview). */
export function ActionResultHead({ result, children }: Readonly<{ result: ActionResolution; children?: ReactNode }>) {
  return (
    <div className="action-result-head">
      <strong>{result.actionName}</strong>
      <div className="action-result-actions">
        {children}
        <button
          type="button"
          className="secondary action-result-close"
          aria-label={result.preview ? "Cancel roll" : "Dismiss result"}
          onClick={() => {
            setTargetingResult(null);
            if (result.preview) clearTargeting();
          }}
        >
          <IconX />
        </button>
      </div>
    </div>
  );
}

/** The hit points an action restored: the roll, and what each target regained (capped at its maximum). */
export function HealingOutcome({ healing }: Readonly<{ healing: NonNullable<ActionResolution["healing"]> }>) {
  return (
    <p className="action-healing">
      Healing: <strong>{healing.total}</strong>
      {healing.targets.length > 0 &&
        ` - ${healing.targets.map((target) => `${target.targetName} regains ${target.regained}`).join(", ")}`}
    </p>
  );
}

/** Damage split between targets (Magic Missile's darts): each creature's share and the darts behind it, with
 *  whatever the audience can do about it (the GM's Apply, a player's "handed to the GM"). */
export function SplitDamageOutcome({
  split,
  after
}: Readonly<{
  split: NonNullable<ActionResolution["damageByTarget"]>;
  after: (target: NonNullable<ActionResolution["damageByTarget"]>[number]) => ReactNode;
}>) {
  return (
    <ul className="action-split-damage">
      {split.map((target) => (
        <li key={target.targetId} className="action-damage">
          {target.targetName}: <strong>{target.total}</strong> (
          {target.parts.map((part) => `${part.formula} ${part.type} = ${part.total}`).join(" + ")}) {after(target)}
        </li>
      ))}
    </ul>
  );
}

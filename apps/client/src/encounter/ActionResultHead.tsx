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

/** A check action's roll (Hide, Search, Influence): its total and d20, and how it went against a DC when it has one. */
export function CheckOutcome({ check }: Readonly<{ check: NonNullable<ActionResolution["check"]> }>) {
  return (
    <p className="action-outcome">
      {check.skill}: <strong>{check.total}</strong> (d20 {check.naturalRoll})
      {check.dc === null ? "" : ` vs DC ${check.dc} - ${check.success ? "success" : "failure"}`}.
    </p>
  );
}

/** The hit points an action restored: the roll, and what each target regained (capped at its maximum). */
/** "Bran regains 7 hit points. Ysolde regains 0 hit points." for a heal's targets. */
export const regainedText = (targets: NonNullable<ActionResolution["healing"]>["targets"]) =>
  targets
    .map(
      (target) =>
        `${target.targetName} regains ${target.regained} ${target.regained === 1 ? "hit point" : "hit points"}.`
    )
    .join(" ");

export function HealingOutcome({ healing }: Readonly<{ healing: NonNullable<ActionResolution["healing"]> }>) {
  return (
    <p className="action-healing">
      Healing: <strong>{healing.total}</strong>
      {healing.targets.length > 0 &&
        ` - ${healing.targets.map((target) => `${target.targetName} regains ${target.regained}`).join(", ")}`}
    </p>
  );
}

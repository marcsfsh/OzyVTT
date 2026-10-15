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

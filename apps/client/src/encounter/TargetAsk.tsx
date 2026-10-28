import { useState } from "react";
import type { CastShaping } from "@vtt/schemas";
import { Button } from "@vtt/ui";
import { useTargetAsk } from "../dice/roll-preference";
import { command } from "../lib/command";

/** Asks the GM to aim a player's action, at a table where the GM picks targets (ADR-0044), with how it is cast. */
export function askTheGm(
  actorId: string,
  actionId: string,
  cast: Readonly<{ slotLevel?: number | undefined; darts?: number | undefined; shaping?: readonly CastShaping[] }> = {},
  onFeedback: (text: string) => void
) {
  void command("action:ask-target", {
    actorId,
    actionId,
    ...(cast.slotLevel !== undefined ? { slotLevel: cast.slotLevel } : {}),
    ...(cast.darts !== undefined ? { darts: cast.darts } : {}),
    ...(cast.shaping && cast.shaping.length > 0 ? { shaping: cast.shaping.map((entry) => ({ ...entry })) } : {})
  }).then((result) => {
    if (!result.ok) onFeedback(result.message ?? "The GM could not be asked.");
  });
}

/** The action waiting for the GM's aim, above the player's list, with Take back to choose another. */
export function TargetAskNote({ actorId }: Readonly<{ actorId: string }>) {
  const { waiting } = useTargetAsk(actorId);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState("");
  if (!waiting) return null;
  return (
    <div className="save-prompt target-ask" role="status">
      <p className="save-prompt-label">
        <strong>{waiting.actionName}</strong> is waiting for the GM to choose its target.
      </p>
      <span className="save-prompt-confirm">
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void command("action:withdraw-target-ask", { askId: waiting.id }).then((result) => {
              setBusy(false);
              setRefusal(result.ok ? "" : (result.message ?? "It could not be taken back."));
            });
          }}
        >
          Take back
        </Button>
      </span>
      {refusal && <p className="save-prompt-outcome">{refusal}</p>}
    </div>
  );
}

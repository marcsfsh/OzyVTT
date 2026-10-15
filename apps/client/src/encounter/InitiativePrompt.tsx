import { useState } from "react";
import { Button, Input } from "@vtt/ui";
import { command } from "../lib/command";
import { useRollPreference } from "../dice/roll-preference";
import { DieModeButtons, type DieMode } from "./RollControls";

/**
 * A player's "roll for initiative" prompt while their id is in `combat.pendingInitiative`. Digital
 * rolls on the server (with Adv/Disadv); manual takes a typed d20. The server adds the initiative
 * modifier and, in wait mode, starts turns once everyone has rolled.
 */
export function InitiativePrompt({ actorId }: Readonly<{ actorId: string }>) {
  const { rollInput } = useRollPreference();
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");
  const [feedback, setFeedback] = useState("");
  const roll = (payload: { natural?: number; rollMode?: DieMode }) => {
    setBusy(true);
    void command("initiative:roll-self", {
      actorId,
      ...(payload.natural !== undefined ? { natural: payload.natural } : {}),
      ...(payload.rollMode ? { rollMode: payload.rollMode } : {})
    }).then((result) => {
      setBusy(false);
      if (!result.ok) setFeedback(result.message ?? "Initiative could not be rolled.");
    });
  };
  const submitManual = () => {
    const value = Number(manual.trim());
    if (!Number.isInteger(value) || value < 1 || value > 20) {
      setFeedback("Enter your d20 (1-20).");
      return;
    }
    roll({ natural: value });
  };
  return (
    <div className="save-prompt initiative-prompt" role="group" aria-label="Roll your initiative">
      <p className="save-prompt-label">
        <strong>Roll for initiative</strong>
      </p>
      {rollInput === "manual" ? (
        <span className="save-prompt-actions">
          <span className="save-prompt-manual">
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="type your d20"
              aria-label="Initiative d20"
              value={manual}
              disabled={busy}
              onChange={(event) => setManual(event.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && manual.trim() !== "") submitManual();
              }}
            />
            <Button type="button" variant="secondary" disabled={busy || manual.trim() === ""} onClick={submitManual}>
              Set
            </Button>
          </span>
        </span>
      ) : (
        <span className="save-prompt-confirm">
          <DieModeButtons disabled={busy} onPick={(mode) => roll({ rollMode: mode })} />
          <button type="button" className="encounter-primary" disabled={busy} onClick={() => roll({})}>
            Roll initiative
          </button>
        </span>
      )}
      {feedback && (
        <p className="save-prompt-outcome" role="status">
          {feedback}
        </p>
      )}
    </div>
  );
}

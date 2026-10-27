import { useState, type KeyboardEvent } from "react";
import { Button, Input, useToast } from "@vtt/ui";
import { command } from "../lib/command";
import { typedDie, useRollPreference } from "../dice/roll-preference";
import "./prompts.css";

/**
 * Right after a character's initiative is rolled, Heroic Inspiration may reroll its die (SRD "immediately after rolling
 * it"): the server throws one die again and the new score sets the order, or Keep leaves it.
 */
export function InitiativeReroll({ actorId, onDone }: Readonly<{ actorId: string; onDone: () => void }>) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="save-prompt initiative-prompt" role="group" aria-label="Reroll your initiative">
      <span className="save-prompt-confirm">
        <Button type="button" variant="secondary" disabled={busy} onClick={onDone}>
          Keep
        </Button>
        <button
          type="button"
          className="encounter-primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void command("initiative:roll-self", { actorId, reroll: true }).then((result) => {
              setBusy(false);
              if (result.ok) onDone();
              else toast(result.message ?? "Initiative could not be rerolled.", { tone: "error" });
            });
          }}
        >
          Reroll with Heroic Inspiration
        </button>
      </span>
    </div>
  );
}

/**
 * A player's "roll for initiative" prompt while their id is in `combat.pendingInitiative`. Digital rolls on
 * the server, which applies Advantage or Disadvantage from the rules (Surprise, conditions, features); manual
 * takes a typed d20. The server adds the initiative modifier and, in wait mode, starts turns once everyone
 * has rolled.
 */
export function InitiativePrompt({ actorId, onRolled }: Readonly<{ actorId: string; onRolled?: () => void }>) {
  const { rollInput, typeAs } = useRollPreference(actorId);
  const total = typeAs === "total";
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");
  const [feedback, setFeedback] = useState("");
  const roll = (natural?: number) => {
    setBusy(true);
    void command("initiative:roll-self", {
      actorId,
      ...(natural !== undefined ? typedDie("natural", natural, actorId) : {})
    }).then((result) => {
      setBusy(false);
      if (!result.ok) setFeedback(result.message ?? "Initiative could not be rolled.");
      else onRolled?.();
    });
  };
  const submitManual = () => {
    const value = Number(manual.trim());
    if (!Number.isInteger(value) || (total ? value < -50 || value > 100 : value < 1 || value > 20)) {
      setFeedback(total ? "Enter your initiative total." : "Enter your d20 (1-20).");
      return;
    }
    roll(value);
  };
  const field = {
    type: "text",
    inputMode: "numeric" as const,
    value: manual,
    disabled: busy,
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && manual.trim() !== "") submitManual();
    }
  };
  return (
    <div className="save-prompt initiative-prompt" role="group" aria-label="Roll your initiative">
      <p className="save-prompt-label">
        <strong>Roll for initiative</strong>
        {rollInput === "manual" &&
          (total
            ? ". Type the total, your bonus included."
            : ". With Advantage or Disadvantage, roll two d20s and type the one that counts.")}
      </p>
      {rollInput === "manual" ? (
        <span className="save-prompt-actions">
          <span className="save-prompt-manual">
            {total ? (
              <Input
                {...field}
                pattern="-?[0-9]*"
                placeholder="type your total"
                aria-label="Initiative total"
                onChange={(event) => setManual(event.target.value.replace(/[^0-9-]/g, ""))}
              />
            ) : (
              <Input
                {...field}
                pattern="[0-9]*"
                placeholder="type your d20"
                aria-label="Initiative d20"
                onChange={(event) => setManual(event.target.value.replace(/[^0-9]/g, ""))}
              />
            )}
            <Button type="button" variant="secondary" disabled={busy || manual.trim() === ""} onClick={submitManual}>
              Set
            </Button>
          </span>
        </span>
      ) : (
        <span className="save-prompt-confirm">
          <button type="button" className="encounter-primary" disabled={busy} onClick={() => roll()}>
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

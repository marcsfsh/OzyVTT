import { useState } from "react";
import { type PendingDamage } from "@vtt/domain";
import { Button, Input } from "@vtt/ui";
import { command } from "../lib/command";
import "./prompts.css";

/**
 * A player's hit waiting for the GM's Apply (proposal mode, the default): Apply lands the rolled total through the
 * typed-defence pipeline (resistances, dying); Change takes another number first; Dismiss applies nothing.
 */
export function PendingDamagePrompt({
  proposal,
  onFeedback
}: Readonly<{ proposal: PendingDamage; onFeedback: (text: string) => void }>) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(proposal.proposedTotal));
  const typed = Number(amount);
  const changed = editing && amount.trim() !== "" && Number.isFinite(typed) && typed !== proposal.proposedTotal;
  const emit = (apply: boolean) => {
    setBusy(true);
    void command("damage:resolve", {
      proposalId: proposal.id,
      apply,
      ...(apply && changed ? { amount: typed } : {})
    }).then((result) => {
      setBusy(false);
      if (!result.ok) onFeedback(result.message ?? "The damage could not be resolved.");
    });
  };
  const total = changed ? typed : proposal.proposedTotal;
  return (
    <div className="pending-damage" role="group" aria-label={`Apply ${proposal.sourceName}'s ${proposal.actionName}`}>
      {editing && (
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          className="pending-damage-amount"
          aria-label="Damage to apply"
          value={amount}
          disabled={busy}
          onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))}
        />
      )}
      <Button
        size="sm"
        variant="primary"
        disabled={busy || (editing && amount.trim() === "")}
        onClick={() => emit(true)}
      >
        Apply {total}
      </Button>
      {!editing && (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(true)}>
          Change
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={busy} title="Apply nothing" onClick={() => emit(false)}>
        Dismiss
      </Button>
    </div>
  );
}

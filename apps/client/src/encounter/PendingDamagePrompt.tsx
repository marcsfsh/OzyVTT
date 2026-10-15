import { IconX } from "@vtt/ui";
import { useState } from "react";
import { type PendingDamage } from "@vtt/domain";
import { command } from "../lib/command";

/**
 * A player's hit awaiting the GM's Apply (proposal mode, the default). The rolled total is editable;
 * Apply goes through the typed-defence pipeline (resistances, dying); dismissing applies nothing. Rendered under
 * the target's row beside its save/reaction prompts.
 */
export function PendingDamagePrompt({
  proposal,
  onFeedback
}: Readonly<{ proposal: PendingDamage; onFeedback: (text: string) => void }>) {
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState<string | null>(null);
  const emit = (apply: boolean) => {
    setBusy(true);
    const typed = amount !== null && amount.trim() !== "" ? Number(amount) : undefined;
    const override =
      apply && typed !== undefined && Number.isFinite(typed) && typed !== proposal.proposedTotal ? typed : undefined;
    void command("damage:resolve", {
      proposalId: proposal.id,
      apply,
      ...(override !== undefined ? { amount: override } : {})
    }).then((result) => {
      setBusy(false);
      if (!result.ok) onFeedback(result.message ?? "The damage could not be resolved.");
    });
  };
  return (
    <div
      className="save-prompt pending-damage"
      role="group"
      aria-label={`Apply ${proposal.sourceName}'s ${proposal.actionName} to ${proposal.targetName}`}
    >
      <p className="action-save-note">
        <strong>{proposal.sourceName}</strong>'s {proposal.actionName} hit {proposal.targetName} for{" "}
        {proposal.proposedTotal}
        {proposal.critical ? " (crit)" : ""}.
      </p>
      <span className="action-apply-group">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          className="action-damage-edit"
          aria-label="Damage to apply"
          value={amount ?? String(proposal.proposedTotal)}
          disabled={busy}
          onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))}
        />
        <button type="button" className="action-apply" disabled={busy} onClick={() => emit(true)}>
          Apply to {proposal.targetName}
        </button>
        <button
          type="button"
          className="save-prompt-dismiss"
          disabled={busy}
          title="Dismiss without applying"
          aria-label="Dismiss without applying"
          onClick={() => emit(false)}
        >
          <IconX />
        </button>
      </span>
    </div>
  );
}

import { useState } from "react";
import type { CodexStanding } from "@vtt/domain";
import { Alert, Button, Chip, Field, Input, RevealSwitch, cx } from "@vtt/ui";
import { standingApi } from "../api";
import { STANDING_TIERS, clampStanding, standingLabel, standingTier, standingValueLabel } from "../chronicle";

/** The server's bound, so a long reason stops accepting characters and never fails with a raw message. */
export const STANDING_REASON_MAX = 120;

const STEPS = [-10, -5, 5, 10] as const;

/**
 * A faction's standing in its page's side column (F story spec 2.3): the word large with its number and the new one,
 * steps of 10 and 5 either way, the seven words with their ranges (choosing one moves the number to its middle), Why
 * it moved, who sees it, and Record change as the Cup. The column's head (Back and STANDING TOWARD THE PARTY) is the
 * page's. Recording writes once through today's route, then closes the column.
 */
export function StandingColumn({
  gmToken,
  factionPageId,
  standing,
  onSaved,
  onClose
}: Readonly<{
  gmToken: string;
  factionPageId: string;
  /** The stored row, or `null` if this faction has no standing yet (it starts at 0). */
  standing: CodexStanding | null;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}>) {
  const current = standing?.value ?? 0;
  const [next, setNext] = useState(current);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const delta = next - current;
  const tier = standingTier(next);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await standingApi.set(gmToken, factionPageId, next, reason.trim());
      await onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Couldn't save the standing.");
      setBusy(false);
    }
  };

  const reveal = async (revealed: boolean) => {
    setError(null);
    // Its own route: revealing isn't an edit, so no reason and no chronicle record.
    try {
      await standingApi.reveal(gmToken, factionPageId, revealed);
      await onSaved();
    } catch {
      setError("Couldn't change who can see this standing.");
    }
  };

  return (
    <div className="cx-standing">
      {/* The word first, the number after it (rule 3.1); never a bar or a colour alone. */}
      <p className="cx-standing-now" aria-live="polite">
        <span className="cx-standing-word">{standingLabel(next)}</span>{" "}
        <span className="cx-standing-n">
          {delta === 0 ? standingValueLabel(current) : `${standingValueLabel(current)} → ${standingValueLabel(next)}`}
        </span>
      </p>
      <div className="cx-standing-steps" role="group" aria-label="Move it by">
        {STEPS.map((step) => (
          <Chip key={step} disabled={busy} onClick={() => setNext((value) => clampStanding(value + step))}>
            {step > 0 ? `+${step}` : `${step}`}
          </Chip>
        ))}
      </div>
      <ul className="cx-standing-tiers" aria-label="Standing words">
        {STANDING_TIERS.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className={cx("cx-standing-tier interactive", tier === entry.id && "is-on")}
              aria-pressed={tier === entry.id}
              disabled={busy}
              onClick={() => setNext(Math.round((entry.min + entry.max) / 2))}
            >
              <span>{entry.label}</span>
              <span className="cx-standing-range">{`${standingValueLabel(entry.min)} to ${standingValueLabel(entry.max)}`}</span>
            </button>
          </li>
        ))}
      </ul>
      <Field
        label="Why it moved"
        htmlFor="standing-reason"
        help="Optional. Players never see the reason. It is recorded on the Journal alongside the change."
      >
        <Input
          id="standing-reason"
          maxLength={STANDING_REASON_MAX}
          value={reason}
          disabled={busy}
          placeholder="Returned the Duke's signet"
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {standing ? (
        <RevealSwitch
          revealed={standing.revealedToPlayers}
          onChange={reveal}
          ariaLabel="Show this standing to players"
        />
      ) : (
        <span className="cx-hint">Record a change first. There is nothing to show players yet.</span>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {delta === 0 && <p className="cx-hint">Move it to record a change. A change of zero records nothing.</p>}
      <Button variant="primary" className="cx-standing-cup" disabled={busy || delta === 0} onClick={() => void save()}>
        {busy ? "Saving…" : "Record change"}
      </Button>
    </div>
  );
}

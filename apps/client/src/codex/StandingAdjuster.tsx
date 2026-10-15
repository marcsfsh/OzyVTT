import { useState } from "react";
import { Alert, Badge, Button, Field, Input, Meter, Modal, RevealSwitch } from "@vtt/ui";
import type { CodexStanding } from "@vtt/domain";
import { standingApi } from "./api";
import {
  STANDING_MAX,
  STANDING_METER_MAX,
  STANDING_MIN,
  clampStanding,
  standingLabel,
  standingMeterTone,
  standingMeterValue,
  standingTone,
  standingValueLabel
} from "./chronicle";

/**
 * The GM's dialog for moving a faction's standing, with an optional reason. Lives in the shell, not on the
 * dashboard card, because players render `CampaignHome` too; the card only takes `onAdjustStanding`. Each
 * save writes the value and its `kind='standing'` chronicle record in one server transaction.
 */
/** The server's bound, so a long reason stops accepting characters instead of failing with a raw message. */
const STANDING_REASON_MAX = 120;

export function StandingAdjuster({
  gmToken,
  factionPageId,
  factionName,
  standing,
  onSaved,
  onClose
}: Readonly<{
  gmToken: string;
  factionPageId: string;
  factionName: string;
  /** The stored row, or `null` if this faction has no standing yet (it starts at 0). */
  standing: CodexStanding | null;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}>) {
  const current = standing?.value ?? 0;
  const [value, setValue] = useState(String(current));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = clampStanding(Number(value) || 0);
  const delta = next - current;
  /** The reason is optional (as on the server); only an unchanged value blocks saving, and the hint says so. */
  const canSave = delta !== 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await standingApi.set(gmToken, factionPageId, next, reason.trim());
      await onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Couldn't save the standing.");
    } finally {
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
    <Modal
      open
      onClose={onClose}
      title={`Standing with ${factionName}`}
      size="sm"
      ariaLabel={`Standing with ${factionName}`}
    >
      <div className="codex-standing-adjuster">
        {/* The tier word and signed value carry the meaning; the bar is aria-hidden because it would announce shifted values. */}
        <div className="codex-standing-preview">
          <Badge tone={standingTone(next)}>{standingLabel(next)}</Badge>
          <span className="codex-campaign-standingvalue">{standingValueLabel(next)}</span>
          {delta !== 0 && (
            <span className="codex-standing-delta">
              {delta > 0 ? `up ${delta}` : `down ${Math.abs(delta)}`} from {standingValueLabel(current)}
            </span>
          )}
        </div>
        <div aria-hidden="true">
          <Meter value={standingMeterValue(next)} max={STANDING_METER_MAX} tone={standingMeterTone(next)} />
        </div>

        <Field
          label="Standing"
          htmlFor="standing-value"
          help={`Signed, ${STANDING_MIN} to +${STANDING_MAX}. Below zero the faction is against the party.`}
        >
          <Input
            id="standing-value"
            type="number"
            inputMode="numeric"
            min={STANDING_MIN}
            max={STANDING_MAX}
            disabled={busy}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
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

        {error && <Alert tone="danger">{error}</Alert>}

        <div className="codex-composer-foot">
          {/* Hidden by default and shared by the usual switch. Disabled until the row exists. */}
          {standing ? (
            <RevealSwitch
              revealed={standing.revealedToPlayers}
              onChange={reveal}
              ariaLabel="Show this standing to players"
            />
          ) : (
            <span className="codex-inspector-hint">Record a change first. There is nothing to show players yet.</span>
          )}
          {/* A disabled control says why. */}
          {delta === 0 && (
            <p className="codex-composer-hint">
              Type a different number to record a change. A change of zero records nothing.
            </p>
          )}
          <Button variant="primary" disabled={busy || !canSave} onClick={save}>
            {busy ? "Saving…" : "Record change"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

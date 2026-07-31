import { useState } from "react";
import { Alert, Badge, Button, Field, Input, Meter, Modal } from "@vtt/ui";
import { standingApi, type CodexStanding } from "./api";
import { STANDING_MAX, STANDING_METER_MAX, STANDING_MIN, clampStanding, standingLabel, standingMeterTone, standingMeterValue, standingTone, standingValueLabel } from "./chronicle";
import { RevealSwitch } from "./SecretMarkers";

/**
 * M12 / CT-6 — where the GM moves a faction's standing, and says why.
 *
 * **GM-only, and it lives here rather than on the dashboard card deliberately.** `CampaignHome` is
 * rendered by the player's Codex as well as the GM's; a write control inside it would be one careless
 * render from a player surface. The card takes a capability callback (`onAdjustStanding`) and the GM's
 * workspace answers it with this.
 *
 * Composed entirely from `@vtt/ui` primitives (R9) — `Modal`, `Field`, `Input`, `Button`, `Badge`,
 * `Meter`, plus the Codex's own shared `RevealSwitch`. Nothing new is hand-rolled here, on the precedent
 * `CalendarEditor` set: a Codex-local composition of primitives is not a new primitive.
 *
 * The REASON is required, and that is the point of the record. Every set writes two things in one
 * server-side transaction — the new value, and the `kind='standing'` chronicle record carrying
 * `{ factionPageId, delta, reason }` — so a standing that moved without the timeline saying why is not a
 * state this client can produce.
 */
/**
 * The server's bound, stated here so an over-long reason is a field that stops accepting characters rather
 * than a raw "String must contain at most 120 character(s)" in the dialog's error strip. The milestone
 * composer already does this with `MILESTONE_REASON_MAX`; this input was the one that did not.
 */
const STANDING_REASON_MAX = 120;

export function StandingAdjuster({ gmToken, factionPageId, factionName, standing, onSaved, onClose }: Readonly<{
  gmToken: string;
  factionPageId: string;
  factionName: string;
  /** The stored row, or `null` for a faction that has never had a standing recorded (it starts at 0). */
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
  // Nothing to record when nothing moved: a chronicle row saying "unchanged, because…" is a record of
  // the GM having opened a dialog, not of anything that happened in the world.
  /**
   * Only the thing that makes the change meaningless blocks the save: a value that has not moved.
   *
   * `reason` was required here while `StandingSetSchema` on the server makes it OPTIONAL and says why —
   * "the GM adjusting a standing mid-session should not be blocked on typing a sentence." The client won
   * that argument silently, and the button simply sat inert: the reason requirement is spelled out in the
   * field help, the value-must-change requirement was stated nowhere at all. Found by the final QA pass.
   *
   * The remaining rule earns its keep — recording a change of zero would write a chronicle row saying
   * nothing happened — and unlike before, it now SAYS so, the way the deadline composer does.
   */
  const canSave = delta !== 0;

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await standingApi.set(gmToken, factionPageId, next, reason.trim());
      await onSaved();
      onClose();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Couldn't save the standing."); }
    finally { setBusy(false); }
  };

  const reveal = async (revealed: boolean) => {
    setError(null);
    // Its own route, exactly as every other record's reveal is: sharing where the party stands is not an
    // edit to the number, so it carries no reason and writes no chronicle record.
    try { await standingApi.reveal(gmToken, factionPageId, revealed); await onSaved(); }
    catch { setError("Couldn't change who can see this standing."); }
  };

  return (
    <Modal open onClose={onClose} title={`Standing — ${factionName}`} size="sm" ariaLabel={`Standing with ${factionName}`}>
      <div className="codex-standing-adjuster">
        {/* R2: the tier is a WORD and the value carries its sign. The bar is decoration — `aria-hidden`
            for the reason the dashboard card's is: its meaning is already in the two lines above it, and
            its own `progressbar` value would announce the mapped pair rather than the real number. */}
        <div className="codex-standing-preview">
          <Badge tone={standingTone(next)}>{standingLabel(next)}</Badge>
          <span className="codex-campaign-standingvalue">{standingValueLabel(next)}</span>
          {delta !== 0 && <span className="codex-standing-delta">{delta > 0 ? `up ${delta}` : `down ${Math.abs(delta)}`} from {standingValueLabel(current)}</span>}
        </div>
        <div aria-hidden="true">
          <Meter value={standingMeterValue(next)} max={STANDING_METER_MAX} tone={standingMeterTone(next)} />
        </div>

        <Field label="Standing" htmlFor="standing-value" help={`Signed, ${STANDING_MIN} to +${STANDING_MAX}. Below zero the faction is against the party.`}>
          <Input id="standing-value" type="number" inputMode="numeric" min={STANDING_MIN} max={STANDING_MAX} disabled={busy}
            value={value} onChange={(event) => setValue(event.target.value)} />
        </Field>
        <Field label="Why it moved" htmlFor="standing-reason" help="Optional — players never see the reason. Recorded on the Journal with the change, so a standing that moved has something to explain it later.">
          <Input id="standing-reason" maxLength={STANDING_REASON_MAX} value={reason} disabled={busy} placeholder="Returned the Duke's signet"
            onChange={(event) => setReason(event.target.value)} />
        </Field>

        {error && <Alert tone="danger">{error}</Alert>}

        <div className="codex-composer-foot">
          {/* P2 / O-2: standing is secret by default and shared by the same switch every other record
              uses. Disabled until the row exists — there is nothing to reveal before the first change. */}
          {standing
            ? <RevealSwitch revealed={standing.revealedToPlayers} onChange={reveal} ariaLabel="Show this standing to players" />
            : <span className="codex-inspector-hint">Record a change first — there is nothing to show players yet.</span>}
          {/* R: a disabled control must say why. The deadline composer's hint is the precedent. */}
          {delta === 0 && <p className="codex-composer-hint">Type a different number to record a change — a change of zero would say nothing happened.</p>}
          <Button variant="primary" disabled={busy || !canSave} onClick={save}>{busy ? "Saving…" : "Record change"}</Button>
        </div>
      </div>
    </Modal>
  );
}

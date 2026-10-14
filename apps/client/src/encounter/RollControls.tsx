import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Input } from "@vtt/ui";

export type DieMode = "advantage" | "disadvantage" | "normal";

/**
 * The dice-roll interaction shared by every roll prompt (saving throws, death saves, ...):
 *   - auto mode rolls as soon as the prompt appears, then shows the result to confirm;
 *   - manual mode waits for a Roll click, or a typed total for a physical die;
 *   - once rolled, Adv/Disadv re-roll the d20 (2d20kh1 / 2d20kl1) and Confirm applies the result.
 *     Re-roll discards the preview.
 * The parent owns the emits and preview state; this owns the manual field and the roll-on-appear
 * trigger. Renders the action row only.
 */
export function RollControls({
  rollMode,
  autoRoll,
  busy,
  rolled,
  currentMode,
  supportsAdvantage = true,
  manualPlaceholder = "or type the total",
  manualLabel = "Rolled total",
  manualMin = -20,
  manualMax = 60,
  onRoll,
  onManual,
  onConfirm,
  onReroll,
  onDismiss,
  onInvalidManual,
  summary,
  extraActions,
  confirmLabel = "Confirm",
  rerollLabel = "Re-roll"
}: Readonly<{
  /** Drives whether the prompt rolls itself as soon as it appears. */
  rollMode: "auto" | "manual";
  /** Overrides the auto-roll-on-appear decision (default: `rollMode === "auto"`). Death saves suppress
   * it off-turn, rolling only once the dying creature's turn comes up. */
  autoRoll?: boolean;
  busy: boolean;
  /** Whether a rolled-but-unapplied preview exists; the parent flips this from its outcome state. */
  rolled: boolean;
  currentMode?: DieMode;
  /** d20 rolls offer Adv/Disadv; flat rolls (raw damage) hide them. */
  supportsAdvantage?: boolean;
  manualPlaceholder?: string;
  manualLabel?: string;
  manualMin?: number;
  manualMax?: number;
  onRoll: (mode?: DieMode) => void;
  onManual: (total: number) => void;
  onConfirm: () => void;
  onReroll: () => void;
  onDismiss?: () => void;
  onInvalidManual?: (message: string) => void;
  /** The rolled-phase result line (caller-specific: DC pass/fail, death-save pips, ...). */
  summary?: ReactNode;
  /** Extra rolled-phase buttons after Confirm (e.g. Legendary Resistance). */
  extraActions?: ReactNode;
  confirmLabel?: string;
  rerollLabel?: string;
}>) {
  const [manualTotal, setManualTotal] = useState("");
  const autoRolled = useRef(false);
  const shouldAutoRoll = autoRoll ?? rollMode === "auto";
  // In auto mode roll as soon as the prompt appears (still a preview to confirm). One auto-roll per mount.
  useEffect(() => {
    if (shouldAutoRoll && !rolled && !autoRolled.current) {
      autoRolled.current = true;
      onRoll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoRoll, rolled]);
  const submitManual = () => {
    const total = Number(manualTotal.trim());
    if (!Number.isInteger(total) || total < manualMin || total > manualMax) {
      onInvalidManual?.(`Enter the rolled total (${manualMin} to ${manualMax}).`);
      return;
    }
    onManual(total);
  };
  if (rolled) {
    return (
      <span className="save-prompt-confirm">
        {summary}
        {supportsAdvantage && (
          <>
            <button
              type="button"
              className={`save-die-mode${currentMode === "advantage" ? " active" : ""}`}
              disabled={busy}
              title="Roll two d20s and keep the higher"
              onClick={() => onRoll("advantage")}
            >
              Adv
            </button>
            <button
              type="button"
              className={`save-die-mode${currentMode === "disadvantage" ? " active" : ""}`}
              disabled={busy}
              title="Roll two d20s and keep the lower"
              onClick={() => onRoll("disadvantage")}
            >
              Disadv
            </button>
          </>
        )}
        <button type="button" className="encounter-primary" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
        {extraActions}
        <Button type="button" variant="secondary" disabled={busy} onClick={onReroll}>
          {rerollLabel}
        </Button>
      </span>
    );
  }
  return (
    <span className="save-prompt-actions">
      <button type="button" className="save-prompt-roll" disabled={busy} onClick={() => onRoll()}>
        Roll
      </button>
      <span className="save-prompt-manual">
        <Input
          type="text"
          inputMode="numeric"
          pattern="-?[0-9]*"
          placeholder={manualPlaceholder}
          aria-label={manualLabel}
          value={manualTotal}
          onChange={(event) => setManualTotal(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && manualTotal.trim() !== "") submitManual();
          }}
        />
        <Button type="button" variant="secondary" disabled={busy || manualTotal.trim() === ""} onClick={submitManual}>
          Apply
        </Button>
      </span>
      {onDismiss && (
        <button
          type="button"
          className="save-prompt-dismiss"
          disabled={busy}
          title="Dismiss without resolving"
          onClick={onDismiss}
        >
          ✕
        </button>
      )}
    </span>
  );
}

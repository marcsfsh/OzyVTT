import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { Button, Input, IconX } from "@vtt/ui";
import { useRollPreference } from "../dice/roll-preference";

export type DieMode = "advantage" | "disadvantage" | "normal";

/**
 * The GM's call to roll with Advantage or Disadvantage, whatever the rules count. Players never get it: the rules
 * decide their mode, and the result says why. Pressing the chosen one again goes back to the rules' count.
 */
export function ForceModeButtons({
  current,
  disabled,
  onPick
}: Readonly<{ current?: DieMode; disabled: boolean; onPick: (mode: DieMode) => void }>) {
  const option = (mode: "advantage" | "disadvantage", label: string, title: string) => (
    <button
      type="button"
      className={`save-die-mode${current === mode ? " active" : ""}`}
      aria-pressed={current === mode}
      disabled={disabled}
      title={title}
      onClick={() => onPick(current === mode ? "normal" : mode)}
    >
      {label}
    </button>
  );
  return (
    <span className="roll-force" role="group" aria-label="GM's choice">
      {option("advantage", "Adv", "Your choice as GM: roll two d20s and keep the higher")}
      {option("disadvantage", "Disadv", "Your choice as GM: roll two d20s and keep the lower")}
    </span>
  );
}

/** A typed die's face, 1 to 20, or null with the reason said. */
export function readFace(entered: string, onInvalid?: (message: string) => void): number | null {
  const face = Number(entered.trim());
  if (!Number.isInteger(face) || face < 1 || face > 20) {
    onInvalid?.("Type the d20's face, a whole number from 1 to 20.");
    return null;
  }
  return face;
}

/** A field for the face a physical d20 shows, with the button that sends it. */
export function FaceEntry({
  label,
  placeholder = "or type your d20",
  action = "Use",
  busy,
  onFace,
  onInvalid
}: Readonly<{
  label: string;
  placeholder?: string;
  action?: string;
  busy: boolean;
  onFace: (face: number) => void;
  onInvalid?: (message: string) => void;
}>) {
  const [entry, setEntry] = useState("");
  const submit = () => {
    const face = readFace(entry, onInvalid);
    if (face === null) return;
    setEntry("");
    onFace(face);
  };
  return (
    <span className="save-prompt-manual">
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        placeholder={placeholder}
        aria-label={label}
        value={entry}
        disabled={busy}
        onChange={(event) => setEntry(event.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={(event) => {
          if (event.key === "Enter" && entry.trim() !== "") submit();
        }}
      />
      <Button type="button" variant="secondary" disabled={busy || entry.trim() === ""} onClick={submit}>
        {action}
      </Button>
    </span>
  );
}

/**
 * Throwing a shown die again: the GM's free reroll, or a player's Heroic Inspiration. A die typed from a physical die
 * is rerolled by typing what the reroll shows.
 */
export function RerollControl({
  viewer,
  typed,
  busy,
  onReroll,
  onInvalid
}: Readonly<{
  viewer: "gm" | "player";
  typed: boolean;
  busy: boolean;
  onReroll: (face?: number) => void;
  onInvalid?: (message: string) => void;
}>) {
  const label = viewer === "gm" ? "Reroll" : "Reroll · Heroic Inspiration";
  if (typed && viewer === "player")
    return (
      <FaceEntry
        label="The rerolled d20"
        placeholder="reroll's d20"
        action={label}
        busy={busy}
        onFace={(face) => onReroll(face)}
        onInvalid={onInvalid}
      />
    );
  return (
    <Button type="button" variant="secondary" disabled={busy} onClick={() => onReroll()}>
      {label}
    </Button>
  );
}

/**
 * The dice-roll interaction shared by every roll prompt (saving throws, death saves, ...). The server throws the die
 * and holds it, so a second look shows the same die and Confirm applies it (ADR-0012):
 *   - auto mode rolls as soon as the prompt appears, then shows the result to confirm;
 *   - manual mode waits for a Roll tap, or for the face a physical d20 shows, while the table lets this browser type;
 *   - once rolled, the GM may force Advantage or Disadvantage and reroll freely; a player rerolls only by spending
 *     Heroic Inspiration.
 * The parent owns the emits and preview state; this owns the typed field and the roll-on-appear trigger. Renders the
 * action row only.
 */
export function RollControls({
  rollMode,
  autoRoll,
  busy,
  rolled,
  viewer,
  inspired = false,
  typed = false,
  rerollable = true,
  currentMode,
  faceLabel = "Your d20",
  rollLabel = "Roll",
  onRoll,
  onTyped,
  onConfirm,
  onReroll,
  onForce,
  onDismiss,
  onInvalidFace,
  summary,
  extraActions
}: Readonly<{
  /** Drives whether the prompt rolls itself as soon as it appears. */
  rollMode: "auto" | "manual";
  /** Overrides the auto-roll-on-appear decision (default: `rollMode === "auto"`). Death saves suppress
   * it off-turn, rolling only once the dying creature's turn comes up. */
  autoRoll?: boolean;
  busy: boolean;
  /** Whether a rolled-but-unapplied preview exists; the parent flips this from its outcome state. */
  rolled: boolean;
  /** The GM may force a mode and reroll freely; a player rerolls with Heroic Inspiration. */
  viewer: "gm" | "player";
  /** The roller holds Heroic Inspiration. */
  inspired?: boolean;
  /** The shown die was typed from a physical die, so its reroll is typed too. */
  typed?: boolean;
  /** False when no die decided the shown result (a save failed without a roll). */
  rerollable?: boolean;
  /** The GM's forced mode, marked on its buttons. */
  currentMode?: DieMode;
  faceLabel?: string;
  /** What the roll button says ("Roll death save"); "Roll" when absent. */
  rollLabel?: ReactNode;
  onRoll: () => void;
  /** A typed d20: the face a physical die shows. */
  onTyped: (face: number) => void;
  onConfirm: () => void;
  /** Throws the shown die again; `face` is a typed reroll's. */
  onReroll: (face?: number) => void;
  /** The GM's forced mode for the shown roll. */
  onForce: (mode: DieMode) => void;
  onDismiss?: () => void;
  onInvalidFace?: (message: string) => void;
  /** The rolled-phase result line (caller-specific: DC pass/fail, death-save pips, ...). */
  summary?: ReactNode;
  /** Extra rolled-phase buttons after Confirm (e.g. Legendary Resistance). */
  extraActions?: ReactNode;
}>) {
  const { mayType } = useRollPreference();
  const autoRolled = useRef(false);
  const shouldAutoRoll = autoRoll ?? rollMode === "auto";
  // In auto mode roll as soon as the prompt appears (still a preview to confirm). One auto-roll per mount.
  const rollOnAppear = useEffectEvent(() => onRoll());
  useEffect(() => {
    if (shouldAutoRoll && !rolled && !autoRolled.current) {
      autoRolled.current = true;
      rollOnAppear();
    }
  }, [shouldAutoRoll, rolled]);
  if (rolled) {
    return (
      <span className="save-prompt-confirm">
        {summary}
        {viewer === "gm" && <ForceModeButtons current={currentMode} disabled={busy} onPick={onForce} />}
        <button type="button" className="encounter-primary" disabled={busy} onClick={onConfirm}>
          Confirm
        </button>
        {extraActions}
        {rerollable && (viewer === "gm" || inspired) && (
          <RerollControl viewer={viewer} typed={typed} busy={busy} onReroll={onReroll} onInvalid={onInvalidFace} />
        )}
      </span>
    );
  }
  return (
    <span className="save-prompt-actions">
      <button type="button" className="save-prompt-roll" disabled={busy} onClick={() => onRoll()}>
        {rollLabel}
      </button>
      {mayType && <FaceEntry label={faceLabel} busy={busy} onFace={onTyped} onInvalid={onInvalidFace} />}
      {onDismiss && (
        <button
          type="button"
          className="save-prompt-dismiss"
          disabled={busy}
          title="Dismiss without resolving"
          aria-label="Dismiss without resolving"
          onClick={onDismiss}
        >
          <IconX />
        </button>
      )}
    </span>
  );
}

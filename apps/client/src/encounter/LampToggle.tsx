import { Lamp, type LampKind } from "@vtt/ui";
import "./lamp-toggle.css";

/**
 * One turn lamp as a toggle: lit while the resource is there to use, and a press marks it spent or gives it back as
 * the server records it. Pressed means spent.
 */
export function LampToggle({
  kind,
  label,
  used,
  lit = !used,
  disabled,
  title,
  onToggle
}: Readonly<{
  kind: LampKind;
  label: string;
  used: boolean;
  /** Whether the lamp shows the resource ready; an Action off-turn is neither spent nor ready. */
  lit?: boolean;
  disabled: boolean;
  title?: string;
  onToggle: () => void;
}>) {
  return (
    <button
      type="button"
      className="lamp-toggle"
      aria-label={label}
      aria-pressed={used}
      disabled={disabled}
      title={title}
      onClick={onToggle}
    >
      <Lamp kind={kind} lit={lit} label={label} unavailableReason={used ? "Used this turn" : "Not yet"} />
    </button>
  );
}

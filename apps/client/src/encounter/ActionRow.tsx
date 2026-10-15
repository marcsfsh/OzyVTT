import type { ContentActionSummary } from "@vtt/domain";

/**
 * A rollable action as a button: its name on one line, its mechanics as bullets beneath, and an
 * availability hint when the rules assistant has one. The server still decides; the row stays tappable.
 */
export function ActionRow({
  action,
  parts,
  note,
  hint,
  disabled,
  onUse
}: Readonly<{
  action: ContentActionSummary;
  parts: readonly string[];
  /** Shown instead of the bullets when the action has no mechanics to list. */
  note: string;
  hint?: string | null;
  disabled: boolean;
  onUse: () => void;
}>) {
  return (
    <button
      type="button"
      className={`action-row${hint ? " action-row-hinted" : ""}`}
      disabled={disabled}
      title={action.description}
      onClick={onUse}
    >
      <strong className="action-row-name">{action.name}</strong>
      {parts.length > 0 ? (
        <ul className="action-row-summary">
          {parts.map((part) => (
            <li key={part}>{part}</li>
          ))}
        </ul>
      ) : (
        <span className="action-row-summary-note">{note}</span>
      )}
      {hint ? <span className="action-hint">{hint}</span> : null}
    </button>
  );
}

import type { ReactNode } from "react";
import { Button } from "@vtt/ui";
import "./confirm-row.css";

/**
 * A question that needs a yes before anything happens (a rules override, a history rewrite): the
 * sentence, Cancel, and the confirming button. Inline, so the table stays live behind it.
 */
export function ConfirmRow({
  ariaLabel,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
  children
}: Readonly<{
  ariaLabel: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
}>) {
  return (
    <div className="confirm-row" role="alertdialog" aria-label={ariaLabel}>
      <span>{children}</span>
      <div className="confirm-row-actions">
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <button type="button" className="encounter-primary" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

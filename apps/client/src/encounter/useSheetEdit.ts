import { useState } from "react";
import { command, type CommandEvent, type Reply } from "../lib/command";

/** Sends one edit to the sheet's character and resolves with the server's reply. */
export type SheetEdit = <E extends CommandEvent>(
  event: E,
  payload: Parameters<typeof command<E>>[1]
) => Promise<Reply<E>>;

/**
 * The sheet's edits share one busy flag, so the whole sheet waits for the server's answer before the
 * next change, and a refusal lands on the sheet's feedback line.
 */
export function useSheetEdit(onFeedback: (text: string) => void): Readonly<{ busy: boolean; edit: SheetEdit }> {
  const [busy, setBusy] = useState(false);
  const edit: SheetEdit = (event, payload) => {
    setBusy(true);
    return command(event, payload).then((result) => {
      setBusy(false);
      const outcome: { ok: boolean; message?: string } = result;
      if (!outcome.ok) onFeedback(outcome.message ?? "That change was rejected.");
      return result;
    });
  };
  return { busy, edit };
}

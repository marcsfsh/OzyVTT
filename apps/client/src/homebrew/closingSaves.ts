/**
 * The save an editor sends as it closes, by record id. Reading the record again waits for it, so reopening a record
 * whose last edit is still on its way never starts from a copy without that edit.
 */
const closing = new Map<string, Promise<void>>();

export function trackClosingSave(id: string, save: Promise<void>): void {
  const settled = save.catch(() => undefined);
  closing.set(id, settled);
  void settled.then(() => {
    if (closing.get(id) === settled) closing.delete(id);
  });
}

/** Settles once the save the record's last editor sent as it closed has landed or failed; at once when there is none. */
export function closingSave(id: string): Promise<void> {
  return closing.get(id) ?? Promise.resolve();
}

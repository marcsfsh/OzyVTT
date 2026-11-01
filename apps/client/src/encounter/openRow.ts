/**
 * A request to open a creature's row in the GM's order with its tools under it (C2 spec 2.2): the token's menu sends
 * it, and the GM's panel answers by turning to Encounter and opening the row. Kept apart from both, so neither imports
 * the other.
 */
const listeners = new Set<(actorId: string) => void>();

export function onOpenRow(listener: (actorId: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openRow(actorId: string): void {
  for (const listener of listeners) listener(actorId);
}

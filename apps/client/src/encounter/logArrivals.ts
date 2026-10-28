import type { CombatLogEntry } from "@vtt/domain";

/**
 * New log lines as they arrive, for the light around the log (ADR-0045, group 13). Kept apart from the log's store,
 * which talks to the socket as it loads, so the panel and the composer can listen without loading the log.
 */
const listeners = new Set<(entry: CombatLogEntry) => void>();

export function onLogEntry(listener: (entry: CombatLogEntry) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function announceLogEntry(entry: CombatLogEntry): void {
  for (const listener of listeners) listener(entry);
}

/** When this device last sent a chat line, so its own line lights from the side the Send button is on. */
let sentAt = -Infinity;
const SENT_WINDOW_MS = 3000;

export function noteChatSent(): void {
  sentAt = performance.now();
}

export function chatSentRecently(): boolean {
  return performance.now() - sentAt < SENT_WINDOW_MS;
}

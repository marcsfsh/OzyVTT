import { useEffect, useSyncExternalStore } from "react";
import { apiRequest } from "../lib/api";

/** What the table screen is showing, as the GM's presentation read reports it. */
export type Presentation = Readonly<{
  revision: number;
  enabled: boolean;
  pausedByGm?: boolean;
  activeMap: Readonly<{ assetId: string }> | null;
}>;

export const PRESENTATION = "/api/v1/viewer/presentation";

/**
 * One poll of the presentation for the whole page, however many controls show it (the top bar's lamp, the table's
 * TV control): a 5 second interval while anything listens, and a fresh read on demand after a command.
 */
let current: Presentation | null = null;
let token: string | null = null;
let timer: number | null = null;
const listeners = new Set<() => void>();

async function read(): Promise<void> {
  if (!token) return;
  try {
    const data = await apiRequest<{ presentation: Presentation }>(PRESENTATION, { token });
    current = data.presentation;
    for (const listener of [...listeners]) listener();
  } catch {
    /* the last good read stands; the next poll tries again */
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) timer = window.setInterval(() => void read(), 5_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

/** The table screen's presentation for this GM, kept fresh; null until the first read lands. */
export function usePresentation(gmToken: string): { presentation: Presentation | null; refresh: () => Promise<void> } {
  useEffect(() => {
    if (token !== gmToken) {
      token = gmToken;
      current = null;
    }
    void read();
  }, [gmToken]);
  const presentation = useSyncExternalStore(
    subscribe,
    () => current,
    () => current
  );
  return { presentation, refresh: read };
}

/** Whether the table screen is showing a map right now: on, with a map, and not paused. */
export function tableScreenOn(presentation: Presentation | null): boolean {
  return Boolean(presentation?.enabled && presentation.activeMap && !presentation.pausedByGm);
}

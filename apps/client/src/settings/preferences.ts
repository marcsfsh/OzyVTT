import { useSyncExternalStore } from "react";

/**
 * Device-local settings — the ones that are genuinely about THIS browser rather than about the table.
 *
 * Two rules keep this file honest. (1) A preference lives here only if it has no server home and needs
 * none: theme and the dice-input preference already have their own stores (`@vtt/ui`'s theme,
 * `dice/roll-preference.ts`), and everything about how the table PLAYS is server state reached by a
 * command. (2) Nothing dead: `sheetAttack` is deliberately absent — D10 made acting from the sheet the
 * one behavior, so the knob retired rather than being re-homed here (plan-1 §B9.1, §H item 6).
 *
 * `autoArrange` grounds a promise the shell has been making in a comment for two builds ("a future
 * auto-staging personal setting on the VTT Settings tab will gate this"): a freshly created scene opens
 * for arranging, and a GM who does not want that can now say so.
 */

const AUTO_ARRANGE_KEY = "vtt.auto-arrange";

const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode - the choice stays in-session */ } };

let autoArrange: boolean = read(AUTO_ARRANGE_KEY) !== "off";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function setAutoArrange(next: boolean): void {
  if (next === autoArrange) return;
  autoArrange = next;
  write(AUTO_ARRANGE_KEY, next ? "on" : "off");
  for (const listener of [...listeners]) listener();
}

/** Reactive read, so the shell and the Settings switch never disagree about the current answer. */
export function useAutoArrange(): boolean {
  return useSyncExternalStore(subscribe, () => autoArrange, () => autoArrange);
}

import { useSyncExternalStore } from "react";

/* Reduce transparency, shared by the app, the standalone sheet and the viewer. Reduction is on when this device's
   setting is on or the system asks for it, and the setting can never turn a system request off. While it is on,
   <html data-transparency="reduced"> makes the glass solid and drops the scanlines and glows. The no-flash script in
   each HTML entry repeats the key and the decision, so the first paint is already solid. */

const STORAGE_KEY = "vtt.reduce-transparency";
const SYSTEM_QUERY = "(prefers-reduced-transparency: reduce)";

function readSetting(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function systemQuery(): MediaQueryList | null {
  try {
    return window.matchMedia(SYSTEM_QUERY);
  } catch {
    return null;
  }
}

let setting = readSetting();
let system = systemQuery()?.matches ?? false;
const listeners = new Set<() => void>();

/** Whether reduction is on for this page: the device setting or the system's request. */
export function transparencyReduced(): boolean {
  return setting || system;
}

function apply(): void {
  if (transparencyReduced()) document.documentElement.setAttribute("data-transparency", "reduced");
  else document.documentElement.removeAttribute("data-transparency");
  for (const listener of [...listeners]) listener();
}

/** Turns this device's setting on or off and applies the result. */
export function setReduceTransparency(next: boolean): void {
  if (next === setting) return;
  setting = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
  } catch {
    /* private mode: the choice stays in-session */
  }
  apply();
}

/** Applies the current state and follows the system setting while the page is open. Returns the unsubscribe. */
export function initTransparency(): () => void {
  const query = systemQuery();
  const follow = (event: MediaQueryListEvent) => {
    system = event.matches;
    apply();
  };
  system = query?.matches ?? false;
  apply();
  query?.addEventListener?.("change", follow);
  return () => query?.removeEventListener?.("change", follow);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const readState = () => (setting ? (system ? "both" : "setting") : system ? "system" : "off");

/** The device setting and whether the system already asks for reduction, kept in step with every change. */
export function useReduceTransparency(): { setting: boolean; system: boolean } {
  const state = useSyncExternalStore(subscribe, readState, readState);
  return { setting: state === "setting" || state === "both", system: state === "system" || state === "both" };
}

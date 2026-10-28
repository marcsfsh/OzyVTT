import { useLayoutEffect, type RefObject } from "react";
import type { DeathSaves } from "@vtt/domain";
import { burst, canMove, fadeIn, pop, rel, useOnChange, warm } from "@vtt/ui";

/** Where a tracker draws its saves: each kind's pips in order, and the word that turns to Stable. */
export type SavePips = Readonly<{ success: string; failure: string; word: string }>;

/**
 * Death saves lighting (ADR-0045, group 5): each save recorded fills its pip with a pop, cyan for a success and red
 * for a failure, and three successes light the word that says Stable. `host` must be positioned.
 */
export function useSaveLight(host: RefObject<HTMLElement | null>, saves: DeathSaves, pips: SavePips): void {
  const light = (kind: "success" | "failure", before: number, now: number) => {
    const el = host.current;
    if (!el || now <= before || !canMove()) return;
    const pip = el.querySelectorAll<HTMLElement>(pips[kind])[now - 1];
    if (!pip) return;
    warm(pip, { dur: 160 });
    const box = rel(pip, el);
    pop(el, { x: box.cx, y: box.cy, size: 40, tone: kind === "success" ? "cyan" : "red" });
  };
  useOnChange(saves.successes, (before, now) => light("success", before, now));
  useOnChange(saves.failures, (before, now) => light("failure", before, now));
  useOnChange(saves.stable, (_was, now) => {
    const el = host.current;
    const word = el?.querySelector<HTMLElement>(pips.word);
    if (!now || !el || !word || !canMove()) return;
    fadeIn(word, { delay: 160, dur: 160 });
    const box = rel(word, el);
    burst(el, { at: box.cx, line: box.b, w: 90, tone: "cyan", delay: 160 });
  });
}

/** The saves appear under a creature that has just dropped: they fade in as its bar drains. Null skips it. */
export function useSavesArrive(host: RefObject<HTMLElement | null> | null): void {
  useLayoutEffect(() => {
    const el = host?.current;
    if (el) fadeIn(el, { dur: 220, y: -4 });
  }, [host]);
}

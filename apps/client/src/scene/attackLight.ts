import { useEffect, type RefObject } from "react";
import { burst, canMove, cometTo, floatText, pop, rel, useOnChange } from "@vtt/ui";

/** An attack resolved on this device: who made it, at whom, and how it went. */
export type AttackSeen = Readonly<{ attackerId: string; targetId: string; outcome: "crit" | "hit" | "miss" }>;

const listeners = new Set<(attack: AttackSeen) => void>();
/** Results already lit, so a card that mounts again (a tab change) never replays its attack. */
const lit = new WeakSet<object>();
/** Targets of a critical hit this device saw, and when, so the damage number that follows lands larger. */
const criticals = new Map<string, number>();
const CRITICAL_WINDOW_MS = 60_000;
/** When each attack this device lit lands on its target, so the damage number can rise after the burst. */
const landings = new Map<string, number>();
/** How long after an attack starts its light lands, and how long a landing waits for damage to follow it. */
const LANDS_MS = 240;
const LANDING_WINDOW_MS = 1500;

/**
 * Tells the map an attack resolved here (ADR-0045, group 10). `key` is the result it came from: each lights once, and
 * this says whether it did. The result lives on the device that resolved it, so the GM's and the attacking player's
 * maps light it.
 */
export function announceAttack(key: object, attack: AttackSeen): boolean {
  if (lit.has(key)) return false;
  lit.add(key);
  if (attack.outcome === "crit") criticals.set(attack.targetId, performance.now());
  if (attack.outcome !== "miss") landings.set(attack.targetId, performance.now() + LANDS_MS);
  for (const listener of listeners) listener(attack);
  return true;
}

/** When an attack this device just lit lands on a target, or null when none is on its way. Each landing counts once. */
export function takeLanding(targetId: string): number | null {
  const at = landings.get(targetId);
  landings.delete(targetId);
  return at !== undefined && performance.now() - at < LANDING_WINDOW_MS ? at : null;
}

/** Whether the damage a target just took follows a critical hit this device saw. Each critical counts once. */
export function takeCritical(targetId: string): boolean {
  const at = criticals.get(targetId);
  criticals.delete(targetId);
  return at !== undefined && performance.now() - at < CRITICAL_WINDOW_MS;
}

/** The centre and top of a token on the stage, when it is drawn there. */
export function tokenPoint(stage: HTMLElement, actorId: string) {
  const token = stage.querySelector(`[data-token-id="${CSS.escape(actorId)}"]`);
  if (!token) return null;
  const box = rel(token, stage);
  return box.w > 0 ? box : null;
}

/**
 * The attack line on the map: a comet runs from the attacker's token to the target's and bursts there on a hit, gold
 * and twice as wide on a critical hit. A miss runs out of light short of the target and MISS shows there. `stage` is the
 * map's positioned frame, above its tokens.
 */
export function useAttackLight(stage: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const listener = (attack: AttackSeen) => {
      const el = stage.current;
      if (!el || !canMove()) return;
      const from = tokenPoint(el, attack.attackerId);
      const to = tokenPoint(el, attack.targetId);
      if (!from || !to) return;
      const start = { x: from.cx, y: from.cy };
      const end = { x: to.cx, y: to.cy };
      if (attack.outcome === "miss") {
        cometTo(el, { from: start, to: end, reach: 0.8, dur: 260, tone: undefined });
        floatText(el, "MISS", "lr-miss", to.cx, to.y - 4, { delay: 220, dur: 700 });
        return;
      }
      const crit = attack.outcome === "crit";
      cometTo(el, { from: start, to: end, dur: 260, tone: crit ? "gold" : undefined });
      pop(el, {
        x: to.cx,
        y: to.cy,
        size: Math.max(40, to.w) * (crit ? 2 : 1.2),
        delay: 240,
        tone: crit ? "gold" : "red"
      });
      if (crit) burst(el, { at: to.cx, line: to.cy, w: Math.max(80, to.w * 2), delay: 240, tone: "gold" });
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [stage]);
}

/**
 * Aiming (ADR-0045, group 10): picking a target runs a comet out from the attacker to it, and a pop settles on the
 * target where its reticle is.
 */
export function useAimLight(
  stage: RefObject<HTMLElement | null>,
  attackerId: string | null,
  selected: readonly string[]
): void {
  useOnChange(
    selected,
    (before, now) => {
      const el = stage.current;
      if (!el || !attackerId || !canMove()) return;
      const from = tokenPoint(el, attackerId);
      if (!from) return;
      for (const targetId of now) {
        if (before.includes(targetId)) continue;
        const to = tokenPoint(el, targetId);
        if (!to) continue;
        cometTo(el, { from: { x: from.cx, y: from.cy }, to: { x: to.cx, y: to.cy }, dur: 220, tone: "cyan" });
        pop(el, { x: to.cx, y: to.cy, size: Math.max(40, to.w * 1.3), delay: 200, tone: "cyan" });
      }
    },
    (a, b) => a.length === b.length && a.every((id, index) => id === b[index])
  );
}

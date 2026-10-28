import { useLayoutEffect, useRef, type RefObject } from "react";
import { canMove, floatText, pop } from "@vtt/ui";
import { takeCritical, takeLanding, tokenPoint } from "./attackLight";

/** A creature's health as this viewer's projection holds it: exact hit points, or only a band. */
export type SeenHealth =
  Readonly<{ kind: "exact"; points: number }> | Readonly<{ kind: "band"; band: "healthy" | "bloodied" | "down" }>;

const BAND_RANK = { down: 0, bloodied: 1, healthy: 2 } as const;
/** How long damage waits for the attack that dealt it to light. */
const WAIT_MS = 60;

/**
 * Damage landing on the map (ADR-0045, group 10): a burst on the token, and where this viewer already holds the
 * creature's exact hit points, the number it lost rises from the token. The number is the drop between two
 * projections (temporary hit points included), so nothing new reaches any viewer. A creature shown as a band bursts
 * with no number as its band falls. Healing shows no number; the life bar's gold light covers it.
 */
export function useDamageNumbers(stage: RefObject<HTMLElement | null>, health: ReadonlyMap<string, SeenHealth>): void {
  const last = useRef<ReadonlyMap<string, SeenHealth> | null>(null);
  useLayoutEffect(() => {
    const before = last.current;
    last.current = health;
    const el = stage.current;
    if (!before || !el || !canMove()) return;
    const drops: { actorId: string; lost: number }[] = [];
    for (const [actorId, now] of health) {
      const was = before.get(actorId);
      if (!was || was.kind !== now.kind) continue;
      if (now.kind === "exact" && was.kind === "exact" && was.points > now.points)
        drops.push({ actorId, lost: was.points - now.points });
      else if (now.kind === "band" && was.kind === "band" && BAND_RANK[now.band] < BAND_RANK[was.band])
        drops.push({ actorId, lost: 0 });
    }
    if (drops.length === 0) return;
    // The attack that dealt it may light a moment after the damage arrives (its result and the new state come
    // separately), so the number waits a beat and then rises 20ms after that attack's burst, or at once. A later update
    // never cancels the wait, so damage that lands with something else still shows.
    window.setTimeout(() => {
      if (!el.isConnected || !canMove()) return;
      for (const { actorId, lost } of drops) {
        const at = tokenPoint(el, actorId);
        if (!at) continue;
        const landing = takeLanding(actorId);
        const delay = landing === null ? 20 : Math.max(20, landing - performance.now() + 20);
        if (landing === null) pop(el, { x: at.cx, y: at.cy, size: Math.max(40, at.w * 1.2), tone: "red" });
        if (lost > 0)
          floatText(el, String(lost), takeCritical(actorId) ? "lr-damage is-critical" : "lr-damage", at.cx, at.y - 6, {
            delay,
            w: 120
          });
      }
    }, WAIT_MS);
  }, [stage, health]);
}

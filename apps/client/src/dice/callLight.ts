import { burst, canMove, comet, fadeIn, pop, rel, useOnChange } from "@vtt/ui";
import type { RefObject } from "react";

/** One open call as its light reads it: who has answered, and whether each answer passed. */
export type CallSeen = Readonly<{ id: string; answers: ReadonlyMap<string, boolean | null>; total: number }>;

const key = (calls: readonly CallSeen[]) =>
  calls.map((call) => `${call.id}:${[...call.answers.keys()].sort().join(",")}`).join("|");

/**
 * A roll call filling in (ADR-0045, group 4): each answer drops into its row with a pop, cyan when it passed and red
 * when it failed, and when the last one lands a comet runs under the whole list. Rows carry `data-call` on the card and
 * `data-actor` on each answer's row.
 */
export function useCallLight(host: RefObject<HTMLElement | null>, calls: readonly CallSeen[]): void {
  useOnChange(
    calls,
    (before, now) => {
      const el = host.current;
      if (!el || !canMove()) return;
      for (const call of now) {
        const was = before.find((candidate) => candidate.id === call.id);
        if (!was) continue;
        const card = el.querySelector<HTMLElement>(`[data-call="${CSS.escape(call.id)}"]`);
        if (!card) continue;
        for (const [actorId, passed] of call.answers) {
          if (was.answers.has(actorId)) continue;
          const result = card.querySelector<HTMLElement>(`[data-actor="${CSS.escape(actorId)}"] .roll-call-result`);
          if (!result) continue;
          fadeIn(result, { dur: 160, y: -6 });
          const box = rel(result, card);
          pop(card, {
            x: box.cx,
            y: box.cy,
            size: 40,
            tone: passed === true ? "cyan" : passed === false ? "red" : undefined
          });
        }
        const list = card.querySelector<HTMLElement>(".roll-call-entries");
        if (list && call.answers.size === call.total && was.answers.size < call.total) {
          const box = rel(list, card);
          comet(card, { from: box.x, to: box.r, line: box.b, delay: 80, dur: 260 });
          burst(card, { at: box.r, line: box.b, delay: 300, w: 90 });
        }
      }
    },
    (a, b) => key(a) === key(b)
  );
}

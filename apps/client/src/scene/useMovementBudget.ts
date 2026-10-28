import { useEffect, useState } from "react";
import type { ActorMovementReply } from "@vtt/domain";
import { read } from "../lib/command";

/** A combatant's movement this turn (its budget for each way it can move), asked again as the game changes. Null
 *  until the first arrives for this creature, or when it fails: the preview then shows the cost alone. While a newer
 *  one loads the last stays, so the Move lamp and the feet beside it never blink back to the creature's base speed. */
export function useMovementBudget(actorId: string | null, revision: number): ActorMovementReply | null {
  const [budget, setBudget] = useState<{ actorId: string; reply: ActorMovementReply } | null>(null);
  useEffect(() => {
    if (!actorId) return;
    let live = true;
    void read("actor:movement", { actorId }).then((result) => {
      if (!live || !result.ok || result.counted === undefined) return;
      setBudget({
        actorId,
        reply: {
          counted: result.counted,
          speedFeet: result.speedFeet ?? null,
          usedFeet: result.usedFeet ?? 0,
          enforcement: result.enforcement ?? "strict",
          ...(result.modes ? { modes: result.modes } : {}),
          ...(result.crawling ? { crawling: true } : {}),
          ...(result.dragging ? { dragging: true } : {})
        }
      });
    });
    return () => {
      live = false;
    };
  }, [actorId, revision]);
  return budget && budget.actorId === actorId ? budget.reply : null;
}

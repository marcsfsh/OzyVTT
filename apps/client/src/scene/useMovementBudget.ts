import { useEffect, useState } from "react";
import type { ActorMovementReply } from "@vtt/domain";
import { read } from "../lib/command";

/** A combatant's movement this turn (its budget for each way it can move), asked again as the game changes. Null
 *  until it arrives, or when it fails: the preview then shows the cost alone. */
export function useMovementBudget(actorId: string | null, revision: number): ActorMovementReply | null {
  const [budget, setBudget] = useState<{ key: string; reply: ActorMovementReply } | null>(null);
  const key = actorId ? `${actorId}|${revision}` : null;
  useEffect(() => {
    if (!actorId || !key) return;
    let live = true;
    void read("actor:movement", { actorId }).then((result) => {
      if (!live || !result.ok || result.counted === undefined) return;
      setBudget({
        key,
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
  }, [actorId, key]);
  return budget && budget.key === key ? budget.reply : null;
}

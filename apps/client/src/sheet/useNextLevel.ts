import { useEffect, useState } from "react";
import type { NextLevelReply } from "@vtt/domain";
import { read } from "../lib/command";

/**
 * What the character's next level brings, from the server's own read of the level page's first offer. Asked only when
 * the caller may level the character; any refusal (the table's cap, a sheet not built here) means nothing to show.
 */
export function useNextLevel(actorId: string, enabled: boolean, key: string): NextLevelReply | null {
  const [reply, setReply] = useState<NextLevelReply | null>(null);
  useEffect(() => {
    if (!enabled) {
      setReply(null);
      return;
    }
    let live = true;
    void read("character:next-level", { actorId }).then((result) => {
      if (!live) return;
      setReply(
        result.ok && result.level !== undefined && result.lines
          ? {
              level: result.level,
              classId: result.classId ?? "",
              className: result.className ?? "",
              classLevel: result.classLevel ?? result.level,
              lines: result.lines
            }
          : null
      );
    });
    return () => {
      live = false;
    };
  }, [actorId, enabled, key]);
  return reply;
}

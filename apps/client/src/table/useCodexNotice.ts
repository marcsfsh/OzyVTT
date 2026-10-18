import { useCallback, useEffect, useRef } from "react";
import { useToast } from "@vtt/ui";
import { playerCodexApi } from "../codex/api";
import { useCodexQuery } from "../codex/useCodexQuery";

/**
 * Tells a player at the table when the Codex gives them something new: a page they can now open, or one whose text
 * reached them since. The ping reaches a player only when their own reads changed, and the page list says which,
 * by each page's `playerUpdatedAt`, which moves only for what this player reads.
 */
export function useCodexNotice(token: string | null) {
  const { toast } = useToast();
  const load = useCallback(() => playerCodexApi.listPages(token ?? ""), [token]);
  const read = useCodexQuery(token ? load : null);
  const seen = useRef<ReadonlyMap<string, string> | null>(null);
  useEffect(() => {
    if (!read.data) return;
    const before = seen.current;
    seen.current = new Map(read.data.map((page) => [page.id, page.playerUpdatedAt]));
    if (!before) return;
    const fresh = read.data.filter((page) => {
      const then = before.get(page.id);
      return then === undefined || then < page.playerUpdatedAt;
    });
    if (fresh.length === 0) return;
    const names = fresh.slice(0, 3).map((page) => page.title);
    toast(`New in the Codex: ${names.join(", ")}${fresh.length > 3 ? ` and ${fresh.length - 3} more` : ""}`, {
      tone: "info"
    });
  }, [read.data, toast]);
}

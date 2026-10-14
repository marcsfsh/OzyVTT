import { useEffect } from "react";
import type { TableEvent } from "@vtt/domain";
import { useToast, type ToastTone } from "@vtt/ui";
import { socket } from "../socket";

/**
 * Transient battlemap notifications ("Goblin took 6 damage") from the server's role-filtered
 * `table:event` broadcast, shown through the shared toast surface; the combat log is the durable
 * record. Mount once inside the ToastProvider; renders nothing itself.
 */
const TONE_FOR_KIND: Record<TableEvent["kind"], ToastTone> = {
  damage: "error",
  heal: "success",
  save: "info",
  action: "info",
  condition: "info",
  reaction: "info",
  effect: "info",
  "death-save": "info"
};

export function TableEventToasts() {
  const { toast } = useToast();
  useEffect(() => {
    const onEvent = (event: TableEvent) => toast(event.text, { tone: TONE_FOR_KIND[event.kind] ?? "info" });
    socket.on("table:event", onEvent);
    return () => { socket.off("table:event", onEvent); };
  }, [toast]);
  return null;
}

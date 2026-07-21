import { useEffect } from "react";
import type { TableEvent } from "@vtt/domain";
import { useToast, type ToastTone } from "@vtt/ui";
import { socket } from "../socket";

/**
 * Transient battlemap notifications ("Goblin took 6 damage"), fed by the server's role-filtered
 * `table:event` broadcast. Routed through the shared toast surface (`useToast`) so combat feedback
 * looks and moves like every other notification - the durable record stays the combat log/roll
 * history. Mount once inside the ToastProvider; renders nothing itself.
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

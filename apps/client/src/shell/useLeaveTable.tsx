import type { PlayerView } from "@vtt/domain";
import { useConfirm } from "../components/feedback";

/** Leaving the table on this device, asked first: the frame's menu and Settings both use it. */
export function useLeaveTable(state: PlayerView | null | undefined, onLeave: (() => void) | undefined) {
  const { confirm, dialog } = useConfirm();
  const mine = (state?.actors ?? []).find(
    (actor) => "claimStatus" in actor && actor.claimStatus === "mine" && actor.kind === "player-character"
  );
  const leave = async () => {
    const ok = await confirm({
      title: "Leave the table?",
      body: mine
        ? `${mine.name} stays yours. Join again on this device to pick up where you left off.`
        : "Join again on this device whenever you are ready.",
      confirmLabel: "Leave table"
    });
    if (ok) onLeave?.();
  };
  return { leave, dialog };
}

import { useToast } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { command } from "../lib/command";

/**
 * "Force release": confirmed, and confirmed again when the character is in the running fight, because the player
 * loses their turn controls until someone claims the character again. The player is told on their own devices.
 */
export function useForceRelease() {
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  const release = async (actor: Readonly<{ id: string; name: string }>) => {
    const ok = await confirm({
      title: `Release ${actor.name}?`,
      body: `The player with ${actor.name} goes back to the character list and sees a message that you released ${actor.name}. Anyone at the table can claim ${actor.name} next.`,
      confirmLabel: "Release",
      danger: true
    });
    if (!ok) return;
    let result = await command("character:force-release", { actorId: actor.id });
    if (!result.ok && result.code === "in_fight") {
      const again = await confirm({
        title: `Release ${actor.name} mid-fight?`,
        body: result.message ?? `${actor.name} is in the fight.`,
        confirmLabel: "Release anyway",
        danger: true
      });
      if (!again) return;
      result = await command("character:force-release", { actorId: actor.id, inFight: true });
    }
    toast(
      result.ok ? `${actor.name} is free to claim again.` : (result.message ?? `${actor.name} could not be released.`),
      { tone: result.ok ? "success" : "error" }
    );
  };
  return { release, dialog };
}

import { useState } from "react";
import type { GmActor } from "@vtt/domain";
import { Switch } from "@vtt/ui";
import { command } from "../lib/command";

/**
 * The GM says whether a legendary creature fights in its lair (SRD 5.2.1: "Legendary Action Uses: 3 (4 in Lair)"). In
 * it, the server gives the creature the lair's legendary action uses and Legendary Resistance. Shown only for a stat
 * block that prints a lair.
 */
export function LairControl({
  actor,
  onFeedback
}: Readonly<{ actor: Pick<GmActor, "id" | "legendary">; onFeedback: (text: string) => void }>) {
  const [busy, setBusy] = useState(false);
  const legendary = actor.legendary;
  if (!legendary || (legendary.actionsInLair === undefined && legendary.resistancesInLair === undefined)) return null;
  const inLair = legendary.inLair === true;
  const toggle = async (next: boolean) => {
    setBusy(true);
    const result = await command("actor:set-lair", { actorId: actor.id, inLair: next });
    setBusy(false);
    if (!result.ok) onFeedback(result.message ?? "The lair could not be changed.");
  };
  return (
    <Switch
      checked={inLair}
      disabled={busy}
      onChange={(next) => void toggle(next)}
      label="In its lair"
      className="lair-control"
    />
  );
}

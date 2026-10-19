import { useState } from "react";
import { Button, Select } from "@vtt/ui";
import { command } from "../lib/command";
import type { SheetActor, SheetState } from "./sheet-model";

/** Whether the character holds a second Heroic Inspiration to give, as this viewer received it. */
export function hasGift(actor: SheetActor): boolean {
  return "heroicInspirationToGive" in actor && actor.heroicInspirationToGive === true;
}

/**
 * SRD Heroic Inspiration: a second one gained while holding one is lost unless it goes to a player character who lacks
 * it. The card names the party's other characters (leaving out any this viewer can see already has one); the server
 * refuses one that has.
 */
export function HeroicGift({
  actor,
  state,
  onFeedback
}: Readonly<{ actor: SheetActor; state: SheetState | undefined; onFeedback: (text: string) => void }>) {
  const takers = (state?.actors ?? []).filter(
    (candidate) =>
      candidate.id !== actor.id &&
      candidate.kind === "player-character" &&
      !("archived" in candidate && candidate.archived === true) &&
      !("heroicInspiration" in candidate && candidate.heroicInspiration === true)
  );
  const [recipient, setRecipient] = useState(takers[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const send = (recipientId: string | null) => {
    setBusy(true);
    void command("actor:give-heroic-inspiration", { actorId: actor.id, recipientId }).then((result) => {
      setBusy(false);
      if (!result.ok) onFeedback(result.message ?? "The Heroic Inspiration was not given.");
      else if (recipientId === null) onFeedback(`${actor.name} lets the second Heroic Inspiration go.`);
      else
        onFeedback(
          `${takers.find((candidate) => candidate.id === recipientId)?.name ?? "The character"} has Heroic Inspiration.`
        );
    });
  };
  return (
    <section className="cs-card cs-caution" role="group" aria-label="Give Heroic Inspiration">
      <strong>A second Heroic Inspiration</strong>
      <p className="cs-sub">
        {actor.name} already has Heroic Inspiration. Give this one to a player character who has none, or it is lost.
      </p>
      {takers.length > 0 && (
        <label className="cs-field">
          <span className="cs-eyebrow">Give it to</span>
          <Select
            aria-label="Give it to"
            value={recipient}
            disabled={busy}
            onChange={(event) => setRecipient(event.target.value)}
          >
            {takers.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      <div className="cs-chiprow">
        {takers.length > 0 && (
          <Button variant="primary" size="sm" disabled={busy || !recipient} onClick={() => send(recipient)}>
            Give
          </Button>
        )}
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => send(null)}>
          Let it go
        </Button>
      </div>
    </section>
  );
}

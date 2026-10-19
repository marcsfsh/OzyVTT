import { useState } from "react";
import { Button, Select } from "@vtt/ui";
import { command } from "../lib/command";
import type { SheetActor, SheetState } from "./sheet-model";

/** A skill or tool the character may help with: one it is proficient in. */
export type HelpChoice = Readonly<{ id: string; name: string }>;

/**
 * SRD Help, Assist an Ability Check, outside a fight: with one of the character's skill or tool proficiencies, a party
 * member has Advantage on their next check with it. In a fight it is the Action on the turn order instead. The server
 * checks the proficiency and that the creature helped is an ally.
 */
export function HelpAnAlly({
  actor,
  state,
  choices,
  onFeedback
}: Readonly<{
  actor: SheetActor;
  state: SheetState | undefined;
  choices: readonly HelpChoice[];
  onFeedback: (text: string) => void;
}>) {
  const allies = (state?.actors ?? []).filter(
    (candidate) =>
      candidate.id !== actor.id &&
      candidate.kind === "player-character" &&
      !("archived" in candidate && candidate.archived === true)
  );
  const [allyId, setAllyId] = useState("");
  const [choiceId, setChoiceId] = useState("");
  const [busy, setBusy] = useState(false);
  if (allies.length === 0 || choices.length === 0) return null;
  const ally = allies.find((candidate) => candidate.id === allyId) ?? allies[0]!;
  const choice = choices.find((candidate) => candidate.id === choiceId) ?? choices[0]!;
  const help = () => {
    setBusy(true);
    void command("action:resolve", {
      actorId: actor.id,
      actionId: "help-check",
      targetIds: [ally.id],
      skill: choice.id
    }).then((result) => {
      setBusy(false);
      onFeedback(
        result.ok
          ? `${ally.name} has Advantage on their next ${choice.name} check.`
          : (result.message ?? `${actor.name} couldn't help.`)
      );
    });
  };
  return (
    <section className="cs-card" role="group" aria-label="Help an ally">
      <strong>Help an ally</strong>
      <p className="cs-sub">
        Lend a party member a hand with one of your proficiencies: they have Advantage on their next check with it.
      </p>
      <label className="cs-field">
        <span className="cs-eyebrow">Ally</span>
        <Select aria-label="Ally" value={ally.id} disabled={busy} onChange={(event) => setAllyId(event.target.value)}>
          {allies.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="cs-field">
        <span className="cs-eyebrow">With</span>
        <Select
          aria-label="Help with"
          value={choice.id}
          disabled={busy}
          onChange={(event) => setChoiceId(event.target.value)}
        >
          {choices.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </Select>
      </label>
      <div className="cs-chiprow">
        <Button variant="primary" size="sm" disabled={busy} onClick={help}>
          Help
        </Button>
      </div>
    </section>
  );
}

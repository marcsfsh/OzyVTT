import { useState } from "react";
import { Button, Select } from "@vtt/ui";
import { rosterActors, type ActorDefinition, type GmView, type StabilizeResult } from "@vtt/domain";
import { catalogIdOf } from "@vtt/schemas";
import { command } from "../lib/command";
import "./stabilize-control.css";

/** A creature who can give aid, with what it carries: a Healer's Kit, the Spare the Dying cantrip. */
export type AidGiver = Readonly<{ id: string; name: string; hasKit: boolean; knowsSpareTheDying: boolean }>;

/** What a creature can stabilize with, read off the inventory and sheet this viewer holds. The server decides. */
export function aidGiverOf(
  actor: Readonly<{
    id: string;
    name: string;
    inventory?: ReadonlyArray<Readonly<{ id: string; recordId?: string; quantity: number }>>;
  }>,
  definition: ActorDefinition | null | undefined
): AidGiver {
  return {
    id: actor.id,
    name: actor.name,
    hasKit: (actor.inventory ?? []).some((item) => catalogIdOf(item) === "healers-kit" && item.quantity > 0),
    knowsSpareTheDying: definition?.spellcasting?.spells.some((spell) => spell.id === "spare-the-dying") ?? false
  };
}

/** Outside a fight, who in the party could give aid: conscious characters and NPCs on the roster, without the one in need. */
export function partyHelpers(state: GmView, targetId: string): AidGiver[] {
  return rosterActors(state.actors)
    .filter(
      (candidate) =>
        candidate.id !== targetId && candidate.kind !== "monster" && !candidate.archived && candidate.hp.current > 0
    )
    .map((candidate) =>
      aidGiverOf(candidate, state.definitions?.find((entry) => entry.id === candidate.definitionId)?.definition)
    );
}

/** Whether this creature lies knocked out (first aid wakes it), from the effect that holds its Unconscious. */
export const isKnockedOut = (actor: Readonly<{ effects: ReadonlyArray<Readonly<{ tags: readonly string[] }>> }>) =>
  actor.effects.some((effect) => effect.tags.includes("knocked-out"));

type Method = "medicine" | "healers-kit" | "spare-the-dying" | "gm";

/** What to tell the helper about a stabilize reply: only a refusal, since the table feed already narrates every aid
 *  given, with the check it came to. Null when there is nothing to add. */
export function stabilizeRefusal(result: StabilizeResult): string | null {
  return result.ok ? null : (result.message ?? "The aid could not be given.");
}

/**
 * SRD Stabilizing a Character, from the side of whoever helps: first aid (a DC 10 Wisdom (Medicine) check the server
 * rolls), a Healer's Kit, or Spare the Dying, each the helper's action in a fight. A player helps with their own
 * character; the GM picks a helper or rules the creature stable. `knockedOut` offers only first aid, which wakes.
 */
export function StabilizeControl({
  targetId,
  targetName,
  helpers,
  gm,
  knockedOut = false,
  onFeedback
}: Readonly<{
  targetId: string;
  targetName: string;
  helpers: readonly AidGiver[];
  gm: boolean;
  knockedOut?: boolean;
  onFeedback: (text: string) => void;
}>) {
  const [busy, setBusy] = useState(false);
  const [helperId, setHelperId] = useState<string>(helpers[0]?.id ?? "");
  const helper = helpers.find((candidate) => candidate.id === helperId) ?? helpers[0];
  const send = (method: Method) => {
    setBusy(true);
    void command("actor:stabilize", {
      actorId: targetId,
      method,
      ...(method === "gm" || !helper ? {} : { helperId: helper.id })
    }).then((result) => {
      setBusy(false);
      const refusal = stabilizeRefusal(result);
      if (refusal) onFeedback(refusal);
    });
  };
  if (!gm && !helper) return null;
  return (
    <div className="stabilize-control" role="group" aria-label={`Help ${targetName}`}>
      {gm && helpers.length > 1 && (
        <Select
          className="stabilize-helper"
          aria-label="Who gives the aid"
          value={helper?.id ?? ""}
          disabled={busy}
          onChange={(event) => setHelperId(event.target.value)}
        >
          {helpers.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </Select>
      )}
      {helper && (
        <Button size="sm" disabled={busy} title="A DC 10 Wisdom (Medicine) check" onClick={() => send("medicine")}>
          {knockedOut ? "First aid (wake)" : "First aid"}
        </Button>
      )}
      {helper?.hasKit && !knockedOut && (
        <Button size="sm" disabled={busy} title="One use of the kit, no check" onClick={() => send("healers-kit")}>
          Healer&apos;s Kit
        </Button>
      )}
      {helper?.knowsSpareTheDying && !knockedOut && (
        <Button size="sm" disabled={busy} onClick={() => send("spare-the-dying")}>
          Spare the Dying
        </Button>
      )}
      {gm && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => send("gm")}>
          {knockedOut ? "Wake" : "Mark stable"}
        </Button>
      )}
    </div>
  );
}

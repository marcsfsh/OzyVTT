import { useState } from "react";
import type { GmActor } from "@vtt/domain";
import type { ActorDefinition, TraitMechanic } from "@vtt/schemas";
import { SRD_SKILL_ABILITY } from "@vtt/content-srd-5.2.1/schemas";
import { Field, Select } from "@vtt/ui";
import { command } from "../lib/command";

type StatBlockPick = Extract<TraitMechanic, { kind: "pick" }>;

const words = (slug: string) =>
  slug
    .split("-")
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");

/**
 * What a creature's stat block leaves to the GM (a half-dragon's Draconic Origin damage type, a commoner's Training
 * skill), picked once for this creature. The server reads the pick: a refused action names the choice to make here.
 * Shown only for a stat block that prints one.
 */
export function PickControl({
  actor,
  definition,
  onFeedback
}: Readonly<{
  actor: Pick<GmActor, "id" | "name" | "statBlockPicks">;
  definition: ActorDefinition | undefined;
  onFeedback: (text: string) => void;
}>) {
  const [busy, setBusy] = useState(false);
  const picks = (definition?.traitMechanics ?? []).filter(
    (mechanic): mechanic is StatBlockPick => mechanic.kind === "pick"
  );
  if (picks.length === 0) return null;
  const choose = async (pick: StatBlockPick, value: string) => {
    setBusy(true);
    const result = await command("actor:set-pick", {
      actorId: actor.id,
      key: pick.key,
      value: value === "" ? null : value
    });
    setBusy(false);
    if (!result.ok) onFeedback(result.message ?? `${pick.name} could not be changed.`);
  };
  return (
    <>
      {picks.map((pick) => {
        const options = pick.options ?? (pick.of === "skill" ? Object.keys(SRD_SKILL_ABILITY) : []);
        return (
          <Field key={pick.key} label={pick.name} htmlFor={`pick-${actor.id}-${pick.key}`}>
            <Select
              id={`pick-${actor.id}-${pick.key}`}
              value={actor.statBlockPicks?.[pick.key] ?? ""}
              disabled={busy}
              onChange={(event) => void choose(pick, event.target.value)}
            >
              <option value="">None</option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {words(option)}
                </option>
              ))}
            </Select>
          </Field>
        );
      })}
    </>
  );
}

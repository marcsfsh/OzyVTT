import type { Actor, GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import type { EquipmentCatalog } from "../equipment-derivation.js";
import { CommandRejectedError } from "../game-store.js";
import { trueDefinitionIdOf } from "./forms.js";
import { beastShapesAt, challengeLabel, classLevelOf, learnableForms } from "./options.js";

/**
 * Sets a Druid's known Wild Shape forms (SRD 5.2.1 Wild Shape, Known Forms): Beast stat blocks within the Beast Shapes
 * table at its Druid level (how many, the highest Challenge Rating, and a Fly Speed only from level 8). An empty place
 * fills at any time; "whenever you finish a Long Rest, you can replace one of your known forms with another eligible
 * form", so a player replaces one form after each Long Rest, and the GM any number.
 */
export function setKnownForms(
  state: GameState,
  actorId: string,
  formIds: readonly string[],
  deps: Readonly<{
    resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
    catalog?: EquipmentCatalog;
  }>,
  gm: boolean
): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That character no longer exists.");
  const trueId = trueDefinitionIdOf(actor);
  const definition = trueId ? deps.resolveDefinition(trueId) : undefined;
  const row = beastShapesAt(classLevelOf(definition, "druid"));
  if (!row) throw new CommandRejectedError(`${actor.name} has no Wild Shape forms to know.`);
  if (formIds.length > row.known)
    throw new CommandRejectedError(
      `${actor.name} knows ${row.known} forms at this Druid level. Choose ${row.known} or fewer.`
    );
  const eligible = new Set(learnableForms(definition, deps.catalog).map((option) => option.id));
  for (const id of formIds) {
    if (eligible.has(id)) continue;
    // Only an SRD stat block is named back: a GM's own stays unnamed to whoever guessed its id.
    const srd = deps.catalog?.monsterSummaries?.().find((summary) => summary.id === id && summary.source === "srd");
    const name = srd?.name ?? "That form";
    throw new CommandRejectedError(
      `${name} isn't an eligible form: a Beast of ${challengeLabel(row.maxChallenge)} or lower${row.fly ? "" : " with no Fly Speed"}.`
    );
  }
  const current = actor.knownForms?.ids ?? [];
  const replaced = current.filter((id) => !formIds.includes(id));
  const swapOpen = actor.knownForms?.swapOpen ?? false;
  if (!gm && replaced.length > 0) {
    if (!swapOpen)
      throw new CommandRejectedError(`${actor.name} can replace a known form only after finishing a Long Rest.`);
    if (replaced.length > 1)
      throw new CommandRejectedError(
        `${actor.name} can replace one known form after a Long Rest. Change one at a time.`
      );
  }
  actor.knownForms = { ids: [...formIds], swapOpen: replaced.length > 0 && !gm ? false : swapOpen };
}

/** A Long Rest opens the replacement of one known form, for a creature that knows any. */
export function openFormSwap(actor: Actor): void {
  if ((actor.knownForms?.ids.length ?? 0) > 0) actor.knownForms = { ids: [...actor.knownForms!.ids], swapOpen: true };
}

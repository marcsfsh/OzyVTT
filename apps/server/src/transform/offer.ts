import type { ActionAvailability, Actor, GameState } from "@vtt/domain";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import type { EquipmentCatalog } from "../equipment-derivation.js";
import { trueDefinitionIdOf } from "./forms.js";
import { beastShapesAt, classLevelOf, formOptions, learnableForms } from "./options.js";

/**
 * What the sheet offers for a shape-shift: the forms it may take now, whether each target picks its own (Animal
 * Shapes) and whether the user picks what becomes of its gear (Wild Shape). Wild Shape adds the Beasts its user may
 * learn at its Druid level, how many it knows and whether a Long Rest opened one to replace.
 */
export function formsOffer(
  state: GameState,
  actor: Actor,
  action: ActorAction,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined
): NonNullable<ActionAvailability["forms"]> {
  const shift = action.shapeShift!;
  const resolve = (id: string) =>
    state.definitions.find((entry) => entry.id === id)?.definition ?? catalog?.monster?.(id);
  const options = formOptions(actor, action, definition, catalog, resolve);
  const base = {
    options,
    ...(shift.onTargets ? { perTarget: true as const } : {}),
    ...(shift.gear === "choice" ? { gearChoice: true as const } : {})
  };
  if (shift.from !== "known") return base;
  const trueId = trueDefinitionIdOf(actor);
  const own = (trueId && resolve(trueId)) || definition;
  const row = beastShapesAt(classLevelOf(own, "druid"));
  return {
    ...base,
    learnable: learnableForms(own, catalog),
    knownLimit: row?.known ?? 0,
    swapOpen: actor.knownForms?.swapOpen ?? false
  };
}

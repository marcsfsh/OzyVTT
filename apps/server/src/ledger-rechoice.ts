import type { BuilderPolicy, GameState, Rechoice } from "@vtt/domain";
import type { Actor, ActorDefinition, CharacterChoice } from "@vtt/schemas";
import { rebuildActorDefinition } from "./actor-roster.js";
import { buildCharacterDefinition, storedHitPointRolls, type CharacterCreateRequestInput } from "./character-build.js";
import { storedClassSequence } from "./character-offers.js";
import { replaceableOffers } from "./choice-overrides.js";
import type { ContentView } from "./content-library.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import { sheetAbilityScores, sheetSourceOf } from "./sheet-abilities.js";

/**
 * A pick re-made on a rest whose answer the build itself reads. SRD Circle of the Land: "Whenever you finish a Long
 * Rest, choose one type of land ... you have the spells listed for your Druid level and lower prepared", and Nature's
 * Ward takes its Resistance from that land. The new answer replaces the pick's row in the choices ledger, and the sheet
 * is rebuilt from the ledger as a level-up would rebuild it, so everything gated on the answer follows and what has
 * been spent stays spent.
 */

/** The build request a stored sheet was made from, read back off its ledger. Null when the sheet can't be rebuilt
 *  here: no ledger (an import), or ability scores neither recorded nor reproducible from the sheet. */
export function buildRequestOf(definition: ActorDefinition, library: ContentView): CharacterCreateRequestInput | null {
  const source = sheetSourceOf(definition);
  const scores = source ? sheetAbilityScores(source, library) : null;
  if (!source || !scores) return null;
  const { derived: _derived, ...sent } = scores;
  // A multiclass sheet re-sends the order its levels were taken in; the starting class names its own subclass.
  const sequence = storedClassSequence(source.choices);
  const subclass = definition.character?.classes[0]?.subclass;
  // Rolled hit points are re-sent as recorded, so the maximum doesn't move.
  const rolls = storedHitPointRolls(source.choices, source.level);
  return {
    name: definition.name,
    speciesId: source.speciesId,
    backgroundId: source.backgroundId,
    classId: source.classId,
    level: source.level,
    ...(subclass ? { subclassId: subclass.id } : {}),
    ...(sequence ? { classLevels: sequence } : {}),
    ...sent,
    hp: rolls !== null && rolls.length > 0 ? { mode: "entries", entries: rolls } : { mode: "average" },
    choices: source.choices,
    keepsRecordedScores: true
  };
}

/** The ledger row answering `offer` ("feature:<id>", or "feature:<id>/N" for a feature's later pick). */
function rowIndexOf(choices: readonly CharacterChoice[], offer: string): number {
  const match = /^feature:([a-z0-9-]+)(?:\/(\d+))?$/.exec(offer);
  if (!match) return -1;
  const nth = Number(match[2] ?? 1);
  let seen = 0;
  return choices.findIndex((row) => row.payload?.featureId === match[1] && ++seen === nth);
}

/** Re-makes the ledger's answer to `offer` and rebuilds the character from it. False when the answer is already `id`. */
export function rechooseInLedger(
  state: GameState,
  actorId: string,
  offer: string,
  id: string,
  deps: Readonly<{ library: ContentView; policy: BuilderPolicy; catalog?: EquipmentCatalog }>
): boolean {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  const definition = state.definitions.find((entry) => entry.id === actor.definitionId)?.definition;
  const choices = definition?.character?.choices ?? [];
  const index = rowIndexOf(choices, offer);
  const request = definition && index >= 0 ? buildRequestOf(definition, deps.library) : null;
  if (!request)
    throw new CommandRejectedError(
      `${actor.name}'s sheet doesn't record how it was built, so this pick can't change here. Make it in the Level flow.`
    );
  if (choices[index].id === id) return false;
  const rechosen = choices.map((row, at) => (at === index ? { ...row, id } : row));
  const rebuilt = buildCharacterDefinition({ ...request, choices: rechosen }, deps.library, deps.policy);
  rebuildActorDefinition(state, actorId, rebuilt, deps.catalog);
  return true;
}

/** The ledger's answer to `offer`, or null when the sheet records none. */
function ledgerAnswerOf(definition: ActorDefinition | undefined, offer: string): string | null {
  const choices = definition?.character?.choices ?? [];
  const index = rowIndexOf(choices, offer);
  return index >= 0 ? choices[index].id : null;
}

/** The picks a character may re-make on a rest, as its sheet offers them: each option's name, and the answer in force
 *  (a rest-time override, else the ledger's). */
export function rechoicesOf(
  actor: Pick<Actor, "choiceOverrides">,
  definition: ActorDefinition | undefined,
  library: ContentView
): Rechoice[] {
  return replaceableOffers(definition, library).map((offer) => ({
    offer: offer.offer,
    label: offer.label,
    per: offer.per,
    options: offer.options.map((id) => ({ id, name: offer.optionNames[id] ?? id })),
    chosen:
      (offer.rebuilds ? undefined : actor.choiceOverrides[offer.offer]?.id) ?? ledgerAnswerOf(definition, offer.offer)
  }));
}

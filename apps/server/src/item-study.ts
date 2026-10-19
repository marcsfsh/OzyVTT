import type { BuilderPolicy, GameState } from "@vtt/domain";
import { ABILITY_NAMES } from "@vtt/rules-5e";
import { catalogIdOf, type CharacterChoice } from "@vtt/schemas";
import { fightHolding, rebuildActorDefinition } from "./actor-roster.js";
import { buildCharacterDefinition } from "./character-build.js";
import type { ContentView } from "./content-library.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import { buildRequestOf } from "./ledger-rechoice.js";
import { STUDIED_ITEM_KIND } from "./study-ledger.js";

/**
 * SRD 5.2.1 manuals and tomes: "If you spend 48 hours over a period of 6 days or fewer studying the book's contents and
 * practicing its guidelines, your Constitution increases by 2, to a maximum of 30. The manual then loses its magic but
 * regains it in a century." The GM marks the study done, since the hours are downtime the GM gives. The increase is a
 * row in the reader's choices ledger (`study-ledger.ts`), and the copy studied is marked `dormant`, so no one else
 * gains from it.
 */

export type StudyOutcome = Readonly<{ item: string; ability: string; before: number; after: number }>;

/** Marks a carried manual or tome studied by the character who carries it: the score rises and the copy's magic is
 *  spent. Mutates `state`. */
export function studyItem(
  state: GameState,
  actorId: string,
  itemId: string,
  deps: Readonly<{ library: ContentView; policy: BuilderPolicy; catalog: EquipmentCatalog }>
): StudyOutcome {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That character no longer exists.");
  const row = actor.inventory.find((entry) => entry.id === itemId && entry.quantity > 0);
  if (!row) throw new CommandRejectedError(`${actor.name} doesn't carry that item.`);
  const study = deps.catalog.equipmentRecord(catalogIdOf(row))?.study;
  if (!study) throw new CommandRejectedError(`The ${row.name} isn't a book a reader studies.`);
  if (row.dormant) throw new CommandRejectedError(`The ${row.name} has lost its magic. It regains it in a century.`);
  if (fightHolding(state, actorId) !== null)
    throw new CommandRejectedError(`The study takes ${study.hours} hours. End the fight ${actor.name} is in first.`);
  const definition = state.definitions.find((entry) => entry.id === actor.definitionId)?.definition;
  const choices = definition?.character?.choices;
  const request = definition && choices ? buildRequestOf(definition, deps.library) : null;
  if (!definition || !choices || !request)
    throw new CommandRejectedError(
      `${actor.name}'s sheet doesn't record how it was built, so the score can't rise here. Change it on the imported sheet.`
    );
  const before = definition.abilityScores[study.ability];
  if (before >= study.maximum)
    throw new CommandRejectedError(
      `${actor.name}'s ${ABILITY_NAMES[study.ability]} is already ${before}, the most the ${row.name} gives.`
    );
  const level = (definition.character?.classes ?? []).reduce((total, entry) => total + entry.level, 0);
  const studied: CharacterChoice = {
    level: Math.min(20, Math.max(1, level)),
    kind: STUDIED_ITEM_KIND,
    id: catalogIdOf(row),
    payload: { ability: study.ability, amount: study.amount, maximum: study.maximum }
  };
  const rebuilt = buildCharacterDefinition({ ...request, choices: [...choices, studied] }, deps.library, deps.policy);
  rebuildActorDefinition(state, actorId, rebuilt, deps.catalog);
  // One copy of a stack is read: it leaves the stack as its own spent row.
  if (row.quantity > 1) {
    const taken = new Set(actor.inventory.map((entry) => entry.id));
    let id = `${row.id.slice(0, 70)}-read`;
    for (let copy = 2; taken.has(id); copy += 1) id = `${row.id.slice(0, 70)}-read-${copy}`;
    actor.inventory = [
      ...actor.inventory.map((entry) => (entry.id === row.id ? { ...entry, quantity: entry.quantity - 1 } : entry)),
      { ...row, id, recordId: catalogIdOf(row), quantity: 1, equipped: false, attuned: false, dormant: true }
    ];
  } else actor.inventory = actor.inventory.map((entry) => (entry.id === row.id ? { ...entry, dormant: true } : entry));
  return {
    item: row.name,
    ability: ABILITY_NAMES[study.ability],
    before,
    after: rebuilt.abilityScores[study.ability]
  };
}

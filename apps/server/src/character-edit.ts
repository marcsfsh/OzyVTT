import type { GameState } from "@vtt/domain";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";

/**
 * Resolve the per-PC editable definition (keyed `import-<actorId>`, 1:1 with the actor). Shared
 * bundle content (monsters) is never editable this way, so an edit can only ever touch this one
 * character's sheet.
 */
function editableDefinition(state: GameState, actorId: string): { definitionId: string; definition: ActorDefinition } {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (actor.kind !== "player-character") throw new CommandRejectedError("Only player characters can be edited here.");
  const definitionId = actor.definitionId;
  if (!definitionId || !definitionId.startsWith("import-")) throw new CommandRejectedError("This character has no editable sheet - import one first.");
  const entry = state.definitions.find((candidate) => candidate.id === definitionId);
  if (!entry) throw new CommandRejectedError("This character's sheet is missing.");
  return { definitionId, definition: entry.definition };
}

/** Persist an edited definition, re-validated through the schema so the stored sheet stays canonical. */
function replaceDefinition(state: GameState, definitionId: string, next: ActorDefinition): void {
  const parsed = ActorDefinitionSchema.parse(next);
  state.definitions = state.definitions.map((entry) => entry.id === definitionId ? { id: entry.id, definition: parsed } : entry);
}

export function setCharacterIdentity(state: GameState, actorId: string, character: ActorDefinition["character"]): void {
  const { definitionId, definition } = editableDefinition(state, actorId);
  // The sheet's identity editor sends class/race/background/feats and knows nothing about the
  // builder's provenance ledger (`character.choices`), so replacing the block wholesale would
  // silently drop it - and with it every level-up/respec prefill. Carry the stored ledger forward
  // unless the caller supplies one of its own (the builder does).
  const storedChoices = definition.character?.choices;
  const merged = character !== undefined && character.choices === undefined && storedChoices !== undefined
    ? { ...character, choices: storedChoices }
    : character;
  replaceDefinition(state, definitionId, { ...definition, character: merged });
}

export function setCharacterProficiencies(state: GameState, actorId: string, proficiencies: ActorDefinition["proficiencies"]): void {
  const { definitionId, definition } = editableDefinition(state, actorId);
  replaceDefinition(state, definitionId, { ...definition, proficiencies });
}

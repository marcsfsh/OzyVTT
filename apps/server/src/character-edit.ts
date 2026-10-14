import type { GameState } from "@vtt/domain";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";

/** Resolves the per-PC editable definition (keyed `import-<actorId>`, 1:1 with the actor). Shared bundle
 *  content is never editable this way, so an edit only touches this one character's sheet. */
function editableDefinition(state: GameState, actorId: string): { definitionId: string; definition: ActorDefinition } {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (actor.kind !== "player-character") throw new CommandRejectedError("Only player characters can be edited here.");
  const definitionId = actor.definitionId;
  if (!definitionId || !definitionId.startsWith("import-"))
    throw new CommandRejectedError("This character has no editable sheet - import one first.");
  const entry = state.definitions.find((candidate) => candidate.id === definitionId);
  if (!entry) throw new CommandRejectedError("This character's sheet is missing.");
  return { definitionId, definition: entry.definition };
}

/** Persists an edited definition, re-validated through the schema so the stored sheet stays canonical. */
function replaceDefinition(state: GameState, definitionId: string, next: ActorDefinition): void {
  const parsed = ActorDefinitionSchema.parse(next);
  state.definitions = state.definitions.map((entry) =>
    entry.id === definitionId ? { id: entry.id, definition: parsed } : entry
  );
}

/**
 * Merges a supplied block over the stored one, carrying forward every field the caller omitted. Each
 * sheet editor sends a narrow slice of a block, so a wholesale replace would destroy fields it doesn't
 * know about (the `choices` ledger, training, import overrides). Absence means "leave alone"; to clear
 * a field, supply it explicitly.
 */
function carryForwardOmitted<T extends object>(stored: T | undefined, supplied: T | undefined): T | undefined {
  if (supplied === undefined) return stored;
  if (stored === undefined) return supplied;
  const merged = { ...supplied } as Record<string, unknown>;
  for (const [key, value] of Object.entries(stored)) {
    if (merged[key] === undefined) merged[key] = value;
  }
  return merged as T;
}

type CharacterIdentity = NonNullable<ActorDefinition["character"]>;
type ClassRow = CharacterIdentity["classes"][number];

/**
 * Multiclass-safe merge for the class list. Rows are keyed by class id: a supplied row wins
 * field-by-field over the stored one (so clearing a subclass works), an omitted `hitDie` is carried
 * forward, and stored rows the caller didn't mention are kept. Dropping a class is a builder/respec
 * operation, never a side effect of a partial edit.
 */
function mergeClassRows(stored: readonly ClassRow[], supplied: readonly ClassRow[]): ClassRow[] {
  const merged = supplied.map((row) => {
    const previous = stored.find((candidate) => candidate.id === row.id);
    return previous?.hitDie !== undefined && row.hitDie === undefined ? { ...row, hitDie: previous.hitDie } : row;
  });
  const suppliedIds = new Set(merged.map((row) => row.id));
  return [...merged, ...stored.filter((row) => !suppliedIds.has(row.id))];
}

export function setCharacterIdentity(state: GameState, actorId: string, character: ActorDefinition["character"]): void {
  const { definitionId, definition } = editableDefinition(state, actorId);
  // The table's level cap applies here too, or the free-text identity editor bypasses it. Summed across classes.
  const requested = (character?.classes ?? []).reduce((total, row) => total + row.level, 0);
  if (requested > state.builderPolicy.maxLevel)
    throw new CommandRejectedError(`This table builds characters up to level ${state.builderPolicy.maxLevel}.`);
  const stored = definition.character;
  const merged = carryForwardOmitted(stored, character);
  const next =
    merged !== undefined && stored !== undefined
      ? { ...merged, classes: mergeClassRows(stored.classes, merged.classes) }
      : merged;
  replaceDefinition(state, definitionId, { ...definition, character: next });
}

export function setCharacterProficiencies(
  state: GameState,
  actorId: string,
  proficiencies: ActorDefinition["proficiencies"]
): void {
  const { definitionId, definition } = editableDefinition(state, actorId);
  replaceDefinition(state, definitionId, {
    ...definition,
    proficiencies: carryForwardOmitted(definition.proficiencies, proficiencies)
  });
}

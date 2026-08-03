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

/**
 * Merge a caller-supplied block over the stored one, carrying forward every field the caller OMITTED.
 *
 * Each editor on the sheet sends a NARROW SLICE of a block - the proficiency editor sends only
 * `{saves, skills}`, the identity editor only class/race/background/feats - so replacing a block
 * wholesale silently destroys whatever that editor knows nothing about: the builder's `choices`
 * provenance ledger, armor/weapon/tool/language training, an import's `*Overrides` totals. Fixing
 * that one field at a time is what left `proficiencies` broken after `character.choices` was fixed,
 * so the rule lives here once: "undefined means not supplied", and preservation is the DEFAULT. A
 * field added to the schema tomorrow survives an old client's edit with no further change here.
 *
 * A caller that genuinely wants to CLEAR a field supplies it explicitly (an empty array, a new
 * value); only absence is read as "leave this alone".
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
 * Multiclass-safe merge for the class LIST, where the field-level rule above is not enough: a caller
 * that renders one class row (the sheet's identity editor did exactly that) sends a one-element
 * array, which as a plain replacement deletes a Fighter 3 / Wizard 2's Wizard levels outright - and
 * any caller that predates `hitDie` strips the die the multiclass Hit-Dice pool is built from.
 *
 * Rows are keyed by class id: a supplied row wins field-by-field over the stored row of the same id
 * (so clearing a subclass still works), an omitted `hitDie` is carried forward, and stored rows the
 * caller never mentioned are KEPT. Dropping a class is therefore a deliberate builder/respec
 * operation, never something a partial identity edit can do by omission.
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
  // The table's level cap is a table rule, not a builder rule: the sheet's free-text identity editor
  // writes class levels directly, so without this check the shallow door walks straight past the cap
  // the guided builder enforces. Totalled across classes - a multiclass sheet's level is the sum.
  const requested = (character?.classes ?? []).reduce((total, row) => total + row.level, 0);
  if (requested > state.builderPolicy.maxLevel) throw new CommandRejectedError(`This table builds characters up to level ${state.builderPolicy.maxLevel}.`);
  const stored = definition.character;
  const merged = carryForwardOmitted(stored, character);
  const next = merged !== undefined && stored !== undefined
    ? { ...merged, classes: mergeClassRows(stored.classes, merged.classes) }
    : merged;
  replaceDefinition(state, definitionId, { ...definition, character: next });
}

export function setCharacterProficiencies(state: GameState, actorId: string, proficiencies: ActorDefinition["proficiencies"]): void {
  const { definitionId, definition } = editableDefinition(state, actorId);
  replaceDefinition(state, definitionId, { ...definition, proficiencies: carryForwardOmitted(definition.proficiencies, proficiencies) });
}

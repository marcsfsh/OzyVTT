import type { GameState } from "@vtt/domain";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import { reconcileEquipment } from "./inventory.js";

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

/** Persists an edited definition, re-validated through the schema so the stored sheet stays canonical. What the
 *  actor stores from its sheet is derived again: a feat, a class feature or armor training can move its AC. */
function replaceDefinition(
  state: GameState,
  actorId: string,
  definitionId: string,
  next: ActorDefinition,
  catalog: EquipmentCatalog | undefined
): void {
  const parsed = ActorDefinitionSchema.parse(next);
  state.definitions = state.definitions.map((entry) =>
    entry.id === definitionId ? { id: entry.id, definition: parsed } : entry
  );
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (actor) reconcileEquipment(actor, parsed, { ...(catalog ? { catalog } : {}) });
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

/**
 * What a character's identity does at the table, with the display names left out: class rows (id, level,
 * hit die, subclass id), species and background ids, feats, features, the choice ledger and Martial Arts. Feat
 * and feature riders, Weapon Mastery unlocks and the Hit Dice pool all read these.
 */
function mechanicsOf(identity: CharacterIdentity | undefined): string {
  return JSON.stringify({
    classes: (identity?.classes ?? []).map((row) => [row.id, row.level, row.hitDie ?? null, row.subclass?.id ?? null]),
    race: [identity?.race?.id ?? null, identity?.race?.subrace?.id ?? null],
    background: identity?.background?.id ?? null,
    feats: (identity?.feats ?? []).map((feat) => feat.id),
    features: identity?.features ?? null,
    choices: identity?.choices ?? null,
    martialArts: identity?.martialArts ?? null
  });
}

/**
 * A light hand-edit of identity. A player may rename (class, subclass, species, background) but changes nothing
 * the rules read: levels, classes, feats, features and the choice ledger are the GM's, or the builder's. On a
 * sheet built here (it carries the choice ledger) the builder owns all of those, for the GM too, since a hand
 * change would not be validated and the next rebuild would drop it.
 */
export function setCharacterIdentity(
  state: GameState,
  actorId: string,
  character: ActorDefinition["character"],
  editor: Readonly<{ gm: boolean }> = { gm: true },
  catalog?: EquipmentCatalog
): void {
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
  const built = stored?.choices !== undefined;
  if ((built || !editor.gm) && mechanicsOf(next) !== mechanicsOf(stored))
    throw new CommandRejectedError(
      built
        ? "This character was built here: change classes, levels and feats in the Level flow, which checks them."
        : "Only the GM can change a character's classes, levels or feats - you can rename them."
    );
  replaceDefinition(state, actorId, definitionId, { ...definition, character: next }, catalog);
}

export function setCharacterProficiencies(
  state: GameState,
  actorId: string,
  proficiencies: ActorDefinition["proficiencies"],
  catalog?: EquipmentCatalog
): void {
  const { definitionId, definition } = editableDefinition(state, actorId);
  replaceDefinition(
    state,
    actorId,
    definitionId,
    { ...definition, proficiencies: carryForwardOmitted(definition.proficiencies, proficiencies) },
    catalog
  );
}

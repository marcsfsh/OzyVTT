import type { HomebrewContentType } from "@vtt/api-contract";
import type { GameState } from "@vtt/domain";
import { catalogIdOf, characterChoices, type ActorDefinition } from "@vtt/schemas";

/**
 * What refers to a homebrew record, computed on demand. Character usages are informational (built definitions are
 * self-contained); monster usages are live, since actions and defences re-resolve per use. Usages need a uuid owner.
 */

export type HomebrewUsage = Readonly<{
  actorId: string;
  actorName: string;
  /** An open slug naming WHERE the reference sits ("class", "inventory", "definition", "choice", ...). */
  kind: string;
  /** One short human sentence for the dialog, or null when the kind says everything. */
  detail: string | null;
}>;

/** The contract requires a uuid; anything else is skipped rather than sent as a malformed usage. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** All usages in one pass: the library asks per row, and each state snapshot is a full clone. */
export type HomebrewUsageIndex = Readonly<{
  of: (type: HomebrewContentType, id: string) => readonly HomebrewUsage[];
}>;

export function buildHomebrewUsageIndex(state: GameState): HomebrewUsageIndex {
  const byKey = new Map<string, HomebrewUsage[]>();
  const record = (type: HomebrewContentType, id: string | undefined, usage: HomebrewUsage) => {
    if (!id) return;
    const key = `${type}:${id}`;
    const existing = byKey.get(key);
    if (existing) existing.push(usage);
    else byKey.set(key, [usage]);
  };

  const definitionsById = new Map(state.definitions.map((entry) => [entry.id, entry.definition]));

  for (const actor of state.actors) {
    if (!UUID.test(actor.id)) continue;
    const at = (kind: string, detail: string | null): HomebrewUsage => ({
      actorId: actor.id,
      actorName: actor.name,
      kind,
      detail
    });

    // A monster token re-resolves its definition on every action, recharge and damage roll.
    if (actor.definitionId)
      record(
        "monster",
        actor.definitionId,
        at("definition", "on the table right now - action and defence edits reach it immediately")
      );

    for (const item of actor.inventory) {
      record("equipment", catalogIdOf(item), at("inventory", `carried by ${actor.name}`));
      // A bound template also references its base; deleting the base strands the bind.
      if (item.baseId !== undefined)
        record("equipment", item.baseId, at("inventory", `bound base of ${item.name}, carried by ${actor.name}`));
    }
    for (const spellId of actor.preparedSpellIds)
      record("spell", spellId, at("prepared-spell", `prepared by ${actor.name}`));
    for (const entry of actor.spellbook) record("spell", entry.id, at("spellbook", `in ${actor.name}'s spellbook`));

    const definition = actor.definitionId ? definitionsById.get(actor.definitionId) : undefined;
    if (definition) recordDefinitionUsages(definition, record, at);
  }

  // A queued import has no actor yet; included when its queue id is a uuid.
  for (const pending of state.pendingImports) {
    if (!UUID.test(pending.id)) continue;
    const at = (kind: string, detail: string | null): HomebrewUsage => ({
      actorId: pending.id,
      actorName: pending.name,
      kind,
      detail
    });
    recordDefinitionUsages(pending.definition, record, at);
  }

  return { of: (type, id) => byKey.get(`${type}:${id}`) ?? [] };
}

/** `character.choices[]` is the only record of which homebrew feat or option was taken. */
function recordDefinitionUsages(
  definition: ActorDefinition,
  record: (type: HomebrewContentType, id: string | undefined, usage: HomebrewUsage) => void,
  at: (kind: string, detail: string | null) => HomebrewUsage
) {
  const character = definition.character;

  // `kind` is an open slug: map only kinds that name a content record and skip the rest.
  for (const choice of characterChoices(character)) {
    const type = CHOICE_KIND_TYPES[choice.kind];
    if (type) record(type, choice.id, at("choice", `chosen at level ${choice.level}`));
  }

  for (const entry of character?.classes ?? []) {
    record("class", entry.id, at("class", `level ${entry.level} ${entry.name}`));
    record("subclass", entry.subclass?.id, at("subclass", entry.subclass?.name ?? null));
  }
  record("species", character?.race?.id, at("species", character?.race?.name ?? null));
  record("species", character?.race?.subrace?.id, at("species", character?.race?.subrace?.name ?? null));
  record("background", character?.background?.id, at("background", character?.background?.name ?? null));
  for (const feat of character?.feats ?? []) record("feat", feat.id, at("feat", feat.name));

  for (const spell of definition.spellcasting?.spells ?? []) {
    record("spell", spell.id, at("spell", spell.name));
    record("class", spell.classId, at("spell", `casts ${spell.name}`));
  }
  for (const entry of definition.spellcasting?.classes ?? []) record("class", entry.classId, at("spellcasting", null));
  for (const item of definition.startingInventory ?? []) {
    record("equipment", item.id, at("starting-inventory", item.name));
    if (item.baseId !== undefined)
      record("equipment", item.baseId, at("starting-inventory", `bound base of ${item.name}`));
  }
}

/** Choice kinds that name a record type; unknown kinds are skipped. "asi-or-feat" is covered by its feat row. */
const CHOICE_KIND_TYPES: Readonly<Record<string, HomebrewContentType | undefined>> = {
  feat: "feat",
  subclass: "subclass",
  lineage: "species",
  spell: "spell",
  cantrip: "spell",
  equipment: "equipment"
};

/** Single-record convenience for callers that genuinely want one id (tests, a usages GET). */
export function homebrewUsages(state: GameState, type: HomebrewContentType, id: string): readonly HomebrewUsage[] {
  return buildHomebrewUsageIndex(state).of(type, id);
}

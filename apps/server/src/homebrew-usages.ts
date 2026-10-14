import type { HomebrewContentType } from "@vtt/api-contract";
import type { GameState } from "@vtt/domain";
import { characterChoices, type ActorDefinition } from "@vtt/schemas";

/**
 * What refers to a homebrew record, computed ON DEMAND over `GameState`. There is deliberately no
 * persisted reverse index: the write paths that could invalidate one are many and the data volume is
 * a home group's tens of actors, so a scan is both cheaper to keep correct and cheaper to run.
 *
 * WHAT A USAGE MEANS, and the answer differs by type - the UI copy depends on getting this right:
 *
 *   CHARACTER CONTENT (class, subclass, species, background, feat, spell, equipment, spell-list) -
 *   INFORMATIONAL, NEVER BLOCKING. `buildCharacterDefinition` writes a flattened, self-contained
 *   `ActorDefinition` and the sheet reads THAT, not the catalog. Editing or deleting a homebrew class
 *   changes nothing about an existing character until an explicit rebuild. Say so in the dialog: it
 *   is the difference between a scary warning and a calm one.
 *
 *   MONSTERS - NOT informational. `instantiate` value-copies HP, AC, speed, size and immunities at add
 *   time, but ACTIONS ARE LATE-BOUND: the action list, attack/save/damage resolution, recharge rolls,
 *   rest and encounter pool clearing and `useLimitFor` all re-resolve the definition per use. So
 *   editing a published creature's actions takes effect on every live instance IMMEDIATELY,
 *   mid-fight, and renaming an action id orphans its uses counter. Typed damage defences are read
 *   from the definition at damage time too. A monster's usage count is a live-instance count and
 *   deserves the stronger warning.
 *
 * SOFT DELETE stays safe regardless, because `HomebrewStore.monsterForInstance` is status-blind: a
 * deleted creature's live tokens keep their actions, defences and recharge behaviour.
 *
 * SCOPE, and it is a contract constraint rather than a judgement: `HomebrewUsageSchema.actorId` is a
 * REQUIRED uuid, so every usage this returns has to hang off something with a uuid. In practice that
 * loses nothing that matters - `character.create` always instantiates an actor alongside the
 * definition it stores, so a built character is always reachable - but a stored definition with no
 * actor, and a pending import whose queue id is not a uuid, are skipped rather than misreported.
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

/**
 * One pass over the whole state, producing every usage of every homebrew id at once.
 *
 * Built as an INDEX rather than a per-id scan because the library list asks "how many usages?" for
 * every row on the page, and `GameStore.snapshot` structured-clones the campaign on each read - a
 * per-row scan would clone it once per row.
 */
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
    const at = (kind: string, detail: string | null): HomebrewUsage => ({ actorId: actor.id, actorName: actor.name, kind, detail });

    // A monster token names its content id directly. This is the reference that is NOT informational:
    // the definition is re-resolved on every action, recharge and damage roll.
    if (actor.definitionId) record("monster", actor.definitionId, at("definition", "on the table right now - action and defence edits reach it immediately"));

    // Live actor state the player mutates during play.
    for (const item of actor.inventory) {
      record("equipment", item.id, at("inventory", `carried by ${actor.name}`));
      // C9: a bound template references its BASE too - deleting the base strands the bind (the
      // write path fails open, freezing the copied stats, but the pick can never be re-made).
      if (item.baseId !== undefined) record("equipment", item.baseId, at("inventory", `bound base of ${item.name}, carried by ${actor.name}`));
    }
    for (const spellId of actor.preparedSpellIds) record("spell", spellId, at("prepared-spell", `prepared by ${actor.name}`));

    const definition = actor.definitionId ? definitionsById.get(actor.definitionId) : undefined;
    if (definition) recordDefinitionUsages(definition, record, at);
  }

  // A queued import is a definition with no actor yet; include it when its queue id is a uuid so the
  // GM is not surprised by a reference appearing the moment they approve it.
  for (const pending of state.pendingImports) {
    if (!UUID.test(pending.id)) continue;
    const at = (kind: string, detail: string | null): HomebrewUsage => ({ actorId: pending.id, actorName: pending.name, kind, detail });
    recordDefinitionUsages(pending.definition, record, at);
  }

  return { of: (type, id) => byKey.get(`${type}:${id}`) ?? [] };
}

/**
 * Everything a stored `ActorDefinition` names. `character.choices[]` is scanned FIRST and on purpose:
 * it is the only place recording which homebrew feat, option or fighting style a character actually
 * took, because most riders are flattened into `actions`/`traits`/`proficiencies` at build time and
 * lose their source id on the way.
 */
function recordDefinitionUsages(
  definition: ActorDefinition,
  record: (type: HomebrewContentType, id: string | undefined, usage: HomebrewUsage) => void,
  at: (kind: string, detail: string | null) => HomebrewUsage
) {
  const character = definition.character;

  // The provenance ledger. `kind` is an open slug, so map only the ones that name a content record;
  // an unknown kind is skipped rather than guessed at.
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
    if (item.baseId !== undefined) record("equipment", item.baseId, at("starting-inventory", `bound base of ${item.name}`));
  }
}

/**
 * Which choice `kind` slugs name which record type. `kind` is an OPEN slug by design (a homebrew
 * feature invents its own), so this is a best-effort map and an unrecognised kind contributes no
 * usage rather than a wrong one. "asi-or-feat" is excluded deliberately: its id is either the literal
 * "asi" or a feat id, and the feat case already writes a "feat" row of its own.
 */
const CHOICE_KIND_TYPES: Readonly<Record<string, HomebrewContentType | undefined>> = {
  feat: "feat", subclass: "subclass", lineage: "species",
  spell: "spell", cantrip: "spell", equipment: "equipment"
};

/** Single-record convenience for callers that genuinely want one id (tests, a usages GET). */
export function homebrewUsages(state: GameState, type: HomebrewContentType, id: string): readonly HomebrewUsage[] {
  return buildHomebrewUsageIndex(state).of(type, id);
}

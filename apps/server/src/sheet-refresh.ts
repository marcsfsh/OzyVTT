import { isDeepStrictEqual } from "node:util";
import type { BuilderPolicy, GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { BUILDER_SOURCE_NAME, fightHolding, rebuildActorDefinition, withDefinitionProseFacts } from "./actor-roster.js";
import { buildCharacterDefinition } from "./character-build.js";
import type { ContentView } from "./content-library.js";
import { CONTENT_STAMP } from "./content-stamp.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import { buildRequestOf } from "./ledger-rechoice.js";
import { proficiencyEditOf, proficiencyEditRow, withProficiencyEditRow } from "./sheet-proficiency-edits.js";

/**
 * Features, actions and riders are baked into a built sheet, so a content fix would reach a character only at its next
 * level up. Each stored character built here is rebuilt from its choices ledger at the same level when the content it
 * was built from changed: the SRD bundles or the builder (its `source.version` stamp), or the homebrew (`everyone`).
 * The rebuild is the level-up's (`rebuildActorDefinition`), so hit points, spent uses, slots and Hit Dice, inventory,
 * conditions, effects and notes stay as they are. A character in a fight waits for the fight to end. A rebuild the
 * current content refuses leaves the old sheet, and the reason goes to the GM.
 */

export type SheetRefreshDeps = Readonly<{
  library: ContentView;
  policy: BuilderPolicy;
  catalog?: EquipmentCatalog;
}>;

export type SheetRefreshFailure = Readonly<{ actorId: string; name: string; reason: string }>;

export type SheetRefresh = Readonly<{
  /** Rebuilt with a sheet that changed. */
  rebuilt: readonly string[];
  /** The same sheet as before, stamped with the current content. */
  stamped: readonly string[];
  /** In a fight: rebuilt once it ends. */
  waiting: readonly string[];
  failed: readonly SheetRefreshFailure[];
}>;

/** A sheet the builder made here, with the ledger a rebuild reads. */
function isBuiltHere(definition: ActorDefinition | undefined): definition is ActorDefinition {
  return definition?.source?.name === BUILDER_SOURCE_NAME && definition.character?.choices !== undefined;
}

/** Whether this built sheet was made from other content than the current. */
export function builtFromOlderContent(definition: ActorDefinition | undefined): boolean {
  return isBuiltHere(definition) && definition.source.version !== CONTENT_STAMP;
}

/** The names a player or the GM gave on the sheet (Edit names), kept over the content's own where the ids agree. */
function withGivenNames(previous: ActorDefinition, next: ActorDefinition): ActorDefinition {
  const before = previous.character;
  const after = next.character;
  if (!before || !after) return next;
  const named = <T extends { id: string; name: string }>(stored: T | undefined, built: T | undefined): T | undefined =>
    built && stored?.id === built.id ? { ...built, name: stored.name } : built;
  const classes = after.classes.map((row) => {
    const stored = before.classes.find((candidate) => candidate.id === row.id);
    return {
      ...row,
      ...(stored ? { name: stored.name } : {}),
      ...(row.subclass ? { subclass: named(stored?.subclass, row.subclass) } : {})
    };
  });
  const race = after.race
    ? {
        ...named(before.race, after.race)!,
        ...(after.race.subrace ? { subrace: named(before.race?.subrace, after.race.subrace) } : {})
      }
    : undefined;
  return {
    ...next,
    character: {
      ...after,
      classes,
      ...(race ? { race } : {}),
      ...(after.background ? { background: named(before.background, after.background) } : {})
    }
  };
}

/** Two sheets alike in everything but the content stamp. */
function sameSheet(left: ActorDefinition, right: ActorDefinition): boolean {
  const plain = (definition: ActorDefinition) =>
    JSON.parse(JSON.stringify({ ...definition, source: { ...definition.source, version: "" } })) as unknown;
  return isDeepStrictEqual(plain(left), plain(right));
}

/** The sheet the current content builds from this one's ledger, with its given names and hand edits kept. */
function rebuiltSheet(previous: ActorDefinition, deps: SheetRefreshDeps): ActorDefinition {
  const request = buildRequestOf(previous, deps.library);
  if (!request) throw new CommandRejectedError("Its ability scores can't be read back from the sheet.");
  let built = buildCharacterDefinition(request, deps.library, deps.policy);
  // A proficiency hand edit made before edits were kept in the ledger is recorded the first time, so it isn't lost.
  if (!proficiencyEditOf(request.choices)) {
    const edit = proficiencyEditRow(built.proficiencies, previous.proficiencies);
    if (edit)
      built = buildCharacterDefinition(
        { ...request, choices: withProficiencyEditRow(request.choices, edit) },
        deps.library,
        deps.policy
      );
  }
  return withDefinitionProseFacts(withGivenNames(previous, built));
}

/**
 * Rebuilds every stored character built from older content, and every built character when `everyone` (the homebrew
 * changed) or named in `also` (a homebrew change found it in a fight). Mutates `state`.
 */
export function refreshBuiltSheets(
  state: GameState,
  deps: SheetRefreshDeps,
  options: Readonly<{ everyone?: boolean; also?: ReadonlySet<string> }> = {}
): SheetRefresh {
  const rebuilt: string[] = [];
  const stamped: string[] = [];
  const waiting: string[] = [];
  const failed: SheetRefreshFailure[] = [];
  for (const actor of state.actors) {
    if (actor.kind !== "player-character" || actor.definitionId !== `import-${actor.id}`) continue;
    const index = state.definitions.findIndex((entry) => entry.id === actor.definitionId);
    const previous = index >= 0 ? state.definitions[index].definition : undefined;
    if (!isBuiltHere(previous)) continue;
    const stale = previous.source.version !== CONTENT_STAMP;
    if (!stale && options.everyone !== true && options.also?.has(actor.id) !== true) continue;
    let next: ActorDefinition;
    try {
      next = rebuiltSheet(previous, deps);
    } catch (error) {
      if (!(error instanceof CommandRejectedError)) throw error;
      failed.push({ actorId: actor.id, name: actor.name, reason: error.message });
      continue;
    }
    if (sameSheet(previous, next)) {
      if (!stale) continue;
      state.definitions[index] = { id: state.definitions[index].id, definition: next };
      stamped.push(actor.id);
      continue;
    }
    if (fightHolding(state, actor.id) !== null) {
      waiting.push(actor.id);
      continue;
    }
    rebuildActorDefinition(state, actor.id, next, deps.catalog);
    rebuilt.push(actor.id);
  }
  return { rebuilt, stamped, waiting, failed };
}

/** Whether a character built from older content, or named in `also`, is free to be rebuilt now (out of every fight).
 *  The ones in `skip` (refused by the current content) wait for the next content change. */
export function refreshIsDue(
  state: GameState,
  options: Readonly<{ also?: ReadonlySet<string>; skip?: ReadonlySet<string> }> = {}
): boolean {
  return state.actors.some((actor) => {
    if (actor.kind !== "player-character" || actor.definitionId !== `import-${actor.id}`) return false;
    if (options.skip?.has(actor.id) === true || fightHolding(state, actor.id) !== null) return false;
    const definition = state.definitions.find((entry) => entry.id === actor.definitionId)?.definition;
    return options.also?.has(actor.id) === true || builtFromOlderContent(definition);
  });
}

import { makeHitDicePool, type Actor, type ActorDefinition, type GameState, type HitDiceEntry } from "@vtt/domain";
import {
  abilityModifier, armorClassFromEquipment, hitDicePool, multiclassCasterLevel, multiclassPactSlots, multiclassSpellSlots,
  type ClassLevelEntry
} from "@vtt/rules-5e";
import { endEffectsSustainedBy } from "./effects.js";
import { CommandRejectedError } from "./game-store.js";

const MAX_ACTORS = 200;
const MAX_IMPORTED_DEFINITIONS = 100;

/** "Goblin Warrior" -> "Goblin Warrior 2" -> "Goblin Warrior 3" ... deterministic and collision-free. */
function dedupedName(state: GameState, base: string): string {
  const names = new Set(state.actors.map((actor) => actor.name));
  if (!names.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base} ${suffix}`.slice(0, 120);
    if (!names.has(candidate)) return candidate;
  }
}

/**
 * SRD Hit Point Dice entry from a definition's hit-point formula ("7d8 + 14" → 7 × d8); no parseable
 * formula = unmodeled (null, the fail-open pattern). `DiceFormulaSchema` allows only ONE die term, so
 * this can express a monster or a single-class sheet but never a multiclass pool - see `seedHitDice`.
 */
export function hitDiceFromDefinition(definition: ActorDefinition): HitDiceEntry | null {
  const match = definition.hitPoints.formula?.match(/^(\d+)d(4|6|8|10|12|20)\b/i);
  if (!match) return null;
  const count = Math.min(40, Number.parseInt(match[1], 10));
  if (count < 1) return null;
  return { die: `d${match[2]}` as HitDiceEntry["die"], maximum: count, remaining: count };
}

/** The sheet's class levels in the shape `@vtt/rules-5e` progression math expects. */
function classLevelsOf(definition: ActorDefinition): ClassLevelEntry[] {
  return (definition.character?.classes ?? []).map((entry) => ({ classId: entry.id, level: entry.level, ...(entry.hitDie ? { hitDie: entry.hitDie } : {}) }));
}

/**
 * THE Hit Point Dice pool a live actor is seeded with. A sheet that records its class levels pools
 * one entry per die size (Fighter 3 / Wizard 2 = 3d10 + 2d6) - the hit-point FORMULA cannot express
 * that, so deriving it from `formula` silently dropped every class after the first. Monsters and
 * legacy/PDF sheets with no class levels keep the formula-derived single entry.
 */
export function seedHitDice(definition: ActorDefinition): Actor["hitDice"] {
  const classLevels = classLevelsOf(definition);
  if (classLevels.length > 0) {
    const pool = makeHitDicePool(hitDicePool(classLevels).map((entry) => ({ die: entry.die, maximum: entry.count, remaining: entry.count })));
    if (pool) return pool;
  }
  const single = hitDiceFromDefinition(definition);
  return single ? makeHitDicePool([single]) : null;
}

/**
 * THE spell-slot maxima a character actually has, by slot level. A multiclass builder fills
 * `spellcasting.classes[]` and the SRD combined slot table belongs at the top level; when the top
 * level is empty but per-class casters are declared, derive the combined table from the class levels
 * (SRD Multiclassing) rather than seeding a "modeled caster with zero slots".
 *
 * Single-sourced: seeding (`instantiate`, the example party), the long rest, and the slot-spend clamp
 * all read this, so they can never disagree about a character's maximum.
 */
export function spellSlotMaxima(definition: ActorDefinition | undefined): ReadonlyArray<{ level: number; max: number }> {
  const spellcasting = definition?.spellcasting;
  if (!spellcasting) return [];
  if (spellcasting.slots.length > 0) return spellcasting.slots;
  const casterIds = new Set((spellcasting.classes ?? []).map((entry) => entry.classId));
  if (casterIds.size === 0) return [];
  const casterLevels = classLevelsOf(definition!).filter((entry) => casterIds.has(entry.classId));
  return multiclassSpellSlots(multiclassCasterLevel(casterLevels))
    .map((count, index) => ({ level: index + 1, max: count }))
    .filter((slot) => slot.max > 0);
}

/** Warlock Pact Magic maximum, derived from the Warlock levels when the sheet did not state one. */
export function pactSlotMaximum(definition: ActorDefinition | undefined): { level: number; max: number } | null {
  const spellcasting = definition?.spellcasting;
  if (!spellcasting) return null;
  if (spellcasting.pact) return spellcasting.pact;
  const casterIds = new Set((spellcasting.classes ?? []).map((entry) => entry.classId));
  if (casterIds.size === 0) return null;
  const pact = multiclassPactSlots(classLevelsOf(definition!).filter((entry) => casterIds.has(entry.classId)));
  return pact ? { level: pact.level, max: pact.slots } : null;
}

/** Live spell-slot pools for a freshly instantiated actor; null = not a modeled spellcaster. */
export function seedSpellSlots(definition: ActorDefinition): Actor["spellSlots"] {
  if (!definition.spellcasting) return null;
  return spellSlotMaxima(definition).map((slot) => ({ level: slot.level, remaining: slot.max }));
}

/** Live Pact Magic pool for a freshly instantiated actor; null = no pact pool. */
export function seedPactSlots(definition: ActorDefinition): Actor["pactSlots"] {
  const pact = pactSlotMaximum(definition);
  return pact ? { level: pact.level, remaining: pact.max } : null;
}

/** The spells a sheet starts the day with prepared (defaults the long rest also restores). */
export function seedPreparedSpellIds(definition: ActorDefinition): string[] {
  return definition.spellcasting ? definition.spellcasting.spells.filter((spell) => spell.prepared || spell.alwaysPrepared).map((spell) => spell.id) : [];
}

function instantiate(state: GameState, definition: ActorDefinition, id: string, visibility: "public" | "gm-only", kind: "player-character" | "monster", definitionId: string) {
  if (state.actors.length >= MAX_ACTORS) throw new CommandRejectedError("The roster is full - remove unused combatants first.");
  const inventory = (definition.startingInventory ?? []).map((item) => ({ ...item }));
  state.actors.push({
    id,
    name: dedupedName(state, definition.name),
    kind,
    visibility,
    hp: { current: definition.hitPoints.maximum, maximum: definition.hitPoints.maximum, temporary: 0 },
    // AC derives from equipped armor/shields when the loadout has any (v6 #5); otherwise the stored
    // stat-block AC stands (natural/mage armor, monsters).
    armorClass: armorClassFromEquipment(abilityModifier(definition.abilityScores.dex), inventory) ?? definition.armorClass,
    initiative: definition.initiativeBonus,
    ownerSessionId: null,
    conditions: [],
    effects: [],
    deathSaves: null,
    actionUses: {},
    conditionImmunities: definition.conditionImmunities ? [...definition.conditionImmunities] : [],
    speedFeet: definition.speedFeet,
    ...(definition.legendary ? { legendary: { ...definition.legendary } } : {}),
    hitDice: seedHitDice(definition),
    spellSlots: seedSpellSlots(definition),
    pactSlots: seedPactSlots(definition),
    preparedSpellIds: seedPreparedSpellIds(definition),
    inventory,
    currency: definition.startingCurrency ? { ...definition.startingCurrency } : { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    archived: false,
    ...(definition.summary ? { notes: definition.summary } : {}),
    definitionId,
    size: definition.size,
    sizeCells: Math.max(definition.token.footprint.width, definition.token.footprint.height)
  });
}

export function addActorFromDefinition(state: GameState, definition: ActorDefinition, id: string, visibility: "public" | "gm-only") {
  if (definition.schemaId !== "vtt.actor-monster") throw new CommandRejectedError("Only monster definitions can be added this way.");
  if (!definition.source.externalId) throw new CommandRejectedError("That bundled definition is missing its content id.");
  instantiate(state, definition, id, visibility, "monster", definition.source.externalId);
}

/**
 * Import a canonical ActorDefinition (character or monster) shipped as JSON: the inert
 * definition persists with the campaign and a live actor is instantiated from it. Characters
 * become claimable player-characters; the ActorDefinitionSchema already forces them friendly.
 */
export function importActorDefinition(state: GameState, definition: ActorDefinition, actorId: string, visibility: "public" | "gm-only") {
  if (state.definitions.length >= MAX_IMPORTED_DEFINITIONS) throw new CommandRejectedError("The imported-sheet library is full - remove unused combatants first.");
  const definitionId = `import-${actorId}`;
  const kind = definition.schemaId === "vtt.actor-character" ? "player-character" as const : "monster" as const;
  instantiate(state, definition, actorId, visibility, kind, definitionId);
  state.definitions = [...state.definitions, { id: definitionId, definition }];
}

/** Queue a player-submitted import for GM approval; the definition is pre-validated by the caller. */
export function submitPendingImport(state: GameState, definition: ActorDefinition, id: string, submittedBy: string) {
  if (state.pendingImports.length >= 20) throw new CommandRejectedError("The import queue is full - ask your GM to review the pending sheets first.");
  state.pendingImports = [...state.pendingImports.filter((entry) => entry.id !== id), { id, name: definition.name, submittedBy, definition }];
}

/** GM decision on a queued import: approving instantiates a claimable actor; either way it leaves the queue. */
export function resolvePendingImport(state: GameState, importId: string, approve: boolean, newActorId: string) {
  const pending = state.pendingImports.find((entry) => entry.id === importId);
  if (!pending) throw new CommandRejectedError("That pending import is no longer in the queue.");
  state.pendingImports = state.pendingImports.filter((entry) => entry.id !== importId);
  if (approve) importActorDefinition(state, pending.definition, newActorId, "public");
}

export function removeActor(state: GameState, actorId: string) {
  const actor = state.actors.find((item) => item.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (actor.kind === "player-character" && actor.ownerSessionId !== null) throw new CommandRejectedError("Release that character's claim before removing it.");
  if (actor.kind === "player-character" && !actor.definitionId?.startsWith("import-")) throw new CommandRejectedError("Player characters can't be removed from the roster.");
  // A recorded turn snapshot may reference this actor; removing it while rewound would leave the
  // restore pointing at a combatant that no longer exists. Make the GM leave history review first.
  if (state.combat.historyCursor !== null) throw new CommandRejectedError("Finish reviewing the combat history before removing a combatant.");
  if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId)) {
    throw new CommandRejectedError("End the encounter before removing a combatant who is in it.");
  }
  // A parked scene can hold a paused, still-active fight; block removal if this actor is in one.
  if (state.combat.scenes.some((scene) => scene.combat.active && scene.combat.initiative.some((entry) => entry.actorId === actorId))) {
    throw new CommandRejectedError("End the paused encounter in the prepared scene that uses this combatant first.");
  }
  // A removed actor can no longer sustain effects on others (its grapples release, ADR-0020).
  endEffectsSustainedBy(state, actorId);
  state.actors = state.actors.filter((item) => item.id !== actorId);
  // Drop the actor from every inactive prepared scene so no scene references a combatant that no longer exists.
  if (state.combat.scenes.some((scene) => !scene.combat.active && (scene.combat.initiative.some((entry) => entry.actorId === actorId) || scene.combat.tokens.some((token) => token.actorId === actorId)))) {
    state.combat = { ...state.combat, scenes: state.combat.scenes.map((scene) => scene.combat.active ? scene : ({ ...scene, combat: { ...scene.combat, initiative: scene.combat.initiative.filter((entry) => entry.actorId !== actorId), tokens: scene.combat.tokens.filter((token) => token.actorId !== actorId) } })) };
  }
  // Imported stat blocks live only for their actors; drop one nothing references anymore.
  if (actor.definitionId?.startsWith("import-") && !state.actors.some((item) => item.definitionId === actor.definitionId)) {
    state.definitions = state.definitions.filter((entry) => entry.id !== actor.definitionId);
  }
  // A finished encounter keeps its initiative for reference; drop this actor's stale entry
  // and token so nothing references a combatant that no longer exists.
  if (!state.combat.active) {
    state.combat = {
      ...state.combat,
      initiative: state.combat.initiative.filter((entry) => entry.actorId !== actorId),
      tokens: state.combat.tokens.filter((token) => token.actorId !== actorId)
    };
  }
}

/** Definition lookup for sheets/actions: imported stat blocks first, then the bundled content. */
export function storedDefinition(state: GameState, definitionId: string): ActorDefinition | undefined {
  return state.definitions.find((entry) => entry.id === definitionId)?.definition;
}

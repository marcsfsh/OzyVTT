import { makeHitDicePool, type Actor, type ActorDefinition, type GameState, type HitDiceEntry } from "@vtt/domain";
import {
  ABILITIES, abilityModifier, armorClassFromEquipment, hitDicePool, multiclassCasterLevel, multiclassPactSlots, multiclassSpellSlots,
  type Ability, type ClassLevelEntry, type UnarmoredDefense
} from "@vtt/rules-5e";
import { endEffectsSustainedBy } from "./effects.js";
import { deriveEquipment, withResolvedSlots, type EquipmentCatalog } from "./equipment-derivation.js";
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

/** SRD Hit Point Dice from a hit-point formula ("7d8 + 14" -> 7 x d8); null if it doesn't parse. One die term only. */
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

/** Seeded Hit Point Dice: one entry per die size from class levels (Fighter 3 / Wizard 2 = 3d10 + 2d6),
 *  else from the formula. */
export function seedHitDice(definition: ActorDefinition): Actor["hitDice"] {
  const classLevels = classLevelsOf(definition);
  if (classLevels.length > 0) {
    const pool = makeHitDicePool(hitDicePool(classLevels).map((entry) => ({ die: entry.die, maximum: entry.count, remaining: entry.count })));
    if (pool) return pool;
  }
  const single = hitDiceFromDefinition(definition);
  return single ? makeHitDicePool([single]) : null;
}

/** Spell-slot maxima by level, deriving the SRD multiclass table when only per-class casters are declared,
 *  plus item slots. Seeding, long rest and the spend clamp all read this. */
export function spellSlotMaxima(definition: ActorDefinition | undefined, equipmentSlots: readonly { level: number; amount: number }[] = []): ReadonlyArray<{ level: number; max: number }> {
  const base = baseSpellSlotMaxima(definition);
  if (equipmentSlots.length === 0) return base;
  const byLevel = new Map(base.map((slot) => [slot.level, slot.max] as const));
  for (const bonus of equipmentSlots) byLevel.set(bonus.level, Math.max(0, (byLevel.get(bonus.level) ?? 0) + bonus.amount));
  return [...byLevel].filter(([, max]) => max > 0).map(([level, max]) => ({ level, max })).sort((a, b) => a.level - b.level);
}

function baseSpellSlotMaxima(definition: ActorDefinition | undefined): ReadonlyArray<{ level: number; max: number }> {
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

/** Live spell-slot pools for a freshly instantiated actor; null when not a modeled spellcaster. */
export function seedSpellSlots(definition: ActorDefinition, equipmentSlots: readonly { level: number; amount: number }[] = []): Actor["spellSlots"] {
  if (!definition.spellcasting) return null;
  return spellSlotMaxima(definition, equipmentSlots).map((slot) => ({ level: slot.level, remaining: slot.max }));
}

/** Live Pact Magic pool for a freshly instantiated actor; null when there is no pact pool. */
export function seedPactSlots(definition: ActorDefinition): Actor["pactSlots"] {
  const pact = pactSlotMaximum(definition);
  return pact ? { level: pact.level, remaining: pact.max } : null;
}

/** The spells a sheet starts the day with prepared (defaults the long rest also restores). */
export function seedPreparedSpellIds(definition: ActorDefinition): string[] {
  return definition.spellcasting ? definition.spellcasting.spells.filter((spell) => spell.prepared || spell.alwaysPrepared).map((spell) => spell.id) : [];
}

/** Flat non-equipment AC (Defense, a ring of protection), kept in the `open5e.srd-2024` extension bag so
 *  re-deriving AC from the loadout doesn't drop it. Absent reads 0. */
export function armorClassRiderOf(definition: ActorDefinition): number {
  // `extensions` is schema-defaulted, but hand-built definitions can lack it; missing means no rider.
  const extension = definition.extensions?.["open5e.srd-2024"];
  if (extension && typeof extension === "object") {
    const value = (extension as { armorClassBonus?: unknown }).armorClassBonus;
    if (typeof value === "number" && Number.isInteger(value) && value >= -10 && value <= 10) return value;
  }
  return 0;
}

/** This sheet's Unarmored Defense for the AC math, or null. Resolved from the authored rider via the
 *  catalog, else the builder's `open5e.srd-2024` bag (ability validated against `ABILITIES` so a bad
 *  string can't make AC NaN). Never inferred from a class name. */
export function unarmoredDefenseOf(definition: ActorDefinition, catalog?: EquipmentCatalog): UnarmoredDefense | null {
  // Live content wins over the bag, which is a build-time snapshot and goes stale when content is
  // corrected (e.g. `allowShield`). The bag is the fallback when the feature can't be resolved (no
  // catalog, deleted homebrew class).
  const fromContent = unarmoredDefenseFromContent(definition, catalog);
  if (fromContent) return fromContent;
  const extension = definition.extensions?.["open5e.srd-2024"];
  if (extension && typeof extension === "object") {
    const value = (extension as { unarmoredDefense?: unknown }).unarmoredDefense;
    if (value && typeof value === "object") {
      const { ability, allowShield } = value as { ability?: unknown; allowShield?: unknown };
      if (typeof ability === "string" && (ABILITIES as readonly string[]).includes(ability)) {
        return { bonus: abilityModifier(definition.abilityScores[ability as Ability]), allowShield: allowShield === true };
      }
    }
  }
  return null;
}

/** Unarmored Defense from the sheet's features then feats (last wins, like `interpretFeature`); fails open to null. */
function unarmoredDefenseFromContent(definition: ActorDefinition, catalog?: EquipmentCatalog): UnarmoredDefense | null {
  if (!catalog) return null;
  const blocks = [
    ...(definition.character?.features ?? []).map((held) => catalog.featureRecord?.(held)),
    ...(definition.character?.feats ?? []).map((held) => catalog.featRecord?.(held.id)?.feature)
  ];
  let found: UnarmoredDefense | null = null;
  for (const block of blocks) {
    for (const modifier of block?.modifiers ?? []) {
      if (modifier.type !== "unarmored-defense" || modifier.ability === undefined) continue;
      found = { bonus: abilityModifier(definition.abilityScores[modifier.ability]), allowShield: modifier.allowShield === true };
    }
  }
  return found;
}

function instantiate(state: GameState, definition: ActorDefinition, id: string, visibility: "public" | "gm-only", kind: "player-character" | "monster", definitionId: string, catalog?: EquipmentCatalog) {
  if (state.actors.length >= MAX_ACTORS) throw new CommandRejectedError("The roster is full - remove unused combatants first.");
  const inventory = (definition.startingInventory ?? []).map((item) => ({ ...item }));
  const equipmentAc = armorClassFromEquipment(abilityModifier(definition.abilityScores.dex), withResolvedSlots(inventory, catalog), unarmoredDefenseOf(definition, catalog));
  // Seeding through the same derivation as inventory writes gives monsters and PDF imports their
  // equipment riders from the start.
  const seed = { inventory, effects: [], conditions: [], hp: { current: definition.hitPoints.maximum, maximum: definition.hitPoints.maximum, temporary: 0 } } as unknown as Actor;
  const derivation = deriveEquipment(seed, definition, catalog);
  state.actors.push({
    id,
    name: dedupedName(state, definition.name),
    kind,
    visibility,
    hp: { current: definition.hitPoints.maximum, maximum: definition.hitPoints.maximum, temporary: 0 },
    // AC derives from equipped armor/shields when there are any; otherwise the stored AC stands
    // (natural armor, monsters). The flat rider is added back so a built definition and its actor agree.
    armorClass: (equipmentAc === null ? definition.armorClass : equipmentAc + armorClassRiderOf(definition)) + derivation.armorClass,
    initiative: definition.initiativeBonus + derivation.initiative,
    ownerSessionId: null,
    conditions: [],
    effects: [],
    deathSaves: null,
    actionUses: {},
    choiceOverrides: {},
    conditionImmunities: definition.conditionImmunities ? [...definition.conditionImmunities] : [],
    speedFeet: definition.speedFeet,
    ...(definition.legendary ? { legendary: { ...definition.legendary } } : {}),
    hitDice: seedHitDice(definition),
    spellSlots: seedSpellSlots(definition, derivation.spellSlots),
    pactSlots: seedPactSlots(definition),
    preparedSpellIds: seedPreparedSpellIds(definition),
    inventory,
    currency: definition.startingCurrency ? { ...definition.startingCurrency } : { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    archived: false,
    sheetPreview: false,
    ...(definition.summary ? { notes: definition.summary } : {}),
    definitionId,
    size: definition.size,
    sizeCells: Math.max(definition.token.footprint.width, definition.token.footprint.height)
  });
}

export function addActorFromDefinition(state: GameState, definition: ActorDefinition, id: string, visibility: "public" | "gm-only", catalog?: EquipmentCatalog) {
  if (definition.schemaId !== "vtt.actor-monster") throw new CommandRejectedError("Only monster definitions can be added this way.");
  if (!definition.source.externalId) throw new CommandRejectedError("That bundled definition is missing its content id.");
  instantiate(state, definition, id, visibility, "monster", definition.source.externalId, catalog);
}

/** Imports a canonical ActorDefinition and instantiates a live actor; characters become claimable. */
export function importActorDefinition(state: GameState, definition: ActorDefinition, actorId: string, visibility: "public" | "gm-only", catalog?: EquipmentCatalog) {
  if (state.definitions.length >= MAX_IMPORTED_DEFINITIONS) throw new CommandRejectedError("The imported-sheet library is full - remove unused combatants first.");
  const definitionId = `import-${actorId}`;
  const kind = definition.schemaId === "vtt.actor-character" ? "player-character" as const : "monster" as const;
  instantiate(state, definition, actorId, visibility, kind, definitionId, catalog);
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

/** Archived characters are out of play; rejected (not filtered) so the GM's selection never silently changes. */
export function assertNotArchived(state: GameState, actorId: string) {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (actor?.archived) throw new CommandRejectedError(`${actor.name} is archived - restore them first.`);
}

/**
 * Rebuilds one character in place (level up/down, respec) from a definition built by
 * `buildCharacterDefinition`. Keeps table identity and campaign state (conditions, effects, notes,
 * currency, re-reconciled inventory); resets sheet-owned resources and derived stats. HP:
 * `current += newMaximum - oldMaximum`, clamped, so 5 -> 3 -> 5 lands where it started.
 */
export function rebuildActorDefinition(state: GameState, actorId: string, definition: ActorDefinition, catalog?: EquipmentCatalog) {
  const actor = state.actors.find((item) => item.id === actorId);
  if (!actor) throw new CommandRejectedError("That character no longer exists.");
  if (actor.kind !== "player-character") throw new CommandRejectedError("Only characters can be rebuilt.");
  const definitionId = `import-${actorId}`;
  // A bundled/example definition is not ours to rewrite.
  if (actor.definitionId !== definitionId) throw new CommandRejectedError("That character was not built here, so it can't be rebuilt.");
  if (state.combat.historyCursor !== null) throw new CommandRejectedError("Finish reviewing the combat history before rebuilding a character.");
  if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId)) {
    throw new CommandRejectedError("End the encounter before rebuilding a character who is in it.");
  }
  // A parked scene can hold a paused fight whose action ids and pools this rebuild would invalidate.
  if (state.combat.scenes.some((scene) => scene.combat.active && scene.combat.initiative.some((entry) => entry.actorId === actorId))) {
    throw new CommandRejectedError("End the paused encounter in the prepared scene that uses this character first.");
  }

  // Carry over the old sheet's `hp-roll` rows for levels the new build doesn't cover, so levelling back
  // up restores the original rolls.
  const previous = state.definitions.find((entry) => entry.id === definitionId)?.definition;
  const rebuilt = rememberHitPointRolls(previous, definition);

  const inventory = actor.inventory.map((item) => ({ ...item }));
  const equipmentAc = armorClassFromEquipment(abilityModifier(definition.abilityScores.dex), withResolvedSlots(inventory, catalog), unarmoredDefenseOf(definition, catalog));
  const derivation = deriveEquipment({ ...actor, inventory } as Actor, definition, catalog);
  const previousMaximum = actor.hp.maximum;
  const maximum = definition.hitPoints.maximum;

  actor.hp = { current: Math.max(0, Math.min(maximum, actor.hp.current + (maximum - previousMaximum))), maximum, temporary: actor.hp.temporary };
  actor.armorClass = (equipmentAc === null ? definition.armorClass : equipmentAc + armorClassRiderOf(definition)) + derivation.armorClass;
  actor.initiative = definition.initiativeBonus + derivation.initiative;
  actor.speedFeet = definition.speedFeet;
  actor.conditionImmunities = definition.conditionImmunities ? [...definition.conditionImmunities] : [];
  actor.hitDice = seedHitDice(definition);
  actor.spellSlots = seedSpellSlots(definition, derivation.spellSlots);
  actor.pactSlots = seedPactSlots(definition);
  actor.preparedSpellIds = seedPreparedSpellIds(definition);
  actor.actionUses = {};
  actor.size = definition.size;
  actor.sizeCells = Math.max(definition.token.footprint.width, definition.token.footprint.height);
  state.definitions = state.definitions.map((entry) => entry.id === definitionId ? { id: definitionId, definition: rebuilt } : entry);
  return actor;
}

/** The new sheet, plus any `hp-roll` row the old one recorded for a level this build does not cover. */
function rememberHitPointRolls(previous: ActorDefinition | undefined, next: ActorDefinition): ActorDefinition {
  const nextChoices = next.character?.choices;
  if (!previous || !nextChoices) return next;
  const carried = (previous.character?.choices ?? []).filter((row) =>
    row.kind === "hp-roll" && !nextChoices.some((candidate) => candidate.kind === "hp-roll" && candidate.level === row.level));
  if (carried.length === 0) return next;
  const choices = [...nextChoices, ...carried].sort((left, right) => left.level - right.level);
  return { ...next, character: { ...next.character!, choices } };
}

export function removeActor(state: GameState, actorId: string) {
  const actor = state.actors.find((item) => item.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  // An archived but still-claimed character can be deleted, releasing the claim in the same mutation.
  // A character still in play keeps the protection.
  if (actor.kind === "player-character" && actor.ownerSessionId !== null) {
    if (!actor.archived) throw new CommandRejectedError("Release that character's claim before removing it.");
    actor.ownerSessionId = null;
  }
  if (actor.kind === "player-character" && !actor.definitionId?.startsWith("import-")) throw new CommandRejectedError("Player characters can't be removed from the roster.");
  // A recorded snapshot may reference this actor; make the GM leave history review first.
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
  // A finished encounter keeps its initiative for reference; drop this actor's entry and token.
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

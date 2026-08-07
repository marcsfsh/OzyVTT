import { makeHitDicePool, type Actor, type ActorDefinition, type GameState, type HitDiceEntry } from "@vtt/domain";
import {
  abilityModifier, armorClassFromEquipment, hitDicePool, multiclassCasterLevel, multiclassPactSlots, multiclassSpellSlots,
  type ClassLevelEntry
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
 *
 * `equipmentSlots` layers an item's granted slots on top (criterion 8: an amulet with one extra
 * 1st-level slot). Because every reader goes through this one function, the seed, the long-rest
 * refill and the spend clamp cannot disagree about the bonus slot either - which is exactly why the
 * rider targets this function rather than writing a number anywhere.
 */
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

/** Live spell-slot pools for a freshly instantiated actor; null = not a modeled spellcaster. */
export function seedSpellSlots(definition: ActorDefinition, equipmentSlots: readonly { level: number; amount: number }[] = []): Actor["spellSlots"] {
  if (!definition.spellcasting) return null;
  return spellSlotMaxima(definition, equipmentSlots).map((slot) => ({ level: slot.level, remaining: slot.max }));
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

/**
 * The flat, NON-equipment Armor Class a sheet carries beyond its armor: the Defense fighting style's
 * "+1 while you wear armor", a ring of protection, a homebrew rider. `ActorDefinition` models only
 * the AC TOTAL, so any path that RE-DERIVES AC from the live loadout would drop it - which is exactly
 * how `definition.armorClass` and the live actor's AC diverged the moment a feature granted flat AC
 * (task-packet risk 3). The builder records it in the open `open5e.srd-2024` extension bag, the same
 * fail-open channel that already carries an import's skills and saving throws; a definition without
 * one (every monster, every PDF import) reads 0 and behaves exactly as before.
 */
export function armorClassRiderOf(definition: ActorDefinition): number {
  // Fail-open: `extensions` is schema-defaulted, but a hand-built definition (tests, older callers)
  // can reach here without it - a missing bag means no rider, never a crash.
  const extension = definition.extensions?.["open5e.srd-2024"];
  if (extension && typeof extension === "object") {
    const value = (extension as { armorClassBonus?: unknown }).armorClassBonus;
    if (typeof value === "number" && Number.isInteger(value) && value >= -10 && value <= 10) return value;
  }
  return 0;
}

function instantiate(state: GameState, definition: ActorDefinition, id: string, visibility: "public" | "gm-only", kind: "player-character" | "monster", definitionId: string, catalog?: EquipmentCatalog) {
  if (state.actors.length >= MAX_ACTORS) throw new CommandRejectedError("The roster is full - remove unused combatants first.");
  const inventory = (definition.startingInventory ?? []).map((item) => ({ ...item }));
  const equipmentAc = armorClassFromEquipment(abilityModifier(definition.abilityScores.dex), withResolvedSlots(inventory, catalog));
  // The SECOND of the two reconciliation points (the other is every inventory write). Seeding through
  // the same derivation is what makes a monster or a PDF import - neither of which ever runs the
  // character builder - carry its equipment's riders from the moment it reaches the table.
  const seed = { inventory, effects: [], conditions: [], hp: { current: definition.hitPoints.maximum, maximum: definition.hitPoints.maximum, temporary: 0 } } as unknown as Actor;
  const derivation = deriveEquipment(seed, definition, catalog);
  state.actors.push({
    id,
    name: dedupedName(state, definition.name),
    kind,
    visibility,
    hp: { current: definition.hitPoints.maximum, maximum: definition.hitPoints.maximum, temporary: 0 },
    // AC derives from equipped armor/shields when the loadout has any (v6 #5); otherwise the stored
    // stat-block AC stands (natural/mage armor, monsters). The sheet's flat rider is added back on
    // top of the derived value, so a builder-made definition and its live actor cannot disagree.
    armorClass: (equipmentAc === null ? definition.armorClass : equipmentAc + armorClassRiderOf(definition)) + derivation.armorClass,
    initiative: definition.initiativeBonus + derivation.initiative,
    ownerSessionId: null,
    conditions: [],
    effects: [],
    deathSaves: null,
    actionUses: {},
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

/**
 * Import a canonical ActorDefinition (character or monster) shipped as JSON: the inert
 * definition persists with the campaign and a live actor is instantiated from it. Characters
 * become claimable player-characters; the ActorDefinitionSchema already forces them friendly.
 */
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

/**
 * Archived characters are OUT OF PLAY, and that has to be true server-side: the picker filters were
 * the only guard, so any caller that replayed a known actorId could stage or start a fight with a
 * character the GM had put away. Rejected rather than silently filtered - a silent filter makes the
 * GM's own selection lie back to them.
 */
export function assertNotArchived(state: GameState, actorId: string) {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (actor?.archived) throw new CommandRejectedError(`${actor.name} is archived - restore them first.`);
}

/**
 * REBUILD one character in place (D13/D14): level up, level down, or respec.
 *
 * The definition is re-assembled by the caller through the very same `buildCharacterDefinition` a
 * fresh create runs, so a rebuild can never be a second, laxer build path. What lands here is the
 * live-actor half, and the rule is stated rather than implied:
 *
 *   KEPT  - identity on the table (id, claim, token image, size/position bookkeeping, visibility),
 *           and everything the CAMPAIGN wrote: conditions, effects, notes, currency, inventory
 *           (re-reconciled through the same derivation an inventory write runs).
 *   RESET - everything the SHEET owns and the new level redefines: spell slots, pact slots, hit
 *           dice, prepared spells, action uses, derived AC/initiative/speed/immunities.
 *   HIT POINTS - `current += (newMaximum - oldMaximum)`, clamped to [0, newMaximum]. Levelling up
 *           feels like growth (the new maximum arrives as usable hit points), levelling down clamps,
 *           and the arithmetic is deterministic - which is what makes a preview round trip
 *           (5 -> 3 -> 5) land back on the number it started from.
 */
export function rebuildActorDefinition(state: GameState, actorId: string, definition: ActorDefinition, catalog?: EquipmentCatalog) {
  const actor = state.actors.find((item) => item.id === actorId);
  if (!actor) throw new CommandRejectedError("That character no longer exists.");
  if (actor.kind !== "player-character") throw new CommandRejectedError("Only characters can be rebuilt.");
  const definitionId = `import-${actorId}`;
  // The editability gate every other sheet edit uses: a bundled/example definition is not ours to rewrite.
  if (actor.definitionId !== definitionId) throw new CommandRejectedError("That character was not built here, so it can't be rebuilt.");
  if (state.combat.historyCursor !== null) throw new CommandRejectedError("Finish reviewing the combat history before rebuilding a character.");
  if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId)) {
    throw new CommandRejectedError("End the encounter before rebuilding a character who is in it.");
  }
  // The same extra guard `removeActor` carries: a parked scene can hold a paused, still-live fight
  // whose action ids and per-encounter pools this rebuild would invalidate.
  if (state.combat.scenes.some((scene) => scene.combat.active && scene.combat.initiative.some((entry) => entry.actorId === actorId))) {
    throw new CommandRejectedError("End the paused encounter in the prepared scene that uses this character first.");
  }

  // THE MEMORY OF THE DICE (D14). A level-down rebuilds levels 2..N, so the new sheet's ledger has
  // nothing to say about the levels that were dropped - and without this the way back up would roll
  // (or average) them again, and a 5 -> 3 -> 5 round trip would land on a different character. The
  // previous sheet's `hp-roll` rows for levels the new build does not cover are carried across, so
  // the character remembers what it rolled even while it is temporarily smaller.
  const previous = state.definitions.find((entry) => entry.id === definitionId)?.definition;
  const rebuilt = rememberHitPointRolls(previous, definition);

  const inventory = actor.inventory.map((item) => ({ ...item }));
  const equipmentAc = armorClassFromEquipment(abilityModifier(definition.abilityScores.dex), withResolvedSlots(inventory, catalog));
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
  // An ARCHIVED character that is still claimed can be deleted, releasing the claim as part of the
  // same mutation: archiving used to leave the claim in place while hiding the character from
  // everyone, so an abandoned claim (a 30-day token expiry mints a new identity) turned the character
  // into undeletable garbage. A character still in play keeps the original protection.
  if (actor.kind === "player-character" && actor.ownerSessionId !== null) {
    if (!actor.archived) throw new CommandRejectedError("Release that character's claim before removing it.");
    actor.ownerSessionId = null;
  }
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

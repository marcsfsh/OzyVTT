import { makeHitDicePool, type Actor, type ActorDefinition, type GameState, type HitDiceEntry } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import {
  ABILITIES,
  abilityModifier,
  armorClassFromEquipment,
  casterProgressionFor,
  hitDicePool,
  multiclassCasterLevel,
  multiclassPactSlots,
  multiclassSpellSlots,
  wornBodyArmor,
  type Ability,
  type ClassLevelEntry,
  type ClassProgressionTable,
  type UnarmoredDefense
} from "@vtt/rules-5e";
import { withProseFacts } from "@vtt/content-srd-5.2.1/action-prose";
import { storedClassSequence } from "./character-offers.js";
import { endEffectsSustainedBy } from "./effects.js";
import { actionPools, effectiveActions } from "./effective-actions.js";
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
  return (definition.character?.classes ?? []).map((entry) => ({
    classId: entry.id,
    level: entry.level,
    ...(entry.hitDie ? { hitDie: entry.hitDie } : {})
  }));
}

/** Seeded Hit Point Dice: one entry per die size from class levels (Fighter 3 / Wizard 2 = 3d10 + 2d6),
 *  else from the formula. */
export function seedHitDice(definition: ActorDefinition): Actor["hitDice"] {
  const classLevels = classLevelsOf(definition);
  if (classLevels.length > 0) {
    const pool = makeHitDicePool(
      hitDicePool(classLevels).map((entry) => ({ die: entry.die, maximum: entry.count, remaining: entry.count }))
    );
    if (pool) return pool;
  }
  const single = hitDiceFromDefinition(definition);
  return single ? makeHitDicePool([single]) : null;
}

/** Spell-slot maxima by level: the SRD multiclass table when only per-class casters are declared,
 *  plus item slots. Seeding, Long Rest and the spend clamp all read this. */
export function spellSlotMaxima(
  definition: ActorDefinition | undefined,
  equipmentSlots: readonly { level: number; amount: number }[] = []
): ReadonlyArray<{ level: number; max: number }> {
  const base = baseSpellSlotMaxima(definition);
  if (equipmentSlots.length === 0) return base;
  const byLevel = new Map(base.map((slot) => [slot.level, slot.max] as const));
  for (const bonus of equipmentSlots)
    byLevel.set(bonus.level, Math.max(0, (byLevel.get(bonus.level) ?? 0) + bonus.amount));
  return [...byLevel]
    .filter(([, max]) => max > 0)
    .map(([level, max]) => ({ level, max }))
    .sort((a, b) => a.level - b.level);
}

function baseSpellSlotMaxima(definition: ActorDefinition | undefined): ReadonlyArray<{ level: number; max: number }> {
  const spellcasting = definition?.spellcasting;
  if (!spellcasting) return [];
  const casterIds = new Set((spellcasting.classes ?? []).map((entry) => entry.classId));
  // A Warlock built before Pact Magic had a pool of its own carried the pact row as its `slots`; those are its pact
  // slots, which `pactSlotMaximum` derives, so counting them here would seed them twice.
  const pactOnly =
    !spellcasting.pact &&
    casterIds.size > 0 &&
    [...casterIds].every((classId) => casterProgressionFor(classId) === "pact");
  if (pactOnly) return [];
  if (spellcasting.slots.length > 0) return spellcasting.slots;
  if (casterIds.size === 0) return [];
  const casterLevels = classLevelsOf(definition!).filter((entry) => casterIds.has(entry.classId));
  return multiclassSpellSlots(multiclassCasterLevel(casterLevels))
    .map((count, index) => ({ level: index + 1, max: count }))
    .filter((slot) => slot.max > 0);
}

/**
 * An imported sheet that lists its casting classes but states no slots, with the slots written in from the
 * table's own class rows. The live reads above fall back to the SRD rows, which know no homebrew class, so a
 * homebrew half caster's levels would otherwise add nothing to the shared table.
 */
export function withDerivedSlots(definition: ActorDefinition, table: ClassProgressionTable): ActorDefinition {
  const spellcasting = definition.spellcasting;
  if (!spellcasting || (spellcasting.slots.length > 0 && spellcasting.pact)) return definition;
  const casterIds = new Set((spellcasting.classes ?? []).map((entry) => entry.classId));
  if (casterIds.size === 0) return definition;
  const casterLevels = classLevelsOf(definition).filter((entry) => casterIds.has(entry.classId));
  const slots =
    spellcasting.slots.length > 0
      ? spellcasting.slots
      : multiclassSpellSlots(multiclassCasterLevel(casterLevels, table))
          .map((count, index) => ({ level: index + 1, max: count }))
          .filter((slot) => slot.max > 0);
  const pact = spellcasting.pact ?? multiclassPactSlots(casterLevels, table);
  return {
    ...definition,
    spellcasting: {
      ...spellcasting,
      slots,
      ...(pact ? { pact: "max" in pact ? pact : { level: pact.level, max: pact.slots } } : {})
    }
  };
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
export function seedSpellSlots(
  definition: ActorDefinition,
  equipmentSlots: readonly { level: number; amount: number }[] = []
): Actor["spellSlots"] {
  if (!definition.spellcasting) return null;
  return spellSlotMaxima(definition, equipmentSlots).map((slot) => ({ level: slot.level, remaining: slot.max }));
}

/** Live Pact Magic pool for a freshly instantiated actor; null when there is no pact pool. */
export function seedPactSlots(definition: ActorDefinition): Actor["pactSlots"] {
  const pact = pactSlotMaximum(definition);
  return pact ? { level: pact.level, remaining: pact.max } : null;
}

/** The spells a sheet starts the day with prepared (defaults the Long Rest also restores). */
export function seedPreparedSpellIds(definition: ActorDefinition): string[] {
  return definition.spellcasting
    ? definition.spellcasting.spells.filter((spell) => spell.prepared || spell.alwaysPrepared).map((spell) => spell.id)
    : [];
}

/** The `source.name` the character builder stamps on what it builds. */
export const BUILDER_SOURCE_NAME = "OzyVTT Character Builder";

/** Whether a sheet's Armor Class is worked out from what the character wears (a built character), where a stat block
 *  or an imported sheet prints a total that already counts its armor. */
export function armorClassFromLoadout(definition: ActorDefinition): boolean {
  // `source` is required by the schema, but hand-built definitions (tests, old fixtures) can lack it.
  return definition.source?.name === BUILDER_SOURCE_NAME;
}

/** Flat non-equipment AC an older build kept in the `open5e.srd-2024` extension bag. Read only for a printed
 *  total; a built character's riders are collected live from its features. Absent reads 0. */
export function armorClassRiderOf(definition: ActorDefinition): number {
  // `extensions` is schema-defaulted, but hand-built definitions can lack it; missing means no rider.
  const extension = definition.extensions?.["open5e.srd-2024"];
  if (extension && typeof extension === "object") {
    const value = (extension as { armorClassBonus?: unknown }).armorClassBonus;
    if (typeof value === "number" && Number.isInteger(value) && value >= -10 && value <= 10) return value;
  }
  return 0;
}

/** This sheet's Unarmored Defenses for the AC math (a Monk/Barbarian has two). Resolved from the authored riders
 *  via the catalog, else the builder's `open5e.srd-2024` bag (ability validated against `ABILITIES` so a bad
 *  string can't make AC NaN). Never inferred from a class name. */
export function unarmoredDefensesOf(definition: ActorDefinition, catalog?: EquipmentCatalog): UnarmoredDefense[] {
  // Live content wins over the bag, which is a build-time snapshot and goes stale when content is
  // corrected (e.g. `allowShield`). The bag is the fallback when the feature can't be resolved (no
  // catalog, deleted homebrew class).
  const fromContent = unarmoredDefensesFromContent(definition, catalog);
  if (fromContent.length > 0) return fromContent;
  const extension = definition.extensions?.["open5e.srd-2024"];
  if (!extension || typeof extension !== "object") return [];
  const { unarmoredDefense, unarmoredDefenses } = extension as {
    unarmoredDefense?: unknown;
    unarmoredDefenses?: unknown;
  };
  return (Array.isArray(unarmoredDefenses) ? unarmoredDefenses : [unarmoredDefense]).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const { ability, allowShield } = value as { ability?: unknown; allowShield?: unknown };
    return typeof ability === "string" && (ABILITIES as readonly string[]).includes(ability)
      ? [{ bonus: abilityModifier(definition.abilityScores[ability as Ability]), allowShield: allowShield === true }]
      : [];
  });
}

/**
 * The AC an actor stores, which attacks read. A GM-set AC wins outright. A built character's AC is what it wears now
 * (SRD: with no armor or Shield, 10 + Dex, or its Unarmored Defense), plus the standing `armor-class` riders of its
 * items and features (Defense applies only while armor is worn). A printed total (a stat block, an imported sheet)
 * already counts the armor it was printed with, so it stands until body armor is equipped; a Shield alone can't be
 * told apart from one it already counts. With several ways to calculate AC (a Monk/Barbarian's two Unarmored
 * Defenses) only one applies at a time (SRD Multiclassing): the best.
 */
export function storedArmorClass(actor: Actor, definition: ActorDefinition, catalog?: EquipmentCatalog): number {
  return armorClassWith(actor, definition, catalog, []);
}

/** `storedArmorClass` with more ways to work out base AC while no armor is worn (Mage Armor's 13 + Dexterity). */
function armorClassWith(
  actor: Actor,
  definition: ActorDefinition,
  catalog: EquipmentCatalog | undefined,
  extra: readonly UnarmoredDefense[]
): number {
  if (actor.armorClassOverride !== undefined) return actor.armorClassOverride;
  const derivation = deriveEquipment(actor, definition, catalog);
  const dex = abilityModifier(definition.abilityScores.dex);
  const items = withResolvedSlots(actor.inventory, catalog);
  const unarmored = [...unarmoredDefensesOf(definition, catalog), ...extra];
  const training = { shield: derivation.untrainedShield === null };
  const worn = [null, ...unarmored]
    .map((option) => armorClassFromEquipment(dex, items, option, training))
    .filter((value): value is number => value !== null);
  const equipmentAc = worn.length > 0 ? Math.max(...worn) : null;
  if (armorClassFromLoadout(definition))
    return (equipmentAc ?? 10 + dex + Math.max(0, ...unarmored.map((option) => option.bonus))) + derivation.armorClass;
  const base =
    equipmentAc !== null && wornBodyArmor(items)
      ? equipmentAc + armorClassRiderOf(definition)
      : Math.max(definition.armorClass, ...extra.map((option) => 10 + dex + option.bonus));
  return base + derivation.armorClass;
}

/**
 * A live effect's way to work out base AC (SRD Mage Armor: "base AC becomes 13 plus its Dexterity modifier") is chosen
 * like Unarmored Defense: the creature's AC with it is the best of its ways, and its other AC bonuses (a Ring of
 * Protection, a Shield) add to it as they add to any. What it raises the stored AC by is kept on the effect as its AC
 * bonus, and worked out again whenever the stored AC is (equipment, content). True when any changed.
 */
export function refreshBaseArmorClass(
  actor: Actor,
  definition: ActorDefinition,
  catalog: EquipmentCatalog | undefined
): boolean {
  if (!actor.effects.some((effect) => effect.baseArmorClass !== undefined)) return false;
  const without = storedArmorClass(actor, definition, catalog);
  let changed = false;
  actor.effects = actor.effects.map((effect) => {
    if (effect.baseArmorClass === undefined) return effect;
    const option = { bonus: effect.baseArmorClass - 10, allowShield: true };
    const gain = Math.min(10, armorClassWith(actor, definition, catalog, [option]) - without);
    const { armorClassBonus: _old, ...rest } = effect;
    const next: typeof effect = gain > 0 ? { ...rest, armorClassBonus: gain } : rest;
    if (next.armorClassBonus !== effect.armorClassBonus) changed = true;
    return next;
  });
  return changed;
}

/** Re-derives every stored AC from current content. Inventory writes reconcile AC, but a homebrew publish or a
 *  content upgrade changes it with no write, and attacks would keep resolving against the old number. True when
 *  any moved. */
export function reconcileArmorClasses(
  state: GameState,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined,
  catalog?: EquipmentCatalog
): boolean {
  let changed = false;
  for (const actor of state.actors) {
    const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
    if (!definition) continue;
    if (refreshBaseArmorClass(actor, definition, catalog)) changed = true;
    const next = storedArmorClass(actor, definition, catalog);
    if (actor.armorClass === next) continue;
    actor.armorClass = next;
    changed = true;
  }
  return changed;
}

/** Gives a speed to an actor whose sheet has one but who never got it, as the example party once didn't. An
 *  unknown speed skips the movement budget, so this is what lets those moves be counted. A speed the GM set is
 *  kept. True when any changed. */
export function fillMissingSpeeds(
  state: GameState,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined
): boolean {
  let changed = false;
  for (const actor of state.actors) {
    if (actor.speedFeet !== undefined || !actor.definitionId) continue;
    const speed = resolveDefinition(actor.definitionId)?.speedFeet;
    if (speed === undefined) continue;
    actor.speedFeet = speed;
    changed = true;
  }
  return changed;
}

/** Every Unarmored Defense the sheet's features and feats carry; fails open to none. */
function unarmoredDefensesFromContent(definition: ActorDefinition, catalog?: EquipmentCatalog): UnarmoredDefense[] {
  if (!catalog) return [];
  const blocks = [
    ...(definition.character?.features ?? []).map((held) => catalog.featureRecord?.(held)),
    ...(definition.character?.feats ?? []).map((held) => catalog.featRecord?.(held.id)?.feature)
  ];
  return blocks.flatMap((block) =>
    (block?.modifiers ?? []).flatMap((modifier) =>
      modifier.type === "unarmored-defense" && modifier.ability !== undefined
        ? [
            {
              bonus: abilityModifier(definition.abilityScores[modifier.ability]),
              allowShield: modifier.allowShield === true
            }
          ]
        : []
    )
  );
}

function instantiate(
  state: GameState,
  definition: ActorDefinition,
  id: string,
  visibility: "public" | "gm-only",
  kind: "player-character" | "monster",
  definitionId: string,
  catalog?: EquipmentCatalog
) {
  if (state.actors.length >= MAX_ACTORS)
    throw new CommandRejectedError("The roster is full. Remove unused combatants first.");
  const inventory = (definition.startingInventory ?? []).map((item) => ({ ...item }));
  // Seeding through the same derivation as inventory writes gives monsters and PDF imports their
  // equipment riders from the start.
  const seed = {
    inventory,
    effects: [],
    conditions: [],
    hp: { current: definition.hitPoints.maximum, maximum: definition.hitPoints.maximum, temporary: 0 }
  } as unknown as Actor;
  const derivation = deriveEquipment(seed, definition, catalog);
  state.actors.push({
    id,
    name: dedupedName(state, definition.name),
    kind,
    visibility,
    hp: { current: definition.hitPoints.maximum, maximum: definition.hitPoints.maximum, temporary: 0 },
    armorClass: storedArmorClass(seed, definition, catalog),
    initiative: definition.initiativeBonus + derivation.initiative,
    ownerSessionId: null,
    conditions: [],
    effects: [],
    deathSaves: null,
    actionUses: {},
    heroicInspiration: false,
    choiceOverrides: {},
    conditionImmunities: definition.conditionImmunities ? [...definition.conditionImmunities] : [],
    speedFeet: definition.speedFeet,
    ...(definition.legendary ? { legendary: { ...definition.legendary } } : {}),
    hitDice: seedHitDice(definition),
    lastLongRestAt: null,
    spellSlots: seedSpellSlots(definition, derivation.spellSlots),
    pactSlots: seedPactSlots(definition),
    preparedSpellIds: seedPreparedSpellIds(definition),
    spellbook: [],
    preparation: null,
    restStep: null,
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

export function addActorFromDefinition(
  state: GameState,
  definition: ActorDefinition,
  id: string,
  visibility: "public" | "gm-only",
  catalog?: EquipmentCatalog
) {
  if (definition.schemaId !== "vtt.actor-monster")
    throw new CommandRejectedError("Only monster definitions can be added this way.");
  if (!definition.source.externalId)
    throw new CommandRejectedError("That bundled definition is missing its content id.");
  instantiate(state, definition, id, visibility, "monster", definition.source.externalId, catalog);
}

/** Imports a canonical ActorDefinition and instantiates a live actor; characters become claimable. */
export function importActorDefinition(
  state: GameState,
  definition: ActorDefinition,
  actorId: string,
  visibility: "public" | "gm-only",
  catalog?: EquipmentCatalog
) {
  if (state.definitions.length >= MAX_IMPORTED_DEFINITIONS)
    throw new CommandRejectedError("The imported-sheet library is full. Remove unused combatants first.");
  const definitionId = `import-${actorId}`;
  const kind = definition.schemaId === "vtt.actor-character" ? ("player-character" as const) : ("monster" as const);
  const filled = withDefinitionProseFacts(definition);
  instantiate(state, filled, actorId, visibility, kind, definitionId, catalog);
  state.definitions = [...state.definitions, { id: definitionId, definition: filled }];
}

/** The definition with its actions' prose facts filled (`withProseFacts`), as it enters the campaign. */
export function withDefinitionProseFacts(definition: ActorDefinition): ActorDefinition {
  const actions = definition.actions.map((action) => withProseFacts(action));
  return actions.every((action, index) => action === definition.actions[index])
    ? definition
    : { ...definition, actions };
}

/** Fills prose facts on stored definitions imported before the fields existed. True when any changed. */
export function fillStoredProseFacts(state: GameState): boolean {
  let changed = false;
  state.definitions = state.definitions.map((entry) => {
    const definition = withDefinitionProseFacts(entry.definition);
    if (definition === entry.definition) return entry;
    changed = true;
    return { id: entry.id, definition };
  });
  return changed;
}

/** Queue a player-submitted import for GM approval; the definition is pre-validated by the caller. */
export function submitPendingImport(state: GameState, definition: ActorDefinition, id: string, submittedBy: string) {
  if (state.pendingImports.length >= 20)
    throw new CommandRejectedError("The import queue is full. Ask your GM to review the pending sheets first.");
  state.pendingImports = [
    ...state.pendingImports.filter((entry) => entry.id !== id),
    { id, name: definition.name, submittedBy, definition }
  ];
}

/** GM decision on a queued import: approving instantiates a claimable actor; either way it leaves the queue. The
 *  catalog gives its carried magic items their riders from the start, as the GM's own import does. */
export function resolvePendingImport(
  state: GameState,
  importId: string,
  approve: boolean,
  newActorId: string,
  catalog?: EquipmentCatalog
) {
  const pending = state.pendingImports.find((entry) => entry.id === importId);
  if (!pending) throw new CommandRejectedError("That pending import is no longer in the queue.");
  state.pendingImports = state.pendingImports.filter((entry) => entry.id !== importId);
  if (approve) importActorDefinition(state, pending.definition, newActorId, "public", catalog);
}

/** Archived characters are out of play; rejected (not filtered) so the GM's selection never silently changes. */
export function assertNotArchived(state: GameState, actorId: string) {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (actor?.archived) throw new CommandRejectedError(`${actor.name} is archived. Restore ${actor.name} first.`);
}

/**
 * Rebuilds one character in place (level up/down, respec) from a definition built by
 * `buildCharacterDefinition`. Keeps table identity and campaign state (conditions, effects, notes,
 * currency, re-reconciled inventory) and what has been spent: a level is not a rest (SRD: "Each time you gain
 * a level, you gain an additional Hit Die"; uses come back only on the rest a feature names), so spent uses,
 * Hit Dice and slots carry over against the new maxima. Derived stats are recomputed. HP:
 * `current += newMaximum - oldMaximum`, clamped, so 5 -> 3 -> 5 lands where it started; a character at 0 stays
 * at 0, since gaining a level neither wakes nor revives anyone.
 */
export function rebuildActorDefinition(
  state: GameState,
  actorId: string,
  definition: ActorDefinition,
  catalog?: EquipmentCatalog
) {
  const actor = state.actors.find((item) => item.id === actorId);
  if (!actor) throw new CommandRejectedError("That character no longer exists.");
  if (actor.kind !== "player-character") throw new CommandRejectedError("Only characters can be rebuilt.");
  const definitionId = `import-${actorId}`;
  // A bundled/example definition is not ours to rewrite.
  if (actor.definitionId !== definitionId)
    throw new CommandRejectedError("That character was not built here, so it can't be rebuilt.");
  if (state.combat.historyCursor !== null)
    throw new CommandRejectedError(
      "Finish reviewing the combat history before rebuilding a character.",
      "history_review"
    );
  if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId)) {
    throw new CommandRejectedError("End the encounter before rebuilding a character who is in it.");
  }
  // A parked scene can hold a paused fight whose action ids and pools this rebuild would invalidate.
  if (
    state.combat.scenes.some(
      (scene) => scene.combat.active && scene.combat.initiative.some((entry) => entry.actorId === actorId)
    )
  ) {
    throw new CommandRejectedError("End the paused encounter in the prepared scene that uses this character first.");
  }

  // Carry over the old sheet's `hp-roll` rows for levels the new build doesn't cover, so levelling back
  // up restores the original rolls.
  const previous = state.definitions.find((entry) => entry.id === definitionId)?.definition;
  // A build carrying fewer classes would silently drop one, unless it levels below where that class was taken.
  if (dropsAClass(previous, definition))
    throw new CommandRejectedError(
      `${actor.name} has more classes than this build carries, and rebuilding would drop them.`
    );
  const rebuilt = rememberHitPointRolls(previous, definition);

  const inventory = actor.inventory.map((item) => ({ ...item }));
  const armorClass = storedArmorClass({ ...actor, inventory } as Actor, definition, catalog);
  const derivation = deriveEquipment({ ...actor, inventory } as Actor, definition, catalog);
  const previousMaximum = actor.hp.maximum;
  const maximum = definition.hitPoints.maximum;

  actor.hp = {
    current: actor.hp.current <= 0 ? 0 : Math.max(0, Math.min(maximum, actor.hp.current + (maximum - previousMaximum))),
    maximum,
    temporary: actor.hp.temporary
  };
  actor.armorClass = armorClass;
  actor.initiative = definition.initiativeBonus + derivation.initiative;
  actor.speedFeet = definition.speedFeet;
  actor.conditionImmunities = definition.conditionImmunities ? [...definition.conditionImmunities] : [];
  actor.hitDice = carriedHitDice(actor.hitDice, seedHitDice(definition));
  actor.spellSlots = carriedSlots(
    actor.spellSlots,
    previous ? spellSlotMaxima(previous, deriveEquipment(actor, previous, catalog).spellSlots) : [],
    seedSpellSlots(definition, derivation.spellSlots)
  );
  actor.pactSlots = carriedPactSlots(actor.pactSlots, pactSlotMaximum(previous), seedPactSlots(definition));
  actor.preparedSpellIds = carriedPreparedSpells(actor.preparedSpellIds, previous, definition);
  actor.actionUses = carriedUses(actor.actionUses, effectiveActions(definition, { ...actor, inventory }, catalog));
  actor.size = definition.size;
  actor.sizeCells = Math.max(definition.token.footprint.width, definition.token.footprint.height);
  state.definitions = state.definitions.map((entry) =>
    entry.id === definitionId ? { id: definitionId, definition: rebuilt } : entry
  );
  return actor;
}

/**
 * Whether a rebuild leaves out a class the stored sheet has. Levelling below the level a class was first taken
 * undoes that class, which is the Level flow's level-down; any other loss (a hand-added class, a single-class build
 * sent for a multiclass sheet) is refused.
 */
function dropsAClass(previous: ActorDefinition | undefined, next: ActorDefinition): boolean {
  const before = previous?.character?.classes ?? [];
  const after = next.character?.classes ?? [];
  if (before.length <= after.length) return false;
  const level = after.reduce((total, entry) => total + entry.level, 0);
  const sequence = storedClassSequence(previous?.character?.choices ?? []);
  const kept = new Set(after.map((entry) => entry.id));
  return before.some((entry) => !kept.has(entry.id) && !(sequence !== null && sequence.indexOf(entry.id) + 1 > level));
}

/** Spent counts kept against the new limits; a pool the new sheet no longer has is dropped. */
function carriedUses(spent: Actor["actionUses"], actions: readonly ActorAction[]): Actor["actionUses"] {
  const limits = new Map(actionPools(actions).map((pool) => [pool.id, pool.limit]));
  const carried: Record<string, number> = {};
  for (const [key, used] of Object.entries(spent)) {
    const limit = limits.get(key);
    if (limit !== undefined && used > 0) carried[key] = Math.min(used, limit);
  }
  return carried;
}

/** The new Hit Dice pool with each die size's spent dice still spent: a level adds a die, it restores none. */
function carriedHitDice(previous: Actor["hitDice"], next: Actor["hitDice"]): Actor["hitDice"] {
  if (!previous || !next) return next;
  return makeHitDicePool(
    next.entries.map((entry) => {
      const before = previous.entries.find((candidate) => candidate.die === entry.die);
      const spent = before ? Math.max(0, before.maximum - before.remaining) : 0;
      return { ...entry, remaining: Math.max(0, entry.maximum - spent) };
    })
  );
}

/** The new slot maxima with each level's spent slots still spent. */
function carriedSlots(
  previous: Actor["spellSlots"],
  previousMaxima: ReadonlyArray<{ level: number; max: number }>,
  next: Actor["spellSlots"]
): Actor["spellSlots"] {
  if (!previous || !next) return next;
  return next.map((slot) => {
    const before = previous.find((candidate) => candidate.level === slot.level);
    const max = previousMaxima.find((candidate) => candidate.level === slot.level)?.max ?? before?.remaining ?? 0;
    const spent = before ? Math.max(0, max - before.remaining) : 0;
    return { ...slot, remaining: Math.max(0, slot.remaining - spent) };
  });
}

function carriedPactSlots(
  previous: Actor["pactSlots"],
  previousMaximum: { level: number; max: number } | null,
  next: Actor["pactSlots"]
): Actor["pactSlots"] {
  if (!previous || !next || !previousMaximum) return next;
  const spent = Math.max(0, previousMaximum.max - previous.remaining);
  return { ...next, remaining: Math.max(0, next.remaining - spent) };
}

/** What the player had prepared, where the new sheet still knows it, plus what the new sheet adds prepared. */
function carriedPreparedSpells(
  prepared: readonly string[],
  previous: ActorDefinition | undefined,
  next: ActorDefinition
): string[] {
  const defaults = seedPreparedSpellIds(next);
  if (!previous?.spellcasting || !next.spellcasting) return defaults;
  const known = new Set(previous.spellcasting.spells.map((spell) => spell.id));
  const always = new Set(next.spellcasting.spells.filter((spell) => spell.alwaysPrepared).map((spell) => spell.id));
  return next.spellcasting.spells
    .map((spell) => spell.id)
    .filter((id) => always.has(id) || (known.has(id) ? prepared.includes(id) : defaults.includes(id)));
}

/** The new sheet, plus any `hp-roll` row the old one recorded for a level this build does not cover. */
function rememberHitPointRolls(previous: ActorDefinition | undefined, next: ActorDefinition): ActorDefinition {
  const nextChoices = next.character?.choices;
  if (!previous || !nextChoices) return next;
  const carried = (previous.character?.choices ?? []).filter(
    (row) =>
      row.kind === "hp-roll" &&
      !nextChoices.some((candidate) => candidate.kind === "hp-roll" && candidate.level === row.level)
  );
  if (carried.length === 0) return next;
  const choices = [...nextChoices, ...carried].sort((left, right) => left.level - right.level);
  return { ...next, character: { ...next.character!, choices } };
}

export function removeActor(state: GameState, actorId: string) {
  const actor = state.actors.find((item) => item.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  // An archived but still-claimed character can be deleted, and the claim is released in the same mutation.
  // A character still in play keeps the protection.
  if (actor.kind === "player-character" && actor.ownerSessionId !== null) {
    if (!actor.archived) throw new CommandRejectedError("Release that character's claim before removing it.");
    actor.ownerSessionId = null;
  }
  if (actor.kind === "player-character" && !actor.definitionId?.startsWith("import-"))
    throw new CommandRejectedError("Player characters can't be removed from the roster.");
  // A recorded snapshot may reference this actor; make the GM leave history review first.
  if (state.combat.historyCursor !== null)
    throw new CommandRejectedError(
      "Finish reviewing the combat history before removing a combatant.",
      "history_review"
    );
  if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId)) {
    throw new CommandRejectedError("End the encounter before removing a combatant who is in it.");
  }
  // A parked scene can hold a paused, still-active fight; block removal if this actor is in one.
  if (
    state.combat.scenes.some(
      (scene) => scene.combat.active && scene.combat.initiative.some((entry) => entry.actorId === actorId)
    )
  ) {
    throw new CommandRejectedError("End the paused encounter in the prepared scene that uses this combatant first.");
  }
  // A removed actor can no longer sustain effects on others (its grapples release, ADR-0020).
  endEffectsSustainedBy(state, actorId);
  state.actors = state.actors.filter((item) => item.id !== actorId);
  // Drop the actor from every inactive prepared scene so no scene references a combatant that no longer exists.
  if (
    state.combat.scenes.some(
      (scene) =>
        !scene.combat.active &&
        (scene.combat.initiative.some((entry) => entry.actorId === actorId) ||
          scene.combat.tokens.some((token) => token.actorId === actorId))
    )
  ) {
    state.combat = {
      ...state.combat,
      scenes: state.combat.scenes.map((scene) =>
        scene.combat.active
          ? scene
          : {
              ...scene,
              combat: {
                ...scene.combat,
                initiative: scene.combat.initiative.filter((entry) => entry.actorId !== actorId),
                tokens: scene.combat.tokens.filter((token) => token.actorId !== actorId)
              }
            }
      )
    };
  }
  // Imported stat blocks live only for their actors; drop one nothing references anymore.
  if (
    actor.definitionId?.startsWith("import-") &&
    !state.actors.some((item) => item.definitionId === actor.definitionId)
  ) {
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
  // Nor does a removed character wait for a rest.
  const shortRest = state.rest.shortRest;
  const members = shortRest?.actorIds.filter((id) => id !== actorId) ?? [];
  state.rest = {
    ...state.rest,
    requests: state.rest.requests.filter((id) => id !== actorId),
    shortRest:
      shortRest && members.length > 0
        ? { actorIds: members, done: shortRest.done.filter((id) => id !== actorId) }
        : null
  };
}

export type SampleRemoval = Readonly<{
  removed: readonly string[];
  kept: ReadonlyArray<Readonly<{ name: string; reason: string }>>;
}>;

/**
 * Removes every sample character the roster rules let go, in one mutation. Each is tried on its own copy of the state
 * first, so one refused (a player holds it, or a fight uses it) leaves the table as it was for that one and the rest
 * still go. The refused ones are named with the refusal.
 */
export function removeSampleCharacters(state: GameState): SampleRemoval {
  const removed: string[] = [];
  const kept: { name: string; reason: string }[] = [];
  for (const sample of state.actors.filter((actor) => actor.sample === true)) {
    const trial = structuredClone(state);
    try {
      removeActor(trial, sample.id);
    } catch (error) {
      if (!(error instanceof CommandRejectedError)) throw error;
      kept.push({ name: sample.name, reason: error.message });
      continue;
    }
    Object.assign(state, trial);
    removed.push(sample.name);
  }
  return { removed, kept };
}

/** Definition lookup for sheets/actions: imported stat blocks first, then the bundled content. */
export function storedDefinition(state: GameState, definitionId: string): ActorDefinition | undefined {
  return state.definitions.find((entry) => entry.id === definitionId)?.definition;
}

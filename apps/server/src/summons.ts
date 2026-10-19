import { isDead, type GameState, type InitiativeEntry } from "@vtt/domain";
import type { ActorDefinition, EffectInstance, Summon, SummonCreature } from "@vtt/schemas";
import { addSummonedActor } from "./actor-roster.js";
import { isIncapacitated as isIncapacitatedActor } from "./condition-rules.js";
import { sideOf } from "./creature-sides.js";
import {
  addEffect,
  endConcentrationSustainedBy,
  endEffectIfPresent,
  endEffectsSustainedBy,
  makeEffect,
  type EffectNarration
} from "./effects.js";
import { joinInitiative, rollJoiningInitiative } from "./encounter.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import { RIDING_TAG } from "./mounts.js";
import { DISTANCE_TOLERANCE_FEET, mapDistance } from "./movement-narration.js";
import { nearestOpenSpace } from "./off-plane.js";
import { sizeRank } from "./resolution/context.js";
import { creatureTypeOf } from "./statblock-facts.js";
import { summonedStatBlock, type SummonerNumbers } from "./summon-stat-blocks.js";
import { createEncounterTokens, moveEncounterToken, type TokenMapGeometry } from "./token-placement.js";

/**
 * Summoned and commanded creatures (SRD 5.2.1: Summon Dragon, Animate Dead, Find Familiar, a Bowl of Commanding Water
 * Elementals). An action's `summons` brings creatures onto the map from stat blocks, scaled by the cast's level when the
 * stat block says how, on its user's side and under its user's command (`Actor.control`), in its place in the turn
 * order. What keeps each is an effect (`Actor.summon.keptBy`): a mark on the creature that ends with the cast's
 * Concentration or after the spell's duration, or one on its user that lasts until its user's Long Rest. After every
 * command the pipeline settles them (`settleSummons`): one whose mark ended, that dropped to 0 Hit Points, whose user
 * died or that strayed too far leaves the map and the roster, and one whose command lapsed stays and stops obeying.
 */

export const SUMMONED_TAG = "summoned";

type Actor = GameState["actors"][number];
type Point = Readonly<{ x: number; y: number }>;

export type SummonDeps = Readonly<{
  geometry: TokenMapGeometry | null;
  newId: () => string;
  rollDie: (sides: number) => number;
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  /** The stat blocks of a creature type up to a Challenge Rating ("another Beast that has a Challenge Rating of 0"). */
  monstersOfType?: (creatureType: string, maxChallenge: number) => readonly string[];
}>;

/** What the user picked for the summon: which stat blocks and how many, a form, a creature type, a damage type for
 *  the stat block's chosen-type actions, the Resistance it shares, and where they appear. */
export type SummonChoice = Readonly<{
  picks?: ReadonlyArray<Readonly<{ monsterId: string; form?: string; count?: number }>>;
  creatureType?: string;
  damageType?: string;
  resistance?: string;
  at?: Point;
  /** Cast without Concentration, for 1 minute (`Summon.concentrationOptional`). */
  withoutConcentration?: boolean;
}>;

export type SummonRequest = Readonly<{
  userId: string;
  summon: Summon;
  /** The action that brings them. */
  action: Readonly<{ id: string; name: string }>;
  /** The spell it casts and the level it is cast at; `printedLevel` is the spell's own. */
  spell?: Readonly<{ id: string; name: string; level: number; printedLevel: number }>;
  /** How long the spell lasts at that level (`spellEffectDuration`), when the summon lasts as long. */
  spellDuration?: EffectInstance["duration"];
  /** The cast's Concentration, which ends what it brought. */
  castId: string | null;
  commandId: string;
  /** The dead creatures it rises from (Animate Dead). */
  corpseIds: readonly string[];
  choice: SummonChoice;
  numbers: SummonerNumbers;
}>;

export type SummonOutcome = { created: Array<{ id: string; name: string }>; events: EffectNarration[] };

/** The creatures a summon offers at this level (Create Undead's Ghasts only from a level 8 slot). */
export function summonRowsAt(summon: Summon, level: number | null): SummonCreature[] {
  return summon.creatures.filter((row) => row.minLevel === undefined || (level !== null && level >= row.minLevel));
}

/** How many of a row come at this level: its count, and `perSlot` more for each level above its first. */
export function summonCountAt(row: SummonCreature, level: number | null, printedLevel: number | null): number {
  const from = row.minLevel ?? printedLevel;
  const above = level !== null && from !== null ? Math.max(0, level - from) : 0;
  return Math.min(20, row.count + (row.perSlot ?? 0) * above);
}

const sameRow = (row: SummonCreature, pick: Readonly<{ monsterId: string; form?: string }>) =>
  row.monsterId === pick.monsterId && (pick.form === undefined || row.form === undefined || row.form === pick.form);

/** One kind of creature a summon makes, and how many; who commands it and how long it stays when its row says. */
type Planned = Readonly<{
  monsterId: string;
  form?: string;
  count: number;
  except?: SummonCreature["except"];
  allegiance?: SummonCreature["allegiance"];
  rounds?: number;
}>;

const plannedOf = (row: SummonCreature, count: number, form = row.form): Planned => ({
  monsterId: row.monsterId,
  ...(form ? { form } : {}),
  count,
  ...(row.except ? { except: row.except } : {}),
  ...(row.allegiance ? { allegiance: row.allegiance } : {}),
  ...(row.rounds !== undefined ? { rounds: row.rounds } : {})
});

/** Whether the user has the training a summon asks before it obeys (a Horn of Valhalla's). Training a sheet never
 *  recorded counts as had: the GM settles it. */
function hasTraining(
  user: Actor,
  wants: Summon["obeysWith"],
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined
): boolean {
  if (!wants) return true;
  const proficiencies = user.definitionId ? resolveDefinition(user.definitionId)?.proficiencies : undefined;
  const has = (recorded: readonly string[] | undefined, id: string | undefined) =>
    id === undefined || recorded === undefined || recorded.includes(id);
  return has(proficiencies?.weapons, wants.weapons) && has(proficiencies?.armor, wants.armor);
}

/** The stat blocks and counts this summon makes: rolled on its die, picked by its user, or its first row. */
function plannedCreatures(request: SummonRequest, deps: SummonDeps, events: EffectNarration[], user: Actor): Planned[] {
  const { summon, choice } = request;
  const level = request.spell?.level ?? null;
  const printed = request.spell?.printedLevel ?? null;
  const rows = summonRowsAt(summon, level);
  if (rows.length === 0) throw new CommandRejectedError(`${request.action.name} brings nothing at this level.`);
  if (summon.die !== undefined) {
    const face = deps.rollDie(summon.die);
    const row = rows.find((candidate) => candidate.faces && face >= candidate.faces.from && face <= candidate.faces.to);
    events.push({
      kind: "effect",
      text: `${user.name} rolls ${face} on the d${summon.die} for ${request.action.name}.`,
      actorId: user.id
    });
    return row ? [plannedOf(row, summonCountAt(row, level, printed))] : [];
  }
  const picks = choice.picks ?? [];
  if (picks.length === 0) {
    const row = rows[0]!;
    const count = summon.upToModifier
      ? Math.max(1, Math.floor(Math.max(1, request.numbers.modifier) / (row.share ?? 1)))
      : summonCountAt(row, level, printed);
    return [plannedOf(row, count)];
  }
  if (picks.length > 1 && !summon.upToModifier)
    throw new CommandRejectedError(`${request.action.name} brings one kind of creature. Pick one.`);
  const planned = picks.map((pick) => {
    const row = rows.find((candidate) => sameRow(candidate, pick));
    const anyOf = summon.orAny
      ? (deps.monstersOfType?.(summon.orAny.creatureType, summon.orAny.maxChallenge) ?? [])
      : [];
    if (!row && !anyOf.includes(pick.monsterId))
      throw new CommandRejectedError(`${request.action.name} can't bring that creature at this level.`);
    const most = row ? summonCountAt(row, level, printed) : 1;
    const count = pick.count ?? (summon.upToModifier ? 1 : most);
    if (!summon.upToModifier && count > most)
      throw new CommandRejectedError(
        `${request.action.name} brings ${most === 1 ? "one creature" : `up to ${most} creatures`} of that kind${level !== null && printed !== null && level > printed ? ` with a level ${level} slot` : ""}.`
      );
    const form = pick.form ?? row?.form;
    return {
      planned: row ? plannedOf(row, count, form) : { monsterId: pick.monsterId, count },
      share: row?.share ?? 1
    };
  });
  if (summon.upToModifier) {
    // "The maximum number of objects is equal to your spellcasting ability modifier": a Large one counts as two.
    const budget = Math.max(1, request.numbers.modifier);
    const spent = planned.reduce((total, entry) => total + entry.share * entry.planned.count, 0);
    if (spent > budget)
      throw new CommandRejectedError(
        `${request.action.name} animates up to ${budget} ${budget === 1 ? "share" : "shares"} of objects (a Large one counts as two, a Huge one as three); ${spent} were chosen.`
      );
  }
  return planned.map((entry) => entry.planned);
}

/** A short stable key for a scaled stat block, so two summons with the same picks share one stored copy. */
function hashOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

const MAX_STORED_DEFINITIONS = 100;

/** The definition id a summoned stat block lives under: the bundled one's own id when nothing changed it, or a stored
 *  copy for a scaled one or a changed creature type. */
function storedSummonDefinition(state: GameState, monsterId: string, base: ActorDefinition, made: ActorDefinition) {
  if (made === base) return monsterId;
  const id = `summon-${monsterId}-${hashOf(JSON.stringify(made))}`.slice(0, 200);
  if (state.definitions.some((entry) => entry.id === id)) return id;
  if (state.definitions.length >= MAX_STORED_DEFINITIONS)
    throw new CommandRejectedError("The imported-sheet library is full. Remove unused combatants first.");
  state.definitions = [...state.definitions, { id, definition: made }];
  return id;
}

/** Stored stat blocks no creature uses any more go (a summon's scaled copies). */
function pruneSummonDefinitions(state: GameState): void {
  const used = new Set(state.actors.map((actor) => actor.definitionId));
  if (state.definitions.every((entry) => !entry.id.startsWith("summon-") || used.has(entry.id))) return;
  state.definitions = state.definitions.filter((entry) => !entry.id.startsWith("summon-") || used.has(entry.id));
}

/** The point a summon appears at: the one its user picked, within its range, or its user's own space. */
function placementPoint(
  state: GameState,
  request: SummonRequest,
  user: Actor,
  geometry: TokenMapGeometry
): Point | null {
  const userAt = state.combat.tokens.find((token) => token.actorId === user.id)?.position ?? null;
  const at = request.choice.at;
  if (!at) return userAt;
  const range = request.summon.rangeFeet ?? 5;
  const apart = userAt ? mapDistance(geometry, userAt, at)?.value : undefined;
  if (apart !== undefined && apart > range + DISTANCE_TOLERANCE_FEET)
    throw new CommandRejectedError(
      `That spot is ${Math.round(apart)} ft from ${user.name}; ${request.action.name} brings its creatures within ${range} ft.`
    );
  return at;
}

/** The dead creatures a summon rises from, each checked against what it can raise. */
function corpsesFor(state: GameState, request: SummonRequest, deps: SummonDeps): Actor[] {
  const rule = request.summon.fromCorpse;
  if (!rule) return [];
  if (request.corpseIds.length === 0)
    throw new CommandRejectedError(`${request.action.name} needs a dead creature as its target.`);
  return request.corpseIds.map((id) => {
    const corpse = state.actors.find((actor) => actor.id === id);
    if (!corpse || !isDead(corpse))
      throw new CommandRejectedError(
        `${corpse?.name ?? "That creature"} isn't dead, so ${request.action.name} can't raise it.`
      );
    if (corpse.kind === "player-character")
      throw new CommandRejectedError(`${corpse.name} is a player character. The GM decides what rises from it.`);
    const definition = corpse.definitionId ? deps.resolveDefinition(corpse.definitionId) : undefined;
    const type = creatureTypeOf(corpse, definition);
    if (rule.creatureTypes && type !== null && !rule.creatureTypes.includes(type))
      throw new CommandRejectedError(`${request.action.name} raises only ${rule.creatureTypes.join(" or ")} corpses.`);
    if (rule.maxSize && sizeRank(corpse.size) > sizeRank(rule.maxSize))
      throw new CommandRejectedError(`${corpse.name} is too large for ${request.action.name}.`);
    return corpse;
  });
}

/** The creature's place in the turn order: right after its user on its count, on its own roll, or passed over. */
function initiativeEntryFor(
  state: GameState,
  actor: Actor,
  user: Actor,
  summon: Summon,
  deps: SummonDeps
): InitiativeEntry {
  const userEntry = state.combat.initiative.find((entry) => entry.actorId === user.id);
  if (summon.turn === "own") {
    // Outside a fight it waits in the order unrolled; the encounter's start rolls for it like anyone else.
    const score = state.combat.active
      ? rollJoiningInitiative(state, actor.id, () => deps.rollDie(20), {
          rollDie: deps.rollDie,
          resolveDefinition: deps.resolveDefinition,
          ...(deps.catalog ? { catalog: deps.catalog } : {})
        })
      : 0;
    return { actorId: actor.id, score, tieBreaker: actor.initiative ?? 0 };
  }
  return {
    actorId: actor.id,
    score: userEntry?.score ?? 0,
    tieBreaker: userEntry?.tieBreaker ?? actor.initiative ?? 0,
    follows: user.id
  };
}

/** The creature joins the turn order and, on a mapped scene, the map, in the open space nearest `at`. */
function joinMap(
  state: GameState,
  actor: Actor,
  entry: InitiativeEntry,
  at: Point | null,
  geometry: TokenMapGeometry | null
): void {
  joinInitiative(state, entry);
  if (!geometry) return;
  state.combat = {
    ...state.combat,
    tokens: [
      ...state.combat.tokens,
      ...createEncounterTokens([{ actorId: actor.id, sizeCells: actor.sizeCells ?? 1, size: actor.size }], geometry)
    ]
  };
  // A force that can't be harmed or blocked stands where it was put, whoever is there.
  if (at && state.combat.mapAssetId)
    moveEncounterToken(
      state,
      actor.id,
      actor.summon?.intangible ? at : nearestOpenSpace(state, actor.id, at, geometry),
      geometry
    );
}

/** The effect that keeps a summoned creature: on the creature, ending with the cast's Concentration or after the
 *  spell's or the item's time; or on its user, ending with its user's Long Rest. */
function keepingEffect(
  state: GameState,
  request: SummonRequest,
  user: Actor,
  creature: Actor,
  index: number,
  rounds?: number
): { bearerId: string; effect: EffectInstance } | null {
  const { summon, spell } = request;
  const lasts =
    rounds !== undefined
      ? { type: "rounds" as const, rounds }
      : (summon.lasts ?? (spell ? { type: "spell" as const } : { type: "untimed" as const }));
  const name = spell ? spell.name : request.action.name;
  const base = {
    name,
    tags: [SUMMONED_TAG],
    sourceActorId: user.id,
    sourceName: user.name,
    sourceActionId: request.action.id,
    startedRound: state.combat.round,
    ...(spell ? { spell: { id: spell.id, level: spell.level }, magical: true as const } : {})
  };
  if (lasts.type === "until-long-rest")
    return {
      bearerId: user.id,
      effect: makeEffect({ ...base, id: `${request.commandId}:summon`, duration: { type: "until-rest", rest: "long" } })
    };
  if (lasts.type === "untimed" && !summon.endsOnDamage) return null;
  const duration: EffectInstance["duration"] =
    lasts.type === "rounds"
      ? { type: "rounds", remaining: lasts.rounds }
      : lasts.type === "minutes"
        ? lasts.minutes <= 10
          ? { type: "rounds", remaining: lasts.minutes * 10 }
          : { type: "minutes", remaining: lasts.minutes }
        : lasts.type === "spell"
          ? (request.spellDuration ?? { type: "manual" })
          : { type: "manual" };
  return {
    bearerId: creature.id,
    effect: makeEffect({
      ...base,
      id: `${request.commandId}:summon:${index}`,
      duration,
      ...(request.castId !== null && (lasts.type === "spell" || (lasts.type === "minutes" && lasts.concentration))
        ? { castId: request.castId }
        : {}),
      ...(summon.endsOnDamage ? { endsOnDamage: true } : {})
    })
  };
}

/**
 * Brings a summon's creatures onto the map. Each comes from its stat block (scaled and stored when it scales or its
 * creature type changes), named apart from the others, on its user's side and under its user's command unless its
 * allegiance says otherwise, in the open space nearest the point picked (or its corpse, or its user), and in the turn
 * order. A summon that allows one at a time replaces the one before.
 */
export function bringSummons(state: GameState, request: SummonRequest, deps: SummonDeps): SummonOutcome {
  const user = state.actors.find((actor) => actor.id === request.userId);
  if (!user) throw new CommandRejectedError("That combatant no longer exists.");
  const { summon, choice } = request;
  const events: EffectNarration[] = [];
  const renewed = reassertCommand(state, request, user);
  if (renewed) return renewed;
  const corpses = corpsesFor(state, request, deps);
  const planned = plannedCreatures(request, deps, events, user);
  if (corpses.length > 0) {
    const most = planned.reduce((total, entry) => total + entry.count, 0);
    if (corpses.length > most)
      throw new CommandRejectedError(
        `${request.action.name} raises ${most === 1 ? "one creature" : `up to ${most} creatures`} at this level; ${corpses.length} were chosen.`
      );
  }
  if (summon.creatureTypes && choice.creatureType && !summon.creatureTypes.includes(choice.creatureType))
    throw new CommandRejectedError(
      `${request.action.name}'s creature is ${summon.creatureTypes.join(", ")}. Pick one.`
    );
  const creatureType = summon.creatureTypes ? (choice.creatureType ?? summon.creatureTypes[0]) : undefined;
  // One at a time from this source: the one before goes (Find Steed's steed is replaced).
  if (summon.onlyOne)
    for (const earlier of state.actors.filter((actor) => actor.summon?.by === user.id && sameSource(actor, request)))
      events.push(...retireSummoned(state, earlier.id, "is replaced"));
  const geometry = deps.geometry;
  const mapped = geometry !== null && state.combat.mapAssetId !== null;
  const point = mapped && corpses.length === 0 ? placementPoint(state, request, user, geometry) : null;
  const side = sideOf(user, deps.resolveDefinition) ?? "party";
  const created: SummonOutcome["created"] = [];
  const total = corpses.length > 0 ? corpses.length : planned.reduce((sum, entry) => sum + entry.count, 0);
  if (state.actors.length + total > 200)
    throw new CommandRejectedError("The roster is full. Remove unused combatants first.");
  const trained = hasTraining(user, summon.obeysWith, deps.resolveDefinition);
  let index = 0;
  const queue =
    corpses.length > 0
      ? corpses.map(() => planned[0]!)
      : planned.flatMap((entry) => Array.from({ length: entry.count }, () => entry));
  for (const entry of queue) {
    const base = deps.resolveDefinition(entry.monsterId);
    if (!base)
      throw new CommandRejectedError(
        `The ${entry.monsterId.replace(/-/g, " ")} stat block isn't in this table's bestiary.`
      );
    const damageType = base.summonScaling?.chosenDamageType
      ? choice.damageType && (base.damageResistances ?? []).includes(choice.damageType)
        ? choice.damageType
        : base.damageResistances?.[0]
      : undefined;
    const made = summonedStatBlock(base, request.numbers, {
      level: request.spell?.level ?? null,
      ...(entry.form ? { form: entry.form } : {}),
      ...(creatureType ? { creatureType } : {}),
      ...(damageType ? { damageType } : {}),
      ...(entry.except ? { except: entry.except } : {})
    });
    const definitionId = storedSummonDefinition(state, entry.monsterId, base, made);
    const id = deps.newId();
    addSummonedActor(state, made, id, user.visibility, definitionId, deps.catalog);
    const actor = state.actors.find((candidate) => candidate.id === id)!;
    const corpse = corpses[index];
    const kept = keepingEffect(state, request, user, actor, index, entry.rounds);
    if (kept) addEffect(state, kept.bearerId, kept.effect);
    actor.summon = {
      by: user.id,
      actionId: request.action.id,
      name: request.spell?.name ?? request.action.name,
      ...(request.spell ? { spell: { id: request.spell.id, level: request.spell.level } } : {}),
      ...(kept ? { keptBy: kept.effect.id } : {}),
      ...(summon.endsOnDamage ? { endsOnDamage: true as const } : {}),
      ...(summon.endsOnUserDeath ? { endsOnUserDeath: true as const } : {}),
      ...(summon.leashFeet !== undefined ? { leashFeet: summon.leashFeet } : {}),
      ...(summon.intangible ? { intangible: true as const } : {}),
      ...(summon.turn === "none" ? { noTurns: true as const } : {}),
      ...(summon.commandMove !== undefined ? { commandMove: summon.commandMove } : {}),
      ...(summon.sight ? { sight: summon.sight } : {}),
      ...(summon.dismiss ? { dismiss: summon.dismiss } : {}),
      ...(summon.deliversTouch !== undefined ? { deliversTouch: summon.deliversTouch } : {}),
      ...(summon.strikesFrom ? { strikesFrom: summon.strikesFrom } : {}),
      ...(summon.endsSpell && request.castId !== null ? { endsSpell: request.castId } : {})
    };
    const allegiance = entry.allegiance ?? summon.allegiance;
    if (allegiance === "user" && !trained)
      events.push({
        kind: "effect",
        text: `${actor.name} turns on ${user.name}, who lacks the training ${request.action.name} asks.`,
        actorId: actor.id
      });
    if (allegiance === "user" && trained)
      actor.control = {
        by: user.id,
        side,
        ...(summon.freedAtEnd && actor.summon.keptBy ? { keptBy: actor.summon.keptBy } : {}),
        ...(summon.commandedWith ? { commandedWith: summon.commandedWith } : {}),
        ...(summon.dodgesUncommanded ? { dodgesUncommanded: true as const } : {}),
        ...(summon.noAttacks ? { noAttacks: true as const } : {}),
        ...(summon.commandFeet !== undefined ? { commandFeet: summon.commandFeet } : {})
      };
    // A creature freed when its time is up stays on the map then (Animate Dead): its time keeps the command, not it.
    if (summon.freedAtEnd) {
      const { keptBy: _kept, ...rest } = actor.summon;
      actor.summon = rest;
    }
    const at = corpse ? (state.combat.tokens.find((token) => token.actorId === corpse.id)?.position ?? null) : point;
    if (corpse) events.push(...retireSummoned(state, corpse.id, "rises", { silent: true }));
    joinMap(state, actor, initiativeEntryFor(state, actor, user, summon, deps), at, mapped ? geometry : null);
    created.push({ id, name: actor.name });
    index += 1;
  }
  if (summon.sharedResistance && created.length > 0) shareResistance(state, request, user, created[0]!.id, deps);
  if (created.length > 0)
    events.push({
      kind: "effect",
      text: `${user.name} ${corpses.length > 0 ? "raises" : "brings"} ${listOf(created.map((entry) => entry.name))} with ${request.action.name}.`,
      actorId: user.id
    });
  return { created, events };
}

/**
 * "Casting this spell on the creature again ... reasserts your control over up to four creatures you have animated with
 * this spell rather than animating a new creature": a cast aimed at creatures the user still commands from this spell
 * renews their time under command. Null when its targets are anything else, which then must be corpses.
 */
function reassertCommand(state: GameState, request: SummonRequest, user: Actor): SummonOutcome | null {
  const { summon, spell } = request;
  if (!summon.reasserts || !spell || request.corpseIds.length === 0) return null;
  const targets = request.corpseIds.map((id) => state.actors.find((actor) => actor.id === id));
  const ours = (actor: Actor | undefined): actor is Actor =>
    actor !== undefined && actor.summon?.by === user.id && actor.summon.spell?.id === spell.id;
  if (!targets.some(ours)) return null;
  if (!targets.every(ours) || targets.some((actor) => actor.control?.by !== user.id))
    throw new CommandRejectedError(
      `${spell.name} renews ${user.name}'s command only over creatures ${user.name} still commands from it.`
    );
  const most = summon.reasserts.count + (summon.reasserts.perSlot ?? 0) * Math.max(0, spell.level - spell.printedLevel);
  if (targets.length > most)
    throw new CommandRejectedError(
      `${spell.name} renews ${user.name}'s command over up to ${most} creatures at this level; ${targets.length} were chosen.`
    );
  const lasts = summon.lasts?.type === "minutes" ? summon.lasts.minutes : null;
  for (const creature of targets) {
    const keptBy = creature.control?.keptBy;
    creature.effects = creature.effects.map((effect) =>
      effect.id === keptBy && lasts !== null
        ? {
            ...effect,
            duration: lasts <= 10 ? { type: "rounds", remaining: lasts * 10 } : { type: "minutes", remaining: lasts }
          }
        : effect
    );
  }
  return {
    created: [],
    events: [
      {
        kind: "effect",
        text: `${user.name} renews ${spell.name}'s command over ${listOf(targets.map((actor) => actor.name))}.`,
        actorId: user.id
      }
    ]
  };
}

const listOf = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? "nothing") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** Whether an earlier creature came from the same spell or action as this request. */
function sameSource(actor: Actor, request: SummonRequest): boolean {
  return request.spell ? actor.summon?.spell?.id === request.spell.id : actor.summon?.actionId === request.action.id;
}

/** "Choose one of its Resistances. You have Resistance to the chosen damage type until the spell ends" (a Draconic
 *  Spirit's Shared Resistances): the user gains it, held by the cast's Concentration. */
function shareResistance(
  state: GameState,
  request: SummonRequest,
  user: Actor,
  creatureId: string,
  deps: SummonDeps
): void {
  const creature = state.actors.find((actor) => actor.id === creatureId);
  const definition = creature?.definitionId
    ? (state.definitions.find((entry) => entry.id === creature.definitionId)?.definition ??
      deps.resolveDefinition(creature.definitionId))
    : undefined;
  const resists = definition?.damageResistances ?? [];
  const picked =
    request.choice.resistance && resists.includes(request.choice.resistance) ? request.choice.resistance : resists[0];
  if (!picked) return;
  addEffect(
    state,
    user.id,
    makeEffect({
      id: `${request.commandId}:shared-resistance`,
      name: `${request.spell?.name ?? request.action.name}: Resistance to ${picked}`,
      sourceActorId: user.id,
      sourceName: user.name,
      sourceActionId: request.action.id,
      startedRound: state.combat.round,
      duration: request.spellDuration ?? { type: "manual" },
      modifiers: [{ type: "damage-resistance", damageTypes: [picked as never] }],
      ...(request.castId !== null ? { castId: request.castId } : {}),
      ...(request.spell ? { spell: { id: request.spell.id, level: request.spell.level } } : {})
    })
  );
}

/** Whether any creature holds this effect. */
const effectHeld = (state: GameState, effectId: string) =>
  state.actors.some((actor) => actor.effects.some((effect) => effect.id === effectId));

/**
 * A summoned creature leaves: out of the fight and off the map, what it sustains ends, its riders are set down, and it
 * leaves the roster. When it holds the turn, the turn passes on first (`advance`), or to the next creature with no
 * turn-change steps when there is no map to run them on.
 */
export function retireSummoned(
  state: GameState,
  actorId: string,
  why: string,
  options: Readonly<{ silent?: boolean; advance?: (state: GameState) => void }> = {}
): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return [];
  const events: EffectNarration[] = [];
  const endsCast = actor.summon?.endsSpell ?? null;
  if (state.combat.active && state.combat.turnActorId === actorId && state.combat.initiative.length > 1) {
    if (options.advance) options.advance(state);
    if (state.combat.turnActorId === actorId) {
      const order = state.combat.initiative;
      const at = order.findIndex((entry) => entry.actorId === actorId);
      const next = order[(at + 1) % order.length]!;
      state.combat = {
        ...state.combat,
        turnActorId: next.actorId,
        round: at + 1 >= order.length ? state.combat.round + 1 : state.combat.round,
        turn: {
          actionUsed: false,
          bonusActionUsed: false,
          actionInstance: null,
          bonusActionInstance: null,
          turnUses: {},
          movementUsedFeet: 0
        }
      };
    }
  }
  events.push(...endEffectsSustainedBy(state, actorId), ...endConcentrationSustainedBy(state, actorId));
  // Its riders are set down where it was.
  for (const rider of state.actors)
    rider.effects = rider.effects.filter(
      (effect) => !(effect.tags.includes(RIDING_TAG) && effect.sourceActorId === actorId)
    );
  const gone = (id: string | null | undefined) => id === actorId;
  state.combat = {
    ...state.combat,
    initiative: state.combat.initiative
      .filter((entry) => !gone(entry.actorId))
      .map((entry) => (gone(entry.follows) ? (({ follows: _follows, ...rest }) => rest)(entry) : entry)),
    tokens: state.combat.tokens.filter((token) => !gone(token.actorId)),
    pendingInitiative: state.combat.pendingInitiative.filter((id) => !gone(id)),
    reactionsUsed: state.combat.reactionsUsed.filter((id) => !gone(id)),
    legendaryUsed: Object.fromEntries(
      Object.entries(state.combat.legendaryUsed).filter(([key]) => key !== actorId && !key.startsWith(`${actorId}:`))
    ),
    pendingReactions: state.combat.pendingReactions.filter(
      (prompt) => !gone(prompt.actorId) && !(prompt.kind === "leaves-reach" && gone(prompt.targetActorId))
    ),
    pendingSaves: state.combat.pendingSaves.filter((save) => !gone(save.targetActorId)),
    offPlane: state.combat.offPlane.filter((entry) => !gone(entry.actorId)),
    heldMove: gone(state.combat.heldMove?.actorId) ? null : state.combat.heldMove
  };
  // A creature it commanded is commanded by no one now.
  for (const other of state.actors) if (other.control?.by === actorId) delete other.control;
  state.actors = state.actors.filter((candidate) => candidate.id !== actorId);
  pruneSummonDefinitions(state);
  if (!options.silent) events.push({ kind: "effect", text: `${actor.name} ${why}.`, actorId });
  // Its spell ends with it (Arcane Hand at 0 Hit Points): its caster's Concentration on that cast.
  if (endsCast) {
    const holder = state.actors.find((candidate) =>
      candidate.effects.some((effect) => effect.castId === endsCast && effect.concentration)
    );
    const holding = holder?.effects.find((effect) => effect.castId === endsCast && effect.concentration);
    if (holder && holding) events.push(...endEffectIfPresent(state, holder.id, holding.id));
  }
  return events;
}

/** Why a summoned creature leaves now, or null while it stays. */
function leavesBecause(
  state: GameState,
  actor: Actor,
  distanceFeet: ((a: string, b: string) => number | null) | null
): string | null {
  const summon = actor.summon;
  if (!summon) return null;
  if (summon.keptBy && !effectHeld(state, summon.keptBy)) return "disappears as its magic ends";
  // A creature a rule raised is a creature like any other at 0 Hit Points: it dies by the rules, or regenerates.
  if (actor.hp.current <= 0 && summon.actionId !== RAISED_ACTION_ID) return "drops to 0 Hit Points and disappears";
  const user = state.actors.find((candidate) => candidate.id === summon.by);
  if (!user) return "disappears with the creature that summoned it";
  if (summon.endsOnUserDeath && isDead(user)) return `disappears as ${user.name} dies`;
  if (summon.leashFeet !== undefined && distanceFeet) {
    const apart = distanceFeet(user.id, actor.id);
    if (apart !== null && apart > summon.leashFeet + DISTANCE_TOLERANCE_FEET)
      return `is more than ${summon.leashFeet} ft from ${user.name} and disappears`;
  }
  return null;
}

/** Whether a creature's command lapsed: its time is up, its commander is gone, or it is beyond the reach its
 *  commanding effect names. */
function commandLapsed(
  state: GameState,
  actor: Actor,
  distanceFeet: ((a: string, b: string) => number | null) | null
): boolean {
  const control = actor.control;
  if (!control) return false;
  if (!state.actors.some((candidate) => candidate.id === control.by)) return true;
  if (control.keptBy !== undefined && !effectHeld(state, control.keptBy)) return true;
  const keeping = actor.effects.find((effect) => effect.id === control.keptBy);
  return keeping !== undefined && beyondCommand(keeping, actor.id, distanceFeet);
}

/** An aboleth's Dominate Mind: "under its control while within 60 feet of it". A commanding effect tagged
 *  `commanded-within-<feet>` commands its creature only that near its source. */
function beyondCommand(
  effect: EffectInstance,
  actorId: string,
  distanceFeet: ((a: string, b: string) => number | null) | null
): boolean {
  const tag = effect.tags.find((candidate) => /^commanded-within-\d+$/.test(candidate));
  if (!tag || !distanceFeet || effect.sourceActorId === null) return false;
  const apart = distanceFeet(effect.sourceActorId, actorId);
  return apart !== null && apart > Number(tag.slice("commanded-within-".length)) + DISTANCE_TOLERANCE_FEET;
}

/** On a creature, an effect that puts it under its source's command while it lasts (Dominate Person's Charmed, Planar
 *  Binding's service). */
export const COMMANDED_TAG = "commanded";

/** A commanding effect on the creature that doesn't command it yet, within any reach it names. */
function commandStarting(
  actor: Actor,
  distanceFeet: ((a: string, b: string) => number | null) | null
): EffectInstance | undefined {
  const effect = actor.effects.find(
    (candidate) =>
      candidate.tags.includes(COMMANDED_TAG) && candidate.sourceActorId !== null && candidate.sourceActorId !== actor.id
  );
  return effect && actor.control?.keptBy !== effect.id && !beyondCommand(effect, actor.id, distanceFeet)
    ? effect
    : undefined;
}

export type RaiseDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  newId: () => string;
}>;

/**
 * A creature a rule raises from a stat block on its maker's side (SRD Finger of Death's Zombie, a wraith's Specter, a
 * troll's severed limb): the same summoned, commanded creature an action's `summons` brings, standing in `at`'s space
 * and taking its turn right after its maker's. It follows its maker's orders, so a player whose character raised it
 * runs it, and it leaves as a summoned creature does. Null when the stat block isn't a monster's.
 */
export function raiseCreature(
  state: GameState,
  input: Readonly<{
    monsterId: string;
    /** The creature that raised it, whose side it fights on and whose orders it follows. */
    maker: Actor;
    /** Where it appears: this creature's token's space. */
    at: Actor;
    /** What raised it ("Create Specter", "Loathsome Limbs"). */
    source: string;
    visibility?: "public" | "gm-only";
  }>,
  deps: RaiseDeps
): Readonly<{ actorId: string; name: string }> | null {
  const printed = deps.resolveDefinition(input.monsterId);
  if (!printed || printed.schemaId !== "vtt.actor-monster") return null;
  if (state.actors.length >= 200) throw new CommandRejectedError("The roster is full. Remove unused combatants first.");
  const { maker } = input;
  const id = deps.newId();
  addSummonedActor(state, printed, id, input.visibility ?? maker.visibility, input.monsterId, deps.catalog);
  const actor = state.actors.find((candidate) => candidate.id === id)!;
  actor.summon = { by: maker.id, actionId: RAISED_ACTION_ID, name: input.source.slice(0, 120) };
  actor.control = { by: maker.id, side: sideOf(maker, deps.resolveDefinition) ?? "foes" };
  if (state.combat.active) {
    const makerEntry = state.combat.initiative.find((entry) => entry.actorId === maker.id);
    joinInitiative(state, {
      actorId: id,
      score: makerEntry?.score ?? 0,
      tieBreaker: makerEntry?.tieBreaker ?? 0,
      ...(makerEntry ? { follows: maker.id } : {})
    });
    // It stands in its maker's or its corpse's space, as the text says, whoever is there.
    const reference = state.combat.tokens.find((token) => token.actorId === input.at.id);
    state.combat = {
      ...state.combat,
      tokens: [
        ...state.combat.tokens,
        {
          actorId: id,
          position: reference?.position ? { ...reference.position } : null,
          sizePx: reference ? (reference.sizePx / (reference.sizeCells ?? 1)) * (actor.sizeCells ?? 1) : 48,
          gridSizePx: reference?.gridSizePx ?? null,
          gridRotationRadians: reference?.gridRotationRadians ?? null,
          sizeCells: actor.sizeCells ?? 1
        }
      ]
    };
  }
  return { actorId: id, name: actor.name };
}

/** The summon record's action id on a creature a rule raised (`raiseCreature`). */
const RAISED_ACTION_ID = "raised";

/** How many living creatures raised as `monsterId` follow `makerId`'s orders (a wraith's seven specters). */
export function raisedBy(state: GameState, makerId: string, monsterId: string): number {
  return state.actors.filter(
    (actor) =>
      !isDead(actor) &&
      actor.summon?.by === makerId &&
      actor.summon.actionId === RAISED_ACTION_ID &&
      (actor.definitionId === monsterId ||
        state.definitions.find((entry) => entry.id === actor.definitionId)?.definition.source.externalId === monsterId)
  ).length;
}

/** Whether any creature is summoned or under command, so the settle step has anything to look at. */
export function holdsSummons(state: GameState): boolean {
  return state.actors.some(
    (actor) =>
      actor.summon !== undefined ||
      actor.control !== undefined ||
      actor.effects.some((effect) => effect.tags.includes(COMMANDED_TAG))
  );
}

/** Whether `settleSummons` would change anything now. */
export function needsSummonSettling(
  state: GameState,
  distanceFeet: ((a: string, b: string) => number | null) | null
): boolean {
  return state.actors.some(
    (actor) =>
      leavesBecause(state, actor, distanceFeet) !== null ||
      commandLapsed(state, actor, distanceFeet) ||
      commandStarting(actor, distanceFeet) !== undefined
  );
}

export type SettleSummonDeps = Readonly<{
  distanceFeet: ((a: string, b: string) => number | null) | null;
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
  /** Passes the turn on through the turn-change steps when a leaving creature holds it. */
  advance?: (state: GameState) => void;
}>;

/** After every command: summoned creatures whose time is up, that dropped to 0 Hit Points, whose user died or that
 *  strayed too far leave; a creature a commanding effect landed on comes under its source's command; creatures whose
 *  command lapsed stop obeying and fight on their own side again. */
export function settleSummons(state: GameState, deps: SettleSummonDeps): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (let guard = 0; guard < 200; guard++) {
    const leaving = state.actors
      .map((actor) => ({ actor, why: leavesBecause(state, actor, deps.distanceFeet) }))
      .find((entry) => entry.why !== null);
    if (!leaving) break;
    events.push(
      ...retireSummoned(state, leaving.actor.id, leaving.why!, deps.advance ? { advance: deps.advance } : {})
    );
  }
  for (const actor of state.actors) {
    if (!commandLapsed(state, actor, deps.distanceFeet)) continue;
    const commander = state.actors.find((candidate) => candidate.id === actor.control?.by);
    delete actor.control;
    events.push({
      kind: "effect",
      text: commander ? `${actor.name} stops obeying ${commander.name}.` : `${actor.name} obeys no one now.`,
      actorId: actor.id
    });
  }
  for (const actor of state.actors) {
    const effect = commandStarting(actor, deps.distanceFeet);
    const commander = effect ? state.actors.find((candidate) => candidate.id === effect.sourceActorId) : undefined;
    if (!effect || !commander) continue;
    actor.control = { by: commander.id, side: sideOf(commander, deps.resolveDefinition) ?? "party", keptBy: effect.id };
    events.push({ kind: "effect", text: `${actor.name} obeys ${commander.name}.`, actorId: actor.id });
  }
  return events;
}

/**
 * "When you cast a spell with a range of touch, your familiar can deliver the touch. Your familiar must be within 100
 * feet of you, and it must take a Reaction to deliver the touch": the familiar that delivers it, checked, so the cast
 * measures its touch from there and spends the familiar's Reaction once it lands.
 */
export function familiarDelivery(
  state: GameState,
  input: Readonly<{
    casterId: string;
    familiarId: string;
    spell: Readonly<{ name: string; range: Readonly<{ text: string | null }> }> | undefined;
    distanceFeet: (a: string, b: string) => number | null;
  }>
): string {
  const familiar = state.actors.find((actor) => actor.id === input.familiarId);
  const caster = state.actors.find((actor) => actor.id === input.casterId);
  const reach = familiar?.summon?.by === input.casterId ? familiar.summon.deliversTouch : undefined;
  if (!familiar || !caster || reach === undefined)
    throw new CommandRejectedError(`Only ${caster?.name ?? "the caster"}'s familiar can deliver the touch.`);
  if (!input.spell || !/^touch\b/i.test(input.spell.range.text ?? ""))
    throw new CommandRejectedError(`${familiar.name} delivers only a spell with a range of touch.`);
  const apart = input.distanceFeet(caster.id, familiar.id);
  if (apart !== null && apart > reach + DISTANCE_TOLERANCE_FEET)
    throw new CommandRejectedError(
      `${familiar.name} is ${Math.round(apart)} ft away; it delivers the touch within ${reach} ft.`
    );
  if (state.combat.active && state.combat.reactionsUsed.includes(familiar.id))
    throw new CommandRejectedError(`${familiar.name} has used its Reaction, which delivering the touch takes.`);
  if (familiar.hp.current <= 0 || isIncapacitatedActor(familiar))
    throw new CommandRejectedError(`${familiar.name} can't take the Reaction that delivers the touch.`);
  return familiar.id;
}

/** Whether a summoned creature that leaves now holds the fight's turn, which then ends first. */
export function summonHoldingTurnLeaves(
  state: GameState,
  distanceFeet: ((a: string, b: string) => number | null) | null
): boolean {
  if (!state.combat.active || state.combat.initiative.length < 2) return false;
  const holder = state.actors.find((actor) => actor.id === state.combat.turnActorId);
  return holder !== undefined && leavesBecause(state, holder, distanceFeet) !== null;
}

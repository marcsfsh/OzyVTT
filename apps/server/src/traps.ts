import { loadToolbox, type ToolboxRecord, type TrapMechanics, type TrapTier } from "@vtt/content-srd-5.2.1";
import { isDead, type GameState, type MapTrap } from "@vtt/domain";
import { parseDiceFormula, pointInRects, resolveDice } from "@vtt/rules-5e";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { altitudeOf } from "./altitude.js";
import { footprintCellCenters } from "./area-targeting.js";
import { requireActorAccess, requireGm, type Initiator } from "./authorization.js";
import type { CheckRollDependencies } from "./check-rolls.js";
import { rollAbilityCheck, type CheckResult } from "./check-rolls.js";
import { addEffect, endEffect, makeEffect, type EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { startFall } from "./falling.js";
import { CommandRejectedError } from "./game-store.js";
import { gridToImage, type SquareGridCalibration } from "./grid-calibration.js";
import { applyDamageDetailed, damageAdjustmentDetail } from "./hit-points.js";
import { layerSlice, normalizedRect, type LayerMapGeometry, type PaintRectInput } from "./map-layers.js";
import { unionRect, type Rect } from "./rect-region.js";
import { failureEffectFor } from "./resolution/pending.js";
import { createPendingSaves } from "./saving-throws.js";
import { rollUtilizeCheck } from "./tool-uses.js";
import { carriedRow, spendUtilize } from "./utilize.js";

/**
 * Traps on the map (SRD 5.2.1 Gameplay Toolbox, Traps). The GM sets one of the toolbox's traps (`toolbox.v1.json`) at a
 * band of levels over its trapped area (`combat.traps`), hidden from the players. A creature moving onto the area sets
 * it off (`trapEntry`, read on the move's way as `zone-stops.ts` reads a spell area that stops its mover), as does one
 * starting its turn there where the trap says so, or the GM for a trap on a lock (`trap.spring`). It acts on the creature
 * that set it off or on each creature in its blast: its save and damage at that band, a pit's fall, a Net's restraint, the
 * rubble a collapse leaves. A Search or Study whose check meets a way of finding it finds it for the party (`findTraps`),
 * and a found trap can be made safe as its text says (`disarmTrap`): a wire cut, a spike wedged, a needle disarmed with a
 * Dexterity (Sleight of Hand) check, with Thieves' Tools where carried, whose failure sets it off.
 */

type Actor = GameState["actors"][number];
type Point = Readonly<{ x: number; y: number }>;
export type TrapRecord = ToolboxRecord & Readonly<{ trap: TrapMechanics }>;

/** How far from the trapped area a creature examines it, where the trap prints no distance. */
const SEARCH_FEET = 10;
/** "Within 5 feet", with the slack reach has. */
const TOUCH_FEET = 5.1;
const MAX_TRAPS = 50;

let records: ReadonlyMap<string, TrapRecord> | null = null;
/** The toolbox's traps, by id. */
export function trapRecords(): ReadonlyMap<string, TrapRecord> {
  records ??= new Map(
    loadToolbox().flatMap((record) => (record.trap ? [[record.id, record as TrapRecord] as const] : []))
  );
  return records;
}
export const trapRecord = (trapId: string): TrapRecord | undefined => trapRecords().get(trapId);

/** The trap's numbers at its band of levels: the band set, or the nearest one the trap prints. */
export function tierOf(record: TrapRecord, tier: number): TrapTier {
  const tiers = record.trap.tiers;
  return tiers[Math.min(tiers.length, Math.max(1, tier)) - 1]!;
}

export type SpringDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  rollDie: (sides: number) => number;
  newId: () => string;
  now: () => string;
  geometry?: Readonly<{ calibration: SquareGridCalibration | null }> | null;
}>;

// ---- the GM's placing -------------------------------------------------------------------------------------------

/** The GM sets a trap on the live map or a prepared scene: armed, hidden, over the dragged area. */
export function placeTrap(
  state: GameState,
  sceneId: string | undefined,
  geometry: LayerMapGeometry,
  input: Readonly<{ id: string; trapId: string; tier: number; rect: PaintRectInput }>,
  scope: Initiator
): MapTrap {
  requireGm(scope, "Only the GM sets traps.");
  if (!geometry.calibration) throw new CommandRejectedError("Calibrate the map's grid before setting a trap.");
  const record = trapRecord(input.trapId);
  if (!record) throw new CommandRejectedError("That trap isn't in the Gameplay Toolbox.");
  const slice = layerSlice(state, sceneId, "traps", "That scene is live. Set its traps on the table.");
  if (slice.layer.length >= MAX_TRAPS) throw new CommandRejectedError(`A scene holds up to ${MAX_TRAPS} traps.`);
  const trap: MapTrap = {
    id: input.id,
    trapId: record.id,
    name: record.name,
    tier: Math.min(record.trap.tiers.length, Math.max(1, Math.round(input.tier))),
    area: normalizedRect(geometry, input.rect, "Drag a larger area to set the trap."),
    state: "armed",
    found: false,
    activations: 0
  };
  slice.write([...slice.layer, trap]);
  return trap;
}

/** The GM changes a trap: its blast area, its band, whether the party has found it, or arms or disarms it. */
export function editTrap(
  state: GameState,
  sceneId: string | undefined,
  geometry: LayerMapGeometry,
  input: Readonly<{
    id: string;
    tier?: number;
    blast?: PaintRectInput | null;
    found?: boolean;
    state?: "armed" | "disarmed";
  }>,
  scope: Initiator
): MapTrap {
  requireGm(scope, "Only the GM changes traps.");
  const slice = layerSlice(state, sceneId, "traps", "That scene is live. Change its traps on the table.");
  const trap = slice.layer.find((candidate) => candidate.id === input.id);
  if (!trap) throw new CommandRejectedError("That trap is no longer on the map.");
  const record = trapRecord(trap.trapId);
  const { blast: _blast, ...rest } = trap;
  const next: MapTrap = {
    ...rest,
    ...(input.tier !== undefined && record
      ? { tier: Math.min(record.trap.tiers.length, Math.max(1, Math.round(input.tier))) }
      : {}),
    ...(input.found !== undefined ? { found: input.found } : {}),
    ...(input.state === "armed" ? { state: "armed" as const, activations: 0 } : {}),
    ...(input.state === "disarmed" ? { state: "disarmed" as const } : {}),
    ...(input.blast === undefined
      ? trap.blast
        ? { blast: trap.blast }
        : {}
      : input.blast === null
        ? {}
        : { blast: normalizedRect(geometry, input.blast, "Drag a larger area for the trap's blast.") })
  };
  slice.write(slice.layer.map((candidate) => (candidate.id === trap.id ? next : candidate)));
  return next;
}

/** The GM takes a trap off the map. */
export function removeTrap(state: GameState, sceneId: string | undefined, id: string, scope: Initiator): void {
  requireGm(scope, "Only the GM removes traps.");
  const slice = layerSlice(state, sceneId, "traps", "That scene is live. Remove its traps on the table.");
  if (!slice.layer.some((trap) => trap.id === id)) throw new CommandRejectedError("That trap is no longer on the map.");
  slice.write(slice.layer.filter((trap) => trap.id !== id));
}

// ---- where a trap is --------------------------------------------------------------------------------------------

/** The turn a trap went off in, which a trap that resets waits out. */
const turnKey = (state: GameState) => `${state.combat.round}:${state.combat.turnActorId ?? ""}`;

/** Whether a trap would go off now: armed, or sprung but one that resets "at the start of the next turn" whose turn has
 *  passed and whose activations aren't used up. Outside a fight there are no turns, so it is ready again at once. */
export function trapArmed(state: GameState, trap: MapTrap, record: TrapRecord): boolean {
  if (trap.state === "armed") return true;
  if (trap.state === "disarmed") return false;
  // "The lid remains open thereafter": a creature that moves onto an open pit falls in.
  if (record.trap.pit) return true;
  const resets = record.trap.resets;
  if (!resets) return false;
  if (resets.maxActivations !== undefined && trap.activations >= resets.maxActivations) return false;
  return !state.combat.active || trap.sprungTurn !== turnKey(state);
}

/** Whether a creature of this size at this point stands in a rect: any square of its space. */
function spaceIn(
  rect: Rect,
  calibration: SquareGridCalibration | null | undefined,
  position: Point,
  sizeCells: number
): boolean {
  const points = calibration
    ? footprintCellCenters(calibration, position, sizeCells).map((center) => gridToImage(calibration, center))
    : [position];
  return points.some((point) => pointInRects(point, [rect]));
}

/** The map's scale: its dynamic vision's measure, or the live grid's. */
const scaleOf = (state: GameState, pixelsPerFoot: number | undefined) =>
  state.combat.vision.measure?.pixelsPerFoot ?? pixelsPerFoot;

/** Feet from a creature's space to the nearest edge of a rect, or null when the map has no scale. */
function feetToRect(state: GameState, actorId: string, rect: Rect, gridScale?: number): number | null {
  const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId && candidate.position !== null);
  const pixelsPerFoot = scaleOf(state, gridScale);
  if (!token?.position || !pixelsPerFoot) return null;
  const at = token.position;
  const dx = Math.max(rect.x - at.x, 0, at.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - at.y, 0, at.y - (rect.y + rect.height));
  return Math.max(0, Math.max(dx, dy) / pixelsPerFoot - token.sizeCells * 2.5);
}

/**
 * Where a creature's way first sets off a trap: the index of the first point of the path on an armed trap's area that
 * a move sets off, and the trap. One it is already standing on, one found that can be stepped over (a trip wire), and
 * any for a creature off the ground, set nothing off.
 */
export function trapEntry(
  state: GameState,
  moverId: string,
  path: readonly Point[],
  calibration: SquareGridCalibration | null | undefined
): Readonly<{ index: number; trapId: string }> | null {
  const traps = state.combat.traps ?? [];
  if (path.length < 2 || traps.length === 0) return null;
  const token = state.combat.tokens.find((candidate) => candidate.actorId === moverId && candidate.position !== null);
  if (!token || altitudeOf(token) > 0) return null;
  let first: Readonly<{ index: number; trapId: string }> | null = null;
  for (const trap of traps) {
    const record = trapRecord(trap.trapId);
    if (!record || record.trap.trigger === "manual" || !trapArmed(state, trap, record)) continue;
    if (trap.found && record.trap.avoidable) continue;
    const on = (point: Point) => spaceIn(trap.area, calibration, point, token.sizeCells);
    if (on(path[0]!)) continue;
    const index = path.findIndex((point, at) => at > 0 && on(point));
    if (index > 0 && (first === null || index < first.index)) first = { index, trapId: trap.id };
  }
  return first;
}

/** As a creature's turn starts on a trap that acts on one starting its turn there (a statue's pressure plate). */
export function trapsAtTurnStart(
  state: GameState,
  actorId: string,
  calibration: SquareGridCalibration | null | undefined,
  deps: SpringDeps
): EffectNarration[] {
  const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId && candidate.position !== null);
  if (!token?.position || altitudeOf(token) > 0) return [];
  const events: EffectNarration[] = [];
  for (const trap of [...(state.combat.traps ?? [])]) {
    const record = trapRecord(trap.trapId);
    if (!record || record.trap.trigger !== "enter-or-start" || !trapArmed(state, trap, record)) continue;
    if (!spaceIn(trap.area, calibration, token.position, token.sizeCells)) continue;
    events.push(...springTrapOn(state, trap.id, actorId, deps).events);
  }
  return events;
}

// ---- springing ------------------------------------------------------------------------------------------------

/** The source a trap's failure effects name: the trap, not a creature. */
const TRAP_SOURCE_ID = "00000000-0000-4000-8000-000000000000";

function rolled(formula: string, deps: Pick<SpringDeps, "rollDie">): number {
  // The dice parser has no d3, which the darts' count uses: a d6 halved, rounded up, as at the table.
  const thirds = /^(\d+)d3$/.exec(formula);
  if (thirds)
    return Array.from({ length: Number(thirds[1]) }, () => Math.ceil(deps.rollDie(6) / 2)).reduce((a, b) => a + b, 0);
  return Math.max(0, resolveDice(parseDiceFormula(formula), deps.rollDie).total);
}

/** The creatures a trap acts on: the one that set it off, or each creature on the map in its blast (its trapped area
 *  unless the GM marked the blast elsewhere). */
function victimsOf(
  state: GameState,
  trap: MapTrap,
  record: TrapRecord,
  triggererId: string | null,
  deps: SpringDeps
): Actor[] {
  if (record.trap.targets === "triggerer")
    return state.actors.filter((actor) => actor.id === triggererId && !isDead(actor));
  const rect = trap.blast ?? trap.area;
  const calibration = deps.geometry?.calibration;
  return state.actors.filter((actor) => {
    const token = state.combat.tokens.find(
      (candidate) => candidate.actorId === actor.id && candidate.position !== null
    );
    return (
      token?.position !== undefined && !isDead(actor) && spaceIn(rect, calibration, token.position!, token.sizeCells)
    );
  });
}

/** What one round of damage parts comes to, rolled. */
const rollParts = (damage: TrapTier["damage"], deps: Pick<SpringDeps, "rollDie">) =>
  damage.map((part) => ({ amount: rolled(part.formula, deps), type: part.type }));

/** Damage a trap deals outright (a pit's spikes). */
function hurt(
  state: GameState,
  actor: Actor,
  record: TrapRecord,
  parts: ReadonlyArray<{ amount: number; type: string }>,
  deps: SpringDeps,
  events: EffectNarration[]
): void {
  const amount = parts.reduce((sum, part) => sum + part.amount, 0);
  if (amount <= 0) return;
  const { application, events: landed } = applyDamageDetailed(
    state,
    actor.id,
    { amount, parts, sourceName: record.name, sourceActorId: null },
    { role: "gm" },
    {
      resolveDefinition: deps.resolveDefinition,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      newId: deps.newId,
      now: deps.now,
      rollDie: deps.rollDie
    }
  );
  events.push(
    {
      kind: "damage",
      text: `${actor.name} takes ${application.totalApplied} damage from the ${record.name}${damageAdjustmentDetail(application)}.`,
      actorId: actor.id
    },
    ...landed
  );
}

/** The trap's save for one creature, with the damage a failure deals rolled now. Returns the save's ids. */
function trapSave(
  state: GameState,
  actor: Actor,
  record: TrapRecord,
  tier: TrapTier,
  parts: ReadonlyArray<{ amount: number; type: string }>,
  deps: SpringDeps
): string[] {
  const save = tier.save!;
  const action: ActorAction = {
    id: `trap-${record.id}`,
    name: record.name,
    activation: "other",
    description: record.name,
    damage: structuredClone(tier.damage),
    save: structuredClone(save)
  };
  const source = { id: TRAP_SOURCE_ID, name: record.name, inventory: [] } as unknown as Actor;
  const onFail = failureEffectFor(
    { action, attacker: source, riderItemId: null, deps: { catalog: deps.catalog }, castId: null },
    save.failureConditions
  );
  const before = new Set(state.combat.pendingSaves.map((pending) => pending.id));
  createPendingSaves(state, {
    sourceActorId: null,
    sourceName: record.name,
    actionName: record.name,
    ability: save.ability,
    dc: save.dc,
    targetIds: [actor.id],
    proposedDamage: parts.reduce((sum, part) => sum + part.amount, 0),
    proposedDamageParts: parts,
    halfOnSuccess: save.successDamage === "half",
    conditionIds: [...save.failureConditions],
    ...(onFail ? { onFailEffect: { ...onFail, sourceActorId: null, sourceName: record.name } } : {}),
    replaceExisting: false,
    newSaveId: deps.newId,
    createdAt: Date.parse(deps.now())
  });
  return state.combat.pendingSaves.filter((pending) => !before.has(pending.id)).map((pending) => pending.id);
}

/** What a trap going off did: the saves the creature that set it off owes, the lines for the table, and whether that
 *  creature's move ends where it set it off (it fell into the pit). */
export type TrapSpring = Readonly<{ saveIds: string[]; events: EffectNarration[]; stops: boolean }>;

/**
 * A trap goes off, set off by a creature (or by the GM, with no creature: a collapse on whoever is under it). It is
 * spent, or waits for the next turn where it resets, and the party knows of it now. Each creature it acts on falls into
 * its pit (the fall's dice, plus the spikes' damage, and the In a Pit effect), makes its save against the damage at its
 * band (each failure struck by its own count of darts), or takes its damage; a collapse leaves its area Difficult Terrain.
 */
export function springTrapOn(
  state: GameState,
  mapTrapId: string,
  triggererId: string | null,
  deps: SpringDeps
): TrapSpring {
  const trap = (state.combat.traps ?? []).find((candidate) => candidate.id === mapTrapId);
  const record = trap ? trapRecord(trap.trapId) : undefined;
  if (!trap || !record) return { saveIds: [], events: [], stops: false };
  const tier = tierOf(record, trap.tier);
  const triggerer = state.actors.find((actor) => actor.id === triggererId);
  const openPit = record.trap.pit && trap.state === "sprung";
  state.combat = {
    ...state.combat,
    traps: state.combat.traps.map((candidate) =>
      candidate.id === trap.id
        ? {
            ...candidate,
            state: "sprung" as const,
            found: true,
            activations: Math.min(1000, candidate.activations + 1),
            sprungTurn: turnKey(state)
          }
        : candidate
    )
  };
  const victims = victimsOf(state, trap, record, triggererId, deps);
  // The line is told about the creature that set it off, or the first one it catches.
  const about = triggerer?.id ?? victims[0]?.id;
  const events: EffectNarration[] = about
    ? [
        {
          kind: "effect",
          text: openPit
            ? `${triggerer?.name ?? "A creature"} steps into the open ${record.name}.`
            : triggerer
              ? `${triggerer.name} sets off a ${record.name}!`
              : `A ${record.name} goes off!`,
          actorId: about
        }
      ]
    : [];
  const saveIds: string[] = [];
  for (const victim of victims) {
    if (tier.pitFeet !== undefined) {
      events.push({
        kind: "effect",
        text: `${victim.name} falls into the ${tier.pitFeet}-foot pit.`,
        actorId: victim.id
      });
      hurt(state, victim, record, rollParts(tier.damage, deps), deps, events);
      addEffect(
        state,
        victim.id,
        makeEffect({
          id: `in-pit:${trap.id}`,
          name: `In a ${tier.pitFeet}-foot pit`,
          tags: [IN_PIT_TAG],
          sourceName: record.name,
          startedRound: state.combat.round,
          duration: { type: "manual" }
        })
      );
      events.push(
        ...startFall(
          state,
          { actorId: victim.id, feet: tier.pitFeet },
          {
            resolveDefinition: deps.resolveDefinition,
            ...(deps.catalog ? { catalog: deps.catalog } : {}),
            random: deps.rollDie,
            newId: deps.newId,
            now: deps.now
          }
        )
      );
      continue;
    }
    if (tier.save) {
      if (tier.hugeSucceeds && (victim.size === "huge" || victim.size === "gargantuan")) {
        events.push({
          kind: "effect",
          text: `${victim.name} is too large for the ${record.name} and succeeds on its save.`,
          actorId: victim.id
        });
        continue;
      }
      // "Struck by 1d3 darts, taking 3 (1d6) Poison damage per dart": the count is its own for each creature.
      const darts = tier.darts !== undefined ? Math.max(1, rolled(tier.darts, deps)) : 1;
      const parts = Array.from({ length: darts }, () => rollParts(tier.damage, deps))
        .flat()
        .reduce<Array<{ amount: number; type: string }>>((merged, part) => {
          const same = merged.find((entry) => entry.type === part.type);
          if (same) same.amount += part.amount;
          else merged.push({ ...part });
          return merged;
        }, []);
      const ids = trapSave(state, victim, record, tier, parts, deps);
      if (victim.id === triggererId) saveIds.push(...ids);
      events.push({
        kind: "effect",
        text: `${victim.name} makes a DC ${tier.save.dc} ${tier.save.ability.toUpperCase()} save against the ${record.name}${tier.darts ? ` (${darts} ${darts === 1 ? "dart" : "darts"} if it fails)` : ""}.`,
        actorId: victim.id
      });
      continue;
    }
    hurt(state, victim, record, rollParts(tier.damage, deps), deps, events);
  }
  // "Rubble from the collapse turns the trapped area into Difficult Terrain."
  if (record.trap.rubble)
    state.combat = {
      ...state.combat,
      terrain: { ...state.combat.terrain, difficult: unionRect(state.combat.terrain.difficult, trap.area) }
    };
  if (record.trap.rolls && about)
    events.push({
      kind: "effect",
      text: `The ${record.name} is loose: it rolls Initiative with a +8 bonus and the GM runs it on its turns.`,
      actorId: about,
      gmOnly: true
    });
  return { saveIds, events, stops: tier.pitFeet !== undefined && triggererId !== null };
}

/** The GM sets off a trap whose trigger the map can't see (a needle in a lock), on a creature or on its area. */
export function springTrapByHand(
  state: GameState,
  mapTrapId: string,
  actorId: string | null,
  scope: Initiator,
  deps: SpringDeps
): EffectNarration[] {
  requireGm(scope, "Only the GM sets off a trap by hand.");
  if (!(state.combat.traps ?? []).some((trap) => trap.id === mapTrapId))
    throw new CommandRejectedError("That trap is no longer on the map.");
  return springTrapOn(state, mapTrapId, actorId, deps).events;
}

// ---- pits ----------------------------------------------------------------------------------------------------------

/** The tag of the effect on a creature at the bottom of a pit. */
export const IN_PIT_TAG = "in-pit";

/** SRD Hidden Pit: "A creature needs a Climb Speed, climbing gear, or magic such as Spider Climb to scale the pit's
 *  smooth walls." Why a move out of the pit is refused, or null when it may go. */
export function pitRefusal(
  state: GameState,
  mover: Actor,
  from: Point,
  to: Point,
  sizeCells: number,
  way: Readonly<{ climbs: boolean; flies: boolean; hasClimbingGear: boolean }>,
  calibration: SquareGridCalibration | null | undefined
): string | null {
  const effect = mover.effects.find((candidate) => candidate.tags.includes(IN_PIT_TAG));
  if (!effect) return null;
  const trapId = effect.id.slice("in-pit:".length);
  const trap = (state.combat.traps ?? []).find((candidate) => candidate.id === trapId);
  if (!trap || !spaceIn(trap.area, calibration, from, sizeCells) || spaceIn(trap.area, calibration, to, sizeCells))
    return null;
  if (way.climbs || way.flies || way.hasClimbingGear) return null;
  return `${mover.name} is at the bottom of the pit: it needs a Climb Speed, climbing gear or magic to climb its smooth walls.`;
}

/** A creature that has left the pit it fell into (it climbed, flew or was moved out) is no longer in it. */
export function leftPit(
  state: GameState,
  actorId: string,
  calibration: SquareGridCalibration | null | undefined
): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const effect = actor?.effects.find((candidate) => candidate.tags.includes(IN_PIT_TAG));
  if (!actor || !effect) return [];
  const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId);
  const trap = (state.combat.traps ?? []).find((candidate) => `in-pit:${candidate.id}` === effect.id);
  if (trap && token?.position && spaceIn(trap.area, calibration, token.position, token.sizeCells)) return [];
  return endEffect(state, actorId, effect.id);
}

// ---- finding and making safe ---------------------------------------------------------------------------------------

/**
 * A Search with Wisdom (Perception) or a Study with Intelligence (Investigation) examines the trapped areas within reach:
 * each hidden trap whose way of being found takes that action and skill, at a DC the check's total meets, and whose area
 * lies within its distance (10 feet where the trap names none), is found for the party. Returns the lines for the table.
 */
export function findTraps(
  state: GameState,
  searcherId: string,
  check: Readonly<{ action: "search" | "study"; skill: string | undefined; total: number; pixelsPerFoot?: number }>
): EffectNarration[] {
  const searcher = state.actors.find((actor) => actor.id === searcherId);
  if (!searcher) return [];
  const events: EffectNarration[] = [];
  for (const trap of state.combat.traps ?? []) {
    if (trap.found || trap.state === "disarmed") continue;
    const record = trapRecord(trap.trapId);
    if (!record) continue;
    const feet = feetToRect(state, searcherId, trap.area, check.pixelsPerFoot);
    const found = record.trap.detect.find(
      (way) =>
        way.action === check.action &&
        way.skill === check.skill &&
        check.total >= way.dc &&
        feet !== null &&
        feet <= (way.withinFeet ?? SEARCH_FEET) + 0.1
    );
    if (!found) continue;
    state.combat = {
      ...state.combat,
      traps: state.combat.traps.map((candidate) =>
        candidate.id === trap.id ? { ...candidate, found: true } : candidate
      )
    };
    events.push({
      kind: "effect",
      text: `${searcher.name} finds ${found.finds}: a ${record.name}.`,
      actorId: searcherId
    });
  }
  return events;
}

/** The hidden glyphs a check can notice, by spell: Glyph of Warding's with Intelligence (Investigation), "detecting
 *  the glyph"; Symbol's with Wisdom (Perception), "requires a successful Wisdom (Perception) check ... to notice". */
const GLYPH_SKILLS: Readonly<Record<string, Readonly<{ action: "search" | "study"; skill: string }>>> = {
  "glyph-of-warding": { action: "study", skill: "investigation" },
  symbol: { action: "search", skill: "perception" }
};

/**
 * A Search or Study notices the hidden glyphs within 10 feet whose spell save DC its total meets, with the skill each
 * spell names: the glyph is drawn for everyone from then on. Returns the lines for the table.
 */
export function noticeGlyphs(
  state: GameState,
  searcherId: string,
  check: Readonly<{ action: "search" | "study"; skill: string | undefined; total: number; pixelsPerFoot?: number }>
): EffectNarration[] {
  const searcher = state.actors.find((actor) => actor.id === searcherId);
  const token = state.combat.tokens.find(
    (candidate) => candidate.actorId === searcherId && candidate.position !== null
  );
  const pixelsPerFoot = scaleOf(state, check.pixelsPerFoot);
  if (!searcher || !token?.position || !pixelsPerFoot) return [];
  const events: EffectNarration[] = [];
  for (const zone of state.combat.spellZones) {
    const way = GLYPH_SKILLS[zone.spellId];
    if (!way || way.action !== check.action || way.skill !== check.skill || check.total < zone.dc) continue;
    const area = state.combat.annotations.find(
      (annotation) => annotation.id === zone.annotationId && annotation.visibility !== "public"
    );
    if (!area) continue;
    const at = area.geometry.origin;
    const feet = Math.hypot(at.x - token.position.x, at.y - token.position.y) / pixelsPerFoot - token.sizeCells * 2.5;
    if (feet > SEARCH_FEET + 0.1) continue;
    state.combat = {
      ...state.combat,
      annotations: state.combat.annotations.map((annotation) =>
        annotation.id === area.id
          ? { ...annotation, visibility: "public" as const, visibleToActorId: null }
          : annotation
      )
    };
    events.push({ kind: "effect", text: `${searcher.name} notices a glyph: ${zone.name}.`, actorId: searcherId });
  }
  return events;
}

/** The outcome a disarm check settles: the trap made safe on a success, or set off on a failure that springs it. */
export type DisarmOutcome = Readonly<{ kind: "disarm-trap"; actorId: string; trapId: string; springs: boolean }>;

/** Settles a disarm check's outcome. A trap already sprung or made safe stays as it is. */
export function settleDisarm(
  state: GameState,
  outcome: DisarmOutcome,
  success: boolean,
  deps: SpringDeps
): EffectNarration[] {
  const trap = (state.combat.traps ?? []).find((candidate) => candidate.id === outcome.trapId);
  const record = trap ? trapRecord(trap.trapId) : undefined;
  if (!trap || !record || trap.state !== "armed") return [];
  const actor = state.actors.find((candidate) => candidate.id === outcome.actorId);
  if (success) {
    markDisarmed(state, trap.id);
    return [
      { kind: "effect", text: `${actor?.name ?? "Someone"} disarms the ${record.name}.`, actorId: outcome.actorId }
    ];
  }
  if (!outcome.springs) return [];
  return springTrapOn(state, trap.id, outcome.actorId, deps).events;
}

function markDisarmed(state: GameState, trapId: string): void {
  state.combat = {
    ...state.combat,
    traps: state.combat.traps.map((candidate) =>
      candidate.id === trapId ? { ...candidate, state: "disarmed" as const, found: true } : candidate
    )
  };
}

export type DisarmInput = Readonly<{
  commandId: string;
  actorId: string;
  trapId: string;
  /** Which of the trap's ways to make it safe. */
  disarmId: string;
  /** Take it as a Bonus Action (a Thief's Fast Hands). */
  bonusAction?: boolean;
}>;

/**
 * A creature within 5 feet of a found trap makes it safe as one of the trap's ways says, taking the Utilize action in a
 * fight (a Thief's Bonus Action with Fast Hands): cut the wire or plug the holes, wedge an Iron Spike it carries, or make
 * the check the way names, with Thieves' Tools where it carries them (the tools' "disarm a trap"), whose failure sets
 * the trap off where the way says so.
 */
export function disarmTrap(
  state: GameState,
  scope: Initiator,
  input: DisarmInput,
  deps: CheckRollDependencies & SpringDeps
): Readonly<{ events: EffectNarration[]; check?: CheckResult }> {
  const actor = state.actors.find((candidate) => candidate.id === input.actorId);
  if (!actor) throw new CommandRejectedError("That creature no longer exists.");
  requireActorAccess(scope, state, actor.id, "check", "You can only act for your own character.");
  const trap = (state.combat.traps ?? []).find((candidate) => candidate.id === input.trapId);
  const record = trap ? trapRecord(trap.trapId) : undefined;
  // A player knows only the traps the party has found; another is "no longer on the map" to them.
  if (!trap || !record || (scope.role !== "gm" && !trap.found))
    throw new CommandRejectedError("That trap is no longer on the map.");
  if (trap.state === "disarmed") throw new CommandRejectedError(`The ${record.name} is already safe.`);
  const way = record.trap.disarm.find((candidate) => candidate.id === input.disarmId);
  if (!way) throw new CommandRejectedError(`The ${record.name} can't be made safe that way.`);
  const calibration = deps.geometry?.calibration;
  const feet = feetToRect(
    state,
    actor.id,
    trap.area,
    calibration ? calibration.cellSizePx / calibration.distancePerCell : undefined
  );
  if (feet !== null && feet > TOUCH_FEET)
    throw new CommandRejectedError(`${actor.name} must be within 5 feet of the ${record.name}.`);
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  if (way.spends && !carriedRow(actor, way.spends)) {
    const needs = deps.catalog?.equipmentRecord(way.spends)?.name ?? way.spends;
    throw new CommandRejectedError(`${actor.name} needs ${needs} to do that.`);
  }
  if (!way.check) {
    spendUtilize(state, actor, scope, way.name, { bonusAction: input.bonusAction === true, definition });
    markDisarmed(state, trap.id);
    return {
      events: [{ kind: "effect", text: `${actor.name} makes the ${record.name} safe: ${way.name}.`, actorId: actor.id }]
    };
  }
  const outcome: DisarmOutcome = {
    kind: "disarm-trap",
    actorId: actor.id,
    trapId: trap.id,
    springs: way.check.failureSprings
  };
  const subject = { ability: way.check.ability, skill: way.check.skill };
  const label = `${way.name} (${record.name})`.slice(0, 80);
  const visibility = actor.visibility === "public" ? "public" : "gm-only";
  // SRD Thieves' Tools: "Utilize: ... disarm a trap (DC 15)": with the tools carried, the check uses them.
  const check = carriedRow(actor, "thieves-tools")
    ? rollUtilizeCheck(
        state,
        scope,
        {
          commandId: input.commandId,
          actorId: actor.id,
          itemId: "thieves-tools",
          subject: { ...subject, tool: "thieves-tools" },
          dc: way.check.dc,
          label,
          visibility,
          ...(input.bonusAction ? { bonusAction: true } : {}),
          onSuccess: outcome
        },
        deps
      )
    : (() => {
        spendUtilize(state, actor, scope, way.name, { bonusAction: input.bonusAction === true, definition });
        return rollAbilityCheck(
          state,
          scope,
          {
            commandId: input.commandId,
            actorId: actor.id,
            subject,
            dc: way.check!.dc,
            visibility,
            label,
            onSuccess: outcome
          },
          deps
        );
      })();
  return { events: [...(check.events ?? [])], check };
}

// ---- what reaches the table --------------------------------------------------------------------------------------

/** A found trap as players and the table screen get it: its name, its area and whether it is still dangerous. Never its
 *  band, its DCs or a trap the party hasn't found. */
export type VisibleTrap = Readonly<{ id: string; name: string; area: Rect; state: MapTrap["state"] }>;

export function visibleTraps(traps: readonly MapTrap[] | undefined): VisibleTrap[] {
  return (traps ?? [])
    .filter((trap) => trap.found)
    .map((trap) => ({ id: trap.id, name: trap.name, area: { ...trap.area }, state: trap.state }));
}

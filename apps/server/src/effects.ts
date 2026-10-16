import type { Actor, EffectInstance, GameState } from "@vtt/domain";
import type { ActorDefinition, SaveFailureDuration } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { conditionLabel, exhaustionLevel, INCAPACITATING_CONDITIONS } from "./condition-rules.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";

/** Effect lifecycle (ADR-0020): the engine ends effects on turn boundaries, source defeat and explicit
 *  end, clearing linked conditions and firing onEnd grants. Returns narration events rather than writing
 *  the log. Sweeps touch only actors in the current initiative, so parked scenes keep their effects. */

/** `immune` marks a condition skipped for immunity, so a caller can drop its generic "is X" line without reading
 *  the text. */
export type EffectNarration = Readonly<{
  kind: "effect" | "condition" | "reaction";
  text: string;
  actorId: string;
  immune?: true;
  /** Who the line names as the cause (an effect's source), so the table's copy can mask a hidden one. */
  source?: Readonly<{ actorId: string; name: string | null }>;
  /** For the GM alone even when the actor is visible: a monster's spent resources are GM knowledge. */
  gmOnly?: true;
}>;

const MAX_EFFECTS = 20;

/** The tag on a caster's own "Concentrating on X" effect; ending it ends everything its cast made. */
export const CONCENTRATING_TAG = "concentrating";
/** The Barbarian's Rage: it ends early on Incapacitated or in Heavy armor, and blocks spells and Concentration. */
export const RAGING_TAG = "raging";
/** A creature knocked out at 1 HP; it wakes when it regains any hit points. */
export const KNOCKED_OUT_TAG = "knocked-out";

/** What an effect must name; every other field takes `EffectInstanceSchema`'s default. */
export type EffectSpec = Pick<EffectInstance, "id" | "name" | "duration"> & Partial<EffectInstance>;

/** Builds an effect from the fields it sets, with the schema's defaults (in schema order) for the rest. */
export function makeEffect({ id, name, duration, ...rest }: EffectSpec): EffectInstance {
  return {
    id,
    name,
    tags: [],
    sourceActorId: null,
    sourceName: null,
    sourceActionId: null,
    startedRound: 1,
    duration,
    endsWhenSourceDefeated: false,
    voidWhileIncapacitated: false,
    concentration: false,
    endsWithTag: null,
    modifiers: [],
    linkedConditionIds: [],
    escapeDc: null,
    onEnd: [],
    ...rest
  };
}

/** "Until the end of X's next turn": when it starts during X's own turn, the end of that turn doesn't count. */
export function turnEndDuration(
  state: GameState,
  type: "until-bearer-turn-end" | "until-source-turn-end",
  creatureId: string
): EffectInstance["duration"] {
  return { type, skipsCurrentTurn: state.combat.active && state.combat.turnActorId === creatureId };
}

/** A failed save's or a hit's printed duration as an effect duration, for a bearer and a source: "for 1 minute" counts
 *  rounds, "until the end of its/your next turn" belongs to the bearer/source. Absent is until ended. */
export function effectDurationOf(
  state: GameState,
  duration: SaveFailureDuration | undefined,
  bearerId: string,
  sourceId: string | null
): EffectInstance["duration"] {
  if (duration === undefined) return { type: "manual" };
  switch (duration.type) {
    case "rounds":
      return { type: "rounds", remaining: duration.rounds };
    case "until-source-next-turn":
      return { type: "until-source-next-turn" };
    case "until-bearer-turn-end":
      return turnEndDuration(state, "until-bearer-turn-end", bearerId);
    case "until-source-turn-end":
      return turnEndDuration(state, "until-source-turn-end", sourceId ?? bearerId);
  }
}

/** Where item- and feat-granted condition immunities are read from. Without a catalog only the actor's
 *  innate immunities apply. */
export type ConditionImmunitySource = Readonly<{
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
}>;

/** SRD condition immunity: innate, granted by what the actor carries when a catalog is supplied, or Petrified's
 *  own immunity to the Poisoned condition. */
function immuneToCondition(actor: Actor, conditionId: string, source?: ConditionImmunitySource): boolean {
  if (actor.conditionImmunities.includes(conditionId)) return true;
  if (conditionId === "poisoned" && hasCondition(actor, "petrified")) return true;
  if (!source?.catalog) return false;
  const definition = actor.definitionId ? source.resolveDefinition?.(actor.definitionId) : undefined;
  return deriveEquipment(actor, definition, source.catalog).conditionImmunities.some(
    (entry) => entry.id === conditionId
  );
}

const hasCondition = (actor: Actor, conditionId: string) =>
  actor.conditions.some((condition) => condition.id === conditionId);

const linkedByAnEffect = (actor: Actor, conditionId: string) =>
  actor.effects.some((effect) => effect.linkedConditionIds.includes(conditionId));

type ConditionEntry = Actor["conditions"][number];

/** Writes one condition entry, keeping the list sorted and the entry's provenance flags. */
function writeCondition(actor: Actor, entry: ConditionEntry): void {
  actor.conditions = [...actor.conditions.filter((condition) => condition.id !== entry.id), entry].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
}

/**
 * The one condition writer, used by every path that sets a condition (no scope check). Refuses an immune actor and a
 * full condition list; the caller decides whether to narrate or reject. Exhaustion is cumulative (SRD: "each time you
 * receive it, you gain 1 Exhaustion level"), so an Exhaustion with no `level` adds one; a `level` sets it outright
 * (the GM's stepper). Unconscious brings Prone with it, which stays when Unconscious ends, and Petrified drops
 * Poisoned, which it is immune to. `selfApplied` marks a player's own mark on their character; an effect's own
 * linked conditions go through `addEffect` instead.
 */
export function applyCondition(
  actor: Actor,
  conditionId: string,
  options: Readonly<{ level?: number; immunities?: ConditionImmunitySource; selfApplied?: boolean }> = {}
): "applied" | "immune" | "full" {
  if (immuneToCondition(actor, conditionId, options.immunities)) return "immune";
  const existing = actor.conditions.find((condition) => condition.id === conditionId);
  if (!existing && actor.conditions.length >= 20) return "full";
  const level = conditionId === "exhaustion" ? { level: options.level ?? Math.min(6, (existing?.level ?? 0) + 1) } : {};
  // A condition an effect also holds stays when that effect ends; a player's own mark stays theirs to remove only
  // while nothing else imposed it.
  const standalone = linkedByAnEffect(actor, conditionId) ? { standalone: true as const } : {};
  const selfApplied =
    options.selfApplied === true && (!existing || existing.selfApplied === true) ? { selfApplied: true as const } : {};
  writeCondition(actor, { id: conditionId, ...level, ...selfApplied, ...standalone });
  if (conditionId === "unconscious" && !hasCondition(actor, "prone")) applyCondition(actor, "prone", options);
  if (conditionId === "petrified") removeConditionDirect(actor, "poisoned");
  return "applied";
}

export function removeConditionDirect(actor: Actor, conditionId: string) {
  actor.conditions = actor.conditions.filter((condition) => condition.id !== conditionId);
}

export function hasEffectTag(actor: Actor, tag: string): boolean {
  return actor.effects.some((effect) => effect.tags.includes(tag));
}

/**
 * What gaining a condition does beyond itself, shared by every path that can impose one (a GM chip, a failed save,
 * an on-hit rider, an effect's linked conditions): an Incapacitated creature's grapples release and its
 * Concentration breaks (SRD Incapacitated, Grappling), and its Rage ends; Exhaustion 6 is death. 0 HP is handled
 * by the damage path, which ends everything the creature sustains.
 */
export function conditionGained(
  state: GameState,
  actor: Actor,
  conditionId: string,
  previousExhaustion = 0
): EffectNarration[] {
  const events: EffectNarration[] = [];
  if ((INCAPACITATING_CONDITIONS as readonly string[]).includes(conditionId)) {
    events.push(...releaseGrapplesHeldBy(state, actor.id));
    events.push(...endConcentrationSustainedBy(state, actor.id));
    for (const rage of actor.effects.filter((effect) => effect.tags.includes(RAGING_TAG)))
      endEffectInternal(state, actor, rage.id, events);
  }
  if (conditionId === "exhaustion" && previousExhaustion < 6 && exhaustionLevel(actor) >= 6)
    events.push(...applyExhaustionDeath(state, actor));
  return events;
}

/** Adds an effect (idempotent by id). A grant from the same source actor and action replaces the older
 *  instance (a re-declared Rage refreshes rather than stacks). Applies linked conditions the bearer is not
 *  immune to, and runs what gaining them does (`conditionGained`). */
export function addEffect(
  state: GameState,
  actorId: string,
  effect: EffectInstance,
  events?: EffectNarration[],
  immunities?: ConditionImmunitySource
): EffectInstance {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  const existing = actor.effects.find((candidate) => candidate.id === effect.id);
  if (existing) return existing;
  // SRD Concentration: one at a time - starting a new one ends the source's others. Effects of one cast share a
  // `castId` and are one Concentration.
  if (effect.concentration && effect.sourceActorId !== null) {
    const ended = endConcentrationSustainedBy(state, effect.sourceActorId, effect.castId);
    events?.push(...ended);
  }
  // SRD Rage: "You can't maintain Concentration".
  if (effect.tags.includes(RAGING_TAG)) events?.push(...endConcentrationSustainedBy(state, actor.id));
  // What some effect already held (the one a refresh replaces included), so only a condition set on its own is
  // marked as outliving this effect.
  const heldBefore = new Set(actor.effects.flatMap((candidate) => candidate.linkedConditionIds));
  const replaced =
    effect.sourceActionId !== null
      ? actor.effects.find(
          (candidate) =>
            candidate.sourceActorId === effect.sourceActorId && candidate.sourceActionId === effect.sourceActionId
        )
      : undefined;
  if (replaced) {
    // Refresh in place: no onEnd fires, linked conditions stay (re-applied below for safety).
    actor.effects = actor.effects.map((candidate) => (candidate.id === replaced.id ? effect : candidate));
  } else {
    if (actor.effects.length >= MAX_EFFECTS)
      throw new CommandRejectedError("That combatant already has too many active effects.");
    actor.effects = [...actor.effects, effect];
  }
  for (const conditionId of effect.linkedConditionIds) {
    const present = actor.conditions.find((condition) => condition.id === conditionId);
    if (present) {
      // Already there on its own (a GM chip, a self mark): it outlives this effect.
      if (!present.standalone && !heldBefore.has(conditionId)) writeCondition(actor, { ...present, standalone: true });
      continue;
    }
    if (immuneToCondition(actor, conditionId, immunities)) continue;
    if (actor.conditions.length >= 20) continue;
    const level = conditionId === "exhaustion" ? { level: 1 } : {};
    writeCondition(actor, { id: conditionId, ...level });
    if (conditionId === "unconscious" && !hasCondition(actor, "prone")) applyCondition(actor, "prone", { immunities });
    if (conditionId === "petrified") removeConditionDirect(actor, "poisoned");
    const gained = conditionGained(state, actor, conditionId);
    events?.push(...gained);
  }
  return effect;
}

/** SRD: Exhaustion 6 is death. A player character drops to 0 with three death-save failures; others are defeated.
 *  Either way it ends what the creature sustains, its Concentration included. */
export function applyExhaustionDeath(state: GameState, actor: Actor): EffectNarration[] {
  if (exhaustionLevel(actor) < 6) return [];
  const events: EffectNarration[] = [];
  actor.hp.current = 0;
  if (actor.kind === "player-character") {
    actor.deathSaves = { successes: 0, failures: 3, stable: false };
    applyCondition(actor, "unconscious");
  }
  events.push({ kind: "condition", text: `${actor.name} dies of Exhaustion (level 6).`, actorId: actor.id });
  events.push(...endEffectsSustainedBy(state, actor.id));
  events.push(...endConcentrationSustainedBy(state, actor.id));
  return events;
}

/** The cause a narration line names, for masking a hidden one. */
export const sourceOf = (effect: Pick<EffectInstance, "sourceActorId" | "sourceName">) =>
  effect.sourceActorId !== null ? { source: { actorId: effect.sourceActorId, name: effect.sourceName } } : {};

/** Tolerant single-effect removal used by every sweep; returns false when the effect is already gone. */
function endEffectInternal(state: GameState, actor: Actor, effectId: string, events: EffectNarration[]): boolean {
  const effect = actor.effects.find((candidate) => candidate.id === effectId);
  if (!effect) return false;
  actor.effects = actor.effects.filter((candidate) => candidate.id !== effectId);
  events.push({
    kind: "effect",
    text: `${effect.name} ended on ${actor.name}.`,
    actorId: actor.id,
    ...sourceOf(effect)
  });
  for (const conditionId of effect.linkedConditionIds) {
    if (linkedByAnEffect(actor, conditionId)) continue;
    const entry = actor.conditions.find((condition) => condition.id === conditionId);
    if (!entry) continue;
    // Set on its own as well (SRD: each source has its own end), so only this effect's hold is gone.
    if (entry.standalone) {
      const { standalone: _held, ...rest } = entry;
      writeCondition(actor, rest);
      continue;
    }
    removeConditionDirect(actor, conditionId);
    events.push({
      kind: "condition",
      text: `${actor.name} is no longer ${conditionLabel(conditionId)}.`,
      actorId: actor.id
    });
  }
  for (const grant of effect.onEnd) {
    const before = exhaustionLevel(actor);
    const level = grant.conditionId === "exhaustion" ? Math.min(6, before + (grant.level ?? 1)) : grant.level;
    const applied = applyCondition(actor, grant.conditionId, { level }) === "applied";
    events.push({
      kind: "condition",
      text: `${actor.name} gains ${conditionLabel(grant.conditionId)}${grant.conditionId === "exhaustion" ? ` ${applied ? level : before}` : ""} (${effect.name} ended).`,
      actorId: actor.id
    });
    if (applied && grant.conditionId === "exhaustion" && before < 6 && (level ?? 0) >= 6)
      events.push(...applyExhaustionDeath(state, actor));
  }
  // The caster's "Concentrating on X" ending ends everything that cast made, on every creature.
  if (effect.tags.includes(CONCENTRATING_TAG) && effect.castId !== undefined) {
    for (const bearer of state.actors) {
      for (const sustained of [...bearer.effects]) {
        if (sustained.castId === effect.castId) endEffectInternal(state, bearer, sustained.id, events);
      }
    }
  }
  // Cascade: effects that exist only while another tag is present end with it.
  for (const dependent of [...actor.effects]) {
    if (
      dependent.endsWithTag !== null &&
      !actor.effects.some(
        (candidate) => candidate.id !== dependent.id && candidate.tags.includes(dependent.endsWithTag!)
      )
    ) {
      endEffectInternal(state, actor, dependent.id, events);
    }
  }
  return true;
}

/** End one effect: remove it, clear its linked conditions (unless another effect still links the same
 *  condition), fire its onEnd grants, and cascade dependents (endsWithTag). Returns narration events. */
export function endEffect(state: GameState, actorId: string, effectId: string): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  const events: EffectNarration[] = [];
  if (!endEffectInternal(state, actor, effectId, events)) throw new CommandRejectedError("That effect already ended.");
  return events;
}

/** SRD Grappling: a grapple ends if the grappler is incapacitated. Only grapple-tagged effects; 0 HP releases
 *  everything via endEffectsSustainedBy. */
export function releaseGrapplesHeldBy(state: GameState, grapplerActorId: string): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const actor of state.actors) {
    for (const effect of [...actor.effects]) {
      if (effect.tags.includes("grapple") && effect.sourceActorId === grapplerActorId) {
        endEffectInternal(state, actor, effect.id, events);
      }
    }
  }
  return events;
}

/** SRD Grappling: "the distance between the Grappled target and the grappler exceeds the grapple's range". Checked
 *  after a creature moves, for the grapples it holds or is held by; `distanceFeet` is null when the map can't tell. */
export function releaseGrapplesOutOfRange(
  state: GameState,
  moverId: string,
  distanceFeet: (actorIdA: string, actorIdB: string) => number | null,
  toleranceFeet = 0
): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const actor of state.actors) {
    for (const effect of [...actor.effects]) {
      if (!effect.tags.includes("grapple") || effect.sourceActorId === null) continue;
      if (actor.id !== moverId && effect.sourceActorId !== moverId) continue;
      const apart = distanceFeet(actor.id, effect.sourceActorId);
      if (apart !== null && apart > (effect.rangeFeet ?? 5) + toleranceFeet)
        endEffectInternal(state, actor, effect.id, events);
    }
  }
  return events;
}

/** SRD Concentration: end every concentration effect this source sustains (broken by damage-save failure,
 *  incapacitation, death, or starting another). `keepCastId` spares the cast being started. */
export function endConcentrationSustainedBy(
  state: GameState,
  sourceActorId: string,
  keepCastId?: string
): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const actor of state.actors) {
    for (const effect of [...actor.effects]) {
      if (
        effect.concentration &&
        effect.sourceActorId === sourceActorId &&
        (keepCastId === undefined || effect.castId !== keepCastId)
      ) {
        endEffectInternal(state, actor, effect.id, events);
      }
    }
  }
  return events;
}

/** Tolerant end-by-reference for deferred consequences (a failed concentration save after a rewind): a missing effect is a no-op. */
export function endEffectIfPresent(state: GameState, actorId: string, effectId: string): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return [];
  const events: EffectNarration[] = [];
  endEffectInternal(state, actor, effectId, events);
  return events;
}

/** A defeated (0 HP) or removed source releases everything it was sustaining (grapples, its own rage). */
export function endEffectsSustainedBy(state: GameState, sourceActorId: string): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const actor of state.actors) {
    for (const effect of [...actor.effects]) {
      if (effect.endsWhenSourceDefeated && effect.sourceActorId === sourceActorId) {
        endEffectInternal(state, actor, effect.id, events);
      }
    }
  }
  return events;
}

/** Effects that end the moment their bearer takes damage (Sleep, Turn Undead, Hypnotic Pattern). */
export function endEffectsOnDamage(state: GameState, actor: Actor): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const effect of actor.effects.filter((candidate) => candidate.endsOnDamage === true))
    endEffectInternal(state, actor, effect.id, events);
  return events;
}

/** A knocked-out creature wakes when it regains any hit points (SRD Knocking Out a Creature). */
export function endKnockOut(state: GameState, actor: Actor): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const effect of actor.effects.filter((candidate) => candidate.tags.includes(KNOCKED_OUT_TAG)))
    endEffectInternal(state, actor, effect.id, events);
  return events;
}

/** Turn-boundary expiry when `incomingActorId`'s turn begins: its "until-source-next-turn" effects end
 *  (Reckless Attack) and its "rounds" durations tick down (Rage). Only actors in the current initiative. */
export function expireEffectsAtTurnStart(state: GameState, incomingActorId: string): EffectNarration[] {
  const events: EffectNarration[] = [];
  const inFight = new Set(state.combat.initiative.map((entry) => entry.actorId));
  for (const actor of state.actors) {
    if (!inFight.has(actor.id)) continue;
    for (const effect of [...actor.effects]) {
      const sustainedByIncoming = (effect.sourceActorId ?? actor.id) === incomingActorId;
      if (!sustainedByIncoming) continue;
      if (effect.duration.type === "until-source-next-turn") {
        endEffectInternal(state, actor, effect.id, events);
      } else if (effect.duration.type === "rounds") {
        if (!actor.effects.some((candidate) => candidate.id === effect.id)) continue; // a cascade already ended it
        const remaining = effect.duration.remaining - 1;
        if (remaining <= 0) {
          endEffectInternal(state, actor, effect.id, events);
        } else {
          actor.effects = actor.effects.map((candidate) =>
            candidate.id === effect.id ? { ...candidate, duration: { type: "rounds", remaining } } : candidate
          );
        }
      }
    }
  }
  return events;
}

/** Turn-boundary expiry when `outgoingActorId`'s turn ends: "until the end of its next turn" effects borne by it,
 *  and "until the end of your next turn" effects it is the source of, end - unless they began during this very turn,
 *  in which case the next one is theirs. Only actors in the current initiative. */
export function expireEffectsAtTurnEnd(state: GameState, outgoingActorId: string): EffectNarration[] {
  const events: EffectNarration[] = [];
  const inFight = new Set(state.combat.initiative.map((entry) => entry.actorId));
  for (const actor of state.actors) {
    if (!inFight.has(actor.id)) continue;
    for (const effect of [...actor.effects]) {
      const duration = effect.duration;
      if (duration.type !== "until-bearer-turn-end" && duration.type !== "until-source-turn-end") continue;
      const owner = duration.type === "until-bearer-turn-end" ? actor.id : (effect.sourceActorId ?? actor.id);
      if (owner !== outgoingActorId || !actor.effects.some((candidate) => candidate.id === effect.id)) continue;
      if (duration.skipsCurrentTurn) {
        actor.effects = actor.effects.map((candidate) =>
          candidate.id === effect.id ? { ...candidate, duration: { ...duration, skipsCurrentTurn: false } } : candidate
        );
      } else {
        endEffectInternal(state, actor, effect.id, events);
      }
    }
  }
  return events;
}

/** Durations a fight's end sweeps: everything measured in turns or rounds (a 1-minute spell outlasting the fight by
 *  a few rounds is the documented approximation). "Until ended" effects (a grapple still held, a curse, an
 *  hour-long Concentration) outlast the fight. */
const ENDS_WITH_THE_FIGHT: ReadonlySet<EffectInstance["duration"]["type"]> = new Set([
  "rounds",
  "until-source-next-turn",
  "until-bearer-turn-end",
  "until-source-turn-end",
  "encounter"
]);

/** Encounter end: the fight's combatants' turn-measured effects end (onEnd fires); "until ended" ones stay. */
export function endEncounterEffects(state: GameState, combatantIds: readonly string[]): EffectNarration[] {
  const events: EffectNarration[] = [];
  const inFight = new Set(combatantIds);
  for (const actor of state.actors) {
    if (!inFight.has(actor.id)) continue;
    for (const effect of [...actor.effects])
      if (ENDS_WITH_THE_FIGHT.has(effect.duration.type)) endEffectInternal(state, actor, effect.id, events);
  }
  return events;
}

/** A long rest: eight hours pass and the creature sleeps (Unconscious, so its Concentration ends). Its effects
 *  measured in turns or rounds end; "until ended" ones (a curse, a disease) stay. */
export function endEffectsAtLongRest(state: GameState, actorId: string): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return [];
  const events: EffectNarration[] = [...endConcentrationSustainedBy(state, actorId)];
  for (const effect of [...actor.effects])
    if (ENDS_WITH_THE_FIGHT.has(effect.duration.type)) endEffectInternal(state, actor, effect.id, events);
  // The rest restores its hit points, and a knocked-out creature wakes when it regains any.
  events.push(...endKnockOut(state, actor));
  return events;
}

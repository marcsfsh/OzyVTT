import type { Actor, EffectInstance, GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { conditionLabel, exhaustionLevel } from "./condition-rules.js";
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
}>;

const MAX_EFFECTS = 20;

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

/** Where item- and feat-granted condition immunities are read from. Without a catalog only the actor's
 *  innate immunities apply. */
export type ConditionImmunitySource = Readonly<{
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
}>;

/** SRD condition immunity: innate, or granted by what the actor carries when a catalog is supplied. */
function immuneToCondition(actor: Actor, conditionId: string, source?: ConditionImmunitySource): boolean {
  if (actor.conditionImmunities.includes(conditionId)) return true;
  if (!source?.catalog) return false;
  const definition = actor.definitionId ? source.resolveDefinition?.(actor.definitionId) : undefined;
  return deriveEquipment(actor, definition, source.catalog).conditionImmunities.some(
    (entry) => entry.id === conditionId
  );
}

/** The one condition writer, used by every path that sets a condition (no scope check). Refuses an immune
 *  actor and a full condition list; the caller decides whether to narrate or reject. */
export function applyCondition(
  actor: Actor,
  conditionId: string,
  options: Readonly<{ level?: number; immunities?: ConditionImmunitySource }> = {}
): "applied" | "immune" | "full" {
  if (immuneToCondition(actor, conditionId, options.immunities)) return "immune";
  const remaining = actor.conditions.filter((condition) => condition.id !== conditionId);
  if (remaining.length >= 20) return "full";
  actor.conditions = [
    ...remaining,
    { id: conditionId, ...(conditionId === "exhaustion" ? { level: options.level ?? 1 } : {}) }
  ].sort((left, right) => left.id.localeCompare(right.id));
  return "applied";
}

export function removeConditionDirect(actor: Actor, conditionId: string) {
  actor.conditions = actor.conditions.filter((condition) => condition.id !== conditionId);
}

export function hasEffectTag(actor: Actor, tag: string): boolean {
  return actor.effects.some((effect) => effect.tags.includes(tag));
}

/** Adds an effect (idempotent by id). A grant from the same source actor and action replaces the older
 *  instance (a re-declared Rage refreshes rather than stacks). Applies linked conditions the bearer is not
 *  immune to. */
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
  // SRD Concentration: one sustained effect at a time - starting a new one ends the source's others.
  if (effect.concentration && effect.sourceActorId !== null) {
    const ended = endConcentrationSustainedBy(state, effect.sourceActorId);
    events?.push(...ended);
  }
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
  for (const conditionId of effect.linkedConditionIds) applyCondition(actor, conditionId, { immunities });
  return effect;
}

/** Exhaustion stacks by level (cap 6); other conditions are simple presence. Engine-owned onEnd path only. */
function grantConditionOnEnd(
  actor: Actor,
  conditionId: string,
  level: number | undefined
): { level: number | undefined; becameFatal: boolean } {
  if (conditionId === "exhaustion") {
    const existing = actor.conditions.find((condition) => condition.id === "exhaustion")?.level ?? 0;
    const next = Math.min(6, existing + (level ?? 1));
    const applied = applyCondition(actor, "exhaustion", { level: next }) === "applied";
    return { level: applied ? next : existing, becameFatal: applied && existing < 6 && next >= 6 };
  }
  applyCondition(actor, conditionId, { level });
  return { level, becameFatal: false };
}

/** SRD: Exhaustion 6 is death. A player character drops to 0 with three death-save failures; others are defeated. */
export function applyExhaustionDeath(state: GameState, actor: Actor): EffectNarration[] {
  if (exhaustionLevel(actor) < 6) return [];
  const events: EffectNarration[] = [];
  actor.hp.current = 0;
  if (actor.kind === "player-character") {
    actor.deathSaves = { successes: 0, failures: 3, stable: false };
    applyCondition(actor, "unconscious");
    applyCondition(actor, "prone");
  }
  events.push({ kind: "condition", text: `${actor.name} dies of Exhaustion (level 6).`, actorId: actor.id });
  events.push(...endEffectsSustainedBy(state, actor.id));
  return events;
}

/** Tolerant single-effect removal used by every sweep; returns false when the effect is already gone. */
function endEffectInternal(state: GameState, actor: Actor, effectId: string, events: EffectNarration[]): boolean {
  const effect = actor.effects.find((candidate) => candidate.id === effectId);
  if (!effect) return false;
  actor.effects = actor.effects.filter((candidate) => candidate.id !== effectId);
  events.push({ kind: "effect", text: `${effect.name} ended on ${actor.name}.`, actorId: actor.id });
  for (const conditionId of effect.linkedConditionIds) {
    if (actor.effects.some((candidate) => candidate.linkedConditionIds.includes(conditionId))) continue;
    removeConditionDirect(actor, conditionId);
    events.push({
      kind: "condition",
      text: `${actor.name} is no longer ${conditionLabel(conditionId)}.`,
      actorId: actor.id
    });
  }
  for (const grant of effect.onEnd) {
    const granted = grantConditionOnEnd(actor, grant.conditionId, grant.level);
    events.push({
      kind: "condition",
      text: `${actor.name} gains ${conditionLabel(grant.conditionId)}${grant.conditionId === "exhaustion" ? ` ${granted.level ?? 1}` : ""} (${effect.name} ended).`,
      actorId: actor.id
    });
    if (granted.becameFatal) events.push(...applyExhaustionDeath(state, actor));
  }
  // Cascade: effects that exist only while another tag is present end with it (Frenzy's marker ends with
  // the Rage, firing its Exhaustion once).
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

/** SRD Grappling: a grapple ends if the grappler is incapacitated. Only grapple-tagged effects (a
 *  stunned barbarian keeps their Rage); 0 HP releases everything via endEffectsSustainedBy. */
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

/** SRD Concentration: end every concentration effect this source sustains (broken by damage-save failure, incapacitation, or starting another). */
export function endConcentrationSustainedBy(state: GameState, sourceActorId: string): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const actor of state.actors) {
    for (const effect of [...actor.effects]) {
      if (effect.concentration && effect.sourceActorId === sourceActorId) {
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

/** Encounter end: every effect on this fight's combatants ends (onEnd fires, a documented simplification). */
export function endEncounterEffects(state: GameState, combatantIds: readonly string[]): EffectNarration[] {
  const events: EffectNarration[] = [];
  const inFight = new Set(combatantIds);
  for (const actor of state.actors) {
    if (!inFight.has(actor.id)) continue;
    for (const effect of [...actor.effects]) endEffectInternal(state, actor, effect.id, events);
  }
  return events;
}

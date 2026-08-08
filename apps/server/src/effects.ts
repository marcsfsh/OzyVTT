import type { Actor, EffectInstance, GameState } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";
import { conditionLabel, exhaustionLevel } from "./condition-rules.js";

/**
 * Rules-engine effect lifecycle (ADR-0020): Rage, Reckless Attack, and source-linked grapples live
 * as EffectInstances on actors. The engine - not the GM's memory - ends them: turn boundaries expire
 * durations, a defeated source releases its grapples, and ending an effect removes its linked
 * conditions and fires its onEnd grants (Frenzy's Exhaustion). Every transition returns narration
 * events so the caller can log them; nothing here writes to the log directly.
 *
 * Scene safety: every sweep is scoped to actors in the CURRENT combat's initiative, so a parked
 * scene's fight keeps its effects untouched (an actor fighting in two parked encounters at once is
 * documented out of scope).
 */

export type EffectNarration = Readonly<{ kind: "effect" | "condition"; text: string; actorId: string }>;

const MAX_EFFECTS = 20;

/**
 * Direct condition write for engine-owned transitions (no scope check - callers are the engine
 * acting as the server). Returns false when the actor is immune (SRD condition immunity): the
 * condition is silently skipped and the caller decides whether to narrate.
 */
export function applyConditionDirect(actor: Actor, conditionId: string, level?: number): boolean {
  if (actor.conditionImmunities.includes(conditionId)) return false;
  const remaining = actor.conditions.filter((condition) => condition.id !== conditionId);
  if (remaining.length >= 20) return false;
  actor.conditions = [...remaining, { id: conditionId, ...(conditionId === "exhaustion" ? { level: level ?? 1 } : {}) }]
    .sort((left, right) => left.id.localeCompare(right.id));
  return true;
}

export function removeConditionDirect(actor: Actor, conditionId: string) {
  actor.conditions = actor.conditions.filter((condition) => condition.id !== conditionId);
}

export function hasEffectTag(actor: Actor, tag: string): boolean {
  return actor.effects.some((effect) => effect.tags.includes(tag));
}

/**
 * Add an effect (idempotent by id: a retried command re-adds nothing). A grant from the same source
 * actor + source action REPLACES the older instance (duration refresh - a re-declared Rage or a
 * per-turn Frenzy marker never stacks). Applies linked conditions.
 */
export function addEffect(state: GameState, actorId: string, effect: EffectInstance, events?: EffectNarration[]): EffectInstance {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  const existing = actor.effects.find((candidate) => candidate.id === effect.id);
  if (existing) return existing;
  // SRD Concentration: one sustained effect at a time - starting a new one ends the source's others.
  if (effect.concentration && effect.sourceActorId !== null) {
    const ended = endConcentrationSustainedBy(state, effect.sourceActorId);
    events?.push(...ended);
  }
  const replaced = effect.sourceActionId !== null
    ? actor.effects.find((candidate) => candidate.sourceActorId === effect.sourceActorId && candidate.sourceActionId === effect.sourceActionId)
    : undefined;
  if (replaced) {
    // Refresh in place: no onEnd fires, linked conditions stay (re-applied below for safety).
    actor.effects = actor.effects.map((candidate) => candidate.id === replaced.id ? effect : candidate);
  } else {
    if (actor.effects.length >= MAX_EFFECTS) throw new CommandRejectedError("That combatant already has too many active effects.");
    actor.effects = [...actor.effects, effect];
  }
  for (const conditionId of effect.linkedConditionIds) applyConditionDirect(actor, conditionId);
  return effect;
}

/** Exhaustion stacks by level (cap 6); other conditions are simple presence. Engine-owned onEnd path only. */
function grantConditionOnEnd(actor: Actor, conditionId: string, level: number | undefined): { level: number | undefined; becameFatal: boolean } {
  if (conditionId === "exhaustion") {
    const existing = actor.conditions.find((condition) => condition.id === "exhaustion")?.level ?? 0;
    const next = Math.min(6, existing + (level ?? 1));
    const applied = applyConditionDirect(actor, "exhaustion", next);
    return { level: applied ? next : existing, becameFatal: applied && existing < 6 && next >= 6 };
  }
  applyConditionDirect(actor, conditionId, level);
  return { level, becameFatal: false };
}

/**
 * SRD Exhaustion level 6 is death - an engine-owned transition like the zero-HP machine, fired
 * whenever a level reaches 6 (manual set-condition or an effect's onEnd grant). Player characters
 * drop to 0 with three death-save failures recorded (dead, not dying); anything else is defeated.
 * The GM undoes via set-hp/heal if a table rules otherwise.
 */
export function applyExhaustionDeath(state: GameState, actor: Actor): EffectNarration[] {
  if (exhaustionLevel(actor) < 6) return [];
  const events: EffectNarration[] = [];
  actor.hp.current = 0;
  if (actor.kind === "player-character") {
    actor.deathSaves = { successes: 0, failures: 3, stable: false };
    applyConditionDirect(actor, "unconscious");
    applyConditionDirect(actor, "prone");
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
    events.push({ kind: "condition", text: `${actor.name} is no longer ${conditionLabel(conditionId)}.`, actorId: actor.id });
  }
  for (const grant of effect.onEnd) {
    const granted = grantConditionOnEnd(actor, grant.conditionId, grant.level);
    events.push({ kind: "condition", text: `${actor.name} gains ${conditionLabel(grant.conditionId)}${grant.conditionId === "exhaustion" ? ` ${granted.level ?? 1}` : ""} (${effect.name} ended).`, actorId: actor.id });
    if (granted.becameFatal) events.push(...applyExhaustionDeath(state, actor));
  }
  // Cascade: effects that only exist while another tag is present end with it (Frenzy's marker ends
  // with the Rage, firing its Exhaustion exactly once).
  for (const dependent of [...actor.effects]) {
    if (dependent.endsWithTag !== null && !actor.effects.some((candidate) => candidate.id !== dependent.id && candidate.tags.includes(dependent.endsWithTag!))) {
      endEffectInternal(state, actor, dependent.id, events);
    }
  }
  return true;
}

/**
 * End one effect: remove it, clear its linked conditions (unless another effect still links the same
 * condition), fire its onEnd grants, and cascade dependents (endsWithTag). Returns narration events.
 */
export function endEffect(state: GameState, actorId: string, effectId: string): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  const events: EffectNarration[] = [];
  if (!endEffectInternal(state, actor, effectId, events)) throw new CommandRejectedError("That effect already ended.");
  return events;
}

/**
 * SRD Grappling: the grapple ends if the grappler is incapacitated. Scoped to grapple-tagged effects
 * (a stunned barbarian keeps their Rage - only their holds release); 0 HP still releases everything
 * via endEffectsSustainedBy.
 */
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

/**
 * Turn-boundary expiry, run when `incomingActorId`'s turn begins: effects that actor sustains with
 * "until-source-next-turn" end (Reckless Attack), and its "rounds" durations tick down (Rage),
 * ending at zero. Only actors in the current initiative are touched (parked scenes keep theirs).
 */
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
          actor.effects = actor.effects.map((candidate) => candidate.id === effect.id ? { ...candidate, duration: { type: "rounds", remaining } } : candidate);
        }
      }
    }
  }
  return events;
}

/** Encounter end: every effect on this fight's combatants ends (onEnd fires - a documented simplification; the log says why). */
export function endEncounterEffects(state: GameState, combatantIds: readonly string[]): EffectNarration[] {
  const events: EffectNarration[] = [];
  const inFight = new Set(combatantIds);
  for (const actor of state.actors) {
    if (!inFight.has(actor.id)) continue;
    for (const effect of [...actor.effects]) endEffectInternal(state, actor, effect.id, events);
  }
  return events;
}

/**
 * Typed damage defenses an actor's active effects contribute (Rage resistance, a curse's
 * vulnerability), merged with definition defenses by the caller.
 *
 * `vulnerabilities` is the half that did not exist. Effects returned resistances only, so the
 * `damageVulnerabilities` the damage maths reads had exactly ONE writer - a monster stat block - and
 * a player character could not be made vulnerable by anything at all. Both lists share one `sources`
 * map because a type is never both (the SRD cancels them), so one name always explains one line.
 */
export function effectDamageDefenses(actor: Actor): { resistances: string[]; vulnerabilities: string[]; sources: Map<string, string> } {
  const resistances: string[] = [];
  const vulnerabilities: string[] = [];
  const sources = new Map<string, string>();
  for (const effect of actor.effects) {
    for (const modifier of effect.modifiers) {
      if (modifier.type !== "damage-resistance" && modifier.type !== "damage-vulnerability") continue;
      for (const damageType of modifier.damageTypes) {
        (modifier.type === "damage-resistance" ? resistances : vulnerabilities).push(damageType);
        if (!sources.has(damageType.toLowerCase())) sources.set(damageType.toLowerCase(), effect.name);
      }
    }
  }
  return { resistances, vulnerabilities, sources };
}

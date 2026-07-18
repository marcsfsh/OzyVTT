import type { Actor, DamageApplication, GameState, HealthBand } from "@vtt/domain";
import { adjustDamageParts, damageWhileDying, droppedToZero, type DamagePart } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { applyConditionDirect, endEffectsSustainedBy, effectDamageDefenses, removeConditionDirect, type EffectNarration } from "./effects.js";

/** Who is asking: the GM may adjust anyone; a player only their own claimed character. */
export type ActorScope = { role: "gm" } | { role: "player"; sessionId: string };

export function healthBandOf(hp: Actor["hp"]): HealthBand {
  if (hp.current <= 0) return "down";
  return hp.current * 2 <= hp.maximum ? "bloodied" : "healthy";
}

/** Shared by hp and condition commands: resolve the target if the caller may adjust it. */
export function adjustableActor(state: GameState, actorId: string, scope: ActorScope): Actor {
  const actor = state.actors.find((item) => item.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (scope.role === "player" && actor.ownerSessionId !== scope.sessionId) throw new CommandRejectedError("You can only track your own character.");
  return actor;
}

export type DamageInput = Readonly<{
  /** Untyped total — the manual path (no defense math). Ignored when `parts` is present. */
  amount: number;
  /** Typed components from a resolved action; the engine applies immunity → resistance → vulnerability. */
  parts?: readonly DamagePart[];
  critical?: boolean;
  sourceName?: string | null;
}>;
export type DamageDeps = Readonly<{ resolveDefinition: (definitionId: string) => ActorDefinition | undefined }>;
export type DamageOutcome = Readonly<{ application: DamageApplication; events: EffectNarration[] }>;

function definitionDefenses(definition: ActorDefinition | undefined) {
  return {
    resistances: definition?.damageResistances ?? [],
    immunities: definition?.damageImmunities ?? [],
    vulnerabilities: definition?.damageVulnerabilities ?? []
  };
}

/**
 * The single damage entry point (ADR-0020): typed parts get defense adjustments (definition RVI +
 * active-effect resistances like Rage); the untyped amount stays exact for manual corrections. Both
 * paths run the same zero-HP machine — player characters drop dying (Unconscious + Prone + death
 * saves, instant death on massive overflow, failure ticks while dying), and any combatant reaching
 * 0 releases the effects it was sustaining (grapples). 5e order: temp HP absorbs first.
 */
export function applyDamageDetailed(state: GameState, actorId: string, input: DamageInput, scope: ActorScope, deps?: DamageDeps): DamageOutcome {
  const actor = adjustableActor(state, actorId, scope);
  const events: EffectNarration[] = [];

  let totalRequested: number;
  let totalAdjusted: number;
  let parts: DamageApplication["parts"] = [];
  if (input.parts && input.parts.length > 0) {
    const definition = actor.definitionId && deps ? deps.resolveDefinition(actor.definitionId) : undefined;
    const innate = definitionDefenses(definition);
    const fromEffects = effectDamageDefenses(actor);
    // SRD Petrified: resistance to all damage + immunity to poison, on top of innate/effect defenses.
    const petrified = actor.conditions.some((condition) => condition.id === "petrified");
    const adjusted = adjustDamageParts(input.parts, {
      resistances: [...innate.resistances, ...fromEffects.resistances],
      immunities: petrified ? [...innate.immunities, "poison"] : innate.immunities,
      vulnerabilities: innate.vulnerabilities,
      resistAll: petrified
    });
    parts = adjusted.map((part) => {
      const type = part.type.trim().toLowerCase();
      const effectSource = part.adjustment === "resistance" ? fromEffects.sources.get(type) ?? null : null;
      const petrifiedSource = petrified
        && ((part.adjustment === "resistance" && !innate.resistances.map((entry) => entry.toLowerCase()).includes(type) && effectSource === null)
          || (part.adjustment === "immunity" && type === "poison" && !innate.immunities.map((entry) => entry.toLowerCase()).includes(type)))
        ? "Petrified" : null;
      return { ...part, adjustmentSource: effectSource ?? petrifiedSource };
    });
    totalRequested = input.parts.reduce((sum, part) => sum + part.amount, 0);
    totalAdjusted = adjusted.reduce((sum, part) => sum + part.adjusted, 0);
  } else {
    totalRequested = input.amount;
    totalAdjusted = input.amount;
  }

  const hpBefore = actor.hp.current;
  const wasAtZero = hpBefore <= 0;
  const absorbed = Math.min(actor.hp.temporary, totalAdjusted);
  actor.hp.temporary -= absorbed;
  const damageToHp = totalAdjusted - absorbed;
  actor.hp.current = Math.max(0, hpBefore - damageToHp);

  let deathSaveFailuresAdded = 0;
  let instantDeath = false;
  let defeated = false;
  const isPlayerCharacter = actor.kind === "player-character";

  if (isPlayerCharacter && wasAtZero && damageToHp > 0) {
    // Damage while dying: automatic failures (two on a crit), instant death at max-HP damage.
    const current = actor.deathSaves ?? { successes: 0, failures: 0, stable: false };
    const outcome = damageWhileDying(current, damageToHp, input.critical === true, actor.hp.maximum);
    actor.deathSaves = outcome.state;
    deathSaveFailuresAdded = outcome.failuresAdded;
    instantDeath = outcome.dead && damageToHp >= actor.hp.maximum;
    applyConditionDirect(actor, "unconscious");
    applyConditionDirect(actor, "prone");
  } else if (!wasAtZero && actor.hp.current === 0 && damageToHp > 0) {
    if (isPlayerCharacter) {
      const overflow = damageToHp - hpBefore;
      const outcome = droppedToZero(overflow, actor.hp.maximum);
      actor.deathSaves = outcome.state;
      instantDeath = outcome.instantDeath;
      applyConditionDirect(actor, "unconscious");
      applyConditionDirect(actor, "prone");
      events.push({ kind: "condition", text: instantDeath ? `${actor.name} was killed outright.` : `${actor.name} fell Unconscious and is dying.`, actorId });
    } else {
      defeated = true;
    }
    // Anyone at 0 can no longer sustain a grapple (or a rage): release sustained effects.
    events.push(...endEffectsSustainedBy(state, actor.id));
  }

  return {
    application: {
      totalRequested,
      totalApplied: totalAdjusted,
      parts,
      temporaryAbsorbed: absorbed,
      hpBefore,
      hpAfter: actor.hp.current,
      droppedToZero: !wasAtZero && actor.hp.current === 0 && damageToHp > 0,
      deathSaveFailuresAdded,
      instantDeath,
      defeated
    },
    events
  };
}

/** 5e order: temporary hit points absorb damage first; current never drops below 0. Untyped legacy path. */
export function applyDamage(state: GameState, actorId: string, amount: number, scope: ActorScope) {
  applyDamageDetailed(state, actorId, { amount }, scope);
}

/**
 * Healing caps at maximum and never restores temporary hit points. Healing a dying character from 0
 * clears the dying state and Unconscious (Prone stays until they stand — clear it manually).
 */
export function healActor(state: GameState, actorId: string, amount: number, scope: ActorScope): EffectNarration[] {
  const actor = adjustableActor(state, actorId, scope);
  const wasDying = actor.hp.current <= 0 && actor.deathSaves !== null;
  actor.hp.current = Math.min(actor.hp.maximum, actor.hp.current + amount);
  const events: EffectNarration[] = [];
  if (wasDying && actor.hp.current > 0) {
    actor.deathSaves = null;
    removeConditionDirect(actor, "unconscious");
    events.push({ kind: "condition", text: `${actor.name} regained consciousness.`, actorId });
  }
  return events;
}

/** Temporary hit points replace rather than stack (the 5e "take the higher" call stays at the table). */
export function setTemporaryHp(state: GameState, actorId: string, amount: number, scope: ActorScope) {
  const actor = adjustableActor(state, actorId, scope);
  actor.hp.temporary = amount;
}

/**
 * Direct GM correction: set current hit points, clamped into 0..maximum. Runs the same zero-HP
 * transitions as damage/healing so a manual "set to 0"/"set to 1" never strands the dying state.
 */
export function setCurrentHp(state: GameState, actorId: string, current: number, scope: ActorScope): EffectNarration[] {
  if (scope.role !== "gm") throw new CommandRejectedError("Only the GM can set hit points directly.");
  const actor = adjustableActor(state, actorId, scope);
  const before = actor.hp.current;
  actor.hp.current = Math.max(0, Math.min(actor.hp.maximum, current));
  const events: EffectNarration[] = [];
  if (actor.hp.current > 0 && actor.deathSaves !== null) {
    actor.deathSaves = null;
    removeConditionDirect(actor, "unconscious");
    events.push({ kind: "condition", text: `${actor.name} regained consciousness.`, actorId });
  } else if (actor.hp.current === 0 && before > 0) {
    if (actor.kind === "player-character" && actor.deathSaves === null) {
      actor.deathSaves = { successes: 0, failures: 0, stable: false };
      applyConditionDirect(actor, "unconscious");
      applyConditionDirect(actor, "prone");
      events.push({ kind: "condition", text: `${actor.name} fell Unconscious and is dying.`, actorId });
    }
    events.push(...endEffectsSustainedBy(state, actor.id));
  }
  return events;
}

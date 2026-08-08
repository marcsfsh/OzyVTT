import type { Actor, DamageApplication, GameState, HealthBand } from "@vtt/domain";
import { adjustDamageParts, collectRiders, damageWhileDying, droppedToZero, normalizeDamageType, reduceDamageTotal, sumRiders, type DamagePart } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { applyConditionDirect, endConcentrationSustainedBy, endEffectsSustainedBy, effectDamageDefenses, removeConditionDirect, type EffectNarration } from "./effects.js";
import { deriveEquipment, EMPTY_DERIVATION, type EquipmentCatalog, type EquipmentDerivation } from "./equipment-derivation.js";

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
  /** Untyped total - the manual path (no defense math). Ignored when `parts` is present. */
  amount: number;
  /** Typed components from a resolved action; the engine applies immunity → resistance → vulnerability. */
  parts?: readonly DamagePart[];
  critical?: boolean;
  sourceName?: string | null;
  /** Knocking out a creature (SRD): a nonlethal drop to 0 leaves it Unconscious and stable instead of dying/defeated. */
  nonlethal?: boolean;
}>;
export type DamageDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  /** Mints ids for the concentration-check prompt; when absent the check is skipped (legacy direct paths). */
  newId?: () => string;
  /** Injected clock (ISO string) for the prompt's createdAt; falls back to wall time. */
  now?: () => string;
  /**
   * The item catalog, so an item's GRANTED resistances and immunities reach the damage math. A Ring
   * of Fire Resistance authored as `grants.damageResistances` was derived and then read by nobody:
   * the pipeline saw the definition and the active effects only. Absent = the pre-item behavior
   * (a legacy direct caller with no catalog in hand), never an error.
   */
  catalog?: EquipmentCatalog;
}>;
export type DamageOutcome = Readonly<{ application: DamageApplication; events: EffectNarration[] }>;

/**
 * THE damage-adjustment detail line - "17 bludgeoning → 8, resistance: Rage" - in ONE place.
 *
 * It was copy-pasted three times in `game-operations.ts` and missing entirely from the three call
 * sites that discarded `application.parts` (`save.answer` and both reaction paths). That is how "fire
 * damage isn't fire damage" could be true at the table while the engine halved correctly: the number
 * changed and nothing said why. Returns "" when nothing adjusted the hit, so every caller can append
 * it unconditionally and an unchanged number is never explained.
 */
export function damageAdjustmentDetail(application: Readonly<{ parts: DamageApplication["parts"]; flatReduction?: number }>): string {
  const clauses = application.parts
    .filter((part) => part.adjustment !== null)
    .map((part) => `${part.amount} ${part.type} → ${part.adjusted}, ${part.adjustment}${part.adjustmentSource ? `: ${part.adjustmentSource}` : ""}`);
  // The flat step is named separately because it is not per-type: it comes after the halving, once.
  if ((application.flatReduction ?? 0) > 0) clauses.push(`then -${application.flatReduction}, reduction`);
  return clauses.length > 0 ? ` (${clauses.join("; ")})` : "";
}

/**
 * FLAT REDUCTION, collected from the same rider carriers every other numeric read uses.
 *
 * `damage-reduction` was authored, validated, stored, carried and read by NOTHING - it was the one
 * rider whose disposition said `"unread"` for the honest reason that no incoming-damage path
 * collected riders at all. This is that collector, and it is the only one that runs on the RECEIVING
 * side of a hit.
 *
 * Two passes, because the vocabulary allows both spellings and the SRD needs both: the STANDING set
 * (a rider that names no moment - "you always take 3 less") and the `on-taking-damage` moment, whose
 * `damage-type-is` filter is what makes "reduce fire damage by 3" expressible at all. The incoming
 * types are handed to the collector so that filter can match; the total the caller then reduces is
 * the whole hit, per `reduceDamageTotal`'s own rule.
 */
function damageReductionFor(derivation: EquipmentDerivation, damageTypes: readonly string[]): number {
  const standing = collectRiders(derivation.carriers, { ...derivation.context, moment: null });
  const onTakingDamage = collectRiders(derivation.carriers, { ...derivation.context, moment: "on-taking-damage", damageTypes });
  return sumRiders(standing, "damage-reduction") + sumRiders(onTakingDamage, "damage-reduction");
}

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
 * paths run the same zero-HP machine - player characters drop dying (Unconscious + Prone + death
 * saves, instant death on massive overflow, failure ticks while dying), and any combatant reaching
 * 0 releases the effects it was sustaining (grapples). 5e order: temp HP absorbs first.
 */
export function applyDamageDetailed(state: GameState, actorId: string, input: DamageInput, scope: ActorScope, deps?: DamageDeps): DamageOutcome {
  const actor = adjustableActor(state, actorId, scope);
  const events: EffectNarration[] = [];

  let totalRequested: number;
  let totalAdjusted: number;
  let flatReduction = 0;
  let parts: DamageApplication["parts"] = [];
  if (input.parts && input.parts.length > 0) {
    const definition = actor.definitionId && deps ? deps.resolveDefinition(actor.definitionId) : undefined;
    const innate = definitionDefenses(definition);
    const fromEffects = effectDamageDefenses(actor);
    // Item grants: derived whole from (definition, inventory, catalog) like every other item
    // contribution, so taking the ring off removes the resistance on the very next hit.
    const fromItems = deps?.catalog ? deriveEquipment(actor, definition, deps.catalog) : EMPTY_DERIVATION;
    const itemResistances = fromItems.damageResistances.map((entry) => entry.id);
    const itemImmunities = fromItems.damageImmunities.map((entry) => entry.id);
    const itemVulnerabilities = fromItems.damageVulnerabilities.map((entry) => entry.id);
    const itemSourceOf = (type: string): string | null => {
      const source = fromItems.damageImmunities.find((entry) => entry.id.toLowerCase() === type)
        ?? fromItems.damageResistances.find((entry) => entry.id.toLowerCase() === type)
        ?? fromItems.damageVulnerabilities.find((entry) => entry.id.toLowerCase() === type);
      if (!source) return null;
      return fromItems.sources.find((row) => row.itemId === source.sourceItemId)?.itemName ?? source.sourceItemId;
    };
    // SRD Petrified: resistance to all damage + immunity to poison, on top of innate/effect defenses.
    const petrified = actor.conditions.some((condition) => condition.id === "petrified");
    // SRD Underwater Combat: everything fully underwater has resistance to fire damage.
    const underwater = state.combat.active && state.combat.underwater;
    const adjusted = adjustDamageParts(input.parts, {
      resistances: [...innate.resistances, ...fromEffects.resistances, ...itemResistances, ...(underwater ? ["fire"] : [])],
      immunities: [...(petrified ? [...innate.immunities, "poison"] : innate.immunities), ...itemImmunities],
      // All three channels, so a curse and a cursed item can make a target vulnerable exactly as a
      // stat block can. `adjustDamageParts` already cancels a same-type resistance against it.
      vulnerabilities: [...innate.vulnerabilities, ...fromEffects.vulnerabilities, ...itemVulnerabilities],
      resistAll: petrified
    });
    parts = adjusted.map((part) => {
      const type = part.type.trim().toLowerCase();
      const effectSource = part.adjustment === "resistance" || part.adjustment === "vulnerability" ? fromEffects.sources.get(type) ?? null : null;
      const innateHas = (list: readonly string[]) => list.map((entry) => entry.toLowerCase()).includes(type);
      const petrifiedSource = petrified
        && ((part.adjustment === "resistance" && !innateHas(innate.resistances) && effectSource === null)
          || (part.adjustment === "immunity" && type === "poison" && !innateHas(innate.immunities)))
        ? "Petrified" : null;
      const underwaterSource = underwater && part.adjustment === "resistance" && type === "fire"
        && !innateHas(innate.resistances) && effectSource === null && petrifiedSource === null
        ? "Underwater" : null;
      // The item's NAME on the damage line, so a halved hit explains itself ("Ring of Fire
      // Resistance") the same way an effect-sourced one does.
      const innateList = part.adjustment === "immunity" ? innate.immunities : part.adjustment === "vulnerability" ? innate.vulnerabilities : innate.resistances;
      const itemSource = part.adjustment !== null && effectSource === null && petrifiedSource === null && underwaterSource === null
        && !innateHas(innateList)
        ? itemSourceOf(type) : null;
      return { ...part, adjustmentSource: effectSource ?? petrifiedSource ?? underwaterSource ?? itemSource };
    });
    totalRequested = input.parts.reduce((sum, part) => sum + part.amount, 0);
    const afterDefenses = adjusted.reduce((sum, part) => sum + part.adjusted, 0);
    // LAST, and per total: flat reduction subtracts from what the per-type maths produced.
    flatReduction = Math.max(0, damageReductionFor(fromItems, adjusted.map((part) => normalizeDamageType(part.type))));
    totalAdjusted = reduceDamageTotal(afterDefenses, flatReduction);
    flatReduction = afterDefenses - totalAdjusted;
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
    if (input.nonlethal === true) {
      // Knocking out a creature (SRD): the attacker chooses to knock out instead of kill - the
      // target drops to 0, Unconscious and stable (no death saves, no defeat, no massive-damage death).
      if (isPlayerCharacter) actor.deathSaves = { successes: 0, failures: 0, stable: true };
      applyConditionDirect(actor, "unconscious");
      applyConditionDirect(actor, "prone");
      events.push({ kind: "condition", text: `${actor.name} was knocked out - Unconscious and stable at 0 HP.`, actorId });
    } else if (isPlayerCharacter) {
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
    // Anyone at 0 can no longer sustain a grapple (or a rage): release sustained effects -
    // including concentration, which incapacitation always breaks (SRD Concentration).
    events.push(...endEffectsSustainedBy(state, actor.id));
    events.push(...endConcentrationSustainedBy(state, actor.id));
  }

  // SRD Concentration: taking damage while sustaining a concentration effect prompts a CON save,
  // DC = max(10, half the damage taken) capped at 30. The prompt carries the effects it would end
  // on a committed failure. Skipped when no id-minter is available (legacy direct callers).
  if (totalAdjusted > 0 && actor.hp.current > 0 && deps?.newId && state.combat.active) {
    const sustained: Array<{ actorId: string; effectId: string }> = [];
    for (const bearer of state.actors) {
      for (const effect of bearer.effects) {
        if (effect.concentration && effect.sourceActorId === actor.id) sustained.push({ actorId: bearer.id, effectId: effect.id });
      }
    }
    if (sustained.length > 0 && state.combat.pendingSaves.length < 100) {
      const dc = Math.min(30, Math.max(10, Math.floor(totalAdjusted / 2)));
      state.combat = { ...state.combat, pendingSaves: [...state.combat.pendingSaves, {
        id: deps.newId(),
        targetActorId: actor.id,
        ability: "con" as const,
        dc,
        sourceActorId: null,
        sourceName: input.sourceName ?? "Damage",
        actionName: "Concentration check",
        proposedDamage: 0,
        halfOnSuccess: false,
        conditionId: null,
        saveBonus: 0,
        endsEffects: sustained,
        createdAt: deps.now ? Date.parse(deps.now()) : Date.now()
      }] };
      events.push({ kind: "condition", text: `${actor.name} must make a DC ${dc} Constitution save to keep concentrating.`, actorId: actor.id });
    }
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
      defeated,
      ...(flatReduction > 0 ? { flatReduction } : {})
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
 * clears the dying state and Unconscious (Prone stays until they stand - clear it manually).
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

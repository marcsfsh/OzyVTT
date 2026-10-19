import { isDead, ROUNDS_PER_MINUTE, type Actor, type EffectInstance, type GameState } from "@vtt/domain";
import type { ActorDefinition, SaveFailureDuration } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { conditionLabel, exhaustionLevel, INCAPACITATING_CONDITIONS } from "./condition-rules.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { areAllies } from "./creature-sides.js";
import { wardingAura } from "./paladin-auras.js";
import { endZonesOfCast } from "./spell-zone-state.js";
import { DESCENDS_SAFELY_TAG, descendSafely } from "./altitude.js";

/** Effect lifecycle (ADR-0020): the engine ends effects on turn boundaries, source defeat and explicit
 *  end, which clears linked conditions and fires onEnd grants. Returns narration events and writes nothing to
 *  the log. Sweeps touch only actors in the current initiative, so parked scenes keep their effects. */

/** `immune` marks a condition skipped for immunity, so a caller can drop its generic "is X" line without reading
 *  the text. */
export type EffectNarration = Readonly<{
  kind: "effect" | "condition" | "reaction" | "damage";
  text: string;
  actorId: string;
  immune?: true;
  /** Who the line names as the cause (an effect's source), so the table's copy can mask a hidden one. */
  source?: Readonly<{ actorId: string; name: string | null }>;
  /** For the GM alone even when the actor is visible: a monster's spent resources are GM knowledge. */
  gmOnly?: true;
}>;

const MAX_EFFECTS = 20;

/** Mage Armor: AC 13 + Dexterity while the creature wears no armor; donning armor ends it. */
export const MAGE_ARMOR_TAG = "mage-armor";
/** The bearer can't take an action or a Bonus Action while this lasts (SRD Stinking Cloud's poisoning). */
export const NO_ACTIONS_TAG = "no-actions";
/** The bearer can't take Reactions while this lasts. */
export const NO_REACTIONS_TAG = "no-reactions";
/** The bearer can't take a Bonus Action while this lasts (an ice devil's Ice Spear). */
export const NO_BONUS_ACTIONS_TAG = "no-bonus-actions";
/** The bearer can't make Opportunity Attacks while this lasts (Shocking Grasp). */
export const NO_OPPORTUNITY_ATTACKS_TAG = "no-opportunity-attacks";
/** The bearer can't regain Hit Points while this lasts (Chill Touch). */
export const NO_HEALING_TAG = "no-healing";
/** Slow on its target: on its turns an action or a Bonus Action (only one), one attack with the Attack action, and a
 *  chance that a spell with a Somatic component fails. */
export const SLOWED_TAG = "slowed";
/** The bearer can't cast spells or take the Magic action while this lasts (Befuddlement). */
export const NO_SPELLS_TAG = "no-spells";
/** The bearer can't speak while this lasts (a gag, Gaseous Form's cloud), so it can't cast a spell with a Verbal
 *  component. */
export const CANT_SPEAK_TAG = "cant-speak";
/** The bearer's hands are bound (Manacles, a creature's hold on its arms), so it can't make a spell's gestures or reach
 *  its materials. */
export const HANDS_BOUND_TAG = "hands-bound";
/** Barkskin: the bearer's AC is 17 while it is lower, raised when the spell lands. */
export const BARKSKIN_TAG = "barkskin";
/** Death Ward: the first drop to 0 Hit Points leaves the bearer at 1 instead, and ends it. */
export const DEATH_WARD_TAG = "death-ward";
/** Protection from Energy: Resistance to the one damage type the caster picks from those the action offers. */
export const RESISTS_CHOSEN_TYPE_TAG = "resists-chosen-type";
/** Invisibility: it ends once its bearer makes an attack roll, deals damage or casts a spell. */
export const UNTIL_IT_ACTS_TAG = "until-it-acts";
/** On an escapable effect: the escape is a Strength (Athletics) check alone (a spell's restraint: Web, Entangle). */
export const ESCAPE_ATHLETICS_TAG = "escape-athletics";
/** The tag on a caster's own "Concentrating on X" effect; ending it ends everything its cast made. */
export const CONCENTRATING_TAG = "concentrating";
/** The Barbarian's Rage: it ends early on Incapacitated or in Heavy armor, and blocks spells and Concentration. */
export const RAGING_TAG = "raging";
/** A Rage under Persistent Rage: 10 minutes with nothing to extend it, ended early by Unconscious alone. */
export const PERSISTENT_RAGE_TAG = "persistent-rage";
/** SRD Rage: "You can maintain a Rage for up to 10 minutes", in rounds. */
export const RAGE_ROUNDS = 100;
/** A creature knocked out at 1 HP; it wakes when it regains any hit points. */
export const KNOCKED_OUT_TAG = "knocked-out";
/** The Ready action's held response, taken with the Reaction when its trigger comes. */
export const READIED_TAG = "readied";
/** Haste on its target: doubled Speed, an additional action each turn, and lethargy when it ends. */
export const HASTED_TAG = "hasted";
/** Reckless Attack: decided with the Barbarian's first attack roll on its turn. */
export const RECKLESS_TAG = "reckless-attack";
/** Steady Aim: taken before moving, Advantage on the next attack roll this turn, Speed 0 until the turn ends. */
export const STEADY_AIM_TAG = "steady-aim";
/** A curse (Hex, Bestow Curse, Geas): Remove Curse ends it (SRD Rules Glossary, Curses). */
export const CURSE_TAG = "curse";
/** A Stable creature's hours until it regains 1 Hit Point (SRD Damage and Healing: "after 1d4 hours"). */
export const STABLE_RECOVERY_TAG = "stable-recovery";

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
    case "minutes":
      return { type: "minutes", remaining: duration.minutes };
    case "until-rest":
      return { type: "until-rest", rest: duration.rest };
    case "until-source-next-turn":
      return { type: "until-source-next-turn" };
    case "until-bearer-next-turn":
      return { type: "until-bearer-next-turn" };
    case "until-bearer-turn-end":
      return turnEndDuration(state, "until-bearer-turn-end", bearerId);
    case "until-source-turn-end":
      return turnEndDuration(state, "until-source-turn-end", sourceId ?? bearerId);
  }
}

/** Where item- and feat-granted condition immunities are read from. Without a catalog only the actor's
 *  innate immunities apply; with the game state an ally's ward reaches it too (Aura of Courage), measured with
 *  `distanceFeet` where the map can. */
export type ConditionImmunitySource = Readonly<{
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  state?: GameState;
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
}>;

/** SRD condition immunity: innate, granted by what the actor carries when a catalog is supplied, Petrified's own
 *  immunity to the Poisoned condition, or a Paladin's aura it stands in. */
function immuneToCondition(actor: Actor, conditionId: string, source?: ConditionImmunitySource): boolean {
  if (actor.conditionImmunities.includes(conditionId)) return true;
  // An effect's own immunity while it lasts (Heroism: Frightened).
  if (actor.effects.some((effect) => effect.conditionImmunities?.includes(conditionId))) return true;
  if (conditionId === "poisoned" && hasCondition(actor, "petrified")) return true;
  if (
    source?.state &&
    source.resolveDefinition &&
    wardingAura(source.state, actor, conditionId, {
      resolveDefinition: source.resolveDefinition,
      ...(source.distanceFeet ? { distanceFeet: source.distanceFeet } : {}),
      ...(source.catalog ? { catalog: source.catalog } : {})
    }) !== null
  )
    return true;
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

/** Writes one condition entry, and keeps the list sorted and the entry's provenance flags. */
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

/** One fewer Exhaustion level, and none from level 1 (a Long Rest; coming back from death). */
export function reduceExhaustion(actor: Actor): void {
  const exhaustion = actor.conditions.find((condition) => condition.id === "exhaustion");
  if (!exhaustion) return;
  if ((exhaustion.level ?? 1) <= 1) removeConditionDirect(actor, "exhaustion");
  else
    actor.conditions = actor.conditions.map((condition) =>
      condition.id === "exhaustion" ? { ...condition, level: (condition.level ?? 1) - 1 } : condition
    );
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
    // Persistent Rage ends early only on Unconscious.
    for (const rage of actor.effects.filter((effect) => effect.tags.includes(RAGING_TAG)))
      if (!rage.tags.includes(PERSISTENT_RAGE_TAG) || conditionId === "unconscious")
        endEffectInternal(state, actor, rage.id, events);
  }
  if (conditionId === "exhaustion" && previousExhaustion < 6 && exhaustionLevel(actor) >= 6)
    events.push(...applyExhaustionDeath(state, actor));
  return events;
}

/** Adds an effect (idempotent by id). A grant from the same source actor and action replaces the older
 *  instance (a re-declared Rage refreshes and never stacks). Applies linked conditions the bearer is not
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
  // SRD Concentration: one at a time, starting a new one ends the source's others. Effects of one cast share a
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
  // Extra movement adds up (SRD Dash: each one gains "extra movement for the current turn"), so a second Dash stands
  // beside the first, and the first is never refreshed.
  const stacks = effect.movementGrantFeet !== undefined;
  const replaced =
    effect.sourceActionId !== null && !stacks
      ? actor.effects.find(
          (candidate) =>
            candidate.sourceActorId === effect.sourceActorId && candidate.sourceActionId === effect.sourceActionId
        )
      : undefined;
  // Aid: the Hit Point maximum and current hit points rise by the gain; a refresh adds only what it adds over the old.
  const gain = (effect.hitPointMaximumGain ?? 0) - (replaced?.hitPointMaximumGain ?? 0);
  if (gain !== 0) {
    const maximum = Math.max(1, actor.hp.maximum + gain);
    actor.hp = { ...actor.hp, maximum, current: Math.min(maximum, Math.max(0, actor.hp.current + gain)) };
  }
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
    if (immuneToCondition(actor, conditionId, { ...immunities, state })) continue;
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

/** SRD Immunity: "it doesn't affect you in any way". Ends each of `conditionIds` the creature has, now that `cause`
 *  makes it immune to them (Heroism's Frightened, an item's ward). An effect that also holds one keeps its other
 *  parts. */
export function endConditionsImmuneTo(actor: Actor, conditionIds: readonly string[], cause: string): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const conditionId of conditionIds) {
    if (!hasCondition(actor, conditionId)) continue;
    removeConditionDirect(actor, conditionId);
    events.push({
      kind: "condition",
      text: `${actor.name} is no longer ${conditionLabel(conditionId)} (${cause}).`,
      actorId: actor.id
    });
  }
  return events;
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

/** SRD Haste: "When the spell ends, the target is Incapacitated and has a Speed of 0 until the end of its next turn,
 *  as a wave of lethargy washes over it." Only in a fight: outside one there is no next turn to wait out. */
function addLethargy(state: GameState, actor: Actor, haste: EffectInstance, events: EffectNarration[]): void {
  if (!state.combat.active || !state.combat.initiative.some((entry) => entry.actorId === actor.id)) return;
  if (actor.effects.length >= MAX_EFFECTS) return;
  addEffect(
    state,
    actor.id,
    makeEffect({
      id: `${haste.id}:lethargy`,
      name: "Lethargy",
      tags: ["lethargic"],
      sourceActorId: haste.sourceActorId,
      sourceName: haste.sourceName,
      startedRound: state.combat.round,
      duration: turnEndDuration(state, "until-bearer-turn-end", actor.id),
      linkedConditionIds: ["incapacitated"],
      speedZero: true
    }),
    events
  );
  events.push({
    kind: "effect",
    text: `${actor.name} is overcome by lethargy as ${haste.name} ends: Incapacitated and Speed 0 until the end of its next turn.`,
    actorId: actor.id,
    ...sourceOf(haste)
  });
}

/** Tolerant single-effect removal used by every sweep; returns false when the effect is already gone. A fight's end
 *  or a Long Rest (`sweeping`) starts nothing that would outlast it, such as Haste's lethargy. */
function endEffectInternal(
  state: GameState,
  actor: Actor,
  effectId: string,
  events: EffectNarration[],
  sweeping = false
): boolean {
  const effect = actor.effects.find((candidate) => candidate.id === effectId);
  if (!effect) return false;
  actor.effects = actor.effects.filter((candidate) => candidate.id !== effectId);
  events.push({
    kind: "effect",
    text: `${effect.name} ended on ${actor.name}.`,
    actorId: actor.id,
    ...sourceOf(effect)
  });
  // A drained Hit Point maximum returns to normal; the hit points lost with it stay lost.
  if (effect.hitPointMaximumLoss !== undefined)
    actor.hp = { ...actor.hp, maximum: actor.hp.maximum + effect.hitPointMaximumLoss };
  // Aid's gain goes, and the current hit points over the maximum with it.
  if (effect.hitPointMaximumGain !== undefined) {
    const maximum = Math.max(1, actor.hp.maximum - effect.hitPointMaximumGain);
    actor.hp = { ...actor.hp, maximum, current: Math.min(actor.hp.current, maximum) };
  }
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
  if (effect.tags.includes(HASTED_TAG) && !sweeping) addLethargy(state, actor, effect, events);
  // A flight that lowers its creature when it ends (Winged Boots: "you descend ... until you land") drifts it down.
  if (effect.tags.includes(DESCENDS_SAFELY_TAG)) descendSafely(state, actor.id);
  // The caster's "Concentrating on X" ending ends everything that cast made, on every creature, and the area it left.
  if (effect.tags.includes(CONCENTRATING_TAG) && effect.castId !== undefined) {
    for (const bearer of state.actors) {
      for (const sustained of [...bearer.effects]) {
        if (sustained.castId === effect.castId) endEffectInternal(state, bearer, sustained.id, events, sweeping);
      }
    }
    endZonesOfCast(state, effect.castId);
  } else if (effect.castId !== undefined) {
    // What a cast left on one creature is gone: the spell may have nothing left.
    events.push(...endIdleConcentration(state, effect.castId));
  }
  // Cascade: effects that exist only while another tag is present end with it.
  for (const dependent of [...actor.effects]) {
    if (
      dependent.endsWithTag !== null &&
      !actor.effects.some(
        (candidate) => candidate.id !== dependent.id && candidate.tags.includes(dependent.endsWithTag!)
      )
    ) {
      endEffectInternal(state, actor, dependent.id, events, sweeping);
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

/** The Ready is used up (its Reaction taken, or spent another way): the Readied effect ends, and a spell it held
 *  dissipates with the Concentration holding it. The names of what ended, for the result card. */
export function releaseReadied(state: GameState, actorId: string): string[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const readied = actor?.effects.find((effect) => effect.tags.includes(READIED_TAG));
  if (!actor || !readied) return [];
  const holding = readied.castId
    ? actor.effects.find((effect) => effect.tags.includes(CONCENTRATING_TAG) && effect.castId === readied.castId)
    : undefined;
  endEffectIfPresent(state, actorId, readied.id);
  if (holding) endEffectIfPresent(state, actorId, holding.id);
  return [readied.name, ...(holding ? [holding.name] : [])];
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

/** Effects that end the moment their bearer takes damage (Sleep, Turn Undead, Hypnotic Pattern), and those that end
 *  when their source or one of its allies deals it (Charm Person: "until you or your allies damage it"). `dealer` is
 *  who dealt it, when the damage has a source. */
export function endEffectsOnDamage(
  state: GameState,
  actor: Actor,
  dealer?: Readonly<{ actorId: string; resolveDefinition?: (definitionId: string) => ActorDefinition | undefined }>
): EffectNarration[] {
  const events: EffectNarration[] = [];
  const by = dealer ? state.actors.find((candidate) => candidate.id === dealer.actorId) : undefined;
  const fromSourceSide = (effect: EffectInstance) => {
    if (!by || effect.sourceActorId === null) return false;
    if (effect.sourceActorId === by.id) return true;
    const source = state.actors.find((candidate) => candidate.id === effect.sourceActorId);
    return source !== undefined && areAllies(source, by, dealer?.resolveDefinition);
  };
  for (const effect of actor.effects.filter(
    (candidate) =>
      candidate.endsOnDamage === true || (candidate.endsOnSourceSideDamage === true && fromSourceSide(candidate))
  ))
    endEffectInternal(state, actor, effect.id, events);
  return events;
}

/** A rest ends what lasts until the bearer finishes one: a Long Rest both kinds, a Short Rest those that a Short or Long
 *  Rest ends (SRD Contact Other Plane: "Incapacitated condition until you finish a Long Rest"). */
export function endEffectsAtRest(state: GameState, actorId: string, kind: "short" | "long"): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return [];
  const events: EffectNarration[] = [];
  for (const effect of [...actor.effects]) {
    const duration = effect.duration;
    if (duration.type === "until-rest" && (kind === "long" || duration.rest === "short"))
      endEffectInternal(state, actor, effect.id, events, true);
  }
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
      // "Until the start of its next turn": the bearer's own turn, whoever put it there.
      if (effect.duration.type === "until-bearer-next-turn") {
        if (actor.id === incomingActorId) endEffectInternal(state, actor, effect.id, events);
        continue;
      }
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
 *  and "until the end of your next turn" effects it is the source of, end, unless they began during this very turn,
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

/** Durations measured in turns: the first minute of game time that passes outlasts them, and a fight's end does. */
const MEASURED_IN_TURNS: ReadonlySet<EffectInstance["duration"]["type"]> = new Set([
  "until-source-next-turn",
  "until-bearer-next-turn",
  "until-bearer-turn-end",
  "until-source-turn-end",
  "encounter"
]);

/** Encounter end: the fight's combatants' turn-measured effects end (onEnd fires), and so does what has a minute or
 *  less of its rounds left (a 1-minute spell outlasting the fight by a few rounds is the documented approximation).
 *  Longer ones carry on, counted down by the game clock at 10 rounds a minute, and "until ended" ones stay. */
export function endEncounterEffects(state: GameState, combatantIds: readonly string[]): EffectNarration[] {
  const events: EffectNarration[] = [];
  const inFight = new Set(combatantIds);
  for (const actor of state.actors) {
    if (!inFight.has(actor.id)) continue;
    for (const effect of [...actor.effects]) {
      const duration = effect.duration;
      const ends =
        MEASURED_IN_TURNS.has(duration.type) || (duration.type === "rounds" && duration.remaining <= ROUNDS_PER_MINUTE);
      if (ends) endEffectInternal(state, actor, effect.id, events, true);
    }
  }
  return events;
}

/**
 * Game time passing for `actorIds` (time the GM passes, a rest): an effect measured in rounds loses 10 for each minute,
 * one measured in minutes loses them, and one measured in turns ends. What runs out ends as at a turn boundary, its
 * on-end grants firing; "until ended" effects stay. With `countDown` false, what lasts longer is left as it is.
 */
export function ageEffects(
  state: GameState,
  actorIds: ReadonlySet<string>,
  minutes: number,
  countDown = true
): EffectNarration[] {
  const events: EffectNarration[] = [];
  if (minutes <= 0) return events;
  for (const actor of state.actors) {
    if (!actorIds.has(actor.id)) continue;
    for (const effect of [...actor.effects]) {
      // A cascade earlier in the sweep may have ended it already.
      const current = actor.effects.find((candidate) => candidate.id === effect.id);
      if (!current) continue;
      const left = remainingAfter(current.duration, minutes);
      if (left === null) continue;
      if (left <= 0) {
        if (current.tags.includes(STABLE_RECOVERY_TAG)) events.push(...stableRecovers(actor));
        endEffectInternal(state, actor, current.id, events, true);
      } else if (countDown)
        actor.effects = actor.effects.map((candidate) =>
          candidate.id === current.id
            ? { ...candidate, duration: { ...(candidate.duration as { type: "rounds" | "minutes" }), remaining: left } }
            : candidate
        );
    }
  }
  return events;
}

/** A creature just made Stable starts its 1d4 hours on the game clock, rolled now (SRD Damage and Healing: "A Stable
 *  creature that isn't healed regains 1 Hit Point after 1d4 hours"). Taking damage starts its dying again, so it ends
 *  the count. */
export function startStableRecovery(
  state: GameState,
  actor: Actor,
  random: (sides: number) => number,
  id: string
): EffectNarration[] {
  if (actor.deathSaves?.stable !== true || actor.hp.current !== 0) return [];
  const hours = Math.max(1, Math.min(4, random(4)));
  addEffect(
    state,
    actor.id,
    makeEffect({
      id,
      name: "Stable",
      tags: [STABLE_RECOVERY_TAG],
      startedRound: state.combat.round,
      duration: { type: "minutes", remaining: hours * 60 },
      endsOnDamage: true
    })
  );
  return [
    {
      kind: "condition",
      text: `${actor.name} regains 1 Hit Point in ${hours} ${hours === 1 ? "hour" : "hours"} of game time unless healed first.`,
      actorId: actor.id
    }
  ];
}

/** SRD: "A Stable creature that isn't healed regains 1 Hit Point after 1d4 hours." One healed meanwhile, or dying again,
 *  gets nothing from it. */
function stableRecovers(actor: Actor): EffectNarration[] {
  if (actor.hp.current !== 0 || actor.deathSaves?.stable !== true) return [];
  actor.hp = { ...actor.hp, current: 1 };
  actor.deathSaves = null;
  removeConditionDirect(actor, "unconscious");
  return [{ kind: "condition", text: `${actor.name} regains 1 Hit Point and wakes.`, actorId: actor.id }];
}

/** What a duration has left once `minutes` of game time pass: 0 for one that runs out, null for one that time doesn't
 *  touch. */
function remainingAfter(duration: EffectInstance["duration"], minutes: number): number | null {
  if (duration.type === "rounds") return duration.remaining - minutes * ROUNDS_PER_MINUTE;
  if (duration.type === "minutes") return duration.remaining - minutes;
  return MEASURED_IN_TURNS.has(duration.type) ? 0 : null;
}

/** SRD Long Rest: at least 8 hours. */
export const LONG_REST_MINUTES = 8 * 60;

/** A Long Rest: eight hours pass and the creature sleeps (Unconscious, so its Concentration ends). Unless the game clock
 *  has already moved those hours for everyone (`clockMoved`, a party rest), what of its own would run out in them ends
 *  here. What lasts longer waits for the GM to pass the hours, so they never count twice; "until ended" ones (a curse, a
 *  disease) stay. */
export function endEffectsAtLongRest(state: GameState, actorId: string, clockMoved = false): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return [];
  const events: EffectNarration[] = [...endConcentrationSustainedBy(state, actorId)];
  if (!clockMoved) events.push(...ageEffects(state, new Set([actorId]), LONG_REST_MINUTES, false));
  // SRD Long Rest: "If your Hit Point maximum was reduced, it returns to normal." A gain kept until ended (one from
  // before gains counted game time) is spent by the rest's end too.
  for (const effect of [...actor.effects])
    if (
      effect.hitPointMaximumLoss !== undefined ||
      (effect.hitPointMaximumGain !== undefined && effect.duration.type === "manual")
    )
      endEffectInternal(state, actor, effect.id, events, true);
  // The rest restores its hit points, and a knocked-out creature wakes when it regains any.
  events.push(...endKnockOut(state, actor));
  return events;
}

/**
 * SRD: a spell ends when nothing is left of it. A Concentration spell that is only what it leaves on creatures (its
 * caster's Concentration marked `endsWhenUnaffected`: Hold Person, Bless) ends once no living creature keeps any of it
 * and no save against it is still owed, and its caster's Concentration with it. The table is told why.
 */
export function endIdleConcentration(state: GameState, castId: string): EffectNarration[] {
  const caster = state.actors.find((actor) =>
    actor.effects.some(
      (effect) => effect.castId === castId && effect.tags.includes(CONCENTRATING_TAG) && effect.endsWhenUnaffected
    )
  );
  const holding = caster?.effects.find((effect) => effect.castId === castId && effect.tags.includes(CONCENTRATING_TAG));
  if (!caster || !holding) return [];
  if (state.combat.pendingSaves.some((save) => save.onFailEffect?.castId === castId)) return [];
  const kept = state.actors.some(
    (actor) =>
      !isDead(actor) &&
      actor.effects.some((effect) => effect.castId === castId && !effect.tags.includes(CONCENTRATING_TAG))
  );
  if (kept) return [];
  const spellName = holding.name.replace(/^Concentrating on /, "");
  const events: EffectNarration[] = [
    {
      kind: "effect",
      text: `${spellName} has no creature left under it, so ${caster.name}'s Concentration on it ends.`,
      actorId: caster.id
    }
  ];
  endEffectInternal(state, caster, holding.id, events);
  return events;
}

/** The casts a creature that has just died was under: each may have nothing left (`endIdleConcentration`). */
export function endConcentrationOnTheDead(state: GameState, actor: Actor): EffectNarration[] {
  if (!isDead(actor)) return [];
  const casts = new Set(actor.effects.flatMap((effect) => (effect.castId !== undefined ? [effect.castId] : [])));
  return [...casts].flatMap((castId) => endIdleConcentration(state, castId));
}

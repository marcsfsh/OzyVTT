import type { Actor, ActorDerivedSheet, DamageApplication, DerivedDefence, GameState, HealthBand } from "@vtt/domain";
import {
  adjustDamageParts,
  collectRiders,
  damageWhileDying,
  droppedToZero,
  halveDamageParts,
  normalizeDamageType,
  reduceDamageParts,
  rescaleDamageParts,
  type DamagePart,
  type DamageReduction,
  type ResolvedRider
} from "@vtt/rules-5e";
import { DAMAGE_TYPE_IDS } from "@vtt/content-srd-5.2.1/schemas";
import type { ActorDefinition } from "@vtt/schemas";
import { requireActorAccess, requireGm, type Initiator } from "./authorization.js";
import { CommandRejectedError } from "./game-store.js";
import {
  applyCondition,
  endConcentrationSustainedBy,
  endEffectsSustainedBy,
  removeConditionDirect,
  type EffectNarration
} from "./effects.js";
import { offerDamageReaction } from "./damage-reactions.js";
import { choiceOverrideDefenses, type OverrideDamageDefenses } from "./choice-overrides.js";
import { deriveEquipment, type EquipmentCatalog, type EquipmentDerivation } from "./equipment-derivation.js";

export function healthBandOf(hp: Actor["hp"]): HealthBand {
  if (hp.current <= 0) return "down";
  return hp.current * 2 <= hp.maximum ? "bloodied" : "healthy";
}

/** Shared by hp and condition commands: resolve the target if the caller may adjust it. */
export function adjustableActor(state: GameState, actorId: string, initiator: Initiator): Actor {
  const actor = state.actors.find((item) => item.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  requireActorAccess(initiator, state, actorId, "track", "You can only track your own character.");
  return actor;
}

export type DamageInput = Readonly<{
  /** Untyped total for the manual path (no defense math unless `damageType` names one). Ignored when `parts` is present. */
  amount: number;
  /** Typed components from a resolved action; the engine applies immunity, resistance, then vulnerability. */
  parts?: readonly DamagePart[];
  /** Type for a manual entry; absent/"untyped" is the untyped fast path, anything else runs the defences. */
  damageType?: string;
  /** A hand-entered total that replaces what was rolled while keeping the types (`rescaleDamageParts`). */
  damageOverride?: number;
  critical?: boolean;
  sourceName?: string | null;
  /** The creature that dealt it, when known; its damage can open the target's strike-back reaction. */
  sourceActorId?: string | null;
  /** Knocking out a creature (SRD): a nonlethal drop to 0 leaves it Unconscious and stable. */
  nonlethal?: boolean;
}>;
export type DamageDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  /** Mints ids for the concentration-check prompt; when absent the check is skipped. */
  newId?: () => string;
  /** Injected clock (ISO string) for the prompt's createdAt; falls back to wall time. */
  now?: () => string;
  /** The item catalog, so item-granted resistances and immunities reach the damage math. Absent means none. */
  catalog?: EquipmentCatalog;
  /** Creature-to-creature distance on the map, for a strike-back reaction's range; absent skips the check. */
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
  /** The command applying the damage, recorded on a reaction prompt it opens. */
  commandId?: string;
}>;
export type DamageOutcome = Readonly<{ application: DamageApplication; events: EffectNarration[] }>;

const SRD_DAMAGE_TYPES = new Set(DAMAGE_TYPE_IDS);
/** The resolver's sentinel for "this damage has no type"; not one of the SRD's thirteen. */
export const UNTYPED_DAMAGE = "untyped";

/** One of the SRD's thirteen damage types? Never a gate; lets the GM log flag a type that matches nothing. */
export function isSrdDamageType(type: string): boolean {
  return SRD_DAMAGE_TYPES.has(normalizeDamageType(type));
}

/** The typed parts this input applies (resolver parts, re-weighted parts, or typed `amount`); null if untyped. */
export function damagePartsOf(input: DamageInput): readonly DamagePart[] | null {
  if (input.parts && input.parts.length > 0) {
    return input.damageOverride === undefined ? input.parts : rescaleDamageParts(input.parts, input.damageOverride);
  }
  const named = input.damageType === undefined ? "" : normalizeDamageType(input.damageType);
  if (named === "" || named === UNTYPED_DAMAGE) return null;
  return [{ amount: input.damageOverride ?? input.amount, type: named }];
}

/** How a defence reads on a damage line. */
export function adjustmentLabel(adjustment: NonNullable<DamageApplication["parts"][number]["adjustment"]>): string {
  return adjustment === "resistance-and-vulnerability" ? "resistance and vulnerability" : adjustment;
}

/** The damage-adjustment line ("17 bludgeoning → 8, resistance: Rage"); "" when nothing adjusted the hit. */
export function damageAdjustmentDetail(
  application: Readonly<{ parts: DamageApplication["parts"]; flatReduction?: number }>
): string {
  // The flat step comes first (SRD Order of Application), so each part's line starts from what was left.
  const clauses = (application.flatReduction ?? 0) > 0 ? [`-${application.flatReduction}, reduction`] : [];
  for (const part of application.parts)
    if (part.adjustment !== null)
      clauses.push(
        `${part.amount} ${part.type} → ${part.adjusted}, ${adjustmentLabel(part.adjustment)}${part.adjustmentSource ? `: ${part.adjustmentSource}` : ""}`
      );
  return clauses.length > 0 ? ` (${clauses.join("; ")})` : "";
}

/** Flat `damage-reduction` riders on the receiving side, each with the types it covers: standing ones cover every
 *  type, `on-taking-damage` ones the incoming types their `damage-type-is` matches. Riders sharing a `stackKey` are
 *  one game effect, so only the largest counts. */
function damageReductionsFor(derivation: EquipmentDerivation, damageTypes: readonly string[]): DamageReduction[] {
  const isReduction = (rider: ResolvedRider) => rider.modifier.type === "damage-reduction";
  const covered = new Map<ResolvedRider["modifier"], { rider: ResolvedRider; types: string[] | null }>();
  for (const rider of collectRiders(derivation.carriers, { ...derivation.context, moment: null }).filter(isReduction))
    covered.set(rider.modifier, { rider, types: null });
  for (const type of new Set(damageTypes)) {
    const riders = collectRiders(derivation.carriers, {
      ...derivation.context,
      moment: "on-taking-damage",
      damageTypes: [type]
    }).filter(isReduction);
    for (const rider of riders) {
      const entry = covered.get(rider.modifier) ?? { rider, types: [] };
      entry.types?.push(type);
      covered.set(rider.modifier, entry);
    }
  }
  const strongest = new Map<string, { amount: number; types: string[] | null }>();
  const reductions: DamageReduction[] = [];
  for (const { rider, types } of covered.values()) {
    const amount = rider.modifier.amount ?? 0;
    if (amount <= 0) continue;
    if (rider.stackKey === undefined) reductions.push({ amount, types });
    else if ((strongest.get(rider.stackKey)?.amount ?? 0) < amount) strongest.set(rider.stackKey, { amount, types });
  }
  return [...reductions, ...strongest.values()];
}

/** The stat block's defences minus any a rest-time re-choice superseded (chosen options are baked in). */
function definitionDefenses(definition: ActorDefinition | undefined, superseded: ReadonlySet<string> = new Set()) {
  const keep = (list: readonly string[] | undefined) =>
    superseded.size === 0 ? (list ?? []) : (list ?? []).filter((id) => !superseded.has(normalizeDamageType(id)));
  return {
    resistances: keep(definition?.damageResistances),
    immunities: keep(definition?.damageImmunities),
    vulnerabilities: keep(definition?.damageVulnerabilities)
  };
}

export type StandingDefences = ActorDerivedSheet["defences"];

/**
 * The defences an actor carries outside any one hit: the stat block's (less any a rest-time re-choice
 * replaced), the re-chosen features', and its items' and effects'. Situational ones (Petrified,
 * underwater) are added per hit by `applyDamageDetailed`.
 */
export function standingDefences(
  definition: ActorDefinition | undefined,
  fromChoices: OverrideDamageDefenses,
  derivation: EquipmentDerivation
): StandingDefences {
  const innate = definitionDefenses(definition, fromChoices.suppressed);
  const rows = (
    stated: readonly string[],
    chosen: readonly string[],
    derived: EquipmentDerivation["damageResistances"]
  ) => {
    const seen = new Map<string, DerivedDefence>();
    const add = (type: string, source: string | null) => {
      const key = normalizeDamageType(type);
      if (!seen.has(key)) seen.set(key, { type: key, source });
    };
    for (const type of stated) add(type, null);
    for (const type of chosen) add(type, fromChoices.sources.get(normalizeDamageType(type)) ?? null);
    for (const entry of derived) add(entry.id, entry.source);
    return [...seen.values()];
  };
  return {
    resistances: rows(innate.resistances, fromChoices.resistances, derivation.damageResistances),
    immunities: rows(innate.immunities, fromChoices.immunities, derivation.damageImmunities),
    vulnerabilities: rows(innate.vulnerabilities, [], derivation.damageVulnerabilities)
  };
}

/** What a hit would come to on this actor: each typed part through its defences, then flat reduction off
 *  the total. Pure, so a prompt can show the number Confirm will land. */
function weighDamage(state: GameState, actor: Actor, input: DamageInput, deps?: DamageDeps): DamageWeighing {
  let totalRequested: number;
  let totalAdjusted: number;
  let flatReduction = 0;
  let parts: DamageApplication["parts"] = [];
  const typed = damagePartsOf(input);
  if (typed !== null) {
    const definition = actor.definitionId && deps ? deps.resolveDefinition(actor.definitionId) : undefined;
    // A rest-time re-choice replaces the build-time pick, so it both adds and subtracts defences.
    const fromChoices = choiceOverrideDefenses(definition, actor.choiceOverrides, deps?.catalog?.featureRecord);
    const innate = definitionDefenses(definition, fromChoices.suppressed);
    // Effects, items, feats and features are derived whole each time, so removing the ring or ending the Rage
    // removes the resistance on the next hit.
    const derivation = deriveEquipment(actor, definition, deps?.catalog);
    const derivedSourceOf = (
      adjustment: NonNullable<DamageApplication["parts"][number]["adjustment"]>,
      type: string
    ) => {
      const lists =
        adjustment === "immunity"
          ? [derivation.damageImmunities]
          : adjustment === "vulnerability"
            ? [derivation.damageVulnerabilities]
            : adjustment === "resistance"
              ? [derivation.damageResistances]
              : [derivation.damageResistances, derivation.damageVulnerabilities];
      const sources = lists.flatMap((list) => list.filter((entry) => entry.id === type).map((entry) => entry.source));
      return sources.length > 0 ? [...new Set(sources)].join(", ") : null;
    };
    const resisted = (adjustment: DamageApplication["parts"][number]["adjustment"]) =>
      adjustment === "resistance" || adjustment === "resistance-and-vulnerability";
    // SRD Petrified: resistance to all damage + immunity to poison, on top of innate/effect defenses.
    const petrified = actor.conditions.some((condition) => condition.id === "petrified");
    // SRD Underwater Combat: everything fully underwater has resistance to fire damage.
    const underwater = state.combat.active && state.combat.underwater;
    const standing = standingDefences(definition, fromChoices, derivation);
    const types = (rows: readonly DerivedDefence[]) => rows.map((row) => row.type);
    // SRD Order of Application: flat reductions first, then Resistance, then Vulnerability.
    const reduction = reduceDamageParts(
      typed,
      damageReductionsFor(
        derivation,
        typed.map((part) => normalizeDamageType(part.type))
      )
    );
    flatReduction = reduction.reduced;
    const adjusted = adjustDamageParts(reduction.parts, {
      resistances: [...types(standing.resistances), ...(underwater ? ["fire"] : [])],
      immunities: [...types(standing.immunities), ...(petrified ? ["poison"] : [])],
      // Effects and items can make a target vulnerable as a stat block can; a same-type resistance cancels it.
      vulnerabilities: types(standing.vulnerabilities),
      resistAll: petrified
    });
    parts = adjusted.map((part) => {
      const type = part.type.trim().toLowerCase();
      // The effect, item or feature's name on the damage line, so a halved hit explains itself.
      const derivedSource = part.adjustment !== null ? derivedSourceOf(part.adjustment, type) : null;
      // Name the chosen feature on the line, as an effect or item names itself.
      const choiceSource =
        part.adjustment !== null && derivedSource === null ? (fromChoices.sources.get(type) ?? null) : null;
      const innateHas = (list: readonly string[]) => list.map((entry) => entry.toLowerCase()).includes(type);
      const petrifiedSource =
        petrified &&
        choiceSource === null &&
        derivedSource === null &&
        ((resisted(part.adjustment) && !innateHas(innate.resistances)) ||
          (part.adjustment === "immunity" && type === "poison" && !innateHas(innate.immunities)))
          ? "Petrified"
          : null;
      const underwaterSource =
        underwater &&
        resisted(part.adjustment) &&
        type === "fire" &&
        !innateHas(innate.resistances) &&
        derivedSource === null &&
        petrifiedSource === null &&
        choiceSource === null
          ? "Underwater"
          : null;
      return { ...part, adjustmentSource: derivedSource ?? choiceSource ?? petrifiedSource ?? underwaterSource };
    });
    totalRequested = typed.reduce((sum, part) => sum + part.amount, 0);
    totalAdjusted = adjusted.reduce((sum, part) => sum + part.adjusted, 0);
  } else {
    // The untyped fast path: a manual correction that names no type is exact by design.
    totalRequested = input.damageOverride ?? input.amount;
    totalAdjusted = totalRequested;
  }

  return { totalRequested, totalAdjusted, flatReduction, parts };
}

type DamageWeighing = Readonly<{
  totalRequested: number;
  totalAdjusted: number;
  flatReduction: number;
  parts: DamageApplication["parts"];
}>;

/** Half the hit (Uncanny Dodge), rounded down once on the total and spread back over its types. */
export function halvedDamageParts(parts: readonly DamagePart[]): DamagePart[] {
  return halveDamageParts(parts);
}

/** A dry run of `applyDamageDetailed`: the typed breakdown and total it would apply, with nothing moved. */
export function previewDamage(
  state: GameState,
  actorId: string,
  input: DamageInput,
  deps?: DamageDeps
): Pick<DamageApplication, "totalRequested" | "totalApplied" | "parts" | "flatReduction"> {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant is not on the table.");
  const weighed = weighDamage(state, actor, input, deps);
  return {
    totalRequested: weighed.totalRequested,
    totalApplied: weighed.totalAdjusted,
    parts: weighed.parts,
    ...(weighed.flatReduction > 0 ? { flatReduction: weighed.flatReduction } : {})
  };
}

/** The single damage entry point (ADR-0020): typed parts go through definition, effect and item
 *  defences; the untyped amount stays exact. Temp HP absorbs first. At 0 HP player characters start
 *  dying (or die on massive overflow) and any combatant releases the effects it sustains. */
export function applyDamageDetailed(
  state: GameState,
  actorId: string,
  input: DamageInput,
  scope: Initiator,
  deps?: DamageDeps
): DamageOutcome {
  const actor = adjustableActor(state, actorId, scope);
  const events: EffectNarration[] = [];
  const { totalRequested, totalAdjusted, flatReduction, parts } = weighDamage(state, actor, input, deps);

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

  if (isPlayerCharacter && wasAtZero && totalAdjusted > 0) {
    // Damage while dying: automatic failures (two on a crit), even when Temporary Hit Points soak it all ("If
    // you take any damage while you have 0 Hit Points"); instant death when what carries over reaches the maximum.
    const current = actor.deathSaves ?? { successes: 0, failures: 0, stable: false };
    const outcome = damageWhileDying(current, totalAdjusted, input.critical === true, actor.hp.maximum, damageToHp);
    actor.deathSaves = outcome.state;
    deathSaveFailuresAdded = outcome.failuresAdded;
    instantDeath = outcome.dead && damageToHp >= actor.hp.maximum;
    applyCondition(actor, "unconscious", { immunities: deps });
    applyCondition(actor, "prone", { immunities: deps });
  } else if (!wasAtZero && actor.hp.current === 0 && damageToHp > 0) {
    if (input.nonlethal === true) {
      // Knocking out (SRD): the target drops to 0, Unconscious and stable (no death saves, no defeat).
      if (isPlayerCharacter) actor.deathSaves = { successes: 0, failures: 0, stable: true };
      applyCondition(actor, "unconscious", { immunities: deps });
      applyCondition(actor, "prone", { immunities: deps });
      events.push({
        kind: "condition",
        text: `${actor.name} was knocked out - Unconscious and stable at 0 HP.`,
        actorId
      });
    } else if (isPlayerCharacter) {
      const overflow = damageToHp - hpBefore;
      const outcome = droppedToZero(overflow, actor.hp.maximum);
      actor.deathSaves = outcome.state;
      instantDeath = outcome.instantDeath;
      applyCondition(actor, "unconscious", { immunities: deps });
      applyCondition(actor, "prone", { immunities: deps });
      events.push({
        kind: "condition",
        text: instantDeath ? `${actor.name} was killed outright.` : `${actor.name} fell Unconscious and is dying.`,
        actorId
      });
    } else {
      defeated = true;
    }
    // At 0 HP a combatant can't sustain effects (grapples, rage); incapacitation also breaks
    // concentration (SRD Concentration).
    events.push(...endEffectsSustainedBy(state, actor.id));
    events.push(...endConcentrationSustainedBy(state, actor.id));
  }

  // SRD Concentration: damage while concentrating prompts a CON save, DC max(10, half the damage) capped
  // at 30. The prompt carries the effects a committed failure ends. Skipped without an id-minter.
  if (totalAdjusted > 0 && actor.hp.current > 0 && deps?.newId && state.combat.active) {
    const sustained: Array<{ actorId: string; effectId: string }> = [];
    for (const bearer of state.actors) {
      for (const effect of bearer.effects) {
        if (effect.concentration && effect.sourceActorId === actor.id)
          sustained.push({ actorId: bearer.id, effectId: effect.id });
      }
    }
    if (sustained.length > 0 && state.combat.pendingSaves.length < 100) {
      const dc = Math.min(30, Math.max(10, Math.floor(totalAdjusted / 2)));
      state.combat = {
        ...state.combat,
        pendingSaves: [
          ...state.combat.pendingSaves,
          {
            id: deps.newId(),
            targetActorId: actor.id,
            ability: "con" as const,
            dc,
            sourceActorId: null,
            sourceName: input.sourceName ?? "Damage",
            actionName: "Concentration check",
            proposedDamage: 0,
            halfOnSuccess: false,
            conditionIds: [],
            saveBonus: 0,
            endsEffects: sustained,
            createdAt: deps.now ? Date.parse(deps.now()) : Date.now()
          }
        ]
      };
      events.push({
        kind: "condition",
        text: `${actor.name} must make a DC ${dc} Constitution save to keep concentrating.`,
        actorId: actor.id
      });
    }
  }

  // Damage from a creature can open the target's strike-back reaction (Hellish Rebuke). Skipped without an id-minter.
  if (totalAdjusted > 0 && input.sourceActorId && deps) {
    const offered = offerDamageReaction(state, actor, input.sourceActorId, deps);
    if (offered) events.push(offered);
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
export function applyDamage(state: GameState, actorId: string, amount: number, scope: Initiator) {
  applyDamageDetailed(state, actorId, { amount }, scope);
}

/** Healing caps at maximum and never restores temp HP; healing from 0 clears dying and Unconscious (not Prone). */
export function healActor(state: GameState, actorId: string, amount: number, scope: Initiator): EffectNarration[] {
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

/** Temporary hit points replace rather than stack (choosing the higher is left to the table). */
export function setTemporaryHp(state: GameState, actorId: string, amount: number, scope: Initiator) {
  const actor = adjustableActor(state, actorId, scope);
  actor.hp.temporary = amount;
}

/** GM correction: set current HP (clamped), running the same zero-HP transitions. */
export function setCurrentHp(state: GameState, actorId: string, current: number, scope: Initiator): EffectNarration[] {
  requireGm(scope, "Only the GM can set hit points directly.");
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
      applyCondition(actor, "unconscious");
      applyCondition(actor, "prone");
      events.push({ kind: "condition", text: `${actor.name} fell Unconscious and is dying.`, actorId });
    }
    events.push(...endEffectsSustainedBy(state, actor.id));
  }
  return events;
}

import type { Actor, DamageApplication, GameState, HealthBand } from "@vtt/domain";
import {
  adjustDamageParts,
  collectRiders,
  damageWhileDying,
  droppedToZero,
  normalizeDamageType,
  reduceDamageTotal,
  rescaleDamageParts,
  sumRiders,
  type DamagePart
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
import { choiceOverrideDefenses } from "./choice-overrides.js";
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

/** The damage-adjustment line ("17 bludgeoning → 8, resistance: Rage"); "" when nothing adjusted the hit. */
export function damageAdjustmentDetail(
  application: Readonly<{ parts: DamageApplication["parts"]; flatReduction?: number }>
): string {
  const clauses = application.parts
    .filter((part) => part.adjustment !== null)
    .map(
      (part) =>
        `${part.amount} ${part.type} → ${part.adjusted}, ${part.adjustment}${part.adjustmentSource ? `: ${part.adjustmentSource}` : ""}`
    );
  // The flat step is not per-type: it comes once, after the halving.
  if ((application.flatReduction ?? 0) > 0) clauses.push(`then -${application.flatReduction}, reduction`);
  return clauses.length > 0 ? ` (${clauses.join("; ")})` : "";
}

/** Flat `damage-reduction` riders on the receiving side: standing ones plus `on-taking-damage` ones whose
 *  `damage-type-is` matches the incoming types. */
function damageReductionFor(derivation: EquipmentDerivation, damageTypes: readonly string[]): number {
  const standing = collectRiders(derivation.carriers, { ...derivation.context, moment: null });
  const onTakingDamage = collectRiders(derivation.carriers, {
    ...derivation.context,
    moment: "on-taking-damage",
    damageTypes
  });
  return sumRiders(standing, "damage-reduction") + sumRiders(onTakingDamage, "damage-reduction");
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
    const ids = (list: EquipmentDerivation["damageResistances"]) => list.map((entry) => entry.id);
    const derivedSourceOf = (adjustment: "resistance" | "immunity" | "vulnerability", type: string) => {
      const list =
        adjustment === "immunity"
          ? derivation.damageImmunities
          : adjustment === "vulnerability"
            ? derivation.damageVulnerabilities
            : derivation.damageResistances;
      return list.find((entry) => entry.id === type)?.source ?? null;
    };
    // SRD Petrified: resistance to all damage + immunity to poison, on top of innate/effect defenses.
    const petrified = actor.conditions.some((condition) => condition.id === "petrified");
    // SRD Underwater Combat: everything fully underwater has resistance to fire damage.
    const underwater = state.combat.active && state.combat.underwater;
    const adjusted = adjustDamageParts(typed, {
      resistances: [
        ...innate.resistances,
        ...fromChoices.resistances,
        ...ids(derivation.damageResistances),
        ...(underwater ? ["fire"] : [])
      ],
      immunities: [
        ...(petrified ? [...innate.immunities, "poison"] : innate.immunities),
        ...fromChoices.immunities,
        ...ids(derivation.damageImmunities)
      ],
      // Effects and items can make a target vulnerable as a stat block can; a same-type resistance cancels it.
      vulnerabilities: [...innate.vulnerabilities, ...ids(derivation.damageVulnerabilities)],
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
        ((part.adjustment === "resistance" && !innateHas(innate.resistances)) ||
          (part.adjustment === "immunity" && type === "poison" && !innateHas(innate.immunities)))
          ? "Petrified"
          : null;
      const underwaterSource =
        underwater &&
        part.adjustment === "resistance" &&
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
    const afterDefenses = adjusted.reduce((sum, part) => sum + part.adjusted, 0);
    // Last, on the total: flat reduction subtracts from what the per-type math produced.
    flatReduction = Math.max(
      0,
      damageReductionFor(
        derivation,
        adjusted.map((part) => normalizeDamageType(part.type))
      )
    );
    totalAdjusted = reduceDamageTotal(afterDefenses, flatReduction);
    flatReduction = afterDefenses - totalAdjusted;
  } else {
    // The untyped fast path: a manual correction that names no type is exact by design.
    totalRequested = input.damageOverride ?? input.amount;
    totalAdjusted = totalRequested;
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
            conditionId: null,
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

import {
  isDead,
  type Actor,
  type ActorDerivedSheet,
  type DamageApplication,
  type DerivedDefence,
  type GameState,
  type HealthBand
} from "@vtt/domain";
import { blessOnTheKill } from "./dark-ones-blessing.js";
import {
  adjustDamageParts,
  collectRiders,
  damageWhileDying,
  droppedToZero,
  halveDamageParts,
  normalizeDamageType,
  parseDiceFormula,
  reduceDamageParts,
  rescaleDamageParts,
  resolveDice,
  type DamagePart,
  type DamageReduction,
  type RandomSource,
  type ResolvedRider
} from "@vtt/rules-5e";
import { DAMAGE_TYPE_IDS } from "@vtt/content-srd-5.2.1/schemas";
import type { ActorDefinition, DamageDrain } from "@vtt/schemas";
import { requireActorAccess, requireGm, type Initiator } from "./authorization.js";
import { CommandRejectedError } from "./game-store.js";
import {
  addEffect,
  applyCondition,
  DEATH_WARD_TAG,
  endConcentrationOnTheDead,
  endConcentrationSustainedBy,
  endEffect,
  endEffectsOnDamage,
  endEffectsSustainedBy,
  endKnockOut,
  KNOCKED_OUT_TAG,
  makeEffect,
  STABLE_RECOVERY_TAG,
  NO_HEALING_TAG,
  RAGING_TAG,
  removeConditionDirect,
  sourceOf,
  type EffectNarration
} from "./effects.js";
import { returnToLife, stampDeath } from "./death.js";
import { markRising } from "./risen.js";
import { mistyEscape, regainedHitPoints, restorationAtDeath, tallyTurnDamage } from "./death-traits.js";
import { holdsFeature } from "./class-features.js";
import { rollSaveAtOnce } from "./saving-throws.js";
import { offerDamageReaction } from "./damage-reactions.js";
import { releaseSwallowedBy } from "./swallow.js";
import { leaveShortRest } from "./short-rest-interruptions.js";
import { choiceOverrideDefenses, type OverrideDamageDefenses } from "./choice-overrides.js";
import { deriveEquipment, type EquipmentCatalog, type EquipmentDerivation } from "./equipment-derivation.js";
import { oilIgnition, OILED_TAG } from "./hazards.js";
import { sightRules } from "./vision/rules.js";
import {
  deathBurst,
  holdOnAtZero,
  REGENERATING_AT_ZERO_TAG,
  stopRegeneration,
  undeadFortitude
} from "./statblock-traits.js";

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
  /** Knocking out a creature (SRD): a melee attack that would drop it to 0 leaves it at 1 HP and Unconscious. */
  nonlethal?: boolean;
  /** What the damage drains as it lands (a Life Drain's lower Hit Point maximum, Vampiric Touch's healing). */
  drain?: DamageDrain;
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
  /** The server's dice, for what a stat block rolls as damage lands (Undead Fortitude's save, a Death Burst's damage);
   *  without them those traits are left to the GM. */
  rollDie?: RandomSource;
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
function damageReductionsFor(
  derivation: EquipmentDerivation,
  damageTypes: readonly string[],
  rolling: ReductionRolling | null
): DamageReduction[] {
  // A once-a-turn reduction (Resistance) already spent this turn gives nothing more until the next one.
  const spentThisTurn = (rider: ResolvedRider) =>
    rider.modifier.oncePerTurn === true &&
    rider.sourceEffectId !== undefined &&
    rolling?.turnKey !== undefined &&
    rolling.spentEffectIds(rider.sourceEffectId);
  const isReduction = (rider: ResolvedRider) => rider.modifier.type === "damage-reduction" && !spentThisTurn(rider);
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
    // Dice roll only as the damage lands; a preview leaves them out.
    const dice = rider.modifier.dice !== undefined && rolling ? rolling.roll(rider.modifier.dice) : 0;
    const amount = (rider.modifier.amount ?? 0) + dice;
    if (amount <= 0) continue;
    if (rider.modifier.oncePerTurn === true && rider.sourceEffectId !== undefined)
      rolling?.used.push(rider.sourceEffectId);
    if (rider.stackKey === undefined) reductions.push({ amount, types });
    else if ((strongest.get(rider.stackKey)?.amount ?? 0) < amount) strongest.set(rider.stackKey, { amount, types });
  }
  return [...reductions, ...strongest.values()];
}

/** How a landing hit rolls a reduction's dice and spends a once-a-turn one: the turn it lands in (`round:actorId`,
 *  absent outside a fight, where each hit may use it), which effects are already spent this turn, and those it spends. */
type ReductionRolling = Readonly<{
  roll: (formula: string) => number;
  turnKey?: string;
  spentEffectIds: (effectId: string) => boolean;
  used: string[];
}>;

/** The rolling a landing hit on `actor` uses, or null without the server's dice (a preview). */
function reductionRolling(state: GameState, actor: Actor, rollDie: RandomSource | undefined): ReductionRolling | null {
  if (!rollDie) return null;
  const turnKey = state.combat.active ? `${state.combat.round}:${state.combat.turnActorId ?? ""}` : undefined;
  return {
    roll: (formula) => resolveDice(parseDiceFormula(formula), rollDie).total,
    ...(turnKey !== undefined ? { turnKey } : {}),
    spentEffectIds: (effectId) =>
      turnKey !== undefined && actor.effects.some((effect) => effect.id === effectId && effect.usedOnTurn === turnKey),
    used: []
  };
}

/** The damage types whose Resistance the dealer's damage ignores (Boon of Irresistible Offense), from its standing
 *  `ignores-resistance` riders. */
function resistanceIgnoredBy(state: GameState, sourceActorId: string | null, deps: DamageDeps | undefined): string[] {
  const source = sourceActorId === null ? undefined : state.actors.find((actor) => actor.id === sourceActorId);
  if (!source || !deps) return [];
  const definition = source.definitionId ? deps.resolveDefinition(source.definitionId) : undefined;
  const derivation = deriveEquipment(source, definition, deps.catalog);
  return collectRiders(derivation.carriers, { ...derivation.context, moment: null }).flatMap((rider) =>
    rider.modifier.type === "ignores-resistance" ? [...(rider.modifier.damageTypes ?? [])] : []
  );
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

/** Boon of the Night Spirit's Shadowy Form: "While within Dim Light or Darkness, you have Resistance to all damage
 *  except Psychic and Radiant". Only where dynamic vision knows the light at the creature's space; else the GM's. */
function inShadowyForm(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined,
  deps: DamageDeps | undefined
): boolean {
  if (!deps || !(definition?.character?.feats ?? []).some((feat) => feat.id === "boon-of-the-night-spirit"))
    return false;
  const content = { definition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) };
  const light = sightRules(state, content).lightAt(actor.id);
  return light !== null && light.level !== "bright";
}
const SHADOWY_FORM_SPARES = ["psychic", "radiant"];

/** What a hit would come to on this actor: each typed part through its defences, then flat reduction off
 *  the total. Pure, so a prompt can show the number Confirm will land. */
function weighDamage(
  state: GameState,
  actor: Actor,
  input: DamageInput,
  deps?: DamageDeps,
  rolling: ReductionRolling | null = null
): DamageWeighing {
  let totalRequested: number;
  let totalAdjusted: number;
  let flatReduction = 0;
  let parts: DamageApplication["parts"] = [];
  const given = damagePartsOf(input);
  // Fire reaching a creature covered in oil burns the oil too (SRD Oil).
  const ignition = given !== null ? oilIgnition(actor, given) : null;
  const typed = given !== null && ignition !== null ? [...given, ignition] : given;
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
    // SRD 5.2.1 Petrified: resistance to all damage, poison included (its immunity is to the Poisoned condition).
    const petrified = actor.conditions.some((condition) => condition.id === "petrified");
    // SRD Underwater Combat: everything fully underwater has resistance to fire damage.
    const underwater = state.combat.active && state.combat.underwater;
    const shadowy = inShadowyForm(state, actor, definition, deps)
      ? typed.map((part) => normalizeDamageType(part.type)).filter((type) => !SHADOWY_FORM_SPARES.includes(type))
      : [];
    const standing = standingDefences(definition, fromChoices, derivation);
    const types = (rows: readonly DerivedDefence[]) => rows.map((row) => row.type);
    // SRD Order of Application: flat reductions first, then Resistance, then Vulnerability.
    const reduction = reduceDamageParts(
      typed,
      damageReductionsFor(
        derivation,
        typed.map((part) => normalizeDamageType(part.type)),
        rolling
      )
    );
    flatReduction = reduction.reduced;
    const adjusted = adjustDamageParts(reduction.parts, {
      resistances: [...types(standing.resistances), ...(underwater ? ["fire"] : []), ...shadowy],
      immunities: types(standing.immunities),
      // Effects and items can make a target vulnerable as a stat block can; with a same-type resistance both apply.
      vulnerabilities: types(standing.vulnerabilities),
      resistAll: petrified,
      ignoresResistance: resistanceIgnoredBy(state, input.sourceActorId ?? null, deps)
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
        resisted(part.adjustment) &&
        !innateHas(innate.resistances)
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
      const shadowSource =
        shadowy.includes(type) &&
        resisted(part.adjustment) &&
        !innateHas(innate.resistances) &&
        derivedSource === null &&
        petrifiedSource === null &&
        choiceSource === null &&
        underwaterSource === null
          ? "Shadowy Form"
          : null;
      return {
        ...part,
        adjustmentSource: derivedSource ?? choiceSource ?? petrifiedSource ?? underwaterSource ?? shadowSource
      };
    });
    totalRequested = typed.reduce((sum, part) => sum + part.amount, 0);
    totalAdjusted = adjusted.reduce((sum, part) => sum + part.adjusted, 0);
  } else {
    // The untyped fast path: a manual correction that names no type is exact by design.
    totalRequested = input.damageOverride ?? input.amount;
    totalAdjusted = totalRequested;
  }

  return { totalRequested, totalAdjusted, flatReduction, parts, oilIgnited: ignition !== null };
}

type DamageWeighing = Readonly<{
  totalRequested: number;
  totalAdjusted: number;
  flatReduction: number;
  parts: DamageApplication["parts"];
  /** The hit's Fire set the bearer's oil alight, which adds its 5 Fire and uses the oil up. */
  oilIgnited: boolean;
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

/**
 * What dropping to 0 Hit Points does, by damage or by hit points lost: a character falls Unconscious and is dying (or
 * dies outright when the overflow reaches its maximum), any other creature is defeated (a troll lies down until its
 * turn, a vampire turns to mist, a Death Burst goes off), and nobody at 0 sustains effects or Concentration. `outright`:
 * it dies whatever it would otherwise do (a kill-outright rule).
 */
function fallToZero(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined,
  overflow: number,
  deps: DamageDeps | undefined,
  events: EffectNarration[],
  outright = false
): Readonly<{ instantDeath: boolean; defeated: boolean }> {
  let instantDeath = false;
  let defeated = false;
  if (actor.kind === "player-character") {
    const outcome = droppedToZero(outright ? actor.hp.maximum : overflow, actor.hp.maximum);
    actor.deathSaves = outcome.state;
    instantDeath = outcome.instantDeath;
    applyCondition(actor, "unconscious", { immunities: deps });
    applyCondition(actor, "prone", { immunities: deps });
    // A rule that kills outright says what killed it.
    if (!outright)
      events.push({
        kind: "condition",
        text: instantDeath ? `${actor.name} was killed outright.` : `${actor.name} fell Unconscious and is dying.`,
        actorId: actor.id
      });
  } else {
    defeated = true;
    // A swallower that dies lets out what it swallowed (SRD: "can escape from the corpse").
    events.push(...releaseSwallowedBy(state, actor.id, definition));
    // A troll lies down until its next turn says whether it regenerates and a vampire escapes as mist; anything else
    // dies, and a Death Burst goes off as it does. Killed outright, it lies dead whatever its traits.
    if (outright) removeConditionDirect(actor, "unconscious");
    const holds =
      !outright &&
      (holdOnAtZero(state, actor, definition, events) || mistyEscape(state, actor, definition, deps, events));
    if (!holds && deps) deathBurst(state, actor, definition, deps, events);
    if (!holds) restorationAtDeath(state, actor, definition, events);
  }
  // At 0 HP a combatant can't sustain effects (grapples, rage); incapacitation also breaks
  // concentration (SRD Concentration).
  events.push(...endEffectsSustainedBy(state, actor.id));
  events.push(...endConcentrationSustainedBy(state, actor.id));
  // A spell whose last creature just died has nothing left.
  events.push(...endConcentrationOnTheDead(state, actor));
  return { instantDeath, defeated };
}

/**
 * A creature killed outright, whatever its Hit Points (Power Word Kill, a solar's Slaying Bow): it drops to 0 and dies
 * there, a character with three failed death saves and anything else with no trait to hold it up, and what it sustained
 * ends as any death ends it. `withoutDamage` is an effect that kills with no damage, which Death Ward negates instead
 * ("If the spell is still in effect when the target is subjected to an effect that would kill it instantly without
 * dealing damage, that effect is negated against the target, and the spell ends").
 */
export function killOutright(
  state: GameState,
  actorId: string,
  cause: string,
  options: Readonly<{ withoutDamage?: boolean; bodyGone?: boolean; headLost?: boolean; deps?: DamageDeps }> = {}
): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor || isDead(actor)) return [];
  const events: EffectNarration[] = [];
  const ward = options.withoutDamage ? actor.effects.find((effect) => effect.tags.includes(DEATH_WARD_TAG)) : undefined;
  if (ward) {
    events.push(
      { kind: "condition", text: `${ward.name} turns ${cause} aside from ${actor.name}.`, actorId },
      ...endEffect(state, actor.id, ward.id)
    );
    return events;
  }
  const deps = options.deps;
  const definition = actor.definitionId && deps ? deps.resolveDefinition(actor.definitionId) : undefined;
  actor.hp = { ...actor.hp, current: 0, temporary: 0 };
  events.push({ kind: "condition", text: `${actor.name} dies (${cause}).`, actorId });
  fallToZero(state, actor, definition, actor.hp.maximum, deps, events, true);
  stampDeath(state, actor, {
    cause,
    ...(options.bodyGone ? { bodyGone: true } : {}),
    ...(options.headLost ? { headLost: true } : {})
  });
  return events;
}

/** SRD Death Ward: "The first time the target would drop to 0 Hit Points before the spell ends, the target instead
 *  drops to 1 Hit Point, and the spell ends." True when it held the creature at 1. */
function deathWard(state: GameState, actor: Actor, events: EffectNarration[]): boolean {
  const ward = actor.effects.find((effect) => effect.tags.includes(DEATH_WARD_TAG));
  if (!ward) return false;
  actor.hp = { ...actor.hp, current: 1 };
  events.push(
    { kind: "condition", text: `${actor.name} drops to 1 Hit Point instead (${ward.name}).`, actorId: actor.id },
    ...endEffect(state, actor.id, ward.id)
  );
  return true;
}

/** SRD Relentless Endurance (Orc): "When you are reduced to 0 Hit Points but not killed outright, you can drop to 1 Hit
 *  Point instead", once a Long Rest. It is taken the first time it can be, since staying up is never the worse
 *  choice. True when it held the creature at 1. */
function relentlessEndurance(
  actor: Actor,
  definition: ActorDefinition | undefined,
  overflow: number,
  events: EffectNarration[]
): boolean {
  if (overflow >= actor.hp.maximum) return false;
  const trait = definition?.actions.find((action) => /(^|-)relentless-endurance$/.test(action.id));
  if (!trait?.uses) return false;
  const key = trait.uses.pool ?? trait.id;
  if ((actor.actionUses[key] ?? 0) >= trait.uses.limit) return false;
  actor.actionUses = { ...actor.actionUses, [key]: (actor.actionUses[key] ?? 0) + 1 };
  actor.hp = { ...actor.hp, current: 1 };
  events.push({
    kind: "condition",
    text: `${actor.name} drops to 1 Hit Point instead (${trait.name}).`,
    actorId: actor.id
  });
  return true;
}

/** The tag on a Hunter's Mark effect. */
const HUNTERS_MARK_TAG = "hunters-mark";

/** Counts the uses of Relentless Rage since the last rest; each one raises its DC by 5. */
export const RELENTLESS_RAGE_KEY = "relentless-rage";

/** SRD Relentless Rage (Barbarian 11): "If you drop to 0 Hit Points while your Rage is active and don't die outright,
 *  you can make a DC 10 Constitution saving throw. If you succeed, your Hit Points instead change to a number equal to
 *  twice your Barbarian level. Each time you use this feature after the first, the DC increases by 5." The server
 *  rolls the save. True when it held the creature up. */
function relentlessRage(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined,
  overflow: number,
  deps: DamageDeps | undefined,
  events: EffectNarration[]
): boolean {
  if (overflow >= actor.hp.maximum || !deps?.rollDie) return false;
  if (!actor.effects.some((effect) => effect.tags.includes(RAGING_TAG))) return false;
  if (!holdsFeature(definition, "relentless-rage", "Relentless Rage")) return false;
  const used = actor.actionUses[RELENTLESS_RAGE_KEY] ?? 0;
  const dc = 10 + 5 * used;
  const save = rollSaveAtOnce(state, actor, "con", { ...deps, rollDie: deps.rollDie });
  actor.actionUses = { ...actor.actionUses, [RELENTLESS_RAGE_KEY]: used + 1 };
  const held = save.total >= dc;
  const level = definition?.character?.classes.find((entry) => entry.id === "barbarian")?.level ?? 0;
  if (held) actor.hp = { ...actor.hp, current: Math.min(actor.hp.maximum, Math.max(1, level * 2)) };
  events.push({
    kind: "condition",
    text: `${actor.name}'s Relentless Rage: CON save ${save.total} (d20 ${save.natural}) vs DC ${dc}: ${held ? `up at ${actor.hp.current} HP` : "it falls"}.`,
    actorId: actor.id
  });
  return held;
}

/** Marks the effect that holds what drained damage took off a creature's Hit Point maximum. */
export const DRAINED_TAG = "drained";

/**
 * What damage drains as it lands (`DamageDrainSchema`). The target's Hit Point maximum decreases by the damage it took,
 * held on one "Hit Point maximum reduced" effect that gives it back when it ends (a Long Rest ends it), and a creature
 * whose maximum reaches 0 dies. The creature that dealt the damage regains hit points from it. A monster's lower
 * maximum and its healing are the GM's to know.
 */
function drainDamage(
  state: GameState,
  actor: Actor,
  input: DamageInput,
  taken: Readonly<{ parts: DamageApplication["parts"]; totalAdjusted: number }>,
  definition: ActorDefinition | undefined,
  deps: DamageDeps | undefined,
  events: EffectNarration[]
): Readonly<{ died: boolean }> {
  const drain = input.drain!;
  const type = drain.damageType?.toLowerCase();
  const amount =
    type === undefined
      ? taken.totalAdjusted
      : taken.parts.filter((part) => part.type.toLowerCase() === type).reduce((sum, part) => sum + part.adjusted, 0);
  if (amount <= 0) return { died: false };
  let died = false;
  const loss = drain.reducesMaximum
    ? Math.min(amount, Math.max(0, actor.hp.maximum - (drain.keepsOneMaximum ? 1 : 0)))
    : 0;
  if (loss > 0) {
    const wasStanding = actor.hp.current > 0;
    actor.hp = {
      ...actor.hp,
      maximum: actor.hp.maximum - loss,
      current: Math.min(actor.hp.current, actor.hp.maximum - loss)
    };
    const held = actor.effects.find((effect) => effect.tags.includes(DRAINED_TAG));
    if (held)
      actor.effects = actor.effects.map((effect) =>
        effect.id === held.id ? { ...effect, hitPointMaximumLoss: (effect.hitPointMaximumLoss ?? 0) + loss } : effect
      );
    else
      addEffect(
        state,
        actor.id,
        makeEffect({
          id: `${deps?.commandId ?? deps?.newId?.() ?? `${actor.id}:${actor.hp.maximum}`}:drained`,
          name: "Hit Point maximum reduced",
          tags: [DRAINED_TAG],
          sourceActorId: input.sourceActorId ?? null,
          sourceName: input.sourceName ?? null,
          startedRound: state.combat.round,
          duration: { type: "manual" },
          hitPointMaximumLoss: loss
        }),
        events,
        deps
      );
    const pc = actor.kind === "player-character";
    events.push({
      kind: "damage",
      text: `${actor.name}'s Hit Point maximum drops by ${loss}, until a Long Rest.`,
      actorId: actor.id,
      ...(pc ? {} : { gmOnly: true as const })
    });
    if (actor.hp.maximum <= 0) {
      died = true;
      if (pc) {
        actor.deathSaves = { successes: 0, failures: 3, stable: false };
        applyCondition(actor, "unconscious", { immunities: deps });
        applyCondition(actor, "prone", { immunities: deps });
        events.push({
          kind: "condition",
          text: `${actor.name} dies, its Hit Point maximum drained away.`,
          actorId: actor.id
        });
      } else if (wasStanding) fallToZero(state, actor, definition, 0, deps, events);
    }
  }
  const sourceId = drain.heals ? input.sourceActorId : null;
  const source = sourceId ? state.actors.find((candidate) => candidate.id === sourceId) : undefined;
  const regained = drain.heals === "half" ? Math.floor(amount / 2) : amount;
  if (source && regained > 0) {
    const before = source.hp.current;
    const healed = healActor(state, source.id, regained, { role: "gm" });
    if (source.hp.current > before)
      events.push({
        kind: "effect",
        text: `${source.name} regains ${source.hp.current - before} hit points.`,
        actorId: source.id,
        ...(source.kind === "player-character" ? {} : { gmOnly: true as const })
      });
    events.push(...healed);
  }
  return { died };
}

/**
 * Hit points lost with no damage taken (an infernal wound: "the target loses 5 (1d10) Hit Points"): no type, no
 * defence, no Temporary Hit Points and no Concentration save, since none of those meet damage that isn't dealt. A
 * creature it drops to 0 falls as damage would drop it, with no overflow to kill it outright. Returns what it lost.
 */
export function loseHitPoints(
  state: GameState,
  actorId: string,
  amount: number,
  deps?: DamageDeps
): Readonly<{ lost: number; events: EffectNarration[] }> {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor || amount <= 0 || actor.hp.current <= 0) return { lost: 0, events: [] };
  const before = actor.hp.current;
  actor.hp.current = Math.max(0, before - amount);
  const events: EffectNarration[] = [];
  if (actor.hp.current === 0) {
    const definition = actor.definitionId && deps ? deps.resolveDefinition(actor.definitionId) : undefined;
    fallToZero(state, actor, definition, 0, deps, events);
  }
  return { lost: before - actor.hp.current, events };
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
  const rolling = reductionRolling(state, actor, deps?.rollDie);
  const { totalRequested, totalAdjusted, flatReduction, parts, oilIgnited } = weighDamage(
    state,
    actor,
    input,
    deps,
    rolling
  );
  // A once-a-turn reduction that helped is spent for this turn (Resistance).
  if (rolling?.turnKey !== undefined && rolling.used.length > 0)
    actor.effects = actor.effects.map((effect) =>
      rolling.used.includes(effect.id) ? { ...effect, usedOnTurn: rolling.turnKey } : effect
    );
  // Burning oil is spent once it flares.
  if (oilIgnited) {
    events.push({ kind: "damage", text: `The oil on ${actor.name} catches fire (5 Fire damage).`, actorId: actor.id });
    for (const oil of actor.effects.filter((effect) => effect.tags.includes(OILED_TAG)))
      events.push(...endEffect(state, actor.id, oil.id));
  }

  const hpBefore = actor.hp.current;
  const wasAtZero = hpBefore <= 0;
  const deadBefore = isDead(actor);
  const absorbed = Math.min(actor.hp.temporary, totalAdjusted);
  actor.hp.temporary -= absorbed;
  const damageToHp = totalAdjusted - absorbed;
  actor.hp.current = Math.max(0, hpBefore - damageToHp);
  // SRD Knocking Out a Creature: a melee attack that would drop it to 0 can leave it at 1 HP and Unconscious instead.
  const knockedOut = input.nonlethal === true && !wasAtZero && actor.hp.current === 0 && damageToHp > 0;
  if (knockedOut) actor.hp.current = 1;
  const definition = actor.definitionId && deps ? deps.resolveDefinition(actor.definitionId) : undefined;
  const isPlayerCharacter = actor.kind === "player-character";
  // What its stat block does as the damage lands: Acid or Fire stops a troll's Regeneration, and Undead Fortitude may
  // leave a zombie at 1 Hit Point.
  if (totalAdjusted > 0) events.push(...stopRegeneration(state, actor, definition, parts));
  if (!isPlayerCharacter && !knockedOut && !wasAtZero && actor.hp.current === 0 && damageToHp > 0 && deps)
    undeadFortitude(
      state,
      actor,
      definition,
      { taken: totalAdjusted, parts, critical: input.critical === true },
      deps,
      events
    );
  // Sleep, Turn Undead and the like end the moment the bearer takes any damage, and so does a Short Rest.
  if (totalAdjusted > 0)
    events.push(
      ...endEffectsOnDamage(
        state,
        actor,
        input.sourceActorId
          ? { actorId: input.sourceActorId, ...(deps ? { resolveDefinition: deps.resolveDefinition } : {}) }
          : undefined
      ),
      ...leaveShortRest(state, new Set([actor.id]), "took damage")
    );

  let deathSaveFailuresAdded = 0;
  let instantDeath = false;
  let defeated = false;

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
  } else if (knockedOut) {
    // Unconscious until it regains any hit points (or first aid, which the GM ends by hand). No dying, no defeat.
    addEffect(
      state,
      actor.id,
      makeEffect({
        id: `${deps?.commandId ?? deps?.newId?.() ?? `${actor.id}:${hpBefore}`}:knocked-out`,
        name: "Knocked out",
        tags: [KNOCKED_OUT_TAG],
        sourceActorId: input.sourceActorId ?? null,
        sourceName: input.sourceName ?? null,
        startedRound: state.combat.round,
        // "The creature then has the Unconscious condition and starts a Short Rest": an hour of game time, after which
        // it wakes, unless hit points or first aid wake it first.
        duration: { type: "minutes", remaining: 60 },
        linkedConditionIds: ["unconscious"]
      }),
      events,
      deps
    );
    events.push({
      kind: "condition",
      text: `${actor.name} was knocked out, Unconscious at 1 HP until it regains hit points or its Short Rest ends.`,
      actorId
    });
  } else if (!wasAtZero && actor.hp.current === 0 && damageToHp > 0 && deathWard(state, actor, events)) {
    // Death Ward held the creature at 1 Hit Point: nothing falls.
  } else if (!wasAtZero && actor.hp.current === 0 && damageToHp > 0 && input.drain?.killsAtZero) {
    // "The target dies if it is reduced to 0 Hit Points by this attack": no death saves, no trait to hold it up.
    const kill = input.drain.killsAtZero;
    const cause = kill.cause ?? input.sourceName ?? "the blow";
    events.push({ kind: "condition", text: `${actor.name} dies (${cause}).`, actorId });
    const fell = fallToZero(state, actor, definition, damageToHp - hpBefore, deps, events, true);
    stampDeath(state, actor, { cause, ...(kill.bodyGone ? { bodyGone: true } : {}) });
    instantDeath = fell.instantDeath;
    defeated = fell.defeated;
  } else if (
    isPlayerCharacter &&
    !wasAtZero &&
    actor.hp.current === 0 &&
    damageToHp > 0 &&
    (relentlessRage(state, actor, definition, damageToHp - hpBefore, deps, events) ||
      relentlessEndurance(actor, definition, damageToHp - hpBefore, events))
  ) {
    // Up at 1 Hit Point: nothing falls.
  } else if (!wasAtZero && actor.hp.current === 0 && damageToHp > 0) {
    const fell = fallToZero(state, actor, definition, damageToHp - hpBefore, deps, events);
    instantDeath = fell.instantDeath;
    defeated = fell.defeated;
  }
  // A Fiend Warlock near the fall, or the one who dealt it, gains Temporary Hit Points.
  if (!wasAtZero && actor.hp.current === 0 && damageToHp > 0 && deps)
    events.push(...blessOnTheKill(state, actor, input.sourceActorId, deps));
  // A hydra's heads and a troll's limbs count the damage of each turn.
  events.push(
    ...tallyTurnDamage(state, actor, definition, parts, totalAdjusted, (cause) => {
      const killed = killOutright(state, actor.id, cause, deps ? { deps } : {});
      defeated ||= killed.length > 0 && !isPlayerCharacter;
      return killed;
    })
  );
  if (input.drain && totalAdjusted > 0) {
    const drained = drainDamage(state, actor, input, { parts, totalAdjusted }, definition, deps, events);
    instantDeath ||= drained.died && isPlayerCharacter;
    defeated ||= drained.died && !isPlayerCharacter;
  }
  // Finger of Death: a Humanoid it kills rises as a Zombie at the start of its caster's next turn.
  if (input.drain?.slainRise && totalAdjusted > 0 && !deadBefore && isDead(actor))
    events.push(...markRising(state, actor, definition, input.drain.slainRise, input.sourceActorId));

  // SRD Concentration: damage while concentrating prompts a CON save, DC max(10, half the damage) capped
  // at 30, in a fight or out of one (a trap between fights). The prompt carries the effects a committed failure
  // ends. Skipped without an id-minter.
  if (totalAdjusted > 0 && actor.hp.current > 0 && deps?.newId) {
    const sustained: Array<{ actorId: string; effectId: string }> = [];
    let markOnly = true;
    for (const bearer of state.actors) {
      for (const effect of bearer.effects) {
        if (!effect.concentration || effect.sourceActorId !== actor.id) continue;
        sustained.push({ actorId: bearer.id, effectId: effect.id });
        markOnly &&= effect.tags.includes(HUNTERS_MARK_TAG);
      }
    }
    // SRD Relentless Hunter (Ranger 13): "Taking damage can't break your Concentration on Hunter's Mark."
    const unbroken = markOnly && holdsFeature(definition, "relentless-hunter", "Relentless Hunter");
    if (sustained.length > 0 && !unbroken && state.combat.pendingSaves.length < 100) {
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

/** Why a dead creature's hit points can't go up. */
export const deadCantHealLine = (name: string) => `${name} is dead and can't regain hit points until revived.`;

/** Healing caps at maximum and never restores temp HP; healing from 0 clears dying and Unconscious (not Prone). The
 *  dead regain nothing (SRD "Dead"): the line says so, and only a revival brings them back. */
export function healActor(state: GameState, actorId: string, amount: number, scope: Initiator): EffectNarration[] {
  const actor = adjustableActor(state, actorId, scope);
  if (isDead(actor)) return [{ kind: "condition", text: deadCantHealLine(actor.name), actorId }];
  // "It can't regain Hit Points until the end of your next turn" (Chill Touch).
  const barred = actor.effects.find((effect) => effect.tags.includes(NO_HEALING_TAG));
  if (barred)
    return [
      {
        kind: "condition",
        text: `${actor.name} can't regain hit points while ${barred.name} lasts.`,
        actorId,
        ...sourceOf(barred)
      }
    ];
  const before = actor.hp.current;
  const wasDying = actor.hp.current <= 0 && actor.deathSaves !== null;
  actor.hp.current = Math.min(actor.hp.maximum, actor.hp.current + amount);
  const events: EffectNarration[] = [];
  if (wasDying && actor.hp.current > 0) {
    actor.deathSaves = null;
    removeConditionDirect(actor, "unconscious");
    events.push({ kind: "condition", text: `${actor.name} regained consciousness.`, actorId });
  }
  events.push(...wakeOnHealing(state, actor, before));
  return events;
}

/** SRD: an Unconscious creature at 0 HP, or one knocked out at 1, stays so "until it regains any Hit Points". */
function wakeOnHealing(state: GameState, actor: Actor, before: number): EffectNarration[] {
  if (actor.hp.current <= before) return [];
  const events = [...endKnockOut(state, actor), ...regainedHitPoints(state, actor)];
  // A Stable creature healed has no more need of its hours to recover.
  for (const effect of actor.effects.filter((candidate) => candidate.tags.includes(STABLE_RECOVERY_TAG)))
    events.push(...endEffect(state, actor.id, effect.id));
  // A troll healed off 0 Hit Points no longer waits on its turn to live or die.
  for (const effect of actor.effects.filter((candidate) => candidate.tags.includes(REGENERATING_AT_ZERO_TAG)))
    events.push(...endEffect(state, actor.id, effect.id));
  // A creature knocked out before the 1-HP rule (at 0, with no dying state) wakes the same way.
  if (
    before <= 0 &&
    actor.deathSaves === null &&
    actor.conditions.some((condition) => condition.id === "unconscious")
  ) {
    if (!actor.effects.some((effect) => effect.linkedConditionIds.includes("unconscious"))) {
      removeConditionDirect(actor, "unconscious");
      events.push({ kind: "condition", text: `${actor.name} regained consciousness.`, actorId: actor.id });
    }
  }
  return events;
}

/** New temporary hit points replace the old ones and don't stack (choosing the higher is left to the table). */
export function setTemporaryHp(state: GameState, actorId: string, amount: number, scope: Initiator) {
  const actor = adjustableActor(state, actorId, scope);
  actor.hp.temporary = amount;
}

/** GM correction: set current HP (clamped), through the same zero-HP transitions. Raising a dead creature's hit
 *  points would revive it, which is Revive's job, so that is refused. */
export function setCurrentHp(state: GameState, actorId: string, current: number, scope: Initiator): EffectNarration[] {
  requireGm(scope, "Only the GM can set hit points directly.");
  const actor = adjustableActor(state, actorId, scope);
  if (current > 0 && isDead(actor))
    throw new CommandRejectedError(`${actor.name} is dead. Revive ${actor.name} to give hit points again.`);
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
      events.push({ kind: "condition", text: `${actor.name} fell Unconscious and is dying.`, actorId });
    }
    // The same transition as damage to 0: what it sustains ends, and so does its Concentration.
    events.push(...endEffectsSustainedBy(state, actor.id));
    events.push(...endConcentrationSustainedBy(state, actor.id));
    events.push(...endConcentrationOnTheDead(state, actor));
  }
  events.push(...wakeOnHealing(state, actor, before));
  return events;
}

/**
 * SRD "Dead": the GM's way back, for a revival the server doesn't cast (a story, a wish). The GM names the hit points
 * it gives, and the creature returns as a revival spell returns it (`returnToLife`).
 */
export function reviveActor(
  state: GameState,
  actorId: string,
  hitPoints: number,
  scope: Initiator,
  deps: Readonly<{
    resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
    catalog?: EquipmentCatalog;
  }>
): EffectNarration[] {
  requireGm(scope, "Only the GM can revive a creature.");
  const actor = adjustableActor(state, actorId, scope);
  if (!isDead(actor)) throw new CommandRejectedError(`${actor.name} isn't dead.`);
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  return returnToLife(actor, hitPoints, { definition, ...(deps.catalog ? { catalog: deps.catalog } : {}) });
}

/** The GM sets a creature's hit point maximum. Current HP never exceeds it. A character's sheet sets the
 *  maximum again when it is rebuilt. */
export function setMaximumHp(state: GameState, actorId: string, maximum: number, scope: Initiator) {
  requireGm(scope, "Only the GM can set hit points directly.");
  const actor = adjustableActor(state, actorId, scope);
  actor.hp.maximum = maximum;
  actor.hp.current = Math.min(actor.hp.current, maximum);
}

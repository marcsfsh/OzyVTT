import {
  aggregateRollMode,
  collectRiders,
  d20Die,
  parseDiceFormula,
  resolveDice,
  sumRiders,
  type AttackKind,
  type RollModeSource
} from "@vtt/rules-5e";
import { toRollModes } from "@vtt/schemas";
import { conditionLabel, exhaustionLevel, exhaustionPenalty, isIncapacitated } from "../condition-rules.js";
import { criticalThreshold } from "../effective-actions.js";
import {
  deriveEquipment,
  weaponPropertiesOf,
  UNARMED_STRIKE_ACTION_ID,
  type EquipmentDerivation
} from "../equipment-derivation.js";
import { naturalFace, recordRoll, type DefinitionAction, type LiveActor, type ResolveContext } from "./context.js";

type RollModeSources = { advantage: RollModeSource[]; disadvantage: RollModeSource[] };

/** Whether this swing is at range. A thrown weapon needs the measured distance; unmeasurable resolves to
 *  ranged, so a mapless table never hands a thrown weapon melee-gated riders or bonuses. */
export function attackUsedAsRanged(
  attack: { reachFeet?: number; rangeFeet?: number },
  distance: number | null
): boolean {
  if (attack.rangeFeet === undefined) return false;
  if (attack.reachFeet === undefined) return true;
  return distance === null || distance > attack.reachFeet + 1e-6;
}

/** melee/ranged/thrown derive from reach and range; reaction/opportunity come from `input.attackKinds`. */
function attackKindsOf(ctx: ResolveContext, distance: number | null): AttackKind[] {
  const { action, input } = ctx;
  const kinds = new Set<AttackKind>(input.attackKinds ?? []);
  const attack = action.attack;
  if (attack) {
    const melee = attack.reachFeet !== undefined;
    const ranged = attack.rangeFeet !== undefined;
    if (attackUsedAsRanged(attack, distance)) kinds.add("ranged");
    else if (melee) kinds.add("melee");
    if (melee && ranged) kinds.add("thrown");
  }
  // Matched by id so a Monk's own strike (which shadows the builtin) still counts as unarmed.
  if (action.id === UNARMED_STRIKE_ACTION_ID) kinds.add("unarmed");
  if (action.activation === "reaction") kinds.add("reaction");
  return [...kinds];
}

/** Conditions that by themselves give an attack advantage or disadvantage (SRD conditions appendix), in
 *  the order the roll card lists them. Frightened applies only while its source is in sight; with no
 *  vision system it applies whenever active, and the GM's explicit roll mode covers the rest. Invisible
 *  (Hide grants it as a linked effect) cuts both ways; seeing through it is GM adjudication. */
const CONDITION_ROLL_MODES: ReadonlyArray<
  Readonly<{ side: "attacker" | "target"; condition: string; mode: "advantage" | "disadvantage" }>
> = [
  { side: "attacker", condition: "prone", mode: "disadvantage" },
  { side: "attacker", condition: "restrained", mode: "disadvantage" },
  { side: "attacker", condition: "poisoned", mode: "disadvantage" },
  { side: "attacker", condition: "blinded", mode: "disadvantage" },
  { side: "attacker", condition: "frightened", mode: "disadvantage" },
  { side: "attacker", condition: "invisible", mode: "advantage" },
  { side: "target", condition: "invisible", mode: "disadvantage" },
  { side: "target", condition: "restrained", mode: "advantage" },
  { side: "target", condition: "blinded", mode: "advantage" },
  { side: "target", condition: "stunned", mode: "advantage" },
  { side: "target", condition: "paralyzed", mode: "advantage" },
  { side: "target", condition: "petrified", mode: "advantage" },
  { side: "target", condition: "unconscious", mode: "advantage" }
];

const has = (actor: LiveActor, id: string) => actor.conditions.some((condition) => condition.id === id);

/** Effect modifiers normalised through `toRollModes`. `onOwnTurn` belongs only to the legacy
 *  `attack-advantage` variant (Reckless Attack semantics); `roll-mode` carries its own `when`. */
function effectClaims(ctx: ResolveContext, target: LiveActor, sources: RollModeSources): void {
  const { state, attacker } = ctx;
  const onOwnTurn = state.combat.turnActorId === attacker.id;
  const activeEffects = (actor: LiveActor) =>
    actor.effects.filter((effect) => !(effect.voidWhileIncapacitated && isIncapacitated(actor)));
  for (const effect of activeEffects(attacker)) {
    for (const modifier of effect.modifiers) {
      if (modifier.type === "attack-advantage" && !onOwnTurn) continue;
      for (const claim of toRollModes(modifier)) {
        if (claim.roll !== "attack") continue;
        sources[claim.mode].push({ source: effect.id, label: effect.name });
      }
    }
  }
  for (const effect of activeEffects(target)) {
    for (const modifier of effect.modifiers) {
      for (const claim of toRollModes(modifier)) {
        if (claim.roll !== "incoming-attack") continue;
        sources[claim.mode].push({ source: effect.id, label: `Target: ${effect.name}` });
      }
    }
  }
}

/** Item and item-granted feat riders at `on-attack-roll`, read whoever's turn it is (opportunity attacks
 *  are off-turn). Standing and momentary passes are disjoint. */
function riderClaims(ctx: ResolveContext, targetDerivation: EquipmentDerivation, sources: RollModeSources): void {
  const { derivation, riderFilters } = ctx;
  for (const pass of [null, "on-attack-roll"] as const) {
    for (const rider of collectRiders(derivation.carriers, { ...derivation.context, ...riderFilters, moment: pass })) {
      if (rider.modifier.type !== "roll-mode" || rider.modifier.roll !== "attack" || rider.modifier.mode === undefined)
        continue;
      sources[rider.modifier.mode].push({ source: `item:${rider.sourceItemId ?? rider.label}`, label: rider.label });
    }
    // The target's own gear (Cloak of Displacement) claims `incoming-attack` against this attack.
    for (const rider of collectRiders(targetDerivation.carriers, { ...targetDerivation.context, moment: pass })) {
      if (
        rider.modifier.type !== "roll-mode" ||
        rider.modifier.roll !== "incoming-attack" ||
        rider.modifier.mode === undefined
      )
        continue;
      sources[rider.modifier.mode].push({
        source: `item:${rider.sourceItemId ?? rider.label}`,
        label: `Target: ${rider.label}`
      });
    }
  }
}

/** Conditions on either side, including the two that depend on who or where: Grappled and a Prone target. */
function conditionClaims(ctx: ResolveContext, target: LiveActor, distance: number | null, sources: RollModeSources) {
  const { attacker } = ctx;
  for (const entry of CONDITION_ROLL_MODES) {
    if (!has(entry.side === "attacker" ? attacker : target, entry.condition)) continue;
    sources[entry.mode].push({
      source: `${entry.side}-${entry.condition}`,
      label: `${entry.side === "attacker" ? "Attacker" : "Target"} is ${conditionLabel(entry.condition)}`
    });
  }
  // Grappled: disadvantage against anyone but the grappler, known only via a source-linked effect; a
  // hand-set Grappled applies against everyone (the GM's rollMode overrides).
  if (has(attacker, "grappled")) {
    const grapplerId =
      attacker.effects.find((effect) => effect.linkedConditionIds.includes("grappled"))?.sourceActorId ?? null;
    if (grapplerId === null)
      sources.disadvantage.push({ source: "attacker-grappled", label: "Attacker is Grappled (grappler unknown)" });
    else if (target.id !== grapplerId)
      sources.disadvantage.push({
        source: "attacker-grappled",
        label: "Attacker is Grappled (target isn't the grappler)"
      });
  }
  // 2024 rule: advantage within 5 feet, disadvantage beyond. Unknown distance contributes nothing.
  if (has(target, "prone") && distance !== null) {
    if (distance <= 5) sources.advantage.push({ source: "target-prone", label: "Target is Prone (within 5 ft)" });
    else sources.disadvantage.push({ source: "target-prone", label: "Target is Prone (beyond 5 ft)" });
  }
}

/** Where the attack is made from: underwater melee, long range, and a ranged shot in close combat. */
function positionClaims(ctx: ResolveContext, distance: number | null, sources: RollModeSources): void {
  const { state, attacker, action, deps } = ctx;
  const attack = action.attack!;
  // SRD Underwater Combat: melee attacks have Disadvantage unless the weapon deals piercing damage
  // (the SRD's weapon list, generalized to its damage type).
  if (state.combat.underwater && attack.reachFeet !== undefined) {
    const piercing = action.damage.some((part) => part.type === "piercing");
    if (!attackUsedAsRanged(attack, distance) && !piercing)
      sources.disadvantage.push({ source: "underwater-melee", label: "Underwater (non-piercing melee)" });
  }
  // Ranged-attack penalties (SRD), only when this shot is actually ranged and distance is measurable.
  if (attack.rangeFeet === undefined || !deps.distanceFeet || !attackUsedAsRanged(attack, distance)) return;
  const normal = attack.rangeNormalFeet;
  if (normal !== undefined && distance !== null && distance > normal + 1e-6) {
    sources.disadvantage.push({ source: "long-range", label: `Long range (beyond ${normal} ft)` });
  }
  // An able enemy within 5 feet spoils the shot; "who can see you" stays GM adjudication.
  const enemyKind =
    attacker.kind === "player-character" ? "monster" : attacker.kind === "monster" ? "player-character" : null;
  if (!enemyKind) return;
  for (const entry of state.combat.initiative) {
    if (entry.actorId === attacker.id) continue;
    const enemy = state.actors.find((candidate) => candidate.id === entry.actorId);
    if (!enemy || enemy.kind !== enemyKind || isIncapacitated(enemy)) continue;
    const enemyDistance = deps.distanceFeet(attacker.id, enemy.id);
    if (enemyDistance !== null && enemyDistance <= 5 + 1e-6) {
      sources.disadvantage.push({ source: "ranged-in-close-combat", label: `Enemy within 5 feet (${enemy.name})` });
      return;
    }
  }
}

/** Advantage/disadvantage sources the engine can see; the explicit GM rollMode choice wins over all of them. */
function attackRollSources(
  ctx: ResolveContext,
  target: LiveActor,
  targetDerivation: EquipmentDerivation,
  distance: number | null
): RollModeSources {
  const sources: RollModeSources = { advantage: [], disadvantage: [] };
  effectClaims(ctx, target, sources);
  riderClaims(ctx, targetDerivation, sources);
  conditionClaims(ctx, target, distance, sources);
  positionClaims(ctx, distance, sources);
  return sources;
}

/** The natural d20 and the total: a hand-entered total is used verbatim (its crit declared, its die
 *  unknown), a supplied natural replaces the roll, otherwise the d20 is rolled. A preview records the
 *  shown die; a confirm reuses it and records nothing new. */
function rollD20(
  ctx: ResolveContext,
  mode: "advantage" | "disadvantage" | "normal",
  bonus: number
): { naturalRoll: number; total: number; declaredCrit: boolean } {
  const { input, deps } = ctx;
  const isPreview = input.commit === false;
  if (input.attackTotal !== undefined) {
    // naturalRoll 0 means "not a rolled die", so no misleading "nat" is shown.
    const total = input.attackTotal;
    const declaredCrit = input.critical === true;
    if (isPreview)
      recordRoll(
        ctx,
        resolveDice(parseDiceFormula(String(total)), () => total),
        "attack"
      );
    return { naturalRoll: declaredCrit ? 20 : 0, total, declaredCrit };
  }
  if (input.attackNatural !== undefined) {
    const naturalRoll = input.attackNatural;
    if (isPreview)
      recordRoll(
        ctx,
        resolveDice(parseDiceFormula(`1d20 ${bonus < 0 ? "-" : "+"} ${Math.abs(bonus)}`), () => naturalRoll),
        "attack"
      );
    return { naturalRoll, total: naturalRoll + bonus, declaredCrit: false };
  }
  const resolution = resolveDice(
    parseDiceFormula(`${d20Die(mode)} ${bonus < 0 ? "-" : "+"} ${Math.abs(bonus)}`),
    deps.random
  );
  recordRoll(ctx, resolution, "attack");
  return { naturalRoll: naturalFace(resolution), total: resolution.total, declaredCrit: false };
}

/** The attack roll against the one target: rider filters, roll mode, bonus, the d20 and the outcome
 *  (2024: a hit on an Unconscious or Paralyzed creature from within 5 feet is a critical hit). */
export function rollAttack(ctx: ResolveContext): void {
  const { attacker, targets, input, deps, derivation, warnings } = ctx;
  const action: DefinitionAction = ctx.action;
  // The spell this action is, on both branches: `spell-id-is` must gate a save spell's riders too.
  const spellFilter = action.spellId === undefined ? {} : { spellId: action.spellId };
  // `damage-type-is` depends only on the action, so a save spell (Burning Hands) must match like an
  // attack spell (Fire Bolt) does.
  const damageTypes = action.damage.map((part) => part.type);
  ctx.riderFilters = { sourceItemId: ctx.riderItemId, damageTypes, ...spellFilter };
  if (!action.attack || targets.length !== 1) return;

  const target = targets[0];
  const distance = deps.distanceFeet?.(attacker.id, target.id) ?? null;
  const targetDerivation = deriveEquipment(
    target,
    target.definitionId ? deps.resolveDefinition?.(target.definitionId) : undefined,
    deps.catalog
  );
  ctx.riderFilters = {
    attackKinds: attackKindsOf(ctx, distance),
    weaponProperties: weaponPropertiesOf(ctx.riderItemId, attacker.inventory),
    damageTypes,
    targetSize: target.size ?? "medium",
    targetConditionIds: target.conditions.map((condition) => condition.id),
    sourceItemId: ctx.riderItemId,
    ...spellFilter
  };
  const sources = attackRollSources(ctx, target, targetDerivation, distance);
  const aggregated = aggregateRollMode(sources.advantage, sources.disadvantage);
  const mode = input.rollMode ?? aggregated.mode;
  ctx.rollMode = input.rollMode
    ? {
        mode: input.rollMode,
        advantage: input.rollMode === "advantage" ? ["GM choice"] : [],
        disadvantage: input.rollMode === "disadvantage" ? ["GM choice"] : []
      }
    : aggregated;
  // A standing `attack-bonus` is already folded into `action.attack.bonus` by `effectiveActions`; only
  // momentary riders are added here. The two sets are disjoint.
  const momentaryAttackBonus = sumRiders(
    collectRiders(derivation.carriers, { ...derivation.context, ...ctx.riderFilters, moment: "on-attack-roll" }),
    "attack-bonus"
  );
  // Exhaustion applies -2 x level to every D20 Test (SRD 5.2.1); explained as a warning line.
  const bonus = action.attack.bonus + exhaustionPenalty(attacker) + momentaryAttackBonus;
  if (exhaustionLevel(attacker) > 0)
    warnings.push(`Exhaustion ${exhaustionLevel(attacker)}: −${2 * exhaustionLevel(attacker)} to the attack roll.`);
  const { naturalRoll, total, declaredCrit } = rollD20(ctx, mode, bonus);
  const manualTotal = input.attackTotal !== undefined;

  // Cover raises the effective AC (SRD Cover: +2 half, +5 three-quarters), shown in the result.
  const targetAc = target.armorClass !== undefined ? target.armorClass + ctx.coverBonus : null;
  // A declared crit (total mode) or a natural roll at or above the threshold crits (a `critical-range`
  // rider can widen it); a nat 1 fumbles only when a natural die is known.
  ctx.crit = declaredCrit || (!manualTotal && naturalRoll >= criticalThreshold(derivation, attacker, action));
  let outcome = ctx.crit
    ? ("crit" as const)
    : !manualTotal && naturalRoll === 1
      ? ("fumble" as const)
      : targetAc === null
        ? ("unknown" as const)
        : total >= targetAc
          ? ("hit" as const)
          : ("miss" as const);
  if (outcome === "hit" && (has(target, "unconscious") || has(target, "paralyzed"))) {
    if ((distance !== null && distance <= 5) || (distance === null && action.attack.reachFeet !== undefined)) {
      outcome = "crit";
      ctx.crit = true;
    }
  }
  ctx.attack = {
    targetId: target.id,
    targetName: target.name,
    total,
    naturalRoll,
    targetAc,
    outcome,
    ...(ctx.coverBonus > 0 ? { coverBonus: ctx.coverBonus } : {})
  };
}

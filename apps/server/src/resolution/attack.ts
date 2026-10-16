import { armorClassInPlay } from "@vtt/domain";
import {
  abilityModifier as scoreModifier,
  aggregateRollMode,
  collectRiders,
  d20TestFormula,
  parseDiceFormula,
  resolveDice,
  sumRiders,
  weaponAbilityFrom,
  type AttackKind
} from "@vtt/rules-5e";
import { conditionLabel, exhaustionLevel, exhaustionPenalty, isIncapacitated } from "../condition-rules.js";
import { criticalThreshold } from "../effective-actions.js";
import {
  deriveEquipment,
  rollModeClaims,
  weaponPropertiesOf,
  type EquipmentDerivation,
  type RollModeClaims
} from "../equipment-derivation.js";
import { UNARMED_STRIKE_ACTION_ID } from "../item-actions.js";
import { VEXED_TAG } from "../weapon-mastery.js";
import { areEnemies } from "../creature-sides.js";
import { statblockFacts, swimSpeedFeet } from "../statblock-facts.js";
import { naturalFace, recordRoll, type DefinitionAction, type LiveActor, type ResolveContext } from "./context.js";

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

/** melee/ranged/thrown derive from reach and range, spell from the spell the action casts; reaction/opportunity
 *  come from `input.attackKinds`. */
function attackKindsOf(ctx: ResolveContext, distance: number | null): AttackKind[] {
  const { action, input, attacker } = ctx;
  const kinds = new Set<AttackKind>(input.attackKinds ?? []);
  const attack = action.attack;
  const unarmed = action.id === UNARMED_STRIKE_ACTION_ID;
  if (attack) {
    const melee = attack.reachFeet !== undefined;
    const ranged = attack.rangeFeet !== undefined;
    if (attackUsedAsRanged(attack, distance)) kinds.add("ranged");
    else if (melee) kinds.add("melee");
    // A Dart is a ranged weapon with Thrown: it has no reach, and is still thrown.
    const thrownWeapon = weaponPropertiesOf(ctx.riderItemId, ctx.attacker.inventory).includes("thrown");
    if ((melee && ranged) || (ranged && thrownWeapon)) kinds.add("thrown");
    if (action.spellId !== undefined) kinds.add("spell");
    // A weapon attack (Improved Critical, Divine Smite): a swing with a carried weapon, or a character's own
    // non-spell attack (an imported sheet lists its Longsword as an action). A monster's Bite is neither.
    const carried =
      ctx.riderItemId !== null && attacker.inventory.some((item) => item.id === ctx.riderItemId && item.weapon);
    if (
      !unarmed &&
      action.spellId === undefined &&
      (action.extraAttack !== undefined || carried || attacker.kind === "player-character")
    )
      kinds.add("weapon");
  }
  // Matched by id so a Monk's own strike (which shadows the builtin) still counts as unarmed.
  if (unarmed) kinds.add("unarmed");
  if (action.activation === "reaction") kinds.add("reaction");
  return [...kinds];
}

/** The ability a weapon or Unarmed Strike attack uses, for riders gated on it (Rage Damage: "an attack using
 *  Strength"). Unknown for a stat block's own attacks, so such riders don't fire there. */
function attackAbilityOf(ctx: ResolveContext): "str" | "dex" | undefined {
  const scores = ctx.deps.definition?.abilityScores;
  if (!scores) return undefined;
  const str = scoreModifier(scores.str);
  const dex = scoreModifier(scores.dex);
  // Martial Arts lets a Monk's strike use Dexterity; the builtin strike is Strength.
  if (ctx.action.id === UNARMED_STRIKE_ACTION_ID)
    return ctx.deps.definition?.character?.martialArts && dex > str ? "dex" : "str";
  const weapon = ctx.attacker.inventory.find((item) => item.id === ctx.riderItemId)?.weapon;
  return weapon ? weaponAbilityFrom(weapon.properties ?? [], weapon.rangeFeet, str, dex) : undefined;
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

/** Riders on both sides at `on-attack-roll`, read whoever's turn it is (opportunity attacks are off-turn): the
 *  attacker's claims on its attack (Reckless Attack, a cursed blade) and the target's on attacks against it
 *  (Dodge, a Cloak of Displacement). */
function riderClaims(ctx: ResolveContext, targetDerivation: EquipmentDerivation, sources: RollModeClaims): void {
  rollModeClaims(ctx.derivation, ["attack"], "on-attack-roll", ctx.riderFilters, sources);
  rollModeClaims(targetDerivation, ["incoming-attack"], "on-attack-roll", {}, sources, "Target: ");
}

/** Conditions on either side, including the two that depend on who or where: Grappled and a Prone target. */
function conditionClaims(ctx: ResolveContext, target: LiveActor, distance: number | null, sources: RollModeClaims) {
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
  // Vex: the attacker's earlier hit marked this creature for their next attack roll (spent by it, `spendVex`).
  if (target.effects.some((effect) => effect.tags.includes(VEXED_TAG) && effect.sourceActorId === attacker.id))
    sources.advantage.push({ source: "vex", label: `Vex (${attacker.name}'s earlier hit)` });
  // 2024 rule: advantage within 5 feet, disadvantage beyond. Unknown distance contributes nothing.
  if (has(target, "prone") && distance !== null) {
    if (distance <= 5) sources.advantage.push({ source: "target-prone", label: "Target is Prone (within 5 ft)" });
    else sources.disadvantage.push({ source: "target-prone", label: "Target is Prone (beyond 5 ft)" });
  }
}

/** Where the attack is made from: underwater, long range, and a ranged shot in close combat. */
function positionClaims(ctx: ResolveContext, distance: number | null, sources: RollModeClaims): void {
  const { state, attacker, action, deps } = ctx;
  const attack = action.attack!;
  const ranged = attackUsedAsRanged(attack, distance);
  // SRD Underwater Combat, for attacks with a weapon (a spell attack is not impeded): a melee attack has
  // Disadvantage unless the creature has a Swim Speed or the weapon deals Piercing damage (the SRD's weapon list,
  // generalized to its damage type); a ranged one has Disadvantage within normal range (beyond it, it misses).
  if (state.combat.underwater && action.spellId === undefined) {
    if (!ranged && attack.reachFeet !== undefined) {
      const piercing = action.damage.some((part) => part.type === "piercing");
      const swimmer = swimSpeedFeet(deps.definition) !== null;
      if (!piercing && !swimmer)
        sources.disadvantage.push({ source: "underwater-melee", label: "Underwater (non-piercing melee)" });
    } else if (ranged) {
      sources.disadvantage.push({ source: "underwater-ranged", label: "Underwater (ranged weapon)" });
    }
  }
  // Ranged-attack penalties (SRD), only when this shot is actually ranged and distance is measurable.
  if (attack.rangeFeet === undefined || !deps.distanceFeet || !ranged) return;
  const normal = attack.rangeNormalFeet;
  if (normal !== undefined && distance !== null && distance > normal + 1e-6) {
    sources.disadvantage.push({ source: "long-range", label: `Long range (beyond ${normal} ft)` });
  }
  // An able enemy within 5 feet spoils the shot; "who can see you" stays GM adjudication. A creature at 0 HP is
  // dead or dying, and an ally is no enemy whatever its kind.
  for (const entry of state.combat.initiative) {
    if (entry.actorId === attacker.id) continue;
    const enemy = state.actors.find((candidate) => candidate.id === entry.actorId);
    if (!enemy || enemy.hp.current <= 0 || isIncapacitated(enemy)) continue;
    if (!areEnemies(attacker, enemy, deps.resolveDefinition)) continue;
    // A creature the players can't see never spoils a visible attacker's shot on its own: the Disadvantage
    // would reveal it. The GM can still impose it.
    if (enemy.visibility !== "public" && attacker.visibility === "public") continue;
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
): RollModeClaims {
  const sources: RollModeClaims = { advantage: [], disadvantage: [] };
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
        resolveDice(parseDiceFormula(d20TestFormula("normal", bonus)), () => naturalRoll),
        "attack"
      );
    return { naturalRoll, total: naturalRoll + bonus, declaredCrit: false };
  }
  const resolution = resolveDice(parseDiceFormula(d20TestFormula(mode, bonus)), deps.random);
  recordRoll(ctx, resolution, "attack");
  return { naturalRoll: naturalFace(resolution), total: resolution.total, declaredCrit: false };
}

/** The attack roll against the one target: rider filters, roll mode, bonus, the d20 and the outcome
 *  (2024: a hit on an Unconscious or Paralyzed creature from within 5 feet is a critical hit). */
export function rollAttack(ctx: ResolveContext): void {
  const { attacker, targets, input, deps, derivation, warnings } = ctx;
  const action: DefinitionAction = ctx.action;
  // The spell this action is, on both branches: the spell filters must gate a save spell's riders too.
  const spell = action.spellId === undefined ? undefined : deps.catalog?.spellRecord?.(action.spellId);
  const spellFilter = {
    ...(action.spellId !== undefined ? { spellId: action.spellId } : {}),
    ...(spell ? { spellSchool: spell.school, spellLevel: spell.level } : {})
  };
  // `damage-type-is` depends only on the action, so a save spell (Burning Hands) must match like an
  // attack spell (Fire Bolt) does.
  const damageTypes = action.damage.map((part) => part.type);
  ctx.riderFilters = { sourceItemId: ctx.riderItemId, damageTypes, ...spellFilter };
  if (!action.attack || targets.length !== 1) return;

  const target = targets[0];
  const distance = deps.distanceFeet?.(attacker.id, target.id) ?? null;
  const targetDefinition = target.definitionId ? deps.resolveDefinition?.(target.definitionId) : undefined;
  const targetDerivation = deriveEquipment(target, targetDefinition, deps.catalog);
  const creatureType = targetDefinition ? statblockFacts(targetDefinition).creatureType : null;
  const ability = attackAbilityOf(ctx);
  ctx.riderFilters = {
    attackKinds: attackKindsOf(ctx, distance),
    ...(ability ? { ability } : {}),
    weaponProperties: weaponPropertiesOf(ctx.riderItemId, attacker.inventory),
    damageTypes,
    targetSize: target.size ?? "medium",
    targetConditionIds: target.conditions.map((condition) => condition.id),
    ...(creatureType !== null ? { targetCreatureType: creatureType } : {}),
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

  // Cover raises the effective AC (SRD Cover: +2 half, +5 three-quarters), and so does a reaction against this
  // attack (Parry); both are shown in the result. A lasting reaction bonus (Shield) is already in `armorClassInPlay`.
  const reactionBonus = input.reactionAcBonus?.amount ?? 0;
  const inPlay = armorClassInPlay(target);
  const targetAc = inPlay !== undefined ? inPlay + ctx.coverBonus + reactionBonus : null;
  // A declared crit (total mode) or a natural roll at or above the threshold crits (a `critical-range`
  // rider can widen it); a nat 1 fumbles only when a natural die is known.
  ctx.crit =
    declaredCrit || (!manualTotal && naturalRoll >= criticalThreshold(derivation, attacker, action, ctx.riderFilters));
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
    ...(ctx.coverBonus > 0 ? { coverBonus: ctx.coverBonus } : {}),
    ...(input.reactionAcBonus ? { reactionAcBonus: { ...input.reactionAcBonus } } : {})
  };
}

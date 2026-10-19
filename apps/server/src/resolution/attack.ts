import { armorClassInPlay } from "@vtt/domain";
import {
  abilityModifier as scoreModifier,
  aggregateRollMode,
  collectRiders,
  d20TestFormula,
  diceRiders,
  keptD20,
  parseDiceFormula,
  resolveDice,
  resolveWithD20s,
  sumRiders,
  weaponAbilityFrom,
  type AttackKind
} from "@vtt/rules-5e";
import { conditionLabel, exhaustionLevel, exhaustionPenalty, isIncapacitated } from "../condition-rules.js";
import { CommandRejectedError } from "../game-store.js";
import {
  heldD20s,
  heldRollFor,
  holdRoll,
  releaseHeldRoll,
  requireTypedReroll,
  spendRerollRight
} from "../held-rolls.js";
import { GM_CHOICE, magicResistanceOf } from "../saving-throws.js";
import { criticalThreshold } from "../effective-actions.js";
import { CONCENTRATING_TAG, endEffect, STEADY_AIM_TAG, UNTIL_IT_ACTS_TAG } from "../effects.js";
import {
  deriveEquipment,
  rollModeClaims,
  weaponPropertiesOf,
  type EquipmentDerivation,
  type RollModeClaims
} from "../equipment-derivation.js";
import { builtinBaseId } from "../builtin-actions.js";
import { UNARMED_STRIKE_ACTION_ID } from "../item-actions.js";
import { VEXED_TAG } from "../weapon-mastery.js";
import { areAllies, areEnemies } from "../creature-sides.js";
import { holdsFeature } from "../class-features.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { statblockFacts, swimSpeedFeet } from "../statblock-facts.js";
import { auraOfAuthority } from "../statblock-traits.js";
import { hitRiderOf } from "./hit-riders.js";
import { wardedConditions } from "../paladin-auras.js";
import { sceneSight } from "../vision/sight.js";
import {
  answeredLines,
  answersOffered,
  applyRollAnswer,
  withAnswers,
  type AnswerDeps,
  type AnswerTarget
} from "../roll-answers.js";
import {
  endedEffect,
  naturalFace,
  recordRoll,
  tableLineOf,
  type DefinitionAction,
  type LiveActor,
  type ResolveContext
} from "./context.js";

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

/** melee/ranged/thrown derive from reach and range, spell from the spell the action casts, weapon from a carried
 *  weapon or a character's own non-spell attack, and melee-weapon/ranged-weapon from a weapon attack made in melee or
 *  at range; reaction/opportunity come from `input.attackKinds`. */
function attackKindsOf(ctx: ResolveContext, distance: number | null): AttackKind[] {
  const { action, input, attacker } = ctx;
  const kinds = new Set<AttackKind>(input.attackKinds ?? []);
  const attack = action.attack;
  // Matched by id so a Monk's own strike (which shadows the builtin) and a Bonus Action strike count as unarmed.
  const unarmed = builtinBaseId(action.id) === UNARMED_STRIKE_ACTION_ID;
  if (attack) {
    const melee = attack.reachFeet !== undefined;
    const ranged = attack.rangeFeet !== undefined;
    const used = attackUsedAsRanged(attack, distance) ? "ranged" : melee ? "melee" : null;
    if (used) kinds.add(used);
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
    ) {
      kinds.add("weapon");
      // A melee spell attack is melee but no weapon's (Radiant Strikes).
      if (used) kinds.add(used === "melee" ? "melee-weapon" : "ranged-weapon");
    }
  }
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
  if (builtinBaseId(ctx.action.id) === UNARMED_STRIKE_ACTION_ID)
    return ctx.deps.definition?.character?.martialArts && dex > str ? "dex" : "str";
  const weapon = ctx.attacker.inventory.find((item) => item.id === ctx.riderItemId)?.weapon;
  return weapon ? weaponAbilityFrom(weapon.properties ?? [], weapon.rangeFeet, str, dex) : undefined;
}

/** Conditions that by themselves give an attack advantage or disadvantage (SRD conditions appendix), in
 *  the order the roll card lists them. Frightened applies only while its source is in sight; it applies whenever
 *  active, and the GM's explicit roll mode covers the rest. Invisible (Hide grants it as a linked effect) cuts both
 *  ways; with dynamic vision on, who sees through it is decided by `sightClaims`, else by the GM. */
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
/** Whether a creature's token stands on the map, so sight can say what it sees. */
const placedOnMap = (state: ResolveContext["state"], actorId: string) =>
  state.combat.tokens.some((token) => token.actorId === actorId && token.position !== null);

/** Faerie Fire's outline: a creature carrying it can't benefit from the Invisible condition. */
export const OUTLINED_TAG = "outlined";
/** An effect that lasts until the next attack roll against its bearer, whoever makes it (Guiding Bolt's light). */
export const UNTIL_ATTACKED_TAG = "until-attacked";
/** An effect that lasts until its bearer's own next attack roll (Vicious Mockery's Disadvantage). */
export const UNTIL_OWN_ATTACK_TAG = "until-own-attack";
/** The Help action's mark on the distracted enemy: the next attack roll against it by an ally of the helper. */
export const DISTRACTED_TAG = "distracted";

/** The Help the attacker's side put on this target, if any: one of its allies distracted it (SRD Help: "giving
 *  Advantage to the next attack roll by one of your allies against that enemy"). The helper gets nothing from it. */
function distractionOf(ctx: ResolveContext, target: LiveActor) {
  return target.effects.find((effect) => {
    if (!effect.tags.includes(DISTRACTED_TAG) || effect.sourceActorId === null) return false;
    if (effect.sourceActorId === ctx.attacker.id) return false;
    const helper = ctx.state.actors.find((actor) => actor.id === effect.sourceActorId);
    return helper !== undefined && areAllies(ctx.attacker, helper, ctx.deps.resolveDefinition);
  });
}
const outlined = (actor: LiveActor) => actor.effects.some((effect) => effect.tags.includes(OUTLINED_TAG));

/** Riders on both sides at `on-attack-roll`, read whoever's turn it is (opportunity attacks are off-turn): the
 *  attacker's claims on its attack (Reckless Attack, a cursed blade) and the target's on attacks against it
 *  (Dodge, Blur). The target's riders see only the attack's kinds (Escape the Horde: "Opportunity Attacks have
 *  Disadvantage against you"); the attacker's other filters describe the attacker. */
function riderClaims(
  ctx: ResolveContext,
  target: LiveActor,
  targetDerivation: EquipmentDerivation,
  sources: RollModeClaims
): void {
  rollModeClaims(ctx.derivation, ["attack"], "on-attack-roll", ctx.riderFilters, sources);
  const kinds = ctx.riderFilters.attackKinds;
  const filters = kinds ? { attackKinds: kinds } : {};
  rollModeClaims(targetDerivation, ["incoming-attack"], "on-attack-roll", filters, sources, "Target: ");
  // What this attacker left on the target against itself alone (Multiattack Defense after its hit), read only for
  // `by-effect-source` riders so nothing counts twice.
  const marks = target.effects
    .filter((effect) => effect.sourceActorId === ctx.attacker.id)
    .map((effect) => ({
      label: effect.name,
      sourceEffectId: effect.id,
      modifiers: effect.modifiers.filter((modifier) => modifier.when?.some((gate) => gate.type === "by-effect-source"))
    }))
    .filter((mark) => mark.modifiers.length > 0);
  if (marks.length > 0)
    rollModeClaims(
      { ...targetDerivation, carriers: marks },
      ["incoming-attack"],
      "on-attack-roll",
      { ...filters, fromEffectSource: true },
      sources,
      "Target: "
    );
}

/** With dynamic vision on, who sees whom (SRD "Unseen Attackers and Targets"): an attack against a target you can't
 *  see has Disadvantage, and one against a creature that can't see you has Advantage. This decides Invisible too,
 *  since the condition gives nothing against a creature that can see you (Blindsight, Truesight). A Blinded side is
 *  left to its own condition line. Returns whether it decided: false while vision is off or a token is off the map. */
function sightClaims(ctx: ResolveContext, target: LiveActor, sources: RollModeClaims): boolean {
  const { attacker, state, deps } = ctx;
  const placed = (actorId: string) =>
    state.combat.tokens.some((token) => token.actorId === actorId && token.position !== null);
  if (!placed(attacker.id) || !placed(target.id)) return false;
  const sight = sceneSight(state, {
    ...(deps.resolveDefinition ? { definition: deps.resolveDefinition } : {}),
    ...(deps.catalog ? { catalog: deps.catalog } : {})
  });
  if (!sight.enabled) return false;
  const invisible = (actor: LiveActor) => has(actor, "invisible") && !outlined(actor);
  if (!has(target, "blinded") && !sight.sees(target.id, attacker.id))
    sources.advantage.push(
      invisible(attacker)
        ? { source: "attacker-invisible", label: "Attacker is Invisible" }
        : { source: "attacker-unseen", label: "Target can't see the attacker" }
    );
  if (!has(attacker, "blinded") && !sight.sees(attacker.id, target.id))
    sources.disadvantage.push(
      invisible(target)
        ? { source: "target-invisible", label: "Target is Invisible" }
        : { source: "target-unseen", label: "Attacker can't see the target" }
    );
  return true;
}

/** Conditions on either side, including the two that depend on who or where: Grappled and a Prone target. */
function conditionClaims(ctx: ResolveContext, target: LiveActor, distance: number | null, sources: RollModeClaims) {
  const { attacker } = ctx;
  // Dynamic vision decides Invisible by who actually sees whom; without it the condition applies as printed.
  const sighted = sightClaims(ctx, target, sources);
  // A Frightened attacker in a Paladin's Aura of Courage: "that condition has no effect on that ally while there".
  const warded = ctx.deps.resolveDefinition
    ? wardedConditions(ctx.state, attacker, {
        resolveDefinition: ctx.deps.resolveDefinition,
        ...(ctx.deps.distanceFeet ? { distanceFeet: ctx.deps.distanceFeet } : {}),
        ...(ctx.deps.catalog ? { catalog: ctx.deps.catalog } : {})
      })
    : [];
  for (const entry of CONDITION_ROLL_MODES) {
    const side = entry.side === "attacker" ? attacker : target;
    if (!has(side, entry.condition)) continue;
    if (entry.side === "attacker" && warded.includes(entry.condition)) continue;
    if (entry.condition === "invisible" && (outlined(side) || sighted)) continue;
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
  // Help: an ally distracted it, for this attack roll alone (spent by it, `spendDistraction`). A helper the table
  // can't see isn't named.
  const distraction = distractionOf(ctx, target);
  if (distraction) {
    const helper = ctx.state.actors.find((actor) => actor.id === distraction.sourceActorId);
    sources.advantage.push({
      source: "help",
      label: helper && !ctx.hiddenFromInitiator(helper.id) ? `Help (${helper.name})` : "Help"
    });
  }
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
  // SRD Ranged Attacks in Close Combat: "a hostile creature within 5 feet of you that can see you and that doesn't
  // have the Incapacitated condition". A creature at 0 HP is dead or dying, and an ally is no enemy whatever its
  // kind. A Blinded enemy can't see the attacker, and with dynamic vision on, neither can one the map says doesn't;
  // with it off, sight stays the GM's call.
  const sight = sceneSight(state, {
    ...(deps.resolveDefinition ? { definition: deps.resolveDefinition } : {}),
    ...(deps.catalog ? { catalog: deps.catalog } : {})
  });
  const seesAttacker = (enemy: LiveActor) =>
    !has(enemy, "blinded") &&
    (!sight.enabled ||
      !placedOnMap(state, enemy.id) ||
      !placedOnMap(state, attacker.id) ||
      sight.sees(enemy.id, attacker.id));
  for (const entry of state.combat.initiative) {
    if (entry.actorId === attacker.id) continue;
    const enemy = state.actors.find((candidate) => candidate.id === entry.actorId);
    if (!enemy || enemy.hp.current <= 0 || isIncapacitated(enemy)) continue;
    if (!areEnemies(attacker, enemy, deps.resolveDefinition)) continue;
    if (!seesAttacker(enemy)) continue;
    // A creature hidden from the table (GM-only, out of every character's sight, or under the fog) never spoils a
    // visible attacker's shot on its own: the Disadvantage would show in the public dice. The GM can still impose it.
    if (ctx.hiddenFromTable(enemy.id) && !ctx.hiddenFromTable(attacker.id)) continue;
    const enemyDistance = deps.distanceFeet(attacker.id, enemy.id);
    if (enemyDistance !== null && enemyDistance <= 5 + 1e-6) {
      sources.disadvantage.push({ source: "ranged-in-close-combat", label: `Enemy within 5 feet (${enemy.name})` });
      return;
    }
  }
}

/** Stat-block traits that give an attack roll Advantage: Bloodied Fury and Frenzy, Blood Frenzy, an ally's Aura of
 *  Authority, and Pack Tactics ("if at least one of the [attacker's] allies is within 5 feet of the creature and the ally
 *  doesn't have the Incapacitated condition"), read from the tokens. Where the map can't measure, the GM's roll mode
 *  decides. */
function traitClaims(ctx: ResolveContext, target: LiveActor, sources: RollModeClaims): void {
  const { state, attacker, deps } = ctx;
  const bloodied = attacker.hp.current > 0 && attacker.hp.current * 2 <= attacker.hp.maximum;
  // SRD Bloodied Fury (boars) and Bloodied Frenzy (the berserker): "While Bloodied, ... Advantage on attack rolls".
  for (const name of ["Bloodied Fury", "Bloodied Frenzy"])
    if (bloodied && holdsFeature(deps.definition, name.toLowerCase().replace(" ", "-"), name))
      sources.advantage.push({ source: "bloodied-fury", label: `${name} (Bloodied)` });
  // SRD Blood Frenzy (the sahuagin): "Advantage on attack rolls against any creature that doesn't have all its Hit
  // Points."
  if (target.hp.current < target.hp.maximum && holdsFeature(deps.definition, "blood-frenzy", "Blood Frenzy"))
    sources.advantage.push({ source: "blood-frenzy", label: "Blood Frenzy (target is hurt)" });
  const authority = auraOfAuthority(state, attacker, deps);
  if (authority) sources.advantage.push(authority);
  if (!deps.distanceFeet || !holdsFeature(deps.definition, "pack-tactics", "Pack Tactics")) return;
  for (const entry of state.combat.initiative) {
    const ally = state.actors.find((candidate) => candidate.id === entry.actorId);
    if (!ally || ally.id === attacker.id || ally.id === target.id) continue;
    if (!areAllies(attacker, ally, deps.resolveDefinition) || ally.hp.current <= 0 || isIncapacitated(ally)) continue;
    // An ally hidden from the table never gives a visible attacker Advantage: the roll would reveal it.
    if (ctx.hiddenFromTable(ally.id) && !ctx.hiddenFromTable(attacker.id)) continue;
    const apart = deps.distanceFeet(ally.id, target.id);
    if (apart !== null && apart <= 5 + DISTANCE_TOLERANCE_FEET) {
      sources.advantage.push({ source: "pack-tactics", label: `Pack Tactics (${ally.name} within 5 ft)` });
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
  riderClaims(ctx, target, targetDerivation, sources);
  conditionClaims(ctx, target, distance, sources);
  positionClaims(ctx, distance, sources);
  traitClaims(ctx, target, sources);
  return sources;
}

/**
 * The natural d20 and the total. The GM's hand-entered total is used verbatim (its crit declared, its die unknown); a
 * supplied natural (a typed die, a parked attack's replay) replaces the roll; otherwise the d20 is thrown. With a
 * `holdKey` the die is held between a preview and its confirm (ADR-0012): a second preview shows the same die, the
 * confirm uses it and records nothing new, and only a reroll throws again (a player's Heroic Inspiration rerolls one
 * die; the GM throws afresh).
 */
function rollD20(
  ctx: ResolveContext,
  mode: "advantage" | "disadvantage" | "normal",
  bonus: number
): { naturalRoll: number; total: number; declaredCrit: boolean } {
  const { input, deps, state } = ctx;
  const isPreview = input.commit === false;
  const key = input.holdKey;
  if (input.attackTotal !== undefined) {
    // naturalRoll 0 means "not a rolled die", so no misleading "nat" is shown; a declared 20 or 1 is that die.
    const total = input.attackTotal;
    const declaredCrit = input.critical === true;
    if (isPreview)
      recordRoll(
        ctx,
        resolveDice(parseDiceFormula(String(total)), () => total),
        "attack"
      );
    return { naturalRoll: declaredCrit ? 20 : input.fumble === true ? 1 : 0, total, declaredCrit };
  }
  const scope =
    deps.initiatorRole === "player"
      ? { role: "player" as const, sessionId: deps.initiatorSessionId ?? "" }
      : { role: "gm" as const };
  if (input.attackNatural !== undefined) {
    const naturalRoll = input.attackNatural;
    const held = key ? heldRollFor(state, key) : undefined;
    // A typed reroll: Heroic Inspiration, then the face the physical reroll shows.
    if (input.reroll) {
      requireTypedReroll(state, scope, held);
      spendRerollRight(ctx.attacker, scope);
    }
    // A typed die is recorded once, when first shown; the confirm of a held one records nothing new.
    const seen = input.reroll !== true && held?.typed === true && held.faces[0] === naturalRoll;
    if (isPreview && !seen)
      recordRoll(
        ctx,
        resolveDice(parseDiceFormula(d20TestFormula("normal", bonus)), () => naturalRoll),
        "attack",
        undefined,
        { typed: input.typedFace === true }
      );
    if (key && isPreview) holdRoll(state, { key, actorId: ctx.attacker.id, faces: [naturalRoll], typed: true });
    if (key && !isPreview) releaseHeldRoll(state, key);
    return { naturalRoll, total: naturalRoll + bonus, declaredCrit: false };
  }
  if (key) {
    const held = heldRollFor(state, key);
    // A typed die stands until a typed reroll replaces it; only the GM may have the server throw over it.
    if (held?.typed && !(input.reroll && scope.role === "gm")) {
      if (input.reroll) throw new CommandRejectedError("Type the die your reroll shows.");
      if (!isPreview) releaseHeldRoll(state, key);
      return { naturalRoll: held.faces[0], total: held.faces[0] + bonus, declaredCrit: false };
    }
    let reroll: "none" | "one" | "all" = "none";
    if (input.reroll) {
      if (!held) throw new CommandRejectedError("Roll the attack first: a reroll throws again a die that was thrown.");
      spendRerollRight(ctx.attacker, scope);
      reroll = scope.role === "gm" ? "all" : "one";
    }
    const { faces, thrown } = heldD20s(held, mode, deps.random, reroll);
    const resolution = resolveWithD20s(d20TestFormula(mode, bonus), faces, deps.random);
    if (thrown) recordRoll(ctx, resolution, "attack");
    if (isPreview) holdRoll(state, { key, actorId: ctx.attacker.id, faces });
    else releaseHeldRoll(state, key);
    return { naturalRoll: keptD20(faces, mode), total: resolution.total, declaredCrit: false };
  }
  const resolution = resolveDice(parseDiceFormula(d20TestFormula(mode, bonus)), deps.random);
  recordRoll(ctx, resolution, "attack");
  return { naturalRoll: naturalFace(resolution), total: resolution.total, declaredCrit: false };
}

type BonusDie = { label: string; dice: string; total: number | null };

/** Dice effects add to the roll (Bless +1d4, Bane -1d4): rolled once the attack is made for real, pending in a
 *  preview, and reused by a parked attack's replay. A typed total already counts them. */
function rollBonusDice(
  ctx: ResolveContext,
  dice: ReadonlyArray<Readonly<{ label: string; dice: string }>>
): BonusDie[] {
  const { input, deps, action, warnings } = ctx;
  if (input.attackBonusDice !== undefined) return input.attackBonusDice.map((entry) => ({ ...entry }));
  if (dice.length === 0) return [];
  if (input.attackTotal !== undefined) {
    const named = dice.map((entry) => `${entry.label} (${entry.dice})`).join(", ");
    warnings.push(`${named}: count ${dice.length === 1 ? "it" : "them"} in the typed total.`);
    return [];
  }
  if (input.commit === false) return dice.map((entry) => ({ ...entry, total: null }));
  return dice.map((entry) => {
    const negative = entry.dice.startsWith("-");
    const rolled = resolveDice(parseDiceFormula(negative ? entry.dice.slice(1) : entry.dice), deps.random);
    recordRoll(ctx, rolled, "attack", `${action.name}: ${entry.label}`);
    return { ...entry, total: negative ? -rolled.total : rolled.total };
  });
}

/** The attack roll against the one target: rider filters, roll mode, bonus, the d20 and the outcome
 *  (2024: a hit on an Unconscious or Paralyzed creature from within 5 feet is a critical hit). */
export function rollAttack(ctx: ResolveContext): void {
  const { state, attacker, targets, input, deps, derivation, warnings } = ctx;
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
  // Only the GM's choice reaches here (a player's is stripped by the command); it wins and is named as the GM's.
  const forced = input.rollMode ?? undefined;
  ctx.forgoneAdvantageBy = forced === undefined ? forgoneFor(ctx, sources) : null;
  const mode = forced ?? (ctx.forgoneAdvantageBy !== null ? "normal" : aggregated.mode);
  if (ctx.forgoneAdvantageBy !== null)
    warnings.push(
      `${ctx.attacker.name} gives up this roll's Advantage for ${ctx.siblings.find((sibling) => sibling.id === ctx.forgoneAdvantageBy)?.name ?? "a declared strike"}.`
    );
  ctx.rollMode =
    forced === undefined
      ? ctx.forgoneAdvantageBy !== null
        ? { mode: "normal", advantage: [], disadvantage: [] }
        : aggregated
      : {
          mode: forced,
          advantage: forced === "advantage" ? [GM_CHOICE] : [],
          disadvantage: forced === "disadvantage" ? [GM_CHOICE] : []
        };
  // A standing `attack-bonus` is already folded into `action.attack.bonus` by `effectiveActions`; only
  // momentary riders are added here. The two sets are disjoint.
  const atRoll = collectRiders(derivation.carriers, {
    ...derivation.context,
    ...ctx.riderFilters,
    moment: "on-attack-roll"
  });
  const momentaryAttackBonus = sumRiders(atRoll, "attack-bonus");
  // Exhaustion applies -2 x level to every D20 Test (SRD 5.2.1); explained as a warning line.
  // Sundering Blow: the next attack roll another creature makes against the target gains +5.
  const sundering = sunderingOf(ctx, target);
  if (sundering) warnings.push(`${sundering.name}: +5 to this attack roll against ${target.name}.`);
  const bonus = action.attack.bonus + exhaustionPenalty(attacker) + momentaryAttackBonus + (sundering ? 5 : 0);
  if (exhaustionLevel(attacker) > 0)
    warnings.push(`Exhaustion ${exhaustionLevel(attacker)}: −${2 * exhaustionLevel(attacker)} to the attack roll.`);
  // What answered this roll on an earlier look (`roll-answers.ts`) counts in this one; a confirm releases the die, so
  // the answers are read first.
  const answeredBefore = input.holdKey ? heldRollFor(state, input.holdKey) : undefined;
  if (input.answer && (input.commit !== false || input.holdKey === undefined || input.reroll === true))
    throw new CommandRejectedError("Answer the attack roll on a look of its own, before you confirm it.");
  if (input.answer && !answeredBefore)
    throw new CommandRejectedError("Roll first: an answer meets a roll that was made.");
  let thrown = rollD20(ctx, mode, bonus);
  // Dice riders are never folded into the bonus, standing or not.
  const standing = collectRiders(derivation.carriers, { ...derivation.context, moment: null });
  const bonusDice = rollBonusDice(ctx, diceRiders([...standing, ...atRoll], "attack-bonus"));
  const diceTotal = bonusDice.reduce((sum, entry) => sum + (entry.total ?? 0), 0);
  const manualTotal = input.attackTotal !== undefined;

  // Cover raises the effective AC (SRD Cover: +2 half, +5 three-quarters), and so does a reaction against this
  // attack (Parry); both are shown in the result. A lasting reaction bonus (Shield) is already in `armorClassInPlay`.
  const reactionBonus = input.reactionAcBonus?.amount ?? 0;
  const inPlay = armorClassInPlay(target);
  const targetAc = inPlay !== undefined ? inPlay + ctx.coverBonus + reactionBonus : null;
  const answersHeld = () =>
    input.commit === false && input.holdKey !== undefined ? heldRollFor(state, input.holdKey) : answeredBefore;
  /** The roll as its die, its bonus and its answers make it, against the target's AC. */
  const judge = () => {
    const read = withAnswers(answersHeld(), thrown.naturalRoll, thrown.total + diceTotal);
    const naturalRoll = read.natural;
    // A declared crit (total mode) or a natural roll at or above the threshold crits (a `critical-range`
    // rider can widen it); a nat 1 fumbles when the die is known or, with a typed total, declared.
    let crit =
      thrown.declaredCrit ||
      (!manualTotal && naturalRoll >= criticalThreshold(derivation, attacker, action, ctx.riderFilters));
    let outcome: "crit" | "fumble" | "unknown" | "hit" | "miss" = crit
      ? "crit"
      : naturalRoll === 1
        ? "fumble"
        : targetAc === null
          ? "unknown"
          : read.total >= targetAc
            ? "hit"
            : "miss";
    // SRD Greater Magic Resistance: "the attack rolls of spells automatically miss it".
    const resisted = action.spellId !== undefined && magicResistanceOf(targetDefinition) === "succeeds";
    if (resisted) {
      outcome = "miss";
      crit = false;
    }
    // Boon of Combat Prowess: "When you miss with an attack roll, you can hit instead."
    if (read.hit && !resisted && (outcome === "miss" || outcome === "fumble")) outcome = "hit";
    if (outcome === "hit" && (has(target, "unconscious") || has(target, "paralyzed"))) {
      if ((distance !== null && distance <= 5) || (distance === null && reachFeet !== undefined)) {
        outcome = "crit";
        crit = true;
      }
    }
    return { naturalRoll, total: read.total, outcome, crit, resisted, read };
  };
  const reachFeet = action.attack.reachFeet;
  let judged = judge();
  const answerTarget = (): AnswerTarget => ({
    kind: "attack",
    roller: attacker,
    key: input.holdKey ?? "",
    natural: judged.naturalRoll,
    total: judged.total,
    // A miss fails and a hit succeeds; an attack with no AC on record is the GM's to judge.
    threshold: judged.outcome === "unknown" ? null : targetAc,
    ...(judged.outcome === "fumble" || judged.resisted
      ? { automatic: "fail" as const }
      : judged.outcome === "crit" || judged.read.hit
        ? { automatic: "succeed" as const }
        : {}),
    mode: ctx.rollMode?.mode ?? mode,
    purpose: "attack",
    label: `${action.name} attack roll`,
    visibility: ctx.rollBase.visibility
  });
  if (input.answer) {
    const events = applyRollAnswer(state, answerTarget(), attacker, input.answer, attackAnswerDeps(ctx));
    for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
    // A reroll answer changed the held die; this look reads it.
    thrown = rollD20(ctx, mode, bonus);
    judged = judge();
  }
  ctx.crit = judged.crit;
  if (judged.resisted && deps.initiatorRole !== "player")
    warnings.push(`${target.name}'s Greater Magic Resistance: spell attack rolls automatically miss it.`);
  const held = answersHeld();
  ctx.attackAnswerBonus = judged.read.bonus;
  ctx.answeredHit = judged.read.hit;
  const answered = answeredLines(held);
  const offered =
    input.commit === false && input.holdKey !== undefined && held !== undefined
      ? answersOffered(state, answerTarget(), attackAnswerDeps(ctx))
      : [];
  ctx.attack = {
    targetId: target.id,
    targetName: target.name,
    total: judged.total,
    naturalRoll: judged.naturalRoll,
    targetAc,
    outcome: judged.outcome,
    ...(ctx.coverBonus > 0 ? { coverBonus: ctx.coverBonus } : {}),
    ...(input.reactionAcBonus ? { reactionAcBonus: { ...input.reactionAcBonus } } : {}),
    ...(bonusDice.length > 0 ? { bonusDice } : {}),
    ...(answered.length > 0 ? { answered } : {}),
    ...(offered.length > 0 ? { answers: offered } : {})
  };
}

/** What an answer to an attack roll needs from the resolve. */
function attackAnswerDeps(ctx: ResolveContext): AnswerDeps {
  const { deps } = ctx;
  return {
    // The attacker's own sheet is the one the resolve holds, read when no other lookup is given.
    resolveDefinition: (id) =>
      deps.resolveDefinition?.(id) ?? (id === ctx.attacker.definitionId ? deps.definition : undefined),
    ...(deps.catalog ? { catalog: deps.catalog } : {}),
    random: deps.random,
    newRollId: deps.newRollId,
    sessionId: ctx.rollBase.initiatorSessionId,
    role: ctx.rollBase.initiatorRole,
    now: deps.now,
    commandId: ctx.input.commandId,
    ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {})
  };
}

/** The attack roll spends the Help it had, hit or miss: Help gives Advantage to one attack roll. */
export function spendDistraction(ctx: ResolveContext): void {
  const { state, attack, targets, effectsEnded } = ctx;
  if (attack === null) return;
  const target = targets[0];
  const distraction = distractionOf(ctx, target);
  if (!distraction) return;
  endEffect(state, target.id, distraction.id);
  effectsEnded.push(endedEffect(target, distraction));
}

/** Sundering Blow on its bearer: the next attack roll made against it by a creature other than its source gains +5. */
export const SUNDERED_TAG = "sundered";

/** The Sundering Blow this attack roll gains, if any: one per roll, and never the source's own. */
function sunderingOf(ctx: ResolveContext, target: LiveActor) {
  return target.effects.find(
    (effect) => effect.tags.includes(SUNDERED_TAG) && effect.sourceActorId !== ctx.attacker.id
  );
}

/** The attack roll that gained a Sundering Blow's +5 spends it, hit or miss. Spent once the attack lands for good, so a
 *  parked attack's replay still counts it. */
export function spendSundering(ctx: ResolveContext): void {
  const { state, attack, targets, effectsEnded, input } = ctx;
  if (attack === null || input.commit === false) return;
  const target = targets[0];
  const sundering = target ? sunderingOf(ctx, target) : undefined;
  if (!target || !sundering) return;
  endEffect(state, target.id, sundering.id);
  effectsEnded.push(endedEffect(target, sundering));
}

/** A declared strike's mark on its bearer (Brutal Strike): the next qualifying attack roll gives up its Advantage. */
export const FORGOES_ADVANTAGE_TAG = "forgoes-advantage";

/** SRD Brutal Strike: "you can forgo any Advantage on one Strength-based attack roll of your choice on your turn. The
 *  chosen attack roll mustn't have Disadvantage." The rider declared before the roll whose hit this roll may carry, or
 *  null. A parked attack's replay says which it was. */
function forgoneFor(ctx: ResolveContext, sources: RollModeClaims): string | null {
  const { attacker, state, input, siblings } = ctx;
  if (input.forgoneAdvantageBy !== undefined) return input.forgoneAdvantageBy;
  if (state.combat.turnActorId !== attacker.id) return null;
  if (sources.advantage.length === 0 || sources.disadvantage.length > 0) return null;
  const kinds = ctx.riderFilters.attackKinds ?? [];
  for (const effect of attacker.effects.filter((candidate) => candidate.tags.includes(FORGOES_ADVANTAGE_TAG))) {
    const declared = siblings.find((sibling) => sibling.id === effect.sourceActionId);
    const rider = declared ? hitRiderOf(declared) : undefined;
    if (!declared || !rider?.declaredBeforeRoll) continue;
    const strength = ctx.riderFilters.ability === "str" && (kinds.includes("weapon") || kinds.includes("unarmed"));
    if (rider.rides === "strength-attack" && !strength) continue;
    return declared.id;
  }
  return null;
}

/** The roll that gave up its Advantage spends the declaration, hit or miss. */
export function spendForgoneDeclaration(ctx: ResolveContext): void {
  const { state, attacker, effectsEnded, input } = ctx;
  if (ctx.forgoneAdvantageBy === null || input.forgoneAdvantageBy !== undefined) return;
  const declaration = attacker.effects.find(
    (effect) => effect.tags.includes(FORGOES_ADVANTAGE_TAG) && effect.sourceActionId === ctx.forgoneAdvantageBy
  );
  if (!declaration) return;
  endEffect(state, attacker.id, declaration.id);
  effectsEnded.push(endedEffect(attacker, declaration));
}

/** Steady Aim gives Advantage on the next attack roll this turn: the roll spends it, hit or miss, while the Speed 0 it
 *  holds lasts until the turn ends. */
export function spendSteadyAim(ctx: ResolveContext): void {
  const { attacker, attack } = ctx;
  if (attack === null) return;
  const aiming = (effect: LiveActor["effects"][number]) =>
    effect.tags.includes(STEADY_AIM_TAG) && effect.modifiers.length > 0;
  if (!attacker.effects.some(aiming)) return;
  attacker.effects = attacker.effects.map((effect) =>
    aiming(effect) ? { ...effect, name: `${effect.name} (Speed 0)`, modifiers: [] } : effect
  );
}

/** The attack roll spends what lasts only until the next attack roll against its bearer (Guiding Bolt's light), hit
 *  or miss. A hit that lays a fresh one does so afterwards. An effect that holds more than that (Stunning Strike's
 *  halved Speed) loses only the Advantage it gave and keeps the rest until its own end. */
export function spendUntilAttacked(ctx: ResolveContext): void {
  const { state, attack, targets, effectsEnded } = ctx;
  if (attack === null) return;
  const target = targets[0];
  for (const effect of target.effects.filter((candidate) => candidate.tags.includes(UNTIL_ATTACKED_TAG))) {
    const rest = effect.tags.filter((tag) => tag !== UNTIL_ATTACKED_TAG);
    if (rest.length > 0) {
      target.effects = target.effects.map((candidate) =>
        candidate.id === effect.id
          ? {
              ...candidate,
              tags: rest,
              modifiers: candidate.modifiers.filter(
                (modifier) => modifier.type !== "roll-mode" || modifier.roll !== "incoming-attack"
              )
            }
          : candidate
      );
      continue;
    }
    endEffect(state, target.id, effect.id);
    effectsEnded.push(endedEffect(target, effect));
  }
}

/** SRD Invisibility: "The spell ends early immediately after the target makes an attack roll, deals damage, or casts a
 *  spell." Read once a resolve is committed; an effect this very resolve granted stays. */
export function spendUntilItActs(ctx: ResolveContext): void {
  const { state, action, attacker, attack, input, damage, effectsEnded } = ctx;
  if (input.commit === false) return;
  const acted = attack !== null || action.spellId !== undefined || action.spellSlot !== undefined || damage.length > 0;
  if (!acted) return;
  for (const effect of attacker.effects.filter(
    (candidate) => candidate.tags.includes(UNTIL_IT_ACTS_TAG) && !candidate.id.startsWith(input.commandId)
  )) {
    endEffect(state, attacker.id, effect.id);
    effectsEnded.push(endedEffect(attacker, effect));
    // Once no creature keeps the spell, it is over, and so is its caster's Concentration on it.
    const { castId, sourceActorId } = effect;
    if (castId === undefined || sourceActorId === null) continue;
    const kept = state.actors.some((actor) =>
      actor.effects.some((other) => other.castId === castId && !other.tags.includes(CONCENTRATING_TAG))
    );
    const caster = state.actors.find((actor) => actor.id === sourceActorId);
    const holding = caster?.effects.find((other) => other.castId === castId && other.tags.includes(CONCENTRATING_TAG));
    if (!kept && caster && holding) {
      endEffect(state, caster.id, holding.id);
      effectsEnded.push(endedEffect(caster, holding));
    }
  }
}

/** The bearer's own attack roll spends what lasts only until it (Vicious Mockery's Disadvantage), hit or miss. */
export function spendUntilOwnAttack(ctx: ResolveContext): void {
  const { state, attack, attacker, effectsEnded } = ctx;
  if (attack === null) return;
  for (const effect of attacker.effects.filter((candidate) => candidate.tags.includes(UNTIL_OWN_ATTACK_TAG))) {
    endEffect(state, attacker.id, effect.id);
    effectsEnded.push(endedEffect(attacker, effect));
  }
}

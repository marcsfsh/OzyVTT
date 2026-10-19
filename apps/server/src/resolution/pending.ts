import type { SpellReference } from "@vtt/content-srd-5.2.1";
import { prismaticSpray } from "./prismatic.js";
import type { PendingReaction, PendingSave } from "@vtt/domain";
import { catalogIdOf, DamageTypeSchema, type ActionReaction, type GrantOption } from "@vtt/schemas";
import { setCondition } from "../actor-conditions.js";
import { holdsFeature } from "../class-features.js";
import { conditionLabel } from "../condition-rules.js";
import { addEffect, ESCAPE_ATHLETICS_TAG, makeEffect, NO_ACTIONS_TAG } from "../effects.js";
import { HAZARDS } from "../hazards.js";
import { offerableReaction, slotChoiceOf } from "../reaction-offers.js";
import { applyFailureEffect, createPendingSaves } from "../saving-throws.js";
import { HIDDEN_SOURCE } from "../hidden-source.js";
import { rollDice } from "@vtt/rules-5e";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { recordRoll, sizeAtMost, tableLineOf, type LiveActor, type ResolveContext } from "./context.js";
import { optionFor, optionParts, withOptionName } from "./grant-extras.js";
import { bestCover, coverBonusOf, coverFor, mapCover } from "../cover.js";
import { smiteOfProtectionCover } from "../paladin-auras.js";
import { damagePartsOf, potentCantrip } from "./damage.js";
import { spellOf, spellSaveDuration } from "./concentration.js";
import { endedByAt, repeatSaveOf } from "../save-stages.js";
import { areEnemies } from "../creature-sides.js";
import { AURA_IMMUNE_TAG, traitActionId } from "../statblock-traits.js";
import { creatureTypeOf } from "../statblock-facts.js";
import { openDamageWindow, type DamageWindowDeps } from "../damage-window.js";
import { answerKeyOf, answersFromOthers, askAnswer } from "../roll-answers.js";
import { heightenedTarget, shieldedFromSave } from "./metamagic.js";
import { effectNameOf } from "../effect-names.js";
import { fatalFailureOf } from "../fatal-saves.js";
import { sightRules } from "../vision/rules.js";
import { sceneSight } from "../vision/sight.js";
import { areAllies } from "../creature-sides.js";
import { chosenEffectOption } from "./effect-options.js";
import { failureFormOf } from "./shape-shift.js";

type AcBonusReaction = Extract<ActionReaction, { response: "ac-bonus" }>;

/** What the damage window needs from a resolve. */
function windowDeps(ctx: ResolveContext): DamageWindowDeps {
  const { deps } = ctx;
  return {
    resolveDefinition: deps.resolveDefinition ?? (() => undefined),
    ...(deps.catalog ? { catalog: deps.catalog } : {}),
    random: deps.random,
    newId: deps.newRollId,
    now: deps.now,
    sessionId: ctx.rollBase.initiatorSessionId,
    role: ctx.rollBase.initiatorRole,
    commandId: ctx.input.commandId,
    ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {})
  };
}

/**
 * A hit's damage waits while the creatures who may act on it answer (`damage-window.ts`): another creature's answer
 * to the damage roll (Cutting Words), then the target's own reaction (Uncanny Dodge halves it, Deflect Attacks takes a
 * rolled amount off, Superior Hunter's Defense resists its type). The first prompt holds the damage, and each answer
 * passes it on until it lands (see reactions.ts). The reaction window follows the economy family, so freeform
 * movement does not silence it.
 */
export function parkReaction(ctx: ResolveContext): void {
  const { state, attack, attacker, targets, deps } = ctx;
  if (attack === null || (attack.outcome !== "crit" && attack.outcome !== "hit") || !deps.resolveDefinition) return;
  const target = targets[0];
  if (target.id === attacker.id) return;
  const parts = damagePartsOf(ctx);
  const opened = openDamageWindow(
    state,
    {
      source: attacker,
      sourceName: attacker.name,
      target,
      parts,
      critical: ctx.crit,
      hit: true,
      hitKinds: ctx.riderFilters.attackKinds ?? [],
      ...(ctx.action.drain ? { drain: ctx.action.drain } : {}),
      asked: []
    },
    windowDeps(ctx)
  );
  if (!opened) return;
  if (opened.line) ctx.tableNarration.push(tableLineOf(ctx, opened.line));
  const reactor = state.actors.find((actor) => actor.id === opened.prompt.actorId)!;
  ctx.reactionPrompts.push({
    actorId: reactor.id,
    actorName: reactor.name,
    actionName: opened.prompt.actionName,
    holdsDamage: true
  });
}

/** The attack a prompt holds at its roll, to be finished by its answer with the same die and dice. What answers
 *  added to the roll (a Bardic Inspiration die) rides as one of its dice, since the replay holds no die to read. */
function parkedAttackOf(ctx: ResolveContext, untilNextTurn: boolean): NonNullable<PendingReaction["parkedAttack"]> {
  const { attack, attacker, input, deps } = ctx;
  const target = ctx.targets[0];
  const cover = input.cover === "half" || input.cover === "three-quarters" ? input.cover : null;
  return {
    actionId: ctx.action.id,
    builtin: input.builtin === true,
    attackNatural: input.attackTotal === undefined ? attack!.naturalRoll : null,
    attackTotal: input.attackTotal ?? null,
    cover,
    conditionId: input.conditionId ?? null,
    attackKinds: (input.attackKinds ?? []).filter(
      (kind): kind is "reaction" | "opportunity" => kind === "reaction" || kind === "opportunity"
    ),
    pushFeet: input.pushFeet ?? null,
    slotLevel: ctx.plan.castLevel,
    damageType: input.damageType ?? null,
    bonusDice: [
      ...(attack!.bonusDice ?? []).flatMap((entry) =>
        entry.total === null ? [] : [{ label: entry.label, dice: entry.dice, total: entry.total }]
      ),
      ...(ctx.attackAnswerBonus
        ? [
            {
              label: ((attack!.answered ?? []).map((line) => line.name).join(", ") || "Answers").slice(0, 120),
              dice: "",
              total: Math.max(-48, Math.min(48, ctx.attackAnswerBonus))
            }
          ]
        : [])
    ],
    distanceFeet: deps.distanceFeet?.(attacker.id, target.id) ?? null,
    initiatorRole: deps.initiatorRole ?? "gm",
    initiatorSessionId: deps.initiatorSessionId ?? deps.gmSessionId,
    untilNextTurn,
    // The extras chosen for the hit ride the replay, spent only if it still hits.
    hitOptions: (input.hitOptions ?? []).map(({ effects, ...choice }) => ({
      ...choice,
      ...(effects ? { effects: [...effects] } : {})
    })),
    // A roll that forwent its Advantage for Brutal Strike still offers its hit when it lands.
    ...(ctx.forgoneAdvantageBy !== null ? { forgoneAdvantageBy: ctx.forgoneAdvantageBy } : {}),
    ...(input.knockOut === true ? { knockOut: true as const } : {}),
    // A shaped spell's attack lands shaped (Transmuted Spell's type, Empowered Spell's dice).
    ...(input.shaping && input.shaping.length > 0 ? { shaping: input.shaping.map((entry) => ({ ...entry })) } : {})
  };
}

/**
 * An attack roll another creature may answer stops at its roll (Cutting Words on a hit, Improve Fate): that creature
 * is prompted, one at a time in turn order, and the answer finishes the attack with the same die and the answer's die
 * added (see reactions.ts). An attack an answer made hit (Boon of Combat Prowess) is past answering. True when the
 * attack was parked: the caller spends its economy and stops there.
 */
export function parkForRollAnswer(ctx: ResolveContext): boolean {
  const { state, attack, attacker, targets, input, deps } = ctx;
  if (attack === null || input.commit === false || !state.combat.active || ctx.answeredHit === true) return false;
  const target = targets[0];
  const asked = input.answersAsked ?? [];
  const next = answersFromOthers(
    state,
    {
      kind: "attack",
      roller: attacker,
      key: input.holdKey ?? `attack:${attacker.id}`,
      natural: attack.naturalRoll,
      total: attack.total,
      threshold: attack.outcome === "unknown" ? null : attack.targetAc,
      ...(attack.outcome === "fumble" ? { automatic: "fail" as const } : {}),
      ...(attack.outcome === "crit" ? { automatic: "succeed" as const } : {}),
      mode: ctx.rollMode?.mode ?? "normal",
      purpose: "attack",
      label: `${ctx.action.name} attack roll`,
      visibility: ctx.rollBase.visibility
    },
    {
      resolveDefinition: deps.resolveDefinition ?? (() => undefined),
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      random: deps.random,
      newRollId: deps.newRollId,
      sessionId: ctx.rollBase.initiatorSessionId,
      role: ctx.rollBase.initiatorRole,
      now: deps.now,
      commandId: input.commandId,
      ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {})
    },
    new Set(asked)
  )[0];
  if (!next) return false;
  const line = askAnswer(
    state,
    next,
    {
      rollKind: "attack",
      roller: attacker,
      targetActorId: target.id,
      parkedAttack: parkedAttackOf(ctx, false),
      asked: [...asked, answerKeyOf(next)]
    },
    { newId: deps.newRollId, now: deps.now, commandId: input.commandId }
  );
  ctx.tableNarration.push(tableLineOf(ctx, line));
  ctx.reactionPrompts.push({ actorId: next.bearer.id, actorName: next.bearer.name, actionName: next.offer.name });
  return true;
}

/**
 * An attack that would hit a target holding an AC reaction (Parry, Shield) stops at the roll: the target is prompted,
 * and the answer finishes the attack with the same die, against the raised AC if the reaction was used (see
 * reactions.ts). Offered only when the bonus would turn the hit into a miss; a critical hit lands whatever the AC.
 * True when the attack was parked: the caller spends its economy and stops there.
 */
export function parkForAcReaction(ctx: ResolveContext): boolean {
  const { state, attack, attacker, targets, input, deps } = ctx;
  if (
    attack === null ||
    attack.outcome !== "hit" ||
    attack.targetAc === null ||
    input.acSettled === true ||
    !deps.resolveDefinition ||
    // An attack an answer made hit hits whatever the AC (Boon of Combat Prowess).
    ctx.answeredHit === true
  )
    return false;
  const target = targets[0];
  if (target.id === attacker.id) return false;
  const targetAc = attack.targetAc;
  const melee = ctx.riderFilters.attackKinds?.includes("melee") === true;
  const offer = offerableReaction(
    state,
    target,
    (reaction): reaction is AcBonusReaction =>
      reaction.response === "ac-bonus" &&
      (reaction.melee !== true || melee) &&
      attack.total < targetAc + reaction.amount,
    { resolveDefinition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) }
  );
  if (!offer) return false;
  state.combat = {
    ...state.combat,
    pendingReactions: [
      ...state.combat.pendingReactions,
      {
        id: deps.newRollId(),
        kind: "attack-would-hit" as const,
        actorId: target.id,
        actionId: offer.action.id,
        actionName: offer.action.name,
        sourceActorId: attacker.id,
        sourceName: attacker.name,
        targetActorId: null,
        triggerCommandId: input.commandId,
        proposedDamage: 0,
        proposedDamageParts: [],
        critical: false,
        weighed: null,
        acBonus: offer.reaction.amount,
        rollsAttack: false,
        attackTotal: attack.total,
        parkedAttack: parkedAttackOf(ctx, offer.reaction.untilNextTurn === true),
        ...slotChoiceOf(target, offer.action),
        // The roll's answers were asked before this; the finish doesn't ask them again.
        ...(input.answersAsked ? { asked: [...input.answersAsked] } : {}),
        createdAt: Date.parse(deps.now())
      }
    ]
  };
  ctx.reactionPrompts.push({ actorId: target.id, actorName: target.name, actionName: offer.action.name });
  return true;
}

/** What the magic test reads: the action, its user, the item it rides, and the catalog. */
type MagicalSource = Pick<ResolveContext, "action" | "attacker" | "riderItemId"> &
  Readonly<{ deps: Pick<ResolveContext["deps"], "catalog"> }>;

/** A spell's save, or a magic item's (a wand's), is one against magic: Magic Resistance meets it with Advantage. */
export function isMagicalAction(ctx: MagicalSource): boolean {
  if (ctx.action.spellId !== undefined) return true;
  const item = ctx.riderItemId === null ? undefined : ctx.attacker.inventory.find((row) => row.id === ctx.riderItemId);
  return item !== undefined && ctx.deps.catalog?.equipmentRecord(catalogIdOf(item))?.isMagic === true;
}

/** Conditions a failed save leaves on their own, outside its effect: Prone ends by standing up, and
 *  Exhaustion stacks and leaves with rests. */
const BARE_FAILURE_CONDITIONS: ReadonlySet<string> = new Set(["prone", "exhaustion"]);

/** SRD restraints a creature escapes with an action and a Strength (Athletics) check against the spell save DC
 *  (Entangle, Web, Black Tentacles, Ensnaring Strike): the restraint carries the DC, and escaping takes Athletics
 *  alone. */
const ATHLETICS_ESCAPES: ReadonlySet<string> = new Set(["entangle", "web", "black-tentacles", "ensnaring-strike"]);
/** SRD Stinking Cloud: "While Poisoned in this way, the creature can't take an action or a Bonus Action." */
const NO_ACTIONS_FAILURES: ReadonlySet<string> = new Set(["stinking-cloud"]);

/** The spell an effect comes from and the level it was cast at, which sets the effect's duration and is what Dispel
 *  Magic weighs. */
export type SpellCast = Readonly<{ spell: SpellReference; level: number }>;

/** The spell a resolve casts, at the level it casts it. */
export function spellCastOf(ctx: ResolveContext): SpellCast | undefined {
  const spell = spellOf(ctx);
  return spell ? { spell, level: ctx.plan.castLevel ?? spell.level } : undefined;
}

/**
 * What a failed save puts on its target, as one source-linked effect (SRD: each condition ends by its own rules):
 * the conditions with their printed duration (else, from a spell, the spell's duration at its level), the save repeated
 * at the end of each of the target's turns, a grapple's escape DC and range, ending on damage, the damage it deals at
 * the start of each turn, and the Concentration the cast is sustained by, what the action declares a failure leaves
 * besides (Bane's -1d4), and the hazard it starts (Alchemist's Fire's burning). Charmed's "can't attack the charmer" and
 * Grappled's "except the grappler" read the source from it. Undefined when every condition stays bare and the action
 * declares nothing more.
 */
export function failureEffectFor(
  ctx: MagicalSource & Pick<ResolveContext, "castId">,
  conditionIds: readonly string[],
  cast?: SpellCast,
  option: GrantOption | null = null,
  /** What this use adds: the form a failure takes (Polymorph's Beast), and the effect it picked among the action's
   *  options (Enlarge or Reduce) in place of its declared one. */
  shaped: Readonly<{
    form?: NonNullable<PendingSave["onFailEffect"]>["form"];
    tags?: readonly string[];
    name?: string;
    declared?: NonNullable<NonNullable<ResolveContext["action"]["save"]>["failureEffect"]>;
  }> = {}
): PendingSave["onFailEffect"] {
  const { action, attacker, castId } = ctx;
  const save = action.save;
  if (!save) return undefined;
  // The pick the caster made for this target adds its part (Eyebite's Asleep: Unconscious, ending on damage).
  const parts = optionParts(option);
  const linked = [...new Set([...conditionIds, ...parts.conditions])]
    .filter((id) => !BARE_FAILURE_CONDITIONS.has(id))
    .slice(0, 4);
  // What the failure leaves besides conditions (Bane's -1d4, Faerie Fire's outline), declared by the action.
  const declared = shaped.declared ?? save.failureEffect;
  const endAction = declared?.endAction;
  // Alchemist's Fire sets its target burning, Oil covers it: an effect of its own, or riding the conditions.
  const hazard = save.failureHazard ? HAZARDS[save.failureHazard] : undefined;
  if (linked.length === 0 && !declared && !hazard && !shaped.form) return undefined;
  const grapple = linked.includes("grappled");
  const athletics =
    (action.spellId !== undefined && ATHLETICS_ESCAPES.has(action.spellId) && linked.includes("restrained")) ||
    (save.escapeAthletics === true && !grapple);
  const duration =
    save.failureDuration ??
    declared?.duration ??
    hazard?.duration ??
    (cast ? spellSaveDuration(cast.spell, cast.level) : undefined);
  const ongoingDamage = save.ongoingDamage ?? hazard?.ongoingDamage;
  // When the target repeats the save, and what a failed repeat does (a basilisk's second failure Petrifies).
  // "On a failed save, it takes the Psychic damage again" (Phantasmal Killer): the cast's own damage, at its level.
  const again = save.repeatDamageAgain
    ? action.damage.flatMap((part) =>
        /d/.test(part.formula) && DamageTypeSchema.safeParse(part.type).success
          ? [{ formula: part.formula, type: DamageTypeSchema.parse(part.type) }]
          : []
      )
    : undefined;
  const repeat = repeatSaveOf(
    save,
    (conditionId) => `${conditionLabel(conditionId)} by ${attacker.name} (${action.name})`,
    again
  );
  return {
    name: withOptionName(
      shaped.name ??
        declared?.name ??
        (linked.length > 0
          ? `${conditionLabel(linked[0]!)} by ${attacker.name} (${effectNameOf(action.name)})`
          : hazard!.name),
      option
    ),
    tags: [
      ...new Set([
        ...(grapple ? ["grapple"] : []),
        ...(athletics ? [ESCAPE_ATHLETICS_TAG] : []),
        ...(action.spellId !== undefined && NO_ACTIONS_FAILURES.has(action.spellId) ? [NO_ACTIONS_TAG] : []),
        ...(declared?.tags ?? []),
        ...(shaped.tags ?? []),
        ...parts.tags,
        ...(hazard ? [hazard.tag] : [])
      ])
    ].slice(0, 8),
    ...(shaped.form ? { form: structuredClone(shaped.form) } : {}),
    ...(declared?.sizeChange ? { sizeChange: { ...declared.sizeChange } } : {}),
    modifiers: [...(declared?.modifiers ?? []), ...parts.modifiers],
    ...(option ? { optionId: option.id } : {}),
    ...(parts.conditionImmunities.length > 0 ? { conditionImmunities: [...parts.conditionImmunities] } : {}),
    ...(parts.suppresses.length > 0 ? { suppressesConditions: [...parts.suppresses] } : {}),
    // Irresistible Dance: the action its bearer may take to end it, at the spell save DC.
    ...(endAction ? { endAction: { ...endAction, dc: endAction.dc === "spellcasting" ? save.dc : endAction.dc } } : {}),
    ...(declared?.armorClassBonus !== undefined ? { armorClassBonus: declared.armorClassBonus } : {}),
    ...(declared?.light ? { light: { ...declared.light } } : {}),
    linkedConditionIds: linked,
    // An escape DC the text doesn't print is the grapple's own DC, as the 2024 rules set it; a spell's restraint is
    // escaped against the spell save DC.
    // A restraint that prints its own escape DC (a Net's 10) is escaped against that.
    escapeDc: grapple || athletics ? (save.escapeDc ?? save.dc) : (save.escapeDc ?? null),
    sourceActorId: attacker.id,
    sourceName: attacker.name,
    ...(duration ? { duration } : {}),
    ...(repeat ? { repeatSave: repeat } : {}),
    ...(save.endsOnDamage || option?.endsOnDamage ? { endsOnDamage: true } : {}),
    ...(save.endsOnSourceSideDamage ? { endsOnSourceSideDamage: true as const } : {}),
    ...(declared?.endsOnSpellHealing ? { endsOnSpellHealing: true as const } : {}),
    ...(save.speedZero || declared?.speedZero || option?.speedZero ? { speedZero: true } : {}),
    ...(save.endsOutOfSight ? { endsOutOfSight: true as const } : {}),
    // The action that ends it: waking a sleeper, stanching a wound, studying an illusion.
    ...(save.endedBy ? { endedBy: endedByAt(save.endedBy, save.dc) } : {}),
    // What it does as its bearer rests or days pass (a death dog's poison).
    ...(save.atRest ? { atRest: structuredClone(save.atRest) } : {}),
    ...(grapple ? { endsWhenSourceDefeated: true, rangeFeet: save.rangeFeet ?? action.attack?.reachFeet ?? 5 } : {}),
    // "Until the aboleth dies".
    ...(save.endsWhenSourceDies && !grapple ? { endsWhenSourceDefeated: true } : {}),
    ...(ongoingDamage ? { ongoingDamage } : {}),
    ...(castId !== null ? { castId } : {}),
    ...(cast ? { spell: { id: cast.spell.id, level: cast.level } } : {}),
    ...(isMagicalAction(ctx) ? { magical: true as const } : {}),
    sourceActionId: action.id
  };
}

/** What a successful save leaves on its target instead, as the action declares it (Stunning Strike: the target's Speed
 *  halved and the next attack roll against it with Advantage, until the start of the Monk's next turn). */
export function successEffectFor(
  ctx: MagicalSource & Pick<ResolveContext, "castId">,
  cast?: SpellCast
): PendingSave["onSuccessEffect"] {
  const { action, attacker, castId } = ctx;
  const declared = action.save?.successEffect;
  if (!declared) return undefined;
  return {
    name: declared.name,
    tags: [...declared.tags],
    modifiers: [...declared.modifiers],
    ...(declared.armorClassBonus !== undefined ? { armorClassBonus: declared.armorClassBonus } : {}),
    ...(declared.speedZero ? { speedZero: true } : {}),
    linkedConditionIds: [],
    escapeDc: null,
    sourceActorId: attacker.id,
    sourceName: attacker.name,
    ...(declared.duration ? { duration: declared.duration } : {}),
    ...(castId !== null ? { castId } : {}),
    ...(cast ? { spell: { id: cast.spell.id, level: cast.level } } : {}),
    ...(isMagicalAction(ctx) ? { magical: true as const } : {}),
    sourceActionId: action.id
  };
}

/** The conditions a failure's pick sets on their own, outside its effect (Command's Grovel: Prone). */
const barePicks = (option: GrantOption | null): string[] =>
  (option?.conditions ?? []).filter((id) => BARE_FAILURE_CONDITIONS.has(id));

/** SRD Power Word Stun: a target over its hit-point gate isn't Stunned. Instead, "Otherwise, its Speed is 0 until the start
 *  of your next turn". */
const SPEED_ZERO_OVER_THE_GATE: ReadonlySet<string> = new Set(["power-word-stun"]);

/**
 * A save action parks one pending save per target; the outcome auto-applies (see saving-throws.ts). When the
 * action also attacks, the save is the hit's rider (a ghoul's paralysing claw): it is owed only on a hit, and
 * the damage already rode the hit, so the save proposes none of its own. A save that a low enough target fails
 * outright (Power Word Stun) lands at once, and only its repeated save can end it.
 */
/** The targets a save reaches: all of them, or with `sight.seenBy` only those that can see the user (a gaze) or a
 *  point of its area where they stand (Hypnotic Pattern). With dynamic vision off, a Blinded creature sees neither. */
function seeingTargets(ctx: ResolveContext, targets: ResolveContext["targets"]): ResolveContext["targets"] {
  const { state, action, attacker, deps } = ctx;
  const seenBy = (action.sight ?? spellOf(ctx)?.sight)?.seenBy;
  if (!seenBy) return targets;
  const content = {
    ...(deps.resolveDefinition ? { definition: deps.resolveDefinition } : {}),
    ...(deps.catalog ? { catalog: deps.catalog } : {})
  };
  const rules = sightRules(state, content, deps.distanceFeet);
  const sight = sceneSight(state, content);
  return targets.filter((target) => {
    const sees =
      seenBy === "user"
        ? rules.canSee(target.id, attacker.id)
        : rules.visionOn && sight.positionOf(target.id) !== null
          ? sight.seesPoint(target.id, sight.positionOf(target.id)!)
          : !target.conditions.some((condition) => condition.id === "blinded");
    if (!sees)
      ctx.warnings.push(
        `${target.name} can't see ${seenBy === "user" ? attacker.name : "it"}, so ${action.name} doesn't affect it.`
      );
    return sees;
  });
}

export function parkActionSave(ctx: ResolveContext): void {
  const { state, action, attacker, input, deps, attack } = ctx;
  if (!action.save) return;
  const rider = attack !== null;
  if (rider && attack.outcome !== "hit" && attack.outcome !== "crit") return;
  // The GM's explicit choice wins over the condition the action declares.
  // SRD Contact Patron: "you can cast the spell without expending a spell slot to contact your patron, and you
  // automatically succeed on the spell's saving throw."
  if (
    action.save.bySelf &&
    action.spellId === "contact-other-plane" &&
    action.id.endsWith("-free") &&
    holdsFeature(deps.definition, "contact-patron", "Contact Patron")
  ) {
    ctx.warnings.push(`Contact Patron: ${attacker.name} succeeds on the Intelligence saving throw.`);
    return;
  }
  // Exhaustion stacks, a level per entry (Weight of Years: "The target gains 1 Exhaustion level").
  const conditionIds = [
    ...(input.conditionId ? [input.conditionId] : action.save.failureConditions),
    ...Array.from({ length: action.save.failureExhaustion ?? 0 }, () => "exhaustion")
  ].slice(0, 4);
  const cast = spellCastOf(ctx);
  // The caster's pick of what the failure does (Bestow Curse's curse), one for each target where the text says so.
  const offered = action.save.failureEffect?.options
    ? { options: action.save.failureEffect.options, perTarget: action.save.failureEffect.optionsPerTarget === true }
    : null;
  // Asked once for each target, so a missing pick is said once.
  const picked = new Map<string, GrantOption | null>();
  const optionOf = (target: LiveActor) => {
    if (!picked.has(target.id)) picked.set(target.id, offered ? optionFor(ctx, offered, target, action.name) : null);
    return picked.get(target.id)!;
  };
  // The effect picked among the action's options (Enlarge or Reduce), and the form a failure takes (Polymorph).
  const effectOption = chosenEffectOption(ctx);
  const shaped = { ...failureFormOf(ctx), ...(effectOption ? { declared: effectOption.effect } : {}) };
  const onFailEffect = failureEffectFor(ctx, conditionIds, cast, null, shaped);
  const onFailFor = (option: GrantOption | null) =>
    option ? failureEffectFor(ctx, conditionIds, cast, option, shaped) : onFailEffect;
  // Careful Spell's and Sculpt Spells' creatures succeed with no roll and take no damage (`metamagic.ts`).
  const targets = shieldFromSave(ctx, cast);
  // A save its user makes (Contact Other Plane) is the user's alone, whatever was aimed at. A creature that succeeded
  // against this action before is immune to it ("immune to this cloaker's Moan for the next 24 hours").
  let saving = action.save.bySelf
    ? [attacker]
    : seeingTargets(ctx, targets).filter((target) => !immuneToAction(ctx, target) && subjectToSave(ctx, target));
  // "If the target is an unwilling creature, it can make a saving throw": a creature on the user's side is willing and
  // takes the effect with no save.
  if (action.save.unwillingOnly) {
    const willing = saving.filter(
      (target) => target.id === attacker.id || areAllies(target, attacker, deps.resolveDefinition)
    );
    saving = saving.filter((target) => !willing.includes(target));
    for (const target of willing) {
      const events = [
        ...conditionIds
          .filter((id) => !onFailEffect?.linkedConditionIds.includes(id))
          .flatMap((id) => setCondition(state, target.id, id, true, undefined, { role: "gm" }, conditionDeps(deps))),
        ...(onFailEffect
          ? applyFailureEffect(
              state,
              target.id,
              onFailEffect,
              `${input.commandId}:${target.id}:fail`,
              conditionDeps(deps)
            )
          : [])
      ];
      ctx.warnings.push(`${target.name} is willing, so it makes no save against ${action.name}.`);
      for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
    }
  }
  const threshold = action.save.failsAtHitPoints;
  if (threshold !== undefined) {
    saving = [];
    for (const target of targets) {
      if (target.hp.current > threshold) {
        if (action.spellId !== undefined && SPEED_ZERO_OVER_THE_GATE.has(action.spellId)) {
          addEffect(
            state,
            target.id,
            makeEffect({
              id: `${input.commandId}:${target.id}:speed`,
              name: effectNameOf(action.name),
              sourceActorId: attacker.id,
              sourceName: attacker.name,
              sourceActionId: action.id,
              startedRound: state.combat.round,
              duration: { type: "until-source-next-turn" },
              speedZero: true
            })
          );
          // A caster hidden from the table is "A hidden threat" in the table's line.
          const casterName = ctx.hiddenFromTable(attacker.id) ? HIDDEN_SOURCE : attacker.name;
          ctx.tableNarration.push({
            kind: "effect",
            text: `${target.name}'s Speed is 0 until the start of ${casterName}'s next turn.`,
            actorIds: [target.id]
          });
        }
        ctx.warnings.push(
          `${target.name} has more than ${threshold} hit points, so ${action.name} doesn't affect it that way.`
        );
        continue;
      }
      const events = [
        ...[...conditionIds, ...barePicks(optionOf(target))]
          .filter((id) => !onFailEffect?.linkedConditionIds.includes(id))
          .flatMap((id) => setCondition(state, target.id, id, true, undefined, { role: "gm" }, conditionDeps(deps))),
        ...(onFailEffect
          ? applyFailureEffect(
              state,
              target.id,
              onFailFor(optionOf(target))!,
              `${input.commandId}:${target.id}:fail`,
              conditionDeps(deps)
            )
          : [])
      ];
      for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
    }
  }
  if (saving.length === 0) return;
  // Prismatic Spray's d8 picks a ray, and a save of its own, for each creature.
  if (prismaticSpray(ctx, saving)) return;
  const parts = rider ? [] : damagePartsOf(ctx);
  const heightened = heightenedTarget(ctx);
  const onSuccessEffect = successEffectFor(ctx, cast);
  // A spell's save whose outcome the engine applies nothing of (Resilient Sphere, Telekinesis): the card and the GM's
  // result say the GM applies it, so it never reads as if the server had.
  const fatal = fatalFailureOf(action.save);
  const gmApplies =
    action.spellId !== undefined &&
    parts.every((part) => part.amount <= 0) &&
    action.damage.length === 0 &&
    conditionIds.length === 0 &&
    !onFailEffect &&
    !onSuccessEffect &&
    !action.save.failurePush &&
    fatal === null;
  if (gmApplies)
    ctx.warnings.push(
      `The server applies nothing of ${action.name}'s save. Apply what a failure or a success does from the spell's text.`
    );
  // Cover adds to Dexterity saving throws (SRD Cover), each target's own: the GM's choice for this resolve, else the
  // cover the GM marked it with, unless the save ignores it (Sacred Flame). Carried on the prompt.
  // With dynamic vision on, the walls and creatures between the caster and a single target cover it too (`mapCover`).
  const saveBonusOf = (target: (typeof targets)[number]) =>
    action.save!.ability === "dex" && !action.save!.ignoresCover
      ? coverBonusOf(
          input.cover ??
            bestCover(
              coverFor(null, target),
              input.areaPlaced === true ? null : mapCover(state, attacker.id, target.id),
              deps.resolveDefinition
                ? smiteOfProtectionCover(state, target, {
                    resolveDefinition: deps.resolveDefinition,
                    ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {}),
                    ...(deps.catalog ? { catalog: deps.catalog } : {})
                  })
                : null
            )
        )
      : 0;
  // "It does so with Advantage if you or your allies are fighting it" (Charm Person): in a fight, a target on the other
  // side from the source.
  const fightingOf = (target: (typeof targets)[number]) =>
    action.save!.advantageIfFighting === true && fightingSides(ctx, target) ? FIGHTING_ADVANTAGE : "";
  // "If the target is Large or smaller, it is swallowed": a larger one fails into the damage alone.
  const swallowsOf = (target: (typeof targets)[number]) =>
    action.swallow?.maxSize === undefined || sizeAtMost(target.size, action.swallow.maxSize);
  // One prompt group for each cover bonus, pick, Advantage, success without a roll, and swallow.
  const groups = new Map<
    string,
    {
      saveBonus: number;
      option: GrantOption | null;
      advantageFrom: string;
      autoSucceeds: string;
      swallows: boolean;
      targetIds: string[];
    }
  >();
  for (const target of saving) {
    const saveBonus = saveBonusOf(target);
    const option = optionOf(target);
    const advantageFrom = fightingOf(target);
    const autoSucceeds = autoSuccessOf(ctx, target);
    const swallows = swallowsOf(target);
    const key = `${saveBonus}|${option?.id ?? ""}|${advantageFrom}|${autoSucceeds}|${swallows}`;
    const group = groups.get(key) ?? { saveBonus, option, advantageFrom, autoSucceeds, swallows, targetIds: [] };
    group.targetIds.push(target.id);
    groups.set(key, group);
  }
  // The spell the save is against, and whether it aimed at one creature alone (Staff of Charming's Resist Enchantment).
  const spell = action.spellId !== undefined ? deps.catalog?.spellRecord?.(action.spellId) : undefined;
  const against = spell
    ? {
        id: spell.id,
        school: spell.school,
        level: ctx.plan.castLevel ?? spell.level,
        singleTarget: ctx.targets.length === 1 && action.area === undefined && spell.area === null
      }
    : undefined;
  const extra = {
    ...(onSuccessEffect ? { onSuccessEffect } : gmApplies ? { gmApplies: true as const } : {}),
    ...(action.save.breaksConcentration ? { breaksConcentration: true as const } : {}),
    // Moonbeam: a shape-shifted creature that fails reverts to its true form.
    ...(action.save.failureEndsForm ? { endsForm: true as const } : {}),
    ...fatal
  };
  for (const { saveBonus, option, advantageFrom, autoSucceeds, swallows, targetIds } of groups.values()) {
    const onFailEffect = swallows ? onFailFor(option) : undefined;
    createPendingSaves(state, {
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      actionName: action.name,
      ability: action.save.ability,
      dc: action.save.dc,
      targetIds,
      proposedDamage: parts.reduce((sum, part) => sum + part.amount, 0),
      proposedDamageParts: parts,
      saveBonus,
      halfOnSuccess: action.save.successDamage === "half" || potentCantrip(ctx),
      // A pick's own Prone stays bare, as the action's does (Command's Grovel).
      conditionIds: swallows ? [...conditionIds, ...barePicks(option)] : [],
      ...(onFailEffect ? { onFailEffect } : {}),
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
      ...(action.drain ? { drain: action.drain } : {}),
      ...(action.save.failurePush ? { failurePush: action.save.failurePush } : {}),
      ...(action.save.advantageAtSize ? { advantageAtSize: action.save.advantageAtSize } : {}),
      ...(against ? { spell: against } : {}),
      ...(advantageFrom !== "" ? { advantageFrom } : {}),
      ...(autoSucceeds !== "" ? { autoSucceeds } : {}),
      ...(action.save.immuneOnSuccess ? { immuneOnSuccess: true } : {}),
      ...(action.save.failureKills ? { failureKills: { ...action.save.failureKills } } : {}),
      // Heightened Spell: "one target of the spell [has] Disadvantage on saves against the spell", its repeats too.
      ...(heightened !== null ? { disadvantage: { targetId: heightened, from: "Heightened Spell" } } : {}),
      magical: isMagicalAction(ctx),
      newSaveId: deps.newRollId,
      createdAt: Date.parse(deps.now())
    });
  }
}

/** Why a target succeeds on this save without rolling, or "" when it rolls: its creature type (Flesh to Stone's
 *  Constructs), or that it doesn't sleep (Sleep: an elf's Trance, an Immunity to Exhaustion). */
function autoSuccessOf(ctx: ResolveContext, target: ResolveContext["targets"][number]): string {
  const rule = ctx.action.save?.autoSuccess;
  if (!rule) return "";
  const definition = target.definitionId ? ctx.deps.resolveDefinition?.(target.definitionId) : undefined;
  const type = creatureTypeOf(target, definition);
  if (rule.creatureTypes && type !== null && rule.creatureTypes.includes(type))
    return `${type[0]!.toUpperCase()}${type.slice(1)}`;
  if (
    rule.sleepless &&
    (holdsFeature(definition, "elf-trance", "Trance") ||
      definition?.character?.race?.id === "elf" ||
      target.conditionImmunities.includes("exhaustion"))
  )
    return "doesn't sleep";
  return "";
}

/** How a save's roll card names the Advantage a fight with its source's side gives it. */
const FIGHTING_ADVANTAGE = "Fighting the source's side";

/** In a running fight, the target and the action's user are both in it and on opposite sides. */
function fightingSides(ctx: ResolveContext, target: ResolveContext["targets"][number]): boolean {
  const { state, attacker, deps } = ctx;
  if (!state.combat.active) return false;
  const inFight = new Set(state.combat.initiative.map((entry) => entry.actorId));
  return inFight.has(attacker.id) && inFight.has(target.id) && areEnemies(attacker, target, deps.resolveDefinition);
}

/** Whether the target is one the save is for: a creature of the type the text names ("If the target is a Humanoid"),
 *  and not one still under this action's failure ("each creature that isn't currently affected by this breath"). The
 *  GM is told why a target makes no save. */
function subjectToSave(ctx: ResolveContext, target: ResolveContext["targets"][number]): boolean {
  const { action, attacker, deps } = ctx;
  const save = action.save!;
  if (save.onlyCreatureTypes) {
    const definition = target.definitionId ? deps.resolveDefinition?.(target.definitionId) : undefined;
    const type = creatureTypeOf(target, definition);
    if (type !== null && !save.onlyCreatureTypes.includes(type)) {
      ctx.warnings.push(`${target.name} isn't a ${save.onlyCreatureTypes.join(" or ")}, so it makes no save.`);
      return false;
    }
  }
  // The same failure from this action, or one of the same name from any source ("doesn't already have an infernal
  // wound").
  const same = save.failureEffect?.name;
  if (
    save.sparesAffected &&
    target.effects.some(
      (effect) =>
        (effect.sourceActorId === attacker.id && effect.sourceActionId === action.id) ||
        (same !== undefined && effect.name === same)
    )
  ) {
    ctx.warnings.push(`${target.name} is still under ${attacker.name}'s ${action.name}, so it makes no save.`);
    return false;
  }
  return true;
}

/** The target succeeded against this action of this source earlier, which keeps it immune for the fight; the GM is
 *  told it makes no save. */
function immuneToAction(ctx: ResolveContext, target: ResolveContext["targets"][number]): boolean {
  const { action, attacker } = ctx;
  const key = traitActionId(action.name);
  const immune = target.effects.some(
    (effect) =>
      effect.tags.includes(AURA_IMMUNE_TAG) && effect.sourceActorId === attacker.id && effect.sourceActionId === key
  );
  if (immune) ctx.warnings.push(`${target.name} is immune to ${attacker.name}'s ${action.name}, so it makes no save.`);
  return immune;
}

/** The cast's targets that make its save: Careful Spell's and Sculpt Spells' chosen creatures "automatically succeed
 *  on [their] saving throw against the spell", take no damage, and get what a success leaves. Each is told to the
 *  table. */
function shieldFromSave(ctx: ResolveContext, cast: SpellCast | undefined): ResolveContext["targets"] {
  const shielded = shieldedFromSave(ctx);
  if (shielded.size === 0 || ctx.action.save?.bySelf === true) return ctx.targets;
  const onSuccess = successEffectFor(ctx, cast);
  for (const target of ctx.targets) {
    const by = shielded.get(target.id);
    if (by === undefined) continue;
    ctx.tableNarration.push(
      tableLineOf(ctx, {
        kind: "effect",
        actorId: target.id,
        text: `${target.name} succeeds on the ${ctx.action.save!.ability.toUpperCase()} save against ${ctx.action.name} without a roll (${by}) and takes no damage.`
      })
    );
    if (onSuccess)
      for (const event of applyFailureEffect(
        ctx.state,
        target.id,
        onSuccess,
        `${ctx.input.commandId}:${target.id}:success`,
        conditionDeps(ctx.deps)
      ))
        ctx.tableNarration.push(tableLineOf(ctx, event));
  }
  return ctx.targets.filter((target) => !shielded.has(target.id));
}

/**
 * What bursts after an attack, hit or miss (SRD Ice Knife: "the shard then explodes. The target and each creature within
 * 5 feet of it must succeed on a Dexterity saving throw"): its damage is rolled once, and each creature the map puts
 * within reach of the target owes the save, the attacker too. Without a map only the target does, and the GM is told
 * to add the rest.
 */
export function parkBurstSave(ctx: ResolveContext): void {
  const { state, action, attacker, attack, deps, input, warnings } = ctx;
  const burst = action.burst;
  if (!burst || attack === null || input.commit === false) return;
  const target = state.actors.find((candidate) => candidate.id === attack.targetId);
  if (!target) return;
  const parts = burst.damage.map((part) => {
    const rolled = rollDice(part.formula, deps.random);
    recordRoll(ctx, rolled, "damage", `${action.name}: burst`);
    return { amount: Math.max(0, rolled.total), type: part.type };
  });
  const near = deps.distanceFeet
    ? state.combat.initiative.flatMap((entry) => {
        if (entry.actorId === target.id) return [];
        const distance = deps.distanceFeet!(target.id, entry.actorId);
        return distance !== null && distance <= burst.radiusFeet + DISTANCE_TOLERANCE_FEET ? [entry.actorId] : [];
      })
    : [];
  if (!deps.distanceFeet)
    warnings.push(
      `${action.name}: each creature within ${burst.radiusFeet} feet of ${target.name} also makes the save. Add them by hand.`
    );
  createPendingSaves(state, {
    sourceActorId: attacker.id,
    sourceName: attacker.name,
    actionName: `${action.name}: burst`,
    ability: burst.ability,
    dc: burst.dc,
    targetIds: [target.id, ...near],
    proposedDamage: parts.reduce((sum, part) => sum + part.amount, 0),
    proposedDamageParts: parts,
    halfOnSuccess: false,
    conditionIds: [],
    magical: isMagicalAction(ctx),
    newSaveId: deps.newRollId,
    createdAt: Date.parse(deps.now())
  });
}

const conditionDeps = (deps: ResolveContext["deps"]) => ({
  ...(deps.resolveDefinition ? { resolveDefinition: deps.resolveDefinition } : {}),
  ...(deps.catalog ? { catalog: deps.catalog } : {})
});

/** SRD Heat Metal, after its damage: "If a creature is holding or wearing the object and takes the damage from it, the
 *  creature must succeed on a Constitution saving throw or drop the object if it can. If it doesn't drop the object,
 *  it has Disadvantage on attack rolls and ability checks until the start of your next turn." */
const HELD_OBJECT_SAVES: ReadonlySet<string> = new Set(["heat-metal"]);

/**
 * The Constitution save a creature burned by a heated object makes to keep holding it, after the cast's damage and
 * each Bonus Action's: keeping hold (a success) brings the Disadvantage, a failure drops the object if it can, which
 * the table is told; a creature that can't drop it (armor it wears) is the GM's to give the Disadvantage.
 */
export function parkHeldObjectSave(ctx: ResolveContext): void {
  const { state, action, attacker, targets, deps } = ctx;
  if (action.spellId === undefined || !HELD_OBJECT_SAVES.has(action.spellId) || ctx.damage.length === 0) return;
  const spell = deps.catalog?.spellRecord?.(action.spellId);
  const dc = casterSaveDc(ctx, action.spellId);
  const name = spell?.name ?? action.name;
  const castId =
    ctx.castId ??
    attacker.effects.find((effect) => effect.spell?.id === action.spellId && effect.castId !== undefined)?.castId;
  for (const target of targets)
    createPendingSaves(state, {
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      actionName: `${name}: keep hold`,
      ability: "con",
      dc,
      targetIds: [target.id],
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: [],
      // A save against a spell, which Magic Resistance meets with Advantage.
      magical: true,
      extra: {
        onSuccessEffect: {
          name: `${name}: holding the red-hot object`,
          tags: ["heat-metal"],
          linkedConditionIds: [],
          escapeDc: null,
          sourceActorId: attacker.id,
          sourceName: attacker.name,
          duration: { type: "until-source-next-turn" },
          ...(castId !== undefined ? { castId } : {}),
          sourceActionId: action.id,
          modifiers: [
            { type: "roll-mode", roll: "attack", mode: "disadvantage", when: [{ type: "on-attack-roll" }] },
            { type: "roll-mode", roll: "check", mode: "disadvantage", when: [{ type: "on-ability-check" }] }
          ]
        },
        failureNote: `${target.name} drops the heated object, if it can. If it can't (armor it wears), give it Disadvantage on attack rolls and ability checks until the start of ${attacker.name}'s next turn.`
      },
      newSaveId: deps.newRollId,
      createdAt: Date.parse(deps.now())
    });
}

/** The caster's spell save DC for a spell on its sheet: the casting class's, else the sheet's, else 8 + proficiency +
 *  the spellcasting modifier. */
function casterSaveDc(ctx: ResolveContext, spellId: string): number {
  const casting = ctx.deps.definition?.spellcasting;
  const entry = casting?.spells.find((spell) => spell.id === spellId);
  const byClass = casting?.classes?.find((row) => row.classId === entry?.classId)?.saveDc;
  return byClass ?? casting?.saveDc ?? 10;
}

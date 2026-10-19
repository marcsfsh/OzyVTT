import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { PendingSave } from "@vtt/domain";
import { catalogIdOf, type ActionReaction } from "@vtt/schemas";
import { setCondition } from "../actor-conditions.js";
import { conditionLabel } from "../condition-rules.js";
import { addEffect, ESCAPE_ATHLETICS_TAG, makeEffect, NO_ACTIONS_TAG } from "../effects.js";
import { HAZARDS } from "../hazards.js";
import { halvedDamageParts, previewDamage } from "../hit-points.js";
import { offerableReaction, slotChoiceOf } from "../reaction-offers.js";
import { applyFailureEffect, createPendingSaves } from "../saving-throws.js";
import { HIDDEN_SOURCE } from "../hidden-source.js";
import { rollDice } from "@vtt/rules-5e";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { recordRoll, tableLineOf, type ResolveContext } from "./context.js";
import { coverBonusOf, coverFor } from "../cover.js";
import { smiteOfProtectionCover } from "../paladin-auras.js";
import { damagePartsOf } from "./damage.js";
import { spellOf, spellSaveDuration } from "./concentration.js";

type HalfDamageReaction = Extract<ActionReaction, { response: "half-damage" }>;
type AcBonusReaction = Extract<ActionReaction, { response: "ac-bonus" }>;

/** A hit on a combatant with a matching declared reaction (Uncanny Dodge) parks the damage in a prompt:
 *  "use" spends the reaction and applies half, "decline" applies it in full (see reactions.ts). The
 *  reaction window follows the economy family, so freeform movement does not silence it. */
export function parkReaction(ctx: ResolveContext): void {
  const { state, attack, attacker, targets, input, deps } = ctx;
  if (attack === null || (attack.outcome !== "crit" && attack.outcome !== "hit") || !deps.resolveDefinition) return;
  const target = targets[0];
  const proposedParts = damagePartsOf(ctx);
  const proposedTotal = proposedParts.reduce((sum, part) => sum + part.amount, 0);
  if (proposedTotal <= 0 || target.id === attacker.id) return;
  const offer = offerableReaction(
    state,
    target,
    (reaction): reaction is HalfDamageReaction => reaction.response === "half-damage",
    { resolveDefinition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) }
  );
  if (!offer) return;
  // Both answers weighed through the reactor's defences now, so its buttons name what each would take off.
  const damageDeps = { resolveDefinition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) };
  const weigh = (parts: typeof proposedParts) =>
    previewDamage(state, target.id, { amount: 0, parts }, damageDeps).totalApplied;
  const halved = halvedDamageParts(proposedParts);
  const weighed = { use: halved.length > 0 ? weigh(halved) : 0, decline: weigh(proposedParts) };
  state.combat = {
    ...state.combat,
    pendingReactions: [
      ...state.combat.pendingReactions,
      {
        id: deps.newRollId(),
        kind: "hit-by-attack" as const,
        actorId: target.id,
        actionId: offer.action.id,
        actionName: offer.action.name,
        sourceActorId: attacker.id,
        sourceName: attacker.name,
        targetActorId: null,
        triggerCommandId: input.commandId,
        proposedDamage: proposedTotal,
        proposedDamageParts: proposedParts,
        critical: ctx.crit,
        weighed,
        acBonus: null,
        rollsAttack: false,
        parkedAttack: null,
        createdAt: Date.parse(deps.now())
      }
    ]
  };
  ctx.reactionPrompts.push({ actorId: target.id, actorName: target.name, actionName: offer.action.name });
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
    input.economyPaid === true ||
    !deps.resolveDefinition
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
  const cover = input.cover === "half" || input.cover === "three-quarters" ? input.cover : null;
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
        parkedAttack: {
          actionId: ctx.action.id,
          builtin: input.builtin === true,
          attackNatural: input.attackTotal === undefined ? attack.naturalRoll : null,
          attackTotal: input.attackTotal ?? null,
          cover,
          conditionId: input.conditionId ?? null,
          attackKinds: (input.attackKinds ?? []).filter(
            (kind): kind is "reaction" | "opportunity" => kind === "reaction" || kind === "opportunity"
          ),
          pushFeet: input.pushFeet ?? null,
          slotLevel: ctx.plan.castLevel,
          damageType: input.damageType ?? null,
          bonusDice: (attack.bonusDice ?? []).flatMap((entry) =>
            entry.total === null ? [] : [{ label: entry.label, dice: entry.dice, total: entry.total }]
          ),
          distanceFeet: deps.distanceFeet?.(attacker.id, target.id) ?? null,
          initiatorRole: deps.initiatorRole ?? "gm",
          initiatorSessionId: deps.initiatorSessionId ?? deps.gmSessionId,
          untilNextTurn: offer.reaction.untilNextTurn === true,
          // The extras chosen for the hit ride the replay, spent only if it still hits.
          hitOptions: (input.hitOptions ?? []).map((choice) => ({ ...choice }))
        },
        ...slotChoiceOf(target, offer.action),
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
  cast?: SpellCast
): PendingSave["onFailEffect"] {
  const { action, attacker, castId } = ctx;
  const save = action.save;
  if (!save) return undefined;
  const linked = conditionIds.filter((id) => !BARE_FAILURE_CONDITIONS.has(id));
  // What the failure leaves besides conditions (Bane's -1d4, Faerie Fire's outline), declared by the action.
  const declared = save.failureEffect;
  // Alchemist's Fire sets its target burning, Oil covers it: an effect of its own, or riding the conditions.
  const hazard = save.failureHazard ? HAZARDS[save.failureHazard] : undefined;
  if (linked.length === 0 && !declared && !hazard) return undefined;
  const grapple = linked.includes("grappled");
  const athletics =
    action.spellId !== undefined && ATHLETICS_ESCAPES.has(action.spellId) && linked.includes("restrained");
  const duration =
    save.failureDuration ??
    declared?.duration ??
    hazard?.duration ??
    (cast ? spellSaveDuration(cast.spell, cast.level) : undefined);
  const ongoingDamage = save.ongoingDamage ?? hazard?.ongoingDamage;
  return {
    name: (
      declared?.name ??
      (linked.length > 0 ? `${conditionLabel(linked[0]!)} by ${attacker.name} (${action.name})` : hazard!.name)
    ).slice(0, 120),
    tags: [
      ...(grapple ? ["grapple"] : []),
      ...(athletics ? [ESCAPE_ATHLETICS_TAG] : []),
      ...(action.spellId !== undefined && NO_ACTIONS_FAILURES.has(action.spellId) ? [NO_ACTIONS_TAG] : []),
      ...(declared?.tags ?? []),
      ...(hazard ? [hazard.tag] : [])
    ].slice(0, 8),
    modifiers: [...(declared?.modifiers ?? [])],
    ...(declared?.armorClassBonus !== undefined ? { armorClassBonus: declared.armorClassBonus } : {}),
    linkedConditionIds: linked,
    // An escape DC the text doesn't print is the grapple's own DC, as the 2024 rules set it; a spell's restraint is
    // escaped against the spell save DC.
    escapeDc: grapple ? (save.escapeDc ?? save.dc) : athletics ? save.dc : null,
    sourceActorId: attacker.id,
    sourceName: attacker.name,
    ...(duration ? { duration } : {}),
    ...(save.repeatSave ? { repeatSave: { ability: save.ability, dc: save.dc } } : {}),
    ...(save.endsOnDamage ? { endsOnDamage: true } : {}),
    ...(save.endsOnSourceSideDamage ? { endsOnSourceSideDamage: true as const } : {}),
    ...(declared?.endsOnSpellHealing ? { endsOnSpellHealing: true as const } : {}),
    ...(save.speedZero ? { speedZero: true } : {}),
    ...(grapple ? { endsWhenSourceDefeated: true, rangeFeet: save.rangeFeet ?? action.attack?.reachFeet ?? 5 } : {}),
    ...(ongoingDamage ? { ongoingDamage } : {}),
    ...(castId !== null ? { castId } : {}),
    ...(cast ? { spell: { id: cast.spell.id, level: cast.level } } : {}),
    ...(isMagicalAction(ctx) ? { magical: true as const } : {}),
    sourceActionId: action.id
  };
}

/** What a successful save leaves on its target instead, as the action declares it (Stunning Strike: the target's Speed
 *  halved and the next attack roll against it with Advantage, until the start of the Monk's next turn). */
function successEffectFor(
  ctx: MagicalSource & Pick<ResolveContext, "castId">,
  cast: SpellCast | undefined
): PendingSave["onSuccessEffect"] {
  const { action, attacker, castId } = ctx;
  const declared = action.save?.successEffect;
  if (!declared) return undefined;
  return {
    name: declared.name,
    tags: [...declared.tags],
    modifiers: [...declared.modifiers],
    ...(declared.armorClassBonus !== undefined ? { armorClassBonus: declared.armorClassBonus } : {}),
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

/** SRD Power Word Stun: a target over its hit-point gate isn't Stunned. Instead, "Otherwise, its Speed is 0 until the start
 *  of your next turn". */
const SPEED_ZERO_OVER_THE_GATE: ReadonlySet<string> = new Set(["power-word-stun"]);

/**
 * A save action parks one pending save per target; the outcome auto-applies (see saving-throws.ts). When the
 * action also attacks, the save is the hit's rider (a ghoul's paralysing claw): it is owed only on a hit, and
 * the damage already rode the hit, so the save proposes none of its own. A save that a low enough target fails
 * outright (Power Word Stun) lands at once, and only its repeated save can end it.
 */
export function parkActionSave(ctx: ResolveContext): void {
  const { state, action, attacker, targets, input, deps, attack } = ctx;
  if (!action.save) return;
  const rider = attack !== null;
  if (rider && attack.outcome !== "hit" && attack.outcome !== "crit") return;
  // The GM's explicit choice wins over the condition the action declares.
  const conditionIds = input.conditionId ? [input.conditionId] : action.save.failureConditions;
  const cast = spellCastOf(ctx);
  const onFailEffect = failureEffectFor(ctx, conditionIds, cast);
  // A save its user makes (Contact Other Plane) is the user's alone, whatever was aimed at.
  let saving = action.save.bySelf ? [attacker] : targets;
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
              name: action.name,
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
      for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
    }
  }
  if (saving.length === 0) return;
  const parts = rider ? [] : damagePartsOf(ctx);
  const onSuccessEffect = successEffectFor(ctx, cast);
  // A spell's save whose outcome the engine applies nothing of (Levitate, Polymorph): the card and the GM's result say
  // the GM applies it, so it never reads as if the server had.
  const gmApplies =
    action.spellId !== undefined &&
    parts.every((part) => part.amount <= 0) &&
    action.damage.length === 0 &&
    conditionIds.length === 0 &&
    !onFailEffect &&
    !onSuccessEffect &&
    !action.save.failurePush;
  if (gmApplies)
    ctx.warnings.push(
      `The server applies nothing of ${action.name}'s save. Apply what a failure or a success does from the spell's text.`
    );
  // Cover adds to Dexterity saving throws (SRD Cover), each target's own: the GM's choice for this resolve, else the
  // cover the GM marked it with, unless the save ignores it (Sacred Flame). Carried on the prompt.
  const saveBonusOf = (target: (typeof targets)[number]) =>
    action.save!.ability === "dex" && !action.save!.ignoresCover
      ? coverBonusOf(
          coverFor(input.cover, target) ??
            (deps.resolveDefinition
              ? smiteOfProtectionCover(state, target, {
                  resolveDefinition: deps.resolveDefinition,
                  ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {}),
                  ...(deps.catalog ? { catalog: deps.catalog } : {})
                })
              : null)
        )
      : 0;
  const groups = new Map<number, string[]>();
  for (const target of saving) groups.set(saveBonusOf(target), [...(groups.get(saveBonusOf(target)) ?? []), target.id]);
  for (const [saveBonus, targetIds] of groups)
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
      halfOnSuccess: action.save.successDamage === "half",
      conditionIds,
      ...(onFailEffect ? { onFailEffect } : {}),
      ...(onSuccessEffect ? { extra: { onSuccessEffect } } : gmApplies ? { extra: { gmApplies: true as const } } : {}),
      ...(action.drain ? { drain: action.drain } : {}),
      ...(action.save.failurePush ? { failurePush: action.save.failurePush } : {}),
      ...(action.save.advantageAtSize ? { advantageAtSize: action.save.advantageAtSize } : {}),
      magical: isMagicalAction(ctx),
      newSaveId: deps.newRollId,
      createdAt: Date.parse(deps.now())
    });
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

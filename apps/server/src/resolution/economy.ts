import { WISH_LOST_TAG } from "./wish.js";
import { spareOpportunityReactions } from "../reactive-heads.js";
import { carriedObjectViolation } from "../carried-objects.js";
import { reactionSpent, spendReaction } from "../commanded-reactions.js";
import { formViolations } from "../transform/rules.js";
import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import type { ActorDefinition, CastShaping } from "@vtt/schemas";
import { effectiveSlot } from "@vtt/rules-5e";
import { CONTROLLED_MOUNT_ACTIONS, controllingRiderOf, RIDING_TAG } from "../mounts.js";
import { builtinBaseId } from "../builtin-actions.js";
import { animatedRowIds } from "../animated-items.js";
import { conditionLabel, incapacitatingCondition } from "../condition-rules.js";
import { wardingAura } from "../paladin-auras.js";
import { areAllies } from "../creature-sides.js";
import {
  CANT_ATTACK_TAG,
  DASH_ONLY_TAG,
  FLEE_ONLY_TAG,
  DODGE_ONLY_TAG,
  HASTED_TAG,
  concentrationOn,
  hasEffectTag,
  spellWords,
  NO_ACTIONS_TAG,
  NO_BONUS_ACTIONS_TAG,
  NO_REACTIONS_TAG,
  SLOWED_TAG,
  ACTION_OR_BONUS_TAG,
  NO_SPELLS_TAG,
  RAGING_TAG,
  READIED_TAG,
  RECKLESS_TAG,
  STEADY_AIM_TAG
} from "../effects.js";
import { ammunitionFor, ammunitionLabel, launcherKind } from "../ammunition.js";
import { SCROLL_UNREADABLE, scrollOfAction, scrollReading } from "../scrolls.js";
import { armorTrainingGaps, deriveEquipment, type EquipmentCatalog } from "../equipment-derivation.js";
import { RulesBlockedError } from "../game-store.js";
import { isItemActionId, itemActionRest, TWO_HANDED_SUFFIX } from "../item-actions.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import {
  effectiveModeFor,
  overrideCovers,
  overrideReason,
  overrideWaives,
  rememberOverride,
  rulesInForce,
  type RuleId
} from "../rules-families.js";
import { laterRowOf, ritualSpellActionId } from "../item-actions.js";
import { carriesSpellbook, hasClassFeature } from "../ritual-adept.js";
import { bookOfShadowsGap } from "../book-of-shadows.js";
import { castThisTurnKey, spellUpLevel, takenWhileUp } from "../lasting-spells.js";
import { activationCost, alsoSpentMessage, alsoUsesKey, notEnoughUses } from "../use-cost.js";
import { builtinHandlerFor } from "./builtins.js";
import { planThisTurn, usedMarkOf } from "./multiattack-after.js";
import { END_EFFECT_ACTION_ID, hasEndingOption, NO_ENDING_OPTION } from "../ending-actions.js";
import { castMarks, markMoveOf } from "./marks.js";
import { actionTargetViolations } from "./action-targets.js";
import { swallowViolations } from "../swallow.js";
import { followUpViolation } from "../follow-ups.js";
import { THEN_HIDE_TAG } from "../granted-moves.js";
import { bloodiedHitViolation } from "../bloodied-hits.js";
import { attachmentViolations } from "../attachments.js";
import { hitRiderOf } from "./hit-riders.js";
import { hiddenFrom } from "../vision/audience.js";
import { withoutSourceName } from "../hidden-source.js";
import { sizeRank, type DefinitionAction, type LiveActor, type ResolveContext, type ResolveInput } from "./context.js";
import { readComponents, spendComponents, type ComponentSpend } from "./components.js";
import { spellTargetViolations } from "./spell-targets.js";
import { NO_CASTING_TAG, raiseViolations, revivalViolations } from "./revival.js";
import {
  castInstanceOf,
  commitShaping,
  isMetamagicOption,
  levelBonusOf,
  shapingCheck,
  shapingOf,
  type ShapingPlan
} from "./metamagic.js";
import { legendaryActionsPerRound } from "../lair.js";
import { dealt } from "./dealings.js";
import { attackActionOpening, fleetStep, rageArmorViolation, timingViolations } from "./turn-windows.js";
import { AXE_BERSERK_TAG } from "../berserker-axe.js";

type RuleViolation = Readonly<{ rule: RuleId; message: string }>;

/** How this resolve settles the action economy once it succeeds. */
export type EconomyPlan = Readonly<{
  markAction: boolean;
  markBonus: boolean;
  markReaction: boolean;
  /** The compound-action components remaining after this resolve (null leaves no instance), with the slot a
   *  multi-attack spell opening it was cast with. */
  instance: Readonly<{
    actorId: string;
    components: Record<string, number>;
    slotLevel?: number;
    parentId?: string;
    replacements?: Record<string, number>;
    shaping?: readonly CastShaping[];
    leap?: Readonly<{ fromId: string; struck: readonly string[]; left: number; damageType?: string }>;
  }> | null;
  /** The same for a compound Bonus Action (Flurry of Blows), or a spell's rays cast as one (Quickened Spell). */
  bonusInstance: Readonly<{
    actorId: string;
    components: Record<string, number>;
    slotLevel?: number;
    shaping?: readonly CastShaping[];
  }> | null;
  /** Limited-use spend to record, keyed per scope: `amount` uses of it (one, or the action's cost). */
  spendUse: Readonly<{
    key: string;
    per: NonNullable<DefinitionAction["uses"]>["per"];
    amount: number;
    /** The second limit the use counts against too (`alsoUses`), one more of it spent. */
    also?: string;
  }> | null;
  /** Legendary-action cost to add to the attacker's per-round pool (SRD Legendary Actions), and the mark of one it
   *  can't take again until its next turn. */
  spendLegendary: Readonly<{ cost: number; onceKey?: string }> | null;
  /** Spell slot the action spends from the bearer's own pools: a spell slot, or a Pact Magic slot (`pact`). */
  spendSpellSlot: Readonly<{ level: number; pact?: true }> | null;
  /** The slot level this cast is at: the one it spends, or the one the open spell it continues spent (a later ray).
   *  Null for anything not cast with a slot. */
  castLevel: number | null;
  /** The action beyond the creature's one that this resolve takes (SRD Action Surge, Haste), or null. */
  extraAction: "surge" | "haste" | null;
  /** It is a Magic action taken on the creature's turn, which Action Surge's additional action can't repeat. */
  magicAction: boolean;
  /** It is Action Surge, which gives one additional action this turn. */
  surge: boolean;
  /** The turn's uses key of a feature used once per turn beside a pool of its own (Stunning Strike), or null. */
  oncePerTurn?: string | null;
  /** The turn's mark that this action was used, which a sibling Multiattack waits on (`multiattack-after.ts`). */
  usedMark?: string | null;
  /** The consumed materials and coins the cast uses up (SRD Components). */
  componentSpends?: readonly ComponentSpend[];
  /** The Sorcery Points the cast's Metamagic spends and what it marks on the turn (`metamagic.ts`). */
  shaping?: ShapingPlan | null;
  /** It casts a level 1+ spell anew, which Quickened Spell reads on its caster's turn. */
  leveledCast?: boolean;
  /** Marks the turn keeps of what this resolve did, for a timing rule that reads them (Fleet Step). */
  turnMarks?: readonly string[];
}>;

type EconomyEvaluation = Readonly<{
  violations: readonly RuleViolation[];
  softViolations: readonly RuleViolation[];
  plan: EconomyPlan;
  proseMultiattack: boolean;
  /** Informational notes that surface as warnings regardless of mode (ambiguous multiattack membership). */
  notes: readonly string[];
}>;

/** What every economy check reads, and the lists they report into (in check order). */
type Evaluation = Readonly<{
  state: GameState;
  attacker: LiveActor;
  action: DefinitionAction;
  targetIds: readonly string[];
  siblings: ReadonlyArray<DefinitionAction>;
  /** The slot level the caster asked for; see `castSlotLevel`. */
  slotLevel: number | undefined;
  resolveDefinition: ((definitionId: string) => ActorDefinition | undefined) | undefined;
  onOwnTurn: boolean;
  /** A prose-only Multiattack hides extra attacks from the engine, so action-slot violations degrade to warnings. */
  proseMultiattack: boolean;
  /** Step of the Wind right after another Bonus Action takes no Bonus Action of its own (Fleet Step). */
  freeBonusAction?: boolean;
  /** An Opportunity Attack, which a hydra's extra Reactions can take (Reactive Heads). */
  opportunity?: boolean;
  violations: RuleViolation[];
  softViolations: RuleViolation[];
  notes: string[];
}>;

/** The limit of the counter this action spends from: for a shared `uses.pool`, the largest limit any
 *  sibling in that pool and rest scope declares. Takes the effective siblings so item bonuses count. */
export function useLimitFor(siblings: ReadonlyArray<DefinitionAction>, action: DefinitionAction): number {
  const uses = action.uses;
  if (!uses) return 0;
  if (!uses.pool) return uses.limit;
  return siblings.reduce((limit, candidate) => {
    const sibling = candidate.uses;
    return sibling && sibling.pool === uses.pool && sibling.per === uses.per ? Math.max(limit, sibling.limit) : limit;
  }, uses.limit);
}

/** Pure rules evaluation for one action: every violated rule plus the economy plan a successful resolve
 *  would commit. Shared with the availability projection so they can't drift. Economy gating applies
 *  only on the attacker's own turn. */
export function evaluateActionEconomy(
  state: GameState,
  attacker: LiveActor,
  action: DefinitionAction,
  targetIds: readonly string[],
  definition: ActorDefinition | undefined,
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null,
  siblings: ReadonlyArray<DefinitionAction> = definition?.actions ?? [],
  slotLevel?: number,
  /** The action rides a hit it was chosen for (Sneak Attack) and is never taken alone. */
  asHitRider = false,
  catalog?: EquipmentCatalog,
  /** The spell the action casts, for the slot, preparation and targeting checks. */
  spell?: SpellReference,
  /** Any combatant's stat block, for the side a creature fights on (Help distracts an enemy). */
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined,
  /** What the map says of the cast: the caster stands where no sound can be made (Silence), and the targets are a
   *  placed template's catch. And how its caster shapes it (Metamagic). */
  cast: Readonly<{
    silenced?: boolean;
    areaPlaced?: boolean;
    shaping?: readonly CastShaping[];
    opportunity?: boolean;
  }> = {}
): EconomyEvaluation {
  // A Multiattack whose other plan waits on an action used this turn (a clay golem's Hasten) plans as it stands now.
  const usedMark = usedMarkOf(state, attacker.id, action, siblings);
  action = planThisTurn(state, attacker.id, action);
  siblings = siblings.map((sibling) => planThisTurn(state, attacker.id, sibling));
  const fleet = fleetStep(state, attacker, action, definition);
  const evaluation: Evaluation = {
    state,
    attacker,
    action,
    targetIds,
    siblings,
    slotLevel,
    resolveDefinition,
    onOwnTurn: state.combat.turnActorId === attacker.id,
    proseMultiattack: siblings.some((candidate) => candidate.untrackedMultiattack === true),
    // A weretiger's Prowl ends with a Hide that takes no action of its own.
    freeBonusAction: fleet.free || hidesFreely(attacker, action),
    ...(cast.opportunity ? { opportunity: true } : {}),
    violations: [],
    softViolations: [],
    notes: []
  };
  checkAbleToAct(evaluation);
  checkCommandedLimits(evaluation);
  // What the creature's form keeps it from doing (no spells in Wild Shape, a werewolf's Bite only in wolf form).
  evaluation.violations.push(
    ...formViolations(
      attacker,
      action,
      definition,
      spell ?? (action.spellId !== undefined ? catalog?.spellRecord?.(action.spellId) : undefined)
    )
  );
  checkTurnsBegun(evaluation);
  checkOwnTurn(evaluation);
  evaluation.violations.push(...timingViolations(state, attacker, action));
  const armored = rageArmorViolation(attacker, action, definition, catalog);
  if (armored) evaluation.violations.push(armored);
  // "While underwater, the seahorse moves": only in a fight the GM marked as underwater.
  if (action.underwaterOnly && !(state.combat.active && state.combat.underwater))
    evaluation.violations.push({
      rule: "action.underwater-only",
      message: `${action.name} can be used only underwater, and this fight isn't.`
    });
  checkExtraAttackOpened(evaluation);
  checkHands(evaluation);
  checkArmorTraining(evaluation, definition, catalog);
  checkAmmunition(evaluation, catalog);
  checkScrollLegible(evaluation, definition, catalog);
  if (!asHitRider) checkTakenAlone(evaluation);
  const spendUse = checkLimitedUse(evaluation);
  const oncePerTurn = checkOncePerTurn(evaluation);
  const surge = checkActionSurge(evaluation);
  checkRecklessAttack(evaluation);
  checkSteadyAim(evaluation);
  // A later ray of a spell already cast this action spends no further slot; it rolls at the first ray's.
  const continued = continuedSpellSlot(evaluation);
  // Used before the Attack action's first attack, it takes the action as the Attack action (Sacred Weapon).
  const opening = attackActionOpening(state, attacker, action, siblings);
  const slots = opening
    ? { ...checkActionSlots(evaluation), markAction: true, instance: opening }
    : checkActionSlots(evaluation);
  // A Loading weapon fires once per action; an additional action (Action Surge) is another.
  if (slots.extraAction === null) checkLoading(evaluation);
  const spendLegendary = checkLegendary(evaluation, definition);
  const spendSpellSlot = continued === null ? checkSpellSlot(evaluation) : null;
  if (continued === null) {
    const unprepared = unpreparedSpell(attacker, action, definition);
    if (unprepared) evaluation.violations.push({ rule: "slots.not-prepared", message: unprepared });
  }
  checkTargeting(evaluation, distanceFeet);
  // Who a non-spell action may target: its count, range and creatures (`ActionSchema.targets`).
  evaluation.violations.push(
    ...actionTargetViolations({
      state,
      attacker,
      action,
      targetIds,
      definition,
      resolveDefinition,
      distanceFeet,
      catalog
    }),
    // How many it can hold swallowed, and what it can't do while it holds one (a giant toad's Bite).
    ...swallowViolations(state, attacker, action, siblings, targetIds),
    // What a creature attached to another can't do while it holds on (a stirge's Proboscis).
    ...attachmentViolations(state, attacker, action, targetIds),
    // A Rampage waits on damage to a creature already Bloodied.
    ...[bloodiedHitViolation(state, attacker, action)].filter((violation) => violation !== null),
    // An action that needs what its user carries (a night hag's soul bag) waits on it whole.
    ...[carriedObjectViolation(attacker, action)]
      .filter((message) => message !== null)
      .map((message) => ({ rule: "feature.requires-effect" as const, message: message! })),
    // A follow-up attack a hit opened goes only at that hit's target (an allosaurus's Bite).
    ...[followUpViolation(state, attacker, action, targetIds)].filter((violation) => violation !== null),
    ...raiseViolations({ state, attacker, action, targetIds })
  );
  if (spell) checkMarkMove(evaluation, spell);
  if (spell) checkSpellUp(evaluation, spell);
  if (spell) checkLaterTurn(evaluation, spell);
  // Its caster shapes a spell cast anew (Metamagic); a later ray keeps its cast's shaping, and a later action has none.
  const newCast =
    spell !== undefined &&
    continued === null &&
    castInstanceOf(state, attacker, action) === null &&
    laterRowOf(spell, action.id) === undefined;
  const shaping = newCast ? (cast.shaping ?? []) : [];
  const levelBonus = levelBonusOf(shaping);
  if (spell)
    evaluation.violations.push(
      ...spellTargetViolations({
        state,
        attacker,
        action,
        spell,
        targetIds,
        castLevel: (spendSpellSlot?.level ?? continued ?? spell.level) + levelBonus,
        areaPlaced: cast.areaPlaced === true,
        characterLevel: (definition?.character?.classes ?? []).reduce((sum, entry) => sum + entry.level, 0),
        distanceFeet,
        resolveDefinition,
        catalog
      })
    );
  // A revival's dead creature: dead, not too long ago, and with a body it can bring back.
  if (spell && newCast)
    evaluation.violations.push(...revivalViolations({ state, spell, targetIds, resolveDefinition }));
  const shaped = newCast
    ? shapingCheck({
        state,
        attacker,
        action,
        spell,
        castLevel: spendSpellSlot?.level ?? spell.level,
        definition,
        shaping,
        targetIds,
        siblings,
        resolveDefinition,
        catalog
      })
    : null;
  if (shaped) evaluation.violations.push(...shaped.violations);
  // A later ray of a spell already cast this action is no new cast, so it needs no components again.
  const components =
    continued === null
      ? readComponents({
          attacker,
          action,
          spell: spell ?? (action.spellId ? catalog?.spellRecord?.(action.spellId) : undefined),
          definition,
          catalog,
          ...(cast.silenced ? { silenced: true } : {}),
          ...(shapingOf(shaping, "subtle-spell") ? { subtle: true } : {}),
          targetCount: new Set(targetIds).size
        })
      : { gaps: [], spends: [] };
  evaluation.violations.push(...components.gaps);
  // A spell's rays keep the slot and the shaping of the cast that opened them.
  const castRecord = {
    ...(spendSpellSlot !== null ? { slotLevel: spendSpellSlot.level } : {}),
    ...(shaping.length > 0 ? { shaping: [...shaping] } : {})
  };
  const opensRays =
    action.spellId !== undefined && slots.markAction && slots.instance?.components[action.id] !== undefined;
  const opensBonusRays =
    action.spellId !== undefined && slots.markBonus && slots.bonusInstance?.components[action.id] !== undefined;
  const slotCast = spendSpellSlot?.level ?? continued;
  return {
    violations: evaluation.violations,
    softViolations: evaluation.softViolations,
    plan: {
      ...slots,
      ...(opensRays ? { instance: { ...slots.instance!, ...castRecord } } : {}),
      ...(opensBonusRays ? { bonusInstance: { ...slots.bonusInstance!, ...castRecord } } : {}),
      spendUse,
      spendLegendary,
      spendSpellSlot,
      // Twinned Spell raises the level the cast counts as, never the slot it spends.
      castLevel: levelBonus > 0 && spell ? (slotCast ?? spell.level) + levelBonus : slotCast,
      magicAction: evaluation.onOwnTurn && isMagicAction(action),
      surge,
      oncePerTurn,
      usedMark,
      ...(components.spends.length > 0 ? { componentSpends: components.spends } : {}),
      ...(shaped?.plan ? { shaping: shaped.plan } : {}),
      ...(newCast && spell.level >= 1 ? { leveledCast: true } : {}),
      ...(fleet.marks.length > 0 ? { turnMarks: fleet.marks } : {})
    },
    proseMultiattack: evaluation.proseMultiattack,
    notes: evaluation.notes
  };
}

/** SRD Hunter's Mark and Hex move "if the target drops to 0 Hit Points before this spell ends": the caster's
 *  Concentration on the spell holds a mark, and the marked creature is down. */
function checkMarkMove(
  { state, attacker, action, resolveDefinition, violations }: Evaluation,
  spell: SpellReference
): void {
  if (!markMoveOf(spell, action.id)) return;
  const marks = castMarks(state, attacker, spell);
  if (marks.length === 0) {
    violations.push({
      rule: "feature.requires-effect",
      message: `${attacker.name} isn't concentrating on ${spell.name}, so there is no mark to move.`
    });
    return;
  }
  const standing = marks.find(({ bearer }) => bearer.hp.current > 0);
  // A marked creature hidden from the table (the shared check) isn't named in the refusal.
  if (standing)
    violations.push({
      rule: "target.mark-still-standing",
      message: hiddenFrom(state, resolveDefinition ? { definition: resolveDefinition } : {})(standing.bearer.id)
        ? `${spell.name} moves only once its creature drops to 0 Hit Points.`
        : `${spell.name} moves only once its creature drops to 0 Hit Points, and ${standing.bearer.name} hasn't.`
    });
}

/** What a spell lets its caster do on later turns (Spiritual Weapon's attack, Call Lightning's bolt) is there "until the
 *  spell ends": while its caster still has it up. */
function checkSpellUp({ attacker, action, siblings, violations }: Evaluation, spell: SpellReference): void {
  const row = laterRowOf(spell, action.id);
  if (!row || !takenWhileUp(row) || spellUpLevel(attacker, spell) !== null) return;
  // Another creature's spell gave it this action (Dragon's Breath), so it is there while that effect is.
  if (attacker.effects.some((effect) => effect.grantedSpellAction?.spellId === spell.id)) return;
  // A sheet built before the cast itself was an action (Produce Flame's) has no way to start it, so it isn't asked to.
  if (!siblings.some((sibling) => sibling.spellId === spell.id && !laterRowOf(spell, sibling.id))) return;
  violations.push({
    rule: "feature.requires-effect",
    message: `${attacker.name} doesn't have ${spell.name} up. Cast it first.`
  });
}

/** What a spell offers "on your later turns" (Spiritual Weapon's attack, Heat Metal's heat, moving Hex) waits for a
 *  turn after the one its caster cast it on. */
function checkLaterTurn({ state, attacker, action, violations }: Evaluation, spell: SpellReference): void {
  const row = laterRowOf(spell, action.id);
  // "On each of your turns" (Phantasmal Force): only on its caster's own turn in a fight.
  if (row?.ownTurnOnly && state.combat.active && state.combat.turnActorId !== attacker.id) {
    violations.push({
      rule: "spell.later-turn",
      message: `${action.name} comes only on ${attacker.name}'s own turn.`
    });
    return;
  }
  if (!row?.laterTurnsOnly || state.combat.turnActorId !== attacker.id) return;
  if ((state.combat.turn.turnUses[castThisTurnKey(attacker.id, spell.id)] ?? 0) === 0) return;
  violations.push({
    rule: "spell.later-turn",
    message: `${attacker.name} cast ${spell.name} this turn, and ${action.name} comes on later turns.`
  });
}

/** In wait mode the order is provisional until every player has rolled, and the turn economy resets when
 *  turns begin, so an action taken before then would come free. */
function checkTurnsBegun({ state, violations }: Evaluation): void {
  const { active, playerInitiativeMode, pendingInitiative } = state.combat;
  if (active && playerInitiativeMode === "wait" && pendingInitiative.length > 0)
    violations.push({
      rule: "initiative.gathering",
      message: "Players are still rolling initiative. Turns begin once everyone has rolled."
    });
}

/** The spell a Readied creature holds for this action (SRD Ready), while the Readied effect lasts. */
export function heldReadiedSpell(
  attacker: Pick<LiveActor, "effects">,
  actionId: string
): Readonly<{ actionId: string; level: number; raysLeft?: number }> | undefined {
  return attacker.effects.find(
    (effect) => effect.tags.includes(READIED_TAG) && effect.readiedSpell?.actionId === actionId
  )?.readiedSpell;
}

/** A Readied creature's response to its trigger: an action it takes off its own turn, which the SRD makes a Reaction
 *  ("you can either take your Reaction right after the trigger finishes"). */
export function isReadiedResponse(
  state: GameState,
  attacker: LiveActor,
  action: Pick<DefinitionAction, "id" | "activation">
): boolean {
  return (
    state.combat.active &&
    state.combat.turnActorId !== attacker.id &&
    action.activation === "action" &&
    action.id !== "ready" &&
    hasEffectTag(attacker, READIED_TAG)
  );
}

/** SRD: an action and a Bonus Action are taken on your own turn. Off it a creature acts only with a Reaction (a
 *  readied action is one), a legendary action, or a feature that answers an event. The current creature is named
 *  only when the table can see it (the shared hidden check). */
function checkOwnTurn({ state, attacker, action, onOwnTurn, resolveDefinition, violations }: Evaluation): void {
  if (onOwnTurn || !state.combat.active || action.legendary !== undefined) return;
  if (action.activation !== "action" && action.activation !== "bonus-action") return;
  if (isReadiedResponse(state, attacker, action)) return;
  const current = state.actors.find((candidate) => candidate.id === state.combat.turnActorId);
  const shown = current && !hiddenFrom(state, resolveDefinition ? { definition: resolveDefinition } : {})(current.id);
  violations.push({
    rule: "economy.not-your-turn",
    message: shown ? `Not your turn yet. ${current.name} is up.` : "Not your turn yet. Wait for your turn."
  });
}

/** SRD Action Surge: "On your turn, you can take one additional action, except the Magic action", and with two uses
 *  "only once on a turn". Keyed by id so sheets built before this rule get it. True when this resolve is the surge. */
function checkActionSurge({ state, attacker, action, onOwnTurn, violations }: Evaluation): boolean {
  if (action.id !== "action-surge") return false;
  const extra = state.combat.turn.extraActions;
  if (!onOwnTurn)
    violations.push({
      rule: "economy.not-your-turn",
      message: `Action Surge is taken on ${attacker.name}'s own turn.`
    });
  else if (extra?.actorId === attacker.id && extra.surgedThisTurn)
    violations.push({
      rule: "feature.once-per-turn",
      message: `${attacker.name} has already used Action Surge this turn, and it works once on a turn.`
    });
  return true;
}

/** SRD Reckless Attack: "When you make your first attack roll on your turn, you can decide to attack recklessly", so
 *  it is decided on the creature's own turn, before any attack roll it has made there. Keyed by its effect's tag. */
function checkRecklessAttack({ state, attacker, action, onOwnTurn, violations }: Evaluation): void {
  if (!state.combat.active || !action.grants?.tags.includes(RECKLESS_TAG)) return;
  if (!onOwnTurn)
    violations.push({
      rule: "economy.not-your-turn",
      message: `${action.name} is decided with an attack roll on ${attacker.name}'s own turn.`
    });
  else if (state.combat.turn.attackRolled === true)
    violations.push({
      rule: "attack.after-first-roll",
      message: `${attacker.name} has already made an attack roll this turn, and ${action.name} is decided with the first.`
    });
}

/** SRD Steady Aim: "You can use this feature only if you haven't moved during this turn." Keyed by its effect's tag. */
function checkSteadyAim({ state, attacker, action, onOwnTurn, violations }: Evaluation): void {
  if (!onOwnTurn || !action.grants?.tags.includes(STEADY_AIM_TAG)) return;
  if (state.combat.turn.movementUsedFeet > 0)
    violations.push({
      rule: "movement.already-moved",
      message: `${attacker.name} has moved this turn, and ${action.name} is only for a creature that hasn't.`
    });
}

/** "Once per turn" beside a pool of its own (Stunning Strike spends a Focus Point), counted in the turn's uses, which
 *  start afresh with each turn. Read from the hit rider, whose table covers sheets built earlier. */
function checkOncePerTurn({ state, attacker, action, violations }: Evaluation): string | null {
  if (!state.combat.active || hitRiderOf(action)?.oncePerTurn !== true) return null;
  const key = `${attacker.id}:${action.id}`;
  if ((state.combat.turn.turnUses[key] ?? 0) > 0)
    violations.push({
      rule: "feature.once-per-turn",
      message: `${attacker.name} has already used ${action.name} this turn, and it works once per turn.`
    });
  return key;
}

/**
 * Features with no activation of their own that answer a roll or an event (rerolling a failed save, Relentless
 * Endurance at 0 HP), which an Incapacitated creature still gets. Every other "other" activation (a legendary
 * action, Sneak Attack, Reckless Attack, Action Surge, a free cast) is an action by another name.
 */
const ANSWERS_A_ROLL: ReadonlySet<string> = new Set([
  "indomitable",
  "stroke-of-luck",
  "uncanny-metabolism",
  "persistent-rage",
  "orc-relentless-endurance",
  "relentless-endurance",
  "dark-ones-own-luck",
  "boon-of-fate",
  // Dream's messenger delivers its terrifying message from the trance that leaves it Incapacitated.
  "spell-dream-then-terrifying-message"
]);

/** What a creature limited to Dash may still do (Wind Walk): the Dash action, as an action or a Bonus Action, and the
 *  action that ends its cloud form. */
const DASH_ONLY_ALLOWED: ReadonlySet<string> = new Set(["dash", "dash-bonus", "end-effect"]);
/** What a fleeing creature may still do (a Mace of Terror: "it can use only the Dash action or try to escape from an
 *  effect that prevents it from moving. If it has nowhere it can move, the creature can take the Dodge action"). */
const FLEE_ONLY_ALLOWED: ReadonlySet<string> = new Set([
  ...DASH_ONLY_ALLOWED,
  "escape-grapple",
  "end-an-effect",
  "dodge"
]);

/** An effect's name in a refusal, as the creature's own sheet shows it: a caster hidden from the table is "A hidden
 *  threat" there. */
function shownEffectName(
  state: GameState,
  effect: Readonly<{ name: string; sourceActorId: string | null; sourceName: string | null }>,
  resolveDefinition: Evaluation["resolveDefinition"]
): string {
  const hiddenCaster =
    effect.sourceActorId !== null &&
    hiddenFrom(state, resolveDefinition ? { definition: resolveDefinition } : {})(effect.sourceActorId);
  return hiddenCaster ? withoutSourceName(effect.name, effect.sourceName) : effect.name;
}

/** Incapacitation and 0 HP forbid every action, Bonus Action and Reaction (SRD 2024 "Incapacitated"), legendary
 *  actions and feature activations included; a required effect (Frenzy needs Rage) must be active, and a raging
 *  Barbarian can't cast spells. */
function checkAbleToAct({ state, attacker, action, targetIds, resolveDefinition, violations }: Evaluation): void {
  if (action.activation !== "other" || !(ANSWERS_A_ROLL.has(action.id) || action.answer !== undefined)) {
    const incapacitating = incapacitatingCondition(attacker);
    if (incapacitating !== null)
      violations.push({
        rule: "condition.incapacitated",
        message: `${attacker.name} is ${conditionLabel(incapacitating)} and can't take actions, Bonus Actions, or reactions.`
      });
    // At 0 HP a creature is down and can't act. Keyed on hp, so a defeated monster with no condition is blocked too.
    else if (attacker.hp.current <= 0)
      violations.push({
        rule: "condition.down",
        message: `${attacker.name} is down (0 HP) and can't take actions, Bonus Actions, or reactions.`
      });
  }
  // "Can't take Reactions" while an effect lasts.
  const unreacting = attacker.effects.find((effect) => effect.tags.includes(NO_REACTIONS_TAG));
  if (unreacting && action.activation === "reaction")
    violations.push({
      rule: "condition.no-reactions",
      message: `${attacker.name} can't take Reactions while ${shownEffectName(state, unreacting, resolveDefinition)} lasts.`
    });
  const slowed = attacker.effects.find((effect) => effect.tags.includes(NO_BONUS_ACTIONS_TAG));
  if (slowed && action.activation === "bonus-action")
    violations.push({
      rule: "economy.bonus-action-used",
      message: `${attacker.name} can't take a Bonus Action while ${shownEffectName(state, slowed, resolveDefinition)} lasts.`
    });
  // SRD Stinking Cloud: while poisoned by it, "the creature can't take an action or a Bonus Action".
  const reeling = attacker.effects.find((effect) => effect.tags.includes(NO_ACTIONS_TAG));
  if (reeling && (action.activation === "action" || action.activation === "bonus-action"))
    violations.push({
      rule: "condition.incapacitated",
      message: `${attacker.name} is reeling from ${shownEffectName(state, reeling, resolveDefinition)} and can't take an action or a Bonus Action this turn.`
    });
  // SRD Gaseous Form: the cloud "can't attack".
  const unarmed = action.id.startsWith("unarmed-");
  const cantAttack = attacker.effects.find((effect) => effect.tags.includes(CANT_ATTACK_TAG));
  if (cantAttack && (action.attack !== undefined || action.multiattack !== undefined || unarmed))
    violations.push({
      rule: "condition.cant-attack",
      message: `${attacker.name} can't attack while ${shownEffectName(state, cantAttack, resolveDefinition)} lasts.`
    });
  // SRD Wind Walk: "The only actions it can take in this form are the Dash action or a Magic action to begin reverting".
  const dashOnly = attacker.effects.find((effect) => effect.tags.includes(DASH_ONLY_TAG));
  if (
    dashOnly &&
    !DASH_ONLY_ALLOWED.has(action.id) &&
    action.activation !== "reaction" &&
    action.activation !== "other"
  )
    violations.push({
      rule: "condition.dash-only",
      message: `${attacker.name} can take only the Dash action or end ${shownEffectName(state, dashOnly, resolveDefinition)} while it lasts.`
    });
  const fleeing = attacker.effects.find((effect) => effect.tags.includes(FLEE_ONLY_TAG));
  if (
    fleeing &&
    !FLEE_ONLY_ALLOWED.has(builtinBaseId(action.id)) &&
    action.activation !== "reaction" &&
    action.activation !== "other"
  )
    violations.push({
      rule: "condition.dash-only",
      message: `${attacker.name} can take only the Dash action, try to escape what holds it, or Dodge with nowhere to move while ${shownEffectName(state, fleeing, resolveDefinition)} lasts.`
    });
  // SRD Confusion's 7-8: "it takes the Attack action to make one melee attack against a random creature within reach"
  // (Gibbering's too): one melee weapon or Unarmed Strike attack on the creature the roll picked, and nothing else.
  const forced = attacker.effects.find((effect) => effect.forcedAttack !== undefined)?.forcedAttack;
  if (forced && (action.activation === "action" || action.activation === "bonus-action")) {
    const melee =
      action.spellId === undefined &&
      action.multiattack === undefined &&
      (unarmed || (action.attack !== undefined && action.attack.reachFeet !== undefined));
    const picked = state.actors.find((actor) => actor.id === forced.targetId);
    const pickedName = !picked || picked.visibility === "gm-only" ? "the creature picked" : picked.name;
    if (!melee || state.combat.turn.actionUsed || targetIds.length !== 1 || targetIds[0] !== forced.targetId)
      violations.push({
        rule: "condition.forced-attack",
        message: `${attacker.name}'s action this turn is one melee attack against ${pickedName}.`
      });
  }
  // A Berserker Axe's berserk bearer "must ... take the Attack action" on each of its turns: its action attacks.
  const berserk = attacker.effects.find((effect) => effect.tags.includes(AXE_BERSERK_TAG));
  const attacks =
    unarmed || action.multiattack !== undefined || (action.attack !== undefined && action.spellId === undefined);
  if (berserk && action.activation === "action" && !attacks)
    violations.push({
      rule: "condition.forced-attack",
      message: `${attacker.name} is berserk and must take the Attack action against the creature nearest to it.`
    });
  // SRD Bestow Curse: a failed Wisdom save at the start of its turn means it is "forced to take the Dodge action on
  // that turn".
  const dodgeOnly = attacker.effects.find((effect) => effect.tags.includes(DODGE_ONLY_TAG));
  if (dodgeOnly && action.activation === "action" && builtinBaseId(action.id) !== "dodge")
    violations.push({
      rule: "condition.dash-only",
      message: `${attacker.name} must take the Dodge action this turn while ${shownEffectName(state, dodgeOnly, resolveDefinition)} lasts.`
    });
  // SRD Mounted Combat: a controlled mount "has only three action options during that turn: Dash, Disengage, and Dodge".
  const rider = controllingRiderOf(state, attacker.id);
  if (
    rider &&
    (action.activation === "action" || action.activation === "bonus-action") &&
    !CONTROLLED_MOUNT_ACTIONS.has(builtinBaseId(action.id))
  )
    violations.push({
      rule: "mount.controlled",
      message: `${attacker.name} is a mount ${rider.name} controls, so it can take only the Dash, Disengage or Dodge action.`
    });
  // SRD Befuddlement: the target "can't cast spells or take the Magic action".
  const befuddled = attacker.effects.find((effect) => effect.tags.includes(NO_SPELLS_TAG));
  if (befuddled && (action.spellId !== undefined || action.spellSlot !== undefined || isMagicAction(action)))
    violations.push({
      rule: "condition.no-spells",
      message: `${attacker.name} can't cast spells or take the Magic action while ${shownEffectName(state, befuddled, resolveDefinition)} lasts.`
    });
  // Resurrection's toll on its caster: "Until you finish a Long Rest, you can't cast spells again".
  const taxed = attacker.effects.find((effect) => effect.tags.includes(NO_CASTING_TAG));
  if (taxed && (action.spellId !== undefined || action.spellSlot !== undefined))
    violations.push({
      rule: "condition.no-spells",
      message: `${attacker.name} can't cast spells until ${shownEffectName(state, taxed, resolveDefinition)} ends with a Long Rest.`
    });
  // Wish's stress: "there is a 33 percent chance that you are unable to cast Wish ever again".
  const wishLost = attacker.effects.find((effect) => effect.tags.includes(WISH_LOST_TAG));
  if (wishLost && action.spellId === "wish")
    violations.push({
      rule: "condition.no-spells",
      message: `${attacker.name} can never cast Wish again.`
    });
  // SRD Rage: "you can't cast spells".
  if ((action.spellId !== undefined || action.spellSlot !== undefined) && hasEffectTag(attacker, RAGING_TAG))
    violations.push({
      rule: "condition.raging",
      message: `${attacker.name} is raging and can't cast spells.`
    });
  if (action.requiresEffectTag && !hasEffectTag(attacker, action.requiresEffectTag)) {
    violations.push({
      rule: "feature.requires-effect",
      message: `${action.name} requires an active ${conditionLabel(action.requiresEffectTag)} effect.`
    });
  }
  // A cast through another spell (a Crystal Ball's Detect Thoughts through Scrying) needs that spell held.
  if (action.castThrough && !concentrationOn(attacker, action.castThrough))
    violations.push({
      rule: "feature.requires-effect",
      message: `${action.name} is cast through ${spellWords(action.castThrough)}, which ${attacker.name} isn't concentrating on.`
    });
  // End an Effect needs an effect an action ends, on the creature named or anywhere before one is.
  if (action.id === END_EFFECT_ACTION_ID && !hasEndingOption(state, attacker, targetIds))
    violations.push({ rule: "feature.requires-effect", message: NO_ENDING_OPTION });
}

/** What a commanded creature can't do (SRD 5.2.1 Find Familiar: "A familiar can't attack, but it can take other
 *  actions as normal"). */
function checkCommandedLimits({ attacker, action, violations }: Evaluation): void {
  if (attacker.control?.noAttacks && (action.attack !== undefined || action.multiattack !== undefined))
    violations.push({ rule: "summon.cant-attack", message: `${attacker.name} can't attack.` });
}

/** An extra attack (SRD Light, Cleave) is owed only once the swing that opens it has happened this turn: an attack
 *  with a different Light weapon in the Attack action, or a melee hit with the Cleave weapon. */
function checkExtraAttackOpened({ state, attacker, action, violations }: Evaluation): void {
  const extra = action.extraAttack;
  if (!extra) return;
  const opened = state.combat.turn.extraAttacks;
  if (extra.kind === "light") {
    const swung = opened?.light?.actorId === attacker.id ? opened.light.itemIds : [];
    const pair = (attacker.inventory.find((item) => item.id === extra.itemId)?.quantity ?? 1) >= 2;
    // "A different Light weapon": another item, or the second of a pair.
    if (!swung.some((itemId) => itemId !== extra.itemId || pair))
      violations.push({
        rule: "attack.light-needs-attack",
        message: `${action.name} follows an attack with a different Light weapon in the Attack action this turn.`
      });
    return;
  }
  if (extra.kind === "horde-breaker") {
    const horde = opened?.horde;
    // "Once on each of your turns when you make an attack with a weapon": the same weapon, on the Ranger's own turn.
    if (
      !horde ||
      horde.actorId !== attacker.id ||
      horde.itemId !== extra.itemId ||
      state.combat.turnActorId !== attacker.id
    )
      violations.push({
        rule: "attack.cleave-needs-hit",
        message: `${action.name} follows an attack with this weapon on ${attacker.name}'s own turn.`
      });
    return;
  }
  const cleave = opened?.cleave;
  if (!cleave || cleave.actorId !== attacker.id || cleave.itemId !== extra.itemId)
    violations.push({
      rule: "attack.cleave-needs-hit",
      message: `${action.name} follows a melee hit with this weapon this turn.`
    });
}

/** The inventory row a weapon swing is made with (`item-<id>`, or a Versatile weapon's `item-<id>-two-handed`), or
 *  null for any other action. */
function swingItemOf(attacker: LiveActor, action: DefinitionAction) {
  if (!isItemActionId(action.id)) return null;
  const rest = itemActionRest(action.id);
  return (
    attacker.inventory.find(
      (item) => item.weapon !== undefined && (item.id === rest || `${item.id}-${TWO_HANDED_SUFFIX}` === rest)
    ) ?? null
  );
}

/** SRD Armor Training: in Light, Medium or Heavy armor you lack training with, "you can't cast spells". Any action
 *  that casts a spell counts, a wand's included. With the catalog, training an item grants counts too (Elven Chain). */
function checkArmorTraining(
  { attacker, action, violations }: Evaluation,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined
) {
  const message = untrainedArmorCast(attacker, action, definition, catalog);
  if (message !== null) violations.push({ rule: "spell.untrained-armor", message });
}

/** Why this action can't be cast in the armor its caster wears, or null; read by the loose route too, so an item's
 *  cast outside a fight meets the same rule. */
export function untrainedArmorCast(
  attacker: LiveActor,
  action: Pick<DefinitionAction, "spellId" | "spellSlot">,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined
): string | null {
  if (action.spellId === undefined && action.spellSlot === undefined) return null;
  const { untrainedArmor } = catalog
    ? deriveEquipment(attacker, definition, catalog)
    : armorTrainingGaps(attacker.inventory, definition);
  return untrainedArmor
    ? `${attacker.name} can't cast spells while wearing ${untrainedArmor.name} without training in it.`
    : null;
}

/** SRD: a Two-Handed weapon "requires two hands when you attack with it", and a Shield is strapped to one arm. Read
 *  from the row, since a magic shield's slot travels on its marker. A Lance is "Two-Handed (unless mounted)": one hand
 *  holds it while its wielder rides (`mounts.ts`). */
function checkHands({ attacker, action, violations }: Evaluation): void {
  const item = swingItemOf(attacker, action);
  if (!item) return;
  const mounted = attacker.effects.some((effect) => effect.tags.includes(RIDING_TAG));
  if (mounted && (item.recordId ?? item.id) === "lance") return;
  const twoHands =
    item.weapon?.properties?.includes("two-handed") === true ||
    itemActionRest(action.id) === `${item.id}-${TWO_HANDED_SUFFIX}`;
  if (!twoHands) return;
  // An animated Shield hovers beside its user and fills no hand.
  const animated = animatedRowIds(attacker);
  const shield = attacker.inventory.find(
    (entry) =>
      entry.equipped &&
      entry.quantity > 0 &&
      entry.armor !== undefined &&
      !animated.has(entry.id) &&
      effectiveSlot({ slot: entry.magic?.slot, category: entry.category }) === "shield"
  );
  if (shield)
    violations.push({
      rule: "attack.two-handed",
      message: `${item.name} needs two hands, and ${attacker.name} has ${shield.name} on one arm. Unequip the shield first.`
    });
}

/** SRD Ammunition: "You can use a weapon that has the Ammunition property to make a ranged attack only if you have
 *  ammunition to fire from it." Unchecked without the catalog, which says what each row is. */
function checkAmmunition({ attacker, action, violations }: Evaluation, catalog: EquipmentCatalog | undefined): void {
  const item = catalog ? swingItemOf(attacker, action) : null;
  if (!item) return;
  const kind = launcherKind(item, catalog);
  if (kind === null || ammunitionFor(attacker, kind, catalog)) return;
  violations.push({
    rule: "attack.no-ammunition",
    message: `${attacker.name} has no ${ammunitionLabel(kind)} to fire from ${item.name}.`
  });
}

/** SRD Spell Scroll: "If the spell is on your spell list, you can read the scroll ... Otherwise, the scroll is
 *  unintelligible." */
function checkScrollLegible(
  { attacker, action, violations }: Evaluation,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined
): void {
  const scroll = scrollOfAction(action, attacker.inventory, catalog);
  if (!scroll) return;
  const reading = scrollReading(definition, scroll.spell, catalog);
  if (!reading.readable) violations.push({ rule: SCROLL_UNREADABLE, message: reading.message });
}

/** SRD Loading: "You can fire only one piece of ammunition from a Loading weapon when you use an action ... to fire
 *  it, regardless of the number of attacks you can normally make." Extra Attack's other swings stay open for
 *  another weapon. */
function checkLoading({ state, attacker, action, onOwnTurn, violations }: Evaluation): void {
  if (!onOwnTurn || action.activation !== "action") return;
  const item = swingItemOf(attacker, action);
  if (!item?.weapon?.properties?.includes("loading")) return;
  const fired = state.combat.turn.extraAttacks?.loading;
  if (fired?.actorId === attacker.id && fired.itemIds.includes(item.id))
    violations.push({
      rule: "attack.loading",
      message: `${action.name} has the Loading property: it fires once per action. Use another weapon for the remaining attacks.`
    });
}

/** Sneak Attack, a smite and the like add their dice to a hit, so they're chosen on the attack's result before it
 *  is confirmed; taken alone they would deal damage with no hit to ride. */
function checkTakenAlone({ state, attacker, action, onOwnTurn, violations }: Evaluation): void {
  // Its cost is spent by the answer itself (`roll-answers.ts`), offered on the roll's own result.
  if (action.answer)
    violations.push({
      rule: "roll.answers-a-roll",
      message: `${action.name} answers a roll: use it on the roll's result, once the roll is shown.`
    });
  // A Metamagic option's own row spends its points with the spell it shapes (`metamagic.ts`).
  else if (isMetamagicOption(action.id) && action.spellId === undefined)
    violations.push({
      rule: "metamagic.with-a-cast",
      message: `${action.name} shapes a spell: choose it on the spell's cast.`
    });
  const rider = hitRiderOf(action);
  if (!rider) return;
  // Brutal Strike is decided before the roll, so its tap stands alone, on the Barbarian's own turn.
  if (rider.declaredBeforeRoll) {
    if (rider.ownTurn && state.combat.active && !onOwnTurn)
      violations.push({
        rule: "economy.not-your-turn",
        message: `${action.name} is used on ${attacker.name}'s own turn.`
      });
    return;
  }
  violations.push({
    rule: "attack.rides-a-hit",
    message: `${action.name} adds to a hit: choose it on the attack's result before you confirm the hit.`
  });
}

const USE_SCOPE_LABELS: Readonly<Record<"turn" | "encounter" | "short-rest" | "long-rest", string>> = {
  turn: "turn",
  encounter: "encounter",
  "short-rest": "Short Rest",
  "long-rest": "Long Rest"
};

function checkLimitedUse({ state, attacker, action, siblings, violations }: Evaluation): EconomyPlan["spendUse"] {
  if (!action.uses) return null;
  // SRD Rage: a raging Barbarian extends it with a Bonus Action, which spends no new use.
  if (action.grants?.tags.includes(RAGING_TAG) && hasEffectTag(attacker, RAGING_TAG)) return null;
  // Taken again to end what it gave (Plate Armor of Etherealness: "repeat the command word"), it spends no new use.
  if (
    action.grants?.toggles &&
    attacker.effects.some((effect) => effect.sourceActionId === action.id && effect.sourceActorId === attacker.id)
  )
    return null;
  const uses = action.uses;
  const key = uses.pool ?? action.id;
  // A cast in the plan its pool's own action opened (the second Fireball of a pit fiend's Hellfire Spellcasting) shares
  // the use that opened it.
  if (paidByOpenPlan(state, attacker, action, key)) return null;
  // The counter is keyed on the pool, so the gate is the pool's size (see `useLimitFor`).
  const limit = useLimitFor(siblings, action);
  const spent =
    uses.per === "turn" ? (state.combat.turn.turnUses[`${attacker.id}:${key}`] ?? 0) : (attacker.actionUses[key] ?? 0);
  // "Whenever it roars, the roar has a different effect": a use that comes in its order since the last rest.
  if (action.useNumber !== undefined && spent + 1 !== action.useNumber && spent < limit)
    violations.push({
      rule: "feature.no-uses-remaining",
      message: `${action.name} comes as use ${action.useNumber} of ${limit}, and ${attacker.name} has spent ${spent}.`
    });
  // Some activations spend several (Lay on Hands' 5-point cure, or the points its user chose).
  const cost = activationCost(action, spent, limit);
  if (spent + cost > limit)
    violations.push({
      rule: "feature.no-uses-remaining",
      message: spent >= limit ? noUsesRemaining(action, limit) : notEnoughUses(action.name, limit - spent, cost)
    });
  // A second limit it counts against too (a Luck Blade's Wish, once a dawn).
  const also = alsoUsesKey(action);
  if (also && (attacker.actionUses[also] ?? 0) >= action.alsoUses!.limit)
    violations.push({ rule: "feature.no-uses-remaining", message: alsoSpentMessage(action) });
  return { key, per: uses.per, amount: cost, ...(also ? { also } : {}) };
}

/** Whether this turn's open action is the plan of the pool's own action (a Hellfire Spellcasting's two casts), with a
 *  place or a replacement left for this one. */
function paidByOpenPlan(state: GameState, attacker: LiveActor, action: DefinitionAction, pool: string): boolean {
  const open = state.combat.turn.actionInstance;
  if (!open || open.actorId !== attacker.id || open.parentId !== pool || state.combat.turnActorId !== attacker.id)
    return false;
  if (placeFor(open.components, action.id) !== null) return true;
  return Object.entries(open.replacements ?? {}).some(([key, left]) => left > 0 && key.split("|").includes(action.id));
}

/** Why a limited-use action is refused, in and out of a fight. */
export function noUsesRemaining(action: DefinitionAction, limit: number): string {
  const uses = action.uses!;
  return `${action.name}: no uses remaining (${
    uses.per === "recharge"
      ? `spent · recharges on ${uses.recharge}+ at the start of its turn`
      : uses.per === "own-turn"
        ? `spent · back at the start of its next turn`
        : uses.per === "never"
          ? `all ${limit} spent · they don't come back`
          : uses.per === "time"
            ? `spent · back after ${uses.afterHours} hours of game time`
            : `${limit}/${USE_SCOPE_LABELS[uses.per]}`
  }).`;
}

type PlanComponent = NonNullable<DefinitionAction["multiattack"]>[number];

/** Whether a Multiattack's plans or replacements name this action. */
function multiattackNames(parent: DefinitionAction, actionId: string): boolean {
  const inPlan = (plan: readonly PlanComponent[]) =>
    plan.some((component) => component.actionId === actionId || (component.or?.includes(actionId) ?? false));
  return (
    [parent.multiattack ?? [], ...(parent.multiattackAlternatives ?? [])].some(inPlan) ||
    (parent.multiattackReplacements ?? []).some((replacement) => replacement.actionIds.includes(actionId))
  );
}

/** The action-slot multiattack parents (sibling actions) whose plans or replacements name `action`. A bonus-action
 *  plan (Flurry of Blows) is not one: its strikes come from the bonus instance, never from an Attack action. */
function multiattackParents(siblings: ReadonlyArray<DefinitionAction>, action: DefinitionAction): DefinitionAction[] {
  return siblings.filter(
    (candidate) =>
      candidate.activation !== "bonus-action" &&
      candidate.multiattack !== undefined &&
      multiattackNames(candidate, action.id)
  );
}

/** A component's key in an open instance: its action's id, or "a|b" when another action can fill its place. */
const componentKey = (component: PlanComponent) =>
  component.or && component.or.length > 0 ? [component.actionId, ...component.or].join("|") : component.actionId;

/** The place in an open instance this action fills: its own, or an "a|b" place naming it. Null when none is left. */
function placeFor(components: Readonly<Record<string, number>>, actionId: string): string | null {
  if ((components[actionId] ?? 0) > 0) return actionId;
  return (
    Object.keys(components).find(
      (key) => (components[key] ?? 0) > 0 && key.includes("|") && key.split("|").includes(actionId)
    ) ?? null
  );
}

/** The replacements a Multiattack's instance starts with, keyed by their actions: one each, or one for every attack
 *  when "any attack" may be replaced. */
function replacementMap(parent: DefinitionAction): Record<string, number> {
  const attacks = Object.values(componentMap(parent.multiattack)).reduce((sum, count) => sum + count, 0);
  return Object.fromEntries(
    (parent.multiattackReplacements ?? []).map((replacement) => [
      replacement.actionIds.join("|"),
      replacement.any ? attacks : 1
    ])
  );
}

type OpenPlan = Readonly<{ components: Record<string, number>; replacements: Record<string, number> }>;

/** What an open instance records of its Multiattack: which one it is, and the replacements it has left (most stat
 *  blocks have none). */
const planRecord = (parentId: string, replacements: Readonly<Record<string, number>>) => ({
  parentId,
  ...(Object.keys(replacements).length > 0 ? { replacements: { ...replacements } } : {})
});

/** SRD "It can replace one attack with a use of Roar": takes the attacks the replacement stands for (the one it names,
 *  else any attack left) and one of its uses. Null when this action isn't one, or nothing is left for it. */
function replaced(
  parent: DefinitionAction,
  open: OpenPlan,
  action: DefinitionAction,
  siblings: ReadonlyArray<DefinitionAction>
): OpenPlan | null {
  const replacement = parent.multiattackReplacements?.find((entry) => entry.actionIds.includes(action.id));
  if (!replacement) return null;
  const key = replacement.actionIds.join("|");
  if ((open.replacements[key] ?? 0) <= 0) return null;
  const isAttack = (place: string) =>
    place.split("|").some((id) => siblings.some((sibling) => sibling.id === id && sibling.attack !== undefined));
  const components = { ...open.components };
  for (let taken = 0; taken < replacement.attacks; taken++) {
    const place = replacement.of
      ? placeFor(components, replacement.of)
      : (Object.keys(components).find((candidate) => (components[candidate] ?? 0) > 0 && isAttack(candidate)) ?? null);
    if (place === null) return null;
    components[place] -= 1;
  }
  return { components, replacements: { ...open.replacements, [key]: open.replacements[key] - 1 } };
}

/** The Multiattack instance this action opens: its place taken in the plan, or in a plan the Multiattack can be instead,
 *  or as a replacement. Null when it fills none. */
function openedBy(
  parent: DefinitionAction,
  action: DefinitionAction,
  siblings: ReadonlyArray<DefinitionAction>
): OpenPlan | null {
  const replacements = replacementMap(parent);
  for (const plan of [parent.multiattack ?? [], ...(parent.multiattackAlternatives ?? [])]) {
    const components = componentMap(plan);
    const place = placeFor(components, action.id);
    if (place === null) continue;
    components[place] -= 1;
    return { components, replacements };
  }
  return replaced(parent, { components: componentMap(parent.multiattack), replacements }, action, siblings);
}

/** The attacks left after the first of a count-based attack. Weapon attacks share a generic pool, so Extra Attack can
 *  mix weapons legally; a spell's rays or beams are that spell's alone, never a swing of the Attack action. */
function attackPool(action: DefinitionAction): Record<string, number> {
  const left = (action.attack?.count ?? 1) - 1;
  // Attacks a weapon gives only itself (Thirsting Blade's pact weapon) are that weapon's, held in either grip.
  if (action.attack?.countWithItself && action.spellId === undefined) {
    const base = action.id.replace(new RegExp(`-${TWO_HANDED_SUFFIX}$`), "");
    return { [`${base}|${base}-${TWO_HANDED_SUFFIX}`]: left };
  }
  return action.spellId === undefined ? { attack: left } : { [action.id]: left };
}

/** The slot level of an open spell this resolve continues (Scorching Ray's second ray), or null when it opens a cast.
 *  An instance from before it recorded its slot rolls at the spell's own level. */
function continuedSpellSlot({
  state,
  attacker,
  action
}: Pick<Evaluation, "state" | "attacker" | "action">): number | null {
  const open = state.combat.turn.actionInstance;
  const onOwnTurn = state.combat.turnActorId === attacker.id;
  // A readied spell is released at the level its slot was spent at when it was readied (SRD Ready).
  const held = onOwnTurn ? undefined : heldReadiedSpell(attacker, action.id);
  if (action.spellSlot && held) return held.level;
  // A spell's rays cast as a Bonus Action (Quickened Spell) continue the Bonus Action's own instance.
  const bonusOpen = state.combat.turn.bonusActionInstance;
  if (action.spellSlot && onOwnTurn && state.combat.turn.bonusActionUsed && bonusOpen?.actorId === attacker.id)
    if ((bonusOpen.components[action.id] ?? 0) > 0) return bonusOpen.slotLevel ?? action.spellSlot.level;
  if (!action.spellSlot || !onOwnTurn || !state.combat.turn.actionUsed || open?.actorId !== attacker.id) return null;
  return (open.components[action.id] ?? 0) > 0 ? (open.slotLevel ?? action.spellSlot.level) : null;
}

/** The slot level a resolve of this action casts at, as the economy will plan it: the open spell's it continues, or
 *  the slot it would spend. Null for an action cast without a slot. */
export function castLevelOf(
  state: GameState,
  attacker: LiveActor,
  action: DefinitionAction,
  requested: number | undefined
): number | null {
  if (!action.spellSlot) return null;
  return continuedSpellSlot({ state, attacker, action }) ?? castSlot(attacker, action.spellSlot.level, requested).level;
}

/** A plan's components as an open instance counts them. */
function componentMap(plan: readonly PlanComponent[] | undefined): Record<string, number> {
  const components: Record<string, number> = {};
  for (const entry of plan ?? []) {
    const key = componentKey(entry);
    components[key] = (components[key] ?? 0) + entry.count;
  }
  return components;
}

/** On its turn the bearer can do only one of these: move, take an action, or take a Bonus Action (a Rogue's Daze,
 *  Abjure Foes' Frightened). */
export const DAZED_TAG = "dazed";

/** Refuses a second of the three things a dazed creature may do on its turn; a move it made counts as its one. */
function checkDazed({ state, attacker, action, onOwnTurn, resolveDefinition, violations }: Evaluation): void {
  if (!onOwnTurn || (action.activation !== "action" && action.activation !== "bonus-action")) return;
  const dazed = attacker.effects.find((effect) => effect.tags.includes(DAZED_TAG));
  if (!dazed) return;
  const turn = state.combat.turn;
  const done =
    turn.movementUsedFeet > 0
      ? "moved"
      : action.activation === "action" && turn.bonusActionUsed
        ? "taken a Bonus Action"
        : action.activation === "bonus-action" && turn.actionUsed
          ? "taken an action"
          : null;
  if (done)
    violations.push({
      rule: action.activation === "action" ? "economy.action-used" : "economy.bonus-action-used",
      message: `${attacker.name} has ${done} this turn, and ${shownEffectName(state, dazed, resolveDefinition)} leaves only one of moving, an action or a Bonus Action.`
    });
}

type SlotPlan = Pick<
  EconomyPlan,
  "markAction" | "markBonus" | "markReaction" | "instance" | "bonusInstance" | "extraAction"
>;

/** The action, Bonus Action and reaction slots, with the compound instance an action or Bonus Action opens or
 *  continues. */
function checkActionSlots(evaluation: Evaluation): SlotPlan {
  const { state, attacker, action, onOwnTurn, violations } = evaluation;
  const unchanged: SlotPlan = {
    markAction: false,
    markBonus: false,
    markReaction: false,
    instance: state.combat.turn.actionInstance,
    bonusInstance: state.combat.turn.bonusActionInstance,
    extraAction: null
  };
  // Outside a fight there is no turn: a cast spends no action, Bonus Action or Reaction.
  if (!state.combat.active) return unchanged;
  // An open compound Bonus Action (Flurry of Blows) spends its own strikes first and costs no further slot.
  const bonusOpen = state.combat.turn.bonusActionInstance;
  if (onOwnTurn && bonusOpen && bonusOpen.actorId === attacker.id && !action.multiattack) {
    const components = { ...bonusOpen.components };
    const key =
      (components[action.id] ?? 0) > 0 ? action.id : action.attack && (components.attack ?? 0) > 0 ? "attack" : null;
    if (key) {
      components[key] -= 1;
      return { ...unchanged, bonusInstance: { ...bonusOpen, components } };
    }
  }
  checkDazed(evaluation);
  // SRD Slow: "On its turns, it can take either an action or a Bonus Action, not both." A copper dragon's Slowing
  // Breath says the same.
  const slowed = onOwnTurn
    ? attacker.effects.find((effect) => effect.tags.includes(SLOWED_TAG) || effect.tags.includes(ACTION_OR_BONUS_TAG))
    : undefined;
  if (slowed && action.activation === "bonus-action" && state.combat.turn.actionUsed)
    violations.push({
      rule: "economy.bonus-action-used",
      message: `${attacker.name} took an action this turn, and ${shownEffectName(state, slowed, evaluation.resolveDefinition)} leaves no Bonus Action as well.`
    });
  if (slowed && action.activation === "action" && !state.combat.turn.actionUsed && state.combat.turn.bonusActionUsed)
    violations.push({
      rule: "economy.action-used",
      message: `${attacker.name} took a Bonus Action this turn, and ${shownEffectName(state, slowed, evaluation.resolveDefinition)} leaves no action as well.`
    });
  if (onOwnTurn && action.activation === "bonus-action") {
    if (state.combat.turn.bonusActionUsed && evaluation.freeBonusAction !== true)
      violations.push({
        rule: "economy.bonus-action-used",
        message: `${attacker.name} has already used a Bonus Action this turn.`
      });
    // A compound Bonus Action opens its plan, which later swings spend (no rolls are consumed opening it); a spell's
    // rays cast as one (Quickened Scorching Ray) open the rest of its rays.
    return {
      ...unchanged,
      markBonus: true,
      ...(action.multiattack
        ? { bonusInstance: { actorId: attacker.id, components: componentMap(action.multiattack) } }
        : action.spellId !== undefined && (action.attack?.count ?? 1) > 1
          ? { bonusInstance: { actorId: attacker.id, components: attackPool(action) } }
          : {})
    };
  }
  if (onOwnTurn && action.activation === "action") return checkActionSlot(evaluation);
  const readied = isReadiedResponse(state, attacker, action);
  // A released spell's later rays come with the Reaction its first ray took.
  if (readied && heldReadiedSpell(attacker, action.id)?.raysLeft !== undefined) return unchanged;
  if (action.activation === "reaction" || readied) {
    // A hydra's heads beyond one each give it another Reaction for Opportunity Attacks (Reactive Heads).
    const spareHead =
      evaluation.opportunity === true &&
      evaluation.resolveDefinition !== undefined &&
      spareOpportunityReactions(attacker, evaluation.resolveDefinition) > 0;
    if (spareHead) return { ...unchanged, markReaction: true };
    if (state.combat.reactionsUsed.includes(attacker.id))
      violations.push({
        rule: "economy.reaction-used",
        message: readied
          ? `${attacker.name} has no reaction left to take the readied action with.`
          : `${attacker.name} has already used a reaction this round.`
      });
    // Dominate Person: "You can command the target to take a Reaction but must take your own Reaction to do so."
    else if (reactionSpent(state, attacker.id))
      violations.push({
        rule: "economy.reaction-used",
        message: `${attacker.name}'s Reaction takes its commander's, which is spent this round.`
      });
    return { ...unchanged, markReaction: true };
  }
  return unchanged;
}

/** A fresh action: opens a compound instance when the action (or its multiattack parent) declares one. Haste's
 *  action is "the Attack action (one attack only)", so it opens no further attacks. */
function freshActionSlot(
  { state, attacker, action, siblings, notes }: Evaluation,
  extraAction: EconomyPlan["extraAction"]
): SlotPlan {
  const parents = multiattackParents(siblings, action);
  let components: Record<string, number> | null = null;
  let multiattack: ReturnType<typeof planRecord> | null = null;
  const opened = extraAction !== "haste" && parents.length === 1 ? openedBy(parents[0], action, siblings) : null;
  // Haste's additional action makes one attack only, and so does the Attack action of a creature under Slow (a
  // monster's Multiattack is the GM's to judge).
  const slowed =
    action.spellId === undefined &&
    !action.multiattack &&
    parents.length === 0 &&
    attacker.effects.some((effect) => effect.tags.includes(SLOWED_TAG));
  if (extraAction === "haste" || slowed) {
    components = action.attack || action.replacesAttack ? {} : null;
  } else if (action.multiattack) {
    // Resolving the parent itself opens the full plan, no rolls consumed.
    components = componentMap(action.multiattack);
    multiattack = planRecord(action.id, replacementMap(action));
  } else if (opened) {
    components = opened.components;
    multiattack = planRecord(parents[0].id, opened.replacements);
  } else if (parents.length > 1) {
    if (action.attack && (action.attack.count ?? 1) > 1) components = attackPool(action);
    notes.push(`${action.name} belongs to more than one Multiattack, so it is tracked on its own.`);
  } else if (action.attack && (action.attack.count ?? 1) > 1) {
    components = attackPool(action);
  } else if (action.replacesAttack && attacksInAttackAction(siblings) > 1) {
    // Breath Weapon as the first attack of the Attack action: the rest stay open for weapon swings.
    components = { attack: attacksInAttackAction(siblings) - 1 };
  }
  // The instance stays even when exhausted so a further resolve gets "no attacks remaining".
  return {
    markAction: true,
    markBonus: false,
    markReaction: false,
    instance: components ? { actorId: attacker.id, components, ...(multiattack ?? {}) } : null,
    bonusInstance: state.combat.turn.bonusActionInstance,
    extraAction
  };
}

/** The Magic action: casting a spell whose casting time is an action, or using a feature or item that says so. */
export function isMagicAction(
  action: Pick<DefinitionAction, "id" | "activation" | "spellId" | "spellSlot" | "description">
) {
  return (
    action.id === "magic" ||
    (action.activation === "action" &&
      (action.spellId !== undefined || action.spellSlot !== undefined || /\bMagic action\b/i.test(action.description)))
  );
}

/** SRD Haste: "That action can be used to take only the Attack (one attack only), Dash, Disengage, Hide, or Utilize
 *  action." */
function hasteAllows(action: DefinitionAction): boolean {
  if (["dash", "disengage", "hide", "utilize"].includes(action.id)) return true;
  return (
    action.activation === "action" &&
    action.multiattack === undefined &&
    action.spellId === undefined &&
    (action.attack !== undefined || action.replacesAttack === true)
  );
}

/** An action beyond the creature's one this turn: Haste's (each turn, from its limited list) or one Action Surge
 *  gave (any but a second Magic action). `reason` says why neither can take this one. */
function extraActionFor({ state, attacker, action }: Evaluation): {
  kind: EconomyPlan["extraAction"];
  reason: string | null;
} {
  const extra = state.combat.turn.extraActions?.actorId === attacker.id ? state.combat.turn.extraActions : undefined;
  const hasteReady = hasEffectTag(attacker, HASTED_TAG) && extra?.hasteUsed !== true;
  if (hasteReady && hasteAllows(action)) return { kind: "haste", reason: null };
  if ((extra?.surges ?? 0) > 0) {
    if (isMagicAction(action) && (extra?.magicActions ?? 0) > 0)
      return { kind: null, reason: "Action Surge's additional action can't be a second Magic action." };
    return { kind: "surge", reason: null };
  }
  return {
    kind: null,
    reason: hasteReady
      ? "Haste's additional action takes only the Attack (one attack only), Dash, Disengage, Hide or Utilize action."
      : null
  };
}

function checkActionSlot(evaluation: Evaluation): SlotPlan {
  const { state, attacker, action, siblings, proseMultiattack, violations, softViolations } = evaluation;
  const slotViolations = proseMultiattack ? softViolations : violations;
  const current = state.combat.turn.actionInstance;
  const active = current && current.actorId === attacker.id ? current : null;
  if (!state.combat.turn.actionUsed) return freshActionSlot(evaluation, null);
  const plan = {
    markAction: false,
    markBonus: false,
    markReaction: false,
    bonusInstance: state.combat.turn.bonusActionInstance,
    extraAction: null
  };
  // The action is spent: an extra action (Action Surge, Haste) takes this one, or it is refused.
  const refuse = (message: string, instance: SlotPlan["instance"]): SlotPlan => {
    const extra = extraActionFor(evaluation);
    if (extra.kind !== null) return freshActionSlot(evaluation, extra.kind);
    slotViolations.push({
      rule: "economy.action-used",
      message: extra.reason === null ? message : `${message} ${extra.reason}`
    });
    return { ...plan, instance };
  };
  if (!active) return refuse(`${attacker.name} has already used an action this turn.`, current);
  const parent = active.parentId ? siblings.find((candidate) => candidate.id === active.parentId) : undefined;
  const continued = (open: OpenPlan): SlotPlan => ({
    ...plan,
    instance: {
      actorId: attacker.id,
      components: open.components,
      ...(active.slotLevel !== undefined ? { slotLevel: active.slotLevel } : {}),
      ...(active.shaping !== undefined ? { shaping: active.shaping } : {}),
      // A leaping Chromatic Orb keeps who it struck (`orb-leap.ts`).
      ...(active.leap !== undefined ? { leap: active.leap } : {}),
      ...(active.parentId !== undefined ? planRecord(active.parentId, open.replacements) : {})
    }
  });
  const components = { ...active.components };
  const replacements = { ...(active.replacements ?? {}) };
  const componentName = (key: string) =>
    key === "attack"
      ? "attack"
      : key
          .split("|")
          .map((id) => siblings.find((candidate) => candidate.id === id)?.name ?? id)
          .join(" or ");
  const leftovers = () =>
    Object.entries(components)
      .filter(([, count]) => count > 0)
      .map(([key, count]) => `${count}× ${componentName(key)}`);
  if (action.multiattack) {
    // Tapping the Multiattack plan mid-instance continues it and breaks no rule.
    if (leftovers().length === 0) return refuse(`${attacker.name} has no attacks remaining in this action.`, current);
    return continued({ components, replacements });
  }
  const place = placeFor(components, action.id);
  if (place !== null) {
    components[place] -= 1;
    return continued({ components, replacements });
  }
  if (((action.attack && action.spellId === undefined) || action.replacesAttack) && (components["attack"] ?? 0) > 0) {
    components["attack"] -= 1;
    return continued({ components, replacements });
  }
  if (parent) {
    // A replacement takes attacks' places; an action from a plan the Multiattack can be instead switches to it, so long
    // as nothing of this plan was taken yet.
    const swapped = replaced(parent, { components, replacements }, action, siblings);
    if (swapped) return continued(swapped);
    const untouched = Object.entries(componentMap(parent.multiattack)).every(
      ([key, count]) => (components[key] ?? 0) === count
    );
    for (const alternative of untouched ? (parent.multiattackAlternatives ?? []) : []) {
      const switched = componentMap(alternative);
      const at = placeFor(switched, action.id);
      if (at === null) continue;
      switched[at] -= 1;
      return continued({ components: switched, replacements });
    }
  }
  const named = leftovers();
  return refuse(
    named.length > 0
      ? `${attacker.name} has no ${action.name} left in this action. Remaining: ${named.join(", ")}.`
      : `${attacker.name} has no attacks remaining in this action.`,
    current
  );
}

/** How many attacks the Attack action makes: the most any one attack action makes, which is where Extra Attack is
 *  folded (weapon swings and the Unarmed Strike). Spells and Multiattack plans are not the Attack action. */
function attacksInAttackAction(siblings: ReadonlyArray<DefinitionAction>): number {
  return siblings.reduce(
    (most, candidate) =>
      candidate.attack && candidate.activation === "action" && !candidate.multiattack && !candidate.spellId
        ? Math.max(most, candidate.attack.count ?? 1)
        : most,
    1
  );
}

/** SRD Legendary Actions: taken at the end of other creatures' turns from a per-round pool that refills
 *  on the creature's own turn. Pool size defaults to 3. */
function checkLegendary(
  { state, attacker, action, onOwnTurn, violations }: Evaluation,
  definition: ActorDefinition | undefined
): EconomyPlan["spendLegendary"] {
  if (!action.legendary) return null;
  const cost = action.legendary.cost;
  const perRound = legendaryActionsPerRound(attacker, definition);
  const spent = state.combat.legendaryUsed[attacker.id] ?? 0;
  if (onOwnTurn)
    violations.push({
      rule: "legendary.own-turn",
      message: `Legendary actions are taken right after other creatures' turns, and this is ${attacker.name}'s own.`
    });
  // "Immediately after another creature's turn": the window a turn's end opens, one action a window.
  if (!onOwnTurn && state.combat.active && !legendaryWindowOpen(state, attacker.id))
    violations.push({
      rule: "legendary.after-a-turn",
      message: `${attacker.name} takes a legendary action right after another creature's turn ends, one each time, before the next creature acts.`
    });
  if (spent + cost > perRound)
    violations.push({
      rule: "legendary.no-actions-remaining",
      message: `${attacker.name} has ${Math.max(0, perRound - spent)} of ${perRound} legendary action${perRound === 1 ? "" : "s"} left this round${cost > 1 ? ` and ${action.name} costs ${cost}` : ""}.`
    });
  // "Can't take this action again until the start of its next turn": marked beside the pool, cleared with it.
  const onceKey = action.legendary.oncePerRound ? legendaryOnceKey(attacker.id, action.id) : null;
  if (onceKey !== null && (state.combat.legendaryUsed[onceKey] ?? 0) > 0)
    violations.push({
      rule: "legendary.once-per-round",
      message: `${attacker.name} can't take ${action.name} again until the start of its next turn.`
    });
  return { cost, ...(onceKey !== null ? { onceKey } : {}) };
}

/** Whether a creature may take a legendary action now: a turn other than its own has just ended, it hasn't taken one
 *  since, and the creature whose turn it is now hasn't done anything yet. */
export function legendaryWindowOpen(state: GameState, actorId: string): boolean {
  const turn = state.combat.turn;
  if (turn.afterActorId === undefined || turn.afterActorId === actorId) return false;
  if (turn.legendaryTakenBy?.includes(actorId)) return false;
  const current = state.combat.turnActorId;
  return !(
    turn.actionUsed ||
    turn.bonusActionUsed ||
    turn.movementUsedFeet > 0 ||
    turn.attackRolled === true ||
    turn.actionInstance !== null ||
    Object.keys(turn.turnUses).some((key) => key.startsWith(`${current}:`))
  );
}

/** Where `combat.legendaryUsed` marks a legendary action taken once until the creature's next turn, beside the
 *  creature's own spent count (keyed by its id alone). */
export const legendaryOnceKey = (actorId: string, actionId: string) => `${actorId}:${actionId}`;

/** A spell cast with a slot (a prepared spell, or an item cast with `consumesSpellSlot`) spends one from the
 *  caster's own pools at `castSlot`; refused here if none remains or the slot is below the spell. */
function checkSpellSlot({ state, attacker, action, slotLevel, violations }: Evaluation): EconomyPlan["spendSpellSlot"] {
  if (!action.spellSlot) return null;
  const { level, pact } = castSlot(attacker, action.spellSlot.level, slotLevel);
  if (level < action.spellSlot.level)
    violations.push({
      rule: "slots.below-spell-level",
      message: `${action.name} needs a slot of level ${action.spellSlot.level} or higher.`
    });
  else if (slotsLeft(attacker, level, pact) <= 0) {
    violations.push({
      rule: "slots.none-remaining",
      message: `${action.name} spends a level ${level} ${pact ? "Pact Magic" : "spell"} slot, and ${attacker.name} has none left.`
    });
  }
  // SRD: "On a turn, you can expend only one spell slot to cast a spell", whoever's turn it is.
  if (state.combat.active && state.combat.turn.spellSlotCasters?.includes(attacker.id))
    violations.push({
      rule: "slots.one-per-turn",
      message: `${attacker.name} has already cast a spell with a spell slot this turn, and only one is allowed per turn.`
    });
  return pact ? { level, pact: true } : { level };
}

/** Why a spell cast with a slot is refused for not being prepared (SRD: you cast the spells you have prepared), or
 *  null. Cantrips, always-prepared spells, anything not on the sheet's list (an item's cast) and a sheet that keeps
 *  no prepared list (an import with no prepared cap) need nothing, except a Book of Shadows' spells, which are
 *  prepared only while the book is carried. */
export function unpreparedSpell(
  actor: Pick<LiveActor, "name" | "preparedSpellIds"> & Partial<Pick<LiveActor, "inventory">>,
  action: Pick<DefinitionAction, "id" | "spellSlot" | "spellId">,
  definition: ActorDefinition | undefined
): string | null {
  if (action.spellId === undefined) return null;
  const entry = definition?.spellcasting?.spells.find((candidate) => candidate.id === action.spellId);
  const book = entry && !isItemActionId(action.id) ? bookOfShadowsGap(actor, entry, definition) : null;
  if (book) return book;
  // A slot cast, or a Ritual ("To cast a spell as a Ritual, a spellcaster must have it prepared").
  const ritual = action.id === ritualSpellActionId(action.spellId);
  if (!action.spellSlot && !ritual) return null;
  const spell = definition?.spellcasting?.spells.find((entry) => entry.id === action.spellId);
  if (!spell || spell.level === 0 || spell.alwaysPrepared || actor.preparedSpellIds.includes(spell.id)) return null;
  const classes = definition!.spellcasting!.classes ?? [];
  const casting = classes.length === 1 ? classes[0] : classes.find((entry) => entry.classId === spell.classId);
  if (casting?.prepared === undefined) return null;
  // The Wizard's Ritual Adept: "You can cast any spell as a Ritual if that spell has the Ritual tag and the spell is
  // in your spellbook. You needn't have the spell prepared, but you must read from the book to cast a spell in this
  // way." A Wizard's spells on the sheet are its spellbook.
  if (ritual && casting.classId === "wizard" && hasClassFeature(definition, "ritual-adept", "wizard"))
    return carriesSpellbook({ inventory: actor.inventory ?? [] })
      ? null
      : `${actor.name} hasn't prepared ${spell.name}, and casting it as a Ritual unprepared needs the spellbook to read from.`;
  return `${actor.name} hasn't prepared ${spell.name}.`;
}

type SlotPools = Pick<LiveActor, "spellSlots"> & Partial<Pick<LiveActor, "pactSlots">>;

/** The slots left in one pool at one level. */
export function slotsLeft(actor: SlotPools, level: number, pact: boolean): number {
  if (pact) return actor.pactSlots?.level === level ? actor.pactSlots.remaining : 0;
  return actor.spellSlots?.find((slot) => slot.level === level)?.remaining ?? 0;
}

/**
 * The slot a cast spends (SRD: Pact Magic slots and spell slots each cast either class's spells): the level asked
 * for; else the spell's own level when a slot is left there; else the lowest above it with one left. At a level both
 * pools have, a Pact Magic slot goes first, since a Short Rest brings it back. With none left anywhere, a Pact Magic
 * caster's refusal names its pact slot.
 */
export function castSlot(
  actor: SlotPools,
  base: number,
  requested: number | undefined
): { level: number; pact: boolean } {
  const pact = actor.pactSlots && actor.pactSlots.level >= base ? actor.pactSlots : null;
  if (requested !== undefined) {
    const usePact = pact?.level === requested && (pact.remaining > 0 || slotsLeft(actor, requested, false) <= 0);
    return { level: requested, pact: usePact };
  }
  const open = [
    ...(actor.spellSlots ?? [])
      .filter((slot) => slot.level >= base && slot.remaining > 0)
      .map((slot) => ({ level: slot.level, pact: false })),
    ...(pact && pact.remaining > 0 ? [{ level: pact.level, pact: true }] : [])
  ].sort((left, right) => left.level - right.level || Number(right.pact) - Number(left.pact));
  if (open[0]) return open[0];
  const anySpellSlots = (actor.spellSlots ?? []).some((slot) => slot.level >= base);
  return pact && !anySpellSlots ? { level: pact.level, pact: true } : { level: base, pact: false };
}

/** The slot level a cast spends; see `castSlot`. */
export function castSlotLevel(actor: SlotPools, base: number, requested: number | undefined): number {
  return castSlot(actor, base, requested).level;
}

/** Spends one slot from the pool `castSlot` picked, clamped at zero: an override spends what is there and never
 *  goes into debt. */
export function spendSlot(actor: SlotPools, slot: Readonly<{ level: number; pact?: boolean }>): void {
  if (slot.pact) {
    if (actor.pactSlots?.level === slot.level)
      actor.pactSlots = { ...actor.pactSlots, remaining: Math.max(0, actor.pactSlots.remaining - 1) };
    return;
  }
  actor.spellSlots = (actor.spellSlots ?? []).map((entry) =>
    entry.level === slot.level ? { ...entry, remaining: Math.max(0, entry.remaining - 1) } : entry
  );
}

/** Who and what this action may target: declared target rules, range and reach, size limits and Charmed. */
function checkTargeting(
  evaluation: Evaluation,
  distanceFeet: ((actorIdA: string, actorIdB: string) => number | null) | undefined
): void {
  const { state, attacker, action, targetIds, violations } = evaluation;
  const targets = targetIds.flatMap((targetId) => {
    const target = state.actors.find((candidate) => candidate.id === targetId);
    return target ? [target] : [];
  });

  // Targeting restrictions the definition declares (Tail can't target the creature this crocodile grapples).
  if (action.targetRules?.includes("not-grappled-by-source")) {
    for (const target of targets) {
      if (target.effects.some((effect) => effect.sourceActorId === attacker.id && effect.tags.includes("grapple"))) {
        violations.push({
          rule: "target.grappled-by-source",
          message: `${target.name} is grappled by ${attacker.name} and can't be targeted by ${action.name}.`
        });
      }
    }
  }

  if (action.attack !== undefined && distanceFeet !== undefined) checkRange(evaluation, distanceFeet);

  // Cleave (SRD): a second creature, within 5 feet of the first (when the map can tell). Horde Breaker: "a different
  // creature that is within 5 feet of the original target ... and that you haven't attacked this turn".
  const kind = action.extraAttack?.kind;
  const first =
    kind === "cleave"
      ? state.combat.turn.extraAttacks?.cleave
      : kind === "horde-breaker"
        ? state.combat.turn.extraAttacks?.horde
        : null;
  const feature = kind === "horde-breaker" ? "Horde Breaker" : "Cleave";
  if (first && first.actorId === attacker.id) {
    for (const target of targets) {
      if (target.id === first.targetId) {
        violations.push({
          rule: "attack.cleave-same-target",
          message: `${target.name} took the attack that set off ${feature}. Choose a second creature for the extra attack.`
        });
        continue;
      }
      if (kind === "horde-breaker" && dealt(state, attacker.id, "attacked", target.id))
        violations.push({
          rule: "attack.cleave-same-target",
          message: `${attacker.name} has already attacked ${target.name} this turn, and Horde Breaker needs a creature it hasn't.`
        });
      const apart = distanceFeet?.(first.targetId, target.id) ?? null;
      if (apart !== null && apart > 5 + DISTANCE_TOLERANCE_FEET)
        violations.push({
          rule: "attack.cleave-too-far",
          message: `${target.name} is ${Math.round(apart * 10) / 10} ft from the target ${feature} follows; it must be within 5 feet of it.`
        });
    }
  }

  // SRD Help: "You momentarily distract an enemy within 5 feet of you."
  if (builtinHandlerFor(action.id)?.distractsAnEnemy) {
    for (const target of targets) {
      if (target.id === attacker.id || areAllies(attacker, target, evaluation.resolveDefinition))
        violations.push({
          rule: "target.not-an-enemy",
          message:
            target.id === attacker.id
              ? `${action.name} distracts an enemy, so ${attacker.name} can't target itself.`
              : `${target.name} is ${attacker.name}'s ally, and ${action.name} distracts an enemy.`
        });
      const apart = distanceFeet?.(attacker.id, target.id) ?? null;
      if (apart !== null && apart > 5 + DISTANCE_TOLERANCE_FEET)
        violations.push({
          rule: "range.out-of-reach",
          message: `${target.name} is ${Math.round(apart * 10) / 10} ft away; ${action.name} distracts an enemy within 5 feet.`
        });
    }
  }

  // Unarmed grapple/shove only work on targets at most one size larger (SRD Unarmed Strike).
  if (builtinHandlerFor(action.id)?.atMostOneSizeLarger) {
    for (const target of targets) {
      if (sizeRank(target.size) > sizeRank(attacker.size) + 1) {
        violations.push({
          rule: "target.too-large-to-grapple",
          message: `${target.name} is more than one size larger than ${attacker.name} and can't be grappled or shoved.`
        });
      }
    }
  }

  // SRD Charmed: can't attack or harm the charmer. Enforceable only when the condition rides a
  // source-linked effect naming the charmer. A Paladin's Aura of Devotion takes its effect away while there.
  const charmWarded =
    evaluation.resolveDefinition !== undefined &&
    wardingAura(state, attacker, "charmed", {
      resolveDefinition: evaluation.resolveDefinition,
      ...(distanceFeet ? { distanceFeet } : {})
    }) !== null;
  // "You can't attack the charmer or target the charmer with damaging abilities or magical effects": a spell, from a
  // sheet or an item, is magical whether it harms or helps.
  const magical = action.spellId !== undefined;
  if (
    !charmWarded &&
    (action.attack !== undefined || action.save !== undefined || action.damage.length > 0 || magical)
  ) {
    // Only while the creature is Charmed: a hand cleared it, or an effect holds it off (Calm Emotions), and the bar
    // lifts.
    const charmed = attacker.conditions.some((condition) => condition.id === "charmed");
    const charmers = attacker.effects.filter(
      (effect) => charmed && effect.linkedConditionIds.includes("charmed") && effect.sourceActorId !== null
    );
    for (const targetId of targetIds) {
      const charmer = charmers.find((effect) => effect.sourceActorId === targetId);
      if (charmer) {
        const target = state.actors.find((candidate) => candidate.id === targetId);
        violations.push({
          rule: "condition.charmed-charmer",
          message: `${attacker.name} is Charmed by ${target?.name ?? charmer.sourceName ?? "its charmer"} and can't target them with harmful or magical effects.`
        });
      }
    }
  }
}

/** Range/reach (SRD): checked only when distance is measurable. A thrown weapon is legal in either
 *  envelope; long-range disadvantage lives in the attack roll's sources. */
function checkRange(
  { state, attacker, action, targetIds, violations }: Evaluation,
  distanceFeet: (actorIdA: string, actorIdB: string) => number | null
): void {
  const attackReach = action.attack!.reachFeet;
  const attackRange = action.attack!.rangeFeet;
  for (const targetId of targetIds) {
    const distance = distanceFeet(attacker.id, targetId);
    if (distance === null) continue;
    const targetName = state.actors.find((candidate) => candidate.id === targetId)?.name ?? "The target";
    const withinReach = attackReach !== undefined && distance <= attackReach + DISTANCE_TOLERANCE_FEET;
    const rounded = Math.round(distance * 10) / 10;
    if (withinReach) continue;
    if (attackRange !== undefined) {
      if (distance > attackRange + DISTANCE_TOLERANCE_FEET)
        violations.push({
          rule: "range.out-of-range",
          message: `${targetName} is ${rounded} ft away, beyond the ${attackRange} ft maximum range.`
        });
      // SRD Underwater Combat: a ranged attack automatically misses beyond normal range.
      else if (state.combat.underwater) {
        const normal = action.attack!.rangeNormalFeet ?? attackRange;
        if (distance > normal + DISTANCE_TOLERANCE_FEET)
          violations.push({
            rule: "range.underwater",
            message: `${targetName} is ${rounded} ft away; underwater, ranged attacks automatically miss beyond normal range (${normal} ft).`
          });
      }
    } else {
      const reach = attackReach ?? 5;
      if (distance > reach + DISTANCE_TOLERANCE_FEET)
        violations.push({
          rule: "range.out-of-reach",
          message: `${targetName} is ${rounded} ft away, beyond ${attacker.name}'s ${reach} ft reach.`
        });
    }
  }
}

/** Validates against the rules mode and plans the economy commitment (ADR-0020): strict rejects with an
 *  override path, assisted warns, freeform skips. An override waives only the families it names. */
export function planEconomy(
  state: GameState,
  attacker: LiveActor,
  action: DefinitionAction,
  input: ResolveInput,
  definition: ActorDefinition | undefined,
  warnings: string[],
  distanceFeet: ((actorIdA: string, actorIdB: string) => number | null) | undefined,
  siblings: ReadonlyArray<DefinitionAction>,
  asHitRider = false,
  catalog?: EquipmentCatalog,
  spell?: SpellReference,
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined
): { plan: EconomyPlan; overridden: { rule: RuleId; reason: string } | null } {
  const { violations, softViolations, plan, proseMultiattack, notes } = evaluateActionEconomy(
    state,
    attacker,
    action,
    input.targetIds,
    definition,
    distanceFeet,
    siblings,
    input.slotLevel,
    asHitRider,
    catalog,
    spell,
    resolveDefinition,
    {
      ...(input.silenced === true ? { silenced: true } : {}),
      ...(input.areaPlaced === true ? { areaPlaced: true } : {}),
      ...(input.shaping && input.shaping.length > 0 ? { shaping: input.shaping } : {}),
      ...(input.attackKinds?.includes("opportunity") ? { opportunity: true } : {})
    }
  );
  warnings.push(...notes);

  // The mode is per rule family: a violation whose family is Off is not a violation for this table.
  const rules = rulesInForce(state);
  const policed = [...violations, ...softViolations].filter(
    (violation) => effectiveModeFor(rules, violation.rule) !== "freeform"
  );
  if (policed.length === 0) return { plan, overridden: null };
  // This command's override, or a GM override earlier this turn, covers its families; other families still
  // block or warn.
  const waived = policed.find((violation) => overrideWaives(input.override, violation.rule));
  const covered = (rule: RuleId) => overrideWaives(input.override, rule) || overrideCovers(state.combat.turn, rule);
  const blocking = violations.filter(
    (violation) => !covered(violation.rule) && effectiveModeFor(rules, violation.rule) === "strict"
  );
  if (blocking.length > 0) throw new RulesBlockedError(blocking[0].rule, blocking[0].message);
  warnings.push(...policed.filter((violation) => !covered(violation.rule)).map((violation) => violation.message));
  if (proseMultiattack && softViolations.some((violation) => !covered(violation.rule)))
    warnings.push(`${attacker.name}'s Multiattack is prose only, so extra attacks aren't validated.`);
  return { plan, overridden: waived ? { rule: waived.rule, reason: overrideReason(input.override) } : null };
}

/** Commits the validated economy plan (ADR-0020): slots, compound instance, limited uses, legendary
 *  actions and spell slots. A GM override covers its rule family for the rest of this creature's turn. */
export function commitEconomy({
  state,
  attacker,
  input,
  plan,
  overridden
}: Pick<ResolveContext, "state" | "attacker" | "plan" | "overridden"> & {
  input: Pick<ResolveInput, "override">;
}): void {
  const instance = plan.instance
    ? {
        actorId: plan.instance.actorId,
        components: { ...plan.instance.components },
        ...(plan.instance.slotLevel !== undefined ? { slotLevel: plan.instance.slotLevel } : {}),
        ...(plan.instance.shaping !== undefined
          ? { shaping: plan.instance.shaping.map((entry) => ({ ...entry })) }
          : {}),
        ...(plan.instance.leap !== undefined
          ? { leap: { ...plan.instance.leap, struck: [...plan.instance.leap.struck] } }
          : {}),
        ...(plan.instance.parentId !== undefined
          ? planRecord(plan.instance.parentId, plan.instance.replacements ?? {})
          : {})
      }
    : null;
  if (plan.markAction || plan.markBonus) {
    state.combat = {
      ...state.combat,
      turn: {
        ...state.combat.turn,
        actionUsed: state.combat.turn.actionUsed || plan.markAction,
        bonusActionUsed: state.combat.turn.bonusActionUsed || plan.markBonus,
        actionInstance: instance
      }
    };
  } else if (plan.instance !== state.combat.turn.actionInstance) {
    state.combat = { ...state.combat, turn: { ...state.combat.turn, actionInstance: instance } };
  }
  if (plan.bonusInstance !== state.combat.turn.bonusActionInstance) {
    const bonusInstance = plan.bonusInstance
      ? {
          actorId: plan.bonusInstance.actorId,
          components: { ...plan.bonusInstance.components },
          ...(plan.bonusInstance.slotLevel !== undefined ? { slotLevel: plan.bonusInstance.slotLevel } : {}),
          ...(plan.bonusInstance.shaping !== undefined
            ? { shaping: plan.bonusInstance.shaping.map((entry) => ({ ...entry })) }
            : {})
        }
      : null;
    state.combat = { ...state.combat, turn: { ...state.combat.turn, bonusActionInstance: bonusInstance } };
  }
  // A dominated creature's Reaction takes its commander's too.
  if (plan.markReaction) spendReaction(state, attacker.id);
  // Actions beyond the one (Action Surge, Haste) and the Magic actions taken, for the turn's own creature.
  if ((plan.extraAction !== null || plan.magicAction || plan.surge) && state.combat.turnActorId === attacker.id) {
    const before = state.combat.turn.extraActions;
    const prior =
      before?.actorId === attacker.id
        ? before
        : { actorId: attacker.id, surges: 0, surgedThisTurn: false, hasteUsed: false, magicActions: 0 };
    state.combat = {
      ...state.combat,
      turn: {
        ...state.combat.turn,
        extraActions: {
          ...prior,
          surges: Math.max(0, prior.surges + (plan.surge ? 1 : 0) - (plan.extraAction === "surge" ? 1 : 0)),
          surgedThisTurn: prior.surgedThisTurn || plan.surge,
          hasteUsed: prior.hasteUsed || plan.extraAction === "haste",
          magicActions: Math.min(10, prior.magicActions + (plan.magicAction ? 1 : 0))
        },
        // An additional action is a new action: a Loading weapon fires once in each.
        ...(plan.extraAction !== null && state.combat.turn.extraAttacks
          ? { extraAttacks: { ...state.combat.turn.extraAttacks, loading: null } }
          : {})
      }
    };
  }
  // Cleared on turn advance; outside a fight the override covers this command alone.
  if (overridden && state.combat.active) rememberOverride(state, overridden.rule, input.override);
  if (plan.spendLegendary) {
    state.combat = {
      ...state.combat,
      legendaryUsed: {
        ...state.combat.legendaryUsed,
        [attacker.id]: (state.combat.legendaryUsed[attacker.id] ?? 0) + plan.spendLegendary.cost,
        ...(plan.spendLegendary.onceKey !== undefined ? { [plan.spendLegendary.onceKey]: 1 } : {})
      },
      turn: {
        ...state.combat.turn,
        legendaryTakenBy: [...new Set([...(state.combat.turn.legendaryTakenBy ?? []), attacker.id])]
      }
    };
  }
  if (plan.spendSpellSlot) {
    spendSlot(attacker, plan.spendSpellSlot);
    const casters = state.combat.turn.spellSlotCasters ?? [];
    if (state.combat.active && !casters.includes(attacker.id))
      state.combat = {
        ...state.combat,
        turn: { ...state.combat.turn, spellSlotCasters: [...casters, attacker.id] }
      };
  }
  // A consumed material is used up as the cast happens ("which the spell consumes").
  if (plan.componentSpends) spendComponents(attacker, plan.componentSpends);
  commitShaping(state, attacker, plan.shaping, plan.leveledCast === true);
  for (const key of [plan.oncePerTurn, plan.usedMark, ...(plan.turnMarks ?? [])])
    if (key)
      state.combat = {
        ...state.combat,
        turn: { ...state.combat.turn, turnUses: { ...state.combat.turn.turnUses, [key]: 1 } }
      };
  if (plan.spendUse) commitUse(state, attacker, plan.spendUse);
}

/** Records `amount` uses of a limited use: this turn's for a per-turn use, else the creature's own count. */
export function commitUse(state: GameState, attacker: LiveActor, spendUse: NonNullable<EconomyPlan["spendUse"]>): void {
  if (spendUse.per === "turn") {
    const key = `${attacker.id}:${spendUse.key}`;
    state.combat = {
      ...state.combat,
      turn: {
        ...state.combat.turn,
        turnUses: { ...state.combat.turn.turnUses, [key]: (state.combat.turn.turnUses[key] ?? 0) + spendUse.amount }
      }
    };
    return;
  }
  attacker.actionUses = {
    ...attacker.actionUses,
    [spendUse.key]: (attacker.actionUses[spendUse.key] ?? 0) + spendUse.amount,
    ...(spendUse.also ? { [spendUse.also]: (attacker.actionUses[spendUse.also] ?? 0) + 1 } : {})
  };
}

/** The Hide a move's end offers (a weretiger's Prowl): its Bonus Action form, while the effect that offers it lasts. */
function hidesFreely(attacker: LiveActor, action: DefinitionAction): boolean {
  return action.id === "hide-bonus" && attacker.effects.some((effect) => effect.tags.includes(THEN_HIDE_TAG));
}

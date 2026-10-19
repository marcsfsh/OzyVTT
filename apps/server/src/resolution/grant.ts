import { CHOSEN_ABILITY_TAG, ENHANCED_ABILITY_TAG, type GameState } from "@vtt/domain";
import { abilityModifier, rollDice } from "@vtt/rules-5e";
import type { DamageType, EffectInstance, Modifier } from "@vtt/schemas";
import { ABILITY_NAMES } from "../ability-checks.js";
import { setCondition } from "../actor-conditions.js";
import { conditionLabel } from "../condition-rules.js";
import {
  addEffect,
  HASTED_TAG,
  MAGE_ARMOR_TAG,
  BARKSKIN_TAG,
  endConditionsImmuneTo,
  endEffect,
  ENDS_ON_DEATH_TAG,
  RESISTS_CHOSEN_TYPE_TAG,
  makeEffect,
  PERSISTENT_RAGE_TAG,
  RAGE_ROUNDS,
  RAGING_TAG,
  RECKLESS_TAG,
  STEADY_AIM_TAG,
  turnEndDuration,
  type EffectNarration
} from "../effects.js";
import { refreshBaseArmorClass } from "../actor-roster.js";
import { teleportsEachTurn } from "../granted-moves.js";
import { planeTravelBarred, travelsPlanes } from "../ethereal.js";
import { holdsFeature } from "../class-features.js";
import { GIFT_OF_THE_PROTECTORS_TAG, refuseFullPage } from "../book-of-shadows.js";
import { deriveEquipment } from "../equipment-derivation.js";
import { CommandRejectedError } from "../game-store.js";
import { currentSpeedFeet } from "../speed.js";
import { spellEffectDuration, spellOf } from "./concentration.js";
import { recordRoll, tableLineOf, type DefinitionAction, type LiveActor, type ResolveContext } from "./context.js";
import { moveMark } from "./marks.js";
import { boundWeaponOf, grantExtras, optionFor, optionParts, withOptionName } from "./grant-extras.js";
import { suppressConditions } from "../suppressed-conditions.js";
import { effectNameOf } from "../effect-names.js";
import { ownSizeOf } from "../transform/assume.js";
import { blockerOfGrowth, changedSize, refreshSize, SIZE_FOOTPRINT, type CreatureSize } from "../transform/forms.js";
import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";

/** Reckless Attack's Advantage is on attack rolls using Strength. A sheet built before that gate was authored carries
 *  the roll mode ungated, so it is narrowed as it lands. */
function strengthAttacksOnly(modifier: Modifier): Modifier {
  if (modifier.type !== "roll-mode" || modifier.roll !== "attack" || (modifier.when?.length ?? 0) > 0) return modifier;
  return { ...modifier, when: [{ type: "on-attack-roll" }, { type: "ability-is", abilities: ["str"] }] };
}

/** SRD Foe Slayer: "The damage die of your Hunter's Mark is a d10 rather than a d6." */
function foeSlayerDie(ctx: ResolveContext, modifiers: readonly Modifier[]): readonly Modifier[] {
  if (
    !ctx.action.grants?.tags.includes("hunters-mark") ||
    !holdsFeature(ctx.deps.definition, "foe-slayer", "Foe Slayer")
  )
    return modifiers;
  return modifiers.map((modifier) =>
    modifier.type === "extra-damage" && modifier.formula === "1d6" ? { ...modifier, formula: "1d10" } : modifier
  );
}

/** The feature whose Rage lasts 10 minutes with nothing to extend it (Barbarian 15). */
const PERSISTENT_RAGE_ID = "persistent-rage";

/** SRD Rage: a re-declared Rage keeps the 10 minutes it started with; one past them isn't extended. A Persistent Rage
 *  lasts the 10 minutes outright. Null leaves the grant's own duration. */
function rageTiming(
  ctx: ResolveContext,
  recipient: LiveActor
): Readonly<{ startedRound: number; duration?: EffectInstance["duration"]; tags: readonly string[] }> | null {
  const { state, action, warnings } = ctx;
  if (!action.grants!.tags.includes(RAGING_TAG)) return null;
  const current = recipient.effects.find((effect) => effect.tags.includes(RAGING_TAG));
  const startedRound = current?.startedRound ?? state.combat.round;
  if (ctx.siblings.some((sibling) => sibling.id === PERSISTENT_RAGE_ID))
    return {
      startedRound,
      duration: current?.duration ?? { type: "rounds", remaining: RAGE_ROUNDS },
      tags: [...action.grants!.tags, PERSISTENT_RAGE_TAG]
    };
  if (current && state.combat.round - startedRound >= RAGE_ROUNDS - 1) {
    warnings.push(`${recipient.name}'s Rage has lasted 10 minutes, so it isn't extended.`);
    return { startedRound, duration: current.duration, tags: action.grants!.tags };
  }
  return { startedRound, tags: action.grants!.tags };
}

/** Granted effects (Rage, Reckless Attack on self; Help on an ally; Bless on each creature it targets): replace-on-
 *  refresh. A feature's end when the granter drops to 0 HP; a spell's last its duration, and end with the cast's
 *  Concentration when it has one (`castId`, so `startConcentration` runs first). An `onHit` grant (Guiding Bolt) lands
 *  only on a hit. */
export function applyGrant(ctx: ResolveContext): void {
  const { action, attacker, targets, attack } = ctx;
  const grant = action.grants;
  if (!grant) return;
  if (moveMark(ctx)) return;
  if (grant.onHit && (attack === null || (attack.outcome !== "hit" && attack.outcome !== "crit"))) return;
  const recipients =
    grant.target === "targets"
      ? targets
      : grant.target === "target"
        ? targets.slice(0, 1)
        : grant.target === "self-and-targets"
          ? [attacker, ...targets.filter((target) => target.id !== attacker.id)]
          : [attacker];
  if (grant.toggles && endToggled(ctx, recipients)) return;
  for (const recipient of recipients) grantTo(ctx, recipient);
  // Tree Stride's once-a-turn teleport is there on the turn it is cast too.
  if (grant.teleportEachTurn)
    for (const recipient of recipients) teleportsEachTurn(ctx.state, recipient.id, `${ctx.input.commandId}:stride`);
}

/** "From the Material Plane to the Ethereal Plane or vice versa": a toggling grant taken again while what it gave
 *  lasts ends it on each recipient instead. True when it did. */
function endToggled(ctx: ResolveContext, recipients: readonly LiveActor[]): boolean {
  const { state, action, attacker } = ctx;
  const given = recipients.flatMap((recipient) =>
    recipient.effects
      .filter((effect) => effect.sourceActorId === attacker.id && effect.sourceActionId === action.id)
      .map((effect) => ({ recipient, effect }))
  );
  if (given.length === 0) return false;
  for (const { recipient, effect } of given)
    for (const event of endEffect(state, recipient.id, effect.id)) ctx.tableNarration.push(tableLineOf(ctx, event));
  return true;
}

/** The Temporary Hit Points a grant gives at the start of each of the bearer's turns: a number, or the granter's
 *  spellcasting ability modifier (a cast resolves it first, at the spell's own ability); none when it is under 1. */
function turnStartTemporaryHitPoints(
  each: NonNullable<DefinitionAction["grants"]>["temporaryHitPointsEachTurn"],
  definition: ResolveContext["deps"]["definition"]
): Partial<Pick<EffectInstance, "temporaryHitPointsEachTurn">> {
  const ability = definition?.spellcasting?.ability;
  const amount =
    each === "spellcasting-modifier"
      ? ability
        ? abilityModifier(definition!.abilityScores[ability])
        : 0
      : (each ?? 0);
  return amount >= 1 ? { temporaryHitPointsEachTurn: Math.min(100, amount) } : {};
}

function grantTo(ctx: ResolveContext, recipient: LiveActor): void {
  const { state, action, attacker, input, deps, warnings } = ctx;
  const grant = action.grants!;
  // "Inspire another creature"; "A creature can have only one Bardic Inspiration die at a time."
  if (grant.notSelf && recipient.id === attacker.id)
    throw new CommandRejectedError(`${grant.name ?? action.name} goes to another creature. Pick someone else.`);
  if (grant.onlyOne && recipient.effects.some((effect) => grant.tags.some((tag) => effect.tags.includes(tag))))
    throw new CommandRejectedError(
      `${recipient.name} already has ${grant.name ?? action.name}, and a creature can have only one at a time.`
    );
  if (grant.tags.includes(GIFT_OF_THE_PROTECTORS_TAG)) refuseFullPage(state, attacker, recipient, deps.definition);
  // Dimensional Shackles bar a bound creature's own way to another plane (Etherealness, an Ethereal Jaunt).
  if (recipient.id === attacker.id && travelsPlanes(grant.tags) && planeTravelBarred(recipient))
    throw new CommandRejectedError(`${recipient.name} is bound by Dimensional Shackles and can't leave this plane.`);
  // A concentration grant may end the granter's previous concentration; surfaced as a warning line.
  const replaced: EffectNarration[] = [];
  const recipientDefinition =
    recipient.id === attacker.id
      ? deps.definition
      : recipient.definitionId
        ? deps.resolveDefinition?.(recipient.definitionId)
        : undefined;
  const derivation = deriveEquipment(recipient, recipientDefinition, deps.catalog);
  // Dash grants a quantity measured now, so a later Slow this turn doesn't shrink it. Keyed on the
  // `dashing` tag so homebrew actions match.
  const grantedMovement = grant.tags.includes("dashing")
    ? { movementGrantFeet: currentSpeedFeet(recipient, derivation) ?? 0 }
    : {};
  // Haste doubles Speed as it is at each moment (`speed.ts`); a sheet built before the multiplier was authored has
  // only the tag.
  const speedMultiplier = grant.speedMultiplier ?? (grant.tags.includes(HASTED_TAG) ? 2 : undefined);
  // Steady Aim lasts until the end of the turn it is taken on and holds Speed at 0 meanwhile; its Advantage goes with
  // the next attack roll (`spendSteadyAim`). A sheet built earlier says "until your next turn".
  const steadyAim = grant.tags.includes(STEADY_AIM_TAG);
  const rage = rageTiming(ctx, recipient);
  const modifiers = foeSlayerDie(
    ctx,
    grant.tags.includes(RECKLESS_TAG) ? grant.modifiers.map(strengthAttacksOnly) : grant.modifiers
  );
  // Hex: "choose one ability. The target has Disadvantage on ability checks made with the chosen ability."
  const hexed = grant.tags.includes(CHOSEN_ABILITY_TAG);
  const hexAbility = hexed ? (input.ability ?? null) : null;
  if (hexed && hexAbility === null)
    warnings.push(`Hex on ${recipient.name}: no ability was chosen, so its checks have no Disadvantage.`);
  const hexDisadvantage: Modifier[] = hexAbility
    ? [
        {
          type: "roll-mode",
          roll: "check",
          mode: "disadvantage",
          when: [{ type: "on-ability-check" }, { type: "ability-is", abilities: [hexAbility] }]
        }
      ]
    : [];
  // Enhance Ability: "Advantage on ability checks using the chosen ability", any but Constitution.
  const enhanced = grant.tags.includes(ENHANCED_ABILITY_TAG);
  const enhancedAbility = enhanced && input.ability !== undefined && input.ability !== "con" ? input.ability : null;
  if (enhanced && enhancedAbility === null)
    warnings.push(
      `${grant.name ?? action.name} on ${recipient.name}: choose Strength, Dexterity, Intelligence, Wisdom or Charisma for its Advantage.`
    );
  const enhancedAdvantage: Modifier[] = enhancedAbility
    ? [
        {
          type: "roll-mode",
          roll: "check",
          mode: "advantage",
          when: [{ type: "on-ability-check" }, { type: "ability-is", abilities: [enhancedAbility] }]
        }
      ]
    : [];
  // Protection from Energy: "Resistance to one damage type of your choice", one of those the action offers.
  const chosenType = grant.tags.includes(RESISTS_CHOSEN_TYPE_TAG)
    ? input.damageType !== undefined && (action.damageTypes ?? []).includes(input.damageType as never)
      ? input.damageType
      : action.damageTypes?.[0]
    : undefined;
  const chosenResistance: Modifier[] = chosenType
    ? [{ type: "damage-resistance", damageTypes: [chosenType as DamageType] }]
    : [];
  // Mage Armor: a base AC of 13 + Dexterity for a creature wearing no armor, chosen like Unarmored Defense, so a shield
  // and other AC bonuses still add (`refreshBaseArmorClass`). A sheet built earlier has only the tag.
  const baseArmorClass = grant.baseArmorClass ?? (grant.tags.includes(MAGE_ARMOR_TAG) ? 13 : undefined);
  if (baseArmorClass !== undefined && derivation.context.armorWeight != null) {
    warnings.push(`${recipient.name} is wearing armor, so ${grant.name ?? action.name} does nothing.`);
    return;
  }
  // Barkskin: "an Armor Class of 17 if its AC is lower than that", a floor under whatever else the AC is.
  const armorClassFloor = grant.armorClassFloor ?? (grant.tags.includes(BARKSKIN_TAG) ? 17 : undefined);
  // Large Form: "You can change your size to Large ... if you're in a big enough space."
  if (grant.sizeChange?.to) {
    const grown = changedSize((recipient.size ?? "medium") as CreatureSize, grant.sizeChange);
    const blocker = blockerOfGrowth(state, recipient.id, SIZE_FOOTPRINT[grown], ctx.hiddenFromInitiator);
    if (blocker)
      throw new CommandRejectedError(
        `${recipient.name} isn't in a big enough space to become ${grown[0]!.toUpperCase()}${grown.slice(1)}: ${blocker} is in the way.`
      );
  }
  // A duration rolled as it lands (Potion of Diminution: "for 1d4 hours").
  const rolledHours = grant.hoursRolled
    ? Math.max(1, resolveDice(parseDiceFormula(grant.hoursRolled), ctx.deps.random).total)
    : null;
  const spell = spellOf(ctx);
  const castLevel = spell ? (ctx.plan.castLevel ?? spell.level) : null;
  // The choice made as it is granted (Fire Shield's warm or chill), and the weapon it binds to (Magic Weapon).
  const option = grant.options
    ? optionFor(
        ctx,
        { options: grant.options, perTarget: grant.optionsPerTarget === true },
        recipient,
        grant.name ?? action.name
      )
    : null;
  const parts = optionParts(option);
  const bound = boundWeaponOf(ctx, grant, recipient);
  if (grant.bindsWeapon && !bound) return;
  const linkedConditionIds = [...new Set([...(grant.conditions ?? []), ...parts.conditions])].slice(0, 4);
  const conditionImmunities = [...new Set([...(grant.conditionImmunities ?? []), ...parts.conditionImmunities])];
  const baseName =
    ctx.builtin?.grantName?.(ctx) ??
    ((hexAbility ?? enhancedAbility)
      ? `${grant.name ?? effectNameOf(action.name)} (${ABILITY_NAMES[(hexAbility ?? enhancedAbility)!]})`
      : chosenType
        ? `${grant.name ?? effectNameOf(action.name)} (${chosenType[0]!.toUpperCase()}${chosenType.slice(1)})`
        : (grant.name ?? effectNameOf(action.name)));
  const effect = addEffect(
    state,
    recipient.id,
    makeEffect({
      id:
        grant.target === "targets" || grant.target === "self-and-targets"
          ? `${input.commandId}:grant:${recipient.id}`
          : `${input.commandId}:grant`,
      name: withOptionName(baseName, option),
      tags: [...new Set([...(rage ? rage.tags : grant.tags), ...parts.tags])].slice(0, 8),
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      sourceActionId: action.id,
      startedRound: rage?.startedRound ?? state.combat.round,
      duration: rage?.duration
        ? rage.duration
        : steadyAim
          ? { type: "until-bearer-turn-end", skipsCurrentTurn: false }
          : rolledHours !== null
            ? { type: "minutes", remaining: rolledHours * 60 }
            : grantDuration(
                state,
                grant.duration,
                attacker.id,
                spell && castLevel !== null ? { spell, castLevel } : null
              ),
      // A spell's effect outlasts its caster's fall; only Concentration ends it early. A die given to another creature
      // (Bardic Inspiration) is its own once given.
      endsWhenSourceDefeated:
        action.spellId === undefined && grant.answer === undefined && !grant.tags.includes(ENDS_ON_DEATH_TAG),
      voidWhileIncapacitated: grant.voidWhileIncapacitated,
      modifiers: [
        ...modifiers,
        ...hexDisadvantage,
        ...enhancedAdvantage,
        ...chosenResistance,
        ...parts.modifiers,
        ...(bound?.modifiers ?? [])
      ],
      ...(grant.answer ? { answer: structuredClone(grant.answer) } : {}),
      ...(grant.struck ? { struck: structuredClone(grant.struck) } : {}),
      // Sanctuary: who targets the bearer saves first.
      ...(grant.ward?.dc !== undefined ? { ward: { ability: grant.ward.ability, dc: grant.ward.dc } } : {}),
      // Greater Invisibility's Invisible condition, which ends with the effect.
      ...(linkedConditionIds.length > 0 ? { linkedConditionIds } : {}),
      onEnd: grant.onEnd,
      endsWithTag: grant.endsWithTag ?? null,
      concentration: grant.concentration,
      ...(grant.damageUses !== undefined ? { damageUses: grant.damageUses } : {}),
      // SRD Combining Game Effects: one spell's effects on a creature don't add up (two Blesses give one d4).
      ...(action.spellId !== undefined ? { stackKey: `spell:${action.spellId}` } : {}),
      // A Concentration spell's effects end with the caster's Concentration on that cast.
      ...(ctx.castId !== null ? { castId: ctx.castId } : {}),
      // The spell and its level, which Dispel Magic weighs.
      ...(spell && castLevel !== null ? { spell: { id: spell.id, level: castLevel } } : {}),
      ...(grant.armorClassBonus !== undefined ? { armorClassBonus: grant.armorClassBonus } : {}),
      ...(baseArmorClass !== undefined ? { baseArmorClass } : {}),
      ...(armorClassFloor !== undefined ? { armorClassFloor } : {}),
      ...(speedMultiplier !== undefined ? { speedMultiplier } : {}),
      // The light its bearer sheds while it lasts (Shining Smite's 5 feet of Bright Light).
      ...(grant.light ? { light: { ...grant.light } } : {}),
      // The creatures it lets its bearer sense (Divine Sense), drawn for its player alone (`vision/detect.ts`).
      ...(grant.detects ? { detects: { ...grant.detects, creatureTypes: [...grant.detects.creatureTypes] } } : {}),
      ...(steadyAim ? { speedZero: true } : {}),
      ...grantedMovement,
      // Heroism: immune to Frightened, and Temporary Hit Points at the start of each of the bearer's turns.
      ...(conditionImmunities.length > 0 ? { conditionImmunities: conditionImmunities.slice(0, 6) } : {}),
      ...turnStartTemporaryHitPoints(grant.temporaryHitPointsEachTurn, deps.definition),
      ...(grant.teleportEachTurn ? { teleportEachTurn: { ...grant.teleportEachTurn } } : {}),
      // Aid: the Hit Point maximum and current hit points rise while it lasts (`addEffect`); Heroes' Feast rolls its
      // 2d10 for each creature.
      ...hitPointMaximumGainOf(ctx, grant.hitPointMaximumGain, recipient.name),
      // Its size while it lasts (Large Form), from the size it had before any change.
      ...(grant.sizeChange ? { sizeChange: { ...grant.sizeChange }, ownSize: ownSizeOf(recipient) } : {}),
      ...grantExtras(ctx, grant, recipient, option),
      ...(bound?.fields ?? {})
    }),
    replaced,
    deps
  );
  if (effect.sizeChange) refreshSize(state, recipient);
  warnings.push(...replaced.map((event) => event.text));
  // A new way to work out AC counts at once.
  if (baseArmorClass !== undefined && recipientDefinition)
    refreshBaseArmorClass(recipient, recipientDefinition, deps.catalog);
  // Expeditious Retreat: the cast is a Dash too, measured now as the generic action's is.
  if (grant.dashesNow)
    addEffect(
      state,
      recipient.id,
      makeEffect({
        id: `${input.commandId}:dash:${recipient.id}`,
        name: "Dashing",
        tags: ["dashing"],
        sourceActorId: attacker.id,
        sourceName: attacker.name,
        startedRound: state.combat.round,
        duration: { type: "until-source-next-turn" },
        movementGrantFeet: currentSpeedFeet(recipient, derivation) ?? 0
      })
    );
  // Calm Emotions: a Charmed or Frightened it holds off is kept on the effect for later, rather than ended.
  holdOff(ctx, recipient, effect, [...(grant.suppressesConditions ?? []), ...parts.suppresses]);
  // SRD Immunity: a condition the grant makes its bearer immune to ends now (Heroism's Frightened), as the table hears.
  if (conditionImmunities.length > 0)
    for (const event of endConditionsImmuneTo(recipient, conditionImmunities, effect.name))
      ctx.tableNarration.push({ kind: "effect", text: event.text, actorIds: [recipient.id] });
  // Mindless Rage: "If you're Charmed or Frightened when you enter your Rage, the condition ends on you." A condition
  // the Rage now makes its bearer immune to ends as it starts.
  if (rage) {
    const immune = deriveEquipment(recipient, recipientDefinition, deps.catalog).conditionImmunities.map(
      (entry) => entry.id
    );
    for (const condition of recipient.conditions.filter((entry) => immune.includes(entry.id))) {
      setCondition(state, recipient.id, condition.id, false, undefined, { role: "gm" });
      ctx.tableNarration.push({
        kind: "effect",
        text: `${recipient.name} is no longer ${conditionLabel(condition.id)} (${effect.name}).`,
        actorIds: [recipient.id]
      });
    }
  }
  if (recipient.id !== attacker.id || grant.target !== "self")
    ctx.effectsApplied.push({
      targetId: recipient.id,
      targetName: recipient.name,
      name: effect.name,
      conditionIds: [...linkedConditionIds]
    });
  else ctx.effectGranted = { name: effect.name, tags: effect.tags };
}

/** Takes the conditions an effect suppresses off its bearer and keeps them on the effect, as the table hears. */
export function holdOff(
  ctx: Pick<ResolveContext, "tableNarration">,
  bearer: LiveActor,
  effect: EffectInstance,
  conditionIds: readonly string[]
): void {
  if (conditionIds.length === 0) return;
  const held = suppressConditions(bearer, conditionIds);
  if (held.length === 0) return;
  bearer.effects = bearer.effects.map((candidate) =>
    candidate.id === effect.id ? { ...candidate, suppressedConditions: held } : candidate
  );
  ctx.tableNarration.push({
    kind: "effect",
    text: `${bearer.name} is no longer ${held.map((entry) => conditionLabel(entry.id)).join(" or ")} while ${effect.name} lasts.`,
    actorIds: [bearer.id]
  });
}

/** What a grant adds to its recipient's Hit Point maximum: its amount, and its dice rolled for this recipient. */
function hitPointMaximumGainOf(
  ctx: ResolveContext,
  gain: NonNullable<DefinitionAction["grants"]>["hitPointMaximumGain"],
  recipientName: string
): Partial<Pick<EffectInstance, "hitPointMaximumGain">> {
  if (!gain) return {};
  let amount = gain.amount;
  if (gain.formula !== undefined) {
    const rolled = rollDice(gain.formula, ctx.deps.random);
    recordRoll(ctx, rolled, "healing", `${ctx.action.name}: ${recipientName}`);
    amount += rolled.total;
  }
  return amount >= 1 ? { hitPointMaximumGain: Math.min(1000, amount) } : {};
}

/** A grant's printed duration as an effect's. One that lasts until ended, on a spell, lasts the spell's own duration at
 *  the level it was cast (Mage Armor's 8 hours), so time on the game clock ends it. */
function grantDuration(
  state: GameState,
  duration: NonNullable<DefinitionAction["grants"]>["duration"],
  granterId: string,
  cast: Readonly<{ spell: NonNullable<ReturnType<typeof spellOf>>; castLevel: number }> | null
): EffectInstance["duration"] {
  switch (duration.type) {
    case "rounds":
      return { type: "rounds", remaining: duration.rounds };
    case "minutes":
      return { type: "minutes", remaining: duration.minutes };
    case "until-source-turn-end":
      return turnEndDuration(state, "until-source-turn-end", granterId);
    case "manual":
      return cast ? spellEffectDuration(cast.spell, cast.castLevel) : duration;
    default:
      return duration;
  }
}

/** An item's self grant used outside a fight (Antitoxin drunk before the dungeon, a blade coated on the road): the
 *  same effect on its user, counted once a fight's turns start. Nothing for a grant aimed at other creatures. */
export function grantOutsideFight(
  state: GameState,
  actor: LiveActor,
  action: DefinitionAction,
  commandId: string,
  random: (sides: number) => number = () => 1
): EffectNarration[] {
  const grant = action.grants;
  if (!grant || grant.target !== "self") return [];
  const events: EffectNarration[] = [];
  // A duration rolled as it lands (Potion of Diminution: "for 1d4 hours").
  const rolledHours = grant.hoursRolled
    ? Math.max(1, resolveDice(parseDiceFormula(grant.hoursRolled), random).total)
    : null;
  const effect = addEffect(
    state,
    actor.id,
    makeEffect({
      id: `${commandId}:grant`,
      name: grant.name ?? effectNameOf(action.name),
      tags: grant.tags,
      sourceActorId: actor.id,
      sourceName: actor.name,
      sourceActionId: action.id,
      startedRound: state.combat.round,
      duration:
        rolledHours !== null
          ? { type: "minutes", remaining: rolledHours * 60 }
          : grantDuration(state, grant.duration, actor.id, null),
      endsWhenSourceDefeated: true,
      voidWhileIncapacitated: grant.voidWhileIncapacitated,
      modifiers: grant.modifiers,
      onEnd: grant.onEnd,
      endsWithTag: grant.endsWithTag ?? null,
      concentration: grant.concentration,
      ...(grant.damageUses !== undefined ? { damageUses: grant.damageUses } : {}),
      // A scroll's spell read on the road stacks as that spell cast in a fight does.
      ...(action.spellId !== undefined ? { stackKey: `spell:${action.spellId}` } : {}),
      ...(grant.armorClassBonus !== undefined ? { armorClassBonus: grant.armorClassBonus } : {}),
      // Its size while it lasts (a Potion of Growth).
      ...(grant.sizeChange ? { sizeChange: { ...grant.sizeChange }, ownSize: ownSizeOf(actor) } : {})
    }),
    events
  );
  if (effect.sizeChange) refreshSize(state, actor);
  return [{ kind: "effect", text: `${actor.name} gains ${effect.name}.`, actorId: actor.id }, ...events];
}

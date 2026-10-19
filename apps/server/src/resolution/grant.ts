import { CHOSEN_ABILITY_TAG, ENHANCED_ABILITY_TAG, type GameState } from "@vtt/domain";
import { abilityModifier } from "@vtt/rules-5e";
import type { DamageType, EffectInstance, Modifier } from "@vtt/schemas";
import { ABILITY_NAMES } from "../ability-checks.js";
import { setCondition } from "../actor-conditions.js";
import { conditionLabel } from "../condition-rules.js";
import {
  addEffect,
  HASTED_TAG,
  MAGE_ARMOR_TAG,
  BARKSKIN_TAG,
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
import { deriveEquipment } from "../equipment-derivation.js";
import { currentSpeedFeet } from "../speed.js";
import type { DefinitionAction, LiveActor, ResolveContext } from "./context.js";
import { moveMark } from "./marks.js";
import { effectNameOf } from "../effect-names.js";

/** Reckless Attack's Advantage is on attack rolls using Strength. A sheet built before that gate was authored carries
 *  the roll mode ungated, so it is narrowed as it lands. */
function strengthAttacksOnly(modifier: Modifier): Modifier {
  if (modifier.type !== "roll-mode" || modifier.roll !== "attack" || (modifier.when?.length ?? 0) > 0) return modifier;
  return { ...modifier, when: [{ type: "on-attack-roll" }, { type: "ability-is", abilities: ["str"] }] };
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
 *  refresh. They end when the granter drops to 0 HP, and with the cast's Concentration when it has one (`castId`, so
 *  `startConcentration` runs first). An `onHit` grant (Guiding Bolt) lands only on a hit. */
export function applyGrant(ctx: ResolveContext): void {
  const { action, attacker, targets, attack } = ctx;
  const grant = action.grants;
  if (!grant) return;
  if (moveMark(ctx)) return;
  if (grant.onHit && (attack === null || (attack.outcome !== "hit" && attack.outcome !== "crit"))) return;
  const recipients =
    grant.target === "targets" ? targets : grant.target === "target" ? targets.slice(0, 1) : [attacker];
  for (const recipient of recipients) grantTo(ctx, recipient);
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
  // Haste doubles Speed: the creature's Speed now, added while it lasts.
  const speedNow = grant.tags.includes(HASTED_TAG) ? (currentSpeedFeet(recipient, derivation) ?? 0) : 0;
  const hasteSpeed: Modifier[] = speedNow > 0 ? [{ type: "speed", amount: Math.min(60, speedNow) }] : [];
  // Steady Aim lasts until the end of the turn it is taken on and holds Speed at 0 meanwhile; its Advantage goes with
  // the next attack roll (`spendSteadyAim`). A sheet built earlier says "until your next turn".
  const steadyAim = grant.tags.includes(STEADY_AIM_TAG);
  const rage = rageTiming(ctx, recipient);
  const modifiers = grant.tags.includes(RECKLESS_TAG) ? grant.modifiers.map(strengthAttacksOnly) : grant.modifiers;
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
  // Mage Armor: base AC 13 + Dexterity for a creature wearing no armor, a shield still adding to it.
  let armorClassBonus = grant.armorClassBonus;
  if (grant.tags.includes(MAGE_ARMOR_TAG)) {
    if (derivation.context.armorWeight != null) {
      warnings.push(`${recipient.name} is wearing armor, so Mage Armor does nothing.`);
      return;
    }
    const mageArmor =
      13 + abilityModifier(recipientDefinition?.abilityScores.dex ?? 10) + (derivation.context.shieldEquipped ? 2 : 0);
    const gain = mageArmor - (recipient.armorClass ?? mageArmor);
    armorClassBonus = gain > 0 ? Math.min(10, gain) : undefined;
  }
  // Barkskin: "an Armor Class of 17 if its AC is lower than that", measured as it lands.
  if (grant.tags.includes(BARKSKIN_TAG)) {
    const gain = 17 - (recipient.armorClass ?? 17);
    armorClassBonus = gain > 0 ? Math.min(10, gain) : undefined;
  }
  const effect = addEffect(
    state,
    recipient.id,
    makeEffect({
      id: grant.target === "targets" ? `${input.commandId}:grant:${recipient.id}` : `${input.commandId}:grant`,
      name:
        ctx.builtin?.grantName?.(ctx) ??
        ((hexAbility ?? enhancedAbility)
          ? `${grant.name ?? effectNameOf(action.name)} (${ABILITY_NAMES[(hexAbility ?? enhancedAbility)!]})`
          : chosenType
            ? `${grant.name ?? effectNameOf(action.name)} (${chosenType[0]!.toUpperCase()}${chosenType.slice(1)})`
            : (grant.name ?? effectNameOf(action.name))),
      tags: rage ? [...rage.tags] : grant.tags,
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      sourceActionId: action.id,
      startedRound: rage?.startedRound ?? state.combat.round,
      duration: rage?.duration
        ? rage.duration
        : steadyAim
          ? { type: "until-bearer-turn-end", skipsCurrentTurn: false }
          : grant.duration.type === "rounds"
            ? { type: "rounds", remaining: grant.duration.rounds }
            : grant.duration.type === "until-source-turn-end"
              ? turnEndDuration(state, "until-source-turn-end", attacker.id)
              : grant.duration,
      endsWhenSourceDefeated: true,
      voidWhileIncapacitated: grant.voidWhileIncapacitated,
      modifiers: [...modifiers, ...hasteSpeed, ...hexDisadvantage, ...enhancedAdvantage, ...chosenResistance],
      // Greater Invisibility's Invisible condition, which ends with the effect.
      ...(grant.conditions ? { linkedConditionIds: [...grant.conditions] } : {}),
      onEnd: grant.onEnd,
      endsWithTag: grant.endsWithTag ?? null,
      concentration: grant.concentration,
      ...(grant.damageUses !== undefined ? { damageUses: grant.damageUses } : {}),
      // SRD Combining Game Effects: one spell's effects on a creature don't add up (two Blesses give one d4).
      ...(action.spellId !== undefined ? { stackKey: `spell:${action.spellId}` } : {}),
      // A Concentration spell's effects end with the caster's Concentration on that cast.
      ...(ctx.castId !== null ? { castId: ctx.castId } : {}),
      ...(armorClassBonus !== undefined ? { armorClassBonus } : {}),
      ...(steadyAim ? { speedZero: true } : {}),
      ...grantedMovement,
      // Heroism: immune to Frightened, and Temporary Hit Points at the start of each of the bearer's turns.
      ...(grant.conditionImmunities ? { conditionImmunities: [...grant.conditionImmunities] } : {}),
      ...turnStartTemporaryHitPoints(grant.temporaryHitPointsEachTurn, deps.definition),
      // Aid: the Hit Point maximum and current hit points rise while it lasts (`addEffect`).
      ...(grant.hitPointMaximumGain ? { hitPointMaximumGain: grant.hitPointMaximumGain.amount } : {})
    }),
    replaced,
    deps
  );
  warnings.push(...replaced.map((event) => event.text));
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
      conditionIds: [...(grant.conditions ?? [])]
    });
  else ctx.effectGranted = { name: effect.name, tags: effect.tags };
}

/** An item's self grant used outside a fight (Antitoxin drunk before the dungeon, a blade coated on the road): the
 *  same effect on its user, counted once a fight's turns start. Nothing for a grant aimed at other creatures. */
export function grantOutsideFight(
  state: GameState,
  actor: LiveActor,
  action: DefinitionAction,
  commandId: string
): EffectNarration[] {
  const grant = action.grants;
  if (!grant || grant.target !== "self") return [];
  const events: EffectNarration[] = [];
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
        grant.duration.type === "rounds"
          ? { type: "rounds", remaining: grant.duration.rounds }
          : grant.duration.type === "until-source-turn-end"
            ? turnEndDuration(state, "until-source-turn-end", actor.id)
            : grant.duration,
      endsWhenSourceDefeated: true,
      voidWhileIncapacitated: grant.voidWhileIncapacitated,
      modifiers: grant.modifiers,
      onEnd: grant.onEnd,
      endsWithTag: grant.endsWithTag ?? null,
      concentration: grant.concentration,
      ...(grant.damageUses !== undefined ? { damageUses: grant.damageUses } : {}),
      // A scroll's spell read on the road stacks as that spell cast in a fight does.
      ...(action.spellId !== undefined ? { stackKey: `spell:${action.spellId}` } : {}),
      ...(grant.armorClassBonus !== undefined ? { armorClassBonus: grant.armorClassBonus } : {})
    }),
    events
  );
  return [{ kind: "effect", text: `${actor.name} gains ${effect.name}.`, actorId: actor.id }, ...events];
}

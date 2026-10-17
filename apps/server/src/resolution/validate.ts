import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import { effectiveActions } from "../effective-actions.js";
import { deriveEquipment, sourceItemOf } from "../equipment-derivation.js";
import { CommandRejectedError, RulesBlockedError } from "../game-store.js";
import { effectiveModeFor, overrideCovers, overrideReason, overrideWaives } from "../rules-families.js";
import {
  isLongCastingTime,
  laterSpellActionId,
  ritualSpellActionId,
  upcastAction,
  withSpellAttackReach,
  withSpellEffects
} from "../item-actions.js";
import { coverBonusOf, coverFor } from "../cover.js";
import { builtinHandlerFor } from "./builtins.js";
import type { DefinitionAction, LiveActor, ResolveContext, ResolveDependencies, ResolveInput } from "./context.js";
import { castLevelOf, planEconomy, type EconomyPlan } from "./economy.js";

/** The attacker and targets, refused unless the action has something structured to resolve against them. */
function combatantsOf(
  state: GameState,
  action: DefinitionAction,
  input: ResolveInput
): { attacker: LiveActor; targets: LiveActor[] } {
  if (!state.combat.active) throw new CommandRejectedError("Start an encounter before resolving actions.");
  const inFight = (actorId: string) => state.combat.initiative.some((entry) => entry.actorId === actorId);
  const attacker = state.actors.find((item) => item.id === input.actorId);
  if (!attacker) throw new CommandRejectedError("That combatant no longer exists.");
  if (!inFight(input.actorId)) throw new CommandRejectedError("That combatant is not in this encounter.");
  // A target named twice is one target (a second dart is the only reason to name it again).
  const targets = [...new Set(input.targetIds)].map((targetId) => {
    const target = state.actors.find((item) => item.id === targetId);
    if (!target || !inFight(targetId)) throw new CommandRejectedError("Every target must be in this encounter.");
    return target;
  });
  if (action.attack && targets.length !== 1)
    throw new CommandRejectedError("An attack roll resolves against exactly one target.");
  // A grant aimed at the action's target (Help) needs exactly one recipient; one for each target (Bless), at least one.
  if (action.grants?.target === "target" && targets.length !== 1)
    throw new CommandRejectedError("Choose exactly one target for this action.");
  if (action.grants?.target === "targets" && targets.length === 0)
    throw new CommandRejectedError("Choose the creatures this action targets.");
  // A limited use or spell slot is itself the mechanic (Action Surge, Arcane Recovery, ...), so an
  // action that only spends one resolves without a roll or a target.
  const spendsALimitedUse = action.uses !== undefined || action.spellSlot !== undefined;
  const structuredWithoutTargets =
    (action.grants !== undefined && action.grants.target !== "target") ||
    action.healing?.self === true ||
    action.multiattack !== undefined ||
    spendsALimitedUse ||
    input.builtin === true;
  if (targets.length === 0 && !structuredWithoutTargets && action.grants?.target !== "target")
    throw new CommandRejectedError("Choose at least one target.");
  if (
    !action.attack &&
    !action.save &&
    action.damage.length === 0 &&
    !action.healing &&
    action.grants === undefined &&
    action.multiattack === undefined &&
    !spendsALimitedUse &&
    input.builtin !== true
  )
    throw new CommandRejectedError("That action has no structured effect to resolve - run it from its description.");
  return { attacker, targets };
}

/** Validates the resolve against the encounter and the rules mode, plans its economy, and opens the
 *  context every later step reads. Throws before anything is rolled or written. */
export function openResolve(
  state: GameState,
  declared: DefinitionAction,
  input: ResolveInput,
  deps: ResolveDependencies
): ResolveContext {
  const spell = declared.spellId ? deps.catalog?.spellRecord?.(declared.spellId) : undefined;
  const reaching = withSpellEffects(withSpellAttackReach(declared, spell), spell);
  const { attacker, targets } = combatantsOf(state, reaching, input);
  // A spell cast with a higher slot rolls that slot's dice and makes its rays (before the economy opens the action's
  // instance); a paid replay names the slot it was cast with.
  const castLevel = input.economyPaid ? input.slotLevel : castLevelOf(state, attacker, reaching, input.slotLevel);
  const upcast =
    castLevel !== null && castLevel !== undefined && spell && reaching.spellSlot && castLevel > reaching.spellSlot.level
      ? upcastAction(reaching, spell, castLevel)
      : reaching;
  const action = withChosenDamageType(upcast, input.damageType ?? null);
  const warnings: string[] = [];
  const derivation = deriveEquipment(attacker, deps.definition, deps.catalog);
  const siblings = effectiveActions(deps.definition, attacker, deps.catalog);
  const riderItemId = sourceItemOf(action, derivation, attacker.inventory);
  // Magic Missile: each dart at a creature of the caster's choice, the targets listed dart by dart.
  if (action.darts !== undefined && input.targetIds.length > action.darts)
    throw new CommandRejectedError(
      `${action.name} makes ${action.darts} darts; ${input.targetIds.length} were assigned.`
    );
  const economy = input.economyPaid
    ? { plan: paidPlan(state), overridden: null }
    : planEconomy(
        state,
        attacker,
        action,
        input,
        deps.definition,
        warnings,
        deps.distanceFeet,
        siblings,
        false,
        deps.catalog,
        spell,
        deps.resolveDefinition
      );
  let overridden = economy.overridden;

  // GM-adjudicated cover (SRD Cover, no line-of-sight engine): the GM's choice for this resolve, else the cover the
  // GM marked the target with, whoever attacks. Total cover can't be targeted; half/three-quarters add to AC and
  // Dexterity saves.
  const coverMode = effectiveModeFor(state.combat, "cover.total");
  const attackCover = targets.length === 1 ? coverFor(input.cover, targets[0]) : (input.cover ?? null);
  // An area's other targets still take it, so a marked creature among several is the GM's to remove.
  if (targets.length > 1)
    for (const target of targets)
      if ((input.cover ?? null) === null && coverFor(null, target) === "total")
        warnings.push(`${target.name} has Total Cover - leave it out if the effect can't reach it.`);
  if (attackCover === "total" && coverMode !== "freeform") {
    const waived = overrideWaives(input.override, "cover.total");
    if (coverMode === "strict" && !waived && !overrideCovers(state.combat.turn, "cover.total"))
      throw new RulesBlockedError("cover.total", "The target has Total Cover and can't be targeted directly.");
    if (waived && overridden === null) overridden = { rule: "cover.total", reason: overrideReason(input.override) };
    else warnings.push("The target has Total Cover - allowed per the rules mode.");
  }

  const builtin = input.builtin ? builtinHandlerFor(action.id) : undefined;
  const ctx: ResolveContext = {
    state,
    action,
    input,
    deps,
    attacker,
    targets,
    builtin,
    derivation,
    siblings,
    riderItemId,
    plan: economy.plan,
    overridden,
    coverBonus: coverBonusOf(attackCover),
    rollBase: {
      commandId: input.commandId,
      initiatorSessionId: deps.initiatorSessionId ?? deps.gmSessionId,
      initiatorRole: deps.initiatorRole ?? "gm",
      initiatorLabel: attacker.name,
      label: action.name,
      actorId: attacker.id,
      // A hidden attacker's rolls stay GM-only; everyone else's fight in the open.
      visibility: attacker.visibility === "gm-only" ? "gm-only" : "public",
      createdAt: deps.now()
    },
    warnings,
    tableNarration: [],
    healing: null,
    rollMode: undefined,
    check: null,
    attack: null,
    crit: false,
    riderFilters: {},
    damage: [],
    dartTargetIds: [],
    bonusDamage: [],
    masterySwing: null,
    effectsApplied: [],
    effectGranted: null,
    effectsEnded: [],
    reactionPrompts: [],
    builtinSave: null,
    opens: null,
    castId: null,
    hitRiders: []
  };
  if (builtin?.prepare) ctx.action = builtin.prepare(ctx);
  if (!input.economyPaid) warnings.push(...laterActionReminders(spell, action));
  return ctx;
}

/** An action whose caster picks the damage type (Chromatic Orb) deals the one picked, every part of it. */
export function withChosenDamageType(action: DefinitionAction, chosen: string | null): DefinitionAction {
  if (chosen === null) return action;
  if (!action.damageTypes?.includes(chosen as never))
    throw new CommandRejectedError(`${action.name} can't deal ${chosen} damage.`);
  return { ...action, damage: action.damage.map((part) => ({ ...part, type: chosen })) };
}

/** The GM's reminder on casting a spell that does more later (SRD text): the engine can't see a creature enter an
 *  area or a turn come round, so the GM resolves the later action when it happens. */
function laterActionReminders(spell: SpellReference | undefined, action: DefinitionAction): string[] {
  const later = spell?.effect?.laterActions ?? [];
  if (!spell || later.some((row) => laterSpellActionId(spell.id, row.name) === action.id)) return [];
  return [
    // SRD Rituals: 10 minutes longer than the spell's casting time, and no slot.
    ...(action.id === ritualSpellActionId(spell.id)
      ? [
          `${spell.name} as a Ritual takes 10 minutes longer than its ${spell.castingTime}: the Magic action on each of the caster's turns, keeping Concentration, and no slot.`
        ]
      : isLongCastingTime(spell.castingTime)
        ? [
            `${spell.name} takes ${spell.castingTime} to cast: the Magic action on each of the caster's turns until then, keeping Concentration. If that breaks, the spell fails and its slot isn't spent - restore it on the sheet.`
          ]
        : []),
    ...later.map((row) => `${spell.name}: ${row.when} Use "${spell.name}: ${row.name}" for it.`)
  ];
}

/** The plan of a resolve whose economy was already spent: it changes nothing. */
function paidPlan(state: GameState): EconomyPlan {
  return {
    markAction: false,
    markBonus: false,
    markReaction: false,
    instance: state.combat.turn.actionInstance,
    bonusInstance: state.combat.turn.bonusActionInstance,
    spendUse: null,
    spendLegendary: null,
    spendSpellSlot: null,
    castLevel: null,
    extraAction: null,
    magicAction: false,
    surge: false
  };
}

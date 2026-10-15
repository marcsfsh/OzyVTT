import type { GameState } from "@vtt/domain";
import { effectiveActions } from "../effective-actions.js";
import { deriveEquipment, sourceItemOf } from "../equipment-derivation.js";
import { CommandRejectedError, RulesBlockedError } from "../game-store.js";
import { effectiveModeFor, overrideCovers, overrideReason, overrideWaives } from "../rules-families.js";
import { builtinHandlerFor } from "./builtins.js";
import type { DefinitionAction, LiveActor, ResolveContext, ResolveDependencies, ResolveInput } from "./context.js";
import { planEconomy } from "./economy.js";

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
  const targets = input.targetIds.map((targetId) => {
    const target = state.actors.find((item) => item.id === targetId);
    if (!target || !inFight(targetId)) throw new CommandRejectedError("Every target must be in this encounter.");
    return target;
  });
  if (action.attack && targets.length !== 1)
    throw new CommandRejectedError("An attack roll resolves against exactly one target.");
  // A grant aimed at the action's target (Help) needs exactly one recipient.
  if (action.grants?.target === "target" && targets.length !== 1)
    throw new CommandRejectedError("Choose exactly one target for this action.");
  // A limited use or spell slot is itself the mechanic (Action Surge, Arcane Recovery, ...), so an
  // action that only spends one resolves without a roll or a target.
  const spendsALimitedUse = action.uses !== undefined || action.spellSlot !== undefined;
  const structuredWithoutTargets =
    (action.grants !== undefined && action.grants.target !== "target") ||
    action.multiattack !== undefined ||
    spendsALimitedUse ||
    input.builtin === true;
  if (targets.length === 0 && !structuredWithoutTargets && action.grants?.target !== "target")
    throw new CommandRejectedError("Choose at least one target.");
  if (
    !action.attack &&
    !action.save &&
    action.damage.length === 0 &&
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
  action: DefinitionAction,
  input: ResolveInput,
  deps: ResolveDependencies
): ResolveContext {
  const { attacker, targets } = combatantsOf(state, action, input);
  const warnings: string[] = [];
  const derivation = deriveEquipment(attacker, deps.definition, deps.catalog);
  const siblings = effectiveActions(deps.definition, attacker, deps.catalog);
  const riderItemId = sourceItemOf(action, derivation, attacker.inventory);
  const economy = planEconomy(state, attacker, action, input, deps.definition, warnings, deps.distanceFeet, siblings);
  let overridden = economy.overridden;

  // GM-adjudicated cover (SRD Cover, no line-of-sight engine): total cover can't be targeted;
  // half/three-quarters add to AC and Dexterity saves.
  const coverMode = effectiveModeFor(state.combat, "cover.total");
  if (input.cover === "total" && coverMode !== "freeform") {
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
    coverBonus: input.cover === "half" ? 2 : input.cover === "three-quarters" ? 5 : 0,
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
    rollMode: undefined,
    check: null,
    attack: null,
    crit: false,
    riderFilters: {},
    damage: [],
    bonusDamage: [],
    masterySwing: null,
    effectsApplied: [],
    effectGranted: null,
    effectsEnded: [],
    reactionPrompts: [],
    builtinSave: null
  };
  if (builtin?.prepare) ctx.action = builtin.prepare(ctx);
  return ctx;
}

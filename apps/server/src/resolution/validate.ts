import type { SpellReference } from "@vtt/content-srd-5.2.1";
import { isOffPlane } from "../off-plane.js";
import type { GameState } from "@vtt/domain";
import { checkChoices } from "./grant-extras.js";
import { effectiveActions } from "../effective-actions.js";
import { withShotAmmunitionOnly } from "../ammunition.js";
import { consumableRowFor } from "../consumables.js";
import { deriveEquipment, sourceItemOf } from "../equipment-derivation.js";
import { CommandRejectedError, RulesBlockedError } from "../game-store.js";
import {
  effectiveModeFor,
  overrideCovers,
  overrideReason,
  overrideWaives,
  rulesInForce,
  type RuleId
} from "../rules-families.js";
import {
  isItemActionId,
  isLongCastingTime,
  laterRowOf,
  laterSpellActionId,
  upcastAction,
  withSpellAttackReach,
  withSpellEffects
} from "../item-actions.js";
import { bestCover, coverBonusOf, coverFor, mapCover } from "../cover.js";
import { bonusNeedsDarkness, builtinBaseId } from "../builtin-actions.js";
import { holdsFeature } from "../class-features.js";
import { isIncapacitated } from "../condition-rules.js";
import { areEnemies } from "../creature-sides.js";
import { smiteOfProtectionCover } from "../paladin-auras.js";
import { sceneSight } from "../vision/sight.js";
import { hidingPlace, inDimLightOrDarkness } from "../vision/rules.js";
import { scrollOfAction } from "../scrolls.js";
import { creatureTypeOf } from "../statblock-facts.js";
import { reachBarredBy } from "../zone-barriers.js";
import { builtinHandlerFor } from "./builtins.js";
import {
  resolveHiddenCheck,
  type DefinitionAction,
  type LiveActor,
  type ResolveContext,
  type ResolveDependencies,
  type ResolveInput
} from "./context.js";
import { castLevelOf, planEconomy, type EconomyPlan } from "./economy.js";

/** The attacker and targets, refused unless the action has something structured to resolve against them. */
function combatantsOf(
  state: GameState,
  action: DefinitionAction,
  input: ResolveInput,
  catalog: ResolveDependencies["catalog"],
  spell: SpellReference | undefined,
  hidden: (actorId: string) => boolean
): { attacker: LiveActor; targets: LiveActor[] } {
  // Casting a spell is something done even when it rolls nothing (Light, Guidance): it spends its casting time and is
  // told to the table. What a spell lets its caster do later is no new cast.
  const castsASpell = action.spellId !== undefined && !(spell !== undefined && laterRowOf(spell, action.id));
  // Outside a fight a creature's own cast still starts what it starts (a grant, Concentration, a save, an area), with
  // no turn to spend; an item's use stays on the loose route, which spends its charges.
  const outsideFight = !state.combat.active;
  if (outsideFight && !(castsASpell && !isItemActionId(action.id)))
    throw new CommandRejectedError("Start an encounter before resolving actions.");
  const inFight = (actorId: string) =>
    outsideFight
      ? state.actors.some((actor) => actor.id === actorId)
      : state.combat.initiative.some((entry) => entry.actorId === actorId);
  const attacker = state.actors.find((item) => item.id === input.actorId);
  if (!attacker) throw new CommandRejectedError("That combatant no longer exists.");
  if (!inFight(input.actorId)) throw new CommandRejectedError("That combatant is not in this encounter.");
  // A creature off the plane affects and is affected only by what is there with it (Banishment, Blink).
  const awayFrom = (target: LiveActor) => isOffPlane(attacker) !== isOffPlane(target);
  // A target named twice is one target (a second dart is the only reason to name it again).
  const targets = [...new Set(input.targetIds)].map((targetId) => {
    const target = state.actors.find((item) => item.id === targetId);
    if (!target || !inFight(targetId))
      throw new CommandRejectedError(
        outsideFight
          ? "Choose members of the party or creatures you can see."
          : "Every target must be in this encounter."
      );
    // A refusal names the target only when the user's side can see it.
    const name = hidden(target.id) ? "that creature" : target.name;
    if (awayFrom(target))
      throw new CommandRejectedError(
        isOffPlane(attacker)
          ? `${attacker.name} is off this plane and can't reach ${name}.`
          : `${name[0]!.toUpperCase()}${name.slice(1)} is gone from this plane for now and can't be targeted.`
      );
    return target;
  });
  // A readied spell is cast now and aimed when its trigger comes (SRD Ready), so it names no target yet; nor does an
  // action whose move is taken before the rest of it.
  if (input.ready === true) return { attacker, targets };
  if (input.moveFirst === true) {
    if (!action.move) throw new CommandRejectedError(`${action.name} makes no move of its own to take first.`);
    return { attacker, targets };
  }
  if (action.attack && targets.length !== 1)
    throw new CommandRejectedError("An attack roll resolves against exactly one target.");
  // A grant aimed at the action's target (Help) needs exactly one recipient; one for each target (Bless), at least one.
  if (action.grants?.target === "target" && targets.length !== 1)
    throw new CommandRejectedError("Choose exactly one target for this action.");
  if (action.grants?.target === "targets" && targets.length === 0)
    throw new CommandRejectedError("Choose the creatures this action targets.");
  // A limited use, a spell slot or the legendary pool is itself the mechanic (Action Surge, Arcane Recovery, a dragon's
  // Commanding Presence), so an action that only spends one resolves without a roll or a target; so does one that uses
  // up an item (a scroll of Detect Magic read in the fight).
  const spendsALimitedUse =
    action.uses !== undefined ||
    action.spellSlot !== undefined ||
    action.legendary !== undefined ||
    consumableRowFor(action, attacker.inventory, catalog) !== null;
  // A spell that lasts and acts again later (Produce Flame, a lingering area) starts with no creature under it yet.
  const startsALastingSpell = castsASpell && (spell?.effect?.laterActions ?? []).length > 0;
  // Moving a spell's area (Moonbeam, Flaming Sphere's ram) is something done, whoever it moves onto.
  const movesAnArea = spell !== undefined && laterRowOf(spell, action.id)?.movesArea !== undefined;
  // Spreading Caltrops leaves an area that acts on whoever meets it later.
  const leavesAnArea = action.zone !== undefined && !castsASpell;
  const rollsOnTargets =
    action.attack !== undefined ||
    action.save !== undefined ||
    action.damage.length > 0 ||
    (action.healing !== undefined && action.healing.self !== true) ||
    action.endsConditions !== undefined;
  const structuredWithoutTargets =
    (action.grants !== undefined && action.grants.target !== "target") ||
    action.healing?.self === true ||
    action.multiattack !== undefined ||
    spendsALimitedUse ||
    startsALastingSpell ||
    movesAnArea ||
    leavesAnArea ||
    // A move, jump or teleport of its own (a troll's Charge, a bulette's Leap) is something done.
    action.move !== undefined ||
    action.leap !== undefined ||
    action.teleport !== undefined ||
    (castsASpell && !rollsOnTargets) ||
    input.builtin === true ||
    // A light or a cloud is something done, with no creature under it (a magmin's flames, a darkmantle's aura).
    action.sight !== undefined;
  // A touch that heals by the points spent or ends a condition (Lay on Hands) is spent on someone.
  const touchesSomeone = action.endsConditions !== undefined || action.healing?.perUse === true;
  if (targets.length === 0 && (touchesSomeone || (!structuredWithoutTargets && action.grants?.target !== "target")))
    throw new CommandRejectedError("Choose at least one target.");
  if (
    !action.attack &&
    !action.save &&
    action.damage.length === 0 &&
    !action.healing &&
    action.grants === undefined &&
    action.multiattack === undefined &&
    action.dispel === undefined &&
    action.endsCurses === undefined &&
    !spendsALimitedUse &&
    !castsASpell &&
    !movesAnArea &&
    action.sight === undefined &&
    action.move === undefined &&
    action.leap === undefined &&
    action.teleport === undefined &&
    action.raisesCorpse === undefined &&
    input.builtin !== true
  )
    throw new CommandRejectedError("That action has no structured effect to resolve. Run it from its description.");
  return { attacker, targets };
}

/** The enemies on the map that see the creature and that it sees, by name; none while dynamic vision is off. A
 *  creature hidden from whoever asks (by sight, the fog or GM-only) never counts for one they can see, or the refusal
 *  would name it. */
function enemiesWatching(
  state: GameState,
  hider: LiveActor,
  deps: ResolveDependencies,
  hidden: (actorId: string) => boolean
): string[] {
  const sight = sceneSight(state, {
    ...(deps.resolveDefinition ? { definition: deps.resolveDefinition } : {}),
    ...(deps.catalog ? { catalog: deps.catalog } : {})
  });
  if (!sight.enabled) return [];
  return state.combat.initiative.flatMap((entry) => {
    const enemy = state.actors.find((actor) => actor.id === entry.actorId);
    if (!enemy || enemy.id === hider.id || isIncapacitated(enemy)) return [];
    if (hidden(enemy.id) && !hidden(hider.id)) return [];
    if (!areEnemies(hider, enemy, deps.resolveDefinition)) return [];
    return sight.sees(hider.id, enemy.id) && sight.sees(enemy.id, hider.id) ? [enemy.name] : [];
  });
}

/** Validates the resolve against the encounter and the rules mode, plans its economy, and opens the
 *  context every later step reads. Throws before anything is rolled or written. */
export function openResolve(
  state: GameState,
  declared: DefinitionAction,
  input: ResolveInput,
  deps: ResolveDependencies
): ResolveContext {
  const hiddenFromTable = resolveHiddenCheck(state, deps, false);
  const hiddenFromInitiator = resolveHiddenCheck(state, deps, true);
  const spell = declared.spellId ? deps.catalog?.spellRecord?.(declared.spellId) : undefined;
  const reaching = withSpellEffects(withSpellAttackReach(declared, spell), spell);
  const combatants = combatantsOf(state, reaching, input, deps.catalog, spell, hiddenFromInitiator);
  const { attacker } = combatants;
  const warnings: string[] = [];
  const targets = input.areaPlaced ? onlyTargetTypes(combatants.targets, spell, deps, warnings) : combatants.targets;
  // A spell cast with a higher slot rolls that slot's dice and makes its rays (before the economy opens the action's
  // instance); a paid replay names the slot it was cast with.
  const castLevel = input.economyPaid ? input.slotLevel : castLevelOf(state, attacker, reaching, input.slotLevel);
  const upcast =
    castLevel !== null && castLevel !== undefined && spell && reaching.spellSlot && castLevel > reaching.spellSlot.level
      ? upcastAction(reaching, spell, castLevel)
      : reaching;
  const action = withChosenDamageType(upcast, input.damageType ?? null);
  // An option or a weapon the action doesn't offer is refused before anything rolls.
  checkChoices(action, input, attacker, deps.catalog);
  const derived = deriveEquipment(attacker, deps.definition, deps.catalog);
  const siblings = effectiveActions(deps.definition, attacker, deps.catalog);
  const riderItemId = sourceItemOf(action, derived, attacker.inventory);
  const derivation = withShotAmmunitionOnly(derived, attacker, riderItemId, deps.catalog);
  // Magic Missile: each dart at a creature of the caster's choice, the targets listed dart by dart.
  if (action.darts !== undefined && input.targetIds.length > action.darts)
    throw new CommandRejectedError(
      `${action.name} makes ${action.darts} darts; ${input.targetIds.length} were assigned.`
    );
  const economy =
    input.economyPaid || input.owedPaid
      ? { plan: paidPlan(state, input.slotLevel), overridden: null }
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

  // SRD Cover: the GM's choice for this resolve, else the best of the cover the GM marked the target with and what the
  // map gives it from the walls and creatures between. Total cover can't be targeted; half/three-quarters add to AC and
  // Dexterity saves.
  const coverMode = effectiveModeFor(rulesInForce(state), "cover.total");
  // A Paladin's Smite of Protection gives Half Cover to the creatures in its aura.
  const auraCover = (target: LiveActor) =>
    deps.resolveDefinition
      ? smiteOfProtectionCover(state, target, {
          resolveDefinition: deps.resolveDefinition,
          ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {}),
          ...(deps.catalog ? { catalog: deps.catalog } : {})
        })
      : null;
  // With dynamic vision on, the walls and creatures between them cover the target too (`mapCover`); an area's
  // creatures were caught by what its point of origin reaches, so a placed area reads no cover from the caster.
  const fromMap = (target: LiveActor) => (input.areaPlaced === true ? null : mapCover(state, attacker.id, target.id));
  const attackCover =
    targets.length === 1
      ? (input.cover ?? bestCover(coverFor(null, targets[0]), fromMap(targets[0]), auraCover(targets[0])))
      : (input.cover ?? null);
  // An area's other targets still take it, so a marked creature among several is the GM's to remove.
  if (targets.length > 1)
    for (const target of targets)
      if ((input.cover ?? null) === null && coverFor(null, target) === "total")
        warnings.push(`${target.name} has Total Cover. Leave it out if the effect can't reach it.`);
  if (attackCover === "total" && coverMode !== "freeform") {
    const waived = overrideWaives(input.override, "cover.total");
    if (coverMode === "strict" && !waived && !overrideCovers(state.combat.turn, "cover.total"))
      throw new RulesBlockedError("cover.total", "The target has Total Cover and can't be targeted directly.");
    if (waived && overridden === null) overridden = { rule: "cover.total", reason: overrideReason(input.override) };
    else warnings.push("The target has Total Cover. The rules mode allows it.");
  }

  const sightContent = {
    ...(deps.resolveDefinition ? { definition: deps.resolveDefinition } : {}),
    ...(deps.catalog ? { catalog: deps.catalog } : {})
  };
  const sightBlocks: Array<readonly [RuleId, string]> = [];
  // SRD Hide: "you must be out of any enemy's line of sight". With dynamic vision on the engine knows who sees whom;
  // only an enemy the hider sees counts ("if you can see a creature, you can discern whether it can see you"), so
  // the refusal never gives away one the player doesn't know of.
  if (input.builtin && builtinBaseId(action.id) === "hide") {
    const watchers = enemiesWatching(state, attacker, deps, hiddenFromInitiator);
    const mode = effectiveModeFor(state.combat, "hide.seen");
    if (watchers.length > 0 && mode !== "freeform") {
      const message = `${watchers.join(" and ")} can see ${attacker.name}. Hide out of every enemy's sight.`;
      const waived = overrideWaives(input.override, "hide.seen");
      if (mode === "strict" && !waived && !overrideCovers(state.combat.turn, "hide.seen"))
        throw new RulesBlockedError("hide.seen", message);
      if (waived && overridden === null) overridden = { rule: "hide.seen", reason: overrideReason(input.override) };
      else warnings.push(message);
    }
    // "While you're Heavily Obscured or behind Three-Quarters Cover or Total Cover"; with dynamic vision on the map
    // answers it (`vision/rules.ts`).
    const enemies = state.combat.initiative.flatMap((entry) => {
      const enemy = state.actors.find((actor) => actor.id === entry.actorId);
      if (!enemy || enemy.id === attacker.id || isIncapacitated(enemy)) return [];
      if (hiddenFromInitiator(enemy.id) && !hiddenFromInitiator(attacker.id)) return [];
      return areEnemies(attacker, enemy, deps.resolveDefinition) ? [enemy.id] : [];
    });
    const stealthy = holdsFeature(deps.definition, "halfling-naturally-stealthy", "Naturally Stealthy");
    if (!hidingPlace(state, sightContent, attacker.id, enemies, stealthy))
      sightBlocks.push([
        "hide.exposed",
        `${attacker.name} isn't Heavily Obscured or behind Three-Quarters Cover. Hide in darkness, fog or behind a wall.`
      ]);
  }
  // What works only in Dim Light or Darkness (a shadow's Shadow Stealth, Merge with Shadows, One with Shadows), where
  // dynamic vision knows the light.
  if (needsDimLightOrDarkness(deps.definition, action) && !inDimLightOrDarkness(state, attacker.id, sightContent))
    sightBlocks.push([
      "light.too-bright",
      `${attacker.name} stands in Bright Light. ${action.name} needs Dim Light or darkness.`
    ]);
  // A melee attack can't reach through a barrier that holds its attacker back (Antilife Shell).
  const shell = reachBarredBy(state, attacker, action, targets, deps);
  if (shell) sightBlocks.push(["range.out-of-reach", shell]);
  for (const [rule, message] of sightBlocks) {
    const mode = effectiveModeFor(state.combat, rule);
    if (mode === "freeform") continue;
    const waived = overrideWaives(input.override, rule);
    if (mode === "strict" && !waived && !overrideCovers(state.combat.turn, rule))
      throw new RulesBlockedError(rule, message);
    if (waived && overridden === null) overridden = { rule, reason: overrideReason(input.override) };
    else warnings.push(message);
  }

  const builtin = input.builtin ? builtinHandlerFor(action.id) : undefined;
  const ctx: ResolveContext = {
    state,
    action,
    input,
    deps,
    hiddenFromTable,
    hiddenFromInitiator,
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
    hitRiders: [],
    damageEffectIds: [],
    forgoneAdvantageBy: input.forgoneAdvantageBy ?? null,
    keepsHidden: false
  };
  if (builtin?.prepare) ctx.action = builtin.prepare(ctx);
  if (!input.economyPaid)
    warnings.push(
      ...laterActionReminders(
        spell,
        action,
        scrollOfAction(action, attacker.inventory, deps.catalog) !== null,
        state.combat.active
      )
    );
  return ctx;
}

/** An area's catch, less the creatures of a type the spell doesn't affect ("Each Humanoid in a 20-foot-radius
 *  Sphere"), each named to the GM. A type the stat block doesn't print stays in. */
function onlyTargetTypes(
  targets: LiveActor[],
  spell: SpellReference | undefined,
  deps: ResolveDependencies,
  warnings: string[]
): LiveActor[] {
  const types = spell?.effect?.targetTypes;
  if (!types || !deps.resolveDefinition) return targets;
  return targets.filter((target) => {
    const definition = target.definitionId ? deps.resolveDefinition!(target.definitionId) : undefined;
    const type = creatureTypeOf(target, definition);
    if (type === null || types.includes(type)) return true;
    warnings.push(
      `${target.name} isn't affected by ${spell!.name}, which affects only ${types.join(" or ")} creatures.`
    );
    return false;
  });
}

/** An action whose caster picks the damage type (Chromatic Orb) deals the one picked, every part of it. */
export function withChosenDamageType(action: DefinitionAction, chosen: string | null): DefinitionAction {
  if (chosen === null) return action;
  if (!action.damageTypes?.includes(chosen as never))
    throw new CommandRejectedError(`${action.name} can't deal ${chosen} damage.`);
  return { ...action, damage: action.damage.map((part) => ({ ...part, type: chosen })) };
}

/** The GM's reminder on casting a spell that does more later (SRD text): what the caster may do on later turns, and
 *  what the GM spots for an area the server doesn't watch (an area with a zone it does). A creature's own long cast
 *  runs over its turns (`long-casting.ts`); an item's in a fight is the GM's to time, and a scroll read for a long
 *  casting time "isn't lost" if the casting is interrupted. */
function laterActionReminders(
  spell: SpellReference | undefined,
  action: DefinitionAction,
  fromScroll: boolean,
  inFight: boolean
): string[] {
  const later = spell?.effect?.laterActions ?? [];
  if (!spell || later.some((row) => laterSpellActionId(spell.id, row.name) === action.id)) return [];
  return [
    ...(inFight && isItemActionId(action.id) && isLongCastingTime(spell.castingTime)
      ? [
          `${spell.name} takes ${spell.castingTime} to cast. Until then, the caster takes the Magic action on each turn and keeps Concentration. If that breaks, the spell fails and ${fromScroll ? "the scroll isn't lost, so give it back on the sheet" : "its charges aren't spent, so restore them on the sheet"}.`
        ]
      : []),
    ...later
      .filter((row) => row.zone === undefined)
      .map((row) => `${spell.name}: ${row.when} Use "${spell.name}: ${row.name}" for it.`)
  ];
}

/** The plan of a resolve whose economy was already spent: it changes nothing, and casts at the slot it was made with. */
function paidPlan(state: GameState, slotLevel: number | undefined): EconomyPlan {
  return {
    markAction: false,
    markBonus: false,
    markReaction: false,
    instance: state.combat.turn.actionInstance,
    bonusInstance: state.combat.turn.bonusActionInstance,
    spendUse: null,
    spendLegendary: null,
    spendSpellSlot: null,
    castLevel: slotLevel ?? null,
    extraAction: null,
    magicAction: false,
    surge: false
  };
}

/** Whether an action works only in Dim Light or Darkness: one whose sight data says so (Merge with Shadows), a Bonus
 *  Action form a stat block offers "While in Dim Light or darkness" (Shadow Stealth), and One with Shadows' Invisibility
 *  without a slot ("while you're in an area of Dim Light or Darkness"). */
function needsDimLightOrDarkness(definition: ResolveDependencies["definition"], action: DefinitionAction): boolean {
  if ("sight" in action && action.sight?.inDimLightOrDarkness === true) return true;
  if (bonusNeedsDarkness(definition, action.id)) return true;
  return action.id === "spell-invisibility-free" && holdsFeature(definition, "one-with-shadows", "One with Shadows");
}

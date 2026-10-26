import type { SpellReference } from "@vtt/content-srd-5.2.1";
import { grappledBy } from "../movement-rules.js";
import { onOtherPlanes, planeOf } from "../ethereal.js";
import { underAntimagic } from "../antimagic.js";
import { catalogIdOf } from "@vtt/schemas";
import type { GameState } from "@vtt/domain";
import { checkChoices } from "./grant-extras.js";
import { effectiveActions } from "../effective-actions.js";
import { withShotAmmunitionOnly, withShotHitRiders } from "../ammunition.js";
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
import { reachBarredBy } from "../zone-barriers.js";
import { bearsCastOf, levitatedBy, takenWithCast } from "../lasting-spells.js";
import { checkStoredRelease } from "../stored-casts.js";
import { checkOrbLeap } from "./orb-leap.js";
import { swallowCover } from "../swallow.js";
import { enclosureBlocks } from "../enclosures.js";
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
import { actionTargetViolations } from "./action-targets.js";
import { withPickedDamageTypes } from "../statblock-picks.js";
import { typeGated } from "./type-gates.js";

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
  // Outside a fight a cast still starts what it starts (a grant, Concentration, a save, an area), with no turn to
  // spend, whether the creature or its item casts it, and so does an item's use that leaves an effect on its user
  // (Winged Boots' flight, a Ring of Invisibility).
  const outsideFight = !state.combat.active;
  // A shape-shift is something a creature does outside a fight too (Wild Shape to scout, a werewolf's change).
  const shapeShifts = action.shapeShift !== undefined || action.endsForm === true;
  const itemGrant = isItemActionId(action.id) && (action.grants !== undefined || action.rebindsRow !== undefined);
  // So is helping an ally with a check (picking a lock, calming a horse), which needs no turn.
  const helps = action.id === "help-check";
  // And what a lasting spell does by its caster's hand away from a fight (Dream's message to a sleeper, Geas's harm
  // to a defiant creature, Levitate's lift), so long as the spell is up.
  const lasting =
    spell !== undefined &&
    laterRowOf(spell, action.id) !== undefined &&
    laterRowOf(spell, action.id)!.zone === undefined;
  if (outsideFight && !castsASpell && !shapeShifts && !itemGrant && !helps && !lasting)
    throw new CommandRejectedError("Start an encounter before resolving actions.");
  const inFight = (actorId: string) =>
    outsideFight
      ? state.actors.some((actor) => actor.id === actorId)
      : state.combat.initiative.some((entry) => entry.actorId === actorId);
  const attacker = state.actors.find((item) => item.id === input.actorId);
  if (!attacker) throw new CommandRejectedError("That combatant no longer exists.");
  if (!inFight(input.actorId)) throw new CommandRejectedError("That combatant is not in this encounter.");
  // "If the roc has a creature Grappled": the flight that drops it needs one held.
  if (action.move?.dropsHeld && grappledBy(state, attacker.id).length === 0)
    throw new CommandRejectedError(`${attacker.name} has no creature Grappled to drop with ${action.name}.`);
  // A creature off the plane, or on the Border Ethereal, affects and is affected only by what is there with it
  // (Banishment, Etherealness, Blink).
  // A night hag's Nightmare Haunting reaches from the Border Ethereal to a creature on the Material Plane.
  const reachesMaterial = action.castRiders?.fromEthereal === true && planeOf(attacker) === "ethereal";
  const awayFrom = (target: LiveActor) =>
    onOtherPlanes(attacker, target) && !(reachesMaterial && planeOf(target) === "material");
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
        planeOf(attacker) !== "material"
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
  // So is moving a spell's force between its caster and harm (Arcane Hand's Interposing Hand).
  const movesAnArea =
    spell !== undefined &&
    (laterRowOf(spell, action.id)?.movesArea !== undefined ||
      laterRowOf(spell, action.id)?.interposes === true ||
      laterRowOf(spell, action.id)?.liftFeet !== undefined);
  // Looking at what a sense finds (Detect Magic's auras) is something done.
  const revealsASense = spell !== undefined && laterRowOf(spell, action.id)?.reveals === true;
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
    revealsASense ||
    leavesAnArea ||
    // A move, jump or teleport of its own (a troll's Charge, a bulette's Leap) is something done.
    action.move !== undefined ||
    action.leap !== undefined ||
    action.teleport !== undefined ||
    // A leap onto a space finds its creatures there (a bulette's Deadly Leap).
    action.destination?.who === "user" ||
    // Opening a flask frees the creature it holds; a drawn Frost Brand's cold and a Sun Blade's light act round it.
    action.releases !== undefined ||
    action.douses !== undefined ||
    action.lightsArea !== undefined ||
    action.adjustsLight !== undefined ||
    (castsASpell && !rollsOnTargets) ||
    input.builtin === true ||
    // A light or a cloud is something done, with no creature under it (a magmin's flames, a darkmantle's aura).
    action.sight !== undefined ||
    // A door or a wall is what it acts on (Knock, Passwall, Disintegrate aimed at a wall of force).
    (spell?.walls !== undefined && (input.wallId !== undefined || laterRowOf(spell, action.id) !== undefined)) ||
    // An object on the map in place of a creature (Acid thrown at a door).
    (input.wallId !== undefined && (action.targets?.objects === true || action.doorWork !== undefined)) ||
    // An area that harms the objects under it may catch no creature (Clap of Thunder against a door).
    (action.objectDamage !== undefined && input.placedArea !== undefined) ||
    // Pointing at what is hidden (a Wand of Secrets) is something done.
    action.pointsAtHidden !== undefined ||
    // Raising or shrinking a tower is something done (an Instant Fortress).
    action.raisesTower !== undefined ||
    action.dismissesTower === true ||
    // So is bringing creatures onto the map (a Horn of Valhalla's Berserkers).
    action.summons !== undefined ||
    // An item's command releases whoever it holds (Iron Bands), and an oil remakes a carried row.
    action.endsItemEffects === true ||
    action.rebindsRow !== undefined ||
    // Taking a form, or leaving it, is the user's own (Wild Shape, a werewolf's Shape-Shift).
    (shapeShifts && action.shapeShift?.onTargets !== true && action.save === undefined);
  // A touch that heals by the points spent or ends a condition (Lay on Hands) is spent on someone, and so is a swallow.
  const touchesSomeone =
    action.endsConditions !== undefined ||
    action.restores === true ||
    action.healing?.perUse === true ||
    action.swallow?.conditions !== undefined ||
    action.pull !== undefined;
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
    action.restores === undefined &&
    !spendsALimitedUse &&
    !castsASpell &&
    !movesAnArea &&
    !revealsASense &&
    action.sight === undefined &&
    !shapeShifts &&
    action.move === undefined &&
    action.leap === undefined &&
    action.teleport === undefined &&
    action.releases === undefined &&
    action.douses === undefined &&
    action.lightsArea === undefined &&
    action.doorWork === undefined &&
    action.pointsAtHidden === undefined &&
    action.raisesTower === undefined &&
    action.dismissesTower !== true &&
    action.adjustsLight === undefined &&
    action.summons === undefined &&
    action.raisesCorpse === undefined &&
    action.swallow?.conditions === undefined &&
    action.pull === undefined &&
    action.inflicts === undefined &&
    action.endsItemEffects !== true &&
    action.rebindsRow === undefined &&
    input.builtin !== true &&
    !(spell?.walls !== undefined && (input.wallId !== undefined || laterRowOf(spell, action.id) !== undefined))
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
  // A creature of a type the action can't affect is a target that nothing happens to, picked or caught in an area.
  const gated = typeGated({
    state,
    casterId: combatants.attacker.id,
    action: reaching,
    spell,
    targets: combatants.targets,
    areaPlaced: input.areaPlaced === true,
    resolveDefinition: deps.resolveDefinition,
    catalog: deps.catalog,
    hidden: hiddenFromInitiator
  });
  warnings.push(...gated.warnings);
  const caught = gated.affected;
  // A swallowed creature has Total Cover from an area outside its swallower, and is left out of it.
  const targets =
    caught.length > 1
      ? caught.filter((target) => {
          if (swallowCover(state, combatants.attacker.id, target.id) === null) return true;
          warnings.push(`${target.name} is swallowed and has Total Cover from ${declared.name}, so it is left out.`);
          return false;
        })
      : caught;
  // A spell cast with a higher slot rolls that slot's dice and makes its rays (before the economy opens the action's
  // instance); a paid replay names the slot it was cast with.
  const castLevel = input.economyPaid ? input.slotLevel : castLevelOf(state, attacker, reaching, input.slotLevel);
  const upcast =
    castLevel !== null && castLevel !== undefined && spell && reaching.spellSlot && castLevel > reaching.spellSlot.level
      ? upcastAction(reaching, spell, castLevel)
      : reaching;
  // A part of the creature's picked type (a half-dragon's Draconic Origin) deals that type.
  const chosen = withPickedDamageTypes(
    withChosenDamageType(upcast, input.damageType ?? null),
    attacker,
    deps.definition
  );
  // The cast's own free use of a later action costs nothing more (Arcane Hand's first effect).
  const withCast = spell !== undefined && takenWithCast(state, attacker.id, spell, chosen.id);
  // Levitating itself, the caster rises or sinks as part of its move (Levitate: "If you are the target, you can move
  // up or down as part of your move").
  const laterRow = spell ? laterRowOf(spell, chosen.id) : undefined;
  const ownLift = laterRow?.liftFeet !== undefined && levitatedBy(state, attacker.id)?.id === attacker.id;
  const action = withCast || ownLift ? { ...chosen, activation: "other" as const } : chosen;
  // What the GM alone judges has happened (Geas's defiance) is the GM's to take.
  if (laterRow?.gmOnly && deps.initiatorRole === "player")
    throw new CommandRejectedError(`The GM takes ${action.name} when the spell's trigger happens.`);
  // A later action that takes only a creature bearing the caster's spell (Arcane Hand's crush) refuses any other.
  if (spell && laterRow?.bearerOnly)
    for (const target of targets)
      if (!bearsCastOf(target, attacker.id, spell.id))
        throw new CommandRejectedError(
          `${hiddenFromInitiator(target.id) ? "That creature" : target.name} isn't under ${attacker.name}'s ${spell.name}, so ${action.name} can't take it.`
        );
  // Contingency's spell takes effect on its caster alone, while the statuette is carried.
  checkStoredRelease(attacker, action.id, input.targetIds);
  // An option or a weapon the action doesn't offer is refused before anything rolls.
  checkChoices(action, input, attacker, deps.catalog, deps.definition);
  // A target in an Antimagic Field: "Magical properties of magic items don't work ... on anything inside it", and a
  // magic item's own action can't reach it (a spell's is kept off by the field's ward).
  const antimagicTarget = targets.find(underAntimagic);
  const derived = deriveEquipment(attacker, deps.definition, deps.catalog, {
    suppressMagic: antimagicTarget !== undefined
  });
  const siblings = effectiveActions(deps.definition, attacker, deps.catalog);
  const riderItemId = sourceItemOf(action, derived, attacker.inventory);
  if (antimagicTarget && action.spellId === undefined && riderItemId) {
    const row = attacker.inventory.find((item) => item.id === riderItemId);
    const record = row ? deps.catalog?.equipmentRecord(catalogIdOf(row)) : undefined;
    if (record?.isMagic && isItemActionId(action.id))
      throw new CommandRejectedError(
        `${hiddenFromInitiator(antimagicTarget.id) ? "That creature" : antimagicTarget.name} stands in an Antimagic Field, where ${record.name} can't reach it.`
      );
  }
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
  // A spell wall between them that doesn't block the way covers the target as its text says (Blade Barrier).
  const fromMap = (target: LiveActor) =>
    input.areaPlaced === true
      ? null
      : bestCover(mapCover(state, attacker.id, target.id), deps.zoneCover?.(attacker.id, target.id));
  // Pulling a creature out of a gelatinous cube reaches into it, so the cover it has inside doesn't bar End an Effect.
  const reachesInside = input.builtin === true && builtinBaseId(action.id) === "end-an-effect";
  const attackCover =
    targets.length === 1
      ? (input.cover ??
        bestCover(
          coverFor(null, targets[0]),
          fromMap(targets[0]),
          auraCover(targets[0]),
          reachesInside ? null : swallowCover(state, attacker.id, targets[0].id)
        ))
      : (input.cover ?? null);
  // An area's other targets still take it, so a marked creature among several is the GM's to remove.
  if (targets.length > 1 && input.areaPlaced === true)
    for (const target of targets)
      if ((input.cover ?? null) === null && coverFor(null, target) === "total")
        warnings.push(`${target.name} has Total Cover. Leave it out if the effect can't reach it.`);
  // "A Clear Path to the Target": each creature picked for a spell of several targets (Magic Missile, Bless) needs one,
  // so the GM's mark or the walls on the map leaving it Total Cover bar it as they bar a single target.
  const covered =
    targets.length > 1 && input.areaPlaced !== true && (input.cover ?? null) === null
      ? targets.filter(
          (target) =>
            target.id !== attacker.id &&
            bestCover(coverFor(null, target), fromMap(target), swallowCover(state, attacker.id, target.id)) === "total"
        )
      : [];
  if ((attackCover === "total" || covered.length > 0) && coverMode !== "freeform") {
    const named = covered.map((target) => (hiddenFromInitiator(target.id) ? "A target" : target.name));
    const message =
      covered.length > 0
        ? `${named.join(" and ")} ${covered.length === 1 ? "has" : "have"} Total Cover and can't be targeted directly.`
        : "The target has Total Cover and can't be targeted directly.";
    const waived = overrideWaives(input.override, "cover.total");
    if (coverMode === "strict" && !waived && !overrideCovers(state.combat.turn, "cover.total"))
      throw new RulesBlockedError("cover.total", message);
    if (waived && overridden === null) overridden = { rule: "cover.total", reason: overrideReason(input.override) };
    else warnings.push(`${message.replace(" and can't be targeted directly.", ".")} The rules mode allows it.`);
  }

  const sightContent = {
    ...(deps.resolveDefinition ? { definition: deps.resolveDefinition } : {}),
    ...(deps.catalog ? { catalog: deps.catalog } : {})
  };
  const sightBlocks: Array<readonly [RuleId, string]> = [];
  // An action taken move first names its targets only once it has moved, so its own targeting rules are checked then
  // (a gelatinous cube's Engulf takes only the creatures it moved through).
  if (input.owedPaid === true)
    for (const violation of actionTargetViolations({
      state,
      attacker,
      action,
      targetIds: input.targetIds,
      definition: deps.definition,
      resolveDefinition: deps.resolveDefinition,
      distanceFeet: deps.distanceFeet,
      catalog: deps.catalog
    }))
      sightBlocks.push([violation.rule, violation.message]);
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
  // Nothing passes a sphere of force, in or out (Resilient Sphere, Bead of Force).
  const sphere = enclosureBlocks(attacker, action, targets, deps.catalog);
  if (sphere) sightBlocks.push(["cover.total", sphere]);
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
    // A shot carries what a hit with the piece it draws does (Ammunition of Slaying).
    action: withShotHitRiders(action, attacker, riderItemId, deps.catalog),
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
    tableNarration: [...gated.gmLines],
    sensed: [],
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
    keepsHidden: false,
    ...(withCast ? { withCast: true } : {})
  };
  if (builtin?.prepare) ctx.action = builtin.prepare(ctx);
  // A leaping Chromatic Orb: a new creature within 30 feet of the last, of the cast's type.
  ctx.action = checkOrbLeap(ctx);
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

/** The GM's reminder on casting a spell that does more later (SRD text): what the caster may do on later turns, and
 *  what the GM spots for an area the server doesn't watch (an area with a zone it does). A long cast runs over its
 *  caster's turns (`long-casting.ts`), an item's or a scroll's as much as a creature's own. */
function laterActionReminders(spell: SpellReference | undefined, action: DefinitionAction): string[] {
  const later = spell?.effect?.laterActions ?? [];
  if (!spell || later.some((row) => laterSpellActionId(spell.id, row.name) === action.id)) return [];
  return later
    .filter((row) => row.zone === undefined)
    .map((row) => `${spell.name}: ${row.when} Use "${spell.name}: ${row.name}" for it.`);
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

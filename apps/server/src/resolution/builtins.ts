import { d20FacesFor } from "@vtt/rules-5e";
import { wardedConditions } from "../paladin-auras.js";
import type { ActorDefinition } from "@vtt/schemas";
import { checkPlan, totalCheck, type CheckSubject, type CheckVersus } from "../ability-checks.js";
import { creatureTypeOf } from "../statblock-facts.js";
import { areEnemies } from "../creature-sides.js";
import { effectiveSkillTier } from "../equipment-derivation.js";
import { endUsedHelp, useHelp } from "../help-assist.js";
import { checkSightFor, couldSpot } from "../vision/rules.js";
import { builtinBaseId, END_EFFECT_ID } from "../builtin-actions.js";
import {
  addEffect,
  endEffect,
  ESCAPE_ATHLETICS_TAG,
  ESCAPE_DISADVANTAGE_TAG,
  makeEffect,
  WAKEABLE_TAG
} from "../effects.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { putOutFire } from "../hazards.js";
import { endingOptions } from "../ending-actions.js";
import { openEndingSave } from "../save-stages.js";
import { applyDamageDetailed } from "../hit-points.js";
import { rollPlain } from "./hit-rider-outcomes.js";
import { CommandRejectedError } from "../game-store.js";
import { createPendingSaves, saveModifierFor, shownRollMode } from "../saving-throws.js";
import {
  abilityModifier,
  endedEffect,
  recordRoll,
  tableLineOf,
  type DefinitionAction,
  type ResolveContext
} from "./context.js";

/** What the declarative action vocabulary can't express about a builtin action (`builtin-actions.ts`),
 *  one hook per moment of a resolve. A hook runs only for an action taken from the builtin catalog, so a
 *  stat-block action that shadows a builtin id (a Monk's own Unarmed Strike) keeps its own numbers. */
export type BuiltinHandler = Readonly<{
  /** Rewrites the action once the economy is planned and before anything rolls. */
  prepare?: (ctx: ResolveContext) => DefinitionAction;
  /** The check roll the action is. */
  check?: (ctx: ResolveContext) => void;
  /** What the action does to its user that no field can say (rolling on the ground puts out a fire). */
  apply?: (ctx: ResolveContext) => void;
  /** Flat damage added on a hit. */
  hitDamage?: (ctx: ResolveContext) => void;
  /** The granted effect's name in place of the grant's own; null keeps it. */
  grantName?: (ctx: ResolveContext) => string | null;
  /** A saving throw forced on the one target. */
  forcedSave?: (ctx: ResolveContext) => void;
  /** Targets at most one size larger than the actor (SRD Unarmed Strike). A target rule, so it is checked
   *  by id wherever the action's economy is evaluated. */
  atMostOneSizeLarger?: boolean;
  /** Targets an enemy within 5 feet (SRD Help); checked by id like the size rule. */
  distractsAnEnemy?: boolean;
}>;

/**
 * One ability check through the sheet's own plan (`checkPlan`): the skill's proficiency or Expertise, Jack of All
 * Trades, a stat block's printed skill, check riders, Exhaustion, Reliable Talent, and the Advantage or Disadvantage
 * the rules give (items, armor's Stealth, Poisoned, Frightened), recorded like any roll. The GM's explicit roll mode
 * wins. Null success: no DC, the GM adjudicates. `label` names, in the result, a check the action needs before it can
 * work (reading a scroll), which the GM's mode for the action's own roll doesn't touch; the roll keeps the action's name.
 */
export function rollCheck(
  ctx: ResolveContext,
  subject: CheckSubject,
  dc: number | null,
  label?: string,
  stakes: readonly string[] = [],
  versus?: CheckVersus,
  /** A Disadvantage the check's own rule gives it, by name (escaping a mimic's grip). */
  disadvantage?: string
): boolean | null {
  // A Help an earlier check used ends before this one is planned.
  const helpEnded = endUsedHelp(ctx.state, ctx.attacker);
  const warded = ctx.deps.resolveDefinition
    ? wardedConditions(ctx.state, ctx.attacker, {
        resolveDefinition: ctx.deps.resolveDefinition,
        ...(ctx.deps.distanceFeet ? { distanceFeet: ctx.deps.distanceFeet } : {}),
        ...(ctx.deps.catalog ? { catalog: ctx.deps.catalog } : {})
      })
    : [];
  const plan = checkPlan(ctx.attacker, ctx.deps.definition, ctx.derivation, subject, {
    ...(warded.length > 0 ? { warded } : {}),
    ...(stakes.length > 0 ? { stakes } : {}),
    ...(versus ? { versus } : {}),
    // Frightened's line of sight and the light the roller stands in (Sunlight Sensitivity).
    sight: checkSightFor(
      ctx.state,
      ctx.attacker,
      {
        ...(ctx.deps.resolveDefinition ? { definition: ctx.deps.resolveDefinition } : {}),
        ...(ctx.deps.catalog ? { catalog: ctx.deps.catalog } : {})
      },
      undefined,
      ctx.deps.distanceFeet
    )
  });
  const forced = label === undefined ? (ctx.input.rollMode ?? undefined) : undefined;
  const rollMode =
    disadvantage === undefined
      ? plan.rollMode
      : {
          mode: plan.rollMode.advantage.length > 0 ? ("normal" as const) : ("disadvantage" as const),
          advantage: plan.rollMode.advantage,
          disadvantage: [...plan.rollMode.disadvantage, disadvantage]
        };
  const mode = forced ?? rollMode.mode;
  ctx.rollMode = shownRollMode(rollMode, forced);
  const roll = totalCheck(plan, d20FacesFor(mode, [], ctx.deps.random), mode, ctx.deps.random);
  recordRoll(ctx, roll.resolution, "check", undefined, { total: roll.total });
  // An ally's Help with this skill is used by this check.
  for (const event of [...helpEnded, ...useHelp(ctx.state, ctx.attacker, subject, true)])
    ctx.tableNarration.push(tableLineOf(ctx, event));
  const success = plan.autoFails !== undefined ? false : dc === null ? null : roll.total >= dc;
  if (plan.autoFails !== undefined) ctx.warnings.push(plan.autoFails);
  ctx.check = { skill: label ?? plan.label, total: roll.total, naturalRoll: roll.natural, dc, success };
  return success;
}

/** The skills an SRD [Action] check may use, and the ability each goes with: Search's are Wisdom (Insight, Medicine,
 *  Perception, Survival), Study's Intelligence (Arcana, History, Investigation, Nature, Religion), Influence's Charisma
 *  (Deception, Intimidation, Performance, Persuasion) or Wisdom (Animal Handling). */
export const BUILTIN_CHECK_SKILLS: Readonly<Record<string, Readonly<Record<string, CheckSubject["ability"]>>>> = {
  // The usual skill first: it is the one a picker offers before the roller chooses.
  search: { perception: "wis", insight: "wis", medicine: "wis", survival: "wis" },
  study: { investigation: "int", arcana: "int", history: "int", nature: "int", religion: "int" },
  influence: { persuasion: "cha", deception: "cha", intimidation: "cha", performance: "cha", "animal-handling": "wis" },
  // Help with a Check offers every skill; the handler takes only one the helper is proficient in.
  "help-check": {
    athletics: "str",
    acrobatics: "dex",
    "sleight-of-hand": "dex",
    stealth: "dex",
    arcana: "int",
    history: "int",
    investigation: "int",
    nature: "int",
    religion: "int",
    "animal-handling": "wis",
    insight: "wis",
    medicine: "wis",
    perception: "wis",
    survival: "wis",
    deception: "cha",
    intimidation: "cha",
    performance: "cha",
    persuasion: "cha"
  }
};

/** A skill id as the table reads it ("sleight-of-hand" is "Sleight of Hand"). */
const skillWords = (id: string) =>
  id
    .split("-")
    .map((word, index) => (index > 0 && word === "of" ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`))
    .join(" ");

/** SRD Help, Assist an Ability Check: one of the helper's skill proficiencies, for an ally. The ally's effect carries
 *  Advantage on checks with that skill, which its next such check uses up (`help-assist.ts`). */
function helpWithCheck(ctx: ResolveContext): DefinitionAction {
  const { attacker, action, deps } = ctx;
  const skill = ctx.input.skill ?? undefined;
  if (skill === undefined || BUILTIN_CHECK_SKILLS["help-check"]![skill] === undefined)
    throw new CommandRejectedError("Help with a Check names the skill you help with.");
  if (effectiveSkillTier(deps.definition, ctx.derivation, skill) === "none")
    throw new CommandRejectedError(`${attacker.name} isn't proficient in ${skillWords(skill)}, so can't help with it.`);
  const ally = ctx.targets[0];
  if (!ally || ally.id === attacker.id)
    throw new CommandRejectedError("Help with a Check helps an ally, not yourself.");
  if (areEnemies(attacker, ally, deps.resolveDefinition))
    throw new CommandRejectedError(`${ally.name} isn't ${attacker.name}'s ally.`);
  return {
    ...action,
    grants: {
      ...action.grants!,
      modifiers: [
        {
          type: "roll-mode",
          roll: "check",
          mode: "advantage",
          when: [{ type: "on-ability-check" }, { type: "skill-is", skills: [skill] }]
        }
      ]
    }
  };
}

/** The skills a builtin check action lets its roller pick, the usual one first: Search, Study and Influence's, and
 *  Escape a Grapple's two. Empty for any other action. */
export function builtinCheckSkills(actionId: string): Array<{ id: string; ability: CheckSubject["ability"] }> {
  if (actionId === "escape-grapple")
    return [
      { id: "athletics", ability: "str" },
      { id: "acrobatics", ability: "dex" }
    ];
  return Object.entries(BUILTIN_CHECK_SKILLS[actionId] ?? {}).map(([id, ability]) => ({ id, ability }));
}

/** The check a Search, Study or Influence makes: the chosen skill with its ability, or the action's own ability alone
 *  when no skill fits (the SRD tables only suggest skills). */
function chosenSubject(ctx: ResolveContext, ability: CheckSubject["ability"]): CheckSubject {
  const skills = BUILTIN_CHECK_SKILLS[ctx.action.id] ?? {};
  const skill = ctx.input.skill ?? undefined;
  if (skill === undefined) return { ability };
  const skillAbility = skills[skill];
  if (skillAbility === undefined)
    throw new CommandRejectedError(
      `${ctx.action.name} uses ${Object.keys(skills).join(", ")}, and ${skill} is not one of them.`
    );
  return { ability: skillAbility, skill };
}

/** SRD Search and Study: the GM sets the DC and adjudicates. A Search with Perception also finds the hidden enemies
 *  whose Hide total it meets ("an enemy finds you"), with dynamic vision on, among those it could see but for hiding. */
const searchOrStudy = (ability: CheckSubject["ability"]) => (ctx: ResolveContext) => {
  const subject = chosenSubject(ctx, ability);
  rollCheck(ctx, subject, null);
  if (ctx.action.id === "search" && subject.skill === "perception") findHidden(ctx);
};

/** Ends the Hide of each enemy the searcher's Perception total finds. */
function findHidden(ctx: ResolveContext): void {
  const total = ctx.check?.total;
  if (total === undefined) return;
  const { state, attacker, deps } = ctx;
  const content = {
    ...(deps.resolveDefinition ? { definition: deps.resolveDefinition } : {}),
    ...(deps.catalog ? { catalog: deps.catalog } : {})
  };
  for (const other of state.actors) {
    if (other.id === attacker.id) continue;
    const hiding = other.effects.find((effect) => effect.tags.includes("hidden") && effect.findDc !== undefined);
    if (!hiding || total < hiding.findDc!) continue;
    if (!couldSpot(state, content, attacker.id, other.id, deps.distanceFeet)) continue;
    const events = endEffect(state, other.id, hiding.id);
    for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
    ctx.tableNarration.push({
      kind: "effect",
      text: `${attacker.name} finds ${other.name}.`,
      actorIds: [attacker.id, other.id]
    });
  }
}

/** SRD Influence: "a default DC equal to 15 or the monster's Intelligence score, whichever is higher", so a monster
 *  picked as the target sets it; with none, the GM does. Its attitude gives Advantage when Friendly and Disadvantage
 *  when Hostile, and its charmer has Advantage (`socialClaims`). Animal Handling is for "gently coaxing a Beast or
 *  Monstrosity". */
function influence(ctx: ResolveContext): void {
  const monster = ctx.targets[0];
  const monsterDefinition = monster?.definitionId ? ctx.deps.resolveDefinition?.(monster.definitionId) : undefined;
  const dc = monsterDefinition ? Math.max(15, monsterDefinition.abilityScores.int) : null;
  const subject = chosenSubject(ctx, "cha");
  const type = monster ? creatureTypeOf(monster, monsterDefinition) : null;
  if (subject.skill === "animal-handling" && type !== null && type !== "beast" && type !== "monstrosity")
    throw new CommandRejectedError(
      `Animal Handling influences a Beast or Monstrosity, and ${monster!.name} is ${/^[aeiou]/.test(type) ? "an" : "a"} ${titleCase(type)}.`
    );
  const versus: CheckVersus | undefined = monster
    ? {
        actor: monster,
        humanoid: type === "humanoid",
        feet: ctx.deps.distanceFeet?.(ctx.attacker.id, monster.id) ?? null
      }
    : undefined;
  rollCheck(ctx, subject, dc, undefined, [], versus);
}

const titleCase = (word: string) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`;

/** SRD Hide: a DC 15 Dexterity (Stealth) check. On a success, Invisible while hidden; attacking ends it
 *  (`releaseHideAndReady`). The total is the DC to find the creature, so the effect names it. */
function hide(ctx: ResolveContext): void {
  if (rollCheck(ctx, { ability: "dex", skill: "stealth" }, 15) !== true) return;
  const { state, attacker, input, deps } = ctx;
  const effect = addEffect(
    state,
    attacker.id,
    makeEffect({
      id: `${input.commandId}:hide`,
      name: `Hiding (DC ${ctx.check!.total} to find)`,
      tags: ["hidden"],
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      sourceActionId: "hide",
      startedRound: state.combat.round,
      duration: { type: "manual" },
      linkedConditionIds: ["invisible"],
      findDc: ctx.check!.total
    }),
    undefined,
    deps
  );
  ctx.effectGranted = { name: effect.name, tags: effect.tags };
}

/** SRD Grappling: a Strength (Athletics) or Dexterity (Acrobatics) check against the holding effect's escape DC, the
 *  one asked for or else the better bonus; success ends the effect and its linked Grappled/Restrained. */
function escapeGrapple(ctx: ResolveContext): void {
  const { state, attacker, input, deps } = ctx;
  const escapable =
    (input.effectId ? attacker.effects.find((effect) => effect.id === input.effectId) : undefined) ??
    attacker.effects.find((effect) => effect.escapeDc !== null);
  if (!escapable || escapable.escapeDc === null)
    throw new CommandRejectedError("No escapable effect (one with an escape DC) is active on this combatant.");
  const athletics: CheckSubject = { ability: "str", skill: "athletics" };
  const acrobatics: CheckSubject = { ability: "dex", skill: "acrobatics" };
  // A spell's restraint (Web, Entangle) is broken with Strength (Athletics) alone.
  const athleticsOnly = escapable.tags.includes(ESCAPE_ATHLETICS_TAG);
  if (input.skill && input.skill !== "athletics" && (athleticsOnly || input.skill !== "acrobatics"))
    throw new CommandRejectedError(
      athleticsOnly
        ? `Breaking free of ${escapable.name} takes a Strength (Athletics) check.`
        : "Escaping a grapple uses Athletics or Acrobatics."
    );
  const better =
    athleticsOnly ||
    checkPlan(attacker, deps.definition, ctx.derivation, athletics).modifier >=
      checkPlan(attacker, deps.definition, ctx.derivation, acrobatics).modifier
      ? athletics
      : acrobatics;
  const subject = input.skill === "athletics" ? athletics : input.skill === "acrobatics" ? acrobatics : better;
  // What the escape would end, for a rider that helps against it (Powerful Build: "to end the Grappled condition").
  const hindered = escapable.tags.includes(ESCAPE_DISADVANTAGE_TAG) ? `${escapable.name} (hard to escape)` : undefined;
  if (rollCheck(ctx, subject, escapable.escapeDc, undefined, escapable.linkedConditionIds, undefined, hindered)) {
    endEffect(state, attacker.id, escapable.id);
    ctx.effectsEnded.push(endedEffect(attacker, escapable));
  }
}

/**
 * End an Effect: the action an effect's text prints to end it, on the one creature targeted (the user itself when none
 * is). Repeating a save by action opens that save (a success ends it, as any repeat does); a check must succeed, and
 * the creature that succeeds takes what the text deals it (a gelatinous cube's acid); an action alone ends it (waking a
 * sleeper).
 */
function endAnEffect(ctx: ResolveContext): void {
  const { state, attacker, input, deps } = ctx;
  const bearer = ctx.targets[0] ?? attacker;
  const options = endingOptions(attacker, bearer, deps.distanceFeet);
  const chosen = input.effectId ? options.find((option) => option.effect.id === input.effectId) : options[0];
  if (!chosen)
    throw new CommandRejectedError(
      bearer.id === attacker.id
        ? `${attacker.name} has no effect it can end with an action.`
        : `${bearer.name} has no effect ${attacker.name} can end from where it stands.`
    );
  const { effect } = chosen;
  if (chosen.kind === "repeat") {
    const line = openEndingSave(state, bearer, effect, effect.repeatSave!, "repeats", {
      newId: deps.newRollId,
      now: deps.now,
      rollDie: deps.random
    });
    ctx.tableNarration.push(tableLineOf(ctx, line));
    return;
  }
  const ended = effect.endedBy!;
  if (ended.check) {
    const subject: CheckSubject = {
      ability: ended.check.ability,
      ...(ended.check.skill !== undefined ? { skill: ended.check.skill } : {})
    };
    if (rollCheck(ctx, subject, ended.check.dc ?? null, `${ended.name}: check`) !== true) return;
  }
  endEffect(state, bearer.id, effect.id);
  ctx.effectsEnded.push(endedEffect(bearer, effect));
  ctx.tableNarration.push({
    kind: "effect",
    text: `${attacker.name} ends ${effect.name} on ${bearer.name} (${ended.name}).`,
    actorIds: [attacker.id, bearer.id]
  });
  // "The puller takes 10 (3d6) Acid damage."
  for (const part of ended.takerDamage ?? []) {
    const rolled = rollPlain(ctx, part.formula, part.type, ended.name);
    const { application, events } = applyDamageDetailed(
      state,
      attacker.id,
      { amount: rolled.amount, parts: [rolled], sourceName: effect.sourceName ?? effect.name },
      { role: "gm" },
      {
        resolveDefinition: deps.resolveDefinition ?? (() => undefined),
        newId: deps.newRollId,
        now: deps.now,
        rollDie: deps.random,
        ...(deps.catalog ? { catalog: deps.catalog } : {})
      }
    );
    ctx.tableNarration.push({
      kind: "effect",
      text: `${attacker.name} takes ${application.totalApplied} ${part.type[0]!.toUpperCase()}${part.type.slice(1)} damage (${ended.name}).`,
      actorIds: [attacker.id]
    });
    for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
  }
}

/** SRD Burning: rolling on the ground puts out the fire on yourself, and leaves you Prone. */
function rollOnTheGround(ctx: ResolveContext): void {
  const { state, attacker, deps } = ctx;
  const { ended, events } = putOutFire(state, attacker, {
    selfApplied: deps.initiatorRole === "player",
    immunities: {
      ...(deps.resolveDefinition ? { resolveDefinition: deps.resolveDefinition } : {}),
      ...(deps.catalog ? { catalog: deps.catalog } : {})
    }
  });
  for (const effect of ended) ctx.effectsEnded.push(endedEffect(attacker, effect));
  for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
}

/** An action an effect offers to end it (Irresistible Dance: "take an action to collect itself"; Maze's DC 20
 *  Intelligence (Investigation) check): a check is rolled now, and a save is owed now, as a prompt its owner answers.
 *  A success ends the effect. */
function endOwnEffect(ctx: ResolveContext): void {
  const { state, action, attacker, input, deps } = ctx;
  const effect =
    (input.effectId ? attacker.effects.find((candidate) => candidate.id === input.effectId) : undefined) ??
    attacker.effects.find((candidate) => candidate.endAction?.activation === action.activation);
  const end = effect?.endAction;
  if (!effect || !end) throw new CommandRejectedError(`${attacker.name} has nothing it can end that way.`);
  if (end.kind === "check") {
    if (rollCheck(ctx, { ability: end.ability, ...(end.skill ? { skill: end.skill } : {}) }, end.dc)) {
      endEffect(state, attacker.id, effect.id);
      ctx.effectsEnded.push(endedEffect(attacker, effect));
    }
    return;
  }
  createPendingSaves(state, {
    sourceActorId: effect.sourceActorId,
    sourceName: effect.sourceName ?? effect.name,
    actionName: `${effect.name} - ${end.label}`.slice(0, 120),
    ability: end.ability,
    dc: end.dc,
    targetIds: [attacker.id],
    proposedDamage: 0,
    halfOnSuccess: false,
    conditionIds: [],
    repeatOf: { actorId: attacker.id, effectId: effect.id },
    magical: effect.magical === true,
    newSaveId: deps.newRollId,
    createdAt: Date.parse(deps.now())
  });
  ctx.builtinSave = {
    ability: end.ability,
    dc: end.dc,
    targets: [{ targetId: attacker.id, targetName: attacker.name }]
  };
}

/** SRD Sleep: "someone within 5 feet of it takes an action to shake it out of the spell's effect". Ends each effect on
 *  the target a shake ends (Eyebite's Asleep too). */
function shakeAwake(ctx: ResolveContext): void {
  const { state, attacker, targets, deps } = ctx;
  if (targets.length !== 1) throw new CommandRejectedError("Choose exactly one creature to shake awake.");
  const target = targets[0]!;
  if (target.id === attacker.id) throw new CommandRejectedError("A creature can't shake itself awake.");
  const sleeping = target.effects.filter((effect) => effect.tags.includes(WAKEABLE_TAG));
  if (sleeping.length === 0) throw new CommandRejectedError(`${target.name} isn't in a sleep a shake can end.`);
  const distance = deps.distanceFeet?.(attacker.id, target.id) ?? null;
  if (distance !== null && distance > 5 + DISTANCE_TOLERANCE_FEET)
    throw new CommandRejectedError(`${target.name} is more than 5 feet away.`);
  for (const effect of sleeping) {
    endEffect(state, target.id, effect.id);
    ctx.effectsEnded.push(endedEffect(target, effect));
  }
}

/** An effect's natural weapon for the Unarmed Strike (Alter Self): its die and type, and the ability it uses "rather
 *  than using Strength". */
function naturalWeaponOf(
  attacker: ResolveContext["attacker"],
  definition: ActorDefinition | undefined
): Readonly<{ dice: string; type: string; modifier: number }> | null {
  const strike = attacker.effects.find((effect) => effect.unarmedStrike?.dice)?.unarmedStrike;
  if (!strike?.dice || !strike.damageTypes?.[0]) return null;
  return {
    dice: strike.dice,
    type: strike.damageTypes[0],
    modifier: abilityModifier(definition, strike.ability ?? "str")
  };
}

/** The DC of an unarmed Grapple or Shove: 8 + Strength modifier + Proficiency Bonus. */
const unarmedDc = (definition: ActorDefinition | undefined): number =>
  Math.max(1, 8 + abilityModifier(definition, "str") + (definition?.proficiencyBonus ?? 0));

/** SRD Unarmed Strike Grapple/Shove: the target saves with its better of STR and DEX against the unarmed
 *  DC. A failed save is Grappled (escape DC = that DC), Prone, or a 5-foot push the GM moves. */
function unarmedSave(failure: "grappled" | "prone" | "pushed") {
  return (ctx: ResolveContext): void => {
    const { state, action, attacker, targets, deps } = ctx;
    if (targets.length !== 1) throw new CommandRejectedError("Choose exactly one target.");
    const target = targets[0];
    const dc = unarmedDc(deps.definition);
    const targetDefinition = target.definitionId ? deps.resolveDefinition?.(target.definitionId) : undefined;
    const ability: "str" | "dex" =
      saveModifierFor(targetDefinition, "dex") >= saveModifierFor(targetDefinition, "str") ? "dex" : "str";
    createPendingSaves(state, {
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      actionName: action.name,
      ability,
      dc,
      targetIds: [target.id],
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: failure === "prone" ? ["prone"] : [],
      ...(failure === "grappled"
        ? {
            onFailEffect: {
              name: `Grappled by ${attacker.name}`,
              tags: ["grapple"],
              linkedConditionIds: ["grappled"],
              escapeDc: dc,
              sourceActorId: attacker.id,
              sourceName: attacker.name,
              endsWhenSourceDefeated: true,
              rangeFeet: 5
            }
          }
        : {}),
      newSaveId: deps.newRollId,
      createdAt: Date.parse(deps.now())
    });
    if (failure === "pushed") ctx.warnings.push(`On a failed save, ${target.name} is pushed 5 feet. Move the token.`);
    ctx.builtinSave = { ability, dc, targets: [{ targetId: target.id, targetName: target.name }] };
  };
}

const BUILTIN_HANDLERS: Readonly<Record<string, BuiltinHandler>> = {
  hide: { check: hide },
  influence: { check: influence },
  search: { check: searchOrStudy("wis") },
  study: { check: searchOrStudy("int") },
  "escape-grapple": { check: escapeGrapple },
  "extinguish-fire": { apply: rollOnTheGround },
  "end-an-effect": { check: endAnEffect },
  [END_EFFECT_ID]: { check: endOwnEffect },
  "shake-awake": { apply: shakeAwake },

  /** Strength + Proficiency Bonus to hit, then flat 1 + Strength Bludgeoning damage. A Monk's Martial Arts strike taken
   *  as a Bonus Action brings its own numbers, which stand. */
  "unarmed-strike": {
    prepare: ({ action, attacker, deps }) => {
      // Alter Self's claws: the effect's die, type and ability.
      const grown = naturalWeaponOf(attacker, deps.definition);
      if (grown)
        return {
          ...action,
          attack: { bonus: grown.modifier + (deps.definition?.proficiencyBonus ?? 0), reachFeet: 5 },
          damage: [{ formula: `${grown.dice} + ${grown.modifier}`.replace("+ -", "- "), type: grown.type }]
        };
      return action.attack !== undefined
        ? action
        : {
            ...action,
            attack: {
              bonus: abilityModifier(deps.definition, "str") + (deps.definition?.proficiencyBonus ?? 0),
              reachFeet: 5
            }
          };
    },
    hitDamage: (ctx) => {
      if (ctx.action.damage.length > 0) return;
      if (ctx.attack === null || (ctx.attack.outcome !== "crit" && ctx.attack.outcome !== "hit")) return;
      ctx.bonusDamage.push({
        amount: Math.max(0, 1 + abilityModifier(ctx.deps.definition, "str")),
        type: "bludgeoning",
        source: "Unarmed Strike"
      });
    }
  },
  "unarmed-grapple": { forcedSave: unarmedSave("grappled"), atMostOneSizeLarger: true },
  "unarmed-shove-prone": { forcedSave: unarmedSave("prone"), atMostOneSizeLarger: true },
  "unarmed-shove-push": { forcedSave: unarmedSave("pushed"), atMostOneSizeLarger: true },

  /** The free-text trigger travels in the Readied effect's name so the table sees it. */
  ready: { grantName: ({ input }) => (input.note ? `Readied: ${input.note.slice(0, 100)}` : null) },
  /** The distracted enemy carries the effect, named for the helper whose allies it favours. */
  help: { grantName: ({ attacker }) => `Distracted by ${attacker.name}`, distractsAnEnemy: true },
  /** The helped ally carries the effect, named for the helper and the skill. */
  "help-check": {
    prepare: helpWithCheck,
    grantName: ({ attacker, input }) => `Helped by ${attacker.name} (${skillWords(input.skill ?? "")})`
  }
};

/** The special cases for a builtin action id, or undefined when it has none. A Bonus Action form ("hide-bonus") has
 *  its generic action's. */
export function builtinHandlerFor(actionId: string): BuiltinHandler | undefined {
  const id = builtinBaseId(actionId);
  return Object.hasOwn(BUILTIN_HANDLERS, id) ? BUILTIN_HANDLERS[id] : undefined;
}

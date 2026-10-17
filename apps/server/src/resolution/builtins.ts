import { d20FacesFor } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { checkPlan, totalCheck, type CheckSubject } from "../ability-checks.js";
import { builtinBaseId } from "../builtin-actions.js";
import { addEffect, endEffect, ESCAPE_ATHLETICS_TAG, makeEffect } from "../effects.js";
import { putOutFire } from "../hazards.js";
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
  label?: string
): boolean | null {
  const plan = checkPlan(ctx.attacker, ctx.deps.definition, ctx.derivation, subject);
  const forced = label === undefined ? (ctx.input.rollMode ?? undefined) : undefined;
  const mode = forced ?? plan.rollMode.mode;
  ctx.rollMode = shownRollMode(plan.rollMode, forced);
  const roll = totalCheck(plan, d20FacesFor(mode, [], ctx.deps.random), mode, ctx.deps.random);
  recordRoll(ctx, roll.resolution, "check", undefined, { total: roll.total });
  const success = dc === null ? null : roll.total >= dc;
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
  influence: { persuasion: "cha", deception: "cha", intimidation: "cha", performance: "cha", "animal-handling": "wis" }
};

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
    throw new CommandRejectedError(`${ctx.action.name} uses ${Object.keys(skills).join(", ")}, not ${skill}.`);
  return { ability: skillAbility, skill };
}

/** SRD Search and Study: the GM sets the DC and adjudicates. */
const searchOrStudy = (ability: CheckSubject["ability"]) => (ctx: ResolveContext) => {
  rollCheck(ctx, chosenSubject(ctx, ability), null);
};

/** SRD Influence: "a default DC equal to 15 or the monster's Intelligence score, whichever is higher", so a monster
 *  picked as the target sets it; with none, the GM does. Attitude (Friendly, Hostile) stays the GM's call. */
function influence(ctx: ResolveContext): void {
  const monster = ctx.targets[0];
  const monsterDefinition = monster?.definitionId ? ctx.deps.resolveDefinition?.(monster.definitionId) : undefined;
  const dc = monsterDefinition ? Math.max(15, monsterDefinition.abilityScores.int) : null;
  rollCheck(ctx, chosenSubject(ctx, "cha"), dc);
}

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
      linkedConditionIds: ["invisible"]
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
  if (rollCheck(ctx, subject, escapable.escapeDc)) {
    endEffect(state, attacker.id, escapable.id);
    ctx.effectsEnded.push(endedEffect(attacker, escapable));
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
    if (failure === "pushed") ctx.warnings.push(`On a failed save, ${target.name} is pushed 5 feet - move the token.`);
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

  /** Strength + Proficiency Bonus to hit, then flat 1 + Strength Bludgeoning damage. A Monk's Martial Arts strike taken
   *  as a Bonus Action brings its own numbers, which stand. */
  "unarmed-strike": {
    prepare: ({ action, deps }) =>
      action.attack !== undefined
        ? action
        : {
            ...action,
            attack: {
              bonus: abilityModifier(deps.definition, "str") + (deps.definition?.proficiencyBonus ?? 0),
              reachFeet: 5
            }
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
  help: { grantName: ({ attacker }) => `Distracted by ${attacker.name}`, distractsAnEnemy: true }
};

/** The special cases for a builtin action id, or undefined when it has none. A Bonus Action form ("hide-bonus") has
 *  its generic action's. */
export function builtinHandlerFor(actionId: string): BuiltinHandler | undefined {
  const id = builtinBaseId(actionId);
  return Object.hasOwn(BUILTIN_HANDLERS, id) ? BUILTIN_HANDLERS[id] : undefined;
}

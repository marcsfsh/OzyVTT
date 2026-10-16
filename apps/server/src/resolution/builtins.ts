import { d20TestFormula, parseDiceFormula, resolveDice, type RiderAbility } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { checkRollMode } from "../ability-checks.js";
import { exhaustionPenalty } from "../condition-rules.js";
import { addEffect, endEffect, makeEffect } from "../effects.js";
import { checkRiderBonus } from "../equipment-derivation.js";
import { CommandRejectedError } from "../game-store.js";
import { createPendingSaves, saveModifierFor } from "../saving-throws.js";
import { abilityModifier, naturalFace, recordRoll, type DefinitionAction, type ResolveContext } from "./context.js";

/** What the declarative action vocabulary can't express about a builtin action (`builtin-actions.ts`),
 *  one hook per moment of a resolve. A hook runs only for an action taken from the builtin catalog, so a
 *  stat-block action that shadows a builtin id (a Monk's own Unarmed Strike) keeps its own numbers. */
export type BuiltinHandler = Readonly<{
  /** Rewrites the action once the economy is planned and before anything rolls. */
  prepare?: (ctx: ResolveContext) => DefinitionAction;
  /** The check roll the action is. */
  check?: (ctx: ResolveContext) => void;
  /** Flat damage added on a hit. */
  hitDamage?: (ctx: ResolveContext) => void;
  /** The granted effect's name in place of the grant's own; null keeps it. */
  grantName?: (ctx: ResolveContext) => string | null;
  /** A saving throw forced on the one target. */
  forcedSave?: (ctx: ResolveContext) => void;
  /** Targets at most one size larger than the actor (SRD Unarmed Strike). A target rule, so it is checked
   *  by id wherever the action's economy is evaluated. */
  atMostOneSizeLarger?: boolean;
}>;

type CheckNarrowing = Readonly<{ ability: RiderAbility; skill?: string }>;

/** Skill bonus from the untyped open5e extension when the import carries one (mirrors saveModifierFor). */
function skillBonusFromExtension(definition: ActorDefinition | undefined, skill: string): number | null {
  const extension = definition?.extensions["open5e.srd-2024"];
  if (extension && typeof extension === "object") {
    const bonus = (extension as { skills?: Record<string, unknown> }).skills?.[skill];
    if (typeof bonus === "number" && Number.isInteger(bonus) && bonus >= -20 && bonus <= 30) return bonus;
  }
  return null;
}

/** One d20 plus `modifier`, Exhaustion and the check-bonus riders, with `roll-mode {roll: "check"}` riders, both
 *  narrowed to the check's ability and skill (Boots of Elvenkind on Hide) as the sheet's rows are, recorded like
 *  any roll. Null success: no DC, the GM adjudicates. */
function rollCheck(
  ctx: ResolveContext,
  label: string,
  narrow: CheckNarrowing,
  modifier: number,
  dc: number | null
): boolean | null {
  const total = modifier + exhaustionPenalty(ctx.attacker) + checkRiderBonus(ctx.derivation, narrow);
  const aggregated = checkRollMode(ctx.derivation, narrow);
  if (aggregated.mode !== "normal") ctx.rollMode = aggregated;
  const resolution = resolveDice(parseDiceFormula(d20TestFormula(aggregated.mode, total)), ctx.deps.random);
  recordRoll(ctx, resolution, "check");
  const success = dc === null ? null : resolution.total >= dc;
  ctx.check = { skill: label, total: resolution.total, naturalRoll: naturalFace(resolution), dc, success };
  return success;
}

/** An SRD [Action] resolved as a plain check: the ability modifier, or the skill bonus when the import
 *  carries one. */
function skillCheck(label: string, narrow: CheckNarrowing, dc: number | null) {
  return (ctx: ResolveContext): boolean | null => {
    const definition = ctx.deps.definition;
    const skillBonus = narrow.skill ? skillBonusFromExtension(definition, narrow.skill) : null;
    return rollCheck(ctx, label, narrow, skillBonus ?? abilityModifier(definition, narrow.ability), dc);
  };
}

const hideCheck = skillCheck("Dexterity (Stealth)", { ability: "dex", skill: "stealth" }, 15);

/** SRD Hide: on a success, Invisible while hidden; attacking ends it (`releaseHideAndReady`). */
function hide(ctx: ResolveContext): void {
  if (hideCheck(ctx) !== true) return;
  const { state, attacker, input, deps } = ctx;
  const effect = addEffect(
    state,
    attacker.id,
    makeEffect({
      id: `${input.commandId}:hide`,
      name: "Hiding",
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

/** SRD Grappling: the better of Athletics and Acrobatics against the holding effect's escape DC; success
 *  ends the effect and its linked Grappled/Restrained. */
function escapeGrapple(ctx: ResolveContext): void {
  const { state, attacker, input, deps } = ctx;
  const escapable =
    (input.effectId ? attacker.effects.find((effect) => effect.id === input.effectId) : undefined) ??
    attacker.effects.find((effect) => effect.escapeDc !== null);
  if (!escapable || escapable.escapeDc === null)
    throw new CommandRejectedError("No escapable effect (one with an escape DC) is active on this combatant.");
  const athletics = skillBonusFromExtension(deps.definition, "athletics") ?? abilityModifier(deps.definition, "str");
  const acrobatics = skillBonusFromExtension(deps.definition, "acrobatics") ?? abilityModifier(deps.definition, "dex");
  // Rider roll modes narrow to whichever of the two skills won.
  const narrow: CheckNarrowing =
    athletics >= acrobatics ? { ability: "str", skill: "athletics" } : { ability: "dex", skill: "acrobatics" };
  const success = rollCheck(
    ctx,
    "Escape (Athletics/Acrobatics)",
    narrow,
    Math.max(athletics, acrobatics),
    escapable.escapeDc
  );
  if (success) {
    endEffect(state, attacker.id, escapable.id);
    ctx.effectsEnded.push({ actorId: attacker.id, actorName: attacker.name, name: escapable.name });
  }
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
  // Influence, Search and Study: the GM sets the DC and adjudicates the outcome.
  influence: { check: skillCheck("Charisma (Influence)", { ability: "cha" }, null) },
  search: { check: skillCheck("Wisdom (Search)", { ability: "wis" }, null) },
  study: { check: skillCheck("Intelligence (Study)", { ability: "int" }, null) },
  "escape-grapple": { check: escapeGrapple },

  /** Strength + Proficiency Bonus to hit, then flat 1 + Strength Bludgeoning damage. */
  "unarmed-strike": {
    prepare: ({ action, deps }) => ({
      ...action,
      attack: {
        bonus: abilityModifier(deps.definition, "str") + (deps.definition?.proficiencyBonus ?? 0),
        reachFeet: 5
      }
    }),
    hitDamage: (ctx) => {
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
  ready: { grantName: ({ input }) => (input.note ? `Readied: ${input.note.slice(0, 100)}` : null) }
};

/** The special cases for a builtin action id, or undefined when it has none. */
export function builtinHandlerFor(actionId: string): BuiltinHandler | undefined {
  return Object.hasOwn(BUILTIN_HANDLERS, actionId) ? BUILTIN_HANDLERS[actionId] : undefined;
}

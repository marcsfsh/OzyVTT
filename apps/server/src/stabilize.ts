import { isDead, type DeathSaves, type GameState } from "@vtt/domain";
import type { RandomSource } from "@vtt/rules-5e";
import { catalogIdOf, type ActorDefinition } from "@vtt/schemas";
import { checkPlan } from "./ability-checks.js";
import { canPlayerTarget, requireActorAccess, requireGm, type Initiator } from "./authorization.js";
import { rollSettledCheck } from "./check-rolls.js";
import { conditionLabel, incapacitatingCondition } from "./condition-rules.js";
import { withOneUsedUp } from "./consumables.js";
import { endKnockOut, KNOCKED_OUT_TAG, type EffectNarration } from "./effects.js";
import { effectiveActions } from "./effective-actions.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError, RulesBlockedError } from "./game-store.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { commitEconomy, planEconomy } from "./resolution/economy.js";
import type { DefinitionAction, LiveActor } from "./resolution/context.js";
import {
  effectiveModeFor,
  overrideCovers,
  overrideReason,
  overrideWaives,
  rememberOverride,
  type RuleId,
  type RulesOverride
} from "./rules-families.js";

/**
 * SRD Stabilizing a Character: three ways to stop a creature at 0 Hit Points dying, each an action of the creature
 * giving the aid. The Help action's first aid needs a DC 10 Wisdom (Medicine) check, which also wakes a creature knocked
 * out ("someone ... administer[s] first aid to it"); a Healer's Kit use needs no check; Spare the Dying needs none
 * either. The GM may also rule a creature stable. A Stable creature keeps its Unconscious and stops rolling death saves.
 */
export type StabilizeMethod = "medicine" | "healers-kit" | "spare-the-dying" | "gm";

/** The DC of first aid. */
export const FIRST_AID_DC = 10;

/** The aid each helper's method is, as the action it costs in a fight: the Help action's first aid, a Healer's Kit
 *  used with the Utilize action, the cantrip cast with the Magic action. Touch is 5 feet. */
const AIDS: Readonly<Record<Exclude<StabilizeMethod, "gm">, Readonly<{ name: string; spellId?: string }>>> = {
  medicine: { name: "First aid" },
  "healers-kit": { name: "Healer's Kit" },
  "spare-the-dying": { name: "Spare the Dying", spellId: "spare-the-dying" }
};

export type StabilizeInput = Readonly<{
  targetId: string;
  method: StabilizeMethod;
  helperId?: string;
  override?: RulesOverride | null;
  commandId: string;
}>;

export type StabilizeDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  random: RandomSource;
  newRollId: () => string;
  now: () => string;
  sessionId: string;
  role: "gm" | "player";
  /** Creature-to-creature distance on the map; null when it can't be measured. */
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
  /** Creatures hidden from a player by sight or the fog. */
  unseen?: ReadonlySet<string>;
}>;

export type StabilizeOutcome = Readonly<{
  stabilized: boolean;
  /** First aid on a knocked-out creature woke it instead. */
  woke: boolean;
  /** The Wisdom (Medicine) check, when first aid was the method. */
  check: Readonly<{ natural: number; total: number; dc: number }> | null;
  events: EffectNarration[];
  /** An audited GM override of a rules block. */
  overridden: Readonly<{ rule: RuleId; reason: string }> | null;
}>;

const KIT_ID = "healers-kit";
const STABLE: DeathSaves = { successes: 0, failures: 0, stable: true };

/** What the target needs: dying (and not yet stable), or knocked out, which only first aid or the GM ends. */
function targetState(target: LiveActor): "dying" | "knocked-out" {
  if (isDead(target)) throw new CommandRejectedError(`${target.name} is dead - it's too late to stabilize them.`);
  if (target.effects.some((effect) => effect.tags.includes(KNOCKED_OUT_TAG))) return "knocked-out";
  if (target.hp.current > 0) throw new CommandRejectedError(`${target.name} has hit points - they aren't dying.`);
  if (target.deathSaves?.stable) throw new CommandRejectedError(`${target.name} is already stable.`);
  if (target.deathSaves === null) throw new CommandRejectedError(`${target.name} isn't dying.`);
  return "dying";
}

/** Spare the Dying's range: 15 feet, doubling at character levels 5, 11 and 17 (its Cantrip Upgrade). */
function spareTheDyingRange(definition: ActorDefinition | undefined): number {
  const level = (definition?.character?.classes ?? []).reduce((sum, entry) => sum + entry.level, 0);
  return level >= 17 ? 120 : level >= 11 ? 60 : level >= 5 ? 30 : 15;
}

/** One targeting rule through the ladder: strict refuses (a GM override waives it), assisted notes it, off is silent. */
function policeTargeting(
  state: GameState,
  rule: RuleId,
  message: string,
  override: RulesOverride | null | undefined,
  warnings: string[]
): { rule: RuleId; reason: string } | null {
  const mode = effectiveModeFor(state.combat, rule);
  if (mode === "freeform") return null;
  if (overrideWaives(override, rule)) {
    rememberOverride(state, rule, override);
    return { rule, reason: overrideReason(override) };
  }
  if (overrideCovers(state.combat.turn, rule)) return null;
  if (mode === "strict") throw new RulesBlockedError(rule, message);
  warnings.push(message);
  return null;
}

/** The helper's Wisdom (Medicine) check, made as every ability check is (`checkPlan`): the sheet's Medicine bonus,
 *  Exhaustion, check riders, Poisoned and Frightened, Reliable Talent and Jack of All Trades. Recorded like any roll. */
function rollFirstAid(
  state: GameState,
  helper: LiveActor,
  definition: ActorDefinition | undefined,
  deps: StabilizeDeps,
  commandId: string,
  hidden: boolean
): { natural: number; total: number } {
  const derivation = deriveEquipment(helper, definition, deps.catalog);
  const plan = checkPlan(helper, definition, derivation, { ability: "wis", skill: "medicine" });
  return rollSettledCheck(
    state,
    helper,
    plan,
    {
      id: deps.newRollId(),
      commandId,
      sessionId: deps.sessionId,
      role: deps.role,
      label: "Wisdom (Medicine)",
      visibility: hidden ? "gm-only" : "public",
      createdAt: deps.now()
    },
    deps.random
  );
}

/**
 * Stabilizes `targetId` by one of the SRD's ways, or wakes it when it was knocked out and first aid succeeds. A player
 * gives aid only with their own character, to a creature they can see. In a fight the helper's aid is its action, on
 * its own turn, within reach (the spell's range for Spare the Dying), all through the rules ladder.
 */
export function stabilizeCreature(
  state: GameState,
  input: StabilizeInput,
  scope: Initiator,
  deps: StabilizeDeps
): StabilizeOutcome {
  const target = state.actors.find((candidate) => candidate.id === input.targetId);
  if (!target || (scope.role === "player" && !canPlayerTarget(state, target.id, deps.unseen)))
    throw new CommandRejectedError("That creature is not on the table.");
  if (input.method === "gm") {
    requireGm(scope, "Only the GM can rule a creature stable.");
    const condition = targetState(target);
    const line = condition === "dying" ? `${target.name} is stable.` : `${target.name} comes round.`;
    const events = settle(state, target, condition, line);
    return {
      stabilized: condition === "dying",
      woke: condition === "knocked-out",
      check: null,
      events,
      overridden: null
    };
  }
  if (!input.helperId) throw new CommandRejectedError("Choose who gives the aid.");
  requireActorAccess(scope, state, input.helperId, "check", "You can only give aid with your own character.");
  const helper = state.actors.find((candidate) => candidate.id === input.helperId);
  if (!helper) throw new CommandRejectedError("That creature no longer exists.");
  if (helper.id === target.id) throw new CommandRejectedError(`${helper.name} can't give aid to themself.`);
  const condition = targetState(target);
  if (condition === "knocked-out" && input.method !== "medicine")
    throw new CommandRejectedError(
      `${target.name} was knocked out, not dying - first aid (a Medicine check) wakes them.`
    );
  // An Unconscious or downed creature gives no aid, in a fight or out of one.
  const incapacitated = incapacitatingCondition(helper);
  if (incapacitated !== null)
    throw new CommandRejectedError(`${helper.name} is ${conditionLabel(incapacitated)} and can't give aid.`);
  if (helper.hp.current <= 0) throw new CommandRejectedError(`${helper.name} is down and can't give aid.`);
  const definition = helper.definitionId ? deps.resolveDefinition(helper.definitionId) : undefined;
  const aid = AIDS[input.method];
  // Any carried copy of the kit, by the catalog record it copies.
  const kit = helper.inventory.find((item) => catalogIdOf(item) === KIT_ID && item.quantity > 0);
  if (input.method === "healers-kit" && !kit) throw new CommandRejectedError(`${helper.name} has no Healer's Kit.`);
  if (
    input.method === "spare-the-dying" &&
    !definition?.spellcasting?.spells.some((spell) => spell.id === "spare-the-dying")
  )
    throw new CommandRejectedError(`${helper.name} doesn't know Spare the Dying.`);

  const warnings: string[] = [];
  let overridden: StabilizeOutcome["overridden"] = null;
  const inFight = state.combat.active && state.combat.initiative.some((entry) => entry.actorId === helper.id);
  if (inFight) {
    const action: DefinitionAction = {
      id: input.method === "spare-the-dying" ? "spell-spare-the-dying" : `stabilize-${input.method}`,
      name: aid.name,
      activation: "action",
      description: aid.name,
      damage: [],
      ...(aid.spellId ? { spellId: aid.spellId } : {})
    };
    // Off its turn a creature has no action to spend: the economy's `economy.not-your-turn`, as for any action.
    const resolveInput = {
      actorId: helper.id,
      targetIds: [target.id],
      commandId: input.commandId,
      override: input.override ?? null
    };
    const siblings = effectiveActions(definition, helper, deps.catalog);
    const economy = planEconomy(state, helper, action, resolveInput, definition, warnings, undefined, siblings);
    commitEconomy({ state, attacker: helper, input: resolveInput, plan: economy.plan, overridden: economy.overridden });
    overridden = overridden ?? economy.overridden;
    const apart = deps.distanceFeet?.(helper.id, target.id) ?? null;
    const range = input.method === "spare-the-dying" ? spareTheDyingRange(definition) : 5;
    if (apart !== null && apart > range + DISTANCE_TOLERANCE_FEET) {
      const rule: RuleId = input.method === "spare-the-dying" ? "range.out-of-range" : "range.out-of-reach";
      const rounded = Math.round(apart * 10) / 10;
      const message =
        input.method === "spare-the-dying"
          ? `${target.name} is ${rounded} ft away, beyond Spare the Dying's ${range} ft.`
          : `${target.name} is ${rounded} ft away - ${aid.name.toLowerCase()} needs ${helper.name} beside them.`;
      overridden = policeTargeting(state, rule, message, input.override, warnings) ?? overridden;
    }
  }

  const hidden = helper.visibility === "gm-only" || target.visibility === "gm-only";
  const events: EffectNarration[] = warnings.map((text) => ({
    kind: "condition" as const,
    text: `Rules note: ${text}`,
    actorId: helper.id,
    gmOnly: true as const
  }));
  if (input.method === "medicine") {
    const rolled = rollFirstAid(state, helper, definition, deps, input.commandId, hidden);
    const check = { ...rolled, dc: FIRST_AID_DC };
    const readout = `Medicine ${rolled.total} vs DC ${FIRST_AID_DC}`;
    if (rolled.total < FIRST_AID_DC) {
      events.push({
        kind: "condition",
        text: `${helper.name}'s first aid failed (${readout}) - ${target.name} is still ${condition === "dying" ? "dying" : "out cold"}.`,
        actorId: target.id
      });
      return { stabilized: false, woke: false, check, events, overridden };
    }
    const line =
      condition === "dying"
        ? `${helper.name} stabilized ${target.name} (${readout}).`
        : `${helper.name}'s first aid wakes ${target.name} (${readout}).`;
    events.push(...settle(state, target, condition, line));
    return { stabilized: condition === "dying", woke: condition === "knocked-out", check, events, overridden };
  }
  // One use of the kit, counted on the carried row's quantity as a potion is; the last one takes the row.
  if (input.method === "healers-kit" && kit) helper.inventory = withOneUsedUp(helper.inventory, kit.id);
  const line =
    input.method === "healers-kit"
      ? `${helper.name} stabilized ${target.name} with a Healer's Kit.`
      : `${helper.name} cast Spare the Dying - ${target.name} is stable.`;
  events.push(...settle(state, target, condition, line));
  return { stabilized: true, woke: false, check: null, events, overridden };
}

/** Makes a dying creature Stable (its counters reset, its Unconscious kept), or ends a knock-out. */
function settle(
  state: GameState,
  target: LiveActor,
  condition: "dying" | "knocked-out",
  line: string
): EffectNarration[] {
  if (condition === "knocked-out")
    return [{ kind: "condition", text: line, actorId: target.id }, ...endKnockOut(state, target)];
  target.deathSaves = { ...STABLE };
  return [{ kind: "condition", text: line, actorId: target.id }];
}

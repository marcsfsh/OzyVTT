import type { ActionResolution, GameState, RollRecord } from "@vtt/domain";
import { parseDiceFormula, resolveDice, type DiceExpression, type RandomSource } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { conditionFrom, createPendingSaves, halfOnSuccessFrom } from "./saving-throws.js";

type DefinitionAction = ActorDefinition["actions"][number];
export type ResolveInput = Readonly<{ actorId: string; targetIds: readonly string[]; commandId: string; conditionId?: string | null }>;
export type ResolveDependencies = Readonly<{ random: RandomSource; newRollId: () => string; gmSessionId: string; now: () => string; hasCondition?: (id: string) => boolean }>;

/** Double every dice term (2024 crit rule: extra dice, modifiers once) and rebuild a matching formula string. */
function criticalExpression(expression: DiceExpression): DiceExpression {
  const terms = expression.terms.map((term) => term.kind === "dice" ? { ...term, count: term.count * 2 } : term);
  const source = terms
    .map((term, index) => {
      const sign = term.sign === -1 ? "- " : index === 0 ? "" : "+ ";
      return `${sign}${term.kind === "dice" ? `${term.count}d${term.sides}` : term.value}`;
    })
    .join(" ");
  return { source, normalized: source.replace(/\s+/g, "").toLowerCase(), terms };
}

function recordRoll(state: GameState, resolution: ReturnType<typeof resolveDice>, base: Pick<RollRecord, "id" | "commandId" | "initiatorSessionId" | "initiatorLabel" | "actorId" | "purpose" | "visibility" | "createdAt">) {
  let group = 0;
  const record: RollRecord = {
    ...base,
    initiatorRole: "gm",
    formula: resolution.expression.source,
    normalizedFormula: resolution.expression.normalized,
    dice: resolution.terms.flatMap((term) => {
      if (term.kind !== "dice") return [];
      const currentGroup = group++;
      return term.dice.map((die) => ({ group: currentGroup, sides: term.sides, face: die.face, kept: die.kept, sign: term.sign }));
    }),
    modifiers: resolution.terms.filter((term): term is Extract<typeof term, { kind: "modifier" }> => term.kind === "modifier").map((term) => ({ value: term.value, sign: term.sign })),
    total: resolution.total
  };
  state.rolls.push(record);
  if (state.rolls.length > 200) state.rolls.splice(0, state.rolls.length - 200);
}

/**
 * Resolve a definition action on the server: roll the attack against the target's AC (or
 * surface the save DC), roll typed damage with 2024 crit doubling, record every roll in the
 * shared history, and mark the action economy. Damage is PROPOSED to the GM, never applied
 * here — application stays an explicit actor:apply-damage (BUILD_PLAN automation ladder).
 */
export function resolveDefinitionAction(state: GameState, action: DefinitionAction, input: ResolveInput, deps: ResolveDependencies): ActionResolution {
  if (!state.combat.active) throw new CommandRejectedError("Start an encounter before resolving actions.");
  const attacker = state.actors.find((item) => item.id === input.actorId);
  if (!attacker) throw new CommandRejectedError("That combatant no longer exists.");
  if (!state.combat.initiative.some((entry) => entry.actorId === input.actorId)) throw new CommandRejectedError("That combatant is not in this encounter.");
  const targets = input.targetIds.map((targetId) => {
    const target = state.actors.find((item) => item.id === targetId);
    if (!target || !state.combat.initiative.some((entry) => entry.actorId === targetId)) throw new CommandRejectedError("Every target must be in this encounter.");
    return target;
  });
  if (action.attack && targets.length !== 1) throw new CommandRejectedError("An attack roll resolves against exactly one target.");
  if (targets.length === 0) throw new CommandRejectedError("Choose at least one target.");
  if (!action.attack && !action.save && action.damage.length === 0) throw new CommandRejectedError("That action has no structured effect to resolve — run it from its description.");

  // A hidden attacker's rolls stay GM-only; everyone else's fight in the open.
  const visibility = attacker.visibility === "gm-only" ? "gm-only" as const : "public" as const;
  const rollBase = { commandId: input.commandId, initiatorSessionId: deps.gmSessionId, initiatorLabel: attacker.name, actorId: attacker.id, visibility, createdAt: deps.now() };

  let attack: ActionResolution["attack"] = null;
  let crit = false;
  if (action.attack) {
    const bonus = action.attack.bonus;
    const attackResolution = resolveDice(parseDiceFormula(`1d20 ${bonus < 0 ? "-" : "+"} ${Math.abs(bonus)}`), deps.random);
    recordRoll(state, attackResolution, { ...rollBase, id: deps.newRollId(), purpose: "attack" });
    const naturalRoll = attackResolution.terms.find((term): term is Extract<typeof term, { kind: "dice" }> => term.kind === "dice")!.dice[0].face;
    const target = targets[0];
    const targetAc = target.armorClass ?? null;
    crit = naturalRoll === 20;
    const outcome = naturalRoll === 20 ? "crit" as const
      : naturalRoll === 1 ? "fumble" as const
      : targetAc === null ? "unknown" as const
      : attackResolution.total >= targetAc ? "hit" as const : "miss" as const;
    attack = { targetId: target.id, targetName: target.name, total: attackResolution.total, naturalRoll, targetAc, outcome };
  }

  // Damage is rolled unless the attack already whiffed outright.
  const damage: Array<{ formula: string; type: string; total: number }> = [];
  if (attack === null || attack.outcome === "crit" || attack.outcome === "hit" || attack.outcome === "unknown") {
    for (const part of action.damage) {
      const expression = parseDiceFormula(part.formula);
      const rolled = resolveDice(crit ? criticalExpression(expression) : expression, deps.random);
      recordRoll(state, rolled, { ...rollBase, id: deps.newRollId(), purpose: "damage" });
      damage.push({ formula: rolled.expression.source, type: part.type, total: rolled.total });
    }
  }

  // A save action leaves one pending save per target: prompts appear in the tracker rows, each
  // answered by rolling or typing a total, and the outcome auto-applies (see saving-throws.ts).
  if (action.save) {
    createPendingSaves(state, {
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      actionName: action.name,
      ability: action.save.ability,
      dc: action.save.dc,
      targetIds: targets.map((target) => target.id),
      proposedDamage: damage.reduce((sum, part) => sum + part.total, 0),
      halfOnSuccess: halfOnSuccessFrom(action.description),
      // GM's explicit choice wins; otherwise auto-detect a condition from the action prose (only if the
      // bundle actually has it), so "…or be Poisoned" applies on a failed save without manual tagging.
      conditionId: input.conditionId ?? ((autoCondition) => autoCondition && (!deps.hasCondition || deps.hasCondition(autoCondition)) ? autoCondition : null)(conditionFrom(action.description)),
      newSaveId: deps.newRollId,
      createdAt: Date.parse(deps.now())
    });
  }

  // Bookkeeping, never a gate: resolving marks the matching economy slot.
  if (state.combat.turnActorId === attacker.id && (action.activation === "action" || action.activation === "bonus-action")) {
    state.combat = { ...state.combat, turn: { ...state.combat.turn, [action.activation === "action" ? "actionUsed" : "bonusActionUsed"]: true } };
  } else if (action.activation === "reaction") {
    state.combat = { ...state.combat, reactionsUsed: [...state.combat.reactionsUsed.filter((id) => id !== attacker.id), attacker.id] };
  }

  return {
    actionName: action.name,
    activation: action.activation,
    attack,
    save: action.save ? { ability: action.save.ability, dc: action.save.dc, targets: targets.map((target) => ({ targetId: target.id, targetName: target.name })) } : null,
    damage,
    damageTotal: damage.reduce((sum, part) => sum + part.total, 0),
    crit
  };
}

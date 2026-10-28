import type { ActionResolution, DamageRoll, GameState } from "@vtt/domain";
import { parseDiceFormula, rescaleDamageParts } from "@vtt/rules-5e";
import type { Initiator } from "./authorization.js";
import { requireActorAccess } from "./authorization.js";
import { CommandRejectedError } from "./game-store.js";
import { resolvePendingDamage, type AppliedDamage, type PlayerDamageDeps } from "./player-damage.js";

/**
 * A player's damage that waits for the number their dice came to (ADR-0043), while the table's damage mode asks
 * players to type it. The server rolled the damage already; a hit's proposal, or the saves an action opened, carry
 * the roll's id and wait until the player reports the total, or each die's face. The server checks either against
 * the dice and adds what it adds to them.
 */

type Dice = Pick<DamageRoll, "formula" | "dice" | "fixed">;

/** The damage dice of a resolve and what the server adds to them, or null when no die decides it. */
export function damageDiceOf(resolution: ActionResolution): Dice | null {
  const dice = new Map<number, number>();
  let fixed = (resolution.bonusDamage ?? []).reduce((sum, bonus) => sum + bonus.amount, 0);
  for (const part of resolution.damage) {
    let expression;
    try {
      expression = parseDiceFormula(part.formula);
    } catch {
      return null;
    }
    for (const term of expression.terms) {
      if (term.kind === "modifier") fixed += term.sign * term.value;
      else if (term.sign < 0 || term.keep) return null;
      else dice.set(term.sides, (dice.get(term.sides) ?? 0) + term.count);
    }
  }
  if (dice.size === 0) return null;
  const sorted = [...dice.entries()].sort(([a], [b]) => b - a).map(([sides, count]) => ({ count, sides }));
  const diceText = sorted.map((die) => `${die.count}d${die.sides}`).join(" + ");
  const formula = fixed === 0 ? diceText : `${diceText} ${fixed < 0 ? "-" : "+"} ${Math.abs(fixed)}`;
  return { formula, dice: sorted, fixed };
}

/** The lowest and highest the dice can come to, with what the server adds. */
export function damageRange(roll: Pick<DamageRoll, "dice" | "fixed">): Readonly<{ min: number; max: number }> {
  const count = roll.dice.reduce((sum, die) => sum + die.count, 0);
  const top = roll.dice.reduce((sum, die) => sum + die.count * die.sides, 0);
  return { min: Math.max(0, count + roll.fixed), max: Math.max(0, top + roll.fixed) };
}

/**
 * Holds what a player's committed resolve owes for their damage roll: each proposal `settlePlayerDamage` just parked,
 * and the damage of each save the resolve opened. `direct` applies a proposal as soon as its roll is in.
 */
export function holdForDamageRolls(
  state: GameState,
  resolution: ActionResolution,
  source: Readonly<{ actorId: string; name: string }>,
  mode: "total" | "die",
  before: Readonly<{ proposalIds: ReadonlySet<string>; saveIds: ReadonlySet<string> }>,
  direct: boolean,
  deps: Pick<PlayerDamageDeps, "newId" | "now">
): void {
  if (resolution.preview) return;
  const dice = damageDiceOf(resolution);
  if (!dice) return;
  const ask = (link: Pick<DamageRoll, "proposalId" | "saveIds">): DamageRoll => ({
    id: deps.newId(),
    sourceActorId: source.actorId,
    sourceName: source.name,
    actionName: resolution.actionName,
    ...dice,
    mode,
    ...link,
    createdAt: deps.now()
  });
  const rolls: DamageRoll[] = [];
  // A proposal whose amount isn't the resolve's whole damage was split among targets: the server's roll stands.
  const pendingDamage = state.combat.pendingDamage.map((proposal) => {
    if (before.proposalIds.has(proposal.id) || proposal.sourceActorId !== source.actorId) return proposal;
    if (proposal.proposedTotal !== resolution.damageTotal) return proposal;
    const roll = ask({ proposalId: proposal.id });
    rolls.push(roll);
    return { ...proposal, awaitingRoll: roll.id, ...(direct ? { direct: true as const } : {}) };
  });
  const opened = state.combat.pendingSaves.filter(
    (save) => !before.saveIds.has(save.id) && save.sourceActorId === source.actorId && save.proposedDamage > 0
  );
  const savesRoll = opened.length > 0 ? ask({ saveIds: opened.map((save) => save.id) }) : null;
  if (savesRoll) rolls.push(savesRoll);
  if (rolls.length === 0) return;
  state.combat = {
    ...state.combat,
    pendingDamage,
    pendingSaves: savesRoll
      ? state.combat.pendingSaves.map((save) =>
          savesRoll.saveIds!.includes(save.id) ? { ...save, damageRollId: savesRoll.id } : save
        )
      : state.combat.pendingSaves,
    damageRolls: [...state.combat.damageRolls, ...rolls].slice(-50)
  };
}

/** What the reported dice came to: a typed total within the dice's reach, or each die's face plus what is added. */
export function reportedTotal(
  roll: Pick<DamageRoll, "dice" | "fixed" | "formula">,
  report: Readonly<{ total?: number; faces?: readonly number[] }>
): number {
  if (report.total !== undefined) {
    const { min, max } = damageRange(roll);
    if (!Number.isInteger(report.total) || report.total < min || report.total > max)
      throw new CommandRejectedError(`${roll.formula} comes to ${min} to ${max}. Check the total you typed.`);
    return report.total;
  }
  const faces = report.faces ?? [];
  const expected = roll.dice.flatMap((die) => Array.from({ length: die.count }, () => die.sides));
  if (faces.length !== expected.length)
    throw new CommandRejectedError(`Type each die of ${roll.formula}: ${expected.length} in all.`);
  faces.forEach((face, index) => {
    if (!Number.isInteger(face) || face < 1 || face > expected[index]!)
      throw new CommandRejectedError(`A d${expected[index]} shows 1 to ${expected[index]}. Check die ${index + 1}.`);
  });
  return Math.max(0, faces.reduce((sum, face) => sum + face, 0) + roll.fixed);
}

/**
 * The player (or the GM) reports a damage roll. What waits on it takes the new total in its own damage types: a hit's
 * proposal stays for the GM to apply, or applies now at a table where players' hits apply directly; each save it holds
 * can be confirmed. Returns the total and anything applied.
 */
export function reportDamageRoll(
  state: GameState,
  scope: Initiator,
  rollId: string,
  report: Readonly<{ total?: number; faces?: readonly number[] }>,
  deps: PlayerDamageDeps
): Readonly<{ roll: DamageRoll; total: number; applied: AppliedDamage | null }> {
  const roll = state.combat.damageRolls.find((entry) => entry.id === rollId);
  if (!roll) throw new CommandRejectedError("That damage roll is already in.");
  requireActorAccess(scope, state, roll.sourceActorId, "check", "You can only roll your own character's damage.");
  if (scope.role !== "gm" && (report.total !== undefined) !== (roll.mode === "total"))
    throw new CommandRejectedError(
      roll.mode === "total" ? "Type the total, with the bonus included." : "Type what each die shows."
    );
  const total = reportedTotal(roll, report);
  let direct: string | null = null;
  state.combat = {
    ...state.combat,
    damageRolls: state.combat.damageRolls.filter((entry) => entry.id !== rollId),
    pendingDamage: state.combat.pendingDamage.map((proposal) => {
      if (proposal.awaitingRoll !== rollId) return proposal;
      const { awaitingRoll: _done, direct: applyNow, ...rest } = proposal;
      if (applyNow) direct = proposal.id;
      return {
        ...rest,
        proposedDamageParts: rescaleDamageParts(proposal.proposedDamageParts, total),
        proposedTotal: total
      };
    }),
    pendingSaves: state.combat.pendingSaves.map((save) => {
      if (save.damageRollId !== rollId) return save;
      const { damageRollId: _done, ...rest } = save;
      return {
        ...rest,
        ...(save.proposedDamageParts
          ? { proposedDamageParts: rescaleDamageParts(save.proposedDamageParts, total) }
          : {}),
        proposedDamage: total
      };
    })
  };
  const applied = direct !== null ? resolvePendingDamage(state, direct, true, undefined, deps) : null;
  return { roll, total, applied };
}

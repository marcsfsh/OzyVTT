import { isDead } from "@vtt/domain";
import { collectRiders, rollDice } from "@vtt/rules-5e";
import { setCondition } from "../actor-conditions.js";
import { conditionLabel } from "../condition-rules.js";
import { CommandRejectedError } from "../game-store.js";
import { endEffect } from "../effects.js";
import { deadCantHealLine, healActor } from "../hit-points.js";
import { isSwarm } from "../space-sharing.js";
import { useCostOf } from "../use-cost.js";
import { deriveEquipment } from "../equipment-derivation.js";
import { isItemActionId } from "../item-actions.js";
import { recordRoll, tableLineOf, type LiveActor, type ResolveContext } from "./context.js";

/** Healing (Cure Wounds): rolled once, and every target regains it on the resolve. A willing creature's healing has
 *  nothing to gate, so it applies here with no Apply tap, which damage waits on. Second Wind heals its user;
 *  Preserve Life divides one roll among its targets, none past half its maximum; Lay on Hands regains its formula once
 *  per point spent; False Life's roll is Temporary Hit Points. */
export function applyHealing(ctx: ResolveContext): void {
  const { action, state, deps, tableNarration } = ctx;
  const healing = action.healing;
  const targets = healing?.self ? [ctx.attacker] : ctx.targets;
  if (!healing || targets.length === 0) return;
  // SRD "Dead": a heal that reaches only the dead would do nothing, so it is refused before its points or slot
  // are spent.
  if (targets.every((target) => isDead(target)))
    throw new CommandRejectedError(targets.map((target) => deadCantHealLine(target.name)).join(" "));
  let total = 0;
  // What the healer's riders do to its healing (Supreme Healing, Disciple of Life).
  const healer = healerRiders(ctx);
  // "The target regains all its Hit Points" (Power Word Heal): nothing to roll.
  const toMaximum = targets.map((target) => Math.max(0, target.hp.maximum - Math.max(0, target.hp.current)));
  const uses = healing.perUse ? useCostOf(action) : 1;
  if (healing.toMaximum) total = toMaximum.reduce((sum, room) => sum + room, 0);
  else
    for (let use = 0; use < uses; use += 1) {
      const rolled = rollDice(
        healing.formula,
        healer.maximized || healing.maximized === true ? (sides) => sides : deps.random
      );
      // A flat amount ("1" a point) is no roll for the dice log.
      if (rolled.terms.some((term) => term.kind === "dice")) recordRoll(ctx, rolled, "healing");
      total += rolled.total;
    }
  // Beacon of Hope: a target that regains the most any healing can gives every die its highest face.
  const most = healing.toMaximum ? 0 : uses * rollDice(healing.formula, (sides) => sides).total;
  const received = targets.map((target) =>
    !healing.toMaximum && !healing.temporary && receivesMaximized(ctx, target) ? Math.max(total, most) : total
  );
  const bonus = healing.temporary || healing.toMaximum ? 0 : healer.bonus;
  const shares = healing.toMaximum
    ? toMaximum
    : healing.divided
      ? healingShares(targets, Math.max(0, total), healing).map((share) => share + bonus)
      : targets.map((target, index) => healingShares([target], Math.max(0, received[index]! + bonus), healing)[0]!);
  const healed = targets.map((target, index) => {
    // A dead target among living ones regains nothing until it is revived; the others still heal.
    if (isDead(target)) {
      tableNarration.push({ kind: "heal", text: deadCantHealLine(target.name), actorIds: [target.id] });
      return { targetId: target.id, targetName: target.name, regained: 0 };
    }
    // SRD Swarm: "The swarm can't regain Hit Points or gain Temporary Hit Points."
    const definition = target.definitionId ? deps.resolveDefinition?.(target.definitionId) : undefined;
    if (isSwarm(definition)) {
      tableNarration.push({
        kind: "heal",
        text: `${target.name} is a swarm and can't regain hit points or gain Temporary Hit Points.`,
        actorIds: [target.id]
      });
      return { targetId: target.id, targetName: target.name, regained: 0 };
    }
    // False Life, Tireless: Temporary Hit Points, which don't add up; the creature keeps the higher.
    if (healing.temporary) {
      const gained = shares[index] > target.hp.temporary ? shares[index] : 0;
      if (gained > 0) target.hp = { ...target.hp, temporary: gained };
      tableNarration.push({
        kind: "heal",
        text:
          gained > 0
            ? `${target.name} gains ${gained} Temporary Hit Points (${action.name}).`
            : `${target.name} keeps the ${target.hp.temporary} Temporary Hit Points it has (${action.name}).`,
        actorIds: [target.id]
      });
      return { targetId: target.id, targetName: target.name, regained: gained };
    }
    const before = target.hp.current;
    // The cast is already authorized; the caster heals whoever it targeted.
    const events = healActor(state, target.id, shares[index], { role: "gm" });
    const regained = target.hp.current - before;
    tableNarration.push({
      kind: "heal",
      text: `${target.name} regains ${regained} ${regained === 1 ? "hit point" : "hit points"} (${action.name}).`,
      actorIds: [target.id]
    });
    for (const event of events) tableNarration.push(tableLineOf(ctx, event, "heal"));
    // "The wound closes ... after a spell restores Hit Points to the target."
    if (action.spellId !== undefined && regained > 0)
      for (const effect of target.effects.filter((candidate) => candidate.endsOnSpellHealing))
        for (const event of endEffect(state, target.id, effect.id))
          tableNarration.push(tableLineOf(ctx, event, "heal"));
    return { targetId: target.id, targetName: target.name, regained };
  });
  ctx.healing = { total, targets: healed };
  // Blessed Healer: a slot spell that restored Hit Points to another creature restores some to its caster too.
  if (healer.self > 0 && healed.some((entry) => entry.targetId !== ctx.attacker.id && entry.regained > 0)) {
    const before = ctx.attacker.hp.current;
    const events = healActor(state, ctx.attacker.id, healer.self, { role: "gm" });
    const regained = ctx.attacker.hp.current - before;
    if (regained > 0)
      tableNarration.push({
        kind: "heal",
        text: `${ctx.attacker.name} regains ${regained} ${regained === 1 ? "hit point" : "hit points"} (${healer.selfLabel}).`,
        actorIds: [ctx.attacker.id]
      });
    for (const event of events) tableNarration.push(tableLineOf(ctx, event, "heal"));
  }
}

/** What the healer's `on-healing` riders do to this action's healing: every die at its highest face (Supreme
 *  Healing, a spell or Channel Divinity, never an item), more Hit Points for each creature healed (Disciple of Life:
 *  2 plus the slot's level, on a spell cast with a slot), and what the healer itself regains (Blessed Healer). */
function healerRiders(
  ctx: ResolveContext
): Readonly<{ maximized: boolean; bonus: number; self: number; selfLabel: string }> {
  const { derivation, riderFilters, action, plan } = ctx;
  const riders = collectRiders(derivation.carriers, { ...derivation.context, ...riderFilters, moment: "on-healing" });
  const slot = plan.spendSpellSlot?.level ?? null;
  const amountOf = (rider: (typeof riders)[number]) =>
    rider.modifier.perSlotLevel
      ? slot === null
        ? 0
        : (rider.modifier.amount ?? 0) + slot
      : (rider.modifier.amount ?? 0);
  let maximized = false;
  let bonus = 0;
  let self = 0;
  let selfLabel = "";
  for (const rider of riders) {
    if (rider.modifier.type === "healing-dice-maximized" && !isItemActionId(action.id)) maximized = true;
    if (rider.modifier.type !== "healing-bonus") continue;
    if (rider.modifier.self) {
      if (amountOf(rider) > self) [self, selfLabel] = [amountOf(rider), rider.label];
    } else bonus += amountOf(rider);
  }
  return { maximized, bonus, self, selfLabel };
}

/** Whether a creature regains the most any healing can give it (Beacon of Hope). */
function receivesMaximized(ctx: ResolveContext, target: LiveActor): boolean {
  const definition =
    target.id === ctx.attacker.id
      ? ctx.deps.definition
      : target.definitionId
        ? ctx.deps.resolveDefinition?.(target.definitionId)
        : undefined;
  const derivation = deriveEquipment(target, definition, ctx.deps.catalog);
  return collectRiders(derivation.carriers, { ...derivation.context, moment: null }).some(
    (rider) => rider.modifier.type === "healing-received-maximized"
  );
}

/** What each target may regain: the whole roll each, or one pool split as evenly as each target's room allows. A cap
 *  ("no more than half its Hit Point maximum") limits both. */
export function healingShares(
  targets: readonly Pick<LiveActor, "hp">[],
  total: number,
  healing: NonNullable<ResolveContext["action"]["healing"]>
): number[] {
  const room = targets.map((target) =>
    healing.upToFractionOfMaximum === undefined
      ? total
      : Math.max(0, Math.floor(target.hp.maximum * healing.upToFractionOfMaximum) - Math.max(0, target.hp.current))
  );
  if (!healing.divided) return room.map((space) => Math.min(space, total));
  const shares = targets.map(() => 0);
  let left = total;
  // Even shares. What a full target can't take goes to the others.
  for (let open = room.filter((space) => space > 0).length; left > 0 && open > 0;) {
    const each = Math.max(1, Math.floor(left / open));
    open = 0;
    for (let index = 0; index < targets.length && left > 0; index += 1) {
      const take = Math.min(each, room[index] - shares[index], left);
      shares[index] += take;
      left -= take;
      if (room[index] - shares[index] > 0) open += 1;
    }
  }
  return shares;
}

/** Conditions an action ends on its targets (Lay on Hands: Poisoned; Heal: Blinded, Deafened and Poisoned), or the
 *  one its user picks (Lesser Restoration, the first present when none is named). A cure that does nothing else, spent
 *  on a target with none of them, is refused before anything is paid; one that also heals or protects still lands. */
export function applyConditionCures(ctx: ResolveContext): void {
  const { action, state, tableNarration, input } = ctx;
  const cures = action.endsConditions;
  if (!cures) return;
  const alone = !action.healing && !action.grants;
  for (const target of ctx.targets) {
    const present = cures.filter((id) => target.conditions.some((condition) => condition.id === id));
    if (present.length === 0) {
      if (!alone) continue;
      throw new CommandRejectedError(
        `${target.name} isn't ${cures.map((id) => conditionLabel(id)).join(" or ")}, so ${action.name} would do nothing.`
      );
    }
    const picked = action.endsOneCondition ? (input.conditionId ?? present[0]) : undefined;
    if (picked !== undefined && !present.includes(picked))
      throw new CommandRejectedError(
        `${target.name} isn't ${conditionLabel(picked)}, so ${action.name} would do nothing.`
      );
    for (const id of picked !== undefined ? [picked] : present) {
      // The action is already authorized; it ends the condition whoever imposed it.
      setCondition(state, target.id, id, false, undefined, { role: "gm" });
      tableNarration.push({
        kind: "effect",
        text: `${target.name} is no longer ${conditionLabel(id)} (${action.name}).`,
        actorIds: [target.id]
      });
    }
  }
}

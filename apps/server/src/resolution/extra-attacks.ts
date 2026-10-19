import { weaponPropertiesOf } from "../equipment-derivation.js";
import { itemActionId } from "../item-actions.js";
import { masteryOpensCleave } from "../weapon-mastery.js";
import type { ResolveContext } from "./context.js";

// What a swing opens for an extra attack (SRD 5.2.1), kept in the turn record that the economy reads
// (`checkExtraAttackOpened`): the Light property's, and Cleave's. The Loading weapons fired in the Attack action
// are kept beside them (`checkLoading`).

const opened = (ctx: ResolveContext) =>
  ctx.state.combat.turn.extraAttacks ?? { light: null, loading: null, cleave: null, horde: null };

/** An attack with a Light weapon in the Attack action, on the attacker's own turn, opens the Light extra attack
 *  with a different Light weapon. The extra attack itself opens nothing. */
export function recordLightAttack(ctx: ResolveContext): void {
  const { state, action, attacker, attack, input, riderItemId } = ctx;
  if (
    attack === null ||
    input.economyPaid === true ||
    action.extraAttack !== undefined ||
    action.activation !== "action" ||
    state.combat.turnActorId !== attacker.id ||
    !weaponPropertiesOf(riderItemId, attacker.inventory).includes("light")
  )
    return;
  const current = opened(ctx);
  const itemIds = current.light?.actorId === attacker.id ? current.light.itemIds : [];
  if (itemIds.includes(riderItemId!)) return;
  state.combat = {
    ...state.combat,
    turn: {
      ...state.combat.turn,
      extraAttacks: { ...current, light: { actorId: attacker.id, itemIds: [...itemIds, riderItemId!] } }
    }
  };
}

/** A shot from a Loading weapon in the Attack action, on the attacker's own turn: that weapon can't fire again in
 *  the same action, whatever attacks Extra Attack still owes (SRD Loading). */
export function recordLoadingShot(ctx: ResolveContext): void {
  const { state, action, attacker, attack, input, riderItemId } = ctx;
  if (
    attack === null ||
    riderItemId === null ||
    input.economyPaid === true ||
    action.activation !== "action" ||
    state.combat.turnActorId !== attacker.id ||
    !weaponPropertiesOf(riderItemId, attacker.inventory).includes("loading")
  )
    return;
  const current = opened(ctx);
  const itemIds = current.loading?.actorId === attacker.id ? current.loading.itemIds : [];
  if (itemIds.includes(riderItemId)) return;
  state.combat = {
    ...state.combat,
    turn: {
      ...state.combat.turn,
      extraAttacks: { ...current, loading: { actorId: attacker.id, itemIds: [...itemIds, riderItemId] } }
    }
  };
}

/** An attack roll made on the attacker's own turn, so Reckless Attack, decided with the first, can't come after it. */
export function recordAttackRoll(ctx: ResolveContext): void {
  const { state, attacker, attack, input } = ctx;
  if (attack === null || input.economyPaid === true || state.combat.turnActorId !== attacker.id) return;
  if (state.combat.turn.attackRolled) return;
  state.combat = { ...state.combat, turn: { ...state.combat.turn, attackRolled: true } };
}

/** SRD Horde Breaker: "Once on each of your turns when you make an attack with a weapon, you can make another attack
 *  with the same weapon against a different creature". Any weapon attack on the Ranger's own turn opens it, hit or
 *  miss, until it is used; the result card offers it. */
export function recordHordeOpening(ctx: ResolveContext): void {
  const { state, action, attacker, attack, riderItemId, input } = ctx;
  if (
    attack === null ||
    riderItemId === null ||
    input.commit === false ||
    action.extraAttack?.kind === "horde-breaker" ||
    state.combat.turnActorId !== attacker.id ||
    (state.combat.turn.turnUses[`${attacker.id}:horde-breaker`] ?? 0) > 0
  )
    return;
  const swing = ctx.siblings.find((candidate) => candidate.id === itemActionId(riderItemId, "horde-breaker"));
  if (!swing) return;
  state.combat = {
    ...state.combat,
    turn: {
      ...state.combat.turn,
      extraAttacks: { ...opened(ctx), horde: { actorId: attacker.id, itemId: riderItemId, targetId: attack.targetId } }
    }
  };
  ctx.opens ??= { actionId: swing.id, actionName: swing.name };
}

/** A melee hit with a Cleave weapon opens its swing at a second creature, which the result card offers. */
export function recordCleaveOpening(ctx: ResolveContext): void {
  const { state, action, attacker, attack, riderItemId } = ctx;
  if (
    attack === null ||
    riderItemId === null ||
    action.extraAttack !== undefined ||
    ctx.riderFilters.attackKinds?.includes("melee") !== true ||
    !masteryOpensCleave(ctx.masterySwing)
  )
    return;
  state.combat = {
    ...state.combat,
    turn: {
      ...state.combat.turn,
      extraAttacks: { ...opened(ctx), cleave: { actorId: attacker.id, itemId: riderItemId, targetId: attack.targetId } }
    }
  };
  const swing = ctx.siblings.find((candidate) => candidate.id === itemActionId(riderItemId, "cleave"));
  if (swing) ctx.opens = { actionId: swing.id, actionName: swing.name };
}

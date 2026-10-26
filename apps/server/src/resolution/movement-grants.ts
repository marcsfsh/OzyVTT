import { holdsFeature } from "../class-features.js";
import { areAllies } from "../creature-sides.js";
import { RAGING_TAG } from "../effects.js";
import { CommandRejectedError } from "../game-store.js";
import { grantFeet, grantMove, grantTeleport, payOwedAction } from "../granted-moves.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import type { LiveActor, ResolveContext } from "./context.js";
import { isMagicAction } from "./economy.js";

/** Dimension Door: "You can also teleport one willing creature. The creature must be within 5 feet of you when you
 *  teleport": the one creature the cast names beside its caster, on its side and within 5 feet. */
function passengerOf(ctx: ResolveContext, name: string): LiveActor | undefined {
  const { attacker, deps } = ctx;
  const others = ctx.targets.filter((target) => target.id !== attacker.id);
  if (others.length === 0) return undefined;
  if (others.length > 1) throw new CommandRejectedError(`${name} takes one other creature along.`);
  const passenger = others[0]!;
  if (!areAllies(attacker, passenger, deps.resolveDefinition))
    throw new CommandRejectedError(`${name} takes only a willing creature along, and ${passenger.name} isn't willing.`);
  const apart = deps.distanceFeet?.(attacker.id, passenger.id) ?? null;
  if (apart !== null && apart > 5 + DISTANCE_TOLERANCE_FEET)
    throw new CommandRejectedError(`${passenger.name} must be within 5 ft of ${attacker.name} to go along.`);
  return passenger;
}

/**
 * What a resolve gives its creature to move or teleport with, beside the turn's own movement (SRD 5.2.1):
 * - an action's own move (`move`: Pounce's half Speed, a troll's Charge, a seahorse's Bubble Dash), jump (`leap`: a
 *   bulette's 30 feet for 10 feet of movement) and teleport (`teleport`: a blink dog's 40 feet, the lich's Deathly
 *   Teleport), or a spell's (Misty Step);
 * - features that move a creature as something else resolves: Tactical Shift with Second Wind, Instinctive Pounce
 *   with the Bonus Action that enters a Rage, Remarkable Athlete after a Critical Hit, and Boon of Dimensional
 *   Travel's teleport after the Attack or Magic action.
 * An action taken move first (`moveFirst`) grants only its move, owing the rest; taken again (`owedPaid`), it pays
 * that debt and grants nothing more. Runs before the action's own grant, so a Rage it starts is told from one it
 * extends.
 */
export function applyMovementGrants(ctx: ResolveContext): void {
  const { state, attacker, action, input, deps } = ctx;
  if (input.commit === false || input.ready === true) return;
  if (input.owedPaid === true) {
    payOwedAction(state, attacker, action.id);
    return;
  }
  const definition = deps.definition;
  const say = (text: string) =>
    ctx.tableNarration.push({
      kind: "movement",
      text,
      actorIds: [attacker.id],
      ...(ctx.hiddenFromTable(attacker.id) ? { gmOnly: true } : {})
    });
  const half = (provokes: boolean, name: string) => {
    const feet = grantFeet(attacker, { speed: "half" }, definition, deps.catalog);
    if (feet <= 0) return;
    grantMove(state, attacker, { id: `${input.commandId}:move`, name, feet, provokes });
    say(`${attacker.name} may move ${feet} ft${provokes ? "" : " without provoking Opportunity Attacks"}.`);
  };
  const move = action.move;
  if (move) {
    const feet = grantFeet(attacker, move, definition, deps.catalog);
    grantMove(state, attacker, {
      id: `${input.commandId}:move`,
      name: action.name,
      feet,
      ...(move.mode ? { mode: move.mode } : {}),
      provokes: move.provokes,
      ...(move.straight ? { straight: true as const } : {}),
      ...(move.throughCreatures ? { throughCreatures: move.throughCreatures } : {}),
      ...(move.dropsHeld ? { dropsHeld: true as const } : {}),
      ...(move.thenHide ? { thenHide: true as const } : {}),
      ...(input.moveFirst === true ? { owedActionId: action.id } : {})
    });
    const verb =
      move.mode === "fly" ? "fly" : move.mode === "swim" ? "swim" : move.mode === "burrow" ? "burrow" : "move";
    say(
      `${attacker.name} may ${verb} ${feet} ft${move.provokes ? "" : " without provoking Opportunity Attacks"}${move.straight ? " straight toward an enemy" : ""}${input.moveFirst === true ? `, then finish ${action.name}` : ""}${move.dropsHeld ? ", then drop what it grapples" : ""}${move.thenHide ? ", then take the Hide action" : ""}.`
    );
  }
  if (input.moveFirst === true) return;
  if (action.leap) {
    grantMove(state, attacker, {
      id: `${input.commandId}:leap`,
      name: action.name,
      feet: action.leap.feet,
      provokes: true,
      jump: true,
      costFeet: action.leap.costFeet
    });
    say(`${attacker.name} may jump up to ${action.leap.feet} ft for ${action.leap.costFeet} ft of movement.`);
  }
  const spell = action.spellId ? deps.catalog?.spellRecord?.(action.spellId) : undefined;
  const teleport = action.teleport ?? spell?.effect?.teleport;
  if (teleport) {
    // "The balor teleports itself or a willing demon within 10 feet of itself": the creature it names instead.
    const other = teleport.orAnother ? ctx.targets.find((target) => target.id !== attacker.id) : undefined;
    const traveler = other ?? attacker;
    const passenger = teleport.passenger ? passengerOf(ctx, action.name) : undefined;
    grantTeleport(state, traveler, {
      id: `${input.commandId}:teleport`,
      name: action.name,
      teleport,
      userId: attacker.id,
      ...(passenger ? { passengerId: passenger.id } : {})
    });
    say(
      `${traveler.name} may teleport up to ${teleport.feet} ft to an unoccupied space ${attacker.name} can see${teleport.nearUserFeet !== undefined && traveler.id !== attacker.id ? ` within ${teleport.nearUserFeet} ft of ${attacker.name}` : ""}${passenger ? `, ${passenger.name} arriving beside it` : ""}.`
    );
  }
  // "Whenever you activate your Second Wind with a Bonus Action, you can move up to half your Speed without
  // provoking Opportunity Attacks."
  if (action.id === "second-wind" && holdsFeature(definition, "tactical-shift", "Tactical Shift"))
    half(false, "Tactical Shift");
  // "As part of the Bonus Action you take to enter your Rage, you can move up to half your Speed."
  if (
    action.id === "rage" &&
    !attacker.effects.some((effect) => effect.tags.includes(RAGING_TAG)) &&
    holdsFeature(definition, "instinctive-pounce", "Instinctive Pounce")
  )
    half(true, "Instinctive Pounce");
  // "Immediately after you score a Critical Hit, you can move up to half your Speed without provoking Opportunity
  // Attacks."
  if (ctx.crit && ctx.attack !== null && holdsFeature(definition, "remarkable-athlete", "Remarkable Athlete"))
    half(false, "Remarkable Athlete");
  // "Immediately after you take the Attack action or the Magic action, you can teleport up to 30 feet to an unoccupied
  // space you can see." Once the action is taken: after the last attack of an Extra Attack or the last ray of a spell.
  const attackOrMagic =
    action.activation === "action" && (ctx.attack !== null || action.save !== undefined || isMagicAction(action));
  const open = ctx.plan.instance;
  const actionTaken =
    open === null || open.actorId !== attacker.id || Object.values(open.components).every((left) => left <= 0);
  if (
    attackOrMagic &&
    actionTaken &&
    !teleport &&
    holdsFeature(definition, "boon-of-dimensional-travel", "Boon of Dimensional Travel")
  ) {
    grantTeleport(state, attacker, {
      id: `${input.commandId}:blink-steps`,
      name: "Blink Steps",
      teleport: { feet: 30 }
    });
    say(`${attacker.name} may teleport up to 30 ft with Blink Steps.`);
  }
}

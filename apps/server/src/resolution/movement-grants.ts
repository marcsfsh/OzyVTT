import { holdsFeature } from "../class-features.js";
import { RAGING_TAG } from "../effects.js";
import { grantFeet, grantMove, grantTeleport, payOwedAction } from "../granted-moves.js";
import type { ResolveContext } from "./context.js";

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
      // A move that is the action (Trampling Charge) owes nothing after it: its save meets whom it passes through.
      ...(input.moveFirst === true && !move.entersSpaces ? { owedActionId: action.id } : {}),
      ...(move.entersSpaces ? { meets: { actionId: action.id, size: move.entersSpaces.size } } : {})
    });
    const verb =
      move.mode === "fly" ? "fly" : move.mode === "swim" ? "swim" : move.mode === "burrow" ? "burrow" : "move";
    say(
      `${attacker.name} may ${verb} ${feet} ft${move.provokes ? "" : " without provoking Opportunity Attacks"}${move.straight ? " straight toward an enemy" : ""}${move.entersSpaces ? `, and each creature whose space it enters meets ${action.name}` : input.moveFirst === true ? `, then finish ${action.name}` : ""}.`
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
    grantTeleport(state, attacker, { id: `${input.commandId}:teleport`, name: action.name, teleport });
    say(`${attacker.name} may teleport up to ${teleport.feet} ft to an unoccupied space it can see.`);
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
  // space you can see."
  const attackOrMagic =
    action.activation === "action" &&
    (ctx.attack !== null || action.spellId !== undefined || action.save !== undefined);
  if (
    attackOrMagic &&
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

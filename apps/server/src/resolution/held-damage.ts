import type {
  DamageAnswerOffer,
  GameState,
  HeldDamage,
  HeldDamageDie,
  HeldDamageLook,
  RollAnswered
} from "@vtt/domain";
import { parseDiceFormula, resolveDice, type RandomSource } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError } from "../game-store.js";
import { abilityModifier, recordRoll, type DefinitionAction, type LiveActor, type ResolveContext } from "./context.js";
import { freeOptionReady, knowsShaping, SORCERY_POINTS, sorceryPoints, useFreeOption } from "./metamagic.js";

/**
 * Damage rolls answered after they are seen (SRD 5.2.1 Empowered Spell: "When you roll damage for a spell, you can
 * spend 1 Sorcery Point to reroll a number of the damage dice up to your Charisma modifier"; Heroic Inspiration:
 * "reroll any die immediately after rolling it"). A look (`damageLook` on a preview) throws the damage and holds its
 * dice on the server in the order thrown; an answer rerolls the dice it picks on the held roll; the confirm reads the
 * held dice back in the same order, so what lands is what was looked at. The extras a hit carries roll at the confirm.
 */

/** A random source the damage steps throw through. While it runs it gives back the held dice first, in order and while
 *  their sizes match, and notes every die it gives; stopped, it throws as the server does. */
export type DamageTape = Readonly<{
  random: RandomSource;
  start: (held: readonly HeldDamageDie[]) => void;
  /** Marks the dice thrown from now on as the action's own (true) or a rider's (false). */
  own: (yes: boolean) => void;
  stop: () => HeldDamageDie[];
}>;

export function damageTape(base: RandomSource): DamageTape {
  let run: { replay: HeldDamageDie[]; dice: HeldDamageDie[]; own: boolean } | null = null;
  return {
    random: (sides) => {
      if (!run) return base(sides);
      const next = run.replay.shift();
      // A die of another size means the dice no longer line up (a different hit), so the rest is thrown afresh.
      if (next && next.sides !== sides) run.replay = [];
      const face = next && next.sides === sides ? next.face : base(sides);
      run.dice.push({ sides, face, own: run.own });
      return face;
    },
    start: (held) => {
      run = { replay: held.map((die) => ({ ...die })), dice: [], own: false };
    },
    own: (yes) => {
      if (run) run.own = yes;
    },
    stop: () => {
      const dice = run?.dice ?? [];
      run = null;
      return dice;
    }
  };
}

/** A held roll belongs to the turn it was thrown in, as an attack's held d20 does. */
const current = (state: GameState, held: Pick<HeldDamage, "round" | "turnActorId">) =>
  held.round === state.combat.round && held.turnActorId === state.combat.turnActorId;

/** The damage held for this creature's action this turn, if any. */
export function heldDamageFor(state: GameState, actorId: string, actionId: string): HeldDamage | undefined {
  const held = state.heldDamage.find((entry) => entry.actorId === actorId);
  return held && held.actionId === actionId && current(state, held) ? held : undefined;
}

/** Holds a look's dice for the creature, over any earlier look of its own; another turn's looks go. */
export function holdDamage(
  state: GameState,
  entry: Pick<HeldDamage, "actorId" | "actionId" | "dice" | "answers">
): HeldDamage {
  const held: HeldDamage = {
    ...entry,
    round: state.combat.round,
    turnActorId: state.combat.turnActorId,
    createdAt: Date.now()
  };
  state.heldDamage = [
    ...state.heldDamage.filter((other) => other.actorId !== entry.actorId && current(state, other)),
    held
  ].slice(-40);
  return held;
}

export function releaseHeldDamage(state: GameState, actorId: string): void {
  if (state.heldDamage.some((entry) => entry.actorId === actorId))
    state.heldDamage = state.heldDamage.filter((entry) => entry.actorId !== actorId);
}

/** Whether an action rolls damage dice of its own. */
const rollsDamageDice = (action: Pick<DefinitionAction, "damage">) =>
  action.damage.some((part) => /\d+d\d+/i.test(part.formula));

/** Whether Empowered Spell can answer this creature's spell damage now: it knows the option, and a Sorcery Point or this
 *  turn's free option (Arcane Apotheosis) pays for it. */
function empoweredReady(
  state: GameState,
  attacker: LiveActor,
  action: DefinitionAction,
  definition: ActorDefinition | undefined,
  siblings: ReadonlyArray<DefinitionAction>
): { ready: boolean; free: boolean } {
  if (action.spellId === undefined || !knowsShaping(definition, "empowered-spell"))
    return { ready: false, free: false };
  const free = freeOptionReady(state, attacker, definition);
  return { ready: free || sorceryPoints(attacker, siblings).left >= 1, free };
}

/** Whether its user may look at this action's damage before it counts: it rolls damage dice, and Empowered Spell (on a
 *  spell) or Heroic Inspiration could answer them. */
export function damageLookOffered(
  state: GameState,
  attacker: LiveActor,
  action: DefinitionAction,
  definition: ActorDefinition | undefined,
  siblings: ReadonlyArray<DefinitionAction>
): boolean {
  if (!rollsDamageDice(action)) return false;
  return attacker.heroicInspiration || empoweredReady(state, attacker, action, definition, siblings).ready;
}

/** The answers the held dice may still take. */
export function damageAnswerOffers(
  ctx: Pick<ResolveContext, "state" | "attacker" | "action" | "deps" | "siblings">,
  held: Pick<HeldDamage, "dice" | "answers">
): DamageAnswerOffer[] {
  const { state, attacker, action, deps, siblings } = ctx;
  const taken = new Set(held.answers.map((answer) => answer.id));
  const offers: DamageAnswerOffer[] = [];
  const empowered = empoweredReady(state, attacker, action, deps.definition, siblings);
  if (empowered.ready && !taken.has("empowered-spell") && held.dice.some((die) => die.own))
    offers.push({
      id: "empowered-spell",
      name: "Empowered Spell",
      dice: Math.max(1, abilityModifier(deps.definition, "cha")),
      ownOnly: true,
      cost: empowered.free ? null : "1 Sorcery Point"
    });
  if (attacker.heroicInspiration && held.dice.length > 0)
    offers.push({
      id: "heroic-inspiration",
      name: "Heroic Inspiration",
      dice: 1,
      ownOnly: false,
      cost: "Heroic Inspiration"
    });
  return offers;
}

/** Why an answer can't meet the held dice now. */
function refusalOf(
  ctx: Pick<ResolveContext, "attacker" | "action">,
  id: DamageAnswerOffer["id"],
  held: Pick<HeldDamage, "answers">
): string {
  const { attacker, action } = ctx;
  if (id === "heroic-inspiration") return `${attacker.name} has no Heroic Inspiration to reroll a die with.`;
  if (action.spellId === undefined) return "Empowered Spell rerolls the damage dice of a spell.";
  if (held.answers.some((answer) => answer.id === id)) return "Empowered Spell has already rerolled this damage.";
  return `${attacker.name} can't use Empowered Spell now: it needs the option and 1 Sorcery Point.`;
}

/**
 * Applies an answer to the held damage: checks it may meet the dice it picks, spends what it costs (a Sorcery Point or
 * this turn's free option, or Heroic Inspiration), rerolls those dice with the server's dice and records them, and
 * writes the new faces onto the held roll, which the confirm then deals.
 */
export function answerHeldDamage(
  ctx: ResolveContext,
  held: HeldDamage,
  choice: Readonly<{ id: DamageAnswerOffer["id"]; dice: readonly number[] }>,
  random: RandomSource
): HeldDamage {
  const { state, attacker, action, deps } = ctx;
  const offer = damageAnswerOffers(ctx, held).find((candidate) => candidate.id === choice.id);
  if (!offer) throw new CommandRejectedError(refusalOf(ctx, choice.id, held));
  const picks = [...new Set(choice.dice)];
  if (picks.length !== choice.dice.length) throw new CommandRejectedError("Pick each die once.");
  if (picks.length > offer.dice)
    throw new CommandRejectedError(
      offer.dice === 1 ? `${offer.name} rerolls one die.` : `${offer.name} rerolls up to ${offer.dice} dice.`
    );
  for (const index of picks) {
    const die = held.dice[index];
    if (!die) throw new CommandRejectedError("That die isn't in this damage roll.");
    if (offer.ownOnly && !die.own)
      throw new CommandRejectedError(`${offer.name} rerolls ${action.name}'s own damage dice.`);
  }
  if (offer.id === "empowered-spell") {
    if (freeOptionReady(state, attacker, deps.definition)) useFreeOption(state);
    else
      attacker.actionUses = {
        ...attacker.actionUses,
        [SORCERY_POINTS]: (attacker.actionUses[SORCERY_POINTS] ?? 0) + 1
      };
  } else attacker.heroicInspiration = false;
  const dice = held.dice.map((die, index) => (picks.includes(index) ? { ...die, face: random(die.sides) } : die));
  // One record for each size of die rerolled, showing the new faces.
  for (const sides of [...new Set(picks.map((index) => dice[index]!.sides))]) {
    const faces = picks.filter((index) => dice[index]!.sides === sides).map((index) => dice[index]!.face);
    const rolled = resolveDice(parseDiceFormula(`${faces.length}d${sides}`), () => faces.shift()!);
    recordRoll(ctx, rolled, "damage", `${action.name}: ${offer.name}`);
  }
  return holdDamage(state, {
    actorId: held.actorId,
    actionId: held.actionId,
    dice,
    answers: [...held.answers, { id: offer.id, name: offer.name, dice: picks }]
  });
}

/** The held dice as a look's reply shows them. */
export function heldDamageLook(
  ctx: Pick<ResolveContext, "state" | "attacker" | "action" | "deps" | "siblings">,
  held: Pick<HeldDamage, "dice" | "answers">
): HeldDamageLook {
  const answered: RollAnswered[] = held.answers.map((answer) => ({
    name: answer.name,
    change: `rerolled ${answer.dice.length === 1 ? "1 die" : `${answer.dice.length} dice`}`
  }));
  return {
    dice: held.dice.map((die) => ({ ...die })),
    answered,
    answers: damageAnswerOffers(ctx, held)
  };
}

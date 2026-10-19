import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { addEffect, endEffect, makeEffect, type EffectNarration } from "./effects.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError, RulesBlockedError } from "./game-store.js";
import { grantMove } from "./granted-moves.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { nearestOpenSpace, OFF_PLANE_TAG } from "./off-plane.js";
import {
  effectiveModeFor,
  overrideCovers,
  overrideReason,
  overrideWaives,
  type RuleId,
  type RulesOverride
} from "./rules-families.js";
import { currentSpeedFeet } from "./speed.js";
import { retireSummoned } from "./summons.js";
import type { TokenMapGeometry } from "./token-placement.js";
import { SHARED_SIGHT_TAG } from "./vision/audience.js";

/**
 * What a commander does with the creatures it summoned (SRD 5.2.1): commands them (Animate Dead's Bonus Action, which
 * a creature with no turns of its own takes as a move, an Unseen Servant's 15 feet), dismisses one (an elemental from a
 * bowl, a familiar for good or into its pocket dimension), calls a familiar back from that dimension, or looks through
 * its eyes. Each spends the commander's action or Bonus Action on its turn in a fight, as the rules police the economy.
 */

type Actor = GameState["actors"][number];
type Slot = "action" | "bonus-action";

/** A rule the order meets, and the GM's override that let one through. */
export type OrderOutcome = { warnings: string[]; overridden: string | null; events: EffectNarration[] };

const newOutcome = (): OrderOutcome => ({ warnings: [], overridden: null, events: [] });

function police(
  state: GameState,
  override: RulesOverride | null,
  rule: RuleId,
  message: string,
  outcome: OrderOutcome
) {
  if (effectiveModeFor(state.combat, rule) === "freeform") return;
  if (overrideWaives(override, rule)) {
    outcome.overridden = overrideReason(override);
    return;
  }
  if (effectiveModeFor(state.combat, rule) === "strict" && !overrideCovers(state.combat.turn, rule))
    throw new RulesBlockedError(rule, message);
  outcome.warnings.push(message);
}

/** In a fight, the order is the commander's action or Bonus Action on its own turn. */
function spendSlot(
  state: GameState,
  commander: Actor,
  slot: Slot,
  what: string,
  override: RulesOverride | null,
  outcome: OrderOutcome
): void {
  if (!state.combat.active) return;
  if (state.combat.turnActorId !== commander.id)
    police(
      state,
      override,
      "economy.not-your-turn",
      `${commander.name} ${what} on ${commander.name}'s own turn.`,
      outcome
    );
  const spent = slot === "action" ? state.combat.turn.actionUsed : state.combat.turn.bonusActionUsed;
  if (spent && state.combat.turnActorId === commander.id)
    police(
      state,
      override,
      slot === "action" ? "economy.action-used" : "economy.bonus-action-used",
      `${commander.name} has used ${slot === "action" ? "the action" : "the Bonus Action"} this turn, and ${what.replace(/^with /, "")} takes it.`,
      outcome
    );
  if (state.combat.turnActorId === commander.id)
    state.combat = {
      ...state.combat,
      turn: { ...state.combat.turn, [slot === "action" ? "actionUsed" : "bonusActionUsed"]: true }
    };
}

const slotWords = (slot: Slot) => (slot === "action" ? "takes a Magic action" : "takes a Bonus Action");

export type OrderInput = Readonly<{
  override: RulesOverride | null;
  distanceFeet: (a: string, b: string) => number | null;
  newId: () => string;
}>;

/** Commands the creatures a commander summoned that take a command (Animate Dead's undead, an Unseen Servant): those
 *  named, or every one it commands that way. A creature with turns of its own acts on its next one; one with none moves
 *  the distance its command gives it now. */
export function commandSummons(
  state: GameState,
  input: OrderInput &
    Readonly<{
      commanderId: string;
      creatureIds?: readonly string[];
      resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
      catalog?: EquipmentCatalog;
    }>
): OrderOutcome & { commanded: string[] } {
  const outcome = newOutcome();
  const commander = state.actors.find((actor) => actor.id === input.commanderId);
  if (!commander) throw new CommandRejectedError("That combatant no longer exists.");
  const ordered = state.actors.filter(
    (actor) => actor.control?.by === commander.id && actor.control.commandedWith !== undefined
  );
  const chosen = input.creatureIds ? ordered.filter((actor) => input.creatureIds!.includes(actor.id)) : ordered;
  if (input.creatureIds && chosen.length !== input.creatureIds.length)
    throw new CommandRejectedError(`${commander.name} doesn't command those creatures.`);
  if (chosen.length === 0) throw new CommandRejectedError(`${commander.name} has no creature to command.`);
  const slot: Slot = chosen.some((actor) => actor.control?.commandedWith === "action") ? "action" : "bonus-action";
  for (const creature of chosen) {
    const reach = creature.control?.commandFeet ?? creature.summon?.leashFeet;
    const apart = input.distanceFeet(commander.id, creature.id);
    if (reach !== undefined && apart !== null && apart > reach + DISTANCE_TOLERANCE_FEET)
      police(
        state,
        input.override,
        "summon.command",
        `${creature.name} is ${Math.round(apart)} ft from ${commander.name}, beyond the ${reach} ft a command reaches.`,
        outcome
      );
  }
  spendSlot(state, commander, slot, `${slotWords(slot)} to command`, input.override, outcome);
  for (const creature of chosen) {
    const move = creature.summon?.noTurns ? creature.summon.commandMove : undefined;
    if (move !== undefined) {
      const definition = commander.definitionId ? input.resolveDefinition(commander.definitionId) : undefined;
      const feet =
        move === "twice-user-speed"
          ? 2 * (currentSpeedFeet(commander, deriveEquipment(commander, definition, input.catalog)) ?? 30)
          : move;
      grantMove(state, creature, {
        id: input.newId(),
        name: `Commanded by ${commander.name}`,
        feet: Math.min(999, feet),
        provokes: true
      });
      outcome.events.push({
        kind: "effect",
        text: `${commander.name} sends ${creature.name} up to ${feet} ft.`,
        actorId: creature.id
      });
      continue;
    }
    creature.control = { ...creature.control!, commanded: true };
    outcome.events.push({ kind: "effect", text: `${commander.name} commands ${creature.name}.`, actorId: creature.id });
  }
  return { ...outcome, commanded: chosen.map((actor) => actor.id) };
}

/** The creature's commander, which a dismissal or a recall needs. */
function commanderOfSummon(state: GameState, creature: Actor): Actor {
  const commander = state.actors.find((actor) => actor.id === (creature.control?.by ?? creature.summon?.by));
  if (!creature.summon || !commander)
    throw new CommandRejectedError(`${creature.name} wasn't summoned by anyone here.`);
  return commander;
}

/** The commander dismisses a summoned creature: for good, or (a familiar) into its pocket dimension, off the map until
 *  recalled. */
export function dismissSummon(
  state: GameState,
  input: Readonly<{ creatureId: string; temporary: boolean; override: RulesOverride | null; newId: () => string }>
): OrderOutcome {
  const outcome = newOutcome();
  const creature = state.actors.find((actor) => actor.id === input.creatureId);
  if (!creature) throw new CommandRejectedError("That combatant no longer exists.");
  const commander = commanderOfSummon(state, creature);
  const slot = creature.summon?.dismiss;
  if (!slot) throw new CommandRejectedError(`${commander.name} can't dismiss ${creature.name}; its magic ends it.`);
  if (input.temporary && creature.summon?.sight !== "bonus-action")
    throw new CommandRejectedError(`${creature.name} has no pocket dimension to wait in.`);
  spendSlot(state, commander, slot, `${slotWords(slot)} to dismiss ${creature.name}`, input.override, outcome);
  if (!input.temporary) {
    outcome.events.push(...retireSummoned(state, creature.id, `is dismissed by ${commander.name}`));
    return outcome;
  }
  addEffect(
    state,
    creature.id,
    makeEffect({
      id: input.newId(),
      name: "In a pocket dimension",
      tags: [OFF_PLANE_TAG],
      duration: { type: "manual" },
      sourceActorId: commander.id,
      sourceName: commander.name,
      startedRound: state.combat.round
    })
  );
  outcome.events.push({
    kind: "effect",
    text: `${commander.name} dismisses ${creature.name} to a pocket dimension.`,
    actorId: creature.id
  });
  return outcome;
}

/** A familiar in its pocket dimension comes back "in an unoccupied space within 30 feet of you". */
export function recallSummon(
  state: GameState,
  input: Readonly<{ creatureId: string; override: RulesOverride | null }>,
  geometry: TokenMapGeometry | null
): OrderOutcome {
  const outcome = newOutcome();
  const creature = state.actors.find((actor) => actor.id === input.creatureId);
  if (!creature) throw new CommandRejectedError("That combatant no longer exists.");
  const commander = commanderOfSummon(state, creature);
  const away = creature.effects.find(
    (effect) => effect.tags.includes(OFF_PLANE_TAG) && effect.sourceActorId === commander.id
  );
  if (!away) throw new CommandRejectedError(`${creature.name} isn't in its pocket dimension.`);
  spendSlot(state, commander, "action", `takes a Magic action to call back ${creature.name}`, input.override, outcome);
  // It comes back beside its commander, not where it left (`off-plane.ts` returns a creature to the space it held).
  const commanderAt = state.combat.tokens.find((token) => token.actorId === commander.id)?.position;
  if (commanderAt && geometry)
    state.combat = {
      ...state.combat,
      offPlane: state.combat.offPlane.map((entry) =>
        entry.actorId === creature.id
          ? (({ altitudeFeet: _height, airborne: _airborne, ...rest }) => ({
              ...rest,
              position: nearestOpenSpace(state, creature.id, commanderAt, geometry)
            }))(entry)
          : entry
      )
    };
  outcome.events.push(...endEffect(state, creature.id, away.id));
  return outcome;
}

/** "As a Bonus Action, you can see through the familiar's eyes and hear what it hears until the start of your next
 *  turn, gaining the benefits of any special senses it has." */
export function lookThroughSummon(
  state: GameState,
  input: Readonly<{ creatureId: string; override: RulesOverride | null; newId: () => string }>
): OrderOutcome {
  const outcome = newOutcome();
  const creature = state.actors.find((actor) => actor.id === input.creatureId);
  if (!creature) throw new CommandRejectedError("That combatant no longer exists.");
  const commander = commanderOfSummon(state, creature);
  if (creature.summon?.sight !== "bonus-action")
    throw new CommandRejectedError(
      creature.summon?.sight === "always"
        ? `${commander.name} already sees through ${creature.name}.`
        : `${commander.name} can't see through ${creature.name}'s eyes.`
    );
  spendSlot(
    state,
    commander,
    "bonus-action",
    `takes a Bonus Action to look through ${creature.name}'s eyes`,
    input.override,
    outcome
  );
  commander.effects = commander.effects.filter(
    (effect) => !(effect.tags.includes(SHARED_SIGHT_TAG) && effect.sourceActorId === creature.id)
  );
  addEffect(
    state,
    commander.id,
    makeEffect({
      id: input.newId(),
      name: `Seeing through ${creature.name}`,
      tags: [SHARED_SIGHT_TAG],
      duration: state.combat.active ? { type: "until-bearer-next-turn" } : { type: "rounds", remaining: 1 },
      sourceActorId: creature.id,
      sourceName: creature.name,
      startedRound: state.combat.round
    })
  );
  outcome.events.push({
    kind: "effect",
    text: `${commander.name} sees through ${creature.name}'s eyes.`,
    actorId: commander.id
  });
  return outcome;
}

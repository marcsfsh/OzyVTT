import { SummonCommandSchema, SummonDismissSchema, SummonLookSchema, SummonRecallSchema } from "@vtt/domain/commands";
import { GameAccessDeniedError, requireActorAccess } from "../authorization.js";
import { commandSummons, dismissSummon, lookThroughSummon, recallSummon, type OrderOutcome } from "../summon-orders.js";
import { initiatorOf, isGmGrade, type GamePrincipal, type Kit } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// What a commander does with the creatures it summoned: command them, dismiss one, call a familiar back, look through
// its eyes (`summon-orders.ts`).

const OVERRIDE_DENIED = "Only the GM can override the rules for a summoned creature.";

/** The GM's override; a player's is refused before anything runs. */
function overrideOf(principal: GamePrincipal, override: Parameters<typeof commandSummons>[1]["override"] | undefined) {
  if (override && !isGmGrade(principal)) throw new GameAccessDeniedError(OVERRIDE_DENIED);
  return isGmGrade(principal) ? (override ?? null) : null;
}

/** Tells the table what the order did, the GM its rules notes, and the log an override. */
function narrateOrder(kit: Kit, actorId: string, label: string, outcome: OrderOutcome) {
  kit.publishNarrations(outcome.events);
  kit.logRulesNotes(outcome.warnings, actorId);
  if (outcome.overridden)
    kit.context.appendLog({
      kind: "override",
      text: `OVERRIDE (summons): ${kit.actorName(actorId)} ${label} · ${outcome.overridden}`,
      actorIds: [actorId]
    });
}

export const summonCommands = [
  defineCommand({
    type: "summon.command",
    operationId: "commandSummons",
    description:
      "A creature commands the creatures it summoned that take a command (SRD 5.2.1 Animate Dead, Animate Objects, Create Undead, Unseen Servant): those in `creatureIds`, or every one it commands that way, within the range the spell gives. It costs the commander's Bonus Action (a Magic action for some) on its own turn in a fight. A commanded creature acts on its next turn, where one left uncommanded takes the Dodge action; a summoned thing with no turns of its own moves the distance its command gives it this turn. A player commands only through their own character; the GM may `override` an economy or range rule.",
    summary: "Command the creatures a creature summoned (a Bonus Action).",
    schema: SummonCommandSchema,
    malformed: "The command is malformed.",
    async run({ principal, request, execute }, kit) {
      const override = overrideOf(principal, request.override);
      const distance = await kit.creatureDistance();
      let outcome: OrderOutcome | undefined;
      const { duplicate } = await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, request.actorId, "attack");
        outcome = commandSummons(state, {
          commanderId: request.actorId,
          ...(request.creatureIds ? { creatureIds: request.creatureIds } : {}),
          override,
          distanceFeet: (a, b) => distance(state, a, b),
          newId: kit.context.newId,
          resolveDefinition: (definitionId) => kit.resolveDefinitionIn(state, definitionId),
          catalog: kit.equipmentCatalog()
        });
      });
      if (duplicate || !outcome) return;
      narrateOrder(kit, request.actorId, "commanded past a rule", outcome);
    }
  }),

  defineCommand({
    type: "summon.dismiss",
    operationId: "dismissSummon",
    description:
      "A summoned creature's commander dismisses it, as its spell or item allows (an elemental from a bowl as a Bonus Action, a familiar as a Magic action): it leaves the map and the roster, or with `temporary` a familiar goes to its pocket dimension, off the map until recalled. A player dismisses only a creature their own character commands; the GM may `override` an economy rule.",
    summary: "Dismiss a summoned creature, for good or into its pocket dimension.",
    schema: SummonDismissSchema,
    malformed: "The dismissal is malformed.",
    async run({ principal, request, execute }, kit) {
      const override = overrideOf(principal, request.override);
      let outcome: OrderOutcome | undefined;
      const { duplicate } = await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, request.actorId, "attack");
        outcome = dismissSummon(state, {
          creatureId: request.actorId,
          temporary: request.temporary === true,
          override,
          newId: kit.context.newId
        });
      });
      if (duplicate || !outcome) return;
      narrateOrder(kit, request.actorId, "dismissed past a rule", outcome);
    }
  }),

  defineCommand({
    type: "summon.recall",
    operationId: "recallSummon",
    description:
      "A familiar its commander dismissed to its pocket dimension comes back, with the commander's Magic action, in an unoccupied space within 30 feet of the commander (SRD 5.2.1 Find Familiar). A player recalls only their own character's familiar; the GM may `override` an economy rule.",
    summary: "Call a familiar back from its pocket dimension (a Magic action).",
    schema: SummonRecallSchema,
    malformed: "The recall is malformed.",
    async run({ principal, request, execute }, kit) {
      const override = overrideOf(principal, request.override);
      const geometry = await kit.liveGeometry();
      let outcome: OrderOutcome | undefined;
      const { duplicate } = await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, request.actorId, "attack");
        outcome = recallSummon(state, { creatureId: request.actorId, override }, geometry);
      });
      if (duplicate || !outcome) return;
      narrateOrder(kit, request.actorId, "recalled past a rule", outcome);
    }
  }),

  defineCommand({
    type: "summon.look",
    operationId: "lookThroughSummon",
    description:
      "A commander sees through a summoned creature's eyes and hears what it hears until the start of its next turn, gaining its special senses (SRD 5.2.1 Find Familiar), for a Bonus Action: with dynamic vision on, the commander's player sees what it sees. A player looks only through their own character's familiar; the GM may `override` an economy rule.",
    summary: "See through a familiar's eyes until the commander's next turn (a Bonus Action).",
    schema: SummonLookSchema,
    malformed: "The request is malformed.",
    async run({ principal, request, execute }, kit) {
      const override = overrideOf(principal, request.override);
      let outcome: OrderOutcome | undefined;
      const { duplicate } = await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, request.actorId, "attack");
        outcome = lookThroughSummon(state, { creatureId: request.actorId, override, newId: kit.context.newId });
      });
      if (duplicate || !outcome) return;
      narrateOrder(kit, request.actorId, "looked through a summoned creature past a rule", outcome);
    }
  })
];

import {
  RestAnswerSchema,
  RestAskSchema,
  RestFinishSchema,
  RestMarkDoneSchema,
  RestPartySchema,
  TimePassSchema
} from "@vtt/domain/commands";
import type { GameState } from "@vtt/domain";
import type { EffectNarration } from "../effects.js";
import {
  answerLongRest,
  askForLongRest,
  finishPartyShortRest,
  LONG_REST_HOURS,
  markShortRestDone,
  passTime,
  startPartyRest
} from "../rests.js";
import { initiatorOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Long Rest requests, the GM's party rest and game time (SRD Resting: a Long Rest waits 16 hours after the last).

type ClockSpan = { fromHours: number; toHours: number };

/** Runs a change to the state and notes how far it moved the game clock, which the Codex calendar follows. */
function timed(state: GameState, change: () => void, span: ClockSpan): void {
  span.fromHours = state.rest.clockHours;
  change();
  span.toHours = state.rest.clockHours;
}

const names = (list: readonly string[]) =>
  list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;

export const restingCommands = [
  defineCommand({
    type: "rest.ask",
    operationId: "askForLongRest",
    description:
      "A player asks the GM for a Long Rest for their claimed character, or takes the ask back with `withdraw`. Refused at once when the rest would be: in a running encounter, at 0 hit points or dead, or within 16 hours of game time after the character's last Long Rest (SRD Resting), with the wait in the refusal. The GM approves or turns it down with rest.answer.",
    summary: "Ask the GM for a Long Rest for your character, or take the ask back.",
    schema: RestAskSchema,
    malformed: "The rest request is malformed.",
    playerOnly: "The GM rests a character from its sheet or the party rest.",
    async run({ principal, request, execute }, kit) {
      const { actorId, withdraw = false } = request;
      const { duplicate } = await execute((state) => askForLongRest(state, actorId, withdraw, initiatorOf(principal)));
      if (duplicate) return;
      kit.context.appendLog({
        kind: "heal",
        text: withdraw
          ? `${kit.actorName(actorId)} no longer asks for a Long Rest.`
          : `${kit.actorName(actorId)} asks for a Long Rest.`,
        actorIds: [actorId],
        gmOnly: kit.actorHidden(actorId)
      });
      // The ask waits under Needs you on the GM's table; the toast reaches the GM on whatever page they are on.
      if (!withdraw)
        kit.context.broadcastTableEvent({
          kind: "heal",
          text: `${kit.actorName(actorId)} asks for a Long Rest. Answer it under Needs you on the Table.`,
          actorIds: [actorId],
          gmOnly: true,
          logged: false
        });
    }
  }),

  defineCommand({
    type: "rest.answer",
    operationId: "answerLongRest",
    description:
      "GM-only: answers a player's Long Rest request. `approve` gives the Long Rest now, as actor.rest does, and records it against the game clock; it is refused (and the request stays) if the character can no longer rest, including by the 16-hour rule. Otherwise the request is turned down.",
    summary: "Approve a player's Long Rest request or turn it down.",
    schema: RestAnswerSchema,
    malformed: "The rest answer is malformed.",
    gmOnly: "Only the GM answers a Long Rest request.",
    async run({ principal, request, execute }, kit) {
      const { actorId, approve } = request;
      let events: EffectNarration[] = [];
      const { duplicate } = await execute((state) => {
        // A charged item's dawn regain is rolled with the server's dice, as on any Long Rest.
        events = answerLongRest(
          state,
          actorId,
          approve,
          initiatorOf(principal),
          kit.resolveDefinition,
          kit.equipmentCatalog(),
          (sides) => kit.context.random(sides)
        );
      });
      if (duplicate) return;
      kit.context.appendLog({
        kind: "heal",
        text: approve
          ? `${kit.actorName(actorId)} completed a Long Rest.`
          : `The GM turned down ${kit.actorName(actorId)}'s Long Rest.`,
        actorIds: [actorId],
        gmOnly: kit.actorHidden(actorId)
      });
      kit.publishNarrations(events);
    }
  }),

  defineCommand({
    type: "rest.party",
    operationId: "restParty",
    description:
      "GM-only: rests several characters together. All of them must be able to rest (out of any running encounter, at 1 hit point or more, and for a Long Rest 16 hours of game time after their last one) or none does, and the refusal names who can't and why. Long: each gets a Long Rest now and the game clock moves 8 hours. Short: the party's Short Rest opens; each player spends Hit Dice on their own device and marks themselves done (rest.mark-done), and rest.finish ends it. Rolling Initiative, taking any damage or casting a spell other than a cantrip takes a member out of it, with no benefits (SRD Interrupting the Rest).",
    summary: "Rest several characters together: a Long Rest now, or a Short Rest that stays open for Hit Dice.",
    schema: RestPartySchema,
    malformed: "The party rest is malformed.",
    issueMessage: true,
    gmOnly: "Only the GM rests the party.",
    async run({ request, execute }, kit) {
      const { kind, actorIds } = request;
      let events: EffectNarration[] = [];
      const span: ClockSpan = { fromHours: 0, toHours: 0 };
      const { duplicate } = await execute((state) =>
        timed(
          state,
          () => {
            events = startPartyRest(state, actorIds, kind, kit.resolveDefinition, kit.equipmentCatalog(), (sides) =>
              kit.context.random(sides)
            );
          },
          span
        )
      );
      if (duplicate) return;
      if (span.toHours > span.fromHours) kit.context.onTimePassed?.(span);
      const who = names(actorIds.map((actorId) => kit.actorName(actorId)));
      const hidden = actorIds.some((actorId) => kit.actorHidden(actorId));
      kit.context.appendLog({
        kind: "heal",
        text:
          kind === "long"
            ? `${who} finished a Long Rest. ${LONG_REST_HOURS} hours pass.`
            : `${who} start a Short Rest.`,
        actorIds,
        gmOnly: hidden
      });
      kit.publishNarrations(events);
    }
  }),

  defineCommand({
    type: "rest.mark-done",
    operationId: "markShortRestDone",
    description:
      "Marks a member of the party's Short Rest as done spending Hit Dice, or not done with `done: false`. The character's player or the GM. The GM may finish the rest whoever is done.",
    summary: "Say you're done spending Hit Dice in the party's Short Rest.",
    schema: RestMarkDoneSchema,
    malformed: "The rest update is malformed.",
    async run({ principal, request, execute }) {
      const { actorId, done } = request;
      await execute((state) => markShortRestDone(state, actorId, done, initiatorOf(principal)));
    }
  }),

  defineCommand({
    type: "rest.finish",
    operationId: "finishShortRest",
    description:
      "GM-only: ends the party's Short Rest. With `apply`, each member who can still rest gets the Short Rest's benefits (as actor.rest) and the game clock moves an hour; a member now at 0 hit points or in a running encounter gets nothing. Without it the rest is called off and no time passes.",
    summary: "End the party's Short Rest, with its benefits or calling it off.",
    schema: RestFinishSchema,
    malformed: "The rest command is malformed.",
    gmOnly: "Only the GM ends the party's rest.",
    async run({ request, execute }, kit) {
      const { apply } = request;
      let events: EffectNarration[] = [];
      let rested: string[] = [];
      const span: ClockSpan = { fromHours: 0, toHours: 0 };
      const { duplicate } = await execute((state) =>
        timed(
          state,
          () => {
            ({ events, rested } = finishPartyShortRest(state, apply, kit.resolveDefinition, kit.equipmentCatalog()));
          },
          span
        )
      );
      if (duplicate) return;
      if (span.toHours > span.fromHours) kit.context.onTimePassed?.(span);
      kit.context.appendLog({
        kind: "heal",
        text: !apply
          ? "The Short Rest was called off."
          : rested.length > 0
            ? `${names(rested)} finished a Short Rest.`
            : "The Short Rest ended with nobody rested.",
        gmOnly: false
      });
      kit.publishNarrations(events);
    }
  }),

  defineCommand({
    type: "time.pass",
    operationId: "passTime",
    description:
      "GM-only: moves the game clock forward by whole hours. The clock is what the 16-hour rule between Long Rests reads; a party rest moves it too (8 hours for a Long Rest, 1 for a Short Rest). Each midnight it crosses moves the Codex calendar's date a day, and the players' date with it when the two were the same day. With `pace` the party travels for those hours (SRD Travel Pace: 4, 3 or 2 miles an hour), and the log says how far it went and what the pace does to its checks. Nothing else happens with the time: effects and Concentration are the GM's to end.",
    summary: "Move game time forward by some hours.",
    schema: TimePassSchema,
    malformed: "Choose between 1 and 720 hours.",
    gmOnly: "Only the GM moves game time.",
    async run({ request, execute }, kit) {
      const { hours, pace } = request;
      const span: ClockSpan = { fromHours: 0, toHours: 0 };
      const { duplicate } = await execute((state) => timed(state, () => passTime(state, hours), span));
      if (duplicate) return;
      if (span.toHours > span.fromHours) kit.context.onTimePassed?.(span);
      kit.context.appendLog({
        kind: "encounter",
        text: `${hours} ${hours === 1 ? "hour passes" : "hours pass"}.`,
        gmOnly: false
      });
      if (pace) kit.context.appendLog({ kind: "encounter", text: travelLine(hours, pace), gmOnly: false });
    }
  })
];

/** SRD 5.2.1 Travel Pace: how far the party goes in those hours, and what the pace does to its checks. */
const TRAVEL_PACES = {
  fast: { milesPerHour: 4, effect: "Disadvantage on Wisdom (Perception or Survival) and Dexterity (Stealth) checks" },
  normal: { milesPerHour: 3, effect: "Disadvantage on Dexterity (Stealth) checks" },
  slow: { milesPerHour: 2, effect: "Advantage on Wisdom (Perception or Survival) checks" }
} as const;

export function travelLine(hours: number, pace: keyof typeof TRAVEL_PACES): string {
  const { milesPerHour, effect } = TRAVEL_PACES[pace];
  const miles = hours * milesPerHour;
  const name = pace[0]!.toUpperCase() + pace.slice(1);
  return `The party travels ${miles} ${miles === 1 ? "mile" : "miles"} at a ${name} pace, with ${effect} on the way.`;
}

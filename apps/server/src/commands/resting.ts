import {
  ActorHoldBreathSchema,
  ActorNourishSchema,
  RestAnswerSchema,
  RestAskSchema,
  RestFinishSchema,
  RestMarkDoneSchema,
  RestPartySchema,
  SurvivalSetTrackingSchema,
  TimePassSchema,
  TimeSetDawnSchema
} from "@vtt/domain/commands";
import { breathesWater, startHoldingBreath } from "../breath.js";
import { endEffect } from "../effects.js";
import { CommandRejectedError } from "../game-store.js";
import { nourish, setSurvivalTracking } from "../survival.js";
import { gameTimeSpanLabel, type GameState } from "@vtt/domain";
import type { EffectNarration } from "../effects.js";
import {
  answerLongRest,
  askForLongRest,
  finishPartyShortRest,
  markShortRestDone,
  passTime,
  startPartyRest
} from "../rests.js";
import { initiatorOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Long Rest requests, the GM's party rest and game time (SRD Resting: a Long Rest waits 16 hours after the last). Time
// on the clock counts down what lasts in game time (`game-time.ts`).

type ClockSpan = { fromHours: number; toHours: number };

/** Runs a change to the state and notes how far it moved the game clock, which the Codex calendar follows. */
function timed(state: GameState, change: () => void, span: ClockSpan): void {
  span.fromHours = state.rest.clockHours;
  change();
  span.toHours = state.rest.clockHours;
}

/** "10 minutes pass.", "1 hour passes." */
function passedLine(minutes: number): string {
  const span = gameTimeSpanLabel(minutes);
  return `${span} ${/^1 [a-z]+$/.test(span) ? "passes" : "pass"}.`;
}

const names = (list: readonly string[]) =>
  list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;

export const restingCommands = [
  defineCommand({
    type: "survival.set-tracking",
    operationId: "setSurvivalTracking",
    description:
      "GM-only: starts or stops tracking food and water (SRD Malnutrition, Dehydration). While it is on, each character records what it eats and drinks during the game day (`actor.nourish`), and at each midnight the clock passes it eats the Rations and drinks from the Waterskins it carries as far as its need goes (1 pound of food and 1 gallon of water for a Small or Medium creature). Less than half its water costs a level of Exhaustion; less than half its food, a DC 10 Constitution save against one; five days with no food, a level each day. Those levels stay until it eats or drinks its full need for a day. Turning it off drops every record.",
    summary: "Start or stop tracking the party's food and water by the day (GM).",
    schema: SurvivalSetTrackingSchema,
    malformed: "The survival setting is malformed.",
    gmOnly: "Only the GM decides whether food and water are tracked.",
    async run({ principal, request, execute }, kit) {
      const { duplicate } = await execute((state) =>
        setSurvivalTracking(state, request.enabled, initiatorOf(principal))
      );
      if (duplicate) return;
      kit.context.appendLog({
        kind: "encounter",
        text: request.enabled
          ? "The table now tracks food and water: each day's end eats and drinks what the characters carry."
          : "The table no longer tracks food and water.",
        gmOnly: false
      });
    }
  }),

  defineCommand({
    type: "actor.nourish",
    operationId: "nourishActor",
    description:
      "A character eats or drinks, while the table tracks food and water: `food` is a full `meal` (Create Food and Water, Heroes' Feast, an inn), a day's `ration` from its Rations, or a `goodberry` from its Goodberries (a day's food, and 1 Hit Point back); `water` is its `fill` at a source (which also fills its Waterskins) or what its `waterskin`s hold, up to its need. Eating or drinking a full day's need lets a rest take off the Exhaustion hunger or thirst gave. GM-grade for any character; a player session only for their own claimed character, and only from what it carries (a ration, a Goodberry, a Waterskin): a meal or a fill at a source is the GM's to give.",
    summary: "Eat or drink for the day: a meal, a ration, a Goodberry, a source or a Waterskin.",
    schema: ActorNourishSchema,
    malformed: "Say what the character eats or drinks.",
    async run({ principal, request, execute }, kit) {
      let events: EffectNarration[] = [];
      const { duplicate } = await execute((state) => {
        events = nourish(
          state,
          request.actorId,
          {
            ...(request.food !== undefined ? { food: request.food } : {}),
            ...(request.water !== undefined ? { water: request.water } : {})
          },
          initiatorOf(principal)
        );
      });
      if (duplicate) return;
      kit.publishNarrations(events);
    }
  }),

  defineCommand({
    type: "actor.hold-breath",
    operationId: "setActorBreath",
    description:
      "GM-only: a creature starts holding its breath (underwater, engulfed, in a choking cloud), or breathes again (`holding: false`). It holds it for 1 plus its Constitution modifier minutes, at least 30 seconds (a Hold Breath trait's printed time instead), counted as each of its turns ends and as game time passes; then it gains a level of Exhaustion at the end of each of its turns (SRD Suffocation). Breathing again takes those levels off. A creature that breathes water (Amphibious, Water Breathing, a Cloak of the Manta Ray) is refused.",
    summary: "Start or end a creature's held breath (GM).",
    schema: ActorHoldBreathSchema,
    malformed: "The breath command is malformed.",
    gmOnly: "Only the GM decides who is out of air.",
    async run({ request, execute }, kit) {
      let events: EffectNarration[] = [];
      const { duplicate } = await execute((state) => {
        const actor = state.actors.find((candidate) => candidate.id === request.actorId);
        if (!actor) throw new CommandRejectedError("That creature no longer exists.");
        const definition = actor.definitionId ? kit.resolveDefinitionIn(state, actor.definitionId) : undefined;
        const held = actor.effects.find((effect) => effect.breath !== undefined);
        if (!request.holding) {
          if (!held) throw new CommandRejectedError(`${actor.name} is breathing already.`);
          events = endEffect(state, actor.id, held.id);
          return;
        }
        if (breathesWater(actor, definition)) throw new CommandRejectedError(`${actor.name} breathes water.`);
        if (held) throw new CommandRejectedError(`${actor.name} is holding its breath already.`);
        events = startHoldingBreath(state, actor, definition);
      });
      if (duplicate) return;
      kit.publishNarrations(events);
    }
  }),

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
      "GM-only: rests several characters together. All of them must be able to rest (out of any running encounter, at 1 hit point or more, and for a Long Rest 16 hours of game time after their last one) or none does, and the refusal names who can't and why. Long: the game clock moves 8 hours (4 when every member holds an elf's Trance), which ends what runs out in that time on every creature as time.pass does, and each gets a Long Rest. Short: the party's Short Rest opens; each player spends Hit Dice on their own device and marks themselves done (rest.mark-done), and rest.finish ends it. Rolling Initiative, taking any damage or casting a spell other than a cantrip takes a member out of it, with no benefits (SRD Interrupting the Rest).",
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
            ? `${who} finished a Long Rest. ${passedLine(Math.round((span.toHours - span.fromHours) * 60))}`
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
      "GM-only: ends the party's Short Rest. With `apply`, each member who can still rest gets the Short Rest's benefits (as actor.rest) and the game clock moves an hour, which ends what runs out in that time as time.pass does; a member now at 0 hit points or in a running encounter gets nothing. Without it the rest is called off and no time passes.",
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
            ({ events, rested } = finishPartyShortRest(
              state,
              apply,
              kit.resolveDefinition,
              kit.equipmentCatalog(),
              (sides) => kit.context.random(sides)
            ));
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
      "GM-only: moves the game clock forward by hours and minutes. The clock is what the 16-hour rule between Long Rests reads; a party rest moves it too (8 hours for a Long Rest, 1 for a Short Rest). A round is 6 seconds, so 10 rounds make a minute: the time counts down every creature's effects (an effect measured in rounds loses 10 a minute, one measured in minutes or hours loses them, and one that lasts until a turn ends is over), and what runs out ends with its on-end grants, as at a turn boundary. A fight doesn't move the clock; a parked fight's combatants wait outside it. Each midnight it crosses moves the Codex calendar's date a day, and the players' date with it when the two were the same day. With `pace` the party travels for that time (SRD Travel Pace: 4, 3 or 2 miles an hour), and the log says how far it went and what the pace does to its checks.",
    summary: "Move game time forward by some hours and minutes.",
    schema: TimePassSchema,
    malformed: "Choose between 1 minute and 720 hours.",
    gmOnly: "Only the GM moves game time.",
    async run({ request, execute }, kit) {
      const minutes = (request.hours ?? 0) * 60 + (request.minutes ?? 0);
      const { pace } = request;
      let events: EffectNarration[] = [];
      const span: ClockSpan = { fromHours: 0, toHours: 0 };
      const { duplicate } = await execute((state) =>
        timed(
          state,
          () => {
            events = passTime(state, request.hours ?? 0, request.minutes ?? 0, {
              resolveDefinition: kit.resolveDefinition,
              catalog: kit.equipmentCatalog(),
              random: (sides) => kit.context.random(sides)
            });
          },
          span
        )
      );
      if (duplicate) return;
      if (span.toHours > span.fromHours) kit.context.onTimePassed?.(span);
      kit.context.appendLog({
        kind: "encounter",
        text: passedLine(minutes),
        gmOnly: false
      });
      if (pace) kit.context.appendLog({ kind: "encounter", text: travelLine(minutes / 60, pace), gmOnly: false });
      kit.publishNarrations(events);
    }
  }),

  defineCommand({
    type: "time.set-dawn",
    operationId: "setDawnHour",
    description:
      "GM-only: sets the hour of the day dawn comes on the game clock (0 to 23), or null. With an hour, what a magic item regains daily at dawn comes back as time.pass or a rest moves the clock past it, rolled with the server's dice, and a Long Rest leaves those charges to the dawn. With null, a Long Rest gives them back, as when nobody keeps the clock.",
    summary: "Set the hour dawn comes, or let a Long Rest stand in for it.",
    schema: TimeSetDawnSchema,
    malformed: "Choose an hour from 0 to 23, or none.",
    gmOnly: "Only the GM sets when dawn comes.",
    async run({ request, execute }, kit) {
      const { duplicate } = await execute((state) => {
        state.rest = { ...state.rest, dawnHour: request.hour };
      });
      if (duplicate) return;
      kit.context.appendLog({
        kind: "encounter",
        text:
          request.hour === null
            ? "Items regain their dawn charges at a Long Rest."
            : `Dawn comes at ${String(request.hour).padStart(2, "0")}:00.`,
        gmOnly: true
      });
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
  const miles = Math.round(hours * milesPerHour * 10) / 10;
  const name = pace[0]!.toUpperCase() + pace.slice(1);
  return `The party travels ${miles} ${miles === 1 ? "mile" : "miles"} at a ${name} pace, with ${effect} on the way.`;
}

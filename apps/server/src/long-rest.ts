import { isDead, type GameState, type PartyLongRest } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { requireActorAccess, requireGm, type Initiator } from "./authorization.js";
import type { EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import { clockMinutesOf, passGameTime } from "./game-time.js";

/**
 * The party's Long Rest as a span of game time (SRD 5.2.1 Rules Glossary, Long Rest): it opens when the GM starts it and
 * lasts until the GM finishes it, so what happens meanwhile can interrupt it. "A Long Rest is stopped by ... Rolling
 * Initiative; Casting a spell other than a cantrip; Taking any damage; 1 hour of walking or other physical exertion"
 * (`rest-interruptions.ts`, and the GM's interrupt for exertion). "If you rested at least 1 hour before the interruption,
 * you gain the benefits of a Short Rest", and "You can resume a Long Rest immediately after an interruption. If you do
 * so, the rest requires 1 additional hour per interruption to finish." Finishing it moves the clock to the end of the
 * longest rest still under way, and each member resting then gets the Long Rest.
 */

export const LONG_REST_MINUTES_SPAN = 8 * 60;
/** "If you rested at least 1 hour before the interruption". */
const SHORT_REST_EARNED_MINUTES = 60;

type Member = PartyLongRest["members"][number];

/** What applying a rest takes from the rest module, which this one can't import without a cycle. */
export type RestApplier = (
  state: GameState,
  actorId: string,
  kind: "long" | "short",
  options: Readonly<{ clockMoved: boolean; interrupted: boolean }>
) => EffectNarration[];

/** The member's own entry in the Long Rest under way. */
export const longRestMember = (state: GameState, actorId: string): Member | undefined =>
  state.rest.longRest?.members.find((member) => member.actorId === actorId);

function writeMembers(state: GameState, members: readonly Member[]): void {
  const rest = state.rest.longRest;
  if (!rest) return;
  state.rest = { ...state.rest, longRest: { ...rest, members: [...members] } };
}

/** The GM opens the party's Long Rest for these characters, whom the caller has checked can rest. */
export function openLongRest(state: GameState, actorIds: readonly string[]): void {
  if (state.rest.longRest) throw new CommandRejectedError("A Long Rest is already under way. Finish it first.");
  state.rest = {
    ...state.rest,
    longRest: {
      startedAt: clockMinutesOf(state),
      members: actorIds.map((actorId) => ({ actorId, interruptions: 0, interrupted: false, shortRestEarned: false }))
    }
  };
}

/**
 * Something stopped the Long Rest of these members (they rolled Initiative, took damage, cast a spell above a cantrip,
 * or the GM rules an hour of walking or exertion). Each waits interrupted until it resumes; one that rested an hour
 * first gets a Short Rest's benefits now (`apply`) and may spend Hit Point Dice while it waits.
 */
export function interruptLongRest(
  state: GameState,
  actorIds: ReadonlySet<string>,
  why: string,
  apply: RestApplier | null
): EffectNarration[] {
  const rest = state.rest.longRest;
  if (!rest) return [];
  const rested = clockMinutesOf(state) - rest.startedAt >= SHORT_REST_EARNED_MINUTES;
  const events: EffectNarration[] = [];
  const stopped: string[] = [];
  writeMembers(
    state,
    rest.members.map((member) => {
      if (!actorIds.has(member.actorId) || member.interrupted) return member;
      stopped.push(member.actorId);
      return { ...member, interrupted: true, shortRestEarned: rested };
    })
  );
  for (const actorId of stopped) {
    const actor = state.actors.find((candidate) => candidate.id === actorId);
    const name = actor?.name ?? "Someone";
    const earned = rested && actor !== undefined && actor.hp.current > 0 && !isDead(actor);
    events.push({
      kind: "effect",
      text: earned
        ? `${name} ${why}, which interrupts ${name}'s Long Rest. After an hour of rest, ${name} gets a Short Rest's benefits.`
        : `${name} ${why}, which interrupts ${name}'s Long Rest.`,
      actorId
    });
    if (earned && apply) events.push(...apply(state, actorId, "short", { clockMoved: true, interrupted: true }));
  }
  return events;
}

/** An interrupted member takes up its Long Rest again; it now needs an hour more for each interruption. Its player or
 *  the GM, out of any fight. */
export function resumeLongRest(state: GameState, actorId: string, scope: Initiator): string {
  requireActorAccess(scope, state, actorId, "resource");
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  const member = longRestMember(state, actorId);
  if (!member) throw new CommandRejectedError(`${actor.name} isn't in a Long Rest.`);
  if (!member.interrupted) throw new CommandRejectedError(`${actor.name}'s Long Rest is under way already.`);
  if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId))
    throw new CommandRejectedError(`End the fight before ${actor.name} rests again.`);
  if (isDead(actor) || actor.hp.current < 1)
    throw new CommandRejectedError(`${actor.name} has 0 Hit Points. A Long Rest needs at least 1.`);
  const interruptions = Math.min(24, member.interruptions + 1);
  writeMembers(
    state,
    state.rest.longRest!.members.map((entry) =>
      entry.actorId === actorId ? { ...entry, interrupted: false, shortRestEarned: false, interruptions } : entry
    )
  );
  return `${actor.name} goes back to resting. The Long Rest now takes ${8 + interruptions} hours.`;
}

/** The GM rules that a member spent an hour walking or in other physical exertion: its Long Rest is interrupted. */
export function interruptByGm(
  state: GameState,
  actorId: string,
  scope: Initiator,
  apply: RestApplier
): EffectNarration[] {
  requireGm(scope, "Only the GM says when a rest is interrupted.");
  const member = longRestMember(state, actorId);
  const name = state.actors.find((candidate) => candidate.id === actorId)?.name ?? "That character";
  if (!member) throw new CommandRejectedError(`${name} isn't in a Long Rest.`);
  if (member.interrupted) throw new CommandRejectedError(`${name}'s Long Rest is interrupted already.`);
  return interruptLongRest(state, new Set([actorId]), "spent an hour in physical exertion", apply);
}

/** The minutes from the rest's start each member still resting needs: 8 hours and 1 more per interruption. */
const neededMinutes = (member: Member) => LONG_REST_MINUTES_SPAN + member.interruptions * 60;

/**
 * The GM ends the party's Long Rest. With `apply`, the clock moves on to the end of the longest rest still under way
 * (what runs out in that time ends, as time.pass does) and each member resting then gets the Long Rest; an interrupted
 * member that didn't resume gets nothing more. Without, it is called off: each member still resting is interrupted, and
 * no time passes.
 */
export function finishLongRest(
  state: GameState,
  apply: boolean,
  applier: RestApplier,
  deps: Readonly<{
    resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
    catalog?: EquipmentCatalog;
    random?: (sides: number) => number;
  }>
): Readonly<{ events: EffectNarration[]; rested: string[]; hours: number }> {
  const rest = state.rest.longRest;
  if (!rest) throw new CommandRejectedError("No Long Rest is under way.");
  if (!apply) {
    const resting = new Set(rest.members.filter((member) => !member.interrupted).map((member) => member.actorId));
    const events = interruptLongRest(state, resting, "stopped resting", applier);
    state.rest = { ...state.rest, longRest: null };
    return { events, rested: [], hours: 0 };
  }
  const resting = rest.members.filter((member) => !member.interrupted);
  const end = rest.startedAt + Math.max(LONG_REST_MINUTES_SPAN, ...resting.map(neededMinutes));
  const before = clockMinutesOf(state);
  const events = passGameTime(
    state,
    Math.max(0, end - before),
    deps.random
      ? {
          resolveDefinition: deps.resolveDefinition,
          ...(deps.catalog ? { catalog: deps.catalog } : {}),
          random: deps.random
        }
      : undefined
  );
  state.rest = { ...state.rest, longRest: null };
  const rested: string[] = [];
  for (const member of resting) {
    const actor = state.actors.find((candidate) => candidate.id === member.actorId);
    if (!actor) continue;
    if (isDead(actor) || actor.hp.current < 1) {
      events.push({
        kind: "effect",
        text: `${actor.name} has 0 Hit Points, so the Long Rest gives nothing.`,
        actorId: actor.id
      });
      continue;
    }
    events.push(...applier(state, actor.id, "long", { clockMoved: true, interrupted: false }));
    rested.push(actor.name);
  }
  return { events, rested, hours: Math.round((clockMinutesOf(state) - before) / 6) / 10 };
}

import { isDead, longRestWait, makeHitDicePool, type GameState, type HitDiceEntry } from "@vtt/domain";
import type { Actor, ActorAction, ActorDefinition } from "@vtt/schemas";
import { abilityModifier as scoreModifier, collectRiders } from "@vtt/rules-5e";
import { pactSlotMaximum, spellSlotMaxima } from "./actor-roster.js";
import { CommandRejectedError } from "./game-store.js";
import { effectiveActions } from "./effective-actions.js";
import { deriveEquipment, type EquipmentCatalog, type EquipmentDerivation } from "./equipment-derivation.js";
import { endEffectsAtLongRest, reduceExhaustion, removeConditionDirect, type EffectNarration } from "./effects.js";
import { requireActorAccess, requireGm, type Initiator } from "./authorization.js";
import { openPreparation } from "./spellcasting.js";
import { healActor } from "./hit-points.js";
import { chargesAfterDawn } from "./item-charges.js";

/** SRD Resting: a Short Rest is 1 hour and a Long Rest at least 8. */
export const SHORT_REST_HOURS = 1;
export const LONG_REST_HOURS = 8;
/** The clock's ceiling, as the state schema bounds it. */
const CLOCK_LIMIT_HOURS = 10_000_000;

const hoursText = (hours: number) => `${hours} ${hours === 1 ? "hour" : "hours"}`;

/** Takes `count` dice off a multiclass pool, biggest die first (the order the roll uses). The caller has
 *  already checked the pool holds enough. */
function spendFromPool(entries: readonly HitDiceEntry[], count: number): HitDiceEntry[] {
  let left = count;
  return [...entries]
    .sort((a, b) => Number(b.die.slice(1)) - Number(a.die.slice(1)))
    .map((entry) => {
      const taken = Math.min(left, entry.remaining);
      left -= taken;
      return { ...entry, remaining: entry.remaining - taken };
    });
}

/** The sizes of the next `count` Hit Dice a pool spends, biggest first, matching `spendFromPool`: a
 *  Fighter 3 / Wizard 2 rolls d10s, then d6s. Short when the pool holds fewer. */
export function hitDieSizesToSpend(entries: readonly HitDiceEntry[], count: number): number[] {
  return [...entries]
    .sort((a, b) => Number(b.die.slice(1)) - Number(a.die.slice(1)))
    .flatMap((entry) => Array.from({ length: entry.remaining }, () => Number(entry.die.slice(1))))
    .slice(0, count);
}

/** Spends Hit Point Dice to heal (SRD 5.2.1 Short Rest): each die heals `face + Con modifier`, minimum 1.
 *  The caller rolls the faces before the store executes (so retries never reroll) and records them; this
 *  owns validation, healing (via healActor) and the pool decrement. */
export function spendHitDice(
  state: GameState,
  actorId: string,
  faces: readonly number[],
  scope: Initiator,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined,
  count: number = faces.length
): { healed: number; events: EffectNarration[]; conModifier: number } {
  requireActorAccess(scope, state, actorId, "resource");
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId))
    throw new CommandRejectedError("Hit Dice are spent on a rest - end the encounter first.");
  refuseRestAtZero(actor, "Hit Dice are spent on a Short Rest, which needs");
  if (!actor.hitDice)
    throw new CommandRejectedError(`${actor.name} has no Hit Dice pool (its stat block has no hit-point formula).`);
  if (actor.hitDice.remaining < count || faces.length < count)
    throw new CommandRejectedError(
      `${actor.name} has ${actor.hitDice.remaining} Hit ${actor.hitDice.remaining === 1 ? "Die" : "Dice"} left.`
    );
  const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
  const conModifier = definition ? scoreModifier(definition.abilityScores.con) : 0;
  const healed = faces.reduce((sum, face) => sum + Math.max(1, face + conModifier), 0);
  const events = healActor(state, actorId, healed, scope);
  // Decrement the pool, not a single counter: a Fighter 3 / Wizard 2 spends its d10s before its d6s.
  actor.hitDice = makeHitDicePool(spendFromPool(actor.hitDice.entries, faces.length));
  return { healed, events, conModifier };
}

/** SRD Resting: "To start a Short Rest [or a Long Rest], you must have at least 1 Hit Point", and nothing brings
 *  the dead back but a revival. `needs` finishes the refusal: what asks for that 1 Hit Point. */
function atZeroRefusal(actor: Actor, needs: string): string | null {
  if (isDead(actor)) return `${actor.name} is dead - a rest can't bring them back.`;
  if (actor.hp.current < 1) return `${actor.name} has 0 Hit Points - ${needs} at least 1. Heal them first.`;
  return null;
}

function refuseRestAtZero(actor: Actor, needs: string): void {
  const refusal = atZeroRefusal(actor, needs);
  if (refusal) throw new CommandRejectedError(refusal);
}

/** Why `actor` can't start this rest now, in words the table reads; null when it can. */
export function restRefusal(state: GameState, actor: Actor, kind: "long" | "short"): string | null {
  if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actor.id))
    return `End the encounter before resting ${actor.name}, who is in it.`;
  const atZero = atZeroRefusal(actor, `a ${kind === "long" ? "Long" : "Short"} Rest needs`);
  if (atZero) return atZero;
  const wait = kind === "long" ? longRestWait(actor.lastLongRestAt, state.rest.clockHours) : 0;
  if (wait === 0) return null;
  const since = state.rest.clockHours - (actor.lastLongRestAt ?? 0);
  const finished = since <= 0 ? "just finished a Long Rest" : `finished a Long Rest ${hoursText(since)} ago`;
  return `${actor.name} ${finished} - another can start in ${hoursText(wait)}.`;
}

/** The pools a Short Rest partly or wholly refills beyond their own recharge, from the `short-rest-regain` riders the
 *  character's features carry (Rage, Second Wind, Channel Divinity, Wild Shape: one use; Font of Inspiration: all).
 *  Read live, so a sheet built before a feature gained its rider gets it too. Two printings of one rule don't add. */
export function shortRestRegains(derivation: EquipmentDerivation): ReadonlyMap<string, number | "all"> {
  const regains = new Map<string, number | "all">();
  for (const rider of collectRiders(derivation.carriers, { ...derivation.context, moment: null })) {
    if (rider.modifier.type !== "short-rest-regain" || !rider.modifier.poolId) continue;
    const pool = rider.modifier.poolId;
    const amount = rider.modifier.amount ?? "all";
    const known = regains.get(pool);
    if (known === "all" || (typeof known === "number" && amount !== "all" && known >= amount)) continue;
    regains.set(pool, amount);
  }
  return regains;
}

/**
 * What is still spent after a Short Rest: short-rest and recharge pools come back, and so do pools that come back
 * when Initiative is rolled or on any rest (Boon of Fate's "until you roll Initiative or finish a Short or Long Rest");
 * a long-rest pool with a `short-rest-regain` rider gets that many uses back.
 */
function usesAfterShortRest(
  spent: Actor["actionUses"],
  actions: readonly ActorAction[],
  regains: ReadonlyMap<string, number | "all">
): Actor["actionUses"] {
  const after: Record<string, number> = { ...spent };
  const settled = new Set<string>();
  for (const action of actions) {
    if (!action.uses || action.uses.per === "turn") continue;
    const key = action.uses.pool ?? action.id;
    if (settled.has(key) || after[key] === undefined) continue;
    settled.add(key);
    const per = action.uses.per;
    const regain = regains.get(key);
    if (per === "short-rest" || per === "recharge" || per === "encounter" || regain === "all") delete after[key];
    else if (regain !== undefined) {
      const left = after[key] - regain;
      if (left > 0) after[key] = left;
      else delete after[key];
    }
  }
  return after;
}

/** Which re-choices a rest ends: a short rest clears those naming it; a long rest clears everything. */
function clearOverrides(overrides: Actor["choiceOverrides"], kind: "long" | "short"): Actor["choiceOverrides"] {
  if (kind === "long") return {};
  return Object.fromEntries(Object.entries(overrides).filter(([, override]) => override.per !== "short-rest"));
}

/** SRD Pact Magic: every expended pact slot comes back on a Short or Long Rest. */
function restorePactSlots(actor: Actor, definition: ActorDefinition | undefined): void {
  const maximum = actor.pactSlots ? pactSlotMaximum(definition) : null;
  if (actor.pactSlots && maximum) actor.pactSlots = { ...actor.pactSlots, remaining: maximum.max };
}

/**
 * Applies a rest to a rostered actor outside combat (SRD Resting, ADR-0020). Either needs at least 1 Hit Point, so
 * the dying and the dead get nothing from it, and a Long Rest waits 16 hours of game time after the last one.
 * Short: per-short-rest, recharge and per-encounter pools and Pact Magic slots re-arm, and long-rest pools a feature
 * partly refills (Rage's one use) get those uses back; healing is only by spending Hit Point Dice.
 * Long: Concentration and turn-measured effects end first (onEnd grants land), then HP to max, temp HP cleared, all
 * pools refreshed, all Hit Point Dice restored, Exhaustion drops one level. It counts as ending at the current game
 * hour; a party rest moves the clock past it. With `charges.random`, a charged item regains its printed dice rather
 * than every charge, and `charges.lines` hears what each regained.
 */
export function applyRest(
  state: GameState,
  actorId: string,
  kind: "long" | "short",
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined,
  catalog?: EquipmentCatalog,
  charges?: Readonly<{ random: (sides: number) => number; lines: string[] }>
): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  const refusal = restRefusal(state, actor, kind);
  if (refusal) throw new CommandRejectedError(refusal);
  const events: EffectNarration[] = [];
  if (kind === "short") {
    const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
    actor.actionUses = usesAfterShortRest(
      actor.actionUses,
      // Effective actions: a wand's charges live on a derived action and must re-arm too.
      effectiveActions(definition, actor, catalog),
      shortRestRegains(deriveEquipment(actor, definition, catalog))
    );
    // A pick re-made "whenever you finish a Short or Long Rest" lapses here; the build's own answer stands
    // until the character chooses again.
    actor.choiceOverrides = clearOverrides(actor.choiceOverrides, "short");
    restorePactSlots(actor, definition);
    return events;
  }
  // Eight hours of sleep: Concentration ends and turn-measured effects lapse; "until ended" ones (a curse) stay.
  events.push(...endEffectsAtLongRest(state, actorId));
  actor.hp.current = actor.hp.maximum;
  actor.hp.temporary = 0;
  // Every die size in the pool comes back, not just the largest (SRD 5.2.1 "Regain All HP").
  if (actor.hitDice)
    actor.hitDice = makeHitDicePool(actor.hitDice.entries.map((entry) => ({ ...entry, remaining: entry.maximum })));
  actor.deathSaves = null;
  removeConditionDirect(actor, "unconscious");
  const longRestDefinition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
  if (charges) {
    const dawn = chargesAfterDawn(actor, longRestDefinition, catalog, charges.random);
    actor.actionUses = dawn.stillSpent;
    charges.lines.push(...dawn.lines);
  } else actor.actionUses = {};
  // Both kinds lapse on a long rest.
  actor.choiceOverrides = clearOverrides(actor.choiceOverrides, "long");
  reduceExhaustion(actor);
  actor.lastLongRestAt = state.rest.clockHours;
  // Rested, by whatever path: nothing left to ask the GM for.
  state.rest = { ...state.rest, requests: state.rest.requests.filter((id) => id !== actorId) };
  // SRD long rest: spell slots (and Pact Magic) refill.
  // No spellcasting leaves these untouched.
  if (actor.spellSlots && longRestDefinition?.spellcasting) {
    // `spellSlotMaxima` covers derived multiclass tables and item-added slots, shared with seeding and the
    // spend clamp.
    const maxByLevel = new Map(
      spellSlotMaxima(longRestDefinition, deriveEquipment(actor, longRestDefinition, catalog).spellSlots).map(
        (entry) => [entry.level, entry.max] as const
      )
    );
    // A level the sheet no longer has (an older Warlock's pact row) goes; Pact Magic is its own pool.
    actor.spellSlots = actor.spellSlots
      .filter((slot) => maxByLevel.has(slot.level))
      .map((slot) => ({ ...slot, remaining: maxByLevel.get(slot.level)! }));
  }
  restorePactSlots(actor, longRestDefinition);
  // The prepared list stands; a caster that prepares after a Long Rest gets the step to change it.
  openPreparation(actor, longRestDefinition);
  return events;
}

/** A player asks for a Long Rest for their own character (the GM's approval gives it), or takes the ask back.
 *  Refused up front when the rest itself would be, so the player hears why at once. */
export function askForLongRest(state: GameState, actorId: string, withdraw: boolean, scope: Initiator): void {
  requireActorAccess(scope, state, actorId, "resource");
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  const others = state.rest.requests.filter((id) => id !== actorId);
  if (withdraw) {
    state.rest = { ...state.rest, requests: others };
    return;
  }
  const refusal = restRefusal(state, actor, "long");
  if (refusal) throw new CommandRejectedError(refusal);
  if (others.length !== state.rest.requests.length) return;
  if (others.length >= 50) throw new CommandRejectedError("Too many Long Rests are waiting for the GM.");
  state.rest = { ...state.rest, requests: [...others, actorId] };
}

/** The GM answers a Long Rest request: the rest happens now (the 16-hour rule and 1 Hit Point still apply), or the
 *  ask is turned down. */
export function answerLongRest(
  state: GameState,
  actorId: string,
  approve: boolean,
  scope: Initiator,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined,
  catalog?: EquipmentCatalog,
  random?: (sides: number) => number
): EffectNarration[] {
  requireGm(scope, "Only the GM answers a Long Rest request.");
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (!state.rest.requests.includes(actorId))
    throw new CommandRejectedError(`${actor.name} isn't waiting for a Long Rest.`);
  // The rest clears the request itself, so a refused one leaves it waiting.
  if (approve) return longRest(state, actorId, resolveDefinition, catalog, random);
  state.rest = { ...state.rest, requests: state.rest.requests.filter((id) => id !== actorId) };
  return [];
}

/** A Long Rest, with each charged item's dawn regain rolled on `random` and told as a line about the rester. */
function longRest(
  state: GameState,
  actorId: string,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined,
  random: ((sides: number) => number) | undefined
): EffectNarration[] {
  const lines: string[] = [];
  const events = applyRest(state, actorId, "long", resolveDefinition, catalog, random ? { random, lines } : undefined);
  return [...events, ...lines.map((text) => ({ kind: "effect" as const, text, actorId }))];
}

/**
 * The GM rests several characters together. Every one must be able to, or none rests: the refusal names who can't and
 * why. Long: each rests now and 8 hours pass. Short: the rest opens for each player to spend Hit Dice on their own
 * device, and `finishPartyShortRest` ends it.
 */
export function startPartyRest(
  state: GameState,
  actorIds: readonly string[],
  kind: "long" | "short",
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined,
  catalog?: EquipmentCatalog,
  random?: (sides: number) => number
): EffectNarration[] {
  if (kind === "short" && state.rest.shortRest)
    throw new CommandRejectedError("A Short Rest is already under way - finish it first.");
  const members = actorIds.map((actorId) => {
    const actor = state.actors.find((candidate) => candidate.id === actorId);
    if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
    return actor;
  });
  const refusals = members
    .map((actor) => restRefusal(state, actor, kind))
    .filter((refusal): refusal is string => refusal !== null);
  if (refusals.length > 0) throw new CommandRejectedError(refusals.join(" "));
  if (kind === "short") {
    state.rest = { ...state.rest, shortRest: { actorIds: [...actorIds], done: [] } };
    return [];
  }
  const events = members.flatMap((actor) => longRest(state, actor.id, resolveDefinition, catalog, random));
  const clockHours = Math.min(CLOCK_LIMIT_HOURS, state.rest.clockHours + LONG_REST_HOURS);
  state.rest = { ...state.rest, clockHours };
  for (const actor of members) actor.lastLongRestAt = clockHours;
  return events;
}

/** A member of the party's Short Rest is done spending Hit Dice (or not after all). Their player or the GM. */
export function markShortRestDone(state: GameState, actorId: string, done: boolean, scope: Initiator): void {
  requireActorAccess(scope, state, actorId, "resource");
  const rest = state.rest.shortRest;
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (!rest?.actorIds.includes(actorId)) throw new CommandRejectedError(`${actor.name} isn't in a Short Rest.`);
  const others = rest.done.filter((id) => id !== actorId);
  state.rest = { ...state.rest, shortRest: { ...rest, done: done ? [...others, actorId] : others } };
}

/**
 * Ends the party's Short Rest. With `apply`, each member who can still rest gets its benefits and an hour passes;
 * anyone who can't any more (down, or pulled into a fight) gets nothing and a line saying why. Without, it is called
 * off and no time passes.
 */
export function finishPartyShortRest(
  state: GameState,
  apply: boolean,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined,
  catalog?: EquipmentCatalog
): Readonly<{ events: EffectNarration[]; rested: string[] }> {
  const rest = state.rest.shortRest;
  if (!rest) throw new CommandRejectedError("No Short Rest is under way.");
  state.rest = { ...state.rest, shortRest: null };
  if (!apply) return { events: [], rested: [] };
  const events: EffectNarration[] = [];
  const rested: string[] = [];
  for (const actorId of rest.actorIds) {
    const actor = state.actors.find((candidate) => candidate.id === actorId);
    if (!actor) continue;
    if (restRefusal(state, actor, "short")) {
      const inFight = state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId);
      const why = inFight ? "is in a fight" : isDead(actor) ? "is dead" : "has 0 Hit Points";
      events.push({ kind: "effect", text: `${actor.name} ${why}, so the Short Rest gives them nothing.`, actorId });
      continue;
    }
    events.push(...applyRest(state, actorId, "short", resolveDefinition, catalog));
    rested.push(actor.name);
  }
  state.rest = { ...state.rest, clockHours: Math.min(CLOCK_LIMIT_HOURS, state.rest.clockHours + SHORT_REST_HOURS) };
  return { events, rested };
}

/** The GM moves game time forward. */
export function passTime(state: GameState, hours: number): void {
  state.rest = { ...state.rest, clockHours: Math.min(CLOCK_LIMIT_HOURS, state.rest.clockHours + hours) };
}

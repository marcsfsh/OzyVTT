import { openFormSwap } from "./transform/known-forms.js";
import { isDead, longRestWait, makeHitDicePool, type GameState, type HitDiceEntry } from "@vtt/domain";
import type { Actor, ActorAction, ActorDefinition } from "@vtt/schemas";
import { abilityModifier as scoreModifier, collectRiders } from "@vtt/rules-5e";
import { pactSlotMaximum, spellSlotMaxima } from "./actor-roster.js";
import { holdsFeature } from "./class-features.js";
import { CommandRejectedError } from "./game-store.js";
import { effectiveActions } from "./effective-actions.js";
import { deriveEquipment, type EquipmentCatalog, type EquipmentDerivation } from "./equipment-derivation.js";
import {
  endEffectsAtLongRest,
  endEffectsAtRest,
  LONG_REST_MINUTES,
  reduceExhaustion,
  removeConditionDirect,
  type EffectNarration
} from "./effects.js";
import { passGameTime } from "./game-time.js";
import { dawnPoolKeys, timedSpent, type ClockDeps } from "./clock-pools.js";
import { requireActorAccess, requireGm, type Initiator } from "./authorization.js";
import { openPreparation } from "./spellcasting.js";
import { healActor, RELENTLESS_RAGE_KEY } from "./hit-points.js";
import { gainHeroicInspiration } from "./heroic-inspiration.js";
import { chargesAfterDawn, neverRegained } from "./item-charges.js";

/** SRD Resting: a Short Rest is 1 hour and a Long Rest at least 8. */
export const SHORT_REST_HOURS = 1;
export const LONG_REST_HOURS = 8;

const hoursText = (hours: number) => `${hours} ${hours === 1 ? "hour" : "hours"}`;

/** Takes `count` dice off a multiclass pool, biggest die first (the order the roll uses). The caller has
 *  already checked the pool holds enough. */
export function spendFromPool(entries: readonly HitDiceEntry[], count: number): HitDiceEntry[] {
  let left = count;
  return [...entries]
    .sort((a, b) => Number(b.die.slice(1)) - Number(a.die.slice(1)))
    .map((entry) => {
      const taken = Math.min(left, entry.remaining);
      left -= taken;
      return { ...entry, remaining: entry.remaining - taken };
    });
}

/** The sizes of the next `count` Hit Dice a pool spends, biggest first as `spendFromPool` spends them: a
 *  Fighter 3 / Wizard 2 rolls d10s, then d6s. Short when the pool holds fewer. */
export function hitDieSizesToSpend(entries: readonly HitDiceEntry[], count: number): number[] {
  return [...entries]
    .sort((a, b) => Number(b.die.slice(1)) - Number(a.die.slice(1)))
    .flatMap((entry) => Array.from({ length: entry.remaining }, () => Number(entry.die.slice(1))))
    .slice(0, count);
}

/** Whether `actorId` is in the Short Rest under way (the party's, or one its player started). */
export const inShortRest = (state: GameState, actorId: string) =>
  state.rest.shortRest?.actorIds.includes(actorId) ?? false;

/** Spends Hit Point Dice to heal (SRD 5.2.1 Short Rest): each die heals `face + Con modifier`, minimum 1.
 *  "A creature can spend Hit Dice during a Short Rest", so a player spends them only while their character is in the
 *  Short Rest under way; the GM resting a creature spends them for it outside a fight.
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
    throw new CommandRejectedError("Hit Dice are spent on a rest. End the fight first.");
  if (scope.role !== "gm" && !inShortRest(state, actorId))
    throw new CommandRejectedError(
      `Hit Point Dice are spent during a Short Rest. Start one for ${actor.name} first, and spend them before it ends.`
    );
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
  // Decrement the pool die by die: a Fighter 3 / Wizard 2 spends its d10s before its d6s.
  actor.hitDice = makeHitDicePool(spendFromPool(actor.hitDice.entries, faces.length));
  return { healed, events, conModifier };
}

/** SRD Resting: "To start a Short Rest [or a Long Rest], you must have at least 1 Hit Point", and nothing brings
 *  the dead back but a revival. `needs` finishes the refusal: what asks for that 1 Hit Point. */
function atZeroRefusal(actor: Actor, needs: string): string | null {
  if (isDead(actor)) return `${actor.name} is dead, and a rest can't bring ${actor.name} back.`;
  if (actor.hp.current < 1) return `${actor.name} has 0 Hit Points. ${needs} at least 1. Heal ${actor.name} first.`;
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
  const atZero = atZeroRefusal(actor, `A ${kind === "long" ? "Long" : "Short"} Rest needs`);
  if (atZero) return atZero;
  const wait = kind === "long" ? longRestWait(actor.lastLongRestAt, state.rest.clockHours) : 0;
  if (wait === 0) return null;
  const since = state.rest.clockHours - (actor.lastLongRestAt ?? 0);
  const finished = since <= 0 ? "finished a Long Rest moments ago" : `finished a Long Rest ${hoursText(since)} ago`;
  return `${actor.name} ${finished}. Another can start in ${hoursText(wait)}.`;
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
 * Long: Concentration ends first (onEnd grants land), then HP to max, temp HP cleared, all pools refreshed, all Hit
 * Point Dice restored, Exhaustion drops one level. It counts as ending at the current game hour.
 * A Long Rest ends the creature's own effects that would run out in its eight hours. When the game clock moved them
 * for everyone already (`clockMoved`: a party rest) that has happened; otherwise what lasts longer waits for the GM to
 * pass the hours. A Short Rest leaves effects to the clock: a player takes one on their own, and only the GM moves game
 * time (the party's Short Rest moves it an hour). With `charges.random`, a
 * charged item regains its printed dice rather than every charge, and `charges.lines` hears what each regained.
 */
export function applyRest(
  state: GameState,
  actorId: string,
  kind: "long" | "short",
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined,
  catalog?: EquipmentCatalog,
  charges?: Readonly<{ random: (sides: number) => number; lines: string[] }>,
  clockMoved = false
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
    // SRD Relentless Rage: "When you finish a Short or Long Rest, the DC resets to 10."
    const { [RELENTLESS_RAGE_KEY]: _relentless, ...uses } = actor.actionUses;
    actor.actionUses = uses;
    // A pick re-made on a rest stands until the character chooses again (Fiendish Resilience: "until you choose a
    // different one"), so the rest leaves `choiceOverrides` as they are.
    restorePactSlots(actor, definition);
    // SRD Tireless: "Whenever you finish a Short Rest, your Exhaustion level, if any, also decreases by 1."
    if (holdsFeature(definition, "tireless", "Tireless")) reduceExhaustion(actor);
    events.push(...endEffectsAtRest(state, actorId, "short"));
    // SRD Memorize Spell (Wizard 5): "Whenever you finish a Short Rest, you can study your spellbook and replace one of
    // the level 1+ Wizard spells you have prepared ... with another level 1+ spell from the book": one change.
    if (actor.preparation === null && holdsFeature(definition, "memorize-spell", "Memorize Spell"))
      actor.preparation = { changesLeft: 1 };
    // What a feature does "when you finish a Short Rest" (Arcane Recovery, a re-choice) is made in the step this opens.
    actor.restStep = { after: "short-rest" };
    return events;
  }
  // Eight hours with sleep: Concentration ends and what lasts less runs out; "until ended" ones (a curse) stay.
  events.push(...endEffectsAtLongRest(state, actorId, clockMoved), ...endEffectsAtRest(state, actorId, "long"));
  actor.hp.current = actor.hp.maximum;
  actor.hp.temporary = 0;
  // Every die size in the pool comes back (SRD 5.2.1 "Regain All HP").
  if (actor.hitDice)
    actor.hitDice = makeHitDicePool(actor.hitDice.entries.map((entry) => ({ ...entry, remaining: entry.maximum })));
  actor.deathSaves = null;
  removeConditionDirect(actor, "unconscious");
  const longRestDefinition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
  // A pool spent for a time waits on the clock, not the rest (a Horn of Valhalla's 7 days); with a dawn hour, what
  // an item regains at dawn waits for the clock's dawn too.
  const waiting: Record<string, number> = timedSpent(actor);
  if (state.rest.dawnHour !== null)
    for (const key of dawnPoolKeys(actor, longRestDefinition, catalog))
      if ((actor.actionUses[key] ?? 0) > 0) waiting[key] = actor.actionUses[key]!;
  if (charges && state.rest.dawnHour === null) {
    const dawn = chargesAfterDawn(actor, longRestDefinition, catalog, charges.random);
    actor.actionUses = { ...dawn.stillSpent, ...waiting };
    charges.lines.push(...dawn.lines);
  } else actor.actionUses = { ...neverRegained(actor, longRestDefinition, catalog), ...waiting };
  reduceExhaustion(actor);
  actor.lastLongRestAt = state.rest.clockHours;
  // Rested, by whatever path: nothing left to ask the GM for.
  state.rest = { ...state.rest, requests: state.rest.requests.filter((id) => id !== actorId) };
  // SRD Long Rest: spell slots (and Pact Magic) refill.
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
  // SRD Wild Shape: "Whenever you finish a Long Rest, you can replace one of your known forms."
  openFormSwap(actor);
  actor.restStep = { after: "long-rest" };
  // SRD Human, Resourceful: "You gain Heroic Inspiration whenever you finish a Long Rest." One at most.
  if (
    holdsFeature(longRestDefinition, "human-resourceful", "Resourceful") ||
    longRestDefinition?.character?.race?.id === "human"
  )
    gainHeroicInspiration(actor);
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
  random: ((sides: number) => number) | undefined,
  clockMoved = false
): EffectNarration[] {
  const lines: string[] = [];
  const events = applyRest(
    state,
    actorId,
    "long",
    resolveDefinition,
    catalog,
    random ? { random, lines } : undefined,
    clockMoved
  );
  return [...events, ...lines.map((text) => ({ kind: "effect" as const, text, actorId }))];
}

/**
 * The GM rests several characters together. Every one must be able to, or none rests: the refusal names who can't and
 * why. Long: 8 hours pass on the game clock for everyone (what runs out in them ends), and each rests. Short: the rest
 * opens for each player to spend Hit Dice on their own device, and `finishPartyShortRest` ends it.
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
    throw new CommandRejectedError("A Short Rest is already under way. Finish it first.");
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
  const events = passGameTime(
    state,
    LONG_REST_MINUTES,
    random ? { resolveDefinition, ...(catalog ? { catalog } : {}), random } : undefined
  );
  events.push(...members.flatMap((actor) => longRest(state, actor.id, resolveDefinition, catalog, random, true)));
  for (const actor of members) actor.lastLongRestAt = state.rest.clockHours;
  return events;
}

/** A player starts a Short Rest for their own character. It is under way, as the party's is: its player spends Hit
 *  Point Dice during it and marks it done, and the GM ends it, when its benefits land and an hour passes. A Short
 *  Rest already under way takes the character in. Returns whether it joined one. */
export function startOwnShortRest(state: GameState, actorId: string, scope: Initiator): boolean {
  requireActorAccess(scope, state, actorId, "resource");
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  const refusal = restRefusal(state, actor, "short");
  if (refusal) throw new CommandRejectedError(refusal);
  const rest = state.rest.shortRest;
  if (rest?.actorIds.includes(actorId)) throw new CommandRejectedError(`${actor.name} is already in the Short Rest.`);
  if (rest && rest.actorIds.length >= 12) throw new CommandRejectedError("The Short Rest under way is full.");
  state.rest = {
    ...state.rest,
    shortRest: rest ? { ...rest, actorIds: [...rest.actorIds, actorId] } : { actorIds: [actorId], done: [] }
  };
  return rest !== null;
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
 * Ends the party's Short Rest. With `apply`, each member who can still rest gets its benefits and an hour passes on
 * the game clock for everyone; anyone who can't any more (down, or pulled into a fight) gets nothing and a line saying
 * why. Without, it is called off and no time passes.
 */
export function finishPartyShortRest(
  state: GameState,
  apply: boolean,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined,
  catalog?: EquipmentCatalog,
  random?: (sides: number) => number
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
    events.push(...applyRest(state, actorId, "short", resolveDefinition, catalog, undefined, true));
    rested.push(actor.name);
  }
  events.push(
    ...passGameTime(
      state,
      SHORT_REST_HOURS * 60,
      random ? { resolveDefinition, ...(catalog ? { catalog } : {}), random } : undefined
    )
  );
  return { events, rested };
}

/** The GM moves game time forward by hours and minutes, and what runs out in that time ends (`passGameTime`); with
 *  `deps`, what comes back on the clock does too. */
export function passTime(state: GameState, hours: number, minutes = 0, deps?: ClockDeps): EffectNarration[] {
  return passGameTime(state, hours * 60 + minutes, deps);
}

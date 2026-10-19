import { isDead, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { requireActorAccess, requireGm, type Initiator } from "./authorization.js";
import { holdsFeature } from "./class-features.js";
import { exhaustionLevel } from "./condition-rules.js";
import { applyCondition, conditionGained, GOODBERRY_ID, type EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import { healActor } from "./hit-points.js";
import { rollSaveAtOnce } from "./saving-throws.js";

/**
 * Food and water by the day (SRD 5.2.1 Rules Glossary, Malnutrition and Dehydration), while the table tracks them. A
 * character records what it eats and drinks during the day (a meal, a Goodberry, its fill at a stream); as the day ends
 * it eats the Rations and drinks from the Waterskins it carries, as far as its need goes, and what it still lacks costs
 * it: less than half its water is a level of Exhaustion, less than half its food a DC 10 Constitution save against
 * one, and five days with no food a level each day. Levels gained so stay until it eats or drinks its full need.
 */

type Actor = GameState["actors"][number];
type Nourishment = NonNullable<Actor["nourishment"]>;
type Size = NonNullable<Actor["size"]>;

/** Food a day, in pounds, by size. */
const FOOD_POUNDS: Readonly<Record<Size, number>> = {
  tiny: 0.25,
  small: 1,
  medium: 1,
  large: 4,
  huge: 16,
  gargantuan: 64
};
/** Water a day, in pints (a gallon is 8), by size. */
const WATER_PINTS: Readonly<Record<Size, number>> = {
  tiny: 2,
  small: 8,
  medium: 8,
  large: 32,
  huge: 128,
  gargantuan: 512
};
/** "A Waterskin holds up to 4 pints." */
export const WATERSKIN_PINTS = 4;
/** "Rations (1 day)": a day of food for a Small or Medium creature. */
const RATION_POUNDS = 1;
/** "Must succeed on a DC 10 Constitution saving throw or gain 1 Exhaustion level". */
const MALNUTRITION_DC = 10;
/** "A creature that eats nothing for 5 days automatically gains 1 Exhaustion level at the end of the fifth day". */
const DAYS_BEFORE_STARVING = 5;

export const DAY_MINUTES = 24 * 60;

/** The inventory rows survival reads, by catalog id. */
export const RATIONS_ID = "rations";
export const WATERSKIN_ID = "waterskin";
/** SRD Bead of Nourishment: it "provides as much nourishment as 1 day of Rations". */
export const BEAD_OF_NOURISHMENT_ID = "bead-of-nourishment";

/** What one day of eating and drinking starts from. */
export const freshNourishment = (): Nourishment => ({
  foodPounds: 0,
  waterPints: 0,
  daysUnfed: 0,
  hungerLevels: 0,
  thirstLevels: 0
});

/** A creature's food (pounds) and water (pints) for a day. */
export function needsOf(actor: Pick<Actor, "size">): Readonly<{ food: number; water: number }> {
  const size = actor.size ?? "medium";
  return { food: FOOD_POUNDS[size], water: WATER_PINTS[size] };
}

/** Whether the table tracks this creature's food and water: a character, while survival is on. */
const tracked = (state: GameState, actor: Actor) =>
  state.rest.survival && actor.kind === "player-character" && !actor.archived;

/** The GM starts or stops tracking food and water: each character starts a fresh day, or its record goes. */
export function setSurvivalTracking(state: GameState, enabled: boolean, scope: Initiator): void {
  requireGm(scope, "Only the GM decides whether food and water are tracked.");
  state.rest = { ...state.rest, survival: enabled };
  for (const actor of state.actors) {
    if (actor.kind !== "player-character") continue;
    if (enabled) actor.nourishment ??= freshNourishment();
    else delete actor.nourishment;
  }
}

/** Takes up to `count` from the creature's rows of `id`; returns how many it took. */
function useUp(actor: Actor, id: string, count: number): number {
  let left = count;
  actor.inventory = actor.inventory
    .map((row) => {
      if (left <= 0 || (row.recordId ?? row.id) !== id || row.quantity <= 0) return row;
      const taken = Math.min(left, row.quantity);
      left -= taken;
      return { ...row, quantity: row.quantity - taken };
    })
    .filter((row) => (row.recordId ?? row.id) !== id || row.quantity > 0);
  return count - left;
}

/** The water a Waterskin row still holds, in pints. */
const pintsIn = (row: Actor["inventory"][number]) => row.waterPints ?? row.quantity * WATERSKIN_PINTS;

/** Drinks up to `pints` from the creature's Waterskins; returns the pints drunk. */
function drinkFromSkins(actor: Actor, pints: number): number {
  let wanted = pints;
  actor.inventory = actor.inventory.map((row) => {
    if (wanted <= 0 || (row.recordId ?? row.id) !== WATERSKIN_ID) return row;
    const drunk = Math.min(wanted, pintsIn(row));
    wanted -= drunk;
    return drunk > 0 ? { ...row, waterPints: pintsIn(row) - drunk } : row;
  });
  return pints - wanted;
}

/** Fills every Waterskin the creature carries. */
function fillSkins(actor: Actor): void {
  actor.inventory = actor.inventory.map((row) => {
    if ((row.recordId ?? row.id) !== WATERSKIN_ID || row.waterPints === undefined) return row;
    const { waterPints: _empty, ...full } = row;
    return full;
  });
}

/** What a character eats or drinks now. A meal (Create Food and Water, Heroes' Feast, an inn's) or a Goodberry ("enough
 *  nourishment to sustain a creature for one day") meets the day's food; a ration is a day's for a Small or Medium
 *  creature; drinking one's fill at a source meets the day's water and fills the Waterskins carried. */
export type Nourish = Readonly<{
  food?: "meal" | "ration" | "goodberry" | "bead";
  water?: "fill" | "waterskin";
}>;

/** A character eats or drinks: its player for their own from what it carries, the GM for anyone and from anywhere. A
 *  Goodberry also restores 1 Hit Point, and
 *  is the one thing eaten in a fight: on the eater's turn, for its Bonus Action. Without tracking, only a Goodberry. */
export function nourish(state: GameState, actorId: string, choice: Nourish, scope: Initiator): EffectNarration[] {
  if (!choice.food && !choice.water) throw new CommandRejectedError("Say what the character eats or drinks.");
  const berryOnly = choice.food === "goodberry" && !choice.water;
  if (!state.rest.survival && !berryOnly) throw new CommandRejectedError("The table isn't tracking food and water.");
  requireActorAccess(scope, state, actorId, "resource", "You can only feed your own character.");
  // Food and water from nothing the character carries (a meal, a stream) are the GM's to give.
  if (scope.role !== "gm" && (choice.food === "meal" || choice.water === "fill"))
    throw new CommandRejectedError("A meal or a drink at a source is the GM's to give. Ask the GM.");
  const actor = state.actors.find((candidate) => candidate.id === actorId)!;
  if (actor.kind !== "player-character" && !berryOnly)
    throw new CommandRejectedError("Only characters track food and water.");
  if (isDead(actor)) throw new CommandRejectedError(`${actor.name} is dead.`);
  const fighting = state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actor.id);
  if (fighting) {
    if (!berryOnly) throw new CommandRejectedError("Eat and drink between fights; a Goodberry is the exception.");
    if (state.combat.turnActorId !== actor.id)
      throw new CommandRejectedError(`Eating a Goodberry takes ${actor.name}'s Bonus Action, on its own turn.`);
    if (state.combat.turn.bonusActionUsed)
      throw new CommandRejectedError(`${actor.name} has used its Bonus Action this turn.`);
  }
  const need = needsOf(actor);
  const today = { ...(actor.nourishment ?? freshNourishment()) };
  const events: EffectNarration[] = [];
  const said: string[] = [];
  if (choice.food === "ration") {
    if (useUp(actor, RATIONS_ID, 1) === 0) throw new CommandRejectedError(`${actor.name} carries no Rations.`);
    today.foodPounds += RATION_POUNDS;
    said.push("eats a day's Rations");
  } else if (choice.food === "bead") {
    if (useUp(actor, BEAD_OF_NOURISHMENT_ID, 1) === 0)
      throw new CommandRejectedError(`${actor.name} carries no Bead of Nourishment.`);
    today.foodPounds += RATION_POUNDS;
    said.push("eats a Bead of Nourishment");
  } else if (choice.food === "goodberry") {
    if (useUp(actor, GOODBERRY_ID, 1) === 0) throw new CommandRejectedError(`${actor.name} carries no Goodberry.`);
    today.foodPounds = Math.max(today.foodPounds, need.food);
    said.push("eats a Goodberry");
    events.push(...healActor(state, actor.id, 1, { role: "gm" }));
  } else if (choice.food === "meal") {
    today.foodPounds = Math.max(today.foodPounds, need.food);
    said.push("eats a full meal");
  }
  if (choice.water === "waterskin") {
    const drunk = drinkFromSkins(actor, Math.max(0, need.water - today.waterPints));
    if (drunk === 0)
      throw new CommandRejectedError(
        today.waterPints >= need.water ? `${actor.name} has drunk enough today.` : `${actor.name} has no water left.`
      );
    today.waterPints += drunk;
    said.push(`drinks ${drunk} ${drunk === 1 ? "pint" : "pints"} from a Waterskin`);
  } else if (choice.water === "fill") {
    today.waterPints = Math.max(today.waterPints, need.water);
    fillSkins(actor);
    said.push("drinks its fill and fills its Waterskins");
  }
  if (fighting) state.combat = { ...state.combat, turn: { ...state.combat.turn, bonusActionUsed: true } };
  // Eating or drinking the full amount lets a rest take off what hunger or thirst gave.
  if (today.foodPounds >= need.food) today.hungerLevels = 0;
  if (today.waterPints >= need.water) today.thirstLevels = 0;
  if (tracked(state, actor)) actor.nourishment = today;
  return [{ kind: "effect", text: `${actor.name} ${said.join(" and ")}.`, actorId: actor.id }, ...events];
}

export type DayEndDeps = Readonly<{
  random: (sides: number) => number;
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
}>;

/** One Exhaustion level from hunger or thirst, with what it says; Exhaustion 6 kills. Returns whether it landed. */
function gainLevel(state: GameState, actor: Actor, why: string, events: EffectNarration[]): boolean {
  const before = exhaustionLevel(actor);
  if (applyCondition(actor, "exhaustion") !== "applied") return false;
  events.push({ kind: "condition", text: `${actor.name} gains a level of Exhaustion (${why}).`, actorId: actor.id });
  events.push(...conditionGained(state, actor, "exhaustion", before));
  return true;
}

/** The end of a game day for one character: it eats and drinks what it carries, then pays for what it lacked. */
function endDayFor(state: GameState, actor: Actor, deps: DayEndDeps): EffectNarration[] {
  const today = { ...(actor.nourishment ?? freshNourishment()) };
  const need = needsOf(actor);
  const events: EffectNarration[] = [];
  const meals: string[] = [];
  if (today.foodPounds < need.food) {
    const eaten = useUp(actor, RATIONS_ID, Math.ceil((need.food - today.foodPounds) / RATION_POUNDS));
    if (eaten > 0) {
      today.foodPounds += eaten * RATION_POUNDS;
      meals.push(`eats ${eaten === 1 ? "a day's Rations" : `${eaten} days' Rations`}`);
    }
  }
  // A Bead of Nourishment is as much as a day of Rations, eaten once the Rations run out.
  if (today.foodPounds < need.food) {
    const beads = useUp(actor, BEAD_OF_NOURISHMENT_ID, Math.ceil((need.food - today.foodPounds) / RATION_POUNDS));
    if (beads > 0) {
      today.foodPounds += beads * RATION_POUNDS;
      meals.push(`eats ${beads === 1 ? "a Bead of Nourishment" : `${beads} Beads of Nourishment`}`);
    }
  }
  if (today.waterPints < need.water) {
    const drunk = drinkFromSkins(actor, need.water - today.waterPints);
    if (drunk > 0) {
      today.waterPints += drunk;
      meals.push(`drinks ${drunk} ${drunk === 1 ? "pint" : "pints"} from its Waterskins`);
    }
  }
  if (meals.length > 0)
    events.push({ kind: "effect", text: `${actor.name} ${meals.join(" and ")}.`, actorId: actor.id });
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  // SRD Self-Restoration (Monk 10): "Forgoing food and drink doesn't give you levels of Exhaustion."
  const spared = holdsFeature(definition, "self-restoration", "Self-Restoration");
  today.daysUnfed = today.foodPounds > 0 ? 0 : today.daysUnfed + 1;
  if (today.waterPints >= need.water) today.thirstLevels = 0;
  else if (today.waterPints < need.water / 2 && !spared && gainLevel(state, actor, "too little water", events))
    today.thirstLevels = Math.min(6, today.thirstLevels + 1);
  if (today.foodPounds >= need.food) today.hungerLevels = 0;
  else if (!spared && today.foodPounds === 0 && today.daysUnfed >= DAYS_BEFORE_STARVING) {
    if (gainLevel(state, actor, `${today.daysUnfed} days without food`, events))
      today.hungerLevels = Math.min(6, today.hungerLevels + 1);
  } else if (!spared && today.foodPounds > 0 && today.foodPounds < need.food / 2) {
    const save = rollSaveAtOnce(state, actor, "con", {
      resolveDefinition: deps.resolveDefinition,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      rollDie: deps.random
    });
    const kept = save.total >= MALNUTRITION_DC;
    events.push({
      kind: "effect",
      text: `${actor.name} ate too little today: DC ${MALNUTRITION_DC} CON save, ${save.total} (d20 ${save.natural}), ${kept ? "a success" : "a failure"}.`,
      actorId: actor.id
    });
    if (!kept && gainLevel(state, actor, "too little food", events))
      today.hungerLevels = Math.min(6, today.hungerLevels + 1);
  }
  actor.nourishment = { ...today, foodPounds: 0, waterPints: 0 };
  return events;
}

/** Each game day that ends between `fromMinute` and `toMinute` (each midnight the clock crosses), for every tracked
 *  character in time. */
export function endOfDays(
  state: GameState,
  actorIds: ReadonlySet<string>,
  fromMinute: number,
  toMinute: number,
  deps: DayEndDeps
): EffectNarration[] {
  if (!state.rest.survival) return [];
  const days = Math.floor(toMinute / DAY_MINUTES) - Math.floor(fromMinute / DAY_MINUTES);
  const events: EffectNarration[] = [];
  for (let day = 0; day < days; day += 1)
    for (const actor of state.actors)
      if (actorIds.has(actor.id) && tracked(state, actor) && !isDead(actor))
        events.push(...endDayFor(state, actor, deps));
  return events;
}

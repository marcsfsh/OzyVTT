import type { GameState } from "@vtt/domain";
import type { ActorDefinition, Swallow } from "@vtt/schemas";
import { addEffect, applyCondition, endEffect, makeEffect, type EffectNarration } from "./effects.js";
import { createPendingSaves } from "./pending-saves.js";

/** A stat block's swallow, by what it says of the swallower's death: "If the worm dies, a swallowed creature is no
 *  longer Restrained by it and can escape from the corpse by using 20 feet of movement, exiting Prone." */
const ESCAPE = /escape from the corpse (?:by )?using (\d+) feet of movement/i;

/**
 * A dead or departed swallower lets go of what it swallowed: each creature its swallow holds is no longer Restrained
 * or Blinded by it, and climbs out of the corpse with the movement the stat block names and lands Prone. On that
 * creature's own turn the movement comes out of the turn's; otherwise out of its next turn, as Speed lost until that
 * turn ends.
 */
export function releaseSwallowedBy(
  state: GameState,
  swallowerId: string,
  definition: ActorDefinition | undefined
): EffectNarration[] {
  const events: EffectNarration[] = [];
  const swallower = state.actors.find((actor) => actor.id === swallowerId);
  // Read the stat block only when something of its holds on: callers pass whatever definition the defeated has.
  const held = state.actors.flatMap((prey) =>
    prey.effects
      .filter((effect) => effect.sourceActorId === swallowerId && effect.sourceActionId)
      .map((effect) => ({ prey, effect }))
  );
  if (!swallower || !definition || held.length === 0) return events;
  for (const { prey, effect } of held) {
    const action = definition.actions.find((candidate) => candidate.id === effect.sourceActionId);
    const escape = action ? ESCAPE.exec(action.description) : null;
    if (!escape) continue;
    const feet = Number.parseInt(escape[1]!, 10);
    events.push(...endEffect(state, prey.id, effect.id));
    applyCondition(prey, "prone");
    if (state.combat.active && state.combat.turnActorId === prey.id)
      state.combat = {
        ...state.combat,
        turn: { ...state.combat.turn, movementUsedFeet: state.combat.turn.movementUsedFeet + feet }
      };
    else if (state.combat.active)
      addEffect(
        state,
        prey.id,
        makeEffect({
          id: `${effect.id}:escape`,
          name: `Climbing out of ${swallower.name}`,
          tags: ["escaping-corpse"],
          sourceActorId: prey.id,
          sourceName: prey.name,
          startedRound: state.combat.round,
          duration: { type: "until-bearer-turn-end", skipsCurrentTurn: false },
          modifiers: [{ type: "speed", amount: -feet }]
        })
      );
    events.push({
      kind: "effect",
      text: `${prey.name} climbs out of ${swallower.name}, using ${feet} feet of movement, and lands Prone.`,
      actorId: prey.id,
      // The table's copy masks a swallower it can't see.
      source: { actorId: swallowerId, name: swallower.name }
    });
  }
  return events;
}

/** The tag on a swallowed creature's effect, which its swallower sources. */
export const SWALLOWED_TAG = "swallowed";
/** The turn's tally of damage a swallower took from creatures inside it. */
const FROM_INSIDE = "damage-from-inside";

type Actor = GameState["actors"][number];
type Swallowing = Readonly<{ prey: Actor; effect: Actor["effects"][number] }>;

/** The creatures a swallower holds, each with the effect that holds it. */
export function swallowedBy(state: GameState, swallowerId: string): Swallowing[] {
  return state.actors.flatMap((prey) =>
    prey.effects
      .filter((effect) => effect.sourceActorId === swallowerId && effect.tags.includes(SWALLOWED_TAG))
      .map((effect) => ({ prey, effect }))
  );
}

/** The creature that swallowed this one, or null. */
export function swallowerOf(actor: Pick<Actor, "effects"> | undefined): string | null {
  return actor?.effects.find((effect) => effect.tags.includes(SWALLOWED_TAG))?.sourceActorId ?? null;
}

/**
 * SRD swallow: "has Total Cover against attacks and other effects outside the behir". Between a swallowed creature and
 * any creature not inside the same swallower, either way round, except the swallower itself, whose acid still reaches
 * it. Null when neither is swallowed.
 */
export function swallowCover(state: GameState, fromActorId: string, targetId: string): "total" | null {
  const inside = (actorId: string) => swallowerOf(state.actors.find((actor) => actor.id === actorId));
  const target = inside(targetId);
  const from = inside(fromActorId);
  if (target === from) return null;
  if (target !== null && target !== fromActorId) return "total";
  if (from !== null && from !== targetId) return "total";
  return null;
}

/** "The target is swallowed, and the Grappled condition ends": the swallower lets go of its grapple on the creature. */
export function swallowLands(state: GameState, prey: Actor, swallowerId: string): EffectNarration[] {
  return prey.effects
    .filter((effect) => effect.sourceActorId === swallowerId && effect.tags.includes("grapple"))
    .flatMap((effect) => endEffect(state, prey.id, effect.id));
}

type Violation = Readonly<{ rule: "target.not-allowed"; message: string }>;
const SIZE_ORDER = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
const sizeRankOf = (size: string | undefined) => SIZE_ORDER.indexOf(size ?? "medium");

/** Why the creature can't use this action now: it holds as many swallowed as it can ("it can have up to three
 *  creatures swallowed at a time"), or its swallow keeps it from the action ("it can't use Bite while it has a
 *  swallowed target"). Empty when it can. */
export function swallowViolations(
  state: GameState,
  attacker: Pick<Actor, "id" | "name">,
  action: Readonly<{
    id: string;
    name: string;
    swallow?: Swallow;
    holdsAtOnce?: number;
    largeFillsHold?: true;
    save?: Readonly<{ failureMaxSize?: string }>;
  }>,
  siblings: ReadonlyArray<Readonly<{ id: string; name: string; swallow?: Swallow }>>,
  targetIds: readonly string[] = []
): Violation[] {
  const violations: Violation[] = [];
  // "The shambling mound can have only one creature Grappled by this action at a time"; a water elemental's Whelm
  // holds "one Large creature or up to two Medium or smaller creatures".
  const room = (actor: Actor) =>
    action.largeFillsHold && sizeRankOf(actor.size) >= sizeRankOf("large") ? (action.holdsAtOnce ?? 1) : 1;
  // A target too large to be held ("If the target is a Large or smaller creature, it has the Grappled condition") takes
  // no room.
  const holdable = (actor: Actor) =>
    action.save?.failureMaxSize === undefined || sizeRankOf(actor.size) <= sizeRankOf(action.save.failureMaxSize);
  const holding = state.actors
    .filter(
      (actor) =>
        actor.effects.some((effect) => effect.sourceActorId === attacker.id && effect.sourceActionId === action.id) ||
        (targetIds.includes(actor.id) && holdable(actor))
    )
    .reduce((sum, actor) => sum + room(actor), 0);
  if (action.holdsAtOnce !== undefined && holding > action.holdsAtOnce)
    violations.push({
      rule: "target.not-allowed",
      message: `${attacker.name} can hold only ${action.holdsAtOnce === 1 ? "one creature" : `${action.holdsAtOnce} creatures`} with ${action.name} at a time.`
    });
  const held = swallowedBy(state, attacker.id);
  if (held.length === 0) return violations;
  const capacity = action.swallow?.capacity;
  if (capacity !== undefined && held.length >= capacity)
    violations.push({
      rule: "target.not-allowed",
      message: `${attacker.name} can have only ${capacity === 1 ? "one creature" : `${capacity} creatures`} swallowed at a time.`
    });
  const blocking = siblings.find(
    (sibling) =>
      sibling.swallow?.blocks?.includes(action.id) && held.some(({ effect }) => effect.sourceActionId === sibling.id)
  );
  if (blocking)
    violations.push({
      rule: "target.not-allowed",
      message: `${attacker.name} can't use ${action.name} while it has a creature swallowed.`
    });
  return violations;
}

/** A swallow with no save ("The toad swallows a Medium or smaller target it is grappling"): the target is swallowed
 *  at once, out of the grapple, with the swallow's conditions and the damage it deals while it lasts. */
export function swallowOutright(
  state: GameState,
  swallower: Pick<Actor, "id" | "name">,
  action: Readonly<{ id: string; name: string; swallow?: Swallow }>,
  prey: Actor,
  id: string
): EffectNarration[] {
  const swallow = action.swallow;
  if (!swallow?.conditions) return [];
  const events = swallowLands(state, prey, swallower.id);
  addEffect(
    state,
    prey.id,
    makeEffect({
      id,
      name: "Swallowed",
      tags: [SWALLOWED_TAG],
      sourceActorId: swallower.id,
      sourceName: swallower.name,
      sourceActionId: action.id,
      startedRound: state.combat.round,
      duration: { type: "manual" },
      linkedConditionIds: [...swallow.conditions],
      ...(swallow.ongoingDamage
        ? {
            ongoingDamage: {
              ...structuredClone(swallow.ongoingDamage),
              ...(swallow.disgorges ? { disgorges: true as const } : {})
            }
          }
        : {})
    }),
    events
  );
  return [
    {
      kind: "effect",
      text: `${swallower.name} swallows ${prey.name}.`,
      actorId: prey.id,
      source: { actorId: swallower.id, name: swallower.name }
    },
    ...events
  ];
}

/** Damage a swallower takes from a creature inside it, tallied for the turn its regurgitation save reads. */
export function tallyDamageFromInside(
  state: GameState,
  swallowerId: string,
  sourceActorId: string | null | undefined,
  taken: number
): void {
  if (!state.combat.active || taken <= 0 || !sourceActorId) return;
  const source = state.actors.find((actor) => actor.id === sourceActorId);
  if (swallowerOf(source) !== swallowerId) return;
  const key = `${swallowerId}:${FROM_INSIDE}`;
  state.combat = {
    ...state.combat,
    turn: {
      ...state.combat.turn,
      turnUses: { ...state.combat.turn.turnUses, [key]: (state.combat.turn.turnUses[key] ?? 0) + taken }
    }
  };
}

/** At the end of a turn, each swallower that took its stat block's damage from inside it this turn makes its
 *  Constitution save, a failure letting them all out. */
export function regurgitationSaves(
  state: GameState,
  deps: Readonly<{
    newId: () => string;
    now: () => string;
    resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  }>
): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const swallower of state.actors) {
    const taken = state.combat.turn.turnUses[`${swallower.id}:${FROM_INSIDE}`] ?? 0;
    if (taken <= 0 || swallower.hp.current <= 0) continue;
    const held = swallowedBy(state, swallower.id);
    const definition = swallower.definitionId ? deps.resolveDefinition(swallower.definitionId) : undefined;
    const action = definition?.actions.find((candidate) =>
      held.some(({ effect }) => effect.sourceActionId === candidate.id)
    );
    const regurgitate = action?.swallow?.regurgitate;
    if (!action || !regurgitate || taken < regurgitate.damage) continue;
    createPendingSaves(state, {
      sourceActorId: swallower.id,
      sourceName: swallower.name,
      actionName: `${action.name}: hold on`.slice(0, 120),
      ability: "con",
      dc: regurgitate.dc,
      targetIds: [swallower.id],
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: [],
      extra: { regurgitates: { withinFeet: regurgitate.withinFeet } },
      newSaveId: deps.newId,
      createdAt: Date.parse(deps.now())
    });
    events.push({
      kind: "effect",
      text: `${swallower.name} took ${taken} damage from inside this turn: a failed DC ${regurgitate.dc} Constitution save lets out what it swallowed.`,
      actorId: swallower.id
    });
  }
  return events;
}

/** A failed regurgitation save: each creature the swallower holds falls out Prone, in the space it is shown in, within
 *  `withinFeet` of the swallower it was grappled beside. */
export function regurgitate(state: GameState, swallowerId: string, withinFeet: number): EffectNarration[] {
  const swallower = state.actors.find((actor) => actor.id === swallowerId);
  const events: EffectNarration[] = [];
  for (const { prey, effect } of swallowedBy(state, swallowerId)) {
    events.push(...endEffect(state, prey.id, effect.id));
    applyCondition(prey, "prone");
    events.push({
      kind: "effect",
      text: `${swallower?.name ?? "Its swallower"} regurgitates ${prey.name}, which falls Prone within ${withinFeet} feet of it.`,
      actorId: prey.id,
      ...(swallower ? { source: { actorId: swallower.id, name: swallower.name } } : {})
    });
  }
  return events;
}

/** "If that damage doesn't kill it, the frog disgorges it, causing it to exit Prone": once the swallow's damage is
 *  dealt, a survivor is let out. */
export function disgorge(state: GameState, prey: Actor, effectId: string): EffectNarration[] {
  const effect = prey.effects.find((candidate) => candidate.id === effectId);
  if (!effect) return [];
  const events = endEffect(state, prey.id, effectId);
  applyCondition(prey, "prone");
  return [
    ...events,
    {
      kind: "effect",
      text: `${effect.sourceName ?? "Its swallower"} disgorges ${prey.name}, which exits Prone.`,
      actorId: prey.id,
      ...(effect.sourceActorId ? { source: { actorId: effect.sourceActorId, name: effect.sourceName ?? "" } } : {})
    }
  ];
}

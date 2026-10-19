import type { CheckSubject, GameState, PendingFall } from "@vtt/domain";
import { collectRiders, type RandomSource } from "@vtt/rules-5e";
import type { ActionReaction, ActorDefinition } from "@vtt/schemas";
import { altitudeOf, setAltitude } from "./altitude.js";
import { checkPlan } from "./ability-checks.js";
import { rollSettledCheck } from "./check-rolls.js";
import { isIncapacitated } from "./condition-rules.js";
import { addEffect, applyCondition, endEffect, makeEffect, type EffectNarration } from "./effects.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { applyDamageDetailed, damageAdjustmentDetail } from "./hit-points.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { offerableReaction } from "./reaction-offers.js";
import { familyModeFor } from "./rules-families.js";
import { specialSpeedsOf, travelBudgetFeet } from "./speed.js";

/**
 * SRD 5.2.1 Falling: "A creature that falls takes 1d6 Bludgeoning damage at the end of the fall for every 10 feet it
 * fell, to a maximum of 20d6. When the creature lands, it has the Prone condition unless it avoids taking any damage
 * from the fall." A fall into water or another liquid lets the creature use its Reaction for a DC 15 Strength
 * (Athletics) or Dexterity (Acrobatics) check, a success halving the damage.
 *
 * A fall starts from the GM's `actor.fall`, or by itself after any command when a creature in the air can no longer
 * stay there (Flying: Prone, Incapacitated or a Fly Speed of 0 without hover, or nothing left to fly with). The
 * reactions a fall opens (Feather Fall from a creature that sees it, the faller's own Slow Fall) hold it until they are
 * answered; then the server rolls it.
 */

type Actor = GameState["actors"][number];

/** A Feather Fall on the creature: it lands without damage, and the spell ends for it. */
export const FEATHER_FALL_TAG = "feather-fall";
/** A levitation holds the creature up (Levitate): it floats down gently when the levitation ends. */
export const LEVITATING_TAG = "levitating";

export type FallDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  random: RandomSource;
  newId: () => string;
  now: () => string;
  commandId?: string;
  /** Creature-to-creature distance, for a Feather Fall's range; absent, every caster is in range. */
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
  /** Whether one creature sees another (dynamic vision); absent, any creature that isn't Blinded does. */
  sees?: (viewerId: string, targetId: string) => boolean;
  /** Who records the rolls a fall makes. */
  roller?: Readonly<{ sessionId: string; role: "gm" | "player" }>;
}>;

export type FallInput = Readonly<{
  actorId: string;
  feet: number;
  intoWater?: boolean;
  /** The height it lands at; the ground when absent. */
  landingAltitudeFeet?: number;
}>;

/** The dice a fall of this many feet rolls: one d6 per full 10 feet, at most 20. */
export const fallDice = (feet: number) => Math.min(20, Math.floor(Math.max(0, feet) / 10));

const definitionOf = (actor: Actor, deps: Pick<FallDeps, "resolveDefinition">) =>
  actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;

/** Whether a creature in the air stays up (SRD Flying, Hover): a flier falls if it is Prone or Incapacitated or its
 *  Fly Speed is 0, unless it can hover, and one with nothing to fly with falls whatever it can do. */
export function staysAloft(actor: Actor, deps: Pick<FallDeps, "resolveDefinition" | "catalog">): boolean {
  const definition = definitionOf(actor, deps);
  const derivation = deriveEquipment(actor, definition, deps.catalog);
  const speeds = specialSpeedsOf(actor, definition, derivation);
  if (speeds.fly === undefined) return false;
  const grounded =
    actor.conditions.some((condition) => condition.id === "prone") ||
    isIncapacitated(actor) ||
    actor.hp.current <= 0 ||
    travelBudgetFeet(actor, derivation, definition, "fly") === 0;
  return !grounded || speeds.hover;
}

/** A rule on what it carries or what lasts on it lets it fall without harm (Ring of Feather Falling). */
function fallsSafely(actor: Actor, deps: Pick<FallDeps, "resolveDefinition" | "catalog">): boolean {
  const derivation = deriveEquipment(actor, definitionOf(actor, deps), deps.catalog);
  return collectRiders(derivation.carriers, { ...derivation.context, moment: null }).some(
    (rider) => rider.modifier.type === "movement" && rider.modifier.rule === "safe-fall"
  );
}

type FallReaction = Extract<ActionReaction, { trigger: "falls" }>;

/**
 * A creature starts to fall. In a fight, each creature that may answer it with a Reaction gets a prompt and the fall
 * waits for them (`pendingFalls`); otherwise it lands at once. Returns the lines the table hears.
 */
export function startFall(state: GameState, input: FallInput, deps: FallDeps): EffectNarration[] {
  const faller = state.actors.find((actor) => actor.id === input.actorId);
  if (!faller) return [];
  if (state.combat.pendingFalls.some((fall) => fall.actorId === faller.id)) return [];
  const fall: PendingFall = {
    id: deps.newId(),
    actorId: faller.id,
    feet: Math.max(0, Math.round(input.feet)),
    intoWater: input.intoWater === true,
    landingAltitudeFeet: Math.max(0, Math.round(input.landingAltitudeFeet ?? 0)),
    reduction: 0,
    createdAt: Date.parse(deps.now())
  };
  const offers = state.combat.active && fallDice(fall.feet) > 0 ? fallOffers(state, faller, deps) : [];
  if (offers.length === 0) return landFall(state, fall, deps);
  state.combat = {
    ...state.combat,
    pendingFalls: [...state.combat.pendingFalls, fall],
    pendingReactions: [
      ...state.combat.pendingReactions,
      ...offers.map((offer) => ({
        id: deps.newId(),
        kind: "falls" as const,
        actorId: offer.reactorId,
        actionId: offer.actionId,
        actionName: offer.actionName,
        targetActorId: faller.id,
        sourceActorId: faller.id,
        sourceName: faller.name,
        triggerCommandId: fall.id,
        proposedDamage: 0,
        proposedDamageParts: [],
        critical: false,
        weighed: null,
        acBonus: null,
        rollsAttack: false,
        parkedAttack: null,
        fallFeet: fall.feet,
        createdAt: fall.createdAt
      }))
    ]
  };
  return [
    {
      kind: "reaction",
      text: `${faller.name} is falling ${fall.feet} ft. ${offers.map((offer) => `${offer.reactorName} may use ${offer.actionName}`).join(", ")}.`,
      actorId: faller.id
    }
  ];
}

/** Who may answer a fall: a creature with a Feather Fall it can cast now and that sees the faller within range, and
 *  the faller's own Slow Fall. */
function fallOffers(state: GameState, faller: Actor, deps: FallDeps) {
  const offers: Array<{ reactorId: string; reactorName: string; actionId: string; actionName: string }> = [];
  for (const entry of state.combat.initiative) {
    const reactor = state.actors.find((actor) => actor.id === entry.actorId);
    if (!reactor || reactor.hp.current <= 0) continue;
    const self = reactor.id === faller.id;
    const distance = self ? 0 : (deps.distanceFeet?.(reactor.id, faller.id) ?? null);
    const seen =
      self || (deps.sees ? deps.sees(reactor.id, faller.id) : !reactor.conditions.some((c) => c.id === "blinded"));
    const offer = offerableReaction(
      state,
      reactor,
      (reaction): reaction is FallReaction =>
        reaction.trigger === "falls" &&
        (reaction.response === "reduce-fall-damage"
          ? self
          : seen &&
            (reaction.rangeFeet === undefined ||
              distance === null ||
              distance <= reaction.rangeFeet + DISTANCE_TOLERANCE_FEET)),
      deps
    );
    if (offer)
      offers.push({
        reactorId: reactor.id,
        reactorName: reactor.name,
        actionId: offer.action.id,
        actionName: offer.action.name
      });
  }
  return offers;
}

/** The answers to one fall are in: what is left of it lands. */
export function landFallWhenAnswered(state: GameState, fallId: string, deps: FallDeps): EffectNarration[] {
  if (state.combat.pendingReactions.some((prompt) => prompt.kind === "falls" && prompt.triggerCommandId === fallId))
    return [];
  const fall = state.combat.pendingFalls.find((candidate) => candidate.id === fallId);
  if (!fall) return [];
  state.combat = {
    ...state.combat,
    pendingFalls: state.combat.pendingFalls.filter((candidate) => candidate.id !== fallId)
  };
  return landFall(state, fall, deps);
}

/** A fall the GM settled by hand: it is dropped, and its creature stays where the GM leaves it. */
export function dropFall(state: GameState, fallId: string): void {
  state.combat = {
    ...state.combat,
    pendingFalls: state.combat.pendingFalls.filter((fall) => fall.id !== fallId)
  };
}

/** Slow Fall's answer: the damage it takes off, `perLevel` times the faller's level in the class. */
export function reduceFall(state: GameState, fallId: string, amount: number): void {
  state.combat = {
    ...state.combat,
    pendingFalls: state.combat.pendingFalls.map((fall) =>
      fall.id === fallId ? { ...fall, reduction: Math.min(1000, fall.reduction + Math.max(0, amount)) } : fall
    )
  };
}

/** The faller's level in a class, for an answer measured by it (Slow Fall: five times its Monk level). */
export function classLevelOf(definition: ActorDefinition | undefined, classId: string): number {
  const classes = definition?.character?.classes ?? [];
  const entry = classes.find((candidate) => candidate.id === classId);
  return entry?.level ?? 0;
}

/** The fall lands: its height drops to where it lands, and the dice fall unless something spares it. */
function landFall(state: GameState, fall: PendingFall, deps: FallDeps): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === fall.actorId);
  if (!actor) return [];
  const token = state.combat.tokens.find((candidate) => candidate.actorId === actor.id);
  if (token?.position) setAltitude(state, actor.id, fall.landingAltitudeFeet, undefined);
  const dice = fallDice(fall.feet);
  // Feather Fall: no damage, and the spell ends for the creature that landed.
  const featherFall = actor.effects.find((effect) => effect.tags.includes(FEATHER_FALL_TAG));
  if (featherFall || fallsSafely(actor, deps)) {
    const events: EffectNarration[] = [
      { kind: "effect", text: `${actor.name} drifts down ${fall.feet} ft and lands unharmed.`, actorId: actor.id }
    ];
    if (featherFall) events.push(...endEffect(state, actor.id, featherFall.id));
    return events;
  }
  if (dice === 0)
    return [{ kind: "effect", text: `${actor.name} drops ${fall.feet} ft and lands unharmed.`, actorId: actor.id }];
  let rolled = 0;
  for (let die = 0; die < dice; die++) rolled += deps.random(6);
  const events: EffectNarration[] = [];
  let halved = false;
  if (fall.intoWater) halved = waterLanding(state, actor, deps, events);
  const total = Math.max(0, (halved ? Math.floor(rolled / 2) : rolled) - fall.reduction);
  const { application, events: landed } = applyDamageDetailed(
    state,
    actor.id,
    { amount: total, parts: [{ amount: total, type: "bludgeoning" }], sourceName: "the fall", sourceActorId: null },
    { role: "gm" },
    {
      resolveDefinition: deps.resolveDefinition,
      rollDie: deps.random,
      newId: deps.newId,
      now: deps.now,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {}),
      ...(deps.commandId ? { commandId: deps.commandId } : {})
    }
  );
  const taken = application.totalApplied;
  const prone = taken > 0 && applyCondition(actor, "prone") === "applied";
  const reduced = fall.reduction > 0 ? `, ${fall.reduction} less for Slow Fall` : "";
  events.push(
    {
      kind: "damage",
      text: `${actor.name} falls ${fall.feet} ft and takes ${taken} Bludgeoning damage (${dice}d6: ${rolled}${halved ? ", halved by the water" : ""}${reduced})${damageAdjustmentDetail(application)}${prone ? " and lands Prone" : ""}.`,
      actorId: actor.id
    },
    ...landed
  );
  return events;
}

/** SRD Falling into water: the creature may use its Reaction for a DC 15 Strength (Athletics) or Dexterity (Acrobatics)
 *  check, whichever it does better; a success halves the damage. In a fight it needs its Reaction unspent. */
function waterLanding(state: GameState, actor: Actor, deps: FallDeps, events: EffectNarration[]): boolean {
  const inFight = state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actor.id);
  if (isIncapacitated(actor) || (inFight && state.combat.reactionsUsed.includes(actor.id))) return false;
  const definition = definitionOf(actor, deps);
  const derivation = deriveEquipment(actor, definition, deps.catalog);
  const choices: CheckSubject[] = [
    { ability: "str", skill: "athletics" },
    { ability: "dex", skill: "acrobatics" }
  ];
  const plans = choices.map((subject) => checkPlan(actor, definition, derivation, subject));
  const worth = (plan: (typeof plans)[number]) =>
    plan.modifier + (plan.rollMode.mode === "advantage" ? 5 : plan.rollMode.mode === "disadvantage" ? -5 : 0);
  const plan = plans.reduce((best, candidate) => (worth(candidate) > worth(best) ? candidate : best));
  const roll = rollSettledCheck(
    state,
    actor,
    plan,
    {
      id: deps.newId(),
      commandId: deps.commandId ?? deps.newId(),
      sessionId: deps.roller?.sessionId ?? "00000000-0000-4000-8000-000000000000",
      role: deps.roller?.role ?? "gm",
      label: `${plan.label} to enter the water`,
      visibility: actor.visibility === "gm-only" ? "gm-only" : "public",
      createdAt: deps.now()
    },
    deps.random
  );
  if (inFight) state.combat = { ...state.combat, reactionsUsed: [...state.combat.reactionsUsed, actor.id] };
  const success = roll.total >= 15;
  events.push({
    kind: "effect",
    text: `${actor.name} uses its Reaction to hit the water feet first: ${roll.total} against DC 15, ${success ? "a success" : "a failure"}.`,
    actorId: actor.id
  });
  return success;
}

/** The Feather Fall the answer cast lands on the faller as an effect, which spares it the fall's damage. */
export function featherFallEffect(sourceActorId: string, sourceName: string, id: string) {
  return makeEffect({
    id,
    name: "Feather Fall",
    tags: [FEATHER_FALL_TAG],
    duration: { type: "rounds", remaining: 10 },
    sourceActorId,
    sourceName
  });
}

/**
 * After a command commits: every creature in the air that can't stay there comes down (SRD Flying). A levitation that
 * ended or a flight that ends safely lowers it gently; a flier that is Prone, Incapacitated, at a Fly Speed of 0 or
 * left with nothing to fly with falls. Nothing happens while the GM runs movement freeform.
 */
export function settleFalls(state: GameState, deps: FallDeps): EffectNarration[] {
  if (familyModeFor(state.combat, "movement") === "freeform") return [];
  const events: EffectNarration[] = [];
  for (const token of state.combat.tokens) {
    const height = altitudeOf(token);
    // A levitation just begun lifts its creature: Levitate's "rises vertically up to 20 feet".
    const rising = token.position && token.airborne !== "levitate" ? levitated(state, token.actorId) : undefined;
    if (rising) {
      setAltitude(state, rising.id, height + LEVITATE_RISE_FEET, "levitate");
      events.push({
        kind: "effect",
        text: `${rising.name} rises ${LEVITATE_RISE_FEET} ft and hangs in the air.`,
        actorId: rising.id
      });
      continue;
    }
    if (!token.position || height <= 0 || token.airborne === undefined) continue;
    if (state.combat.pendingFalls.some((fall) => fall.actorId === token.actorId)) continue;
    const actor = state.actors.find((candidate) => candidate.id === token.actorId);
    if (!actor) continue;
    if (token.airborne === "levitate") {
      if (actor.effects.some((effect) => effect.tags.includes(LEVITATING_TAG))) continue;
      // Lowered gently: one that can still fly flies on; anything else floats down.
      if (staysAloft(actor, deps)) {
        setAltitude(state, actor.id, height, "fly");
        continue;
      }
      setAltitude(state, actor.id, 0, undefined);
      events.push({ kind: "effect", text: `${actor.name} floats gently to the ground.`, actorId: actor.id });
      continue;
    }
    if (staysAloft(actor, deps)) continue;
    events.push(...startFall(state, { actorId: actor.id, feet: height }, deps));
  }
  return events;
}

const LEVITATE_RISE_FEET = 20;

/** An effect that ends when its bearer lands (a Broom of Flying: "The broom stops hovering when you land"). */
export const ENDS_ON_LANDING_TAG = "ends-on-landing";

/** A move from the air to the ground ends what lasts only until its creature lands. */
export function endsOnLanding(state: GameState, actorId: string, fromFeet: number, toFeet: number): EffectNarration[] {
  if (fromFeet <= 0 || toFeet > 0) return [];
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return [];
  return actor.effects
    .filter((effect) => effect.tags.includes(ENDS_ON_LANDING_TAG))
    .flatMap((effect) => endEffect(state, actor.id, effect.id));
}

/** The creature, when a levitation holds it (Levitate's effect). */
function levitated(state: GameState, actorId: string): Actor | undefined {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  return actor?.effects.some((effect) => effect.tags.includes(LEVITATING_TAG)) ? actor : undefined;
}

/** Whether any creature must rise or come down now; cheap enough to ask after every command. */
export function needsSettling(state: GameState, deps: Pick<FallDeps, "resolveDefinition" | "catalog">): boolean {
  if (familyModeFor(state.combat, "movement") === "freeform") return false;
  return state.combat.tokens.some((token) => {
    if (token.position && token.airborne !== "levitate" && levitated(state, token.actorId)) return true;
    if (!token.position || altitudeOf(token) <= 0 || token.airborne === undefined) return false;
    if (state.combat.pendingFalls.some((fall) => fall.actorId === token.actorId)) return false;
    const actor = state.actors.find((candidate) => candidate.id === token.actorId);
    if (!actor) return false;
    if (token.airborne === "levitate") return !actor.effects.some((effect) => effect.tags.includes(LEVITATING_TAG));
    return !staysAloft(actor, deps);
  });
}

/** Adds the Feather Fall effect to the faller, for a cast that lands on it. */
export function landFeatherFall(state: GameState, fallerId: string, casterId: string, casterName: string, id: string) {
  addEffect(state, fallerId, featherFallEffect(casterId, casterName, id));
}

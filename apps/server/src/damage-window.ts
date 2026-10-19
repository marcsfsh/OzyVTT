import type { DamageResponse, GameState, PendingReaction } from "@vtt/domain";
import { parseDiceFormula, resolveDice, type RandomSource } from "@vtt/rules-5e";
import type { ActionReaction, ActorDefinition, DamageDrain } from "@vtt/schemas";
import type { EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { halvedDamageParts, previewDamage } from "./hit-points.js";
import { offerableReaction } from "./reaction-offers.js";
import type { DefinitionAction, LiveActor } from "./resolution/context.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { sceneSight } from "./vision/sight.js";
import { answerKeyOf, answersFromOthers, askAnswer, type AnswerDeps } from "./roll-answers.js";

/**
 * Damage about to land, held while the creatures who may act on it answer, one prompt at a time: first another
 * creature's answer to the damage roll (Cutting Words "when a creature ... makes a damage roll"), then the damaged
 * creature's own reaction (Uncanny Dodge and Deflect Attacks on a hit; Stone's Endurance and Superior Hunter's Defense
 * on any damage it takes). Each answer passes the damage on to the next; when no one is left, it lands.
 */

type Part = Readonly<{ amount: number; type: string }>;

export type HeldDamage = Readonly<{
  /** The creature that made the damage roll; null for damage with no creature behind it. */
  source: LiveActor | null;
  sourceName: string;
  target: LiveActor;
  parts: readonly Part[];
  critical: boolean;
  /** It is a hit's damage, so an answer to the damage roll and a reaction to being hit are offered. */
  hit: boolean;
  hitKinds: readonly string[];
  drain?: DamageDrain;
  /** Who was asked already, so each creature is asked once. */
  asked: readonly string[];
}>;

export type DamageWindowDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  random: RandomSource;
  newId: () => string;
  now: () => string;
  sessionId: string;
  role: "gm" | "player";
  commandId: string;
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
}>;

/** The key the damaged creature's own reaction is asked under. */
const OWN_REACTION = "own-reaction";

const totalOf = (parts: readonly Part[]) => parts.reduce((sum, part) => sum + part.amount, 0);

/** The type a Resistance answer takes: the damage's largest part. */
export function resistedTypeOf(parts: readonly Part[]): string | null {
  return [...parts].sort((left, right) => right.amount - left.amount)[0]?.type ?? null;
}

/** Takes `amount` off the damage, part by part, largest first, never below 0. */
export function reducedParts(parts: readonly Part[], amount: number): Part[] {
  let left = Math.max(0, amount);
  const order = parts.map((part, index) => ({ part, index })).sort((a, b) => b.part.amount - a.part.amount);
  const reduced = parts.map((part) => ({ ...part }));
  for (const { index } of order) {
    const take = Math.min(left, reduced[index]!.amount);
    reduced[index] = { ...reduced[index]!, amount: reduced[index]!.amount - take };
    left -= take;
  }
  return reduced;
}

/** Whether a hit was made as `kind`. A stat block's attack swings no carried weapon, so its ranged or melee attack
 *  that deals Bludgeoning, Piercing or Slashing damage and is no spell or Unarmed Strike counts as a weapon's (a
 *  goblin's Shortbow, a giant's Rock); a mage's Force bolt does not. */
function hitAs(kind: string, hitKinds: readonly string[], types: readonly string[]): boolean {
  if (hitKinds.includes(kind)) return true;
  if (kind !== "ranged-weapon" && kind !== "melee-weapon") return false;
  if (hitKinds.some((other) => other === "weapon" || other === "spell" || other === "unarmed")) return false;
  if (!types.some((type) => type === "bludgeoning" || type === "piercing" || type === "slashing")) return false;
  return hitKinds.includes(kind === "ranged-weapon" ? "ranged" : "melee");
}

/** The damaged creature's own reaction this damage opens, if any: on a hit, one limited to its damage types and how
 *  it was made; on any damage, one that answers taking damage. */
function ownReactionFor(state: GameState, held: HeldDamage, deps: DamageWindowDeps) {
  const types = held.parts.filter((part) => part.amount > 0).map((part) => part.type);
  return offerableReaction(
    state,
    held.target,
    (reaction): reaction is ActionReaction => {
      if (reaction.trigger === "takes-damage") return true;
      if (reaction.trigger !== "hit-by-attack" || !held.hit) return false;
      if (reaction.response === "half-damage") return true;
      if (reaction.response !== "reduce-damage") return false;
      if (reaction.damageTypes && !reaction.damageTypes.some((type) => types.includes(type))) return false;
      return !reaction.attackKinds || reaction.attackKinds.some((kind) => hitAs(kind, held.hitKinds, types));
    },
    { resolveDefinition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) }
  );
}

/** What using the reaction does to the damage, as the prompt carries it. */
function responseOf(reaction: ActionReaction): DamageResponse {
  if (reaction.response === "reduce-damage") return { kind: "reduce", formula: reaction.formula };
  if (reaction.response === "resist-type") return { kind: "resist" };
  return { kind: "half" };
}

/**
 * Opens the next prompt for held damage, or returns null when nobody is left to ask and the damage should land. The
 * prompt holds the damage: answering it passes the damage on (`answerHeldDamage` in reactions.ts).
 */
export function openDamageWindow(
  state: GameState,
  held: HeldDamage,
  deps: DamageWindowDeps
): Readonly<{ prompt: PendingReaction; line: EffectNarration | null }> | null {
  if (!state.combat.active || totalOf(held.parts) <= 0 || held.target.hp.current <= 0) return null;
  const asked = new Set(held.asked);
  if (held.hit && held.source) {
    const answerDeps: AnswerDeps = {
      resolveDefinition: deps.resolveDefinition,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      random: deps.random,
      newRollId: deps.newId,
      sessionId: deps.sessionId,
      role: deps.role,
      now: deps.now,
      commandId: deps.commandId,
      ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {})
    };
    const next = answersFromOthers(
      state,
      {
        kind: "damage",
        roller: held.source,
        key: `damage:${deps.commandId}`,
        natural: 0,
        total: totalOf(held.parts),
        threshold: null,
        mode: "normal",
        purpose: "damage",
        label: "damage roll",
        visibility: held.source.visibility === "public" ? "public" : "gm-only"
      },
      answerDeps,
      asked
    )[0];
    if (next) {
      const line = askAnswer(
        state,
        next,
        {
          rollKind: "damage",
          roller: held.source,
          targetActorId: held.target.id,
          proposedDamageParts: held.parts.map((part) => ({ ...part })),
          critical: held.critical,
          hitKinds: held.hitKinds,
          ...(held.drain ? { drain: held.drain } : {}),
          asked: [...held.asked, answerKeyOf(next)]
        },
        { newId: deps.newId, now: deps.now, commandId: deps.commandId }
      );
      return { prompt: state.combat.pendingReactions[state.combat.pendingReactions.length - 1]!, line };
    }
  }
  if (asked.has(OWN_REACTION)) return null;
  const offer = ownReactionFor(state, held, deps);
  if (!offer) return null;
  const response = responseOf(offer.reaction);
  // What each answer takes off hit points after the reactor's defences, so its buttons name the numbers; a rolled
  // reduction is known only once rolled.
  const weigh = (parts: readonly Part[]) =>
    previewDamage(state, held.target.id, { amount: 0, parts: [...parts] }, deps).totalApplied;
  const resisted = resistedTypeOf(held.parts);
  const used =
    response.kind === "half"
      ? halvedDamageParts(held.parts)
      : response.kind === "resist" && resisted
        ? held.parts.map((part) => (part.type === resisted ? { ...part, amount: Math.floor(part.amount / 2) } : part))
        : null;
  const prompt: PendingReaction = {
    id: deps.newId(),
    kind: held.hit ? "hit-by-attack" : "takes-damage",
    actorId: held.target.id,
    actionId: offer.action.id,
    actionName: offer.action.name,
    sourceActorId: held.source?.id ?? null,
    sourceName: held.sourceName,
    targetActorId: null,
    triggerCommandId: deps.commandId,
    proposedDamage: totalOf(held.parts),
    proposedDamageParts: held.parts.map((part) => ({ ...part })),
    critical: held.critical,
    weighed: used === null ? null : { use: used.length > 0 ? weigh(used) : 0, decline: weigh(held.parts) },
    acBonus: null,
    rollsAttack: false,
    parkedAttack: null,
    ...(response.kind === "half" ? {} : { damageResponse: response }),
    ...(held.drain ? { drain: held.drain } : {}),
    ...(held.hitKinds.length > 0 ? { hitKinds: [...held.hitKinds] } : {}),
    ...redirectChoicesOf(state, held.target, offer, deps),
    asked: [...held.asked, OWN_REACTION],
    createdAt: Date.parse(deps.now())
  };
  state.combat = { ...state.combat, pendingReactions: [...state.combat.pendingReactions, prompt] };
  return { prompt, line: null };
}

/** A stone giant's Deflect Missile: the creatures it may turn the force on, if the reduction takes the damage to 0
 *  ("one creature the giant can see within 60 feet"), nearest first. */
function redirectChoicesOf(
  state: GameState,
  reactor: LiveActor,
  offer: Readonly<{ action: DefinitionAction; reaction: ActionReaction }>,
  deps: DamageWindowDeps
): Partial<Pick<PendingReaction, "redirectChoices">> {
  if (offer.reaction.response !== "reduce-damage" || offer.reaction.redirect !== true || !deps.distanceFeet) return {};
  const reach = offer.action.targets?.rangeFeet ?? 60;
  const sight = sceneSight(state, {
    definition: deps.resolveDefinition,
    ...(deps.catalog ? { catalog: deps.catalog } : {})
  });
  const choices = state.combat.initiative
    .map((entry) => state.actors.find((actor) => actor.id === entry.actorId))
    .filter((actor): actor is LiveActor => actor !== undefined && actor.id !== reactor.id && actor.hp.current > 0)
    .map((actor) => ({ actor, distance: deps.distanceFeet!(reactor.id, actor.id) }))
    .filter(
      ({ actor, distance }) =>
        distance !== null &&
        distance <= reach + DISTANCE_TOLERANCE_FEET &&
        (!sight.enabled || sight.sees(reactor.id, actor.id))
    )
    .sort((left, right) => left.distance! - right.distance!)
    .slice(0, 12)
    .map(({ actor }) => ({ actorId: actor.id, name: actor.name }));
  return choices.length > 0 ? { redirectChoices: choices } : {};
}

/** The damage a damage reaction leaves to land: halved, a rolled amount taken off, or kept whole while a Resistance
 *  effect does the halving. Returns the parts and the roll it made, if any. */
export function respondToDamage(
  parts: readonly Part[],
  response: DamageResponse,
  random: RandomSource
): Readonly<{ parts: Part[]; rolled: ReturnType<typeof resolveDice> | null }> {
  if (response.kind === "half") return { parts: halvedDamageParts(parts), rolled: null };
  if (response.kind === "resist") return { parts: parts.map((part) => ({ ...part })), rolled: null };
  const rolled = resolveDice(parseDiceFormula(response.formula), random);
  return { parts: reducedParts(parts, rolled.total), rolled };
}

import type {
  AbilityId,
  GameState,
  HeldAnswer,
  HeldRoll,
  PendingReaction,
  PendingSave,
  RollAnswered,
  RollAnswerOffer,
  RollVisibility
} from "@vtt/domain";
import {
  d20Die,
  d20FacesFor,
  keptD20,
  parseDiceFormula,
  rerollLowestD20,
  resolveDice,
  resolveWithD20s,
  type RandomSource
} from "@vtt/rules-5e";
import type { ActorDefinition, EffectInstance, RollAnswer } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { isIncapacitated } from "./condition-rules.js";
import { effectiveActions } from "./effective-actions.js";
import { endEffect, NO_REACTIONS_TAG, type EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { useLimitFor } from "./resolution/economy.js";
import { freeOptionReady, isMetamagicOption, useFreeOption } from "./resolution/metamagic.js";
import type { DefinitionAction, LiveActor } from "./resolution/context.js";
import { recordRoll, rolledTerms } from "./roll-history.js";
import { effectiveModeFor } from "./rules-families.js";
import { statblockFacts } from "./statblock-facts.js";
import { useCostOf } from "./use-cost.js";
import { hiddenFrom } from "./vision/audience.js";

/**
 * Answers to a roll its maker has seen and that hasn't counted yet (SRD "after seeing the roll but before any of the
 * roll's effects occur"): a Bardic Inspiration die, Indomitable's reroll, the halfling's Luck, Stroke of Luck. Each
 * answer is data on an action (`answer`, its cost the action's uses and Reaction) or on an effect (which ends when
 * used). An answer is applied once to a held roll (`held-rolls.ts`), and every later look at that roll reads it, so a
 * preview, a second look and the confirm agree.
 */

type RollMode = "advantage" | "disadvantage" | "normal";
export type AnswerRollKind = "attack" | "save" | "check" | "death-save" | "damage";

/** What a save is against, for an answer limited to some saves (Countercharm, Resist Enchantment). */
export type SaveStakes = Readonly<{
  conditions: readonly string[];
  spell?: PendingSave["spell"];
  sourceActorId: string | null;
}>;

/** A held roll as an answer meets it: whose it is, what it shows now, and what it is measured against. */
export type AnswerTarget = Readonly<{
  kind: AnswerRollKind;
  roller: LiveActor;
  /** The held roll's key; the entry in `state.heldRolls` is what an answer changes. */
  key: string;
  /** The d20 that counts and the total, answers included. */
  natural: number;
  total: number;
  /** What the total must reach (a DC, an AC, 10 for a death save); null when nothing says. */
  threshold: number | null;
  /** The outcome whatever the total (an attack's natural 1 misses, its Critical Hit hits). */
  automatic?: "fail" | "succeed";
  /** The mode the d20s are read under, which a reroll throws them with. */
  mode: RollMode;
  /** An attack roll made for a spell (Seeking Spell answers only those). */
  spellAttack?: boolean;
  ability?: AbilityId;
  stakes?: SaveStakes;
  /** How the roll was recorded, so an answer's own dice are recorded the same way. */
  purpose: "attack" | "save" | "check" | "damage";
  label: string;
  visibility: RollVisibility;
}>;

export type AnswerDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  random: RandomSource;
  newRollId: () => string;
  sessionId: string;
  role: "gm" | "player";
  now: () => string;
  commandId: string;
  /** Creature-to-creature distance on the live map, for an answer given within a range; absent, range isn't checked. */
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
}>;

/** Where an answer comes from: an action (its uses and Reaction pay for it) or an effect (used up by answering). */
type AnswerSource =
  | Readonly<{ kind: "action"; id: string; name: string; answer: RollAnswer; action: DefinitionAction }>
  | Readonly<{ kind: "effect"; id: string; name: string; answer: RollAnswer; effect: EffectInstance }>;

/** Every answer a creature carries, on its actions and its effects. */
function sourcesOf(
  bearer: LiveActor,
  deps: Pick<AnswerDeps, "resolveDefinition" | "catalog">
): { sources: AnswerSource[]; siblings: readonly DefinitionAction[] } {
  const definition = bearer.definitionId ? deps.resolveDefinition(bearer.definitionId) : undefined;
  const siblings = effectiveActions(definition, bearer, deps.catalog);
  const sources: AnswerSource[] = [
    ...siblings.flatMap((action): AnswerSource[] =>
      action.answer ? [{ kind: "action", id: action.id, name: action.name, answer: action.answer, action }] : []
    ),
    ...bearer.effects.flatMap((effect): AnswerSource[] =>
      effect.answer
        ? [{ kind: "effect", id: `effect:${effect.id}`, name: effect.name, answer: effect.answer, effect }]
        : []
    )
  ];
  return { sources, siblings };
}

/** The held roll under `key`. */
function heldOf(state: GameState, key: string): HeldRoll {
  const held = state.heldRolls.find((entry) => entry.key === key);
  if (!held) throw new CommandRejectedError("Roll first: an answer meets a roll that was made.");
  return held;
}

/** What the answers a held roll took do to it: the sum they add, the d20 one set (a later reroll clears it), and
 *  whether one made a save succeed or an attack hit. */
export function answeredRead(held: Pick<HeldRoll, "answers"> | undefined): Readonly<{
  bonus: number;
  face: number | null;
  succeed: boolean;
  hit: boolean;
}> {
  let bonus = 0;
  let face: number | null = null;
  let succeed = false;
  let hit = false;
  for (const answer of held?.answers ?? []) {
    bonus += answer.bonus;
    if (answer.rerolled) face = null;
    if (answer.face !== undefined) face = answer.face;
    succeed ||= answer.succeed === true;
    hit ||= answer.hit === true;
  }
  return { bonus, face, succeed, hit };
}

/** A roll's natural die and total once its answers count, from what its dice alone show. */
export function withAnswers(
  held: Pick<HeldRoll, "answers"> | undefined,
  natural: number,
  total: number
): Readonly<{ natural: number; total: number; bonus: number; succeed: boolean; hit: boolean }> {
  const read = answeredRead(held);
  const face = read.face ?? natural;
  return {
    natural: face,
    total: total - natural + face + read.bonus,
    bonus: read.bonus,
    succeed: read.succeed,
    hit: read.hit
  };
}

/** The answers a roll took, as its result says them. */
export function answeredLines(held: Pick<HeldRoll, "answers"> | undefined): RollAnswered[] {
  return (held?.answers ?? []).map((answer) => ({
    name: answer.name,
    change: answer.rerolled
      ? answer.bonus !== 0
        ? `rerolled, ${answer.bonus > 0 ? "+" : ""}${answer.bonus}`
        : "rerolled"
      : answer.face !== undefined
        ? `the d20 is ${answer.face}`
        : answer.succeed
          ? "succeeds"
          : answer.hit
            ? "hits"
            : `${answer.bonus >= 0 ? "+" : ""}${answer.bonus}${answer.spent ? "" : ", use kept"}`
  }));
}

/** Whether the roll succeeds once `bonus` is added, or null when nothing says. */
function succeeds(target: AnswerTarget, bonus: number): boolean | null {
  if (target.automatic) return target.automatic === "succeed";
  return target.threshold === null ? null : target.total + bonus >= target.threshold;
}

/** The mode a reroll with Advantage throws: Advantage, unless the roll had Disadvantage, which cancels it. */
const withAdvantage = (mode: RollMode): RollMode => (mode === "disadvantage" ? "normal" : "advantage");

/** What an answer's button says it does. */
function doesOf(answer: RollAnswer): string {
  const effect = answer.effect;
  switch (effect.kind) {
    case "add":
      return `+${effect.amount}`;
    case "subtract":
      return `-${effect.amount}`;
    case "add-or-subtract":
      return `+${effect.amount} or -${effect.amount}`;
    case "reroll":
      return `${effect.one ? "Reroll the d20" : "Reroll"}${effect.bonus !== undefined ? ` +${effect.bonus}` : ""}${effect.advantage ? " with Advantage" : ""}`;
    case "set-d20":
      return `The d20 becomes ${effect.face}`;
    case "succeed":
      return "Succeed";
    case "hit":
      return "Hit";
  }
}

/** What an answer costs, for its button's note; null when it costs nothing. */
function costOf(source: AnswerSource): string | null {
  if (source.kind === "effect") return null;
  const reaction = source.action.activation === "reaction";
  const uses = source.action.uses ? useCostOf(source.action) : 0;
  const spent = uses === 0 ? null : uses === 1 ? "a use" : `${uses} uses`;
  if (reaction) return spent ? `the Reaction and ${spent}` : "the Reaction";
  return spent;
}

/** Whether a save's stakes meet an answer's `versus`: any of its lists may match. */
function versusMatches(
  versus: NonNullable<RollAnswer["versus"]>,
  target: AnswerTarget,
  state: GameState,
  deps: AnswerDeps
) {
  const stakes = target.stakes;
  if (!stakes) return false;
  if (versus.conditions?.some((condition) => stakes.conditions.includes(condition))) return true;
  const spell = stakes.spell;
  if (spell && versus.spellSchools?.includes(spell.school) && (versus.singleTarget !== true || spell.singleTarget))
    return true;
  if (versus.creatureTypes && stakes.sourceActorId !== null) {
    const source = state.actors.find((actor) => actor.id === stakes.sourceActorId);
    const definition = source?.definitionId ? deps.resolveDefinition(source.definitionId) : undefined;
    const type = definition ? statblockFacts(definition).creatureType : null;
    if (type !== null && versus.creatureTypes.includes(type)) return true;
  }
  return false;
}

/** Why the bearer's answer can't meet this roll now, or null when it can. */
function refusal(
  state: GameState,
  target: AnswerTarget,
  bearer: LiveActor,
  source: AnswerSource,
  siblings: readonly DefinitionAction[],
  deps: AnswerDeps
): string | null {
  const { answer } = source;
  const own = bearer.id === target.roller.id;
  if (!answer.rolls.includes(target.kind)) return `${source.name} doesn't answer this roll.`;
  if (answer.whose === "own" && !own) return `${source.name} answers only ${bearer.name}'s own rolls.`;
  if (answer.whose === "other" && own) return `${source.name} answers another creature's roll.`;
  if (!own && answer.rangeFeet !== undefined && deps.distanceFeet) {
    const apart = deps.distanceFeet(bearer.id, target.roller.id);
    if (apart !== null && apart > answer.rangeFeet + DISTANCE_TOLERANCE_FEET)
      return `${target.roller.name} is farther than ${answer.rangeFeet} feet from ${bearer.name}.`;
  }
  // A damage roll neither succeeds nor fails: an answer to it is offered whenever one is made.
  const success = target.kind === "damage" ? null : succeeds(target, 0);
  if (answer.when === "failure" && success === true) return `${source.name} answers a roll that fails.`;
  if (answer.when === "success" && success === false) return `${source.name} answers a roll that succeeds.`;
  if (answer.when === "natural-one" && (target.kind === "damage" || target.natural !== 1))
    return `${source.name} answers a d20 that shows 1.`;
  if (answer.notWhileIncapacitated && (bearer.hp.current <= 0 || isIncapacitated(bearer)))
    return `${bearer.name} can't use ${source.name} while Incapacitated.`;
  if (answer.abilities && (target.ability === undefined || !answer.abilities.includes(target.ability)))
    return `${source.name} doesn't answer this roll.`;
  if (answer.spellAttacks && (target.kind !== "attack" || target.spellAttack !== true))
    return `${source.name} answers the attack roll of a spell.`;
  if (answer.versus && !versusMatches(answer.versus, target, state, deps))
    return `${source.name} doesn't answer a save against this.`;
  const effect = answer.effect;
  if (effect.kind === "succeed" && target.kind !== "save") return `${source.name} answers a saving throw.`;
  if (effect.kind === "hit" && target.kind !== "attack") return `${source.name} answers an attack roll.`;
  const held = state.heldRolls.find((entry) => entry.key === target.key);
  if (held?.answers.some((given) => given.id === source.id && given.actorId === bearer.id))
    return `${source.name} has already answered this roll.`;
  if (source.kind === "effect") return null;
  const action = source.action;
  if (action.activation === "reaction") {
    if (bearer.hp.current <= 0 || isIncapacitated(bearer)) return `${bearer.name} can't take a Reaction now.`;
    if (bearer.effects.some((candidate) => candidate.tags.includes(NO_REACTIONS_TAG)))
      return `${bearer.name} can't take Reactions now.`;
    if (
      state.combat.active &&
      state.combat.reactionsUsed.includes(bearer.id) &&
      effectiveModeFor(state.combat, "economy.reaction-used") === "strict"
    )
      return `${bearer.name} has already used a Reaction this round.`;
  }
  if (
    action.uses &&
    effectiveModeFor(state.combat, "feature.no-uses-remaining") === "strict" &&
    !freeMetamagicFor(state, bearer, action, deps)
  ) {
    const key = action.uses.pool ?? action.id;
    const spent =
      action.uses.per === "turn"
        ? (state.combat.turn.turnUses[`${bearer.id}:${key}`] ?? 0)
        : (bearer.actionUses[key] ?? 0);
    if (spent + useCostOf(action) > useLimitFor(siblings, action)) return `${source.name} has no uses left.`;
  }
  return null;
}

/** The answers the roller may give its own roll now, for its preview to offer. */
export function answersOffered(state: GameState, target: AnswerTarget, deps: AnswerDeps): RollAnswerOffer[] {
  const { sources, siblings } = sourcesOf(target.roller, deps);
  return sources.flatMap((source): RollAnswerOffer[] => {
    if (source.answer.whose === "other") return [];
    if (refusal(state, target, target.roller, source, siblings, deps) !== null) return [];
    const effect = source.answer.effect;
    return [
      {
        id: source.id,
        name: source.name,
        does: doesOf(source.answer),
        cost: costOf(source),
        ...(effect.kind === "add-or-subtract" ? { either: true as const } : {}),
        ...(effect.kind === "reroll" ? { rerolls: true as const } : {})
      }
    ];
  });
}

/** The answers another creature may give this roll now (Cutting Words, Countercharm), in the order they are asked. */
export function answersFromOthers(
  state: GameState,
  target: AnswerTarget,
  deps: AnswerDeps,
  asked: ReadonlySet<string> = new Set()
): Array<Readonly<{ bearer: LiveActor; offer: RollAnswerOffer }>> {
  const order = [
    ...state.combat.initiative.map((entry) => entry.actorId),
    ...state.actors.map((actor) => actor.id)
  ].filter((id, index, ids) => ids.indexOf(id) === index && id !== target.roller.id);
  return order.flatMap((actorId) => {
    const bearer = state.actors.find((actor) => actor.id === actorId);
    if (!bearer || !state.combat.initiative.some((entry) => entry.actorId === bearer.id)) return [];
    // "A creature you can see": a player is never asked about a roll of a creature hidden from them, which the
    // prompt would point at.
    const owner = bearer.kind === "player-character" ? bearer.ownerSessionId : null;
    const content = { definition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) };
    if (owner !== null && hiddenFrom(state, content, owner)(target.roller.id)) return [];
    const { sources, siblings } = sourcesOf(bearer, deps);
    return sources.flatMap((source) => {
      if (
        source.kind !== "action" ||
        source.answer.whose === "own" ||
        asked.has(answerKeyOf({ bearer, offer: source }))
      )
        return [];
      if (refusal(state, target, bearer, source, siblings, deps) !== null) return [];
      const effect = source.answer.effect;
      return [
        {
          bearer,
          offer: {
            id: source.id,
            name: source.name,
            does: doesOf(source.answer),
            cost: costOf(source),
            ...(effect.kind === "add-or-subtract" ? { either: true as const } : {}),
            ...(effect.kind === "reroll" ? { rerolls: true as const } : {})
          }
        }
      ];
    });
  });
}

/** Writes a held roll back under its key. */
function rewriteHeld(state: GameState, key: string, change: (held: HeldRoll) => HeldRoll): void {
  state.heldRolls = state.heldRolls.map((entry) => (entry.key === key ? change(entry) : entry));
}

/** Whether a Metamagic option answering a roll costs nothing: the turn's free option is there (Arcane Apotheosis). */
function freeMetamagicFor(
  state: GameState,
  bearer: LiveActor,
  action: DefinitionAction,
  deps: Pick<AnswerDeps, "resolveDefinition">
): boolean {
  if (!isMetamagicOption(action.id)) return false;
  return freeOptionReady(state, bearer, bearer.definitionId ? deps.resolveDefinition(bearer.definitionId) : undefined);
}

/** Spends what an answer costs: the action's uses and its Reaction, or the effect it ends. */
function payFor(
  state: GameState,
  bearer: LiveActor,
  source: AnswerSource,
  events: EffectNarration[],
  deps: Pick<AnswerDeps, "resolveDefinition">
): void {
  if (source.kind === "effect") {
    events.push(...endEffect(state, bearer.id, source.effect.id));
    return;
  }
  const action = source.action;
  if (action.activation === "reaction" && state.combat.active)
    state.combat = {
      ...state.combat,
      reactionsUsed: [...state.combat.reactionsUsed.filter((id) => id !== bearer.id), bearer.id]
    };
  if (!action.uses) return;
  // Seeking Spell may be the turn's free Metamagic option (Arcane Apotheosis).
  if (freeMetamagicFor(state, bearer, action, deps)) {
    useFreeOption(state);
    return;
  }
  const key = action.uses.pool ?? action.id;
  const amount = useCostOf(action);
  if (action.uses.per === "turn") {
    const counted = `${bearer.id}:${key}`;
    state.combat = {
      ...state.combat,
      turn: {
        ...state.combat.turn,
        turnUses: { ...state.combat.turn.turnUses, [counted]: (state.combat.turn.turnUses[counted] ?? 0) + amount }
      }
    };
  } else bearer.actionUses = { ...bearer.actionUses, [key]: (bearer.actionUses[key] ?? 0) + amount };
}

/** Records an answer's own dice, attributed to the one who answered, as the roll it answers is shown. */
function recordAnswerRoll(
  state: GameState,
  target: AnswerTarget,
  bearer: LiveActor,
  label: string,
  resolution: ReturnType<typeof resolveDice>,
  deps: AnswerDeps,
  typed = false
): string {
  const id = deps.newRollId();
  recordRoll(state, {
    id,
    commandId: deps.commandId,
    initiatorSessionId: deps.sessionId,
    initiatorRole: deps.role,
    initiatorLabel: bearer.name,
    label: label.slice(0, 80),
    actorId: bearer.id,
    purpose: target.purpose,
    // A hidden creature's answer stays the GM's, as its own rolls do.
    visibility: bearer.visibility === "public" ? target.visibility : "gm-only",
    formula: resolution.expression.source,
    normalizedFormula: resolution.expression.normalized,
    ...rolledTerms(resolution),
    total: resolution.total,
    ...(typed ? { typed: true as const } : {}),
    createdAt: deps.now()
  });
  return id;
}

/**
 * Applies one answer to a held roll: checks the bearer may give it now, does what it does (rolls its die, rerolls the
 * d20s, sets the d20, makes it succeed or hit), spends what it costs, and writes it onto the held roll so every later
 * look reads it. A use the answer keeps on a failure (Peerless Skill) is spent only when the roll then succeeds. A
 * reroll of a typed d20 takes the face the physical reroll shows. Returns the narration of what it ended.
 */
export function applyRollAnswer(
  state: GameState,
  target: AnswerTarget,
  bearer: LiveActor,
  choice: Readonly<{ id: string; subtract?: boolean; face?: number }>,
  deps: AnswerDeps
): EffectNarration[] {
  const { source, siblings } = answerSourceOf(bearer, choice.id, deps);
  const refused = refusal(state, target, bearer, source, siblings, deps);
  if (refused !== null) throw new CommandRejectedError(refused);
  const held = heldOf(state, target.key);
  const effect = source.answer.effect;
  const given: HeldAnswer = {
    id: source.id,
    actorId: bearer.id,
    name: source.name,
    bonus: 0,
    spent: true
  };
  let entry: HeldAnswer = given;
  let faces = held.faces;
  let readAs = held.readAs;
  switch (effect.kind) {
    case "add":
    case "subtract":
    case "add-or-subtract": {
      const rolled = resolveDice(parseDiceFormula(effect.amount), deps.random);
      const sign =
        effect.kind === "subtract" || (effect.kind === "add-or-subtract" && choice.subtract === true) ? -1 : 1;
      recordAnswerRoll(
        state,
        target,
        bearer,
        `${source.name} on ${target.roller.name}'s ${target.label}`,
        rolled,
        deps
      );
      const bonus = sign * rolled.total;
      // "If the check still fails, this use isn't expended": known only when the roll has a number to reach.
      const stillFails = succeeds(target, bonus) === false;
      entry = { ...given, bonus, spent: !(effect.kind === "add" && effect.keepUseOnFailure === true && stillFails) };
      break;
    }
    case "reroll": {
      if (held.typed && choice.face === undefined) throw new CommandRejectedError("Type the d20 your reroll shows.");
      if (!held.typed && choice.face !== undefined)
        throw new CommandRejectedError(
          "The server threw this die, so it throws the reroll too. Reroll without typing."
        );
      const mode = effect.advantage ? withAdvantage(readAs ?? target.mode) : (readAs ?? target.mode);
      faces =
        choice.face !== undefined
          ? [choice.face]
          : effect.one
            ? rerollLowestD20(held.faces, deps.random)
            : d20FacesFor(mode, [], deps.random);
      readAs = choice.face !== undefined ? "normal" : mode;
      recordAnswerRoll(
        state,
        target,
        bearer,
        `${source.name}: ${target.roller.name}'s ${target.label} rerolled`,
        resolveWithD20s(choice.face !== undefined ? "1d20" : d20Die(readAs), faces, deps.random),
        deps,
        choice.face !== undefined
      );
      entry = { ...given, rerolled: true, bonus: effect.bonus ?? 0 };
      break;
    }
    case "set-d20":
      entry = { ...given, face: effect.face };
      break;
    case "succeed":
      entry = { ...given, succeed: true };
      break;
    case "hit":
      entry = { ...given, hit: true };
      break;
  }
  const events: EffectNarration[] = [];
  if (entry.spent) payFor(state, bearer, source, events, deps);
  // The latest roll of the roller stays the one held, so its own reroll still meets it.
  const latest = [...state.rolls].reverse().find((roll) => roll.actorId === target.roller.id);
  rewriteHeld(state, target.key, (current) => ({
    ...current,
    faces,
    ...(readAs !== undefined ? { readAs } : {}),
    answers: [...current.answers, entry],
    ...(latest && current.check ? { rollId: latest.id } : {})
  }));
  return events;
}

/** The bearer's answer by its id. */
function answerSourceOf(
  bearer: LiveActor,
  id: string,
  deps: Pick<AnswerDeps, "resolveDefinition" | "catalog">
): { source: AnswerSource; siblings: readonly DefinitionAction[] } {
  const { sources, siblings } = sourcesOf(bearer, deps);
  const source = sources.find((candidate) => candidate.id === id);
  if (!source) throw new CommandRejectedError(`${bearer.name} has no such answer to give.`);
  return { source, siblings };
}

/**
 * An answer to a roll that holds no die of its own any more (an attack waiting at its roll, a hit's damage): only an
 * answer that adds or takes off a rolled amount meets it (Cutting Words, Improve Fate). Rolls the amount, records it,
 * pays for it, and returns what it adds to the roll.
 */
export function answerAmount(
  state: GameState,
  target: AnswerTarget,
  bearer: LiveActor,
  choice: Readonly<{ id: string; subtract?: boolean }>,
  deps: AnswerDeps
): Readonly<{ name: string; amount: string; bonus: number; events: EffectNarration[] }> {
  const { source, siblings } = answerSourceOf(bearer, choice.id, deps);
  const refused = refusal(state, target, bearer, source, siblings, deps);
  if (refused !== null) throw new CommandRejectedError(refused);
  const effect = source.answer.effect;
  if (effect.kind !== "add" && effect.kind !== "subtract" && effect.kind !== "add-or-subtract")
    throw new CommandRejectedError(`${source.name} can't answer this roll any more.`);
  const rolled = resolveDice(parseDiceFormula(effect.amount), deps.random);
  const sign = effect.kind === "subtract" || (effect.kind === "add-or-subtract" && choice.subtract === true) ? -1 : 1;
  recordAnswerRoll(state, target, bearer, `${source.name} on ${target.roller.name}'s ${target.label}`, rolled, deps);
  const events: EffectNarration[] = [];
  payFor(state, bearer, source, events, deps);
  return { name: source.name, amount: effect.amount, bonus: sign * rolled.total, events };
}

/** The key a prompt remembers an answer by, so each creature's answer is asked once per roll. */
export function answerKeyOf(
  asked: Readonly<{ bearer: Pick<LiveActor, "id">; offer: Readonly<{ id: string }> }>
): string {
  return `${asked.bearer.id}:${asked.offer.id}`;
}

/** What a prompt for another creature's answer carries: the roll it meets, and what was asked before. */
export type AnswerPromptRoll = Readonly<{
  rollKind: "attack" | "save" | "check" | "damage";
  roller: LiveActor;
  /** The creature the roll is aimed at: an attack's or a damage roll's target. */
  targetActorId: string | null;
  saveId?: string;
  parkedAttack?: PendingReaction["parkedAttack"];
  proposedDamageParts?: PendingReaction["proposedDamageParts"];
  critical?: boolean;
  /** A held hit's damage: how the hit was made, and what it drains, for the reactions after this answer. */
  hitKinds?: readonly string[];
  drain?: PendingReaction["drain"];
  asked: readonly string[];
}>;

/**
 * Opens the prompt that asks a creature for its answer to another's roll (Cutting Words, Countercharm, Improve Fate):
 * its player, or the GM for a stat block, answers it with `reaction.answer`. Returns the line that announces it, the
 * roller masked for the table when hidden.
 */
export function askAnswer(
  state: GameState,
  next: Readonly<{ bearer: LiveActor; offer: RollAnswerOffer }>,
  roll: AnswerPromptRoll,
  deps: Readonly<{ newId: () => string; now: () => string; commandId: string }>
): EffectNarration {
  const parts = roll.proposedDamageParts ?? [];
  const prompt: PendingReaction = {
    id: deps.newId(),
    kind: "roll-answer",
    actorId: next.bearer.id,
    actionId: next.offer.id,
    actionName: next.offer.name,
    targetActorId: roll.targetActorId,
    sourceActorId: roll.roller.id,
    sourceName: roll.roller.name,
    triggerCommandId: deps.commandId,
    proposedDamage: parts.reduce((sum, part) => sum + part.amount, 0),
    proposedDamageParts: [...parts],
    critical: roll.critical ?? false,
    weighed: null,
    acBonus: null,
    rollsAttack: false,
    parkedAttack: roll.parkedAttack ?? null,
    rollKind: roll.rollKind,
    ...(roll.saveId !== undefined ? { saveId: roll.saveId } : {}),
    answerDoes: next.offer.does.slice(0, 80),
    ...(next.offer.either ? { answerEither: true as const } : {}),
    asked: [...roll.asked],
    ...(roll.hitKinds && roll.hitKinds.length > 0 ? { hitKinds: [...roll.hitKinds] } : {}),
    ...(roll.drain ? { drain: roll.drain } : {}),
    createdAt: Date.parse(deps.now())
  };
  state.combat = { ...state.combat, pendingReactions: [...state.combat.pendingReactions, prompt] };
  return {
    kind: "reaction",
    text: `${next.bearer.name} may answer ${roll.roller.name}'s ${ROLL_WORDS[roll.rollKind]} with ${next.offer.name}.`,
    actorId: next.bearer.id,
    source: { actorId: roll.roller.id, name: roll.roller.name }
  };
}

const ROLL_WORDS: Readonly<Record<AnswerPromptRoll["rollKind"], string>> = {
  attack: "attack roll",
  save: "saving throw",
  check: "ability check",
  damage: "damage roll"
};

/** The d20 a held roll's faces show once a reroll answer changed how they are read. */
export function keptFace(held: Pick<HeldRoll, "faces" | "readAs">, mode: RollMode): number {
  return keptD20(held.faces, held.readAs ?? mode);
}

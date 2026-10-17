import type { AbilityId, GameState } from "@vtt/domain";
import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { holdsFeature } from "./class-features.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { expireEffectsAtTurnEnd, sourceOf, type EffectNarration } from "./effects.js";
import { applyDamageDetailed, damageAdjustmentDetail } from "./hit-points.js";
import { createPendingSaves } from "./saving-throws.js";

type Actor = GameState["actors"][number];
type Effect = Actor["effects"][number];

/** What the end-of-turn step needs to open prompts; without it (scene bookkeeping) durations still end. */
export type TurnEndDeps = Readonly<{ newId: () => string; now: () => string }>;

/** What the start-of-turn step needs to roll ongoing damage and weigh it; prompts open only with `newId`. */
export type TurnStartDeps = Readonly<{
  rollDie: (sides: number) => number;
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  newId?: () => string;
  now?: () => string;
}>;

/**
 * SRD: "at the end of its turn". When `actorId`'s turn ends, before the next begins:
 * 1. "until the end of its/your next turn" durations it owns end (`expireEffectsAtTurnEnd`);
 * 2. each effect it bears that "repeats the save at the end of each of its turns" opens that save, a success ending
 *    the effect (`openRepeatSaves`).
 */
export function endOfTurn(state: GameState, actorId: string, events: EffectNarration[], deps?: TurnEndDeps): void {
  events.push(...expireEffectsAtTurnEnd(state, actorId));
  if (deps) events.push(...openRepeatSaves(state, actorId, deps));
}

/**
 * SRD: "at the start of each of its turns". When `actorId`'s turn starts, once its durations have ticked
 * (`expireEffectsAtTurnStart`), each effect whose ongoing damage falls on this turn deals it: one the creature bears
 * ("each of its turns") or one it is the source of ("each of the behir's turns"; a source at 0 HP has no turns to
 * deal it on). The dice roll here and the damage meets the bearer's defences like any hit. A save that follows the
 * damage opens next, a success ending the effect (Searing Smite).
 */
export function startOfTurn(state: GameState, actorId: string, events: EffectNarration[], deps: TurnStartDeps): void {
  heroicWarrior(state, actorId, events, deps);
  const inFight = new Set(state.combat.initiative.map((entry) => entry.actorId));
  for (const bearer of state.actors) {
    if (!inFight.has(bearer.id)) continue;
    for (const effect of [...bearer.effects]) {
      const ongoing = effect.ongoingDamage;
      if (!ongoing || (ongoing.at === "bearer-turn-start" ? bearer.id : effect.sourceActorId) !== actorId) continue;
      // Damage dealt earlier this turn may have ended it (a death, a cascade).
      if (!bearer.effects.some((candidate) => candidate.id === effect.id) || beyondHarm(bearer)) continue;
      const source = state.actors.find((candidate) => candidate.id === effect.sourceActorId);
      if (ongoing.at === "source-turn-start" && (!source || source.hp.current <= 0)) continue;
      events.push(...dealOngoingDamage(state, bearer, effect, deps));
      const stillOn = bearer.effects.some((candidate) => candidate.id === effect.id);
      if (ongoing.saveToEnd && stillOn && deps.newId)
        events.push(
          openEndingSave(state, bearer, effect, ongoing.saveToEnd, "makes", {
            newId: deps.newId,
            now: deps.now ?? (() => new Date().toISOString())
          })
        );
    }
  }
}

/** SRD Champion, Heroic Warrior: "During combat, you can give yourself Heroic Inspiration whenever you start your turn
 *  without it." Taking it costs nothing, so it is given. */
function heroicWarrior(state: GameState, actorId: string, events: EffectNarration[], deps: TurnStartDeps): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor || actor.heroicInspiration || actor.hp.current <= 0 || !actor.definitionId) return;
  if (!holdsFeature(deps.resolveDefinition(actor.definitionId), "heroic-warrior", "Heroic Warrior")) return;
  actor.heroicInspiration = true;
  events.push({ kind: "effect", text: `${actor.name} gains Heroic Inspiration (Heroic Warrior).`, actorId });
}

/** A defeated creature, or a character already dead, takes no more turn-start damage; a dying one does (SRD: damage
 *  at 0 HP is a failed death save). */
const beyondHarm = (actor: Actor) =>
  actor.hp.current <= 0 && (actor.kind !== "player-character" || (actor.deathSaves?.failures ?? 0) >= 3);

const capitalised = (type: string) => (type.length > 0 ? `${type[0].toUpperCase()}${type.slice(1)}` : type);

function dealOngoingDamage(state: GameState, bearer: Actor, effect: Effect, deps: TurnStartDeps): EffectNarration[] {
  const parts = effect.ongoingDamage!.damage.map((part) => ({
    amount: Math.max(0, resolveDice(parseDiceFormula(part.formula), deps.rollDie).total),
    type: part.type
  }));
  const { application, events } = applyDamageDetailed(
    state,
    bearer.id,
    {
      amount: parts.reduce((sum, part) => sum + part.amount, 0),
      parts,
      sourceName: effect.sourceName,
      sourceActorId: effect.sourceActorId
    },
    { role: "gm" },
    {
      resolveDefinition: deps.resolveDefinition,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      ...(deps.newId ? { newId: deps.newId } : {}),
      ...(deps.now ? { now: deps.now } : {})
    }
  );
  const typed = parts.length === 1 ? ` ${capitalised(parts[0].type)}` : "";
  return [
    {
      kind: "damage",
      text: `${bearer.name} takes ${application.totalApplied}${typed} damage from ${effect.name}${damageAdjustmentDetail(application)}.`,
      actorId: bearer.id,
      ...sourceOf(effect)
    },
    ...events
  ];
}

/** One pending save per repeating effect the creature bears. An unanswered one from its last turn is replaced. */
export function openRepeatSaves(state: GameState, actorId: string, deps: TurnEndDeps): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return [];
  return actor.effects.flatMap((effect) =>
    effect.repeatSave ? [openEndingSave(state, actor, effect, effect.repeatSave, "repeats", deps)] : []
  );
}

/** A save the bearer owes against one of its effects, a success ending it (`repeatOf`): repeated at the end of its
 *  turn, or made once its ongoing damage lands. */
function openEndingSave(
  state: GameState,
  bearer: Actor,
  effect: Effect,
  save: Readonly<{ ability: AbilityId; dc: number }>,
  verb: "repeats" | "makes",
  deps: TurnEndDeps
): EffectNarration {
  createPendingSaves(state, {
    sourceActorId: effect.sourceActorId,
    sourceName: effect.sourceName ?? effect.name,
    actionName: `${effect.name} - ${verb === "repeats" ? "repeat save" : "save"}`.slice(0, 120),
    ability: save.ability,
    dc: save.dc,
    targetIds: [bearer.id],
    proposedDamage: 0,
    halfOnSuccess: false,
    conditionIds: [],
    repeatOf: { actorId: bearer.id, effectId: effect.id },
    newSaveId: deps.newId,
    createdAt: Date.parse(deps.now())
  });
  return {
    kind: "condition",
    text: `${bearer.name} ${verb} the ${save.ability.toUpperCase()} save against ${effect.name} (DC ${save.dc}); a success ends it.`,
    actorId: bearer.id,
    ...sourceOf(effect)
  };
}

import type { AbilityId, GameState } from "@vtt/domain";
import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { holdsFeature } from "./class-features.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { expireEffectsAtTurnEnd, sourceOf, type EffectNarration } from "./effects.js";
import { applyDamageDetailed, damageAdjustmentDetail, loseHitPoints, UNTYPED_DAMAGE } from "./hit-points.js";
import { holyNimbusBurns } from "./paladin-auras.js";
import { createPendingSaves } from "./saving-throws.js";
import { traitsAtTurnEnd, traitsAtTurnStart } from "./trait-turns.js";

type Actor = GameState["actors"][number];
type Effect = Actor["effects"][number];

/** What the end-of-turn step needs to open prompts; without it (scene bookkeeping) durations still end. With dice and
 *  the stat blocks, a trait that burns as its bearer's turn ends (Fire Aura) deals its damage too. */
export type TurnEndDeps = Readonly<{
  newId: () => string;
  now: () => string;
  rollDie?: (sides: number) => number;
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
}>;

/** What the start-of-turn step needs to roll ongoing damage and weigh it; prompts open only with `newId`. */
export type TurnStartDeps = Readonly<{
  rollDie: (sides: number) => number;
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  newId?: () => string;
  now?: () => string;
  /** Creature-to-creature distance on the map, for the auras a creature starts its turn in. */
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
}>;

/**
 * SRD: "at the end of its turn". When `actorId`'s turn ends, before the next begins:
 * 1. "until the end of its/your next turn" durations it owns end (`expireEffectsAtTurnEnd`);
 * 2. each effect it bears that "repeats the save at the end of each of its turns" opens that save, a success ending
 *    the effect (`openRepeatSaves`);
 * 3. its stat block's traits that act as its turn ends (Fire Aura) do (`traitsAtTurnEnd`), and the ongoing damage
 *    printed for the end of a turn lands.
 */
export function endOfTurn(state: GameState, actorId: string, events: EffectNarration[], deps?: TurnEndDeps): void {
  events.push(...expireEffectsAtTurnEnd(state, actorId));
  if (deps) events.push(...openRepeatSaves(state, actorId, deps));
  if (!deps?.rollDie || !deps.resolveDefinition) return;
  const dice = { ...deps, rollDie: deps.rollDie, resolveDefinition: deps.resolveDefinition };
  events.push(...traitsAtTurnEnd(state, actorId, dice));
  // "Takes 10 (3d6) Acid damage at the end of each of the toad's turns."
  dealOngoingAt(state, actorId, "end", events, dice);
}

/**
 * SRD: "at the start of each of its turns". When `actorId`'s turn starts, once its durations have ticked
 * (`expireEffectsAtTurnStart`), each effect whose ongoing damage falls on this turn deals it: one the creature bears
 * ("each of its turns") or one it is the source of ("each of the behir's turns"; a source at 0 HP has no turns to
 * deal it on). The dice roll here and the damage meets the bearer's defences like any hit. A save that follows the
 * damage opens next, a success ending the effect (Searing Smite). Before that, its stat block's traits act
 * (`traitsAtTurnStart`: Regeneration, Berserk, Barbed Hide) and the auras it starts its turn in ask their saves.
 */
export function startOfTurn(state: GameState, actorId: string, events: EffectNarration[], deps: TurnStartDeps): void {
  heroicWarrior(state, actorId, events, deps);
  events.push(...traitsAtTurnStart(state, actorId, deps));
  holyNimbus(state, actorId, events, deps);
  dealOngoingAt(state, actorId, "start", events, deps);
}

/** SRD Holy Nimbus: an enemy that starts its turn in the Paladin's aura takes its Radiant damage, which meets the
 *  creature's defences like any damage. Unmeasurable on a map that can't say where creatures stand. */
function holyNimbus(state: GameState, actorId: string, events: EffectNarration[], deps: TurnStartDeps): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return;
  for (const { paladin, amount } of holyNimbusBurns(state, actor, deps)) {
    const { application, events: landed } = applyDamageDetailed(
      state,
      actor.id,
      { amount, parts: [{ amount, type: "radiant" }], sourceName: paladin.name, sourceActorId: paladin.id },
      { role: "gm" },
      {
        resolveDefinition: deps.resolveDefinition,
        rollDie: deps.rollDie,
        ...(deps.catalog ? { catalog: deps.catalog } : {}),
        ...(deps.newId ? { newId: deps.newId } : {}),
        ...(deps.now ? { now: deps.now } : {}),
        ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {})
      }
    );
    events.push(
      {
        kind: "damage",
        text: `${actor.name} takes ${application.totalApplied} Radiant damage from ${paladin.name}'s Holy Nimbus${damageAdjustmentDetail(application)}.`,
        actorId: actor.id,
        source: { actorId: paladin.id, name: paladin.name }
      },
      ...landed
    );
  }
}

/** The ongoing damage (or hit point loss) that falls as `actorId`'s turn starts or ends: an effect it bears ("each of
 *  its turns") or one it is the source of ("each of the behir's turns"; a source at 0 HP has no turns to deal it on). */
function dealOngoingAt(
  state: GameState,
  actorId: string,
  boundary: "start" | "end",
  events: EffectNarration[],
  deps: TurnStartDeps
): void {
  const inFight = new Set(state.combat.initiative.map((entry) => entry.actorId));
  for (const bearer of state.actors) {
    if (!inFight.has(bearer.id)) continue;
    for (const effect of [...bearer.effects]) {
      const ongoing = effect.ongoingDamage;
      if (!ongoing || !ongoing.at.endsWith(`-turn-${boundary}`)) continue;
      const bearers = ongoing.at.startsWith("bearer-");
      if ((bearers ? bearer.id : effect.sourceActorId) !== actorId) continue;
      // Damage dealt earlier this turn may have ended it (a death, a cascade).
      if (!bearer.effects.some((candidate) => candidate.id === effect.id) || beyondHarm(bearer)) continue;
      const source = state.actors.find((candidate) => candidate.id === effect.sourceActorId);
      if (!bearers && (!source || source.hp.current <= 0)) continue;
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
  const ongoing = effect.ongoingDamage!;
  const rolled = ongoing.damage.map((part) => ({
    amount: Math.max(0, resolveDice(parseDiceFormula(part.formula), deps.rollDie).total),
    type: part.type ?? UNTYPED_DAMAGE
  }));
  const damageDeps = {
    resolveDefinition: deps.resolveDefinition,
    rollDie: deps.rollDie,
    ...(deps.catalog ? { catalog: deps.catalog } : {}),
    ...(deps.newId ? { newId: deps.newId } : {}),
    ...(deps.now ? { now: deps.now } : {})
  };
  // "Loses 5 (1d10) Hit Points": no damage, so nothing meets it.
  if (ongoing.hitPointLoss) {
    const total = rolled.reduce((sum, part) => sum + part.amount, 0);
    const { lost, events } = loseHitPoints(state, bearer.id, total, damageDeps);
    return [
      {
        kind: "damage",
        text: `${bearer.name} loses ${lost} hit points to ${effect.name}.`,
        actorId: bearer.id,
        ...sourceOf(effect)
      },
      ...events
    ];
  }
  const { application, events } = applyDamageDetailed(
    state,
    bearer.id,
    {
      amount: rolled.reduce((sum, part) => sum + part.amount, 0),
      parts: rolled,
      sourceName: effect.sourceName,
      sourceActorId: effect.sourceActorId
    },
    { role: "gm" },
    damageDeps
  );
  const typed = rolled.length === 1 && rolled[0].type !== UNTYPED_DAMAGE ? ` ${capitalised(rolled[0].type)}` : "";
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
    // Repeated against a spell's effect (Hold Person), it is still a save against magic.
    magical: effect.magical === true,
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

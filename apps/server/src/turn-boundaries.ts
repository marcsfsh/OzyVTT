import { isDead, type GameState } from "@vtt/domain";
import { abilityModifier, parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { calmAtTurnStart } from "./berserker-axe.js";
import { breathAtTurnEnd } from "./breath.js";
import { holdsFeature } from "./class-features.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { endEffect, expireEffectsAtTurnEnd, sourceOf, type EffectNarration } from "./effects.js";
import { applyDamageDetailed, damageAdjustmentDetail, healActor, loseHitPoints, UNTYPED_DAMAGE } from "./hit-points.js";
import { confusedTurn } from "./random-outcomes.js";
import { holyNimbusBurns } from "./paladin-auras.js";
import { endEffectsOutOfSight, openEndingSave, openRepeatSaves } from "./save-stages.js";
import { sceneSight, type SceneSight } from "./vision/sight.js";
import {
  aurasAtTurnStart,
  aurasSavingAtTurnEnd,
  burningTraitsAtTurnEnd,
  ownTraitsAtTurnStart,
  type TraitStep
} from "./trait-turns.js";
import { deathTraitsAtTurnEnd, headsAtTurnEnd } from "./death-traits.js";
import { riseAtTurnStart } from "./risen.js";
import {
  askOrder,
  clearTurnSteps,
  inOrder,
  orderOf,
  runSteps,
  waitingNarration,
  waitingSteps,
  type TurnStep
} from "./simultaneous-effects.js";
import { disgorge, regurgitationSaves } from "./swallow.js";

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
  /** Two or more steps at once wait for the creature's controller to order them (`simultaneous-effects.ts`). */
  askOrder?: boolean;
}>;

/**
 * SRD: "at the end of its turn". When `actorId`'s turn ends, before the next begins:
 * 1. "until the end of its/your next turn" durations it owns end (`expireEffectsAtTurnEnd`);
 * 2. each effect it bears that "repeats the save at the end of each of its turns" opens that save (`openRepeatSaves`:
 *    a success ends the effect, unless the text counts them or makes the failure worse);
 * 3. its stat block's traits that act as its turn ends (Fire Aura, a hydra's heads) do, and the ongoing damage printed
 *    for the end of a turn lands, in the order its controller gave (`endSteps`), then a troll's limbs come off.
 */
export function endOfTurn(state: GameState, actorId: string, events: EffectNarration[], deps?: TurnEndDeps): void {
  events.push(...expireEffectsAtTurnEnd(state, actorId));
  // SRD Suffocation: a round of held breath, or once it is out, a level of Exhaustion "at the end of each of its turns".
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (actor) events.push(...breathAtTurnEnd(state, actor));
  if (deps) {
    const sees = sightOf(state, deps);
    events.push(...endEffectsOutOfSight(state, actorId, { ...deps, sees }));
    events.push(...openRepeatSaves(state, actorId, "turn-end", { ...deps, sees }));
  }
  if (!deps?.rollDie || !deps.resolveDefinition) {
    clearTurnSteps(state);
    return;
  }
  const dice = { ...deps, rollDie: deps.rollDie, resolveDefinition: deps.resolveDefinition };
  events.push(...aurasSavingAtTurnEnd(state, actorId, dice));
  const waiting = waitingSteps(state, actorId, "end");
  events.push(...runSteps(inOrder(endSteps(state, actorId, dice), waiting ? orderOf(waiting) : undefined)));
  clearTurnSteps(state);
  // A Bloodied troll loses a limb (Loathsome Limbs), and a hydra's lost-head count starts again.
  events.push(...deathTraitsAtTurnEnd(state, actorId, dice));
  // "If the behir takes 30 damage or more on a single turn from the swallowed creature, the behir must succeed on a
  // DC 14 Constitution saving throw at the end of that turn".
  events.push(...regurgitationSaves(state, { ...deps, resolveDefinition: deps.resolveDefinition }));
}

/**
 * What happens at once as `actorId`'s turn ends, each a step its controller may order: the auras that burn what is
 * near it (Fire Aura), a hydra's heads growing back, and the ongoing damage printed for the end of a turn ("Takes 10
 * (3d6) Acid damage at the end of each of the toad's turns"). `ending` names effects that end with the turn before
 * any of this happens, for an order asked before the turn's durations lapse.
 */
export function endSteps(
  state: GameState,
  actorId: string,
  deps: TurnStartDeps,
  ending: ReadonlySet<string> = new Set()
): TurnStep[] {
  const heads = headsAtTurnEnd(state, actorId, deps);
  return [
    ...burningTraitsAtTurnEnd(state, actorId, deps).map((trait) => traitStep("aura", trait)),
    ...(heads ? [traitStep("heads", heads)] : []),
    ...ongoingSteps(state, actorId, "end", deps).filter((step) => !ending.has(step.key.split(":")[2] ?? ""))
  ];
}

/**
 * Before the turn passes: two or more things happening at once as it ends wait for its creature's controller to put
 * them in order, and the turn stays with it until the answer (`turn.order`). What the turn's start left waiting happens
 * first, as it was listed. Returns whether the turn now waits.
 */
export function askEndOrder(
  state: GameState,
  events: EffectNarration[],
  deps: TurnStartDeps & Readonly<{ newId: () => string }>
): boolean {
  const actorId = state.combat.turnActorId;
  if (!state.combat.active || !actorId || state.combat.historyCursor !== null) return false;
  // Asked already: ending the turn again goes in the order listed.
  if (waitingSteps(state, actorId, "end")) return false;
  events.push(...playStartSteps(state, deps));
  const steps = endSteps(state, actorId, deps, endingWithTurn(state, actorId));
  if (!askOrder(state, actorId, "end", steps, deps.newId)) return false;
  events.push(waitingNarration(state, state.combat.turnSteps!));
  return true;
}

/** The effects whose "until the end of its turn" durations lapse as `actorId`'s turn ends. */
export function endingWithTurn(state: GameState, actorId: string): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const actor of state.actors)
    for (const effect of actor.effects) {
      const duration = effect.duration;
      if (duration.type !== "until-bearer-turn-end" && duration.type !== "until-source-turn-end") continue;
      const owner = duration.type === "until-bearer-turn-end" ? actor.id : (effect.sourceActorId ?? actor.id);
      if (owner === actorId && !duration.skipsCurrentTurn) ids.add(effect.id);
    }
  return ids;
}

const traitStep = (kind: string, trait: TraitStep): TurnStep => ({
  key: `${kind}:${trait.name}`,
  name: trait.name,
  run: trait.run
});

/** Whether one creature sees another on the live map, worked out only when a rule asks; true when vision is off, so a
 *  rule that needs a creature out of sight leaves it to the GM. */
function sightOf(state: GameState, deps: TurnEndDeps): (viewerId: string, targetId: string) => boolean {
  let sight: SceneSight | null = null;
  return (viewerId, targetId) => {
    sight ??= sceneSight(state, {
      ...(deps.resolveDefinition ? { definition: deps.resolveDefinition } : {}),
      ...(deps.catalog ? { catalog: deps.catalog } : {})
    });
    return !sight.enabled || sight.sees(viewerId, targetId);
  };
}

/**
 * SRD: "at the start of each of its turns". When `actorId`'s turn starts, once its durations have ticked
 * (`expireEffectsAtTurnStart`), each effect whose ongoing damage falls on this turn deals it: one the creature bears
 * ("each of its turns") or one it is the source of ("each of the behir's turns"; a source at 0 HP has no turns to
 * deal it on). The dice roll here and the damage meets the bearer's defences like any hit. A save that follows the
 * damage opens next, a success ending the effect (Searing Smite). Its stat block's traits act (Regeneration, Berserk,
 * Barbed Hide), and so do Temporary Hit Points and Hit Points it regains each turn: two or more of these at once wait
 * for its controller's order when `askOrder` says so (`startSteps`). Then the auras it starts its turn in ask their
 * saves.
 */
export function startOfTurn(state: GameState, actorId: string, events: EffectNarration[], deps: TurnStartDeps): void {
  // "A Humanoid killed by this spell rises at the start of your next turn as a Zombie" (Finger of Death).
  if (deps.newId)
    events.push(
      ...riseAtTurnStart(state, actorId, {
        resolveDefinition: deps.resolveDefinition,
        newId: deps.newId,
        ...(deps.catalog ? { catalog: deps.catalog } : {})
      })
    );
  heroicWarrior(state, actorId, events, deps);
  // "At the start of each of its turns, the Restrained target repeats the save" (Conjure Elemental).
  if (deps.newId)
    events.push(
      ...openRepeatSaves(state, actorId, "turn-start", {
        newId: deps.newId,
        now: deps.now ?? (() => new Date().toISOString()),
        rollDie: deps.rollDie
      })
    );
  // SRD Confusion: "it rolls 1d10 at the start of each of its turns to determine its behavior for that turn".
  events.push(...confusedTurn(state, actorId, deps.rollDie));
  // A Berserker Axe's berserk ends on a turn that starts with no creature within 60 feet.
  const calm = calmAtTurnStart(state, actorId, deps.distanceFeet);
  if (calm) events.push(...endEffect(state, actorId, calm));
  const steps = startSteps(state, actorId, deps);
  if (deps.askOrder && deps.newId && askOrder(state, actorId, "start", steps, deps.newId))
    events.push(waitingNarration(state, state.combat.turnSteps!));
  else events.push(...runSteps(steps));
  events.push(...aurasAtTurnStart(state, actorId, deps));
}

/**
 * What happens at once as `actorId`'s turn starts, each a step its controller may order: Temporary Hit Points and Hit
 * Points it regains each turn (Heroism, Regenerate, Heroic Rally), its stat block's traits (Regeneration, Berserk,
 * Barbed Hide, Sunlight), a Paladin's Holy Nimbus, and the ongoing damage that falls now.
 */
export function startSteps(state: GameState, actorId: string, deps: TurnStartDeps): TurnStep[] {
  return [
    ...temporaryHitPointSteps(state, actorId),
    ...hitPointSteps(state, actorId, deps),
    ...ownTraitsAtTurnStart(state, actorId, deps).map((trait) => traitStep("trait", trait)),
    ...holyNimbusSteps(state, actorId, deps),
    ...ongoingSteps(state, actorId, "start", deps)
  ];
}

/** Plays out the steps waiting as `actorId`'s turn started, in `order` or as they were listed. */
export function playStartSteps(state: GameState, deps: TurnStartDeps, order?: readonly string[]): EffectNarration[] {
  const waiting = state.combat.turnSteps;
  if (!waiting || waiting.boundary !== "start") return [];
  clearTurnSteps(state);
  return runSteps(inOrder(startSteps(state, waiting.actorId, deps), order ?? orderOf(waiting)));
}

/** SRD Holy Nimbus: an enemy that starts its turn in the Paladin's aura takes its Radiant damage, which meets the
 *  creature's defences like any damage. Unmeasurable on a map that can't say where creatures stand. */
function holyNimbusSteps(state: GameState, actorId: string, deps: TurnStartDeps): TurnStep[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return [];
  return holyNimbusBurns(state, actor, deps).map(({ paladin, amount }) => ({
    key: `nimbus:${paladin.id}`,
    name: "Holy Nimbus",
    sourceActorId: paladin.id,
    sourceName: paladin.name,
    run: () => (actor.hp.current > 0 ? holyNimbus(state, actor, paladin, amount, deps) : [])
  }));
}

function holyNimbus(
  state: GameState,
  actor: Actor,
  paladin: Actor,
  amount: number,
  deps: TurnStartDeps
): EffectNarration[] {
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
  return [
    {
      kind: "damage",
      text: `${actor.name} takes ${application.totalApplied} Radiant damage from ${paladin.name}'s Holy Nimbus${damageAdjustmentDetail(application)}.`,
      actorId: actor.id,
      source: { actorId: paladin.id, name: paladin.name }
    },
    ...landed
  ];
}

/** The ongoing damage (or hit point loss) that falls as `actorId`'s turn starts or ends: an effect it bears ("each of
 *  its turns") or one it is the source of ("each of the behir's turns"; a source at 0 HP has no turns to deal it on).
 *  One step per effect, keyed `ongoing:<bearer>:<effect>`. */
function ongoingSteps(state: GameState, actorId: string, boundary: "start" | "end", deps: TurnStartDeps): TurnStep[] {
  const inFight = new Set(state.combat.initiative.map((entry) => entry.actorId));
  const steps: TurnStep[] = [];
  for (const bearer of state.actors) {
    if (!inFight.has(bearer.id) || beyondHarm(bearer)) continue;
    for (const effect of bearer.effects) {
      const ongoing = effect.ongoingDamage;
      if (!ongoing || !ongoing.at.endsWith(`-turn-${boundary}`)) continue;
      const bearers = ongoing.at.startsWith("bearer-");
      if ((bearers ? bearer.id : effect.sourceActorId) !== actorId) continue;
      const source = state.actors.find((candidate) => candidate.id === effect.sourceActorId);
      if (!bearers && (!source || source.hp.current <= 0)) continue;
      // "At the end of the frog's next turn": not the turn it swallowed on.
      if (ongoing.disgorges && effect.startedRound === state.combat.round) continue;
      steps.push({
        key: `ongoing:${bearer.id}:${effect.id}`,
        name: effect.name,
        ...(bearer.id !== actorId ? { targetActorId: bearer.id, targetName: bearer.name } : {}),
        sourceActorId: effect.sourceActorId,
        sourceName: effect.sourceName,
        run: () => ongoingDamageNow(state, bearer.id, effect.id, deps)
      });
    }
  }
  return steps;
}

/** One effect's ongoing damage, unless what landed before it ended the effect or its bearer (a death, a cascade). A
 *  save that follows the damage opens next, a success ending the effect. */
function ongoingDamageNow(
  state: GameState,
  bearerId: string,
  effectId: string,
  deps: TurnStartDeps
): EffectNarration[] {
  const bearer = state.actors.find((candidate) => candidate.id === bearerId);
  const effect = bearer?.effects.find((candidate) => candidate.id === effectId);
  if (!bearer || !effect?.ongoingDamage || beyondHarm(bearer)) return [];
  const ongoing = effect.ongoingDamage;
  if (!ongoing.at.startsWith("bearer-")) {
    const source = state.actors.find((candidate) => candidate.id === effect.sourceActorId);
    if (!source || source.hp.current <= 0) return [];
  }
  const events = dealOngoingDamage(state, bearer, effect, deps);
  const stillOn = bearer.effects.some((candidate) => candidate.id === effect.id);
  // A swallowed creature still alive is regurgitated after the damage (a giant toad's Swallow).
  if (ongoing.disgorges && stillOn && !isDead(bearer)) return [...events, ...disgorge(state, bearer, effect.id)];
  if (ongoing.saveToEnd && stillOn && deps.newId)
    events.push(
      openEndingSave(state, bearer, effect, ongoing.saveToEnd, "makes", {
        newId: deps.newId,
        now: deps.now ?? (() => new Date().toISOString())
      })
    );
  return events;
}

/** SRD Heroism: "gains Temporary Hit Points equal to your spellcasting ability modifier at the start of each of its
 *  turns". Temporary Hit Points don't add up, so the creature keeps the higher of what it has and the new. */
function temporaryHitPointSteps(state: GameState, actorId: string): TurnStep[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor || actor.hp.current <= 0) return [];
  return actor.effects
    .filter((effect) => (effect.temporaryHitPointsEachTurn ?? 0) > actor.hp.temporary)
    .map((effect) => ({
      key: `temporary:${effect.id}`,
      name: effect.name,
      sourceActorId: effect.sourceActorId,
      sourceName: effect.sourceName,
      run: () => {
        const now = state.actors.find((candidate) => candidate.id === actorId);
        const amount = effect.temporaryHitPointsEachTurn ?? 0;
        if (!now || now.hp.current <= 0 || amount <= now.hp.temporary) return [];
        if (!now.effects.some((candidate) => candidate.id === effect.id)) return [];
        now.hp = { ...now.hp, temporary: amount };
        return [
          {
            kind: "effect",
            text: `${now.name} gains ${amount} Temporary Hit Points (${effect.name}).`,
            actorId,
            ...sourceOf(effect)
          }
        ];
      }
    }));
}

/** Hit points an effect restores at the start of each of its bearer's turns (SRD Regenerate: "regains 1 Hit Point at
 *  the start of each of its turns"), and the Champion's Heroic Rally ("5 plus your Constitution modifier if you are
 *  Bloodied and have at least 1 Hit Point"), each read when its turn in the order comes. Through the healing rules, so
 *  a dying creature wakes and the dead don't. */
function hitPointSteps(state: GameState, actorId: string, deps: TurnStartDeps): TurnStep[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor || isDead(actor)) return [];
  const heal = (amountNow: (now: Actor) => number, source: string, effect?: Effect) => (): EffectNarration[] => {
    const now = state.actors.find((candidate) => candidate.id === actorId);
    if (!now || isDead(now) || now.hp.current >= now.hp.maximum) return [];
    if (effect && !now.effects.some((candidate) => candidate.id === effect.id)) return [];
    const amount = amountNow(now);
    if (amount <= 0) return [];
    const before = now.hp.current;
    const woke = healActor(state, now.id, amount, { role: "gm" });
    const regained = now.hp.current - before;
    return [
      ...(regained > 0
        ? [
            {
              kind: "effect" as const,
              text: `${now.name} regains ${regained} ${regained === 1 ? "hit point" : "hit points"} (${source}).`,
              actorId,
              ...(effect ? sourceOf(effect) : {})
            }
          ]
        : []),
      ...woke
    ];
  };
  const room = actor.hp.current < actor.hp.maximum;
  const steps: TurnStep[] = actor.effects
    .filter((effect) => room && (effect.hitPointsEachTurn ?? 0) > 0)
    .map((effect) => ({
      key: `regains:${effect.id}`,
      name: effect.name,
      sourceActorId: effect.sourceActorId,
      sourceName: effect.sourceName,
      run: heal(() => effect.hitPointsEachTurn ?? 0, effect.name, effect)
    }));
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  const bloodied = (now: Actor) => now.hp.current >= 1 && now.hp.current * 2 <= now.hp.maximum;
  if (room && bloodied(actor) && definition && holdsFeature(definition, "survivor", "Survivor")) {
    const rally = Math.max(0, 5 + abilityModifier(definition.abilityScores.con));
    if (rally > 0)
      steps.push({
        key: "regains:heroic-rally",
        name: "Heroic Rally",
        // "If you are Bloodied": what landed before it can lift the creature out of it.
        run: heal((now) => (bloodied(now) ? rally : 0), "Heroic Rally")
      });
  }
  return steps;
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

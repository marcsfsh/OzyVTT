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
import { traitsAtTurnEnd, traitsAtTurnStart } from "./trait-turns.js";
import { deathTraitsAtTurnEnd } from "./death-traits.js";
import { riseAtTurnStart } from "./risen.js";
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
}>;

/**
 * SRD: "at the end of its turn". When `actorId`'s turn ends, before the next begins:
 * 1. "until the end of its/your next turn" durations it owns end (`expireEffectsAtTurnEnd`);
 * 2. each effect it bears that "repeats the save at the end of each of its turns" opens that save (`openRepeatSaves`:
 *    a success ends the effect, unless the text counts them or makes the failure worse);
 * 3. its stat block's traits that act as its turn ends (Fire Aura) do (`traitsAtTurnEnd`), and the ongoing damage
 *    printed for the end of a turn lands.
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
  if (!deps?.rollDie || !deps.resolveDefinition) return;
  const dice = { ...deps, rollDie: deps.rollDie, resolveDefinition: deps.resolveDefinition };
  events.push(...traitsAtTurnEnd(state, actorId, dice));
  // A hydra grows back its heads and a Bloodied troll loses a limb (Multiple Heads, Loathsome Limbs).
  events.push(...deathTraitsAtTurnEnd(state, actorId, dice));
  // "Takes 10 (3d6) Acid damage at the end of each of the toad's turns."
  dealOngoingAt(state, actorId, "end", events, dice);
  // "If the behir takes 30 damage or more on a single turn from the swallowed creature, the behir must succeed on a
  // DC 14 Constitution saving throw at the end of that turn".
  events.push(...regurgitationSaves(state, { ...deps, resolveDefinition: deps.resolveDefinition }));
}

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
 * damage opens next, a success ending the effect (Searing Smite). Before that, its stat block's traits act
 * (`traitsAtTurnStart`: Regeneration, Berserk, Barbed Hide) and the auras it starts its turn in ask their saves.
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
  temporaryHitPointsEachTurn(state, actorId, events);
  // SRD Confusion: "it rolls 1d10 at the start of each of its turns to determine its behavior for that turn".
  events.push(...confusedTurn(state, actorId, deps.rollDie));
  // A Berserker Axe's berserk ends on a turn that starts with no creature within 60 feet.
  const calm = calmAtTurnStart(state, actorId, deps.distanceFeet);
  if (calm) events.push(...endEffect(state, actorId, calm));
  hitPointsEachTurn(state, actorId, events, deps);
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
      // "At the end of the frog's next turn": not the turn it swallowed on.
      if (ongoing.disgorges && effect.startedRound === state.combat.round) continue;
      events.push(...dealOngoingDamage(state, bearer, effect, deps));
      const stillOn = bearer.effects.some((candidate) => candidate.id === effect.id);
      if (ongoing.disgorges && stillOn && !isDead(bearer)) {
        events.push(...disgorge(state, bearer, effect.id));
        continue;
      }
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

/** SRD Heroism: "gains Temporary Hit Points equal to your spellcasting ability modifier at the start of each of its
 *  turns". Temporary Hit Points don't add up, so the creature keeps the higher of what it has and the new. */
function temporaryHitPointsEachTurn(state: GameState, actorId: string, events: EffectNarration[]): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor || actor.hp.current <= 0) return;
  for (const effect of actor.effects) {
    const amount = effect.temporaryHitPointsEachTurn;
    if (amount === undefined || amount <= actor.hp.temporary) continue;
    actor.hp = { ...actor.hp, temporary: amount };
    events.push({
      kind: "effect",
      text: `${actor.name} gains ${amount} Temporary Hit Points (${effect.name}).`,
      actorId,
      ...sourceOf(effect)
    });
  }
}

/** Hit points an effect restores at the start of each of its bearer's turns (SRD Regenerate: "regains 1 Hit Point at
 *  the start of each of its turns"), and the Champion's Heroic Rally ("5 plus your Constitution modifier if you are
 *  Bloodied and have at least 1 Hit Point"). Through the healing rules, so a dying creature wakes and the dead don't. */
function hitPointsEachTurn(state: GameState, actorId: string, events: EffectNarration[], deps: TurnStartDeps): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor || isDead(actor)) return;
  const heals: Array<Readonly<{ amount: number; source: string; effect?: (typeof actor.effects)[number] }>> =
    actor.effects.flatMap((effect) =>
      effect.hitPointsEachTurn !== undefined ? [{ amount: effect.hitPointsEachTurn, source: effect.name, effect }] : []
    );
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  const bloodied = actor.hp.current >= 1 && actor.hp.current * 2 <= actor.hp.maximum;
  if (bloodied && definition && holdsFeature(definition, "survivor", "Survivor"))
    heals.push({ amount: Math.max(0, 5 + abilityModifier(definition.abilityScores.con)), source: "Heroic Rally" });
  for (const heal of heals) {
    if (heal.amount <= 0 || actor.hp.current >= actor.hp.maximum) continue;
    const before = actor.hp.current;
    const woke = healActor(state, actor.id, heal.amount, { role: "gm" });
    const regained = actor.hp.current - before;
    if (regained > 0)
      events.push({
        kind: "effect",
        text: `${actor.name} regains ${regained} ${regained === 1 ? "hit point" : "hit points"} (${heal.source}).`,
        actorId,
        ...(heal.effect ? sourceOf(heal.effect) : {})
      });
    events.push(...woke);
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

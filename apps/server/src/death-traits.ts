import { ALIVE_AT_ZERO_TAG, type GameState } from "@vtt/domain";
import { normalizeDamageType } from "@vtt/rules-5e";
import type { ActorAction, ActorDefinition, TraitMechanic } from "@vtt/schemas";
import { setCondition } from "./actor-conditions.js";
import { stampDeath } from "./death.js";
import {
  addEffect,
  CANT_SPEAK_TAG,
  endEffect,
  makeEffect,
  NO_ACTIONS_TAG,
  reduceExhaustion,
  type EffectNarration
} from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { raiseCreature } from "./risen.js";
import { traitMechanicsOf, traitOf } from "./statblock-traits.js";
import { sightRules } from "./vision/rules.js";

/**
 * The stat block traits that cheat death or come apart as they take damage (SRD 5.2.1 monsters): a vampire's Misty
 * Escape, the Restoration traits of fiends, celestials and the lich, a hydra's Multiple Heads and a troll's Loathsome
 * Limbs. Damage is tallied for the turn it lands in (`turnUses`, which every new turn clears), and what the traits do
 * at a turn's end runs from `turn-boundaries.ts`.
 */

type Actor = GameState["actors"][number];
type Heads = Extract<TraitMechanic, { kind: "multiple-heads" }>;
type Limbs = Extract<TraitMechanic, { kind: "severed-limbs" }>;

type TraitDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  newId?: () => string;
}>;

/** The damage a creature took this turn, and its Slashing part, kept per turn. */
const TURN_DAMAGE = "damage-taken";
const TURN_SLASHING = "slashing-taken";
const TURN_HEAD_LOST = "head-lost";
/** A hydra's heads now, those lost since its last turn, and the Fire it took since then. */
export const HEADS_KEY = "multiple-heads:heads";
const HEADS_LOST = "multiple-heads:lost";
const HEADS_BURNED = "multiple-heads:burned";
/** A troll's limbs severed today, and those still missing. */
const LIMBS_SEVERED = "severed-limbs:used";
const LIMBS_MISSING = "severed-limbs:missing";

const turnKey = (actorId: string, key: string) => `${actorId}:${key}`;
const definitionOf = (actor: Actor, deps: Pick<TraitDeps, "resolveDefinition"> | undefined) =>
  actor.definitionId ? deps?.resolveDefinition(actor.definitionId) : undefined;

/**
 * SRD Misty Escape (the vampire): "If the vampire drops to 0 Hit Points outside its resting place, the vampire uses
 * Shape-Shift to become mist (no action required). If it can't use Shape-Shift, it is destroyed." It lives on at 0 Hit
 * Points as mist, which can't take actions or speak; in sunlight, read with dynamic vision on, it can't shape-shift and
 * is destroyed. Running water and the 2 hours to reach its resting place are the GM's. True when it escaped.
 */
export function mistyEscape(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined,
  deps: Pick<TraitDeps, "resolveDefinition" | "catalog"> | undefined,
  events: EffectNarration[]
): boolean {
  const trait = traitOf(definition, "misty-escape");
  if (!trait) return false;
  const light = deps
    ? sightRules(state, {
        definition: deps.resolveDefinition,
        ...(deps.catalog ? { catalog: deps.catalog } : {})
      }).lightAt(actor.id)
    : null;
  if (light?.sunlight) {
    events.push({
      kind: "condition",
      text: `${actor.name} can't turn to mist in sunlight and is destroyed (${trait.name}).`,
      actorId: actor.id
    });
    return false;
  }
  addEffect(
    state,
    actor.id,
    makeEffect({
      id: `${actor.id}:misty-escape:${state.combat.round}`,
      name: `Mist at 0 HP (${trait.name})`,
      tags: [ALIVE_AT_ZERO_TAG, NO_ACTIONS_TAG, CANT_SPEAK_TAG],
      sourceActorId: actor.id,
      sourceName: actor.name,
      startedRound: state.combat.round,
      duration: { type: "manual" }
    }),
    events
  );
  events.push({
    kind: "condition",
    text: `${actor.name} drops to 0 HP and escapes as mist (${trait.name}). It must reach its resting place within 2 hours or be destroyed.`,
    actorId: actor.id
  });
  return true;
}

/** What a creature that comes back after it dies does as it dies (Diabolical Restoration, a lich's Spirit Jar): the
 *  GM hears it, and a body that disappears is gone. */
export function restorationAtDeath(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined,
  events: EffectNarration[]
): void {
  const trait = traitOf(definition, "restoration");
  if (!trait) return;
  if (trait.bodyGoes) stampDeath(state, actor, { cause: trait.name, bodyGone: true });
  events.push({
    kind: "effect",
    text: `${actor.name} may come back (${trait.name}): when and where follow its stat block and are the GM's.`,
    actorId: actor.id,
    gmOnly: true
  });
}

/** What the stat block's head count makes of its Multiattack: "makes as many Bite attacks as it has heads". */
export function withHeadCount(action: ActorAction, definition: ActorDefinition | undefined, actor: Actor | undefined) {
  const heads = traitOf(definition, "multiple-heads");
  if (!heads?.attackId || !actor || !/multiattack/i.test(action.name) || action.multiattack) return action;
  const count = Math.max(1, headsOf(actor, heads));
  const { untrackedMultiattack: _untracked, ...rest } = action;
  return { ...rest, multiattack: [{ actionId: heads.attackId, count }] };
}

const headsOf = (actor: Actor, trait: Heads) => actor.actionUses[HEADS_KEY] ?? trait.heads;

/**
 * Damage landing on a creature in a fight is tallied for the turn. SRD Multiple Heads: "Whenever the hydra takes 25
 * damage or more on a single turn, one of its heads dies. The hydra dies if all its heads are dead", and the Fire it
 * takes stops its next growth.
 */
export function tallyTurnDamage(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined,
  parts: ReadonlyArray<Readonly<{ type: string; adjusted: number }>>,
  taken: number,
  kill: (cause: string) => EffectNarration[]
): EffectNarration[] {
  if (!state.combat.active || taken <= 0 || !state.combat.initiative.some((entry) => entry.actorId === actor.id))
    return [];
  const mechanics = traitMechanicsOf(definition);
  if (!mechanics.some((trait) => trait.kind === "multiple-heads" || trait.kind === "severed-limbs")) return [];
  const slashing = parts
    .filter((part) => normalizeDamageType(part.type) === "slashing")
    .reduce((sum, part) => sum + part.adjusted, 0);
  const uses = { ...state.combat.turn.turnUses };
  uses[turnKey(actor.id, TURN_DAMAGE)] = (uses[turnKey(actor.id, TURN_DAMAGE)] ?? 0) + taken;
  if (slashing > 0) uses[turnKey(actor.id, TURN_SLASHING)] = (uses[turnKey(actor.id, TURN_SLASHING)] ?? 0) + slashing;
  state.combat = { ...state.combat, turn: { ...state.combat.turn, turnUses: uses } };
  const heads = traitOf(definition, "multiple-heads");
  if (!heads) return [];
  const events: EffectNarration[] = [];
  const burned = parts.some(
    (part) => part.adjusted > 0 && heads.stoppedBy.some((type) => type === normalizeDamageType(part.type))
  );
  if (burned) actor.actionUses = { ...actor.actionUses, [HEADS_BURNED]: 1 };
  if (uses[turnKey(actor.id, TURN_DAMAGE)]! < heads.damagePerHead || uses[turnKey(actor.id, TURN_HEAD_LOST)]) return [];
  state.combat = {
    ...state.combat,
    turn: { ...state.combat.turn, turnUses: { ...uses, [turnKey(actor.id, TURN_HEAD_LOST)]: 1 } }
  };
  const left = Math.max(0, headsOf(actor, heads) - 1);
  actor.actionUses = {
    ...actor.actionUses,
    [HEADS_KEY]: left,
    [HEADS_LOST]: (actor.actionUses[HEADS_LOST] ?? 0) + 1
  };
  events.push({
    kind: "effect",
    text: `One of ${actor.name}'s heads dies (${heads.name}): ${left} ${left === 1 ? "head" : "heads"} left.`,
    actorId: actor.id
  });
  if (left === 0 && actor.hp.current > 0) events.push(...kill(`${heads.name}: its last head died`));
  return events;
}

/** What death-cheating traits do as `actorId`'s turn ends: its own heads grow back, and every troll in the fight that
 *  ends this turn Bloodied after 15 Slashing damage loses a limb. */
export function deathTraitsAtTurnEnd(state: GameState, actorId: string, deps: TraitDeps): EffectNarration[] {
  const events: EffectNarration[] = [];
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (actor) growHeads(actor, definitionOf(actor, deps), events);
  for (const entry of [...state.combat.initiative]) {
    const troll = state.actors.find((candidate) => candidate.id === entry.actorId);
    if (troll) severLimb(state, troll, definitionOf(troll, deps), deps, events);
  }
  return events;
}

/** "At the end of each of its turns when it has at least one living head, the hydra grows two heads for each of its
 *  heads that died since its last turn, unless it has taken Fire damage since its last turn. The hydra regains 20 Hit
 *  Points when it grows new heads." */
function growHeads(actor: Actor, definition: ActorDefinition | undefined, events: EffectNarration[]): void {
  const heads = traitOf(definition, "multiple-heads");
  if (!heads) return;
  const lost = actor.actionUses[HEADS_LOST] ?? 0;
  const burned = (actor.actionUses[HEADS_BURNED] ?? 0) > 0;
  const { [HEADS_LOST]: _lost, [HEADS_BURNED]: _burned, ...rest } = actor.actionUses;
  actor.actionUses = rest;
  const now = headsOf(actor, heads);
  if (lost === 0 || now === 0 || actor.hp.current <= 0) return;
  if (burned) {
    events.push({
      kind: "effect",
      text: `${actor.name} grows no heads this turn: it took ${heads.stoppedBy.join(" or ")} damage (${heads.name}).`,
      actorId: actor.id
    });
    return;
  }
  const grown = now + 2 * lost;
  actor.actionUses = { ...actor.actionUses, [HEADS_KEY]: grown };
  const before = actor.hp.current;
  actor.hp = { ...actor.hp, current: Math.min(actor.hp.maximum, before + heads.regrowHitPoints) };
  events.push({
    kind: "effect",
    text: `${actor.name} grows ${2 * lost} heads (${grown} now) and regains ${actor.hp.current - before} hit points (${heads.name}).`,
    actorId: actor.id
  });
}

/**
 * SRD Loathsome Limbs (the troll, 4/Day): "If the troll ends any turn Bloodied and took 15+ Slashing damage during that
 * turn, one of the troll's limbs is severed, falls into the troll's space, and becomes a Troll Limb. The limb acts
 * immediately after the troll's turn. The troll has 1 Exhaustion level for each missing limb, and it grows replacement
 * limbs the next time it regains Hit Points."
 */
function severLimb(
  state: GameState,
  troll: Actor,
  definition: ActorDefinition | undefined,
  deps: TraitDeps,
  events: EffectNarration[]
): void {
  const limbs = traitOf(definition, "severed-limbs");
  if (!limbs) return;
  const slashing = state.combat.turn.turnUses[turnKey(troll.id, TURN_SLASHING)] ?? 0;
  const bloodied = troll.hp.current * 2 <= troll.hp.maximum;
  const used = troll.actionUses[LIMBS_SEVERED] ?? 0;
  if (!bloodied || slashing < limbs.slashing || used >= limbs.uses) return;
  troll.actionUses = {
    ...troll.actionUses,
    [LIMBS_SEVERED]: used + 1,
    [LIMBS_MISSING]: (troll.actionUses[LIMBS_MISSING] ?? 0) + 1
  };
  events.push(...setCondition(state, troll.id, "exhaustion", true, undefined, { role: "gm" }));
  const limb = deps.newId ? raiseLimb(state, troll, limbs, { ...deps, newId: deps.newId }) : null;
  events.push({
    kind: "effect",
    text: limb
      ? `One of ${troll.name}'s limbs is severed and becomes ${limb}, which acts right after ${troll.name} (${limbs.name}).`
      : `One of ${troll.name}'s limbs is severed and becomes a ${limbs.limbMonsterId.replace(/-/g, " ")} (${limbs.name}). Add it to the fight.`,
    actorId: troll.id
  });
}

function raiseLimb(state: GameState, troll: Actor, limbs: Limbs, deps: TraitDeps & { newId: () => string }) {
  try {
    return raiseCreature(state, { monsterId: limbs.limbMonsterId, maker: troll, at: troll, after: troll.id }, deps)
      ?.name;
  } catch {
    // A full roster leaves the limb to the GM.
    return null;
  }
}

/** What regaining Hit Points ends: the mist a vampire lives on in at 0, and a troll's missing limbs, which grow back
 *  ("it grows replacement limbs the next time it regains Hit Points") with the Exhaustion they cost. */
export function regainedHitPoints(state: GameState, actor: Actor): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const effect of actor.effects.filter((candidate) => candidate.tags.includes(ALIVE_AT_ZERO_TAG)))
    events.push(...endEffect(state, actor.id, effect.id));
  const missing = actor.actionUses[LIMBS_MISSING] ?? 0;
  if (missing > 0) {
    const { [LIMBS_MISSING]: _missing, ...rest } = actor.actionUses;
    actor.actionUses = rest;
    for (let limb = 0; limb < missing; limb += 1) reduceExhaustion(actor);
    events.push({
      kind: "effect",
      text: `${actor.name} grows back ${missing === 1 ? "its missing limb" : `${missing} missing limbs`}.`,
      actorId: actor.id
    });
  }
  return events;
}

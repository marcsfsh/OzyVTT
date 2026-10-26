import { isDead, ROUNDS_PER_MINUTE, type GameState } from "@vtt/domain";
import { parseDiceFormula, resolveDice, type RandomSource } from "@vtt/rules-5e";
import type { ActorDefinition, DamageDrain, TraitMechanic } from "@vtt/schemas";
import { clockRoundsOf, returnToLife, stampDeath } from "./death.js";
import { endEffect, type EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { removeCombatant } from "./encounter.js";
import { creatureTypeOf } from "./statblock-facts.js";
import { traitMechanicsOf, traitOf } from "./statblock-traits.js";
import { raiseCreature } from "./summons.js";
import { derivedUuid } from "./vision/cast-sight.js";

/**
 * What happens to the dead on the game clock (SRD 5.2.1 monsters):
 * - a creature whose trait brings it back comes back to life with all its Hit Points once its time has passed
 *   (Celestial Restoration's 1d6 days, Undead Restoration's 24 hours), unless what the trait names stops it first: a
 *   killer under Bless, Dispel Evil and Good cast on its remains, Holy Water sprinkled on them, or the object it needs
 *   (a mummy lord's heart, a lich's spirit jar) destroyed;
 * - a corpse rises as another creature some hours after the attack that slew it (a Shadow from a shadow's Draining
 *   Swipe);
 * - a troll's severed limb that lives 24 hours rolls its d12, and on a 12 becomes a Troll; otherwise it withers.
 * The time is kept on the death record, which no player reads; where a creature reappears is the GM's.
 */

type Actor = GameState["actors"][number];
type Restoration = Extract<TraitMechanic, { kind: "restoration" }>;
type Deps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
}>;

const ROUNDS_PER_HOUR = 60 * ROUNDS_PER_MINUTE;
/** The tag on the effect that marks a carried object (a heart, a spirit jar, a soul bag). */
export const CARRIED_OBJECT_TAG = "carried-object";

const definitionOf = (actor: Actor, deps: Pick<Deps, "resolveDefinition">) =>
  actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;

/** Whether the creature still has the object its effect tagged `tag` marks, whole (a heart not yet destroyed). */
export function hasIntactObject(actor: Pick<Actor, "effects">, tag: string): boolean {
  return actor.effects.some(
    (effect) =>
      effect.tags.includes(CARRIED_OBJECT_TAG) &&
      effect.tags.includes(tag) &&
      (effect.heldBy === undefined || effect.heldBy.hitPoints.current > 0)
  );
}

/**
 * As a creature dies: when its trait brings it back after a time, the time is rolled and kept on its death record,
 * unless its killer bore Bless and the trait says that stops it. The GM hears when, and what would stop it.
 */
export function scheduleRestoration(
  state: GameState,
  actor: Actor,
  trait: Restoration,
  killerId: string | null | undefined,
  rollDie: RandomSource | undefined
): EffectNarration[] {
  const returns = trait.returns;
  if (!returns) return [];
  const gm = (text: string): EffectNarration => ({ kind: "effect", text, actorId: actor.id, gmOnly: true });
  const killer = killerId ? state.actors.find((candidate) => candidate.id === killerId) : undefined;
  if (
    returns.preventedBy?.includes("blessed-killer") &&
    killer?.effects.some((effect) => effect.spell?.id === "bless" || effect.tags.includes("bless"))
  )
    return [gm(`${actor.name} was killed by a creature under Bless and stays dead (${trait.name}).`)];
  if (!rollDie) return [gm(`${actor.name} may come back (${trait.name}): roll its time and bring it back by hand.`)];
  const count =
    typeof returns.after === "number" ? returns.after : resolveDice(parseDiceFormula(returns.after), rollDie).total;
  const rounds = count * (returns.unit === "days" ? 24 : 1) * ROUNDS_PER_HOUR;
  stampDeath(state, actor);
  actor.death = {
    ...actor.death!,
    returns: {
      atClockRound: clockRoundsOf(state) + rounds,
      name: trait.name,
      ...(returns.needs ? { needs: returns.needs } : {})
    }
  };
  const stops = [
    ...(returns.needs ? [`its ${returns.needs.replace(/-/g, " ")} is destroyed`] : []),
    ...(returns.preventedBy?.includes("dispel-evil-and-good") ? ["Dispel Evil and Good is cast on its remains"] : []),
    ...(returns.preventedBy?.includes("holy-water") ? ["its remains are sprinkled with Holy Water"] : []),
    ...(returns.preventedBy?.includes("wish") ? ["a Wish prevents it (remove the creature for that)"] : [])
  ];
  return [
    gm(
      `${actor.name} returns to life in ${count} ${returns.unit === "days" ? (count === 1 ? "day" : "days") : count === 1 ? "hour" : "hours"} of game time (${trait.name})${returns.onlyIn ? `, if it died in ${returns.onlyIn}` : ""}${stops.length > 0 ? `, unless ${stops.join(" or ")}` : ""}.`
    )
  ];
}

/** What the trait of a dead creature it reached stops (Dispel Evil and Good on a guardian naga's remains, Holy Water on
 *  a lemure's). Returns the line the table hears, or null when there was nothing to stop. */
export function preventRestoration(
  actor: Actor,
  how: "dispel-evil-and-good" | "holy-water",
  deps: Pick<Deps, "resolveDefinition">
): EffectNarration | null {
  const returns = actor.death?.returns;
  if (!returns || !isDead(actor)) return null;
  const trait = traitOf(definitionOf(actor, deps), "restoration");
  if (!trait?.returns?.preventedBy?.includes(how)) return null;
  const { returns: _gone, ...rest } = actor.death!;
  actor.death = rest;
  return {
    kind: "effect",
    text: `${actor.name}'s remains won't return to life now (${trait.name}).`,
    actorId: actor.id
  };
}

/** Marks a corpse that rises some hours after the attack that slew it (a Shadow from a shadow's Draining Swipe), when
 *  it is of the creature types the attack names. */
export function markTimedRise(
  state: GameState,
  corpse: Actor,
  definition: ActorDefinition | undefined,
  rise: NonNullable<DamageDrain["slainRise"]>,
  rollDie: RandomSource | undefined
): EffectNarration[] {
  if (!rise.afterHours || !isDead(corpse)) return [];
  const type = creatureTypeOf(corpse, definition, "true");
  if (rise.creatureTypes && (type === null || !rise.creatureTypes.includes(type))) return [];
  const monster = rise.monsterId.replace(/-/g, " ");
  if (!rollDie)
    return [
      {
        kind: "effect",
        text: `A ${monster} rises from ${corpse.name}'s corpse ${rise.afterHours} hours later. Add it then.`,
        actorId: corpse.id,
        gmOnly: true
      }
    ];
  const hours = resolveDice(parseDiceFormula(rise.afterHours), rollDie).total;
  stampDeath(state, corpse);
  corpse.death = {
    ...corpse.death!,
    rises: { atClockRound: clockRoundsOf(state) + hours * ROUNDS_PER_HOUR, monsterId: rise.monsterId }
  };
  return [
    {
      kind: "effect",
      text: `A ${monster} will rise from ${corpse.name}'s corpse in ${hours} ${hours === 1 ? "hour" : "hours"} of game time.`,
      actorId: corpse.id,
      gmOnly: true
    }
  ];
}

/** The key a troll limb's time to spawn is kept under, in minutes of game time. */
const SPAWN_KEY = "spawns:at-minute";

/**
 * As game time passes from `beforeMinutes` to now: each dead creature whose return is due comes back with all its Hit
 * Points (or stays dead when the object it needs is gone), each corpse whose rise is due rises, and each limb that
 * lived its hours rolls to spawn.
 */
export function dueOnTheClock(
  state: GameState,
  inTime: ReadonlySet<string>,
  beforeMinutes: number,
  deps: Deps & Readonly<{ random?: RandomSource }>
): EffectNarration[] {
  const events: EffectNarration[] = [];
  const now = clockRoundsOf(state);
  for (const actor of [...state.actors]) {
    if (!inTime.has(actor.id) || actor.archived) continue;
    const death = actor.death;
    if (death?.returns && isDead(actor) && death.returns.atClockRound <= now)
      events.push(...comeBack(actor, death.returns, deps));
    if (death?.rises && isDead(actor) && death.rises.atClockRound <= now) events.push(...rise(state, actor, deps));
    if (!isDead(actor)) events.push(...spawnLimb(state, actor, beforeMinutes, deps));
  }
  return events;
}

function comeBack(
  actor: Actor,
  returns: NonNullable<NonNullable<Actor["death"]>["returns"]>,
  deps: Deps
): EffectNarration[] {
  if (returns.needs && !hasIntactObject(actor, returns.needs)) {
    const { returns: _gone, ...rest } = actor.death!;
    actor.death = rest;
    return [
      {
        kind: "effect",
        text: `${actor.name} doesn't return (${returns.name}): its ${returns.needs.replace(/-/g, " ")} is gone.`,
        actorId: actor.id,
        gmOnly: true
      }
    ];
  }
  const back = returnToLife(actor, actor.hp.maximum, {
    definition: definitionOf(actor, deps),
    ...(deps.catalog ? { catalog: deps.catalog } : {})
  });
  return [
    ...back.map((event) => ({ ...event, gmOnly: true as const })),
    {
      kind: "effect",
      text: `${actor.name} returns to life with all its Hit Points (${returns.name}). Place it where its stat block says.`,
      actorId: actor.id,
      gmOnly: true
    }
  ];
}

/** A corpse's rise comes due: the creature stands in its space on no one's side but its own. */
function rise(state: GameState, corpse: Actor, deps: Deps): EffectNarration[] {
  const rising = corpse.death!.rises!;
  const { rises: _done, ...rest } = corpse.death!;
  corpse.death = rest;
  return becomes(state, corpse, rising.monsterId, "Rises from the dead", deps, (name) =>
    name ? `${name} rises from ${corpse.name}'s corpse.` : null
  );
}

/** "If the limb isn't destroyed within 24 hours, roll 1d12. On a 12, the limb turns into a Troll. Otherwise, the limb
 *  withers away." Its 24 hours start as game time first passes for it. */
function spawnLimb(
  state: GameState,
  limb: Actor,
  beforeMinutes: number,
  deps: Deps & Readonly<{ random?: RandomSource }>
): EffectNarration[] {
  const spawns = traitMechanicsOf(definitionOf(limb, deps)).find(
    (trait): trait is Extract<TraitMechanic, { kind: "spawns" }> => trait.kind === "spawns"
  );
  if (!spawns || !deps.random) return [];
  const at = limb.actionUses[SPAWN_KEY] ?? beforeMinutes + spawns.afterHours * 60;
  limb.actionUses = { ...limb.actionUses, [SPAWN_KEY]: at };
  if (now(state) < at) return [];
  const face = deps.random(spawns.die);
  const events: EffectNarration[] = [
    {
      kind: "effect",
      text: `${limb.name} lived ${spawns.afterHours} hours: 1d${spawns.die} shows ${face} (${spawns.name}).`,
      actorId: limb.id,
      gmOnly: true
    }
  ];
  if (face < spawns.on) {
    limb.hp = { ...limb.hp, current: 0 };
    stampDeath(state, limb, { cause: spawns.name, bodyGone: true });
    events.push({ kind: "effect", text: `${limb.name} withers away.`, actorId: limb.id });
    return events;
  }
  limb.hp = { ...limb.hp, current: 0 };
  stampDeath(state, limb, { cause: spawns.name, bodyGone: true });
  events.push(
    ...becomes(state, limb, spawns.monsterId, spawns.name, deps, (name) =>
      name ? `${limb.name} turns into ${name}.` : null
    )
  );
  return events;
}

const now = (state: GameState) => Math.floor(clockRoundsOf(state) / ROUNDS_PER_MINUTE);

/** A creature that stands where `from` was, from a stat block, on no one's side but its own; `from` leaves a fight. */
function becomes(
  state: GameState,
  from: Actor,
  monsterId: string,
  source: string,
  deps: Deps,
  line: (name: string | null) => string | null
): EffectNarration[] {
  let raised: ReturnType<typeof raiseCreature> = null;
  try {
    raised = raiseCreature(
      state,
      { monsterId, maker: from, at: from, source, visibility: "gm-only" },
      {
        resolveDefinition: deps.resolveDefinition,
        ...(deps.catalog ? { catalog: deps.catalog } : {}),
        newId: () => derivedUuid(`${from.id}:${clockRoundsOf(state)}`, monsterId)
      }
    );
  } catch {
    // A full roster leaves it to the GM.
    raised = null;
  }
  const events: EffectNarration[] = [];
  if (!raised) {
    events.push({
      kind: "effect",
      text: `A ${monsterId.replace(/-/g, " ")} stands where ${from.name} was (${source}). Add it.`,
      actorId: from.id,
      gmOnly: true
    });
    return events;
  }
  // It answers to no one: free of the corpse it came from.
  const made = state.actors.find((actor) => actor.id === raised!.actorId);
  if (made) {
    delete made.control;
    delete made.summon;
  }
  const said = line(raised.name);
  if (said) events.push({ kind: "effect", text: said, actorId: raised.actorId, gmOnly: true });
  if (
    state.combat.active &&
    state.combat.turnActorId !== from.id &&
    state.combat.initiative.length > 1 &&
    state.combat.initiative.some((entry) => entry.actorId === from.id)
  )
    events.push(...removeCombatant(state, from.id, deps.resolveDefinition));
  // What the corpse carried of the creature it was ends with it.
  for (const effect of [...from.effects]) events.push(...endEffect(state, from.id, effect.id));
  return events;
}

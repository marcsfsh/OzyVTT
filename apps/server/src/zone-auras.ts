import type { GameState } from "@vtt/domain";
import type { EffectInstance } from "@vtt/schemas";
import { addEffect, endEffectIfPresent, KEEPS_MAXIMUM_TAG, makeEffect } from "./effects.js";
import { zoneContentOf } from "./spell-zone-state.js";
import { exposed, insideTest, liveZones, type ZoneDeps } from "./spell-zones.js";

/**
 * What a spell's area gives the creatures standing in it (SRD 5.2.1 Holy Aura: "each creature of your choice in it has
 * Advantage on all saving throws, and other creatures have Disadvantage on attack rolls against them"; Pass without
 * Trace's +10 to Stealth checks; Silence's Deafened; Aura of Life's Hit Point maximum that can't be reduced): each one
 * it affects holds an effect while it is inside, read by
 * every roll as any live effect is, and loses it as it leaves or the spell ends. Settled after every command, from
 * where the tokens and areas stand.
 */

/** Marks an effect an area gives while its bearer stands inside. */
export const ZONE_AURA_TAG = "zone-aura";

const auraId = (zoneId: string, actorId: string) => `${zoneId}:aura:${actorId}`;

type Holds = NonNullable<NonNullable<ReturnType<typeof zoneContentOf>>["trigger"]["holds"]>;

/** What a melee hit on a creature in the aura costs its attacker, its save at the cast's save DC. */
function struckAt(struck: NonNullable<Holds["struck"]>, dc: number): NonNullable<EffectInstance["struck"]> {
  const { save, ...rest } = structuredClone(struck);
  return { ...rest, ...(save ? { save: { ...save, dc } } : {}) };
}

/** The aura effects every creature should hold now, by actor and effect id. */
function wanted(
  state: GameState,
  deps: Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog">
): Map<string, Map<string, EffectInstance>> {
  const byActor = new Map<string, Map<string, EffectInstance>>();
  for (const zone of liveZones(state)) {
    const content = zoneContentOf(zone, deps.catalog);
    // What its caster holds near its point (Conjure Animals: Advantage on Strength saves within 5 feet of the pack).
    const own = content?.trigger.casterHolds;
    if (content && own) {
      const near = insideTest(state, zone, { on: [], around: "point", feet: own.feet }, content, deps.geometry);
      const token = state.combat.tokens.find((candidate) => candidate.actorId === zone.casterId);
      if (near && token?.position && near(token.position, token.sizeCells, token.altitudeFeet ?? 0)) {
        const id = `${zone.id}:aura:${zone.casterId}:own`;
        const effect = makeEffect({
          id,
          name: content.name,
          tags: [ZONE_AURA_TAG],
          sourceActorId: zone.casterId,
          sourceName: state.actors.find((actor) => actor.id === zone.casterId)?.name ?? null,
          startedRound: state.combat.round,
          duration: { type: "manual" },
          modifiers: structuredClone(own.modifiers),
          ...(content.spell ? { spell: { id: content.spell.id, level: zone.level } } : {}),
          ...(zone.castId !== null ? { castId: zone.castId } : {}),
          magical: true
        });
        byActor.set(zone.casterId, new Map([...(byActor.get(zone.casterId) ?? []), [id, effect]]));
      }
    }
    const holds = content?.trigger.holds;
    if (!content || !holds) continue;
    const inside = insideTest(state, zone, content.trigger, content, deps.geometry);
    if (!inside) continue;
    const caster = state.actors.find((actor) => actor.id === zone.casterId);
    for (const creature of exposed(state, zone, content.trigger, deps)) {
      const token = state.combat.tokens.find((candidate) => candidate.actorId === creature.id);
      if (!token?.position || !inside(token.position, token.sizeCells, token.altitudeFeet ?? 0)) continue;
      const id = auraId(zone.id, creature.id);
      const effect = makeEffect({
        id,
        name: content.name,
        tags: [ZONE_AURA_TAG, ...(holds.keepsMaximum ? [KEEPS_MAXIMUM_TAG] : [])],
        sourceActorId: zone.casterId,
        sourceName: caster?.name ?? null,
        startedRound: state.combat.round,
        duration: { type: "manual" },
        modifiers: structuredClone(holds.modifiers ?? []),
        ...(holds.armorClassBonus !== undefined ? { armorClassBonus: holds.armorClassBonus } : {}),
        ...(holds.conditions ? { linkedConditionIds: [...holds.conditions] } : {}),
        ...(holds.struck ? { struck: struckAt(holds.struck, zone.dc) } : {}),
        ...(content.spell ? { spell: { id: content.spell.id, level: zone.level } } : {}),
        // A Concentration spell's aura ends with the Concentration at once.
        ...(zone.castId !== null ? { castId: zone.castId } : {}),
        magical: true
      });
      byActor.set(creature.id, new Map([...(byActor.get(creature.id) ?? []), [id, effect]]));
    }
  }
  return byActor;
}

type AuraChanges = Readonly<{
  /** Aura effects a creature holds and has left. */
  leaving: ReadonlyArray<readonly [actorId: string, effectId: string]>;
  /** Aura effects a creature stands in and doesn't hold yet. */
  entering: ReadonlyArray<readonly [actorId: string, effect: EffectInstance]>;
}>;

/** What settling the auras would change, without changing it. */
export function zoneAuraChanges(
  state: GameState,
  deps: Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog">
): AuraChanges {
  const target = wanted(state, deps);
  const leaving: Array<readonly [string, string]> = [];
  const entering: Array<readonly [string, EffectInstance]> = [];
  for (const actor of state.actors) {
    const want = target.get(actor.id) ?? new Map<string, EffectInstance>();
    for (const effect of actor.effects)
      if (effect.tags.includes(ZONE_AURA_TAG) && !want.has(effect.id)) leaving.push([actor.id, effect.id]);
    for (const [id, effect] of want)
      if (!actor.effects.some((candidate) => candidate.id === id)) entering.push([actor.id, effect]);
  }
  return { leaving, entering };
}

/** Gives each creature the aura effects of the areas it stands in, and takes away those of areas it has left or that
 *  have ended. Returns whether anything changed. */
export function settleZoneAuras(
  state: GameState,
  deps: Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog">
): boolean {
  const { leaving, entering } = zoneAuraChanges(state, deps);
  for (const [actorId, effectId] of leaving) endEffectIfPresent(state, actorId, effectId);
  for (const [actorId, effect] of entering)
    try {
      addEffect(state, actorId, effect);
    } catch {
      // A creature that already holds as many effects as it can goes without.
    }
  return leaving.length > 0 || entering.length > 0;
}

/** Whether an area that gives what it holds stands on the map, so settling it is worth a look. */
export const holdsAuras = (state: GameState): boolean =>
  state.combat.spellZones.length > 0 ||
  state.actors.some((actor) => actor.effects.some((effect) => effect.tags.includes(ZONE_AURA_TAG)));

import type { GameState, SpellZone } from "@vtt/domain";
import type { EffectInstance } from "@vtt/schemas";
import { isIncapacitated } from "./condition-rules.js";
import { COVER_TAGS } from "./cover.js";
import { addEffect, endEffectIfPresent, KEEPS_MAXIMUM_TAG, makeEffect, NO_SPELLS_TAG } from "./effects.js";
import { ANTIMAGIC_TAG, suppressedByAntimagic, underAntimagic, WINKED_OUT_TAG } from "./antimagic.js";
import { refreshArmorClass } from "./held-items.js";
import { OFF_PLANE_TAG } from "./off-plane.js";
import { suppressConditions } from "./suppressed-conditions.js";
import { zoneContentOf } from "./spell-zone-state.js";
import { endZoneAndItsSpell, exposed, insideTest, liveZones, typeOf, type ZoneDeps } from "./spell-zones.js";
import { creatureTypeOf } from "./statblock-facts.js";
import { NO_SHAPE_SHIFT_TAG } from "./transform/rules.js";

/**
 * What a spell's area gives the creatures standing in it (SRD 5.2.1 Holy Aura: "each creature of your choice in it has
 * Advantage on all saving throws, and other creatures have Disadvantage on attack rolls against them"; Pass without
 * Trace's +10 to Stealth checks; Silence's Deafened; Aura of Life's Hit Point maximum that can't be reduced; Magic
 * Circle's Disadvantage on attacks and its ward against Charmed and Frightened; Hallow's ward and extra effect): each one
 * it affects holds an effect while it is inside (or, for an inverted circle, outside), read by every roll as any live
 * effect is, and loses it as it leaves or the spell ends. Settled after every command, from where the tokens and areas
 * stand, with what ends as a creature leaves an area: Tiny Hut when its caster walks out, and Moonbeam's bar on
 * shape-shifting once its creature is out of the Cylinder.
 */

/** Marks an effect an area gives while its bearer stands inside. */
export const ZONE_AURA_TAG = "zone-aura";

const auraId = (zoneId: string, actorId: string, second = false) => `${zoneId}:aura${second ? "2" : ""}:${actorId}`;

type Holds = NonNullable<NonNullable<ReturnType<typeof zoneContentOf>>["trigger"]["holds"]>;
type Modifiers = NonNullable<Holds["modifiers"]>;
type Deps = Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog">;

/** What a melee hit on a creature in the aura costs its attacker, its save at the cast's save DC. */
function struckAt(struck: NonNullable<Holds["struck"]>, dc: number): NonNullable<EffectInstance["struck"]> {
  const { save, ...rest } = structuredClone(struck);
  return { ...rest, ...(save ? { save: { ...save, dc } } : {}) };
}

/** The creature types an area wards: those its caster chose, else every type its barrier or ward names. */
function wardedTypes(zone: SpellZone, trigger: NonNullable<ReturnType<typeof zoneContentOf>>["trigger"]): string[] {
  return [...(zone.wardTypes ?? trigger.bars?.types ?? trigger.holds?.conditionWards?.creatureTypes ?? [])];
}

/** Modifiers whose source-type gate follows the types the caster chose (Magic Circle's Disadvantage), and the
 *  Resistance or Vulnerability to the type it chose (Hallow). */
function modifiersFor(zone: SpellZone, holds: Holds, warded: readonly string[]): Modifiers {
  const chosen = zone.wardTypes;
  const modifiers = structuredClone(holds.modifiers ?? []).map((modifier) =>
    chosen && "when" in modifier && modifier.when
      ? {
          ...modifier,
          when: modifier.when.map((gate) =>
            gate.type === "source-creature-type-is" ? { ...gate, creatureTypes: [...warded] } : gate
          )
        }
      : modifier
  ) as Modifiers;
  if (holds.chosenDamage && zone.damageType)
    modifiers.push({
      type: holds.chosenDamage === "resistance" ? "damage-resistance" : "damage-vulnerability",
      damageTypes: [zone.damageType as never]
    } as Modifiers[number]);
  return modifiers;
}

/** The aura effects every creature should hold now, by actor and effect id. */
function wanted(state: GameState, deps: Deps): Map<string, Map<string, EffectInstance>> {
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
    if (!content) continue;
    const inside = insideTest(state, zone, content.trigger, content, deps.geometry);
    if (!inside) continue;
    const caster = state.actors.find((actor) => actor.id === zone.casterId);
    const warded = wardedTypes(zone, content.trigger);
    // Its hold, and a second for other creatures (Hallow's ward and its extra effect).
    const kept = [content.trigger.holds, content.trigger.alsoHolds];
    for (const [index, holds] of kept.entries()) {
      if (!holds) continue;
      for (const creature of exposed(state, zone, content.trigger, deps)) {
        const token = state.combat.tokens.find((candidate) => candidate.actorId === creature.id);
        if (!token?.position) continue;
        // An inverted circle protects the creatures outside it.
        if (inside(token.position, token.sizeCells, token.altitudeFeet ?? 0) === (holds.outside === true)) continue;
        // Only the warded types hold it (Hallow's Fear), or only the others (Hallow's Courage).
        if (holds.forTypes) {
          const type = typeOf(creature, deps);
          const isWarded = type !== null && warded.includes(type);
          if (isWarded !== (holds.forTypes === "warded")) continue;
        }
        const id = auraId(zone.id, creature.id, index > 0);
        const effect = makeEffect({
          id,
          name: content.name,
          tags: [
            ZONE_AURA_TAG,
            ...(holds.keepsMaximum ? [KEEPS_MAXIMUM_TAG] : []),
            ...(holds.cover ? [COVER_TAGS[holds.cover]] : []),
            // No spell or Magic action inside an Antimagic Field, and its magic suppressed.
            ...(content.trigger.antimagic ? [ANTIMAGIC_TAG, NO_SPELLS_TAG] : [])
          ],
          sourceActorId: zone.casterId,
          sourceName: caster?.name ?? null,
          startedRound: state.combat.round,
          duration: { type: "manual" },
          modifiers: modifiersFor(zone, holds, warded),
          ...(holds.armorClassBonus !== undefined ? { armorClassBonus: holds.armorClassBonus } : {}),
          ...(holds.conditions ? { linkedConditionIds: [...holds.conditions] } : {}),
          ...(holds.conditionImmunities ? { conditionImmunities: [...holds.conditionImmunities] } : {}),
          ...(holds.conditionWards
            ? { conditionWards: { conditionIds: [...holds.conditionWards.conditionIds], creatureTypes: [...warded] } }
            : {}),
          ...(holds.struck ? { struck: struckAt(holds.struck, zone.dc) } : {}),
          ...(content.spell ? { spell: { id: content.spell.id, level: zone.level } } : {}),
          // A Concentration spell's aura ends with the Concentration at once.
          ...(zone.castId !== null ? { castId: zone.castId } : {}),
          magical: true
        });
        byActor.set(creature.id, new Map([...(byActor.get(creature.id) ?? []), [id, effect]]));
      }
    }
  }
  return byActor;
}

/** The areas that end now because their caster stands outside (Tiny Hut: "The spell ends early if you leave the
 *  Emanation"), or because their user is Incapacitated or dead (Nature's Sanctuary: "until you have the
 *  Incapacitated condition or die"). */
function casterLeft(state: GameState, deps: Deps): string[] {
  return liveZones(state).flatMap((zone) => {
    const content = zoneContentOf(zone, deps.catalog);
    if (content?.trigger.endsWhenUserIncapacitated) {
      const user = state.actors.find((actor) => actor.id === zone.casterId);
      if (!user || user.hp.current <= 0 || isIncapacitated(user)) return [zone.id];
    }
    if (!content?.trigger.endsWhenCasterLeaves) return [];
    const inside = insideTest(state, zone, content.trigger, content, deps.geometry);
    const token = state.combat.tokens.find((candidate) => candidate.actorId === zone.casterId);
    if (!inside || !token?.position) return [];
    return inside(token.position, token.sizeCells, token.altitudeFeet ?? 0) ? [] : [zone.id];
  });
}

/** SRD Moonbeam: a creature that failed "can't shape-shift until it leaves the Cylinder". Its bar ends once it is out of
 *  the area of the cast that made it. */
function barsLifted(state: GameState, deps: Deps): Array<readonly [string, string]> {
  const lifted: Array<readonly [string, string]> = [];
  const zones = liveZones(state);
  for (const actor of state.actors)
    for (const effect of actor.effects) {
      if (!effect.tags.includes(NO_SHAPE_SHIFT_TAG) || effect.castId === undefined) continue;
      const zone = zones.find((candidate) => candidate.castId === effect.castId);
      const content = zone ? zoneContentOf(zone, deps.catalog) : undefined;
      const inside = zone && content ? insideTest(state, zone, content.trigger, content, deps.geometry) : null;
      const token = state.combat.tokens.find((candidate) => candidate.actorId === actor.id);
      if (!inside || !token?.position) continue;
      if (!inside(token.position, token.sizeCells, token.altitudeFeet ?? 0)) lifted.push([actor.id, effect.id]);
    }
  return lifted;
}

type AuraChanges = Readonly<{
  /** Aura effects a creature holds and has left. */
  leaving: ReadonlyArray<readonly [actorId: string, effectId: string]>;
  /** Aura effects a creature stands in and doesn't hold yet. */
  entering: ReadonlyArray<readonly [actorId: string, effect: EffectInstance]>;
  /** Areas that end as their caster has left them, and bars that lift as their creature has left the area. */
  ending: readonly string[];
  lifting: ReadonlyArray<readonly [actorId: string, effectId: string]>;
  /** Summoned creatures an Antimagic Field winks out now. */
  winking: ReadonlyArray<readonly [actorId: string, effect: EffectInstance]>;
}>;

/** What settling the auras would change, without changing it. */
export function zoneAuraChanges(state: GameState, deps: Deps): AuraChanges {
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
  const winks = winking(state, deps);
  return {
    leaving,
    entering,
    ending: casterLeft(state, deps),
    lifting: [...barsLifted(state, deps), ...winks.back],
    winking: winks.out
  };
}

/** Whether settling would change anything. */
export const auraChangesAny = (changes: AuraChanges): boolean =>
  changes.leaving.length > 0 ||
  changes.entering.length > 0 ||
  changes.ending.length > 0 ||
  changes.lifting.length > 0 ||
  changes.winking.length > 0;

/** SRD Antimagic Field: "Ongoing spells ... are suppressed in the area." A condition the creature has only from spells
 *  is held off while it holds the field's aura. */
function suppressSpellConditions(state: GameState, actorId: string, effect: EffectInstance): void {
  if (!effect.tags.includes(ANTIMAGIC_TAG)) return;
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return;
  const fromSpells = actor.conditions
    .map((condition) => condition.id)
    .filter((conditionId) => {
      if (actor.conditions.find((condition) => condition.id === conditionId)?.standalone) return false;
      const holders = actor.effects.filter((candidate) => candidate.linkedConditionIds.includes(conditionId));
      return holders.length > 0 && holders.every(suppressedByAntimagic);
    });
  if (fromSpells.length > 0) effect.suppressedConditions = suppressConditions(actor, fromSpells);
}

/** The summoned creatures a field winks out ("Ongoing spells ... are suppressed"): a creature a spell brought whose space
 *  is inside an Antimagic Field goes off the map, keeping its space, and comes back once that space is outside every
 *  field. Pairs of creature and effect: those to wink out (with the effect), and those to bring back. */
function winking(
  state: GameState,
  deps: Deps
): Readonly<{ out: Array<readonly [string, EffectInstance]>; back: Array<readonly [string, string]> }> {
  const fields = liveZones(state).flatMap((zone) => {
    const content = zoneContentOf(zone, deps.catalog);
    const inside = content?.trigger.antimagic ? insideTest(state, zone, content.trigger, content, deps.geometry) : null;
    return inside ? [{ zone, inside }] : [];
  });
  const out: Array<readonly [string, EffectInstance]> = [];
  const back: Array<readonly [string, string]> = [];
  for (const actor of state.actors) {
    if (!actor.summon?.spell) continue;
    const winked = actor.effects.find((effect) => effect.tags.includes(WINKED_OUT_TAG));
    const kept = state.combat.offPlane.find((entry) => entry.actorId === actor.id);
    const token = state.combat.tokens.find((candidate) => candidate.actorId === actor.id);
    const at = winked ? kept?.position : token?.position;
    const sizeCells = token?.sizeCells ?? 1;
    const field = at ? fields.find(({ inside }) => inside(at, sizeCells)) : undefined;
    if (winked && !field && kept) back.push([actor.id, winked.id]);
    if (!winked && field && token?.position)
      out.push([
        actor.id,
        makeEffect({
          id: `${field.zone.id}:winked:${actor.id}`,
          name: `Winked out by ${field.zone.name}`,
          tags: [OFF_PLANE_TAG, WINKED_OUT_TAG],
          sourceActorId: field.zone.casterId,
          sourceName: state.actors.find((candidate) => candidate.id === field.zone.casterId)?.name ?? null,
          startedRound: state.combat.round,
          duration: { type: "manual" }
        })
      ]);
  }
  // With no field left, every creature it winked out comes back.
  if (fields.length === 0)
    for (const actor of state.actors) {
      const winked = actor.effects.find((effect) => effect.tags.includes(WINKED_OUT_TAG));
      if (winked && !back.some(([id]) => id === actor.id)) back.push([actor.id, winked.id]);
    }
  return { out, back };
}

/** Hallowed Ward: "any creature that is possessed by or that has the Charmed or Frightened condition from such creatures
 *  isn't ... while in the area". The conditions the ward names that the creature has only from creatures of the warded
 *  types are held off while it holds the aura. */
function heldOff(state: GameState, actorId: string, effect: EffectInstance, deps: Deps): void {
  const zoneId = effect.id.split(/:aura2?:/)[0]!;
  const zone = state.combat.spellZones.find((candidate) => candidate.id === zoneId);
  const ward = effect.conditionWards;
  if (!zone || !ward || zoneContentOf(zone, deps.catalog)?.trigger.holds?.suppresses !== true) return;
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return;
  const fromWarded = ward.conditionIds.filter((conditionId) => {
    if (!actor.conditions.some((condition) => condition.id === conditionId)) return false;
    const holders = actor.effects.filter((candidate) => candidate.linkedConditionIds.includes(conditionId));
    return (
      holders.length > 0 &&
      holders.every((holder) => {
        const source = state.actors.find((candidate) => candidate.id === holder.sourceActorId);
        const definition = source?.definitionId ? deps.resolveDefinition(source.definitionId) : undefined;
        const type = source ? creatureTypeOf(source, definition) : null;
        return type !== null && ward.creatureTypes.includes(type);
      })
    );
  });
  if (fromWarded.length > 0) effect.suppressedConditions = suppressConditions(actor, fromWarded);
}

/** Gives each creature the aura effects of the areas it stands in, and takes away those of areas it has left or that
 *  have ended; ends an area whose caster has left it and a bar whose creature has left its area. Returns whether
 *  anything changed. */
export function settleZoneAuras(state: GameState, deps: Deps): boolean {
  const changes = zoneAuraChanges(state, deps);
  for (const zoneId of changes.ending) endZoneAndItsSpell(state, zoneId);
  for (const [actorId, effectId] of changes.lifting) endEffectIfPresent(state, actorId, effectId);
  for (const [actorId, effect] of changes.winking) addEffect(state, actorId, structuredClone(effect));
  // An area that ended takes what it gave with it.
  const { leaving, entering } = changes.ending.length > 0 ? zoneAuraChanges(state, deps) : changes;
  const fieldBefore = new Map(state.actors.map((actor) => [actor.id, underAntimagic(actor)]));
  for (const [actorId, effectId] of leaving) endEffectIfPresent(state, actorId, effectId);
  for (const [actorId, effect] of entering)
    try {
      const held = structuredClone(effect);
      heldOff(state, actorId, held, deps);
      suppressSpellConditions(state, actorId, held);
      addEffect(state, actorId, held);
    } catch {
      // A creature that already holds as many effects as it can goes without.
    }
  // The Armor Class its magic items give goes off and on as it steps into and out of an Antimagic Field.
  for (const actor of state.actors)
    if (fieldBefore.get(actor.id) !== underAntimagic(actor)) refreshArmorClass(actor, deps);
  return auraChangesAny(changes);
}

/** Whether an area that gives what it holds stands on the map, so settling it is worth a look. */
export const holdsAuras = (state: GameState): boolean =>
  state.combat.spellZones.length > 0 ||
  state.actors.some((actor) => actor.effects.some((effect) => effect.tags.includes(ZONE_AURA_TAG)));

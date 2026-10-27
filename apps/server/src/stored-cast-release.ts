import type { GameState, SpellZone } from "@vtt/domain";
import { resolveDefinitionAction } from "./action-resolution.js";
import { altitudeOf } from "./altitude.js";
import type { EffectNarration } from "./effects.js";
import { castAreaOf, spellCastMechanics, upcastAction } from "./item-actions.js";
import { settlePlayerDamage } from "./player-damage.js";
import { removeZone } from "./spell-zone-state.js";
import type { ZoneDeps } from "./spell-zones.js";
import { STORED_CAST_PREFIX } from "./stored-casts.js";

/**
 * SRD 5.2.1 Glyph of Warding's spell glyph: "When the glyph is triggered, the stored spell takes effect. If the spell
 * has a target, it targets the creature that triggered the glyph. If the spell affects an area, the area is centered on
 * that creature." Run after the command that set the glyph off, as the table's own write: the stored spell resolves at
 * its caster's numbers on the creature, or on every creature its area catches around that creature, and its damage
 * lands; the glyph is gone.
 */
export function releaseGlyphSpells(
  state: GameState,
  deps: ZoneDeps & Readonly<{ distanceFeet: (a: string, b: string) => number | null }>
): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const zone of state.combat.spellZones.filter((entry) => entry.bursting && entry.storedCast)) {
    events.push(...release(state, zone, deps));
    removeZone(state, zone);
  }
  return events;
}

function release(
  state: GameState,
  zone: SpellZone,
  deps: ZoneDeps & Readonly<{ distanceFeet: (a: string, b: string) => number | null }>
): EffectNarration[] {
  const cast = zone.storedCast!;
  const spell = deps.catalog?.spellRecord?.(cast.spellId);
  const caster = state.actors.find((actor) => actor.id === zone.casterId);
  const intruder = state.actors.find((actor) => actor.id === zone.setOffBy);
  if (!spell || !caster || !intruder)
    return [
      {
        kind: "effect",
        text: `${zone.name} releases its stored spell. Apply it to the creature that set it off.`,
        actorId: zone.casterId,
        gmOnly: true
      }
    ];
  const mechanics = spellCastMechanics(spell, {
    attackBonus: cast.attackBonus,
    saveDc: cast.saveDc,
    bearersDc: false,
    modifier: cast.modifier
  });
  const built = {
    id: `${STORED_CAST_PREFIX}${zone.id}`,
    name: `${zone.name}: ${spell.name}`,
    activation: "other" as const,
    description: spell.description.slice(0, 12000),
    ...mechanics,
    ...castAreaOf(spell, mechanics),
    spellId: spell.id
  };
  const action = cast.level > spell.level ? upcastAction(built, spell, cast.level) : built;
  // An area is centered on the creature: every creature within its reach of it is caught.
  const reach = action.area ? action.area.sizeFeet : null;
  const intruderToken = state.combat.tokens.find((token) => token.actorId === intruder.id);
  const targetIds =
    reach === null
      ? [intruder.id]
      : state.combat.tokens
          .filter((token) => token.position !== null)
          .filter(
            (token) =>
              token.actorId === intruder.id ||
              ((deps.distanceFeet(intruder.id, token.actorId) ?? Infinity) <= reach &&
                Math.abs(altitudeOf(token) - altitudeOf(intruderToken)) <= reach)
          )
          .map((token) => token.actorId);
  const definition = caster.definitionId ? deps.resolveDefinition(caster.definitionId) : undefined;
  const sessionId = deps.newId();
  const resolution = resolveDefinitionAction(
    state,
    action,
    {
      actorId: caster.id,
      targetIds,
      commandId: deps.newId(),
      economyPaid: true,
      ...(reach !== null && intruderToken?.position
        ? { areaPlaced: true, areaOrigin: { ...intruderToken.position } }
        : {})
    },
    {
      random: deps.rollDie,
      newRollId: deps.newId,
      gmSessionId: sessionId,
      now: deps.now,
      ...(definition ? { definition } : {}),
      resolveDefinition: deps.resolveDefinition,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      distanceFeet: deps.distanceFeet
    }
  );
  const events: EffectNarration[] = [
    {
      kind: "effect",
      text: `${zone.name} releases ${spell.name} on ${intruder.name}.`,
      actorId: intruder.id,
      source: { actorId: caster.id, name: caster.name }
    }
  ];
  for (const { outcome } of settlePlayerDamage(state, resolution, caster.name, caster.id, "direct", {
    resolveDefinition: deps.resolveDefinition,
    newId: deps.newId,
    now: () => Date.parse(deps.now()),
    ...(deps.catalog ? { catalog: deps.catalog } : {}),
    distanceFeet: deps.distanceFeet,
    rollDie: deps.rollDie
  }))
    events.push(...outcome.events);
  return events;
}

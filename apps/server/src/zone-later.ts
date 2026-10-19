import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { AnnotationPoint, GameState, SpellZone } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { laterRowOf, laterSpellActionId } from "./item-actions.js";
import { DISTANCE_TOLERANCE_FEET, mapDistance } from "./movement-narration.js";
import type { RulesOverride } from "./rules-families.js";
import { zoneContentOf } from "./spell-zone-state.js";
import { insideTest, liveZones, pickedZoneRow, zoneRowOf, type ZoneDeps } from "./spell-zones.js";
import { policeBarrier } from "./zone-barriers.js";

/**
 * What a spell's area asks of what the spell lets its caster do later (SRD 5.2.1): Call Lightning's bolt strikes "a
 * point you can see under the cloud", Storm of Vengeance's six bolts strike "six different creatures or objects beneath
 * it" on its third turn, and in a storm Call Lightning's "damage increases by 1d10". The cast's first bolt is under the
 * cloud too.
 */

type LaterRow = NonNullable<ReturnType<typeof laterRowOf>>;

/** The caster's standing area of this spell, if any. */
function areaOfSpell(state: GameState, casterId: string, spell: SpellReference): SpellZone | undefined {
  return liveZones(state).find((zone) => zone.casterId === casterId && zone.spellId === spell.id);
}

/** The `turnUses` key a once-a-stage later action leaves (Storm of Vengeance's bolts). */
const stageUseKey = (casterId: string, spell: SpellReference, zone: SpellZone) =>
  `${casterId}:stage:${spell.id}:${zone.stage ?? 1}`;

/** Why a later action tied to a stage of its spell's area can't be taken now, or null. */
export function stageRefusal(
  state: GameState,
  casterId: string,
  row: LaterRow,
  spell: SpellReference,
  catalog: ZoneDeps["catalog"]
): string | null {
  if (!row.atRow) return null;
  const zone = areaOfSpell(state, casterId, spell);
  if (!zone || zone.laterActionId !== laterSpellActionId(spell.id, row.atRow) || !zoneContentOf(zone, catalog))
    return `${spell.name}'s ${row.name} come only with its ${row.atRow}.`;
  if ((state.combat.turn.turnUses[stageUseKey(casterId, spell, zone)] ?? 0) > 0)
    return `${spell.name}'s ${row.name} have already struck.`;
  return null;
}

/** Records that a once-a-stage later action was taken. */
export function markStageUse(state: GameState, casterId: string, row: LaterRow, spell: SpellReference): void {
  const zone = row.atRow ? areaOfSpell(state, casterId, spell) : undefined;
  if (!zone) return;
  const key = stageUseKey(casterId, spell, zone);
  state.combat = {
    ...state.combat,
    turn: { ...state.combat.turn, turnUses: { ...state.combat.turn.turnUses, [key]: 1 } }
  };
}

/**
 * Checks a later action's aim against the area its spell left: its template's point, or each creature it targets,
 * inside the area, and no more creatures than it strikes. A cast whose later bolts strike under an area it leaves round
 * its caster (Call Lightning's cloud) is held to that area too, measured from where the caster stands. Policed as a
 * range rule, so the GM may allow it; returns the note a rules mode let through.
 */
export function checkAimInArea(
  state: GameState,
  input: Readonly<{
    casterId: string;
    action: Pick<ActorAction, "id" | "spellId">;
    spell: SpellReference;
    point: AnnotationPoint | null;
    targetIds: readonly string[];
    override: RulesOverride | null;
    option: string | undefined;
  }>,
  deps: Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog">
): string | null {
  const { spell } = input;
  const row = laterRowOf(spell, input.action.id);
  const geometry = deps.geometry;
  if (!geometry?.calibration) return null;
  const notes: Array<string | null> = [];
  const refuse = (message: string) => notes.push(policeBarrier(state, input.override, "range.out-of-range", message));
  if (row?.targetCount !== undefined && new Set(input.targetIds).size > row.targetCount)
    throw new CommandRejectedError(`${spell.name}'s ${row.name} strike up to ${row.targetCount} creatures.`);
  if (row) {
    if (!row.inArea) return null;
    const zone = areaOfSpell(state, input.casterId, spell);
    const content = zone ? zoneContentOf(zone, deps.catalog) : undefined;
    const inside = zone && content ? insideTest(state, zone, content.trigger, content, geometry) : null;
    if (!inside) return null;
    if (input.point && !inside(input.point, 1)) refuse(`${spell.name}'s ${row.name} strikes under its area.`);
    for (const targetId of input.targetIds) {
      const token = state.combat.tokens.find((candidate) => candidate.actorId === targetId && candidate.position);
      if (token && !inside(token.position!, token.sizeCells, token.altitudeFeet ?? 0))
        refuse(`${spell.name}'s ${row.name} strike creatures under its area.`);
    }
    return notes.find((note) => note !== null) ?? null;
  }
  // The cast itself: its first bolt falls under the area it leaves round its caster.
  const leaves = pickedZoneRow(spell, input.option) ?? zoneRowOf(spell);
  const struck = (spell.effect?.laterActions ?? []).some((candidate) => candidate.inArea);
  const caster = state.combat.tokens.find((token) => token.actorId === input.casterId)?.position;
  if (!struck || leaves?.zone?.around !== "caster" || !input.point || !caster) return null;
  const apart = mapDistance(geometry, caster, input.point)?.value ?? 0;
  if (apart > (leaves.zone.feet ?? 5) + DISTANCE_TOLERANCE_FEET)
    refuse(`${spell.name} strikes under its area, within ${leaves.zone.feet ?? 5} feet of its middle.`);
  return notes.find((note) => note !== null) ?? null;
}

/** "12d6" with `extra` more dice of its size. */
function withMoreDice(formula: string, extra: number): string {
  const match = /^(\d+)d(\d+)(.*)$/.exec(formula.trim());
  return match ? `${Number(match[1]) + extra}d${match[2]}${match[3]}` : formula;
}

/**
 * The action with the dice its spell's area adds (Call Lightning in a storm: "the spell's damage increases by 1d10"):
 * the cast, by the option it picks, and each later action, by the area standing. Unchanged otherwise.
 */
export function withAreaDice<A extends Pick<ActorAction, "id" | "spellId" | "damage">>(
  state: GameState,
  casterId: string,
  action: A,
  spell: SpellReference | undefined,
  option: string | undefined,
  catalog: ZoneDeps["catalog"]
): A {
  if (!spell || action.damage.length === 0) return action;
  const later = laterRowOf(spell, action.id);
  const zone = later ? areaOfSpell(state, casterId, spell) : undefined;
  const extra = later
    ? zone
      ? zoneContentOf(zone, catalog)?.trigger.extraDice
      : undefined
    : pickedZoneRow(spell, option)?.zone?.extraDice;
  if (!extra) return action;
  return {
    ...action,
    damage: action.damage.map((part, index) =>
      index === 0 ? { ...part, formula: withMoreDice(part.formula, extra) } : part
    )
  };
}

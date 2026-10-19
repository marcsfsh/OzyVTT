import type { ContentActionSummary, ContentSpellSummary, EncounterToken, KnownDefences, PlayerView } from "@vtt/domain";
import { titleCase } from "../encounter/format";
import { useTargeting } from "../encounter/targeting";
import { initialsOf } from "../scene/tokenGlyph";
import type { GridCalibration } from "../scene/gridPreview";
import { useTableCalibration } from "../scene/tableGeometry";
import { creatureNumbers } from "./numbering";
import { caughtByArea, creatureDistanceFeet } from "./targetHints";

/** One creature in a target list: named and numbered as on its token, with its distance and, where known, its AC. */
export type TargetRow = Readonly<{
  id: string;
  label: string;
  initials: string;
  kind: string;
  number?: number;
  /** "50 ft · AC 15": the distance from the attacker, the AC when this viewer knows it, and what Hunter's Lore tells. */
  detail?: string;
  /** The distance from the attacker in feet, where the map measures it. */
  feet?: number;
  /** At 0 Hit Points. */
  down?: boolean;
  /** Why this action can't pick it now ("Out of range: 90 ft, the reach is 60 ft"); shown, and not picked. */
  unavailable?: string;
}>;

type Candidate = Readonly<{
  id: string;
  name: string;
  kind: string;
  armorClass?: number;
  down?: boolean;
  /** What the viewer's Hunter knows of the creature it marks (Hunter's Lore). */
  lore?: string;
}>;

/** A marked creature's defences as Hunter's Lore tells them: "Immune Necrotic, Poison · Resists Acid · Can't be
 *  Frightened". */
export function loreWords(known: KnownDefences): string {
  const list = (ids: readonly string[]) => ids.map(titleCase).join(", ");
  const parts = [
    known.damageImmunities.length > 0 ? `Immune ${list(known.damageImmunities)}` : null,
    known.damageResistances.length > 0 ? `Resists ${list(known.damageResistances)}` : null,
    known.damageVulnerabilities.length > 0 ? `Vulnerable ${list(known.damageVulnerabilities)}` : null,
    known.conditionImmunities.length > 0 ? `Can't be ${list(known.conditionImmunities)}` : null
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : "No Immunities, Resistances or Vulnerabilities";
}

/** Target rows for `attackerId`'s action. A player knows the AC of their party only; the GM knows every creature's. */
export function targetRows(
  attackerId: string,
  candidates: readonly Candidate[],
  tokens: readonly EncounterToken[],
  calibration: GridCalibration | null,
  everyone: readonly Candidate[] = candidates
): TargetRow[] {
  const numbers = creatureNumbers(everyone);
  const byActor = new Map(tokens.map((token) => [token.actorId, token]));
  const attacker = byActor.get(attackerId);
  return candidates.map((candidate) => {
    const token = byActor.get(candidate.id);
    const feet = attacker && token ? creatureDistanceFeet(calibration, attacker, token) : null;
    const parts = [
      feet !== null ? `${feet} ft` : null,
      candidate.armorClass !== undefined ? `AC ${candidate.armorClass}` : null,
      candidate.lore ?? null
    ].filter((part): part is string => part !== null);
    const number = numbers.get(candidate.id);
    return {
      id: candidate.id,
      label: candidate.name,
      initials: initialsOf(candidate.name),
      kind: candidate.kind,
      ...(number !== undefined ? { number } : {}),
      ...(parts.length > 0 ? { detail: parts.join(" · ") } : {}),
      ...(feet !== null ? { feet } : {}),
      ...(candidate.down ? { down: true } : {})
    };
  });
}

/** How far an action reaches: an attack's reach or its long range, its own target range, or a spell's printed range
 *  (Touch is 5 feet). Null when it names no distance (Self, a feature without a range). */
export function reachOf(action: ContentActionSummary, spell?: ContentSpellSummary): number | null {
  if (action.attackBonus !== null) {
    const reaches = [action.reachFeet, action.rangeFeet].filter((feet): feet is number => feet !== null);
    return reaches.length > 0 ? Math.max(...reaches) : null;
  }
  // An action's own target range (Lay on Hands' touch, a flask's 20 feet).
  if (action.targetRangeFeet !== undefined) return action.targetRangeFeet;
  if (!spell) return null;
  return spell.rangeFeet ?? (/^touch$/i.test(spell.rangeText ?? "") ? 5 : null);
}

/**
 * The rows an action may pick, as the server will judge them: a creature that isn't a player character and is at 0
 * Hit Points is dead and leaves the list of what attacks, forces a save or deals damage (a heal, Spare the Dying and a
 * revival keep it), and one beyond the action's reach stays listed with the reason. Distances are the map's, measured
 * between the tokens this viewer already has.
 */
export function pickableTargets<Row extends Pick<TargetRow, "id" | "label"> & Partial<TargetRow>>(
  rows: readonly Row[],
  action: ContentActionSummary,
  spell?: ContentSpellSummary
): Row[] {
  const harms = action.attackBonus !== null || action.saveAbility !== null || action.damage.length > 0;
  const reach = reachOf(action, spell);
  return rows
    .filter((row) => !(harms && row.down && row.kind !== "player-character"))
    .map((row) =>
      reach !== null && row.feet !== undefined && row.feet > reach
        ? { ...row, unavailable: `Out of range: ${row.feet} ft away, the reach is ${reach} ft.` }
        : row
    );
}

/** The fight's creatures as a player knows them: the party's Armor Class, and who is down. */
export function playerTargetCandidates(state: PlayerView): Candidate[] {
  return state.combat.initiative.flatMap((entry) => {
    const actor = state.actors.find((candidate) => candidate.id === entry.actorId);
    // A player knows the Armor Class of the party only; a monster's is the GM's.
    return actor
      ? [
          {
            id: actor.id,
            name: entry.name,
            kind: actor.kind,
            ...(actor.armorClass !== undefined ? { armorClass: actor.armorClass } : {}),
            ...(actor.knownDefences ? { lore: loreWords(actor.knownDefences) } : {}),
            // A player knows a creature is down from its band; a party member's points are exact.
            ...((actor.hp.kind === "band" ? actor.hp.band === "down" : actor.hp.current <= 0) ? { down: true } : {})
          }
        ]
      : [{ id: entry.actorId, name: entry.name, kind: "monster" }];
  });
}

/** A player's target rows for their own character's action, and who a placed area of theirs covers now. */
export function usePlayerTargetRows(state: PlayerView, attackerId: string | null) {
  const calibration = useTableCalibration(state.combat.mapAssetId);
  const session = useTargeting();
  const everyone = playerTargetCandidates(state);
  const rows = attackerId ? targetRows(attackerId, everyone, state.combat.tokens, calibration, everyone) : [];
  const area = session && session.attackerId === attackerId && session.mode === "template" ? session.template : null;
  const caught =
    area?.placed && calibration
      ? new Set(
          caughtByArea(
            calibration,
            area.shape,
            area.placed,
            area.widthFeet,
            state.combat.tokens.filter((token) => token.actorId !== attackerId),
            area.sizeFeet
          )
        )
      : null;
  return {
    rows: new Map(rows.map((row) => [row.id, row])),
    insideNow: caught ? rows.filter((row) => caught.has(row.id)) : undefined
  };
}

/**
 * A target list in the order it is used: the attacker's foes first and its own side last, or the other way round for a
 * heal. Sides go by kind (a monster against the party), as a player's view can tell them; the order within a side
 * stays as given.
 */
export function foesFirst<Row extends Readonly<{ kind?: string }>>(
  rows: readonly Row[],
  attackerKind: string | undefined,
  heals = false
): Row[] {
  const party = attackerKind === "player-character";
  const rank = (kind: string | undefined) => {
    const side = kind === "npc" ? 1 : (kind === "player-character") === party ? 2 : 0;
    return heals ? 2 - side : side;
  };
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row.kind) - rank(b.row.kind) || a.index - b.index)
    .map(({ row }) => row);
}

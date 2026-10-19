import type { EncounterToken, PlayerView } from "@vtt/domain";
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
  /** "50 ft · AC 15": the distance from the attacker, and the AC when this viewer knows it. */
  detail?: string;
  /** The distance from the attacker in feet, where the map measures it. */
  feet?: number;
}>;

type Candidate = Readonly<{ id: string; name: string; kind: string; armorClass?: number }>;

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
      candidate.armorClass !== undefined ? `AC ${candidate.armorClass}` : null
    ].filter((part): part is string => part !== null);
    const number = numbers.get(candidate.id);
    return {
      id: candidate.id,
      label: candidate.name,
      initials: initialsOf(candidate.name),
      kind: candidate.kind,
      ...(number !== undefined ? { number } : {}),
      ...(parts.length > 0 ? { detail: parts.join(" · ") } : {}),
      ...(feet !== null ? { feet } : {})
    };
  });
}

/** How far an action's targets may be, when it says: an attack's reach or longest range, or its own target range
 *  (Lay on Hands' touch). Null when nothing here limits it. */
export function targetReachFeet(
  action: Readonly<{ reachFeet: number | null; rangeFeet: number | null; targetRangeFeet?: number }>
): number | null {
  const limits = [action.reachFeet, action.rangeFeet, action.targetRangeFeet ?? null].filter(
    (feet): feet is number => feet !== null
  );
  return limits.length > 0 ? Math.max(...limits) : null;
}

/** Slack for the map's measure against the server's, so a creature at the edge of reach is still offered. */
const REACH_SLACK_FEET = 2.5;

/**
 * The creatures a picker offers (#152): none beyond the action's reach or range where the map measures it, and, for
 * an action that harms, none that is dead. The server decides either way; this keeps the list to what it allows.
 */
export function offeredTargets<Row extends Readonly<{ id: string; feet?: number }>>(
  rows: readonly Row[],
  action: Parameters<typeof targetReachFeet>[0] &
    Readonly<{ attackBonus: number | null; saveAbility: string | null; damage: readonly unknown[] }>,
  dead: (id: string) => boolean
): Row[] {
  const reach = targetReachFeet(action);
  const harms = action.attackBonus !== null || action.saveAbility !== null || action.damage.length > 0;
  return rows.filter(
    (row) =>
      !(harms && dead(row.id)) && (reach === null || row.feet === undefined || row.feet <= reach + REACH_SLACK_FEET)
  );
}

/** A player's target rows for their own character's action, and who a placed area of theirs covers now. */
export function usePlayerTargetRows(state: PlayerView, attackerId: string | null) {
  const calibration = useTableCalibration(state.combat.mapAssetId);
  const session = useTargeting();
  const everyone = state.combat.initiative.flatMap((entry) => {
    const actor = state.actors.find((candidate) => candidate.id === entry.actorId);
    // A player knows the Armor Class of the party only; a monster's is the GM's.
    return actor
      ? [
          {
            id: actor.id,
            name: entry.name,
            kind: actor.kind,
            ...(actor.armorClass !== undefined ? { armorClass: actor.armorClass } : {})
          }
        ]
      : [{ id: entry.actorId, name: entry.name, kind: "monster" }];
  });
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

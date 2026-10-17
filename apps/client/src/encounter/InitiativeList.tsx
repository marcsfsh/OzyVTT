import { SunMark } from "@vtt/ui";
import { initialsOf } from "../scene/tokenGlyph";
import "./InitiativeList.css";

/**
 * The audience-safe fields a shared initiative row needs. `score` is the initiative value.
 * Conditions arrive as parallel ids + labels so the dots render without a rules lookup (the shared
 * screen has no socket).
 */
export type InitiativeRowEntry = Readonly<{
  actorId: string;
  name: string;
  score: number;
  active: boolean;
  health: "healthy" | "bloodied" | "down";
  conditionIds?: readonly string[];
  conditions?: readonly string[];
}>;

/**
 * Condition presence for a dense list row: plain dots (up to 4, then +N) with the names in the
 * tooltip and the accessible name. Takes ids and labels, not a rules lookup, so the shared screen can
 * use it without a socket.
 */
export function ConditionDots({
  conditionIds,
  conditions
}: Readonly<{ conditionIds?: readonly string[]; conditions?: readonly string[] }>) {
  const ids = conditionIds ?? [];
  const labels = conditions ?? [];
  const count = Math.max(ids.length, labels.length);
  if (count === 0) return null;
  const shown = Math.min(count, 4);
  return (
    <span className="init-row-dots" role="img" aria-label={(labels.length ? labels : ids).join(", ")}>
      {Array.from({ length: shown }, (_, index) => (
        <span key={ids[index] ?? index} className="init-row-dot" title={labels[index] ?? ids[index] ?? ""} />
      ))}
      {count > shown && <span className="init-row-dot-more">+{count - shown}</span>}
    </span>
  );
}

/**
 * One initiative row's shared content: avatar, the sun glyph on the active row, name (+ optional "YOU" badge),
 * condition dots, a coarse health note, and the score. Used by both the player panel and the
 * viewer; the caller owns the surrounding <li>. No HP bar: health is the coarse Bloodied/Down text
 * plus the token's ring on the map.
 */
export function InitiativeRow({ entry, self = false }: Readonly<{ entry: InitiativeRowEntry; self?: boolean }>) {
  return (
    <div className="init-row">
      <span className="init-row-avatar" aria-hidden="true">
        {initialsOf(entry.name)}
      </span>
      <span className="init-row-body">
        <span className="init-row-name-line">
          {entry.active && <SunMark size="sm" className="init-row-caret" />}
          <strong className="init-row-name">{entry.name}</strong>
          {self && <span className="init-row-you">YOU</span>}
          <ConditionDots conditionIds={entry.conditionIds} conditions={entry.conditions} />
          {entry.health !== "healthy" && (
            <span className={`init-row-health hp-${entry.health}`}>
              {entry.health === "down" ? "Down" : "Bloodied"}
            </span>
          )}
        </span>
      </span>
      <span className="init-row-score">{entry.score}</span>
    </div>
  );
}

import { bandFraction, initialsOf } from "../scene/mapImage";
import "./InitiativeList.css";

/**
 * The audience-safe fields a shared initiative row needs. `score` is the initiative value (the viewer
 * surfaces it under the name `initiative`, mapped by its caller). Conditions arrive as parallel ids +
 * labels so the dots render without a rules-reference lookup - the shared screen has no socket.
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

/** Condition presence as plain dots (up to 4, then +N), fed from the entry's ids + labels - no socket. */
function InitiativeConditionDots({ conditionIds, conditions }: Readonly<{ conditionIds?: readonly string[]; conditions?: readonly string[] }>) {
  const ids = conditionIds ?? [];
  const labels = conditions ?? [];
  const count = Math.max(ids.length, labels.length);
  if (count === 0) return null;
  const shown = Math.min(count, 4);
  return <span className="init-row-dots" role="img" aria-label={(labels.length ? labels : ids).join(", ")}>
    {Array.from({ length: shown }, (_, index) => <span key={ids[index] ?? index} className="init-row-dot" title={labels[index] ?? ids[index] ?? ""} />)}
    {count > shown && <span className="init-row-dot-more">+{count - shown}</span>}
  </span>;
}

/**
 * One initiative row's shared visual content: avatar, active caret, name (+ optional "YOU" badge),
 * condition dots, a coarse-band health note, the band-fill HP bar, and the score. Rendered by BOTH
 * the player panel and the viewer so the two lists stay identical; the caller owns the surrounding
 * <li> (its active/self classes, an auto-scroll ref, and any own-turn sub-rows underneath).
 */
export function InitiativeRow({ entry, self = false }: Readonly<{ entry: InitiativeRowEntry; self?: boolean }>) {
  return <div className="init-row">
    <span className="init-row-avatar" aria-hidden="true">{initialsOf(entry.name)}</span>
    <span className="init-row-body">
      <span className="init-row-name-line">
        {entry.active && <span className="init-row-caret" aria-hidden="true">▶</span>}
        <strong className="init-row-name">{entry.name}</strong>
        {self && <span className="init-row-you">YOU</span>}
        <InitiativeConditionDots conditionIds={entry.conditionIds} conditions={entry.conditions} />
        {entry.health !== "healthy" && <span className={`init-row-health hp-${entry.health}`}>{entry.health === "down" ? "Down" : "Bloodied"}</span>}
      </span>
      {/* Players only know the coarse band, so the bar fills full / ~half / a sliver (one source with the token bar/ring). */}
      <span className="init-row-hpbar" aria-hidden="true"><span className={`init-row-hpbar-fill hp-${entry.health}`} style={{ width: `${bandFraction(entry.health) * 100}%` }} /></span>
    </span>
    <span className="init-row-score">{entry.score}</span>
  </div>;
}

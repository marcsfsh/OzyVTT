import { SunMark } from "@vtt/ui";
import { useRef, useState, type ReactNode, type Ref } from "react";
import type { GmActor, GmView, InitiativeEntry, MutationResult } from "@vtt/domain";
import { healthBandFor, useConditionLabels } from "./conditions";
import { ConditionDots } from "./InitiativeList";
import { initialsOf } from "../scene/tokenGlyph";
import { DyingTracker } from "./DyingTracker";
import { PendingDamagePrompt } from "./PendingDamagePrompt";
import { ReactionPrompt } from "./ReactionPrompt";
import { RowTools } from "./RowTools";
import { SavePrompt } from "./SavePrompt";

const validInitiativeScore = (value: string | undefined) =>
  value !== undefined &&
  value.trim() !== "" &&
  Number.isInteger(Number(value)) &&
  Number(value) >= -1000 &&
  Number(value) <= 1000;

/**
 * A row's initiative: a quiet inline number that becomes a field on tap. Enter or blur commits,
 * Escape discards.
 */
function InitiativeScore({
  score,
  busy,
  onCommit
}: Readonly<{ score: number; busy: boolean; onCommit: (score: number) => void }>) {
  const [editing, setEditing] = useState(false);
  const [editScore, setEditScore] = useState("");
  const cancelEditRef = useRef(false);
  const commitEdit = () => {
    setEditing(false);
    if (cancelEditRef.current) {
      cancelEditRef.current = false;
      return;
    }
    const trimmed = editScore.trim();
    if (!validInitiativeScore(trimmed) || Number(trimmed) === score) return;
    onCommit(Number(trimmed));
  };
  return editing ? (
    <input
      className="initiative-score-edit"
      type="number"
      min="-1000"
      max="1000"
      autoFocus
      value={editScore}
      onChange={(event) => setEditScore(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        else if (event.key === "Escape") {
          cancelEditRef.current = true;
          event.currentTarget.blur();
        }
      }}
      onBlur={commitEdit}
    />
  ) : (
    /* A quiet inline number; its paint stays small and `.tap-target`'s `::after` provides the 44px
       hit area, which fits in the row gaps without overlapping `.initiative-expand`. */
    <button
      type="button"
      className="initiative-score-value tap-target"
      disabled={busy}
      title="Initiative - click to edit"
      onClick={() => {
        setEditScore(String(score));
        setEditing(true);
      }}
    >
      {score}
    </button>
  );
}

/**
 * One row of the GM's turn order, with what hangs off it: the tools card when expanded, the acting
 * console on the active row, and the decisions this creature owes (death saves, saving throws,
 * reactions, a player's hit awaiting Apply), which stay visible whether or not the row is expanded.
 */
export function GmInitiativeRow({
  entry,
  actor,
  state,
  active,
  expanded,
  rowRef,
  onToggleExpanded,
  onCloseTools,
  onScoreChange,
  actingConsole,
  busy,
  run,
  rollMode,
  hpDamageType,
  onHpDamageTypeChange,
  onOpenSheet,
  onFeedback
}: Readonly<{
  entry: InitiativeEntry;
  actor: GmActor | undefined;
  state: GmView;
  active: boolean;
  expanded: boolean;
  rowRef?: Ref<HTMLLIElement>;
  onToggleExpanded: () => void;
  onCloseTools: () => void;
  onScoreChange: (score: number) => void;
  /** Rendered under the active row, and under the tools card when it is open. */
  actingConsole: ReactNode;
  busy: boolean;
  run: (operation: () => Promise<MutationResult>, success: string) => Promise<void>;
  rollMode: "auto" | "manual";
  hpDamageType: string | null;
  onHpDamageTypeChange: (type: string | null) => void;
  onOpenSheet: (actorId: string) => void;
  onFeedback: (text: string) => void;
}>) {
  const down = actor !== undefined && actor.hp.current <= 0;
  const conditionLabels = useConditionLabels(actor?.conditions ?? []);
  const conditionIds = actor?.conditions.map((condition) => condition.id);
  const band = actor ? healthBandFor(actor.hp) : null;
  return (
    <li
      ref={rowRef}
      className={`${active ? "active" : ""}${down ? " down" : ""}${expanded ? " expanded" : ""}`.trim()}
      aria-current={active ? "step" : undefined}
    >
      <div className="initiative-row-main">
        {/* Row: [avatar | name + HP bar | initiative]. The row opens a floating tools card over the
                list, so rows never shift while you work. */}
        <button
          type="button"
          className="initiative-expand"
          aria-expanded={expanded}
          title={
            expanded ? "Close" : `Manage ${actor?.name ?? "this token"} - HP, conditions, effects, reaction, sheet`
          }
          onClick={onToggleExpanded}
        >
          <span
            className={`initiative-avatar ${actor?.kind ?? "npc"}${actor?.visibility === "gm-only" ? " gm-hidden" : ""}`}
            aria-hidden="true"
          >
            {initialsOf(actor?.name ?? "?")}
          </span>
          <span className="initiative-main-col">
            <span className="initiative-name-line">
              {active && <SunMark size="sm" className="initiative-caret" />}
              <strong className="initiative-name-text">{actor?.name ?? "(removed)"}</strong>
              {actor && <ConditionDots conditionIds={conditionIds} conditions={conditionLabels} />}
              {actor && state.combat.reactionsUsed.includes(actor.id) && (
                <span className="reaction-spent-dot" title="Reaction spent (restore in the row tools)">
                  R
                </span>
              )}
              {actor && (
                <span className={`initiative-hp-text hp-${band}`}>
                  {actor.hp.current}/{actor.hp.maximum}
                  {actor.hp.temporary > 0 ? <small>+{actor.hp.temporary}</small> : null}
                </span>
              )}
            </span>
            {actor && (
              <span className="initiative-hpbar" aria-hidden="true">
                <span
                  className={`initiative-hpbar-fill hp-${band}`}
                  style={{
                    width: `${Math.max(0, Math.min(100, (actor.hp.current / Math.max(1, actor.hp.maximum)) * 100))}%`
                  }}
                />
              </span>
            )}
          </span>
        </button>
        <InitiativeScore score={entry.score} busy={busy} onCommit={onScoreChange} />
      </div>
      {expanded && actor && (
        <RowTools
          actor={actor}
          state={state}
          busy={busy}
          run={run}
          hpDamageType={hpDamageType}
          onHpDamageTypeChange={onHpDamageTypeChange}
          onOpenSheet={() => onOpenSheet(actor.id)}
          onClose={onCloseTools}
          onFeedback={onFeedback}
        />
      )}
      {active && actingConsole}
      {/* Required decisions and the dying state stay visible whether or not the row is expanded. */}
      {actor && actor.deathSaves && actor.hp.current <= 0 && state.combat.turnActorId !== actor.id && (
        <DyingTracker
          actorId={actor.id}
          name={actor.name}
          deathSaves={actor.deathSaves}
          canRoll
          onFeedback={onFeedback}
          rollMode={rollMode}
          isActingTurn={state.combat.turnActorId === actor.id}
        />
      )}
      {actor &&
        state.combat.pendingSaves
          .filter((save) => save.targetActorId === actor.id)
          .map((save) => (
            <SavePrompt
              key={save.id}
              save={save}
              targetName={actor.name}
              canDismiss
              onFeedback={onFeedback}
              rollMode={rollMode}
              legendaryResistanceLeft={
                actor.legendary?.resistancesPerDay !== undefined
                  ? Math.max(0, actor.legendary.resistancesPerDay - (actor.actionUses["legendary-resistance"] ?? 0))
                  : undefined
              }
            />
          ))}
      {actor &&
        state.combat.pendingReactions
          .filter((reaction) => reaction.actorId === actor.id)
          .map((reaction) => (
            <ReactionPrompt
              key={reaction.id}
              reaction={reaction}
              actorName={actor.name}
              canDismiss
              onFeedback={onFeedback}
              rollMode={rollMode}
            />
          ))}
      {actor &&
        (state.combat.pendingDamage ?? [])
          .filter((proposal) => proposal.targetActorId === actor.id)
          .map((proposal) => <PendingDamagePrompt key={proposal.id} proposal={proposal} onFeedback={onFeedback} />)}
    </li>
  );
}

import { SunMark } from "@vtt/ui";
import { useRef, useState, type ReactNode, type Ref } from "react";
import type { GmActor, GmView, InitiativeEntry, MutationResult } from "@vtt/domain";
import { healthBandFor, useConditionLabels } from "./conditions";
import { ConditionDots } from "./InitiativeList";
import { initialsOf } from "../scene/tokenGlyph";
import { RowTools } from "./RowTools";
import { aidGiverOf, isKnockedOut, StabilizeControl, type AidGiver } from "./StabilizeControl";

/** Who in the fight could give a dying creature aid, the creature whose turn it is first (the aid is its action):
 *  conscious characters and NPCs, without the dying one. */
function fightHelpers(state: GmView, targetId: string): AidGiver[] {
  const turn = state.combat.turnActorId;
  return state.combat.initiative
    .flatMap((entry) => {
      const candidate = state.actors.find((actor) => actor.id === entry.actorId);
      return candidate && candidate.id !== targetId && candidate.kind !== "monster" && candidate.hp.current > 0
        ? [candidate]
        : [];
    })
    .sort((left, right) => Number(right.id === turn) - Number(left.id === turn))
    .map((candidate) =>
      aidGiverOf(candidate, state.definitions?.find((entry) => entry.id === candidate.definitionId)?.definition)
    );
}

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
      title="Edit initiative"
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
 * One row of the GM's turn order, with what hangs off it: the tools card when expanded and the acting console on the
 * active row. The decisions a creature owes wait in Needs you; the row marks them (a hit to apply, the dying tally).
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
  hpDamageType: string | null;
  onHpDamageTypeChange: (type: string | null) => void;
  onOpenSheet: (actorId: string) => void;
  onFeedback: (text: string) => void;
}>) {
  const down = actor !== undefined && actor.hp.current <= 0;
  const conditionLabels = useConditionLabels(actor?.conditions ?? []);
  const conditionIds = actor?.conditions.map((condition) => condition.id);
  const band = actor ? healthBandFor(actor.hp) : null;
  const pendingDamage = (state.combat.pendingDamage ?? [])
    .filter((proposal) => proposal.targetActorId === entry.actorId)
    .reduce((sum, proposal) => sum + proposal.proposedTotal, 0);
  return (
    <li
      ref={rowRef}
      data-key={entry.actorId}
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
            expanded ? "Close" : `Manage ${actor?.name ?? "this token"} · HP, conditions, effects, reaction, sheet`
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
              {pendingDamage > 0 && (
                <span className="initiative-flag initiative-flag--caution">−{pendingDamage} pending</span>
              )}
              {actor?.deathSaves && down && !actor.deathSaves.stable && actor.deathSaves.failures < 3 && (
                <span className="initiative-flag initiative-flag--danger">
                  Dying {actor.deathSaves.successes}/{actor.deathSaves.failures}
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
      {/* A creature knocked out stays Unconscious until healed or given first aid. */}
      {actor && isKnockedOut(actor) && (
        <div className="dying-tracker" role="group" aria-label={`${actor.name} is knocked out`}>
          <span className="dying-label">Knocked out</span>
          <StabilizeControl
            targetId={actor.id}
            targetName={actor.name}
            helpers={fightHelpers(state, actor.id)}
            gm
            knockedOut
            onFeedback={onFeedback}
          />
        </div>
      )}
    </li>
  );
}

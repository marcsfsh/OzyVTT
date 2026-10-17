import { useEffect, useRef, useState, type ReactNode } from "react";
import { type MutationResult, type PlayerView } from "@vtt/domain";
import { Button, Eyebrow } from "@vtt/ui";
import { command } from "../lib/command";
import { useMovementBudget } from "../scene/useMovementBudget";
import { MyPendingAsks } from "./RuleAsk";
import { useTargetingResult } from "./targeting";
import { useRollPreference } from "../dice/roll-preference";
import { CharacterSheet } from "./CharacterSheet";
import { InitiativeRow } from "./InitiativeList";
import { EffectChips } from "./EffectChips";
import { DyingTracker } from "./DyingTracker";
import { aidGiverOf, isKnockedOut, StabilizeControl } from "./StabilizeControl";
import { PlayerActionRunner } from "./PlayerActionRunner";
import { isDying, owesDeathSave } from "../table/playerPrompts";
import { hasPlayerPrompt } from "../table/PromptSlot";
import { usePlayerTargetRows } from "../table/targetRows";
import { useTargeting } from "./targeting";

/**
 * A player's own prompts keep their outcome line beside them: answering one unmounts it, and the
 * player panel has no feedback line of its own. Hidden while there is nothing to answer or report.
 */
function OwnFeedback({
  className,
  empty = false,
  children
}: Readonly<{ className: string; empty?: boolean; children: (onFeedback: (text: string) => void) => ReactNode }>) {
  const [feedback, setFeedback] = useState("");
  if (empty && !feedback) return null;
  return (
    <div className={className}>
      {children(setFeedback)}
      {feedback && (
        <p className="save-prompt-outcome" role="status">
          {feedback}
        </p>
      )}
    </div>
  );
}

/** A player's own economy: Action/Bonus only on their turn; the reaction is markable any time. Pressed = spent. Only
 *  the GM gives a spent one back while the table polices the action economy, so a pressed slot is locked then. */
export function PlayerTurnEconomy({
  combat,
  myId,
  myTurn,
  mySpeedFeet,
  revision,
  endWaits,
  quiet = false
}: Readonly<{
  combat: PlayerView["combat"];
  myId: string;
  myTurn: boolean;
  mySpeedFeet?: number;
  /** The game's revision: this turn's movement budget (Dash and Slow included) is asked again as it changes. */
  revision?: number;
  /** Why End turn waits (a death save still to roll); it is disabled meanwhile. */
  endWaits?: string;
  /** Another primary leads the view (a roll to make), so End turn steps down. */
  quiet?: boolean;
}>) {
  const [busy, setBusy] = useState(false);
  const budget = useMovementBudget(myTurn && revision !== undefined ? myId : null, revision ?? 0);
  const moveBudget = budget?.speedFeet ?? mySpeedFeet;
  const [feedback, setFeedback] = useState("");
  const emit = (run: () => Promise<MutationResult>, failure: string) => {
    setBusy(true);
    void run().then((result) => {
      setBusy(false);
      setFeedback(result.ok ? "" : (result.message ?? failure));
    });
  };
  const reactionUsed = combat.reactionsUsed.includes(myId);
  const giveBackLocked = (combat.ruleExceptions.economy ?? combat.rulesMode) !== "freeform";
  const lockedTitle = "Spent - only the GM can give it back";
  return (
    <div className="turn-economy" role="group" aria-label="Your turn resources">
      {myTurn && (
        <>
          <button
            type="button"
            className="economy-slot"
            aria-pressed={combat.turn.actionUsed}
            disabled={busy || (combat.turn.actionUsed && giveBackLocked)}
            title={combat.turn.actionUsed && giveBackLocked ? lockedTitle : undefined}
            onClick={() =>
              emit(
                () => command("turn:use", { slot: "action", used: !combat.turn.actionUsed }),
                "The action could not be updated."
              )
            }
          >
            Action
          </button>
          <button
            type="button"
            className="economy-slot"
            aria-pressed={combat.turn.bonusActionUsed}
            disabled={busy || (combat.turn.bonusActionUsed && giveBackLocked)}
            title={combat.turn.bonusActionUsed && giveBackLocked ? lockedTitle : undefined}
            onClick={() =>
              emit(
                () =>
                  command("turn:use", {
                    slot: "bonus-action",
                    used: !combat.turn.bonusActionUsed
                  }),
                "The bonus action could not be updated."
              )
            }
          >
            Bonus
          </button>
          {combat.turn.extraActionReady && (
            <span className="economy-movement" title="Action Surge or Haste gives you another action this turn">
              +1 action
            </span>
          )}
        </>
      )}
      <button
        type="button"
        className="economy-slot"
        aria-pressed={reactionUsed}
        disabled={busy || (reactionUsed && giveBackLocked)}
        title={reactionUsed && giveBackLocked ? lockedTitle : "Reactions refresh when your turn starts"}
        onClick={() =>
          emit(
            () => command("turn:use-reaction", { actorId: myId, used: !reactionUsed }),
            "The reaction could not be updated."
          )
        }
      >
        Reaction
      </button>
      {myTurn && moveBudget !== undefined && moveBudget !== null && (
        <span className="economy-movement" title="Movement spent this turn / this turn's movement">
          Move {Math.round(combat.turn.movementUsedFeet)}/{moveBudget} ft
        </span>
      )}
      {myTurn && (
        <button
          type="button"
          className={`encounter-primary turn-end${quiet || endWaits ? " is-quiet" : ""}`}
          disabled={busy || endWaits !== undefined}
          title={endWaits}
          onClick={() => emit(() => command("turn:end", {}), "The turn could not end.")}
        >
          End turn
        </button>
      )}
      {feedback && (
        <span className="economy-feedback" role="status">
          {feedback}
        </span>
      )}
    </div>
  );
}

export function PlayerEncounterPanel({ state }: Readonly<{ state: PlayerView }>) {
  const { combat } = state;
  const myId = state.actors.find((actor) => "claimStatus" in actor && actor.claimStatus === "mine")?.id ?? null;
  // Bring the active combatant's row into view when the turn advances.
  const activeRowRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [combat.turnActorId]);
  // Toggle this panel between the turn order and the player's own sheet, which carries live state
  // and combat context so its actions resolve as real attacks.
  const [view, setView] = useState<"initiative" | "sheet">("initiative");
  // The shared per-browser dice-input preference.
  const { rollMode } = useRollPreference();
  // "Jump" sheet-attack mode: an attack tapped on the sheet comes here to pick and confirm, then
  // returns to the sheet once it commits.
  const [returnToSheetAfterAttack, setReturnToSheetAfterAttack] = useState(false);
  const jumpAttackResult = useTargetingResult();
  // One primary at a time: End turn steps down while a roll waits to be made or answered.
  const targeting = useTargeting();
  const rollPending = targeting !== null || jumpAttackResult?.preview === true || hasPlayerPrompt(state);
  const targetHints = usePlayerTargetRows(state, myId);
  useEffect(() => {
    if (returnToSheetAfterAttack && jumpAttackResult && !jumpAttackResult.preview) {
      setView("sheet");
      setReturnToSheetAfterAttack(false);
    }
  }, [returnToSheetAfterAttack, jumpAttackResult]);
  const myActor = state.actors.find((actor) => actor.id === myId) ?? null;
  if (!combat.active)
    return (
      <section className="encounter-panel compact" aria-labelledby="player-initiative-title">
        <Eyebrow>FIGHT</Eyebrow>
        <h2 id="player-initiative-title">Waiting for combat</h2>
        <p>The GM hasn't started a fight yet.</p>
      </section>
    );
  const myTurn = myId !== null && combat.turnActorId === myId;
  // Rotate the turn order so the acting combatant leads. The player's economy rides their own row.
  const activeIndex = combat.initiative.findIndex((entry) => entry.active);
  const orderedInitiative =
    activeIndex > 0
      ? [...combat.initiative.slice(activeIndex), ...combat.initiative.slice(0, activeIndex)]
      : combat.initiative;
  return (
    <section className="encounter-panel combat-active" aria-label={`Turn order - round ${combat.round}`}>
      <div className="encounter-topbar player">
        <strong className="encounter-round">Round {combat.round}</strong>
        {/* The only route into the sheet view besides the post-attack jump; the embedded sheet's
          `onClose` returns to initiative, so this is shown only in the initiative view. */}
        {myActor && view === "initiative" && (
          <Button size="sm" variant="secondary" className="player-sheet-door" onClick={() => setView("sheet")}>
            My sheet
          </Button>
        )}
        {myTurn && (
          <span className="your-turn-flag" role="status">
            Your turn - act, then end it below
          </span>
        )}
        {combat.hiddenTurn && !myTurn && (
          <span className="encounter-quiet-note" role="status">
            The GM is taking a hidden turn.
          </span>
        )}
        {combat.rewound && (
          <span className="encounter-quiet-note" role="status">
            The GM is reviewing an earlier turn.
          </span>
        )}
      </div>
      {/* Questions this player has waiting, pinned above the region like the roll prompt. */}
      <MyPendingAsks state={state} />
      {/* The tracker's scroll region: the turn order scrolls here instead of growing the surface.
        The topbar and roll prompt stay pinned above it. */}
      <div className={`encounter-region scroll-y${view === "sheet" ? " is-sheet" : ""}`}>
        {view === "sheet" && myActor ? (
          <CharacterSheet
            actor={myActor}
            role="player"
            state={state}
            embedded
            combat={{
              revision: state.revision,
              active: combat.active,
              myTurn,
              playerDamageMode: combat.playerDamageMode,
              targets: combat.initiative.map((initiativeEntry) => ({
                actorId: initiativeEntry.actorId,
                name: initiativeEntry.name
              }))
            }}
            onJumpToInitiative={() => {
              setView("initiative");
              setReturnToSheetAfterAttack(true);
            }}
            onClose={() => setView("initiative")}
          />
        ) : (
          <ol className="initiative-list player">
            {orderedInitiative.map((entry) => {
              const isMe = entry.actorId === myId;
              const rowActor = state.actors.find((actor) => actor.id === entry.actorId);
              return (
                <li
                  key={entry.actorId}
                  ref={entry.active ? activeRowRef : undefined}
                  className={`${entry.active ? "active" : ""}${isMe ? " you" : ""}`.trim()}
                  aria-current={entry.active ? "step" : undefined}
                >
                  {/* The row shared with the shared-screen viewer, so the two lists never drift. */}
                  <InitiativeRow entry={entry} self={isMe} />
                  {isMe && myId !== null && (
                    <PlayerTurnEconomy
                      combat={combat}
                      myId={myId}
                      myTurn={myTurn}
                      mySpeedFeet={rowActor?.speedFeet}
                      revision={state.revision}
                      quiet={rollPending}
                      {...(myActor && owesDeathSave(state, myActor) ? { endWaits: "Roll your death save first." } : {})}
                    />
                  )}
                  {/* On your turn, the interactive action console. */}
                  {isMe && myTurn && myId !== null && rowActor?.definition && (
                    <PlayerActionRunner
                      actorId={myId}
                      definition={rowActor.definition}
                      revision={state.revision}
                      inspired={rowActor.heroicInspiration === true}
                      playerDamageMode={combat.playerDamageMode}
                      targets={combat.initiative.map((initiativeEntry) => ({
                        actorId: initiativeEntry.actorId,
                        name: initiativeEntry.name
                      }))}
                      {...(myActor && isDying(myActor) ? { unavailable: "unavailable while Unconscious" } : {})}
                      targetRows={targetHints.rows}
                      {...(targetHints.insideNow ? { insideNow: targetHints.insideNow } : {})}
                    />
                  )}
                  {isMe && rowActor && (
                    <OwnFeedback className="own-effect-row" empty={rowActor.effects.length === 0}>
                      {(onFeedback) => (
                        <EffectChips
                          actorId={entry.actorId}
                          effects={rowActor.effects}
                          canEnd={false}
                          canAsk={combat.active}
                          canAct
                          onFeedback={onFeedback}
                        />
                      )}
                    </OwnFeedback>
                  )}
                  {/* What this player's character holds on someone else (a grapple, a Concentration spell's
                    hold): theirs to let go of from that creature's row. */}
                  {!isMe && rowActor && (
                    <OwnFeedback
                      className="own-effect-row"
                      empty={!rowActor.effects.some((effect) => effect.yours === true)}
                    >
                      {(onFeedback) => (
                        <EffectChips
                          actorId={entry.actorId}
                          effects={rowActor.effects.filter((effect) => effect.yours === true)}
                          canEnd={false}
                          onFeedback={onFeedback}
                        />
                      )}
                    </OwnFeedback>
                  )}
                  {/* On your turn your character can give a dying or knocked-out ally aid: that is its action. */}
                  {!isMe && myTurn && myActor && rowActor && (rowActor.deathSaves || isKnockedOut(rowActor)) && (
                    <OwnFeedback className="own-dying">
                      {(onFeedback) =>
                        rowActor.deathSaves ? (
                          <DyingTracker
                            actorId={entry.actorId}
                            name={entry.name}
                            deathSaves={rowActor.deathSaves}
                            canRoll={false}
                            onFeedback={onFeedback}
                            rollMode={rollMode}
                            isActingTurn={false}
                            viewer="player"
                            aid={
                              <StabilizeControl
                                targetId={entry.actorId}
                                targetName={entry.name}
                                helpers={[aidGiverOf(myActor, myActor.definition)]}
                                gm={false}
                                onFeedback={onFeedback}
                              />
                            }
                          />
                        ) : (
                          <StabilizeControl
                            targetId={entry.actorId}
                            targetName={entry.name}
                            helpers={[aidGiverOf(myActor, myActor.definition)]}
                            gm={false}
                            knockedOut
                            onFeedback={onFeedback}
                          />
                        )
                      }
                    </OwnFeedback>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

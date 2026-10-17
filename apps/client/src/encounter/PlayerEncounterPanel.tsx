import { useEffect, useRef, useState, type ReactNode } from "react";
import { type MutationResult, type PlayerView } from "@vtt/domain";
import { SunMark } from "@vtt/ui";
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
import { TablePanel, useRememberedTab, type PanelTab } from "../table/TablePanel";
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

/** What the table puts in a player's panel besides the fight: the prompt slot, the dice, the log, the party. */
export type PlayerPanelSlots = Readonly<{
  /** The prompt slot (and a short rest to spend Hit Dice in), above the tabs. */
  top?: ReactNode;
  dice?: ReactNode;
  log?: ReactNode;
  party?: ReactNode;
  /** Under the player's own sheet: the shared replays and Leave table. */
  sheetFooter?: ReactNode;
}>;

/**
 * A player's panel: in a fight their turn, the order, their sheet and the dice; between fights their character, the
 * party, the dice and the log. The footer keeps the turn's economy and End turn under the thumb.
 */
export function PlayerEncounterPanel({
  state,
  phone = false,
  slots
}: Readonly<{ state: PlayerView; phone?: boolean; slots?: PlayerPanelSlots }>) {
  const { combat } = state;
  const myId = state.actors.find((actor) => "claimStatus" in actor && actor.claimStatus === "mine")?.id ?? null;
  const myActor = state.actors.find((actor) => actor.id === myId) ?? null;
  // Bring the active combatant's row into view when the turn advances.
  const activeRowRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [combat.turnActorId]);
  const fighting = combat.active;
  const tabIds = fighting ? ["turn", "order", "sheet", "dice", "log"] : ["me", "party", "dice", "log"];
  const [tab, setTab] = useRememberedTab(
    `vtt.table-tab.player.${phone ? "phone" : "laptop"}`,
    tabIds,
    fighting ? "turn" : "me",
    `${fighting}|${phone}`
  );
  // "Jump" sheet-attack mode: an attack tapped on the sheet comes to the Turn tab to pick and confirm, then
  // returns to the sheet once it commits.
  const [returnToSheetAfterAttack, setReturnToSheetAfterAttack] = useState(false);
  const jumpAttackResult = useTargetingResult();
  // One primary at a time: End turn steps down while a roll waits to be made or answered.
  const targeting = useTargeting();
  const rollPending = targeting !== null || jumpAttackResult?.preview === true || hasPlayerPrompt(state);
  const targetHints = usePlayerTargetRows(state, myId);
  useEffect(() => {
    if (returnToSheetAfterAttack && jumpAttackResult && !jumpAttackResult.preview) {
      setTab("sheet");
      setReturnToSheetAfterAttack(false);
    }
  }, [returnToSheetAfterAttack, jumpAttackResult, setTab]);
  const { rollMode } = useRollPreference();
  const myTurn = myId !== null && combat.turnActorId === myId;
  const inFight = myId !== null && combat.initiative.some((entry) => entry.actorId === myId);
  const actingName = combat.initiative.find((entry) => entry.active)?.name;
  const targets = combat.initiative.map((entry) => ({ actorId: entry.actorId, name: entry.name }));

  const sheet = (inCombat: boolean) =>
    myActor ? (
      <>
        <CharacterSheet
          actor={myActor}
          role="player"
          state={state}
          embedded
          {...(inCombat
            ? {
                combat: {
                  revision: state.revision,
                  active: combat.active,
                  myTurn,
                  playerDamageMode: combat.playerDamageMode,
                  targets
                }
              }
            : {})}
          onJumpToInitiative={() => {
            setTab("turn");
            setReturnToSheetAfterAttack(true);
          }}
          onClose={() => setTab(inCombat ? "turn" : "me")}
        />
        {slots?.sheetFooter}
      </>
    ) : (
      <>
        <p className="table-panel-empty">Claim a character to see the sheet here.</p>
        {slots?.sheetFooter}
      </>
    );

  const turnBody = (
    <section className="player-turn" aria-label={myTurn ? "Your turn" : "The turn"}>
      <div className="player-turn-head">
        {myTurn ? (
          <h2 className="player-turn-title">
            <SunMark size="sm" />
            Your turn
          </h2>
        ) : combat.hiddenTurn ? (
          <p className="encounter-quiet-note">The GM is taking a hidden turn.</p>
        ) : (
          <p className="encounter-quiet-note">
            {actingName ? `${actingName} is acting.` : "Waiting for the next turn."}
          </p>
        )}
        {combat.rewound && <p className="encounter-quiet-note">The GM is reviewing an earlier turn.</p>}
      </div>
      {/* Questions this player has waiting. */}
      <MyPendingAsks state={state} />
      {!inFight && myActor && <p className="table-panel-empty">{myActor.name} isn't in this fight.</p>}
      {myTurn && myId !== null && myActor?.definition && (
        <PlayerActionRunner
          actorId={myId}
          definition={myActor.definition}
          revision={state.revision}
          inspired={myActor.heroicInspiration === true}
          playerDamageMode={combat.playerDamageMode}
          targets={targets}
          {...(isDying(myActor) ? { unavailable: "unavailable while Unconscious" } : {})}
          targetRows={targetHints.rows}
          {...(targetHints.insideNow ? { insideNow: targetHints.insideNow } : {})}
        />
      )}
      {myActor && inFight && (
        <OwnFeedback className="own-effect-row" empty={myActor.effects.length === 0}>
          {(onFeedback) => (
            <EffectChips
              actorId={myActor.id}
              effects={myActor.effects}
              canEnd={false}
              canAsk={combat.active}
              canAct
              onFeedback={onFeedback}
            />
          )}
        </OwnFeedback>
      )}
      {/* On your turn your character can give a dying or knocked-out ally aid: that is its action. */}
      {myTurn &&
        myActor &&
        combat.initiative.map((entry) => {
          const rowActor = state.actors.find((actor) => actor.id === entry.actorId);
          if (!rowActor || rowActor.id === myId || !(rowActor.deathSaves || isKnockedOut(rowActor))) return null;
          return (
            <OwnFeedback key={entry.actorId} className="own-dying">
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
          );
        })}
    </section>
  );

  const orderBody = (
    <section className="encounter-panel combat-active" aria-label={`Turn order · round ${combat.round}`}>
      <div className="encounter-order-head">
        <strong className="encounter-round">Round {combat.round}</strong>
      </div>
      <ol className="initiative-list player">
        {combat.initiative.map((entry) => {
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
              {/* What this player's character holds on someone else (a grapple, a Concentration spell's hold):
                theirs to let go of from that creature's row. */}
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
            </li>
          );
        })}
      </ol>
    </section>
  );

  const tabs: PanelTab[] = fighting
    ? [
        { id: "turn", label: "Turn", content: turnBody },
        { id: "order", label: "Order", content: orderBody },
        { id: "sheet", label: "Sheet", content: sheet(true) },
        { id: "dice", label: "Dice", content: slots?.dice },
        { id: "log", label: "Log", content: slots?.log, scrolls: false }
      ]
    : [
        { id: "me", label: "Me", content: sheet(false) },
        {
          id: "party",
          label: "Party",
          content: slots?.party ?? <p className="table-panel-empty">The party is hidden.</p>
        },
        { id: "dice", label: "Dice", content: slots?.dice },
        { id: "log", label: "Log", content: slots?.log, scrolls: false }
      ];

  // The footer keeps the turn under the thumb: the economy and End turn on this player's turn, and their reaction
  // and HP while someone else acts.
  const footer =
    fighting && inFight && myId !== null ? (
      <div className="table-panel-foot-row player-foot">
        {!myTurn && (
          <span className="player-foot-watch">
            <strong>{combat.hiddenTurn ? "A hidden turn" : actingName ? `${actingName} is acting` : "Waiting"}</strong>
            {myActor && "hp" in myActor && myActor.hp.kind === "exact" && (
              <span>
                HP {myActor.hp.current}/{myActor.hp.maximum}
              </span>
            )}
          </span>
        )}
        <PlayerTurnEconomy
          combat={combat}
          myId={myId}
          myTurn={myTurn}
          mySpeedFeet={myActor?.speedFeet}
          revision={state.revision}
          quiet={rollPending}
          {...(myActor && owesDeathSave(state, myActor) ? { endWaits: "Roll your death save first." } : {})}
        />
      </div>
    ) : null;

  return (
    <TablePanel
      label={fighting ? `The fight · round ${combat.round}` : "The table"}
      top={slots?.top}
      tabs={tabs}
      active={tab}
      onActive={setTab}
      phone={phone}
      footer={footer}
    />
  );
}

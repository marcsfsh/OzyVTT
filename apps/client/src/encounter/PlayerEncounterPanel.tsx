import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { type MutationResult, type PlayerView } from "@vtt/domain";
import { Button, Lamp, MoveLamp, useToast } from "@vtt/ui";
import { command } from "../lib/command";
import { useMovementBudget } from "../scene/useMovementBudget";
import { MyPendingAsks } from "./RuleAsk";
import { useTargetingResult } from "./targeting";
import { useRollPreference } from "../dice/roll-preference";
import { CharacterSheet } from "../sheet/CharacterSheet";
import { InitiativeRow } from "./InitiativeList";
import { EffectChips } from "./EffectChips";
import { DyingTracker } from "./DyingTracker";
import { aidGiverOf, isKnockedOut, StabilizeControl } from "./StabilizeControl";
import { PlayerActionRunner } from "./PlayerActionRunner";
import { CommandedCreatures, commandedOf } from "./CommandedCreatures";
import { UnconsciousNote } from "../sheet/PlayFight";
import { isDying, owesDeathSave } from "../table/playerPrompts";
import { hasPlayerPrompt } from "../table/PromptSlot";
import { LogComposer } from "../table/LogComposer";
import { TablePanel, useRememberedTab, type PanelTab } from "../table/TablePanel";
import { usePlayerTargetRows } from "../table/targetRows";
import { useTargeting } from "./targeting";
import { revealInRegion } from "../lib/reveal";
import { LampToggle } from "./LampToggle";
import { PlayerTurnCard } from "./PlayerTurnCard";
import { navigate, replaceQuery, useRoute } from "../router";

/**
 * A player's own prompts keep their outcome line beside them: answering one unmounts it, and the
 * player panel has no feedback line of its own. Hidden while there is nothing to answer or report.
 */
/** Whether the sheet holds the Alert feat, whose Initiative Swap the turn order offers. */
const holdsAlert = (definition: PlayerView["actors"][number]["definition"]) =>
  (definition?.character?.features ?? []).some((feature) => feature.id === "alert");

/**
 * Alert's Initiative Swap (SRD 5.2.1): "Immediately after you roll Initiative, you can swap your Initiative with the
 * Initiative of one willing ally". The Alert holder's player offers it to another character; that character's player
 * takes it here. The server checks the timing and the Incapacitated condition, and makes the swap.
 */
export function InitiativeSwap({ state, myId, alert }: Readonly<{ state: PlayerView; myId: string; alert: boolean }>) {
  const combat = state.combat;
  const nameOf = (actorId: string) => state.actors.find((actor) => actor.id === actorId)?.name ?? "an ally";
  const offers = (combat.initiativeSwapOffers ?? []).filter((offer) => offer.withActorId === myId);
  const offered = (combat.initiativeSwapOffers ?? []).find((offer) => offer.actorId === myId);
  const allies = alert
    ? combat.initiative.filter(
        (entry) =>
          entry.actorId !== myId &&
          state.actors.find((actor) => actor.id === entry.actorId)?.kind === "player-character"
      )
    : [];
  const send = (actorId: string, withActorId: string, done: string, onFeedback: (text: string) => void) =>
    void command("initiative:swap", { actorId, withActorId }).then((result) =>
      onFeedback(result.ok ? done : (result.message ?? "Refused."))
    );
  return (
    <OwnFeedback className="initiative-tie-row" empty={offers.length === 0 && allies.length === 0}>
      {(onFeedback) => (
        <>
          {offers.map((offer) => (
            <Button
              key={offer.actorId}
              size="sm"
              onClick={() =>
                send(myId, offer.actorId, `You swapped Initiative with ${nameOf(offer.actorId)}.`, onFeedback)
              }
            >
              Swap Initiative with {nameOf(offer.actorId)}
            </Button>
          ))}
          {allies.map((ally) => (
            <Button
              key={ally.actorId}
              size="sm"
              variant="secondary"
              aria-pressed={offered?.withActorId === ally.actorId}
              onClick={() =>
                send(
                  myId,
                  ally.actorId,
                  `Initiative Swap offered to ${nameOf(ally.actorId)}. It is made when their player takes it.`,
                  onFeedback
                )
              }
            >
              Offer {nameOf(ally.actorId)} a swap (Alert)
            </Button>
          ))}
        </>
      )}
    </OwnFeedback>
  );
}

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

/** A player's own economy as the turn card's four lamps: Action and Bonus lit only on their turn, the Reaction
 *  markable any time, Move from the server's budget. Pressed = spent. Only the GM gives a spent one back while the
 *  table polices the action economy, so a pressed lamp is locked then. */
export function PlayerTurnEconomy({
  combat,
  myId,
  myTurn,
  mySpeedFeet,
  revision,
  unconscious = false
}: Readonly<{
  combat: PlayerView["combat"];
  myId: string;
  myTurn: boolean;
  mySpeedFeet?: number;
  /** The game's revision: this turn's movement budget (Dash and Slow included) is asked again as it changes. */
  revision?: number;
  /** The character is Unconscious, so it can't take a reaction. */
  unconscious?: boolean;
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
  const lockedTitle = "Spent. Only the GM can give it back.";
  const usedFeet = Math.round(combat.turn.movementUsedFeet);
  return (
    <div
      className={`turn-economy lamp-row${unconscious ? " is-unconscious" : ""}`}
      role="group"
      aria-label={unconscious ? "Your turn resources · Unconscious" : "Your turn resources"}
    >
      <LampToggle
        kind="action"
        label="Action"
        used={myTurn && combat.turn.actionUsed}
        lit={myTurn && !combat.turn.actionUsed && !unconscious}
        disabled={!myTurn || busy || unconscious || (combat.turn.actionUsed && giveBackLocked)}
        title={!myTurn ? "On your turn" : combat.turn.actionUsed && giveBackLocked ? lockedTitle : undefined}
        onToggle={() =>
          emit(
            () => command("turn:use", { slot: "action", used: !combat.turn.actionUsed }),
            "The action could not be updated."
          )
        }
      />
      <LampToggle
        kind="bonus"
        label="Bonus"
        used={myTurn && combat.turn.bonusActionUsed}
        lit={myTurn && !combat.turn.bonusActionUsed && !unconscious}
        disabled={!myTurn || busy || unconscious || (combat.turn.bonusActionUsed && giveBackLocked)}
        title={!myTurn ? "On your turn" : combat.turn.bonusActionUsed && giveBackLocked ? lockedTitle : undefined}
        onToggle={() =>
          emit(
            () => command("turn:use", { slot: "bonus-action", used: !combat.turn.bonusActionUsed }),
            "The Bonus Action could not be updated."
          )
        }
      />
      <LampToggle
        kind="reaction"
        label="Reaction"
        used={reactionUsed}
        lit={!reactionUsed && !unconscious}
        disabled={busy || unconscious || (reactionUsed && giveBackLocked)}
        title={
          unconscious
            ? "Unconscious: no reactions"
            : reactionUsed && giveBackLocked
              ? lockedTitle
              : "Reactions refresh when your turn starts"
        }
        onToggle={() =>
          emit(
            () => command("turn:use-reaction", { actorId: myId, used: !reactionUsed }),
            "The reaction could not be updated."
          )
        }
      />
      {myTurn && moveBudget !== undefined && moveBudget !== null ? (
        <MoveLamp feetLeft={moveBudget - usedFeet} speedFeet={moveBudget} />
      ) : (
        <Lamp kind="on" lit={false} label="Move" unavailableReason="On your turn" />
      )}
      {myTurn && combat.turn.extraActionReady && (
        <span className="economy-extra" title="Action Surge or Haste gives you another action this turn">
          +1 action
        </span>
      )}
      {myTurn && moveBudget !== undefined && moveBudget !== null && usedFeet > moveBudget && (
        // Past the budget the gauge sits empty; the feet over it still read exactly.
        <span className="economy-extra">{usedFeet - moveBudget} ft over</span>
      )}
      {feedback && (
        <span className="economy-feedback" role="status">
          {feedback}
        </span>
      )}
    </div>
  );
}

/** End turn, under the thumb on this player's turn; it waits while a death save is owed and steps down for a roll. */
export function PlayerEndTurn({
  endWaits,
  quiet = false
}: Readonly<{
  /** Why End turn waits (a death save still to roll); it is disabled meanwhile. */
  endWaits?: string;
  /** Another primary leads the view (a roll to make), so End turn steps down. */
  quiet?: boolean;
}>) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  return (
    <div className="player-end-turn">
      <Button
        variant={quiet || endWaits ? "secondary" : "primary"}
        className="table-panel-primary turn-end"
        disabled={busy || endWaits !== undefined}
        title={endWaits}
        onClick={() => {
          setBusy(true);
          void command("turn:end", {}).then((result) => {
            setBusy(false);
            if (!result.ok) toast(result.message ?? "The turn could not end.", { tone: "error" });
          });
        }}
      >
        End turn
      </Button>
    </div>
  );
}

/** What the table puts in a player's panel besides the fight: the prompt slot, the dice, the log, the party. */
export type PlayerPanelSlots = Readonly<{
  /** The prompt slot (and a Short Rest to spend Hit Dice in), above the tabs. */
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
  slots,
  onSheetShown
}: Readonly<{
  state: PlayerView;
  phone?: boolean;
  slots?: PlayerPanelSlots;
  /** Whether the panel shows the player's own sheet, so a phone's divider can give the sheet the height. */
  onSheetShown?: (shown: boolean) => void;
}>) {
  const { combat } = state;
  const myId = state.actors.find((actor) => "claimStatus" in actor && actor.claimStatus === "mine")?.id ?? null;
  const myActor = state.actors.find((actor) => actor.id === myId) ?? null;
  // The creatures the character commands; on one's own turn, the player acts for it.
  const commanded = commandedOf(state);
  const actingFor = combat.active
    ? (commanded.find((actor) => actor.id === combat.turnActorId && actor.definition) ?? null)
    : null;
  const creatureList =
    myActor && commanded.length > 0 ? (
      <CommandedCreatures creatures={commanded} commanderId={myActor.id} commanderName={myActor.name} />
    ) : null;
  // Bring the active combatant's row into view when the turn advances.
  const activeRowRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    revealInRegion(activeRowRef.current, "nearest", "smooth");
  }, [combat.turnActorId]);
  const fighting = combat.active;
  const tabIds = fighting ? ["turn", "sheet", "log", "party"] : ["me", "log", "party"];
  const [rememberedTab, setRememberedTab] = useRememberedTab(
    `vtt.table-tab.player.${phone ? "phone" : "laptop"}`,
    tabIds,
    fighting ? "turn" : "me",
    `${fighting}|${phone}`
  );
  // The Log section is this panel at `/table?panel=log`: the address opens the Log tab, and choosing another tab
  // takes the key away again. Same panel, same subscriptions, so a typed formula survives the switch.
  const route = useRoute();
  const logAddressed = route.query.get("panel") === "log";
  const tab = logAddressed ? "log" : rememberedTab;
  const setTab = useCallback(
    (next: string) => {
      if (logAddressed && next !== "log") replaceQuery((query) => query.delete("panel"));
      setRememberedTab(next);
    },
    [logAddressed, setRememberedTab]
  );
  const sheetShown = myActor !== null && tab === (fighting ? "sheet" : "me");
  // The phone's Log section is this panel too, and like the sheet it takes the height from the map.
  const wantsRoom = sheetShown || (phone && logAddressed);
  useEffect(() => {
    onSheetShown?.(wantsRoom);
    return () => onSheetShown?.(false);
  }, [onSheetShown, wantsRoom]);
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
  const targets = combat.initiative.map((entry) => ({ actorId: entry.actorId, name: entry.name }));

  const sheet = (inCombat: boolean) =>
    myActor ? (
      <>
        <CharacterSheet
          actor={myActor}
          role="player"
          state={state}
          presentation="panel"
          phone={phone}
          hidePlay={inCombat}
          /* A phone's sheet under the map has no room for a target picker, so its attacks are aimed on the Turn tab. */
          {...(phone ? { attackMode: "jump" as const } : {})}
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
          {...(state.builderPolicy?.playerBuilder === "open"
            ? { onLevel: () => navigate(`/characters/${myActor.id}/level`) }
            : {})}
          end={
            creatureList ? (
              <>
                {creatureList}
                {slots?.sheetFooter}
              </>
            ) : (
              slots?.sheetFooter
            )
          }
          onClose={() => setTab(inCombat ? "turn" : "me")}
        />
      </>
    ) : (
      <>
        <p className="table-panel-empty">Claim a character to see the sheet here.</p>
        {slots?.sheetFooter}
      </>
    );

  const acting = combat.initiative.find((entry) => entry.active)?.name ?? null;
  const dying = myActor !== null && isDying(myActor);
  const runner = actingFor?.definition ? (
    <PlayerActionRunner
      actorId={actingFor.id}
      definition={actingFor.definition}
      revision={state.revision}
      playerDamageMode={combat.playerDamageMode}
      targets={targets}
      actor={actingFor}
      myTurn
      look={phone ? "card" : "list"}
      round={combat.round}
      acting={acting}
      turnTitle={`${actingFor.name}'s turn`}
      pinnable={false}
      cardHead={false}
    />
  ) : inFight && myId !== null && myActor?.definition && !dying ? (
    <PlayerActionRunner
      actorId={myId}
      definition={myActor.definition}
      revision={state.revision}
      inspired={myActor.heroicInspiration === true}
      playerDamageMode={combat.playerDamageMode}
      targets={targets}
      actor={myActor}
      myTurn={myTurn}
      look={phone ? "card" : "list"}
      round={combat.round}
      acting={acting}
      targetRows={targetHints.rows}
      {...(targetHints.insideNow ? { insideNow: targetHints.insideNow } : {})}
      cardHead={false}
    />
  ) : null;
  // The turn card's lamps: the commanded creature's on its turn, the character's own otherwise.
  const economy = actingFor ? (
    <PlayerTurnEconomy
      combat={combat}
      myId={actingFor.id}
      myTurn
      mySpeedFeet={actingFor.speedFeet}
      revision={state.revision}
    />
  ) : inFight && myId !== null ? (
    <PlayerTurnEconomy
      combat={combat}
      myId={myId}
      myTurn={myTurn}
      mySpeedFeet={myActor?.speedFeet}
      revision={state.revision}
      unconscious={myActor !== null && isDying(myActor)}
    />
  ) : null;
  const turnBody = (
    <section
      className="player-turn"
      aria-label={myTurn ? "Your turn" : actingFor ? `${actingFor.name}'s turn` : "The turn"}
    >
      {(myId !== null || actingFor) && (
        <PlayerTurnCard
          state={state}
          myId={myId}
          myTurn={myTurn}
          {...(actingFor ? { title: `${actingFor.name}'s turn` } : {})}
          lamps={economy}
        >
          {actingFor && (
            <p className="encounter-quiet-note">
              {myActor ? `${myActor.name} commands it: you act for it.` : "You act for it."}
            </p>
          )}
          {combat.rewound && <p className="encounter-quiet-note">The GM is reviewing an earlier turn.</p>}
        </PlayerTurnCard>
      )}
      {/* Questions this player has waiting. */}
      <MyPendingAsks state={state} />
      {!inFight && myActor && <p className="table-panel-empty">{myActor.name} isn't in this encounter.</p>}
      {/* The death save waits in the prompt slot above the tabs; this tab says what Unconscious leaves. */}
      {inFight && dying && myActor && <UnconsciousNote name={myActor.name} />}
      {runner}
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
      {creatureList}
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
              {/* SRD Initiative: the players decide the order among tied characters, before either has acted. */}
              {isMe && combat.round === 1 && (
                <OwnFeedback
                  className="initiative-tie-row"
                  empty={
                    !combat.initiative.some(
                      (other) =>
                        other.actorId !== entry.actorId &&
                        other.score === entry.score &&
                        state.actors.find((actor) => actor.id === other.actorId)?.kind === "player-character"
                    )
                  }
                >
                  {(onFeedback) =>
                    combat.initiative
                      .filter(
                        (other) =>
                          other.actorId !== entry.actorId &&
                          other.score === entry.score &&
                          state.actors.find((actor) => actor.id === other.actorId)?.kind === "player-character"
                      )
                      .map((other) => (
                        <Button
                          key={other.actorId}
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            void command("initiative:order-tie", {
                              actorId: entry.actorId,
                              beforeActorId: other.actorId
                            }).then((result) =>
                              onFeedback(result.ok ? `You go before ${other.name}.` : (result.message ?? "Refused."))
                            )
                          }
                        >
                          Go before {other.name}
                        </Button>
                      ))
                  }
                </OwnFeedback>
              )}
              {/* Alert's Initiative Swap, right after the roll: offered to another character, or taken from one. */}
              {isMe && combat.round === 1 && myActor && (
                <InitiativeSwap state={state} myId={entry.actorId} alert={holdsAlert(myActor.definition)} />
              )}
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

  const logBody = (
    <div className="table-log-tab">
      {slots?.log}
      <LogComposer
        options={slots?.dice}
        talk={{
          role: "player",
          speaker:
            state.actors
              .filter((actor) => actor.claimStatus === "mine")
              .map((actor) => ({ id: actor.id, name: actor.name }))[0] ?? null
        }}
      />
    </div>
  );
  const party = slots?.party ?? <p className="table-panel-empty">The party is hidden.</p>;
  const tabs: PanelTab[] = fighting
    ? [
        {
          id: "turn",
          label: "Turn",
          content: (
            <>
              {turnBody}
              {/* The order with what the player can do from it: break a tie, swap with Alert, let go of a hold. */}
              <details className="encounter-order-tools">
                <summary>Turn order</summary>
                {orderBody}
              </details>
            </>
          )
        },
        // The sheet holds its own row and strip above the one region that scrolls.
        { id: "sheet", label: "Sheet", content: sheet(true), scrolls: !myActor },
        { id: "log", label: "Log", content: logBody, scrolls: false },
        { id: "party", label: "Party", content: party }
      ]
    : [
        { id: "me", label: "Me", content: sheet(false), scrolls: !myActor },
        { id: "log", label: "Log", content: logBody, scrolls: false },
        { id: "party", label: "Party", content: party }
      ];

  // End turn under the thumb, on this player's turn or the turn of a creature they command.
  const footer =
    actingFor || (fighting && inFight && myTurn) ? (
      <PlayerEndTurn
        quiet={rollPending}
        {...(!actingFor && myActor && owesDeathSave(state, myActor) ? { endWaits: "Roll your death save first." } : {})}
      />
    ) : null;

  return (
    <TablePanel
      label={fighting ? `The encounter · round ${combat.round}` : "The table"}
      top={slots?.top}
      tabs={tabs}
      active={tab}
      onActive={setTab}
      phone={phone}
      footer={footer}
    />
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import { type MutationResult, type PlayerView } from "@vtt/domain";
import { SunMark } from "@vtt/ui";
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
import { TablePanel, useRememberedTab, type PanelTab } from "../table/TablePanel";
import { usePlayerTargetRows } from "../table/targetRows";
import { useTargeting } from "./targeting";
import { revealInRegion } from "../lib/reveal";
import { navigate } from "../router";

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
  quiet = false,
  unconscious = false,
  hp
}: Readonly<{
  combat: PlayerView["combat"];
  myId: string;
  myTurn: boolean;
  mySpeedFeet?: number;
  /** The character's hit points, shown beside the movement. */
  hp?: string;
  /** The game's revision: this turn's movement budget (Dash and Slow included) is asked again as it changes. */
  revision?: number;
  /** Why End turn waits (a death save still to roll); it is disabled meanwhile. */
  endWaits?: string;
  /** Another primary leads the view (a roll to make), so End turn steps down. */
  quiet?: boolean;
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
  const showMove = myTurn && moveBudget !== undefined && moveBudget !== null;
  const giveBackLocked = (combat.ruleExceptions.economy ?? combat.rulesMode) !== "freeform";
  const lockedTitle = "Spent. Only the GM can give it back.";
  return (
    <div
      className={`turn-economy${unconscious ? " is-unconscious" : ""}`}
      role="group"
      aria-label={unconscious ? "Your turn resources · Unconscious" : "Your turn resources"}
    >
      {myTurn && (
        <>
          <button
            type="button"
            className="economy-slot"
            aria-pressed={combat.turn.actionUsed}
            disabled={busy || unconscious || (combat.turn.actionUsed && giveBackLocked)}
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
            disabled={busy || unconscious || (combat.turn.bonusActionUsed && giveBackLocked)}
            title={combat.turn.bonusActionUsed && giveBackLocked ? lockedTitle : undefined}
            onClick={() =>
              emit(
                () =>
                  command("turn:use", {
                    slot: "bonus-action",
                    used: !combat.turn.bonusActionUsed
                  }),
                "The Bonus Action could not be updated."
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
        disabled={busy || unconscious || (reactionUsed && giveBackLocked)}
        title={
          unconscious
            ? "Unconscious: no reactions"
            : reactionUsed && giveBackLocked
              ? lockedTitle
              : "Reactions refresh when your turn starts"
        }
        onClick={() =>
          emit(
            () => command("turn:use-reaction", { actorId: myId, used: !reactionUsed }),
            "The reaction could not be updated."
          )
        }
      >
        Reaction
      </button>
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
      {/* The readouts follow the buttons, so on a phone End turn shares the buttons' row and the bar keeps two rows. */}
      {(hp !== undefined || showMove) && (
        <span className="economy-status">
          {hp !== undefined && <span className="economy-hp">{hp}</span>}
          {showMove && (
            <span className="economy-movement" title="Movement spent this turn / this turn's movement">
              Move {Math.round(combat.turn.movementUsedFeet)}/{moveBudget} ft
            </span>
          )}
        </span>
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
  /** The prompt slot (and a Short Rest to spend Hit Dice in), above the tabs. */
  top?: ReactNode;
  dice?: ReactNode;
  log?: ReactNode;
  party?: ReactNode;
  /** Under the player's own sheet: the shared replays and Leave table. */
  sheetFooter?: ReactNode;
  /** The Codex at the table, read through this player's projection. */
  codex?: ReactNode;
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
  const codexIds = slots?.codex ? ["codex"] : [];
  const tabIds = fighting
    ? ["turn", "order", "sheet", ...codexIds, "dice", "log"]
    : ["me", "party", ...codexIds, "dice", "log"];
  const [tab, setTab] = useRememberedTab(
    `vtt.table-tab.player.${phone ? "phone" : "laptop"}`,
    tabIds,
    fighting ? "turn" : "me",
    `${fighting}|${phone}`
  );
  const sheetShown = myActor !== null && tab === (fighting ? "sheet" : "me");
  useEffect(() => {
    onSheetShown?.(sheetShown);
    return () => onSheetShown?.(false);
  }, [onSheetShown, sheetShown]);
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
    />
  ) : null;
  const turnBody = (
    <section
      className="player-turn"
      aria-label={myTurn ? "Your turn" : actingFor ? `${actingFor.name}'s turn` : "The turn"}
    >
      {/* On a phone the turn card carries its own heading; a laptop's list sits under this one. */}
      {(!phone || !runner || actingFor) && (
        <div className="player-turn-head">
          {actingFor ? (
            <>
              <h2 className="player-turn-title">
                <SunMark size="sm" />
                {actingFor.name}&apos;s turn
              </h2>
              <p className="encounter-quiet-note">
                {myActor ? `${myActor.name} commands it: you act for it.` : "You act for it."}
              </p>
            </>
          ) : myTurn ? (
            <h2 className="player-turn-title">
              <SunMark size="sm" />
              Your turn
            </h2>
          ) : (
            // Who acts is in the header's status line; this tab is about the player's own turn.
            <p className="encounter-quiet-note">Your Reaction stays ready. The rest waits for your turn.</p>
          )}
          {combat.rewound && <p className="encounter-quiet-note">The GM is reviewing an earlier turn.</p>}
        </div>
      )}
      {phone && runner && combat.rewound && (
        <p className="encounter-quiet-note">The GM is reviewing an earlier turn.</p>
      )}
      {/* Questions this player has waiting. */}
      <MyPendingAsks state={state} />
      {!inFight && myActor && <p className="table-panel-empty">{myActor.name} isn't in this fight.</p>}
      {/* The death save waits in the prompt slot above the tabs; this tab says what Unconscious leaves. */}
      {inFight && dying && myActor && <UnconsciousNote name={myActor.name} />}
      {runner}
      {creatureList}
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

  const codexTab: PanelTab[] = slots?.codex
    ? [{ id: "codex", label: "Codex", content: slots.codex, scrolls: false }]
    : [];
  const tabs: PanelTab[] = fighting
    ? [
        { id: "turn", label: "Turn", content: turnBody },
        { id: "order", label: "Order", content: orderBody },
        // The sheet holds its own row and strip above the one region that scrolls.
        { id: "sheet", label: "Sheet", content: sheet(true), scrolls: !myActor },
        ...codexTab,
        { id: "dice", label: "Dice", content: slots?.dice },
        { id: "log", label: "Log", content: slots?.log, scrolls: false }
      ]
    : [
        { id: "me", label: "Me", content: sheet(false), scrolls: !myActor },
        {
          id: "party",
          label: "Party",
          content: slots?.party ?? <p className="table-panel-empty">The party is hidden.</p>
        },
        ...codexTab,
        { id: "dice", label: "Dice", content: slots?.dice },
        { id: "log", label: "Log", content: slots?.log, scrolls: false }
      ];

  // The footer keeps the turn under the thumb: the economy and End turn on this player's turn, and their reaction
  // and HP while someone else acts.
  const ownHp = myActor && myActor.hp.kind === "exact" ? myActor.hp : null;
  const creatureHp = actingFor && actingFor.hp.kind === "exact" ? actingFor.hp : null;
  const footer = actingFor ? (
    // The creature's turn: its economy and End turn, which its commander's player runs.
    <div className="table-panel-foot-row player-foot">
      <PlayerTurnEconomy
        combat={combat}
        myId={actingFor.id}
        myTurn
        mySpeedFeet={actingFor.speedFeet}
        revision={state.revision}
        quiet={rollPending}
        {...(creatureHp ? { hp: `HP ${creatureHp.current}/${creatureHp.maximum}` } : {})}
      />
    </div>
  ) : fighting && inFight && myId !== null ? (
    <div className="table-panel-foot-row player-foot">
      <PlayerTurnEconomy
        combat={combat}
        myId={myId}
        myTurn={myTurn}
        mySpeedFeet={myActor?.speedFeet}
        revision={state.revision}
        quiet={rollPending}
        unconscious={myActor !== null && isDying(myActor)}
        /* The character's hit points, in view on every tab. */
        {...(ownHp
          ? { hp: `HP ${ownHp.current}/${ownHp.maximum}${ownHp.temporary > 0 ? ` +${ownHp.temporary}` : ""}` }
          : {})}
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

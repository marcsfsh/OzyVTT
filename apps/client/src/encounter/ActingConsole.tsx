import { Button, IconStar, Roll } from "@vtt/ui";
import { useEffect, useState } from "react";
import type { GmActor, GmView, MutationResult } from "@vtt/domain";
import { command } from "../lib/command";
import { useMovementBudget } from "../scene/useMovementBudget";
import { ActingCard } from "./ActingCard";
import { TurnTabs, useCostTab, type TurnEconomy } from "./TurnTabs";
import { ActionRunner } from "./ActionRunner";
import "./acting-console.css";

/**
 * The acting creature's console: its card, its turn's cost tabs and its action runner, which lists what the chosen tab
 * costs. An off-turn legendary actor takes the card, offers its pool in place of the tabs and lists its legendary
 * actions.
 */
export function ActingConsole({
  state,
  actorsById,
  busy,
  run,
  onFeedback,
  token = null
}: Readonly<{
  state: GmView;
  actorsById: ReadonlyMap<string, GmActor>;
  busy: boolean;
  /** Runs a command with the panel's busy flag and reports `success` on the panel's feedback line. */
  run: (operation: () => Promise<MutationResult>, success: string) => Promise<void>;
  onFeedback: (text: string) => void;
  /** The GM's bearer, for the card's token art. */
  token?: string | null;
}>) {
  // A legendary creature acting off-turn (SRD Legendary Actions) takes over the acting console until
  // the real turn advances.
  const [legendaryActingId, setLegendaryActingId] = useState<string | null>(null);
  useEffect(() => {
    setLegendaryActingId(null);
  }, [state.combat.turnActorId]);
  const turnActor = state.combat.turnActorId ? actorsById.get(state.combat.turnActorId) : undefined;
  // This turn's movement as the server counts it: Dash, Slow and conditions included.
  const movement = useMovementBudget(turnActor?.speedFeet !== undefined ? turnActor.id : null, state.revision);
  const legendaryActor =
    legendaryActingId && legendaryActingId !== state.combat.turnActorId ? actorsById.get(legendaryActingId) : undefined;
  const actor = legendaryActor ?? turnActor;
  // Legendary creatures act on other creatures' turns (SRD Legendary Actions): offer a console
  // switch for each off-turn legendary combatant with actions left.
  const legendaryOffers = state.combat.initiative
    .flatMap((entry) => {
      const candidate = actorsById.get(entry.actorId);
      return candidate?.legendary?.actionsPerRound &&
        candidate.id !== state.combat.turnActorId &&
        candidate.id !== legendaryActingId
        ? [candidate]
        : [];
    })
    .map((candidate) => ({
      candidate,
      remaining: Math.max(
        0,
        (candidate.legendary!.actionsPerRound ?? 0) - (state.combat.legendaryUsed[candidate.id] ?? 0)
      )
    }));
  const spentKey = state.combat.turnActorId ?? "";
  const [tab, setTab] = useCostTab(
    `${state.combat.round}:${spentKey}`,
    {
      action: { used: state.combat.turn.actionUsed, now: true },
      bonus: { used: state.combat.turn.bonusActionUsed, now: true },
      reaction: { used: turnActor ? state.combat.reactionsUsed.includes(turnActor.id) : false, now: true },
      move: null
    },
    false
  );
  if (!actor) return null;
  // At 0 HP a creature is down: its death saves (PCs) show above a dimmed console, and the server
  // rejects its actions (condition.down) unless the GM forces one through the audited override.
  const down = actor.hp.current <= 0;
  const legendaryPool = legendaryActor?.legendary?.actionsPerRound;
  const legendarySpent = legendaryActor ? (state.combat.legendaryUsed[legendaryActor.id] ?? 0) : 0;
  const speedFeet = legendaryActor ? undefined : (movement?.speedFeet ?? actor.speedFeet);
  const turnPool = turnActor?.legendary?.actionsPerRound ?? undefined;
  const economy: TurnEconomy = {
    action: { used: state.combat.turn.actionUsed, now: true },
    bonus: { used: state.combat.turn.bonusActionUsed, now: true },
    reaction: { used: state.combat.reactionsUsed.includes(actor.id), now: true },
    move: speedFeet !== undefined ? { speedFeet, usedFeet: state.combat.turn.movementUsedFeet } : null,
    ...(turnActor && turnPool
      ? {
          legendary: {
            left: Math.max(0, turnPool - (state.combat.legendaryUsed[turnActor.id] ?? 0)),
            max: turnPool
          }
        }
      : {})
  };
  /** Spend one legendary action run by hand, or give one back (a GM correction). */
  const legendaryButtons = (who: GmActor, pool: number) => {
    const spent = state.combat.legendaryUsed[who.id] ?? 0;
    const spend = (next: number, words: string) =>
      void run(
        () => command("turn:use-legendary", { actorId: who.id, spent: next, expectedRevision: state.revision }),
        words
      );
    return (
      <span className="legendary-marks">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || spent >= pool}
          onClick={() => spend(Math.min(pool, spent + 1), "Legendary action spent.")}
        >
          Spend one
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || spent === 0}
          onClick={() => spend(Math.max(0, spent - 1), "Legendary action restored.")}
        >
          Give one back
        </Button>
      </span>
    );
  };
  return (
    <>
      <ActingCard state={state} actor={actor} token={token} speedFeet={speedFeet} />
      {legendaryOffers.length > 0 && (
        <div className="legendary-strip" role="group" aria-label="Legendary actions available">
          {legendaryOffers.map(({ candidate, remaining }) => (
            <button
              key={candidate.id}
              type="button"
              className="legendary-offer"
              disabled={busy || remaining === 0}
              title={
                remaining === 0
                  ? `${candidate.name} has no legendary actions left this round (they refill when its turn starts).`
                  : `Take a legendary action with ${candidate.name} (used on other creatures' turns).`
              }
              onClick={() => setLegendaryActingId(candidate.id)}
            >
              <IconStar /> {candidate.name} {remaining}/{candidate.legendary!.actionsPerRound}
            </button>
          ))}
        </div>
      )}
      {down && (
        <p className="acting-down-note" role="status">
          {actor.deathSaves ? (
            <>
              <strong>{actor.name} is dying.</strong> The death save waits in Needs you, and actions are disabled.
            </>
          ) : (
            <>
              <strong>{actor.name} is down at 0 HP.</strong> Actions are disabled. Choose one to force it through a
              rules override.
            </>
          )}
        </p>
      )}
      <section
        className={`acting-console${legendaryActor ? " legendary-acting" : ""}${down ? " down" : ""}`}
        aria-label={legendaryActor ? `Legendary action: ${actor.name}` : `Acting now: ${actor.name}`}
      >
        <header className="acting-console-head">
          {/* Only when there is something to show: the legendary actor's name and pool, or the turn
              actor's movement. */}
          {legendaryActor && (
            <div className="acting-console-title">
              <strong className="acting-console-name">Legendary action</strong>
              <span
                className="economy-slot legendary-pill"
                title="Legendary actions remaining this round; the pool refills on its own turn."
              >
                <IconStar /> <Roll value={`${Math.max(0, (legendaryPool ?? 0) - legendarySpent)}/${legendaryPool}`} />
              </span>
            </div>
          )}
          {legendaryActor ? (
            // Off-turn legendary console: the turn economy belongs to the turn actor, so offer a spend (-1, for a
            // legendary action run by hand) and a GM correction (+1) and a way back in place of Action/Bonus/Reaction.
            <div className="acting-console-economy-row">
              <button
                type="button"
                className="economy-slot"
                disabled={busy || legendarySpent >= (legendaryPool ?? 0)}
                title="Spend one legendary action"
                onClick={() =>
                  void run(
                    () =>
                      command("turn:use-legendary", {
                        actorId: actor.id,
                        spent: Math.min(legendaryPool ?? 0, legendarySpent + 1),
                        expectedRevision: state.revision
                      }),
                    "Legendary action spent."
                  )
                }
              >
                −1
              </button>
              <button
                type="button"
                className="economy-slot"
                disabled={busy || legendarySpent === 0}
                title="Restore one legendary action (GM correction)"
                onClick={() =>
                  void run(
                    () =>
                      command("turn:use-legendary", {
                        actorId: actor.id,
                        spent: Math.max(0, legendarySpent - 1),
                        expectedRevision: state.revision
                      }),
                    "Legendary action restored."
                  )
                }
              >
                +1
              </button>
              <button type="button" className="secondary legendary-done" onClick={() => setLegendaryActingId(null)}>
                Back to {turnActor?.name ?? "the turn"}
              </button>
            </div>
          ) : (
            <TurnTabs
              label="This turn"
              economy={economy}
              tab={tab}
              onTab={setTab}
              busy={busy}
              onMark={(cost, used) =>
                void run(
                  () =>
                    cost === "reaction"
                      ? command("turn:use-reaction", { actorId: actor.id, used, expectedRevision: state.revision })
                      : command("turn:use", { slot: cost, used, expectedRevision: state.revision }),
                  `${cost === "action" ? "Action" : cost === "bonus-action" ? "Bonus Action" : "Reaction"} ${used ? "spent" : "restored"}.`
                )
              }
              legendaryControls={turnPool !== undefined && legendaryButtons(turnActor!, turnPool)}
            />
          )}
        </header>
        <ActionRunner state={state} actor={actor} onFeedback={onFeedback} tab={legendaryActor ? "legendary" : tab} />
      </section>
    </>
  );
}

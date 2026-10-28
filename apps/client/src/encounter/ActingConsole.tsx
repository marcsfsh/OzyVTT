import { IconStar, MoveLamp, Roll } from "@vtt/ui";
import { useEffect, useState } from "react";
import type { GmActor, GmView, MutationResult } from "@vtt/domain";
import { command } from "../lib/command";
import { useMovementBudget } from "../scene/useMovementBudget";
import { ActingCard } from "./ActingCard";
import { LampToggle } from "./LampToggle";
import { ActionRunner } from "./ActionRunner";
import "./acting-console.css";

/**
 * The acting creature's console: its card, its turn's lamps and its action runner. An off-turn legendary actor takes
 * the card and offers its pool in place of the lamps.
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
  if (!actor) return null;
  // At 0 HP a creature is down: its death saves (PCs) show above a dimmed console, and the server
  // rejects its actions (condition.down) unless the GM forces one through the audited override.
  const down = actor.hp.current <= 0;
  const legendaryPool = legendaryActor?.legendary?.actionsPerRound;
  const legendarySpent = legendaryActor ? (state.combat.legendaryUsed[legendaryActor.id] ?? 0) : 0;
  const speedFeet = legendaryActor ? undefined : (movement?.speedFeet ?? actor.speedFeet);
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
            <div className="lamp-row" role="group" aria-label="This turn">
              <LampToggle
                kind="action"
                label="Action"
                used={state.combat.turn.actionUsed}
                disabled={busy}
                onToggle={() =>
                  void run(
                    () =>
                      command("turn:use", {
                        slot: "action",
                        used: !state.combat.turn.actionUsed,
                        expectedRevision: state.revision
                      }),
                    state.combat.turn.actionUsed ? "Action restored." : "Action spent."
                  )
                }
              />
              <LampToggle
                kind="bonus"
                label="Bonus"
                used={state.combat.turn.bonusActionUsed}
                disabled={busy}
                onToggle={() =>
                  void run(
                    () =>
                      command("turn:use", {
                        slot: "bonus-action",
                        used: !state.combat.turn.bonusActionUsed,
                        expectedRevision: state.revision
                      }),
                    state.combat.turn.bonusActionUsed ? "Bonus Action restored." : "Bonus Action spent."
                  )
                }
              />
              {/* Reactions refresh on the creature's own turn. */}
              <LampToggle
                kind="reaction"
                label="Reaction"
                used={state.combat.reactionsUsed.includes(actor.id)}
                disabled={busy}
                onToggle={() =>
                  void run(
                    () =>
                      command("turn:use-reaction", {
                        actorId: actor.id,
                        used: !state.combat.reactionsUsed.includes(actor.id),
                        expectedRevision: state.revision
                      }),
                    state.combat.reactionsUsed.includes(actor.id) ? "Reaction restored." : "Reaction spent."
                  )
                }
              />
              {speedFeet !== undefined && (
                <MoveLamp
                  feetLeft={Math.max(0, speedFeet - Math.round(state.combat.turn.movementUsedFeet))}
                  speedFeet={speedFeet}
                />
              )}
            </div>
          )}
        </header>
        <ActionRunner state={state} actor={actor} onFeedback={onFeedback} />
      </section>
    </>
  );
}

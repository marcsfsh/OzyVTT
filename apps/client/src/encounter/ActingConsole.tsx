import { IconStar } from "@vtt/ui";
import { useEffect, useState } from "react";
import type { GmActor, GmView, MutationResult } from "@vtt/domain";
import { command } from "../lib/command";
import { ActionRunner } from "./ActionRunner";
import { DyingTracker } from "./DyingTracker";
import "./acting-console.css";

/**
 * The acting creature's console under the active row: its turn economy and its action runner. A
 * normal turn needs no name header (the row names it); an off-turn legendary actor keeps its name.
 */
export function ActingConsole({
  state,
  actorsById,
  busy,
  run,
  rollMode,
  onFeedback
}: Readonly<{
  state: GmView;
  actorsById: ReadonlyMap<string, GmActor>;
  busy: boolean;
  /** Runs a command with the panel's busy flag and reports `success` on the panel's feedback line. */
  run: (operation: () => Promise<MutationResult>, success: string) => Promise<void>;
  rollMode: "auto" | "manual";
  onFeedback: (text: string) => void;
}>) {
  // A legendary creature acting off-turn (SRD Legendary Actions) takes over the acting console until
  // the real turn advances.
  const [legendaryActingId, setLegendaryActingId] = useState<string | null>(null);
  useEffect(() => {
    setLegendaryActingId(null);
  }, [state.combat.turnActorId]);
  const turnActor = state.combat.turnActorId ? actorsById.get(state.combat.turnActorId) : undefined;
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
  return (
    <>
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
      {down &&
        (actor.deathSaves ? (
          <DyingTracker
            actorId={actor.id}
            name={actor.name}
            deathSaves={actor.deathSaves}
            canRoll
            onFeedback={onFeedback}
            rollMode={rollMode}
            isActingTurn={state.combat.turnActorId === actor.id}
            viewer="gm"
          />
        ) : (
          <p className="acting-down-note" role="status">
            <strong>{actor.name} is down (0 HP).</strong> Actions are disabled — click one to force it through a rules
            override.
          </p>
        ))}
      <section
        className={`acting-console${legendaryActor ? " legendary-acting" : ""}${down ? " down" : ""}`}
        aria-label={legendaryActor ? `Legendary action: ${actor.name}` : `Acting now: ${actor.name}`}
      >
        <header className="acting-console-head">
          {/* Only when there is something to show: the legendary actor's name and pool, or the turn
              actor's movement. */}
          {(legendaryActor || actor.speedFeet !== undefined) && (
            <div className="acting-console-title">
              {legendaryActor && <strong className="acting-console-name">{actor.name}</strong>}
              {legendaryActor ? (
                <span
                  className="economy-slot legendary-pill"
                  title="Legendary actions remaining this round; the pool refills on its own turn."
                >
                  <IconStar /> {Math.max(0, (legendaryPool ?? 0) - legendarySpent)}/{legendaryPool}
                </span>
              ) : (
                actor.speedFeet !== undefined && (
                  <span
                    className="economy-movement"
                    title="Movement spent this turn / base walking speed (Dash and conditions adjust the real budget server-side)"
                  >
                    {Math.round(state.combat.turn.movementUsedFeet)}/{actor.speedFeet} ft
                  </span>
                )
              )}
            </div>
          )}
          {legendaryActor ? (
            // Off-turn legendary console: the turn economy belongs to the turn actor, so offer a GM correction
            // (+1) and a way back instead of Action/Bonus/Reaction.
            <div className="acting-console-economy-row">
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
            <div className="acting-console-economy-row">
              <button
                type="button"
                className="economy-slot"
                aria-pressed={state.combat.turn.actionUsed}
                disabled={busy}
                onClick={() =>
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
              >
                Action
              </button>
              <button
                type="button"
                className="economy-slot"
                aria-pressed={state.combat.turn.bonusActionUsed}
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      command("turn:use", {
                        slot: "bonus-action",
                        used: !state.combat.turn.bonusActionUsed,
                        expectedRevision: state.revision
                      }),
                    state.combat.turn.bonusActionUsed ? "Bonus action restored." : "Bonus action spent."
                  )
                }
              >
                Bonus
              </button>
              <button
                type="button"
                className="economy-slot"
                aria-pressed={state.combat.reactionsUsed.includes(actor.id)}
                disabled={busy}
                title="Reactions refresh on its own turn"
                onClick={() =>
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
              >
                Reaction
              </button>
            </div>
          )}
        </header>
        <ActionRunner state={state} actor={actor} onFeedback={onFeedback} />
      </section>
    </>
  );
}

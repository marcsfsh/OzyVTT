import { useState } from "react";
import { isDead, type GmActor, type GmView, type MutationResult } from "@vtt/domain";
import { Button, Field, Select } from "@vtt/ui";
import { command } from "../lib/command";
import { ConditionEditor } from "./conditions";
import { ConfirmRow } from "./ConfirmRow";
import { CoverControl } from "./CoverControl";
import { HpAdjust } from "./HpAdjust";
import { LairControl } from "./LairControl";
import { PickControl } from "./PickControl";
import { EffectChips } from "./EffectChips";

/**
 * The tools card a turn-order row opens over the list (HP, conditions, effects, reaction, sheet), so
 * rows never shift while the GM works.
 */
export function RowTools({
  actor,
  state,
  busy,
  run,
  hpDamageType,
  onHpDamageTypeChange,
  onOpenSheet,
  onClose,
  onFeedback
}: Readonly<{
  actor: GmActor;
  state: GmView;
  busy: boolean;
  /** Runs a command with the panel's busy flag and reports `success` on the panel's feedback line. */
  run: (operation: () => Promise<MutationResult>, success: string) => Promise<void>;
  /** Panel state, so one type survives applying and opening the next row (a fireball, several tokens). */
  hpDamageType: string | null;
  onHpDamageTypeChange: (type: string | null) => void;
  onOpenSheet: () => void;
  onClose: () => void;
  onFeedback: (text: string) => void;
}>) {
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  // The last combatant ends the encounter instead, and a fight under review can't change its order.
  const removable =
    state.combat.initiative.length > 1 &&
    state.combat.historyCursor === null &&
    state.combat.initiative.some((entry) => entry.actorId === actor.id);
  return (
    <>
      <div className="encounter-overlay-backdrop" onPointerDown={onClose} />
      <div className="row-tools-popover" role="dialog" aria-label={`Tools for ${actor.name}`}>
        <HpAdjust
          actor={actor}
          controls={isDead(actor) ? ["revive", "max"] : ["damage", "nonlethal", "heal", "temp", "set", "max"]}
          revision={state.revision}
          damageType={hpDamageType}
          onDamageTypeChange={onHpDamageTypeChange}
          autoFocus={typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches}
          onEscape={onClose}
          onFeedback={onFeedback}
        />
        <ConditionEditor
          actorId={actor.id}
          conditions={actor.conditions}
          effects={actor.effects}
          viewer="gm"
          sources={state.combat.initiative
            .filter((entry) => entry.actorId !== actor.id)
            .map((entry) => ({
              id: entry.actorId,
              name: state.actors.find((candidate) => candidate.id === entry.actorId)?.name ?? "Unknown"
            }))}
          onFeedback={onFeedback}
        />
        {/* SRD Influence: a monster's attitude gives Influence checks Advantage (Friendly) or Disadvantage (Hostile). */}
        {actor.kind !== "player-character" && (
          <Field label="Attitude toward the party" htmlFor={`attitude-${actor.id}`}>
            <Select
              id={`attitude-${actor.id}`}
              value={actor.attitude ?? "indifferent"}
              disabled={busy}
              onChange={(event) => {
                const attitude = event.target.value as "friendly" | "indifferent" | "hostile";
                void run(
                  () =>
                    command("actor:set-attitude", { actorId: actor.id, attitude, expectedRevision: state.revision }),
                  `${actor.name} is ${attitude[0].toUpperCase()}${attitude.slice(1)}.`
                );
              }}
            >
              <option value="indifferent">Indifferent</option>
              <option value="friendly">Friendly</option>
              <option value="hostile">Hostile</option>
            </Select>
          </Field>
        )}
        <EffectChips actorId={actor.id} effects={actor.effects} canEnd onFeedback={onFeedback} />
        <CoverControl actor={actor} onFeedback={onFeedback} />
        <LairControl actor={actor} onFeedback={onFeedback} />
        <PickControl
          actor={actor}
          definition={state.definitions.find((entry) => entry.id === actor.definitionId)?.definition}
          onFeedback={onFeedback}
        />
        {/* The GM settles ties the dice leave: this combatant can go just before anyone sharing its score. */}
        {(() => {
          const own = state.combat.initiative.find((entry) => entry.actorId === actor.id);
          const tied = state.combat.initiative.filter(
            (entry) => own && entry.actorId !== actor.id && entry.score === own.score
          );
          if (!own || tied.length === 0) return null;
          return (
            <div className="initiative-row-tools">
              {tied.map((entry) => (
                <Button
                  key={entry.actorId}
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        command("initiative:set", {
                          actorId: actor.id,
                          score: own.score,
                          tieBreaker: Math.min(1000, entry.tieBreaker + 1),
                          expectedRevision: state.revision
                        }),
                      "Tie settled."
                    )
                  }
                >
                  Act before {state.actors.find((candidate) => candidate.id === entry.actorId)?.name ?? "them"}
                </Button>
              ))}
            </div>
          );
        })()}
        {/* Alert's Initiative Swap happens right after the roll, so it is offered in round 1 only; the server
            refuses it once either combatant has acted. */}
        {state.combat.round === 1 && state.combat.initiative.length > 1 && (
          <Field label="Swap initiative with (Alert)" htmlFor={`swap-${actor.id}`}>
            <Select
              id={`swap-${actor.id}`}
              value=""
              disabled={busy}
              onChange={(event) => {
                const withActorId = event.target.value;
                if (!withActorId) return;
                void run(
                  () =>
                    command("initiative:swap", {
                      actorId: actor.id,
                      withActorId,
                      expectedRevision: state.revision
                    }),
                  "Initiative swapped."
                );
              }}
            >
              <option value="">Pick an ally</option>
              {state.combat.initiative
                .filter((entry) => entry.actorId !== actor.id)
                .map((entry) => (
                  <option key={entry.actorId} value={entry.actorId}>
                    {state.actors.find((candidate) => candidate.id === entry.actorId)?.name ?? "Unknown"}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <div className="initiative-row-tools">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
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
            {state.combat.reactionsUsed.includes(actor.id) ? "Restore reaction" : "Spend reaction"}
          </Button>
          {/* SRD Suffocation: out of air (a dive, an engulfing), it holds its breath until it can breathe again. */}
          {(() => {
            const holding = actor.effects.some((effect) => effect.breath !== undefined);
            return (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      command("actor:hold-breath", {
                        actorId: actor.id,
                        holding: !holding,
                        expectedRevision: state.revision
                      }),
                    holding ? `${actor.name} breathes again.` : `${actor.name} holds its breath.`
                  )
                }
              >
                {holding ? "Breathe again" : "Hold breath"}
              </Button>
            );
          })()}
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onOpenSheet();
              onClose();
            }}
          >
            Open sheet
          </Button>
          {removable && !confirmingRemoval && (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirmingRemoval(true)}>
              Take out of the encounter
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
        {removable && confirmingRemoval && (
          <ConfirmRow
            ariaLabel={`Take ${actor.name} out of the encounter`}
            confirmLabel="Take out"
            busy={busy}
            onCancel={() => setConfirmingRemoval(false)}
            onConfirm={() => {
              setConfirmingRemoval(false);
              void run(
                () => command("encounter:remove-combatant", { actorId: actor.id, expectedRevision: state.revision }),
                `${actor.name} left the encounter.`
              ).then(onClose);
            }}
          >
            Take {actor.name} out of the encounter? {actor.name}'s turn and token are removed, and anything {actor.name}{" "}
            is grappling or concentrating on ends.
          </ConfirmRow>
        )}
      </div>
    </>
  );
}

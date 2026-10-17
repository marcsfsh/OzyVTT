import { isDead, type GmActor, type GmView, type MutationResult } from "@vtt/domain";
import { Button, Field, Select } from "@vtt/ui";
import { command } from "../lib/command";
import { ConditionEditor } from "./conditions";
import { CoverControl } from "./CoverControl";
import { HpAdjust } from "./HpAdjust";
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
          onFeedback={onFeedback}
        />
        <EffectChips actorId={actor.id} effects={actor.effects} canEnd onFeedback={onFeedback} />
        <CoverControl actor={actor} onFeedback={onFeedback} />
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
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </>
  );
}

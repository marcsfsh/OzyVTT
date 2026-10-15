import type { GmActor, GmView, MutationResult } from "@vtt/domain";
import { Button } from "@vtt/ui";
import { command } from "../lib/command";
import { ConditionEditor } from "./conditions";
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
          controls={["damage", "nonlethal", "heal", "temp", "set"]}
          revision={state.revision}
          damageType={hpDamageType}
          onDamageTypeChange={onHpDamageTypeChange}
          autoFocus={typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches}
          onEscape={onClose}
          onFeedback={onFeedback}
        />
        <ConditionEditor actorId={actor.id} conditions={actor.conditions} onFeedback={onFeedback} />
        <EffectChips actorId={actor.id} effects={actor.effects} canEnd onFeedback={onFeedback} />
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

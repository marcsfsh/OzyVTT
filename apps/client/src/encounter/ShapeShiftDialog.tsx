import { useState } from "react";
import type { ContentActionSummary } from "@vtt/domain";
import type { CastShaping } from "@vtt/schemas";
import { Button, Modal } from "@vtt/ui";
import { ShapeChoices } from "./ShapeChoices";
import { formUnchosen, shapeChoicePayload, startingShapeChoice, type ShapeChoice } from "./targeting";
import "./pickers.css";

/** A shape-shift used outside a fight (Wild Shape, Polymorph, Enlarge/Reduce), which waits for its form and targets. */
export type LooseShift = Readonly<{
  action: ContentActionSummary;
  /** Whom it aims at: no one (Wild Shape works on its user), one creature, or several. */
  aims: "none" | "single" | "multi";
  slotLevel?: number;
  shaping?: readonly CastShaping[];
}>;

/** What the dialog sends: the targets, and the form, gear and effect picks as `action:use` takes them. */
export type LooseShiftPicks = Readonly<{ targetIds: string[] } & ReturnType<typeof shapeChoicePayload>>;

/**
 * The form a shape-shift takes outside a fight, with whom it targets when it targets anyone: the user's own
 * character first, then the party (for the GM, anyone on the roster). The server checks every pick.
 */
export function ShapeShiftDialog({
  shift,
  candidates,
  defaultId,
  onConfirm,
  onClose
}: Readonly<{
  shift: LooseShift;
  candidates: ReadonlyArray<Readonly<{ id: string; name: string }>>;
  defaultId: string;
  onConfirm: (picks: LooseShiftPicks) => void;
  onClose: () => void;
}>) {
  const [picked, setPicked] = useState<readonly string[]>(shift.aims === "none" ? [] : [defaultId]);
  const [choice, setChoice] = useState<ShapeChoice>(() => startingShapeChoice(shift.action));
  const toggle = (id: string) =>
    setPicked((current) =>
      shift.aims === "single" ? [id] : current.includes(id) ? current.filter((other) => other !== id) : [...current, id]
    );
  const ready = (shift.aims === "none" || picked.length > 0) && !formUnchosen(shift.action, choice, picked);
  const name = shift.action.name;
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      accent="cyan"
      title={name}
      ariaLabel={`Use ${name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!ready}
            onClick={() => onConfirm({ targetIds: [...picked], ...shapeChoicePayload(choice, picked) })}
          >
            Use
          </Button>
        </>
      }
    >
      {shift.aims !== "none" && (
        <>
          <p className="heal-picker-ask">
            {shift.aims === "single" ? `Choose who ${name} targets.` : `Choose the creatures ${name} targets.`}
          </p>
          <div className="heal-picker-targets" role="group" aria-label="Targets">
            {candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={`sheet-picker-chip${picked.includes(candidate.id) ? " is-active" : ""}`}
                aria-pressed={picked.includes(candidate.id)}
                onClick={() => toggle(candidate.id)}
              >
                {candidate.name}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="shape-shift-choices">
        <ShapeChoices
          action={shift.action}
          choice={choice}
          targets={candidates
            .filter((candidate) => picked.includes(candidate.id))
            .map((candidate) => ({ id: candidate.id, label: candidate.name }))}
          onForm={(form, targetId) =>
            setChoice((current) =>
              targetId === undefined
                ? { ...current, form }
                : { ...current, targetForms: { ...(current.targetForms ?? {}), [targetId]: form } }
            )
          }
          onGear={(gear) => setChoice((current) => ({ ...current, gear }))}
          onOption={(option) => setChoice((current) => ({ ...current, option }))}
        />
      </div>
    </Modal>
  );
}

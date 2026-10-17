import { useState } from "react";
import { Button, Field, Modal, Select, Stepper, useToast } from "@vtt/ui";
import { useClassCatalog } from "../content/catalogs";
import { command } from "../lib/command";
import { MAX_CLASSES } from "./build-payload";
import "./character-builder.css";

/** One class of the character to roll and its levels; an empty class is the dice's choice. */
type PlanRow = Readonly<{ classId: string; level: number }>;

/**
 * Roll a random character: a level and a class or the dice's choice, or several classes with their levels for a
 * multiclass character, then `character:generate`. The server picks everything else and throws the dice, and it
 * refuses a mix whose 13s the standard array can't reach.
 */
export function RandomCharacterModal({
  open,
  onClose,
  maxLevel,
  onRolled
}: Readonly<{
  open: boolean;
  onClose: () => void;
  /** The table's `builderPolicy.maxLevel`; the server enforces it, this bounds the steppers. */
  maxLevel: number;
  /** Called with the new character's name once the roster carries it. */
  onRolled?: (name: string) => void;
}>) {
  const classes = useClassCatalog();
  const { toast } = useToast();
  const [plan, setPlan] = useState<readonly PlanRow[]>([{ classId: "", level: 1 }]);
  const [busy, setBusy] = useState(false);
  const multiclass = plan.length > 1;
  const total = plan.reduce((sum, row) => sum + row.level, 0);
  const room = maxLevel - total;
  const nameOf = (classId: string) => classes.items.find((entry) => entry.id === classId)?.name ?? classId;
  const unused = classes.items.filter((entry) => !plan.some((row) => row.classId === entry.id));

  const change = (index: number, next: Partial<PlanRow>) =>
    setPlan((current) => current.map((row, at) => (at === index ? { ...row, ...next } : row)));
  const addClass = () => setPlan((current) => [...current, { classId: unused[0]?.id ?? "", level: 1 }]);
  const removeClass = (index: number) => setPlan((current) => current.filter((_, at) => at !== index));

  const roll = async () => {
    setBusy(true);
    const level = Math.min(total, maxLevel);
    const result = await command(
      "character:generate",
      multiclass
        ? { level, classId: plan[0].classId, classes: plan.map((row) => ({ classId: row.classId, level: row.level })) }
        : { level, ...(plan[0].classId ? { classId: plan[0].classId } : {}) }
    );
    setBusy(false);
    if (!result.ok) {
      toast(result.message ?? "That character could not be rolled up.", { tone: "error" });
      return;
    }
    onClose();
    // The server renames a clash ("Borin 2"), so the caller reads the name back from the roster,
    // which the broadcast before this reply has already updated.
    onRolled?.(result.actorId ?? "");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Roll a random character"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={roll} disabled={busy}>
            {busy ? "Rolling…" : "Roll it up"}
          </Button>
        </>
      }
    >
      <p className="random-character-note">
        A complete character, ready to play. It gets the standard array where its classes want it, and the dice choose
        everything else: species, background, subclass, skills, feats, spells and gear.
      </p>
      {multiclass ? (
        <ul className="random-character-classes" aria-label="Classes and levels">
          {plan.map((row, index) => (
            <li key={index} className="random-character-class">
              <Select
                value={row.classId}
                aria-label={index === 0 ? "Starting class" : `Class ${index + 1}`}
                onChange={(event) => change(index, { classId: event.target.value })}
              >
                {classes.items
                  .filter((entry) => entry.id === row.classId || !plan.some((other) => other.classId === entry.id))
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
              </Select>
              <Stepper
                value={row.level}
                onChange={(level) => change(index, { level })}
                min={1}
                max={row.level + room}
                aria-label={`${nameOf(row.classId)} levels`}
              />
              {index > 0 && (
                <Button variant="ghost" size="sm" onClick={() => removeClass(index)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <Field label="Level">
            <Stepper
              value={Math.min(plan[0].level, maxLevel)}
              onChange={(level) => change(0, { level })}
              min={1}
              max={maxLevel}
              aria-label="Level"
              announceValue
            />
          </Field>
          <Field label="Class" help="Leave it to the dice, or choose one.">
            <Select
              value={plan[0].classId}
              aria-label="Class"
              onChange={(event) => change(0, { classId: event.target.value })}
            >
              <option value="">Surprise me</option>
              {classes.items.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
      {multiclass && (
        <p className="random-character-note">Level {total} in all. The first class is the one taken at level 1.</p>
      )}
      {/* A multiclass character starts from a chosen class, so the dice's choice can't take a second one. */}
      {plan[0].classId && plan.length < MAX_CLASSES && room > 0 && unused.length > 0 ? (
        <Button variant="secondary" onClick={addClass} disabled={busy}>
          Add another class
        </Button>
      ) : (
        !plan[0].classId && (
          <p className="random-character-note">Choose a class first to add another for a multiclass character.</p>
        )
      )}
    </Modal>
  );
}

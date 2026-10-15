import { useState } from "react";
import { Button, Field, Modal, Select, Stepper, useToast } from "@vtt/ui";
import { useClassCatalog } from "../content/catalogs";
import { command } from "../lib/command";

/**
 * Roll a random character: a level and an optional class, then `character:generate`. The server
 * picks everything else and throws the dice.
 */
export function RandomCharacterModal({
  open,
  onClose,
  maxLevel,
  onRolled
}: Readonly<{
  open: boolean;
  onClose: () => void;
  /** The table's `builderPolicy.maxLevel`; the server enforces it, this bounds the stepper. */
  maxLevel: number;
  /** Called with the new character's name once the roster carries it. */
  onRolled?: (name: string) => void;
}>) {
  const classes = useClassCatalog();
  const { toast } = useToast();
  const [level, setLevel] = useState(1);
  const [classId, setClassId] = useState("");
  const [busy, setBusy] = useState(false);

  const roll = async () => {
    setBusy(true);
    const result = await command("character:generate", {
      level: Math.min(level, maxLevel),
      ...(classId ? { classId } : {})
    });
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
      ariaLabel="Roll a random character"
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
        A complete, playable character: the standard array where the class wants it, and everything else — species,
        background, subclass, skills, feats, spells, gear — rolled at the table.
      </p>
      <Field label="Level">
        <Stepper
          value={Math.min(level, maxLevel)}
          onChange={setLevel}
          min={1}
          max={maxLevel}
          aria-label="Level"
          announceValue
        />
      </Field>
      <Field label="Class" help="Leave it to the dice, or pin one down.">
        <Select value={classId} aria-label="Class" onChange={(event) => setClassId(event.target.value)}>
          <option value="">Surprise me</option>
          {classes.items.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </Select>
      </Field>
    </Modal>
  );
}

import { useState } from "react";
import { Button, Field, Modal, Select, Stepper, useToast } from "@vtt/ui";
import { useClassCatalog } from "../content/catalogs";
import { newId } from "../lib/ids";
import { socket } from "../socket";

/**
 * **Roll a random character (issue `2d`) — the one control the generator needs.**
 *
 * Two questions and a button, because the server answers everything else. The level is the only
 * decision that always matters; the class is a *narrowing* of the draw, not a required field, so it
 * defaults to "Surprise me". Naming, species, background, subclass, skills, feats, spells and
 * equipment are all the server's, and a control for any of them here would be the character builder
 * with fewer steps — which already exists next door.
 *
 * **Nothing is decided in this file.** It emits `character:generate` with a level and (maybe) a
 * class; the dice are `context.random` inside the command (CLAUDE.md rule 2). That is the whole
 * difference from the wizard's name shuffler, which still calls `Math.random` in the browser.
 */
export function RandomCharacterModal({ open, onClose, maxLevel, onRolled }: Readonly<{
  open: boolean;
  onClose: () => void;
  /** The table's `builderPolicy.maxLevel` — the server enforces it, this keeps the stepper honest. */
  maxLevel: number;
  /** Called with the new character's name once the roster carries it. */
  onRolled?: (name: string) => void;
}>) {
  const classes = useClassCatalog();
  const { toast } = useToast();
  const [level, setLevel] = useState(1);
  const [classId, setClassId] = useState("");
  const [busy, setBusy] = useState(false);

  const roll = () => {
    setBusy(true);
    const commandId = newId();
    socket.emit("character:generate", { commandId, level: Math.min(level, maxLevel), ...(classId ? { classId } : {}) },
      (result: { ok: boolean; message?: string; actorId?: string }) => {
        setBusy(false);
        if (!result.ok) { toast(result.message ?? "That character could not be rolled up.", { tone: "error" }); return; }
        onClose();
        // The server renames a clash ("Borin 2"), so the name is READ BACK rather than guessed — the
        // same rule the wizard follows. The roster row lands with the broadcast that precedes this ack.
        onRolled?.(result.actorId ?? "");
      });
  };

  return <Modal open={open} onClose={onClose} size="sm" title="Roll a random character" ariaLabel="Roll a random character"
    footer={<>
      <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="primary" onClick={roll} disabled={busy}>{busy ? "Rolling…" : "Roll it up"}</Button>
    </>}>
    <p className="random-character-note">
      A complete, playable character: the standard array where the class wants it, and everything else
      — species, background, subclass, skills, feats, spells, gear — rolled at the table.
    </p>
    <Field label="Level">
      <Stepper value={Math.min(level, maxLevel)} onChange={setLevel} min={1} max={maxLevel} aria-label="Level" announceValue />
    </Field>
    <Field label="Class" help="Leave it to the dice, or pin one down.">
      <Select value={classId} aria-label="Class" onChange={(event) => setClassId(event.target.value)}>
        <option value="">Surprise me</option>
        {classes.items.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </Select>
    </Field>
  </Modal>;
}

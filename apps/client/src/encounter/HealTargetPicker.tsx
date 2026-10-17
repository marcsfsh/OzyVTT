import { useState } from "react";
import { Button, Modal, Stepper } from "@vtt/ui";

/** A heal used outside a fight, which waits for who it lands on. */
export type LooseHeal = Readonly<{
  actionId: string;
  name: string;
  /** The most creatures one use heals: one, a healing spell's count (Prayer of Healing's five), or any number for a
   *  pool divided among them. */
  most: number;
  /** Points spent from a pool, picked each time (Lay on Hands): the most left. */
  spendUpTo: number | null;
  slotLevel?: number;
  includeDamage?: boolean;
}>;

/**
 * Who regains the hit points of a heal outside a fight: the user's own character first, then the party (for the GM,
 * anyone on the roster). The server checks who may be healed and how many.
 */
export function HealTargetPicker({
  heal,
  candidates,
  defaultId,
  onConfirm,
  onClose
}: Readonly<{
  heal: LooseHeal;
  candidates: ReadonlyArray<Readonly<{ id: string; name: string }>>;
  defaultId: string;
  onConfirm: (targetIds: string[], spend: number | null) => void;
  onClose: () => void;
}>) {
  const [picked, setPicked] = useState<readonly string[]>([defaultId]);
  const [spend, setSpend] = useState(1);
  const several = heal.most > 1;
  const full = several && picked.length >= heal.most;
  const toggle = (id: string) =>
    setPicked((current) =>
      !several ? [id] : current.includes(id) ? current.filter((other) => other !== id) : [...current, id]
    );
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      accent="cyan"
      title={heal.name}
      ariaLabel={`Who ${heal.name} heals`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={picked.length === 0}
            onClick={() => onConfirm([...picked], heal.spendUpTo !== null ? spend : null)}
          >
            Heal
          </Button>
        </>
      }
    >
      <p className="heal-picker-ask">
        {several && heal.most < candidates.length
          ? `Choose up to ${heal.most} creatures to regain hit points.`
          : several
            ? "Choose the creatures who regain hit points."
            : "Choose who regains hit points."}
      </p>
      <div className="heal-picker-targets" role="group" aria-label="Who regains hit points">
        {candidates.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className={`sheet-picker-chip${picked.includes(candidate.id) ? " is-active" : ""}`}
            aria-pressed={picked.includes(candidate.id)}
            disabled={full && !picked.includes(candidate.id)}
            onClick={() => toggle(candidate.id)}
          >
            {candidate.name}
          </button>
        ))}
      </div>
      {heal.spendUpTo !== null && (
        <Stepper
          className="heal-picker-spend"
          label="Points to spend"
          value={spend}
          onChange={setSpend}
          min={1}
          max={Math.max(1, heal.spendUpTo)}
          aria-label={`Points of ${heal.name} to spend`}
        />
      )}
    </Modal>
  );
}

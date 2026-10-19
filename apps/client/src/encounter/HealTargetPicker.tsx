import { useState } from "react";
import type { CastShaping } from "@vtt/schemas";
import { Button, Modal, Stepper } from "@vtt/ui";
import "./pickers.css";

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
  /** A spell cast outside a fight at creatures (Aid, Hold Person) picks its targets here as well. */
  purpose?: "heal" | "cast";
  /** How the caster shapes the spell (Metamagic), sent with its targets. */
  shaping?: readonly CastShaping[];
}>;

/** What the picker asks, by what the pick is for and how many it takes. */
function askOf(heal: LooseHeal, candidates: number): string {
  const several = heal.most > 1;
  if (heal.purpose === "cast")
    return several && heal.most < candidates
      ? `Choose up to ${heal.most} creatures for ${heal.name}.`
      : several
        ? `Choose the creatures ${heal.name} targets.`
        : `Choose who ${heal.name} targets.`;
  return several && heal.most < candidates
    ? `Choose up to ${heal.most} creatures to regain hit points.`
    : several
      ? "Choose the creatures who regain hit points."
      : "Choose who regains hit points.";
}

/**
 * Who regains the hit points of a heal outside a fight, or whom a spell cast outside a fight targets: the user's own
 * character first, then the party (for the GM, anyone on the roster). The server checks who may be picked and how
 * many.
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
      ariaLabel={heal.purpose === "cast" ? `Who ${heal.name} targets` : `Who ${heal.name} heals`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={picked.length === 0}
            onClick={() => onConfirm([...picked], heal.spendUpTo !== null ? spend : null)}
          >
            {heal.purpose === "cast" ? "Cast" : "Heal"}
          </Button>
        </>
      }
    >
      <p className="heal-picker-ask">{askOf(heal, candidates.length)}</p>
      <div
        className="heal-picker-targets"
        role="group"
        aria-label={heal.purpose === "cast" ? "Targets" : "Who regains hit points"}
      >
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

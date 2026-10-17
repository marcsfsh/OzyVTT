import { useState } from "react";
import type { ActorDefinition } from "@vtt/domain";
import { Button, Modal } from "@vtt/ui";
import { ordinal } from "./format";
import "./character-sheet.css";

type DefinitionAction = ActorDefinition["actions"][number];

/** A spell this creature could ready: one it casts with an action (SRD Ready), not a ritual or what a spell lets
 *  its caster do later. */
export function readyableSpells(definition: ActorDefinition): DefinitionAction[] {
  return definition.actions.filter(
    (action) =>
      action.spellId !== undefined && action.activation === "action" && !/^spell-.+-(?:then-.+|ritual)$/.test(action.id)
  );
}

/**
 * The Ready action: an action or a move (the trigger is said to the table), or a spell, which is cast now, its slot
 * spent, and held with Concentration until the start of the next turn (SRD Ready).
 */
export function ReadyChooser({
  spells,
  slotLevels,
  busy,
  onReady,
  onClose
}: Readonly<{
  spells: readonly DefinitionAction[];
  /** The slot levels the sheet has, for casting a readied spell higher. */
  slotLevels: readonly number[];
  busy: boolean;
  onReady: (spell: Readonly<{ actionId: string; slotLevel?: number }> | null) => void;
  onClose: () => void;
}>) {
  const [picked, setPicked] = useState<DefinitionAction | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const levels = picked?.spellSlot ? slotLevels.filter((slot) => slot >= picked.spellSlot!.level) : [];
  const chosenLevel = level ?? levels[0] ?? null;
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      accent="cyan"
      title={picked ? `Ready ${picked.name}` : "Ready"}
      ariaLabel={picked ? `Ready ${picked.name}` : "What to ready"}
      footer={
        picked ? (
          <>
            <Button variant="ghost" onClick={() => setPicked(null)}>
              Back
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                onReady({ actionId: picked.id, ...(chosenLevel !== null ? { slotLevel: chosenLevel } : {}) })
              }
            >
              Ready it
            </Button>
          </>
        ) : undefined
      }
    >
      {picked ? (
        <>
          <p className="spell-choice-ask">
            It is cast now{picked.spellSlot ? ", spending its slot," : ""} and held with Concentration until the start
            of your next turn. Cast it when the trigger comes to release it with your Reaction.
          </p>
          {levels.length > 1 && (
            <div className="heal-picker-targets" role="group" aria-label="Slot level">
              {levels.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  className={`sheet-picker-chip${slot === chosenLevel ? " is-active" : ""}`}
                  aria-pressed={slot === chosenLevel}
                  onClick={() => setLevel(slot)}
                >
                  {ordinal(slot)} level
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="spell-choice-ask">Say the trigger to the table, then choose what you ready.</p>
          <ul className="spell-choice-list">
            <li>
              <button type="button" className="spell-choice-row" disabled={busy} onClick={() => onReady(null)}>
                <span className="spell-choice-name">An action or a move</span>
                <span className="spell-choice-detail">Uses your Reaction</span>
              </button>
            </li>
            {spells.map((spell) => (
              <li key={spell.id}>
                <button
                  type="button"
                  className="spell-choice-row"
                  onClick={() => {
                    setPicked(spell);
                    setLevel(null);
                  }}
                >
                  <span className="spell-choice-name">{spell.name}</span>
                  <span className="spell-choice-detail">Held with Concentration</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

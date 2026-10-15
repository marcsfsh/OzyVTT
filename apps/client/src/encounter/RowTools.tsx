import { useState } from "react";
import type { GmActor, GmView, MutationResult } from "@vtt/domain";
import { Button } from "@vtt/ui";
import { command } from "../lib/command";
import { ConditionEditor } from "./conditions";
import { DamageTypeField } from "./DamageTypeField";
import { EffectChips } from "./EffectChips";
import { manualDamagePayload, manualDamageType } from "./manual-damage";

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
  const [hpAmount, setHpAmount] = useState("");
  const adjustHp = (
    event: "actor:apply-damage" | "actor:heal" | "actor:set-temp-hp" | "actor:set-hp",
    actorId: string,
    name: string,
    options?: { nonlethal?: boolean }
  ) => {
    const value = Number(hpAmount.trim());
    const minimum = event === "actor:apply-damage" || event === "actor:heal" ? 1 : 0;
    if (!Number.isInteger(value) || value < minimum || value > 1000) {
      onFeedback(`Enter a whole number (${minimum}-1000).`);
      return;
    }
    // The type rides only on damage; a leftover "fire" must not travel with Heal, Temp or Set.
    const damageType = event === "actor:apply-damage" ? manualDamageType(hpDamageType) : undefined;
    const typed = damageType ? ` ${damageType}` : "";
    const verbs = {
      "actor:apply-damage": options?.nonlethal
        ? `${name} took ${value} nonlethal${typed} damage.`
        : `${name} took ${value}${typed} damage.`,
      "actor:heal": `${name} healed ${value}.`,
      "actor:set-temp-hp": `${name} has ${value} temporary HP.`,
      "actor:set-hp": `${name} set to ${value} HP.`
    } as const;
    setHpAmount("");
    void run(
      () =>
        event === "actor:set-hp"
          ? command(event, { actorId, current: value, expectedRevision: state.revision })
          : event === "actor:apply-damage"
            ? command(
                event,
                manualDamagePayload({
                  actorId,
                  amount: value,
                  damageType,
                  nonlethal: options?.nonlethal,
                  expectedRevision: state.revision
                })
              )
            : command(event, { actorId, amount: value, expectedRevision: state.revision }),
      verbs[event]
    );
  };

  return (
    <>
      <div className="encounter-overlay-backdrop" onPointerDown={onClose} />
      <div className="row-tools-popover" role="dialog" aria-label={`Tools for ${actor.name}`}>
        <div className="hp-editor" role="group" aria-label={`Adjust hit points for ${actor.name}`}>
          <input
            type="number"
            min="0"
            max="1000"
            placeholder="0"
            autoFocus={typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches}
            aria-label="Amount"
            value={hpAmount}
            onChange={(event) => setHpAmount(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") adjustHp("actor:apply-damage", actor.id, actor.name);
              else if (event.key === "Escape") onClose();
            }}
          />
          <button
            type="button"
            disabled={busy}
            title="Apply as damage (or press Enter)"
            onClick={() => adjustHp("actor:apply-damage", actor.id, actor.name)}
          >
            Dmg
          </button>
          <button
            type="button"
            disabled={busy}
            title="Nonlethal damage - a drop to 0 knocks out (Unconscious and stable) instead of dying"
            onClick={() => adjustHp("actor:apply-damage", actor.id, actor.name, { nonlethal: true })}
          >
            KO
          </button>
          <button type="button" disabled={busy} onClick={() => adjustHp("actor:heal", actor.id, actor.name)}>
            Heal
          </button>
          <button type="button" disabled={busy} onClick={() => adjustHp("actor:set-temp-hp", actor.id, actor.name)}>
            Temp
          </button>
          <button type="button" disabled={busy} onClick={() => adjustHp("actor:set-hp", actor.id, actor.name)}>
            Set
          </button>
          {/* Below the buttons, which already fill this row at 375px. Panel state like `hpAmount`, so it
                    survives applying and opening the next row (a fireball is one type across several tokens);
                    it is shown as a chip and named in the confirmation. */}
          <DamageTypeField value={hpDamageType} disabled={busy} onChange={onHpDamageTypeChange} />
        </div>
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

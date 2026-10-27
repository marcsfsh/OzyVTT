import { useState } from "react";
import type { ActionResolution, DamageAnswerOffer, HeldDamageLook } from "@vtt/domain";
import { damageBreakdown } from "./format";
import "./prompts.css";

/** Whether the picked dice fit an answer: at least one, no more than it rerolls, and only the action's own dice
 *  where it says so. */
export function answerFits(offer: DamageAnswerOffer, look: HeldDamageLook, picked: readonly number[]): boolean {
  return (
    picked.length > 0 &&
    picked.length <= offer.dice &&
    (!offer.ownOnly || picked.every((index) => look.dice[index]?.own))
  );
}

/**
 * A damage roll looked at before it counts: its dice, which the roller picks to reroll with an answer (Empowered
 * Spell's dice of the spell, Heroic Inspiration's one die), and the confirm that deals them. The server holds the dice,
 * so the confirm deals what is shown here.
 */
export function DamageLook({
  result,
  look,
  busy,
  confirmLabel,
  onAnswer,
  onConfirm
}: Readonly<{
  result: Pick<ActionResolution, "damage" | "bonusDamage" | "damageTotal" | "crit">;
  look: HeldDamageLook;
  busy: boolean;
  confirmLabel: string;
  onAnswer: (id: DamageAnswerOffer["id"], dice: readonly number[]) => void;
  onConfirm: () => void;
}>) {
  const [picked, setPicked] = useState<number[]>([]);
  const breakdown = damageBreakdown(result);
  const answerable = look.answers.length > 0;
  const toggle = (index: number) =>
    setPicked((current) => (current.includes(index) ? current.filter((one) => one !== index) : [...current, index]));
  return (
    <div className="damage-look">
      {look.healing !== undefined ? (
        <p className="action-damage">
          Healing: <strong>{look.healing}</strong>
        </p>
      ) : (
        <p className="action-damage">
          Damage: <strong>{result.damageTotal}</strong>
          {breakdown ? ` (${breakdown})` : ""}
          {result.crit ? " · a Critical Hit, its dice doubled" : ""}
        </p>
      )}
      {look.dice.length > 0 && (
        <span
          className="damage-look-dice"
          role="group"
          aria-label={look.healing !== undefined ? "Healing dice" : "Damage dice"}
        >
          {look.dice.map((die, index) => (
            <button
              key={index}
              type="button"
              className={`save-die-mode damage-look-die${picked.includes(index) ? " active" : ""}`}
              aria-pressed={picked.includes(index)}
              aria-label={`d${die.sides} showing ${die.face}`}
              disabled={busy || !answerable}
              onClick={() => toggle(index)}
            >
              {die.face}
              <small>d{die.sides}</small>
            </button>
          ))}
        </span>
      )}
      {answerable && <small className="hit-offer-note">Pick the dice to reroll, then the answer.</small>}
      <span className="save-prompt-confirm">
        <span className="roll-answers" role="group" aria-label="Answers to this damage roll">
          {look.answered.map((line, index) => (
            <span key={`${line.name}-${index}`} className="roll-answered">
              {line.name}: {line.change}
            </span>
          ))}
          {look.answers.map((offer) => (
            <button
              key={offer.id}
              type="button"
              className="roll-answer"
              disabled={busy || !answerFits(offer, look, picked)}
              title={offer.cost ? `Spends ${offer.cost}` : undefined}
              onClick={() => {
                onAnswer(offer.id, picked);
                setPicked([]);
              }}
            >
              {offer.name} · reroll {offer.dice === 1 ? "1 die" : `up to ${offer.dice} dice`}
            </button>
          ))}
        </span>
        <button type="button" className="encounter-primary" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </span>
    </div>
  );
}

import { useState } from "react";
import type { GmView, PlayerView, RollPurpose, RollVisibility } from "@vtt/domain";
import { socket } from "../socket";

const PURPOSES: RollPurpose[] = ["manual", "attack", "damage", "save", "check"];

export function DicePanel({ role, state }: { role: "gm" | "player"; state: GmView | PlayerView }) {
  const [formula, setFormula] = useState("1d20");
  const [purpose, setPurpose] = useState<RollPurpose>("manual");
  const [visibility, setVisibility] = useState<RollVisibility>("public");
  const [feedback, setFeedback] = useState("");
  const visibilityOptions: Array<{ value: RollVisibility; label: string }> = role === "gm"
    ? [{ value: "public", label: "Public" }, { value: "gm-only", label: "GM only (secret)" }, { value: "self-only", label: "Only me" }]
    : [{ value: "public", label: "Public" }, { value: "blind", label: "Blind to me / GM sees" }, { value: "self-only", label: "Only me" }];

  const roll = () => {
    setFeedback("Rolling…");
    socket.emit("dice:roll", { commandId: crypto.randomUUID(), formula, purpose, visibility }, (result) => {
      if (!result.ok) return setFeedback(result.message ?? "The roll failed.");
      setFeedback(result.hiddenFromRoller ? "Secret roll sent to the GM." : result.duplicate ? "That roll was already accepted." : "Roll accepted by the server.");
    });
  };

  return <section className="dice-proof" aria-labelledby="dice-proof-heading">
    <div className="dice-form">
      <div><span className="eyebrow">SERVER-AUTHORITATIVE DICE PROOF</span><h2 id="dice-proof-heading">Dice</h2></div>
      <label>Formula<input value={formula} onChange={(event) => setFormula(event.target.value)} placeholder="2d20kh1 + 5" /></label>
      <label>Purpose<select value={purpose} onChange={(event) => setPurpose(event.target.value as RollPurpose)}>{PURPOSES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Visibility<select value={visibility} onChange={(event) => setVisibility(event.target.value as RollVisibility)}>{visibilityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <button onClick={roll}>Roll</button>
    </div>
    <p className="dice-feedback" aria-live="polite">{feedback || "Try 1d20, 2d20kh1 + 5, or 2d6 + 1d4 - 2."}</p>
    <div className="roll-list">
      {state.rolls.length === 0 && <p>No visible rolls yet.</p>}
      {state.rolls.slice(-8).reverse().map((roll) => <article className="roll-card" key={roll.id}>
        <div className="roll-card-heading"><strong>{roll.formula}</strong><span>{roll.purpose} · {roll.visibility}</span></div>
        <div className="roll-result"><div className="dice-faces">{roll.dice.map((die, index) => <span key={`${roll.id}-${index}`} className={die.kept ? "die" : "die discarded"} title={`d${die.sides}${die.kept ? "" : " (discarded)"}`}>{die.face}</span>)}</div><strong className="roll-total">{roll.total}</strong></div>
      </article>)}
    </div>
  </section>;
}

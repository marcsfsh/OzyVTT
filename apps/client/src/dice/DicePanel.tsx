import { useState } from "react";
import type { GmView, PlayerView, RollPurpose, RollVisibility } from "@vtt/domain";
import { socket } from "../socket";

const PURPOSE_LABELS: Record<RollPurpose, string> = { manual: "Roll", attack: "Attack", damage: "Damage", save: "Save", check: "Check" };
const QUICK_DICE = [4, 6, 8, 10, 12, 20, 100] as const;

function modifierSuffix(modifier: number) { return modifier === 0 ? "" : modifier > 0 ? `+${modifier}` : `${modifier}`; }
function modifierLabel(modifier: number) { return modifier === 0 ? "±0" : modifier > 0 ? `+${modifier}` : `−${Math.abs(modifier)}`; }

export function DicePanel({ role, state }: { role: "gm" | "player"; state: GmView | PlayerView }) {
  const [formula, setFormula] = useState("1d20");
  const [purpose, setPurpose] = useState<RollPurpose>("manual");
  const [visibility, setVisibility] = useState<RollVisibility>("public");
  const [modifier, setModifier] = useState(0);
  const [feedback, setFeedback] = useState("");
  const visibilityOptions: Array<{ value: RollVisibility; label: string }> = role === "gm"
    ? [{ value: "public", label: "Everyone" }, { value: "gm-only", label: "Just me (GM)" }, { value: "self-only", label: "Just me" }]
    : [{ value: "public", label: "Everyone" }, { value: "blind", label: "Just the GM" }, { value: "self-only", label: "Just me" }];
  const visibilityLabel = (value: RollVisibility) => visibilityOptions.find((option) => option.value === value)?.label ?? value;

  const submit = (rollFormula: string, rollPurpose: RollPurpose) => {
    setFeedback("Rolling…");
    socket.emit("dice:roll", { commandId: crypto.randomUUID(), formula: rollFormula, purpose: rollPurpose, visibility }, (result) => {
      if (!result.ok) return setFeedback(result.message ?? "That roll didn't work. Check the formula and try again.");
      setFeedback(result.hiddenFromRoller ? "Secret roll sent to the GM." : result.duplicate ? "Already rolled." : "Rolled.");
    });
  };
  const quickRoll = (sides: number) => submit(`1d${sides}${modifierSuffix(modifier)}`, "manual");
  const advantageRoll = (kind: "kh1" | "kl1") => submit(`2d20${kind}${modifierSuffix(modifier)}`, "manual");
  const customRoll = () => submit(formula, purpose);

  return <section className="dice-proof" aria-labelledby="dice-proof-heading">
    <div className="dice-heading">
      <div><span className="eyebrow">DICE</span><h2 id="dice-proof-heading">Roll dice</h2></div>
      <label className="dice-visibility">Who sees it?<select value={visibility} onChange={(event) => setVisibility(event.target.value as RollVisibility)}>{visibilityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    </div>
    <div className="dice-quick" role="group" aria-label="Quick rolls">
      {QUICK_DICE.map((sides) => <button key={sides} onClick={() => quickRoll(sides)}>d{sides}</button>)}
      <button className="secondary" onClick={() => advantageRoll("kh1")}>Advantage</button>
      <button className="secondary" onClick={() => advantageRoll("kl1")}>Disadvantage</button>
      <div className="dice-modifier"><span>Modifier</span><button type="button" aria-label="Decrease modifier" onClick={() => setModifier((value) => value - 1)}>−</button><strong>{modifierLabel(modifier)}</strong><button type="button" aria-label="Increase modifier" onClick={() => setModifier((value) => value + 1)}>+</button></div>
    </div>
    <details className="dice-custom">
      <summary>Custom formula (advantage keeps, drop lowest, and more)</summary>
      <div className="dice-form">
        <label>Formula<input value={formula} onChange={(event) => setFormula(event.target.value)} placeholder="2d20kh1 + 5" /></label>
        <label>Purpose<select value={purpose} onChange={(event) => setPurpose(event.target.value as RollPurpose)}>{(Object.keys(PURPOSE_LABELS) as RollPurpose[]).map((value) => <option key={value} value={value}>{PURPOSE_LABELS[value]}</option>)}</select></label>
        <button onClick={customRoll}>Roll</button>
      </div>
      <p className="dice-hint">Try 1d20, 2d20kh1 + 5, or 2d6 + 1d4 - 2.</p>
    </details>
    <p className="dice-feedback" aria-live="polite">{feedback}</p>
    <div className="roll-list">
      {state.rolls.length === 0 && <p>No rolls yet.</p>}
      {state.rolls.slice(-8).reverse().map((roll) => <article className="roll-card" key={roll.id}>
        <div className="roll-card-heading"><strong>{roll.formula}</strong><span>{PURPOSE_LABELS[roll.purpose]} · {visibilityLabel(roll.visibility)}</span></div>
        <div className="roll-result"><div className="dice-faces">{roll.dice.map((die, index) => <span key={`${roll.id}-${index}`} className={die.kept ? "die" : "die discarded"} title={`d${die.sides}${die.kept ? "" : " (discarded)"}`}>{die.face}</span>)}</div><strong className="roll-total">{roll.total}</strong></div>
      </article>)}
    </div>
  </section>;
}

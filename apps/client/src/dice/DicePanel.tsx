import { useState } from "react";
import type { GmView, PlayerView, RollPurpose, RollVisibility } from "@vtt/domain";
import { Button, Input, Select, Stepper } from "@vtt/ui";
import { newId } from "../lib/ids";
import { socket } from "../socket";

const PURPOSE_LABELS: Record<RollPurpose, string> = { manual: "Roll", attack: "Attack", damage: "Damage", save: "Save", check: "Check" };
const QUICK_DICE = [4, 6, 8, 10, 12, 20] as const;

function modifierSuffix(modifier: number) { return modifier === 0 ? "" : modifier > 0 ? `+${modifier}` : `${modifier}`; }
function modifierLabel(modifier: number) { return modifier === 0 ? "±0" : modifier > 0 ? `+${modifier}` : `−${Math.abs(modifier)}`; }

function isBareD20(formula: string) { return /^\s*1?d20\s*$/i.test(formula); }

export function DicePanel({ role, state, mineActorId }: { role: "gm" | "player"; state: GmView | PlayerView; mineActorId?: string }) {
  const [formula, setFormula] = useState("1d20");
  const [purpose, setPurpose] = useState<RollPurpose>("manual");
  const [visibility, setVisibility] = useState<RollVisibility>("public");
  const [rollFilter, setRollFilter] = useState<"all" | "mine">("all");
  const [modifier, setModifier] = useState(0);
  const [advantage, setAdvantage] = useState(false);
  const [disadvantage, setDisadvantage] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [fallFeet, setFallFeet] = useState("");
  // A player's "self-only" roll is seen by the roller AND the GM (the GM view carries every roll), but no
  // other player - i.e. "Just me and the GM". "blind" hides the result from the roller too (GM only).
  const visibilityOptions: Array<{ value: RollVisibility; label: string }> = role === "gm"
    ? [{ value: "public", label: "Everyone" }, { value: "gm-only", label: "Just me (GM)" }, { value: "self-only", label: "Just me" }]
    : [{ value: "public", label: "Everyone" }, { value: "self-only", label: "Just me and the GM" }, { value: "blind", label: "Just the GM" }];
  const visibilityLabel = (value: RollVisibility) => visibilityOptions.find((option) => option.value === value)?.label ?? value;

  const submit = (rollFormula: string, rollPurpose: RollPurpose) => {
    setFeedback("Rolling…");
    socket.emit("dice:roll", { commandId: newId(), formula: rollFormula, purpose: rollPurpose, visibility }, (result) => {
      if (!result.ok) return setFeedback(result.message ?? "That roll didn't work. Check the formula and try again.");
      setFeedback(result.hiddenFromRoller ? "Secret roll sent to the GM." : result.duplicate ? "Already rolled." : "Rolled.");
    });
  };
  // Advantage/disadvantage are toggles that arm the *next* d20 roll only; rolling a d20 consumes
  // and clears them. Core 5e rules never allow both at once, so turning one on while the other is
  // already armed cancels both rather than silently overriding - the player has to choose again.
  const toggleAdvantage = () => { if (advantage) return setAdvantage(false); if (disadvantage) { setAdvantage(false); setDisadvantage(false); return; } setAdvantage(true); };
  const toggleDisadvantage = () => { if (disadvantage) return setDisadvantage(false); if (advantage) { setAdvantage(false); setDisadvantage(false); return; } setDisadvantage(true); };
  const quickRoll = (sides: number) => {
    if (sides === 20 && (advantage || disadvantage)) {
      const kind = advantage ? "kh1" : "kl1";
      setAdvantage(false); setDisadvantage(false);
      return submit(`2d20${kind}${modifierSuffix(modifier)}`, "manual");
    }
    submit(`1d${sides}${modifierSuffix(modifier)}`, "manual");
  };
  const customRoll = () => {
    if (isBareD20(formula) && (advantage || disadvantage)) {
      const kind = advantage ? "kh1" : "kl1";
      setAdvantage(false); setDisadvantage(false);
      return submit(`2d20${kind}`, purpose);
    }
    submit(formula, purpose);
  };
  // SRD Falling: 1d6 bludgeoning per 10 feet fallen, max 20d6; the faller lands Prone. The server
  // rolls (dice authority) - this just builds the formula and reminds about the apply/Prone steps.
  const fallDice = Math.min(Math.floor((Number.parseInt(fallFeet, 10) || 0) / 10), 20);
  const rollFall = () => {
    if (fallDice < 1) return setFeedback("Falls under 10 feet deal no damage.");
    setFeedback("Rolling…");
    socket.emit("dice:roll", { commandId: newId(), formula: `${fallDice}d6`, purpose: "damage", visibility }, (result) => {
      if (!result.ok) return setFeedback(result.message ?? "That roll didn't work.");
      setFeedback(`Fall damage rolled (${fallDice}d6 bludgeoning) - apply the total as damage; the faller lands Prone.`);
    });
  };

  return <section className="dice-proof" aria-labelledby="dice-proof-heading">
    <div className="dice-heading">
      <div><span className="eyebrow">DICE</span><h2 id="dice-proof-heading">Roll dice</h2></div>
      <label className="dice-visibility">Who sees it?<Select value={visibility} onChange={(event) => setVisibility(event.target.value as RollVisibility)}>{visibilityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></label>
    </div>
    <div className="dice-quick" role="group" aria-label="Quick rolls">
      {QUICK_DICE.map((sides) => <button key={sides} onClick={() => quickRoll(sides)}>d{sides}</button>)}
    </div>
    <div className="dice-adv-row" role="group" aria-label="Advantage and modifier">
      <button type="button" className="secondary" aria-pressed={advantage} onClick={toggleAdvantage}>Advantage</button>
      <button type="button" className="secondary" aria-pressed={disadvantage} onClick={toggleDisadvantage}>Disadvantage</button>
      <Stepper label="Modifier" value={modifier} onChange={setModifier} format={modifierLabel} aria-label="Roll modifier" />
    </div>
    {(advantage || disadvantage) && <p className="dice-armed">{advantage ? "Advantage" : "Disadvantage"} is armed for the next d20 roll.</p>}
    <details className="dice-custom">
      <summary>Custom formula (advantage keeps, drop lowest, and more)</summary>
      <div className="dice-form">
        <label>Formula<Input value={formula} onChange={(event) => setFormula(event.target.value)} placeholder="2d20kh1 + 5" /></label>
        <label>Purpose<Select value={purpose} onChange={(event) => setPurpose(event.target.value as RollPurpose)}>{(Object.keys(PURPOSE_LABELS) as RollPurpose[]).map((value) => <option key={value} value={value}>{PURPOSE_LABELS[value]}</option>)}</Select></label>
        <Button variant="primary" onClick={customRoll}>Roll</Button>
      </div>
      <p className="dice-hint">Try 1d20, 2d20kh1 + 5, or 2d6 + 1d4 - 2.</p>
    </details>
    <details className="dice-custom">
      <summary>Falling damage (1d6 per 10 ft, max 20d6)</summary>
      <div className="dice-form">
        <label>Feet fallen<Input type="number" min="0" max="10000" inputMode="numeric" value={fallFeet} onChange={(event) => setFallFeet(event.target.value)} placeholder="30" /></label>
        <Button variant="primary" onClick={rollFall} disabled={fallDice < 1}>Roll {fallDice > 0 ? `${fallDice}d6` : "fall"}</Button>
      </div>
      <p className="dice-hint">Bludgeoning damage; the faller lands Prone (SRD Falling).</p>
    </details>
    <p className="dice-feedback" aria-live="polite">{feedback}</p>
    {(() => {
      const rolls = mineActorId && rollFilter === "mine" ? state.rolls.filter((roll) => roll.actorId === mineActorId) : state.rolls;
      return <>
        <div className="roll-list-head">
          <h3 className="roll-list-title">Recent rolls</h3>
          {mineActorId && <div className="dice-filter" role="group" aria-label="Filter rolls">
            <button type="button" className={rollFilter === "all" ? "on" : ""} aria-pressed={rollFilter === "all"} onClick={() => setRollFilter("all")}>Table</button>
            <button type="button" className={rollFilter === "mine" ? "on" : ""} aria-pressed={rollFilter === "mine"} onClick={() => setRollFilter("mine")}>Mine</button>
          </div>}
        </div>
        <div className="roll-list" aria-label="Recent rolls">
          {rolls.length === 0 && <p>{rollFilter === "mine" ? "No rolls from this character yet." : "No rolls yet."}</p>}
          {rolls.slice(-30).reverse().map((roll) => <article className="roll-card" key={roll.id}>
        <div className="roll-card-heading"><strong>{roll.formula}</strong><span>{roll.initiatorLabel ?? "Unknown roller"} · {PURPOSE_LABELS[roll.purpose]} · {visibilityLabel(roll.visibility)}</span></div>
        <div className="roll-result"><div className="dice-faces">{roll.dice.map((die, index) => <span key={`${roll.id}-${index}`} className={die.kept ? "die" : "die discarded"} title={`d${die.sides}${die.kept ? "" : " (discarded)"}`}>{die.face}</span>)}</div><strong className="roll-total">{roll.total}</strong></div>
      </article>)}
        </div>
      </>;
    })()}
  </section>;
}

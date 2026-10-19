import { useState } from "react";
import type { GmView, PlayerView, RollPurpose, RollVisibility, TableRollPurpose } from "@vtt/domain";
import { Button, Input, SegmentedControl, Select, Stepper, useToast } from "@vtt/ui";
import { command } from "../lib/command";
import { useRollPreference } from "./roll-preference";
import { RollCallPanel } from "./RollCallPanel";
import "./dice-panel.css";

/** The purposes the picker offers: every one a free roll may carry. */
const PURPOSE_LABELS: Record<TableRollPurpose, string> = {
  manual: "Roll",
  attack: "Attack",
  damage: "Damage",
  healing: "Healing",
  save: "Save",
  check: "Check"
};
/** A roll's label in the log, the character builder's own rolls included. */
const ROLL_LABELS: Record<RollPurpose, string> = { ...PURPOSE_LABELS, builder: "Builder" };
const QUICK_DICE = [4, 6, 8, 10, 12, 20] as const;

/**
 * The product's reveal words for each roll visibility, shared by the picker and the roll-meta line.
 * Keyed by every wire value, since the meta line labels rolls this user could not choose (a GM
 * reads a player's `blind` roll).
 */
export const ROLL_VISIBILITY_WORD: Readonly<Record<RollVisibility, string>> = {
  public: "Shown to players",
  "gm-only": "GM only",
  "self-only": "Hidden from players · you and the GM see it",
  blind: "GM only · you won't see the result"
};

/**
 * Who may choose what. The GM gets two: for a GM roller `self-only` and `gm-only` reach the same
 * eyes (`apps/server/src/combat-log.ts`), so a third option would be a second name for one audience.
 */
export const VISIBILITY_OPTIONS: Readonly<Record<"gm" | "player", readonly RollVisibility[]>> = {
  gm: ["public", "gm-only"],
  player: ["public", "self-only", "blind"]
};

function modifierSuffix(modifier: number) {
  return modifier === 0 ? "" : modifier > 0 ? `+${modifier}` : `${modifier}`;
}
function modifierLabel(modifier: number) {
  return modifier === 0 ? "±0" : modifier > 0 ? `+${modifier}` : `−${Math.abs(modifier)}`;
}

/**
 * A formula with its first single d20 rolled with Advantage (`2d20kh1`) or Disadvantage (`2d20kl1`), so "1d20 + 5"
 * keeps its bonus; null when the formula has no single d20 to give it to.
 */
export function withD20Mode(formula: string, keep: "kh1" | "kl1"): string | null {
  const match = /(^|[^0-9a-z])(1?d20)(?![0-9a-z])/i.exec(formula);
  if (!match) return null;
  const start = match.index + match[1].length;
  return `${formula.slice(0, start)}2d20${keep}${formula.slice(start + match[2].length)}`;
}

export function DicePanel({
  role,
  state,
  mineActorId
}: {
  role: "gm" | "player";
  state: GmView | PlayerView;
  mineActorId?: string;
}) {
  const [formula, setFormula] = useState("1d20");
  const [purpose, setPurpose] = useState<TableRollPurpose>("manual");
  const [visibility, setVisibility] = useState<RollVisibility>("public");
  const [rollFilter, setRollFilter] = useState<"all" | "mine">("all");
  const [modifier, setModifier] = useState(0);
  const [advantage, setAdvantage] = useState(false);
  const [disadvantage, setDisadvantage] = useState(false);
  const [fallFeet, setFallFeet] = useState("");
  // The GM's own panel calls for rolls; a character's dice pane does not. Calling sits beside rolling, one tap away.
  const gmState = role === "gm" && !mineActorId && "definitions" in state ? state : null;
  const [mode, setMode] = useState<"roll" | "call">("roll");
  const openCalls = gmState?.rollCalls.length ?? 0;
  const { toast } = useToast();
  // The shared per-browser dice-input preference; no choice at a table that keeps players' dice on the server.
  const { rollInput, mayType, setRollInput } = useRollPreference();
  // A player's "self-only" roll is seen by the roller and the GM but no other player. "blind" hides
  // the result from the roller too.
  const visibilityOptions = VISIBILITY_OPTIONS[role];
  const visibilityLabel = (value: RollVisibility) => ROLL_VISIBILITY_WORD[value] ?? value;

  // A roll lands in the feed below, so only what the feed cannot show gets a toast.
  const submit = async (rollFormula: string, rollPurpose: TableRollPurpose) => {
    const result = await command("dice:roll", { formula: rollFormula, purpose: rollPurpose, visibility });
    if (!result.ok)
      toast(result.message ?? "That roll didn't work. Check the formula and try again.", { tone: "error" });
    else if (result.hiddenFromRoller) toast("Secret roll sent to the GM.", { tone: "success" });
  };
  // Advantage/disadvantage arm the next d20 roll only, which clears them. 5e never allows both at
  // once, so arming one while the other is armed cancels both and the player chooses again.
  const toggleAdvantage = () => {
    if (advantage) return setAdvantage(false);
    if (disadvantage) {
      setAdvantage(false);
      setDisadvantage(false);
      return;
    }
    setAdvantage(true);
  };
  const toggleDisadvantage = () => {
    if (disadvantage) return setDisadvantage(false);
    if (advantage) {
      setAdvantage(false);
      setDisadvantage(false);
      return;
    }
    setDisadvantage(true);
  };
  const quickRoll = (sides: number) => {
    if (sides === 20 && (advantage || disadvantage)) {
      const kind = advantage ? "kh1" : "kl1";
      setAdvantage(false);
      setDisadvantage(false);
      return void submit(`2d20${kind}${modifierSuffix(modifier)}`, "manual");
    }
    void submit(`1d${sides}${modifierSuffix(modifier)}`, "manual");
  };
  // An armed Advantage or Disadvantage goes to the formula's d20 and is spent; a formula with no d20 leaves it armed
  // for the next roll that has one.
  const customRoll = () => {
    const armed = advantage ? "kh1" : disadvantage ? "kl1" : null;
    const moded = armed ? withD20Mode(formula, armed) : null;
    if (moded !== null) {
      setAdvantage(false);
      setDisadvantage(false);
    }
    void submit(moded ?? formula, purpose);
  };
  // SRD Falling: 1d6 bludgeoning per 10 feet fallen, max 20d6, and the faller lands Prone. The server
  // rolls; this builds the formula and reminds about applying damage and Prone.
  const fallDice = Math.min(Math.floor((Number.parseInt(fallFeet, 10) || 0) / 10), 20);
  const rollFall = async () => {
    const result = await command("dice:roll", { formula: `${fallDice}d6`, purpose: "damage", visibility });
    if (!result.ok) toast(result.message ?? "That roll didn't work.", { tone: "error" });
    else
      toast(`Fall damage rolled (${fallDice}d6 bludgeoning). Apply the total as damage; the faller lands Prone.`, {
        tone: "success"
      });
  };

  const modeSwitch = gmState ? (
    <SegmentedControl
      className="dice-mode"
      ariaLabel="Roll dice or call for a roll"
      value={mode}
      onChange={(next) => setMode(next as "roll" | "call")}
      options={[
        { value: "roll", label: "Roll dice" },
        { value: "call", label: openCalls > 0 ? `Call for a roll · ${openCalls} open` : "Call for a roll" }
      ]}
    />
  ) : null;
  if (gmState && mode === "call")
    return (
      <section className="dice-proof" aria-labelledby="roll-call-heading">
        {modeSwitch}
        <RollCallPanel state={gmState} />
      </section>
    );

  return (
    <section className="dice-proof" aria-labelledby="dice-proof-heading">
      {modeSwitch}
      <div className="dice-heading">
        {/* The `id` is the section's `aria-labelledby` target. */}
        <div>
          <h2 id="dice-proof-heading">Roll dice</h2>
        </div>
        <label className="dice-visibility">
          Visibility
          <Select value={visibility} onChange={(event) => setVisibility(event.target.value as RollVisibility)}>
            {visibilityOptions.map((value) => (
              <option key={value} value={value}>
                {ROLL_VISIBILITY_WORD[value]}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {/* The per-browser roll-input preference, shared with the character sheet's toggle. */}
      {mayType && (
        <div className="dice-roll-pref" role="group" aria-label="How you roll">
          <SegmentedControl
            size="sm"
            ariaLabel="Roll input mode"
            value={rollInput}
            onChange={(mode) => setRollInput(mode as "digital" | "manual")}
            options={[
              { value: "digital", label: "Digital" },
              { value: "manual", label: "Manual" }
            ]}
          />
        </div>
      )}
      <div className="dice-quick" role="group" aria-label="Quick rolls">
        {QUICK_DICE.map((sides) => (
          <button key={sides} onClick={() => quickRoll(sides)}>
            d{sides}
          </button>
        ))}
      </div>
      <div className="dice-adv-row" role="group" aria-label="Advantage and modifier">
        <button type="button" className="secondary" aria-pressed={advantage} onClick={toggleAdvantage}>
          Advantage
        </button>
        <button type="button" className="secondary" aria-pressed={disadvantage} onClick={toggleDisadvantage}>
          Disadvantage
        </button>
        <Stepper
          label="Modifier"
          value={modifier}
          onChange={setModifier}
          format={modifierLabel}
          aria-label="Roll modifier"
        />
      </div>
      {(advantage || disadvantage) && (
        <p className="dice-armed">{advantage ? "Advantage" : "Disadvantage"} is armed for the next d20 roll.</p>
      )}
      <details className="dice-custom">
        <summary>Custom formula (advantage keeps, drop lowest, and more)</summary>
        <div className="dice-form">
          <label>
            Formula
            <Input value={formula} onChange={(event) => setFormula(event.target.value)} placeholder="2d20kh1 + 5" />
          </label>
          <label>
            Purpose
            <Select value={purpose} onChange={(event) => setPurpose(event.target.value as TableRollPurpose)}>
              {(Object.keys(PURPOSE_LABELS) as TableRollPurpose[]).map((value) => (
                <option key={value} value={value}>
                  {PURPOSE_LABELS[value]}
                </option>
              ))}
            </Select>
          </label>
          <Button variant="primary" onClick={customRoll}>
            Roll
          </Button>
        </div>
        <p className="dice-hint">Try 1d20, 2d20kh1 + 5, or 2d6 + 1d4 - 2.</p>
      </details>
      <details className="dice-custom">
        <summary>Falling damage (1d6 per 10 ft, max 20d6)</summary>
        <div className="dice-form">
          <label>
            Feet fallen
            <Input
              type="number"
              min="0"
              max="10000"
              inputMode="numeric"
              value={fallFeet}
              onChange={(event) => setFallFeet(event.target.value)}
              placeholder="30"
            />
          </label>
          <Button variant="primary" onClick={rollFall} disabled={fallDice < 1}>
            Roll {fallDice > 0 ? `${fallDice}d6` : "fall"}
          </Button>
        </div>
        <p className="dice-hint">Bludgeoning damage; the faller lands Prone (SRD Falling).</p>
      </details>
      {(() => {
        const rolls =
          mineActorId && rollFilter === "mine"
            ? state.rolls.filter((roll) => roll.actorId === mineActorId)
            : state.rolls;
        return (
          <>
            <div className="roll-list-head">
              <h3 className="roll-list-title">Recent rolls</h3>
              {mineActorId && (
                <SegmentedControl
                  size="sm"
                  ariaLabel="Filter rolls"
                  value={rollFilter}
                  onChange={(value) => setRollFilter(value as "all" | "mine")}
                  options={[
                    { value: "all", label: "Table" },
                    { value: "mine", label: "Mine" }
                  ]}
                />
              )}
            </div>
            <div className="roll-list scroll-y" aria-label="Recent rolls">
              {rolls.length === 0 && (
                <p>{rollFilter === "mine" ? "No rolls from this character yet." : "No rolls yet."}</p>
              )}
              {rolls
                .slice(-30)
                .reverse()
                .map((roll) => (
                  <article className="roll-card" key={roll.id}>
                    <div className="roll-card-top">
                      <span className={`roll-badge roll-badge--${roll.purpose}`} title={ROLL_LABELS[roll.purpose]}>
                        {roll.label ?? ROLL_LABELS[roll.purpose]}
                      </span>
                      <span className="roll-meta">
                        {roll.initiatorLabel ?? "Unknown roller"} · {visibilityLabel(roll.visibility)}
                        {roll.free ? " · Free roll" : ""}
                      </span>
                    </div>
                    <div className="roll-readout">
                      <div className="dice-faces">
                        {roll.dice.map((die, index) => (
                          <span
                            key={`${roll.id}-${index}`}
                            className={die.kept ? "die" : "die discarded"}
                            title={`d${die.sides}${die.kept ? "" : " (discarded)"}`}
                          >
                            {die.face}
                          </span>
                        ))}
                      </div>
                      <span className="roll-formula">{roll.formula}</span>
                      <span className="roll-eq" aria-hidden="true">
                        =
                      </span>
                      <strong className="roll-total">{roll.total}</strong>
                    </div>
                  </article>
                ))}
            </div>
          </>
        );
      })()}
    </section>
  );
}

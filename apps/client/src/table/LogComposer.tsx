import { useState, type FormEvent, type ReactNode } from "react";
import { Button, IconArrow, IconButton, IconDie, Input, Modal, useToast } from "@vtt/ui";
import { command } from "../lib/command";
import { ROLL_VISIBILITY_WORD } from "../dice/DicePanel";
import { useRollVisibility } from "../dice/roll-visibility";
import "./log-composer.css";

const QUICK_DICE = [4, 6, 8, 10, 12, 20] as const;

/**
 * The composer under the log: a quick die sends one `1dN`, and the field rolls a typed formula. The server rolls
 * either and the log shows the result, so nothing is evaluated here. A refused formula keeps its text and says the
 * server's reason; an accepted one clears the field. Until the table has chat, the field takes formulas only. Dice
 * options open the full dice tools: who sees the roll, Advantage, a modifier, the purpose, falling damage and, for the
 * GM, calls for a roll.
 */
export function LogComposer({ options }: Readonly<{ options?: ReactNode }>) {
  const visibility = useRollVisibility();
  const [formula, setFormula] = useState("");
  const [busy, setBusy] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const { toast } = useToast();

  const roll = async (rollFormula: string): Promise<boolean> => {
    const result = await command("dice:roll", { formula: rollFormula, purpose: "manual", visibility });
    if (!result.ok) {
      toast(result.message ?? "That roll didn't work. Check the formula and try again.", { tone: "error" });
      return false;
    }
    if (result.hiddenFromRoller) toast("Secret roll sent to the GM.", { tone: "success" });
    return true;
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const typed = formula.trim();
    if (!typed || busy) return;
    setBusy(true);
    void roll(typed).then((ok) => {
      setBusy(false);
      if (ok) setFormula("");
    });
  };

  return (
    <div className="log-composer">
      <div className="log-composer-dice" role="group" aria-label="Quick rolls">
        {QUICK_DICE.map((sides) => (
          <button
            key={sides}
            type="button"
            className="log-composer-die interactive"
            aria-label={`Roll 1d${sides}`}
            onClick={() => void roll(`1d${sides}`)}
          >
            d{sides}
          </button>
        ))}
      </div>
      <form className="log-composer-row" onSubmit={submit}>
        <span className="log-composer-field">
          <IconDie aria-hidden="true" />
          <Input
            value={formula}
            onChange={(event) => setFormula(event.target.value)}
            placeholder="Roll dice, like 2d6+3"
            aria-label="Roll dice"
            autoComplete="off"
            spellCheck={false}
          />
        </span>
        <IconButton type="submit" label="Roll the formula" disabled={busy || formula.trim() === ""}>
          <IconArrow />
        </IconButton>
      </form>
      {options && (
        <div className="log-composer-foot">
          <span className="log-composer-audience">{ROLL_VISIBILITY_WORD[visibility]}</span>
          <Button variant="link" size="sm" onClick={() => setOptionsOpen(true)}>
            Dice options
          </Button>
        </div>
      )}
      {options && (
        <Modal open={optionsOpen} onClose={() => setOptionsOpen(false)} title="Dice options" size="lg">
          {options}
        </Modal>
      )}
    </div>
  );
}

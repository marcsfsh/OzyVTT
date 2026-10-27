import { useState, type FormEvent, type ReactNode } from "react";
import { Button, IconArrow, IconButton, Input, Modal, Select, useToast } from "@vtt/ui";
import { command } from "../lib/command";
import { ROLL_VISIBILITY_WORD } from "../dice/DicePanel";
import { useRollVisibility } from "../dice/roll-visibility";
import "./log-composer.css";

const QUICK_DICE = [4, 6, 8, 10, 12, 20] as const;

type Character = Readonly<{ id: string; name: string }>;
/** Who can talk, and to whom: the GM whispers to a party character; a player speaks as theirs and whispers to the GM. */
export type ComposerTalk =
  Readonly<{ role: "gm"; characters: readonly Character[] }> | Readonly<{ role: "player"; speaker: Character | null }>;

/** What the field's text asks for (ADR-0038): a roll after `/roll` or `/r`, a line of chat, or a word it doesn't know. */
export type ComposerIntent =
  | Readonly<{ kind: "roll"; formula: string }>
  | Readonly<{ kind: "chat"; text: string }>
  | Readonly<{ kind: "unknown"; message: string }>;

export function composerIntent(typed: string): ComposerIntent {
  const text = typed.trim();
  const slash = /^\/(\S*)\s*(.*)$/.exec(text);
  if (!slash) return { kind: "chat", text };
  const [, word, rest] = slash;
  if (word === "roll" || word === "r")
    return rest.trim() === ""
      ? { kind: "unknown", message: "Add a formula after /roll, like /roll 1d20+5." }
      : { kind: "roll", formula: rest.trim() };
  return { kind: "unknown", message: `The table doesn't know /${word}. Type /roll and a formula to roll dice.` };
}

/**
 * The composer under the log: a quick die sends one `1dN`; the field says a line at the table, or rolls the formula
 * after `/roll`. The server rolls and the log shows the result, so nothing is evaluated here, and a line is never a
 * malformed roll: only `/roll` rolls. Who hears it picks everyone or a whisper between the GM and one character. A
 * refused line keeps its text and says the server's reason. Dice options open the full dice tools.
 */
export function LogComposer({ options, talk }: Readonly<{ options?: ReactNode; talk: ComposerTalk }>) {
  const visibility = useRollVisibility();
  const [text, setText] = useState("");
  const [hears, setHears] = useState("");
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
  const say = async (line: string): Promise<boolean> => {
    if (talk.role === "player" && !talk.speaker) {
      toast("Claim a character to talk at the table.", { tone: "error" });
      return false;
    }
    const result = await command("chat:send", {
      text: line,
      ...(talk.role === "player" && talk.speaker ? { actorId: talk.speaker.id } : {}),
      ...(hears ? { whisperTo: hears } : {})
    });
    if (!result.ok) {
      toast(result.message ?? "That line wasn't sent. Try again.", { tone: "error" });
      return false;
    }
    return true;
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || text.trim() === "") return;
    const intent = composerIntent(text);
    if (intent.kind === "unknown") {
      toast(intent.message, { tone: "error" });
      return;
    }
    setBusy(true);
    void (intent.kind === "roll" ? roll(intent.formula) : say(intent.text)).then((ok) => {
      setBusy(false);
      if (ok) setText("");
    });
  };
  const whisperOptions =
    talk.role === "gm"
      ? talk.characters.map((character) => ({ value: character.id, label: `Whisper to ${character.name}` }))
      : [{ value: "gm", label: "Whisper to the GM" }];

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
        <Select
          className="log-composer-hears"
          aria-label="Who hears it"
          value={hears}
          onChange={(event) => setHears(event.target.value)}
        >
          <option value="">Everyone</option>
          {whisperOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <span className="log-composer-field">
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Say, or /roll 1d20"
            aria-label="Say something or roll"
            autoComplete="off"
            maxLength={600}
          />
        </span>
        <IconButton type="submit" label="Send" disabled={busy || text.trim() === ""}>
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

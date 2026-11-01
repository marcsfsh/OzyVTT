import { useState, type ReactNode } from "react";
import {
  Button,
  Chip,
  Eyebrow,
  Modal,
  EVERYONE,
  namesLabel,
  characterNames,
  type Audience,
  type PartyCharacter
} from "@vtt/ui";
import "./shared.css";

/** Who a reveal goes to, shared by the dialog and the page's side column: the choice, the Cup's words, the payload. */
function useRevealChoice(initial: Audience, party: readonly PartyCharacter[]) {
  const [mode, setMode] = useState<"everyone" | "characters">(
    initial.audience === "characters" ? "characters" : "everyone"
  );
  const [chosen, setChosen] = useState<readonly string[]>(
    initial.audience === "characters" ? initial.characterIds : []
  );
  const names = characterNames(chosen, party);
  const ready = mode === "everyone" || chosen.length > 0;
  const action =
    mode === "everyone" ? "Reveal to everyone" : names.length ? `Reveal to ${namesLabel(names)}` : "Reveal";
  const next = (): Audience => (mode === "everyone" ? EVERYONE : { audience: "characters", characterIds: [...chosen] });
  return { mode, setMode, chosen, setChosen, ready, action, next };
}

/** The line under the preview: the links it names, then where the block stays and what its stamp says. */
const stampLine = (links: ReactNode | undefined) =>
  `${links ? `${links} ` : ""}The block keeps its place on the page, and its stamp shows the session and the players' date.`;

/**
 * The reveal in a page's side column (F finding spec 2.4): Who sees it as Base line chips (Everyone, or each character,
 * which is today's Chosen characters), What they will read, the stamp's line, and the Cup naming who it goes to. The
 * column's head (Back and "Reveal {name}") is the page's.
 */
export function RevealColumn({
  party,
  initial = EVERYONE,
  preview,
  links,
  busy = false,
  error,
  onReveal
}: Readonly<{
  party: readonly PartyCharacter[];
  initial?: Audience;
  preview: ReactNode;
  links?: ReactNode;
  busy?: boolean;
  error?: string | null;
  onReveal: (next: Audience) => void;
}>) {
  const choice = useRevealChoice(initial, party);
  const toggle = (id: string) => {
    const on = choice.mode === "characters" && choice.chosen.includes(id);
    const rest = choice.mode === "characters" ? choice.chosen.filter((other) => other !== id) : [];
    choice.setMode(on && rest.length === 0 ? "everyone" : "characters");
    choice.setChosen(on ? rest : [...rest, id]);
  };
  return (
    <div className="cx-reveal cx-reveal-column">
      <div className="cx-reveal-who" role="group" aria-label="Who sees it">
        <Eyebrow>Who sees it</Eyebrow>
        <div className="cx-reveal-chips">
          <Chip
            pressed={choice.mode === "everyone"}
            onClick={() => {
              choice.setMode("everyone");
              choice.setChosen([]);
            }}
          >
            Everyone
          </Chip>
          {party.map((character) => (
            <Chip
              key={character.id}
              pressed={choice.mode === "characters" && choice.chosen.includes(character.id)}
              onClick={() => toggle(character.id)}
            >
              {character.name}
            </Chip>
          ))}
        </div>
      </div>
      <Eyebrow>What they will read</Eyebrow>
      <div className="cx-reveal-preview">{preview}</div>
      <p className="cx-hint">{stampLine(links)}</p>
      {error && (
        <p className="cx-reveal-error" role="alert">
          {error}
        </p>
      )}
      <Button
        variant="primary"
        className="cx-reveal-cup"
        disabled={busy || !choice.ready}
        onClick={() => onReveal(choice.next())}
      >
        {choice.action}
      </Button>
    </div>
  );
}

/**
 * Reveal a hidden block in a dialog, where there is no page side column yet (quests, Tonight, the table's Codex tab):
 * to everyone, or to chosen characters, with a preview of what they will read and the links it names. Nothing is
 * written until the GM presses the button, whose words say who the block goes to.
 */
export function RevealPanel({
  title,
  party,
  initial = EVERYONE,
  preview,
  links,
  busy = false,
  error,
  onCancel,
  onReveal
}: Readonly<{
  /** The block's title; an untitled block reads "this block". */
  title: string | null;
  party: readonly PartyCharacter[];
  initial?: Audience;
  /** What the chosen readers will read, rendered as they will see it. */
  preview: ReactNode;
  /** A sentence about the pages and maps the block links, and whether the chosen readers can open them. */
  links?: ReactNode;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onReveal: (next: Audience) => void;
}>) {
  const { mode, setMode, chosen, setChosen, ready, action, next } = useRevealChoice(initial, party);
  const name = title?.trim() || "this block";
  return (
    <Modal
      open
      onClose={onCancel}
      size="sm"
      accent="violet"
      title={`Reveal ${name}`}
      className="cx-reveal"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !ready} onClick={() => onReveal(next())}>
            {action}
          </Button>
        </>
      }
    >
      <fieldset className="cx-reveal-who">
        <legend>
          <Eyebrow>Who sees it</Eyebrow>
        </legend>
        <label className="cx-reveal-option">
          <input type="radio" name="cx-reveal-who" checked={mode === "everyone"} onChange={() => setMode("everyone")} />
          Everyone
        </label>
        <label className="cx-reveal-option">
          <input
            type="radio"
            name="cx-reveal-who"
            checked={mode === "characters"}
            onChange={() => setMode("characters")}
            disabled={party.length === 0}
          />
          Chosen characters
        </label>
        {party.length > 0 && (
          <div className="cx-reveal-characters">
            {party.map((character) => (
              <label key={character.id} className="cx-reveal-option is-character">
                <input
                  type="checkbox"
                  checked={chosen.includes(character.id)}
                  disabled={mode !== "characters"}
                  onChange={(event) =>
                    setChosen((current) =>
                      event.target.checked ? [...current, character.id] : current.filter((id) => id !== character.id)
                    )
                  }
                />
                {character.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <Eyebrow>What they will read</Eyebrow>
      <div className="cx-reveal-preview scroll-y">{preview}</div>
      <p className="cx-hint">{stampLine(links)}</p>
      {error && (
        <p className="cx-reveal-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

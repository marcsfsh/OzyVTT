import { useState, type ReactNode } from "react";
import { Button, Eyebrow, Modal } from "@vtt/ui";
import { EVERYONE, namesLabel, characterNames, type Audience, type PartyCharacter } from "./audience";
import "./shared.css";

/**
 * Reveal a hidden block: to everyone, or to chosen characters, with a preview of what they will read and the links
 * it names. Nothing is written until the GM presses the button, whose words say who the block goes to.
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
  const [mode, setMode] = useState<"everyone" | "characters">(
    initial.audience === "characters" ? "characters" : "everyone"
  );
  const [chosen, setChosen] = useState<readonly string[]>(
    initial.audience === "characters" ? initial.characterIds : []
  );
  const name = title?.trim() || "this block";
  const names = characterNames(chosen, party);
  const ready = mode === "everyone" || chosen.length > 0;
  const action =
    mode === "everyone" ? "Reveal to everyone" : names.length ? `Reveal to ${namesLabel(names)}` : "Reveal";
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
          <Button
            variant="primary"
            disabled={busy || !ready}
            onClick={() =>
              onReveal(mode === "everyone" ? EVERYONE : { audience: "characters", characterIds: [...chosen] })
            }
          >
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
      <p className="cx-hint">
        {`${links ? `${links} ` : ""}The block keeps its place on the page, and its stamp shows the session and the players' date.`}
      </p>
      {error && (
        <p className="cx-reveal-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

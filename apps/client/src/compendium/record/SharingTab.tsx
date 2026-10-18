import { IconEyeOff, IconUser, cx } from "@vtt/ui";
import { WhoSeesItSwitch } from "../../codex/shared/WhoSeesIt";
import { toggleCharacter, type PartyCharacter } from "../../codex/shared/audience";
import type { HomebrewRecordDocument, RecordAudience } from "../../homebrew/api";
import type { Kind } from "../kinds";
import { placesFor } from "./words";

const dayOf = (at: string) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Why Who sees it cannot change now, or null when it can. */
export function audienceLock(doc: HomebrewRecordDocument): string | null {
  if (doc.deletedAt) return "Restore it before you share it.";
  if (doc.state === "draft") return "Publish it before you share it.";
  return null;
}

/** The word under Who sees it: who a record reaches, in the words the Compendium's tables use. */
export function audienceWord(doc: HomebrewRecordDocument, kind: Kind, party: readonly PartyCharacter[]): string {
  if (doc.audience === "hidden") return kind === "monster" ? "Only you see it" : "Only you can pick it";
  if (doc.audience === "everyone") return "Every player can pick it";
  const names = party.filter((character) => doc.characterIds.includes(character.id)).map((character) => character.name);
  return `Revealed to ${names.length > 2 ? `${names.length} characters` : names.join(" and ") || "no one"}`;
}

/**
 * A record's own row of the sharing grid: who sees it, each party character with when it reached them, where each
 * audience meets it, and who it is not sent to.
 */
export function SharingTab({
  doc,
  kind,
  name,
  party,
  busy,
  onAudience
}: Readonly<{
  doc: HomebrewRecordDocument;
  kind: Kind;
  name: string;
  party: readonly PartyCharacter[];
  busy: boolean;
  onAudience: (next: RecordAudience) => void;
}>) {
  const lock = audienceLock(doc);
  const value = { audience: doc.audience, characterIds: doc.characterIds };
  const stamp = (to: string) => [...doc.reveals].reverse().find((reveal) => reveal.to === to)?.at ?? null;
  const reached = (characterId: string) =>
    doc.audience === "everyone" || (doc.audience === "characters" && doc.characterIds.includes(characterId));
  const sentTo = party.filter((character) => reached(character.id));
  const notSent = party.filter((character) => !reached(character.id));
  const everyoneSince = doc.audience === "everyone" ? stamp("everyone") : null;
  return (
    <div className="cp-sharingtab">
      <WhoSeesItSwitch
        value={value}
        party={party}
        what={name}
        onChange={onAudience}
        word={audienceWord(doc, kind, party)}
        disabledReason={lock ?? (busy ? "Saving." : null)}
      />
      {kind === "monster" && (
        <p className="cp-hint">Players never get a monster's stat block, whoever it is shared with.</p>
      )}
      {everyoneSince && <p className="cp-line">Revealed to everyone since {dayOf(everyoneSince)}</p>}
      {party.length > 0 && (
        <ul className="cp-checklist" aria-label="Characters">
          {party.map((character) => {
            const on = reached(character.id);
            const since = on ? stamp(doc.audience === "everyone" ? "everyone" : character.id) : null;
            return (
              <li key={character.id}>
                <label className={cx("cx-check", on && "is-on")}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={lock !== null || busy || doc.audience === "everyone"}
                    onChange={() => onAudience(toggleCharacter(value, character.id))}
                  />
                  <span className="cp-check-text">
                    <span>{character.name}</span>
                    <small>{on ? (since ? `Revealed since ${dayOf(since)}` : "Revealed") : "Not sent"}</small>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {sentTo.length > 0 && placesFor(kind, null).length > 0 && (
        <>
          <p className="cp-eyebrow">
            Where {sentTo.length === 1 ? `${sentTo[0]!.name}'s player meets` : "players meet"} it
          </p>
          <ul className="cp-places">
            {placesFor(kind, sentTo.length === 1 ? sentTo[0]!.name : null).map((place) => (
              <li key={place}>
                <IconUser /> {place}
              </li>
            ))}
          </ul>
        </>
      )}
      {notSent.length > 0 && doc.audience !== "hidden" && (
        <>
          <p className="cp-eyebrow">Not sent to</p>
          <p className="cp-line cp-muted">
            <IconEyeOff /> {notSent.map((character) => character.name).join(" and ")}'s{" "}
            {notSent.length === 1 ? "player" : "players"}
          </p>
        </>
      )}
    </div>
  );
}

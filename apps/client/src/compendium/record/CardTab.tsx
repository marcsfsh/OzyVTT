import { useEffect, useState } from "react";
import { Select } from "@vtt/ui";
import type { PartyCharacter } from "../../codex/shared/audience";
import { homebrewApi, type HomebrewRecordDocument, type SeeAs } from "../../homebrew/api";
import { CompendiumCard, cardOfEntry, type Card } from "../CompendiumCard";
import { kindLabel, type Kind, type Names } from "../kinds";
import { placesFor } from "./words";

/** Why one audience does not receive a record, from what the GM's copy says about it. */
function whyNot(doc: HomebrewRecordDocument | null, kind: Kind, party: readonly PartyCharacter[]): string {
  if (kind === "monster") return "Players never get a monster's stat block. It stays in the bestiary for you.";
  if (kind === "spell-list")
    return "A spell list has no card of its own for players. Its spells reach them through the classes that draw from it.";
  if (!doc) return "Nothing reaches that player from this record.";
  if (doc.deletedAt) return "It is archived.";
  if (doc.state === "draft") return "It is a draft, and a draft reaches no player.";
  if (!doc.inCatalogs) return `Its pack, ${doc.packName ?? "this table"}, is switched off in Sources.`;
  if (doc.audience === "hidden") return "It is Hidden.";
  if (doc.audience === "characters") {
    const names = party
      .filter((character) => doc.characterIds.includes(character.id))
      .map((character) => character.name);
    return `It is revealed to ${names.join(" and ") || "other characters"} only.`;
  }
  return "Nothing from this record reaches that player.";
}

/**
 * The record as the table shows it: the card people meet, read as the GM writes it, or through the server's read
 * for Everyone or one character's player, with where that audience meets it.
 */
export function CardTab({
  token,
  kind,
  recordId,
  doc,
  gmCard,
  names,
  party,
  as: asked,
  onAs
}: Readonly<{
  token: string;
  kind: Kind;
  recordId: string;
  /** The GM's copy of a homebrew record; null for an SRD record. */
  doc: HomebrewRecordDocument | null;
  /** The card as the GM's copy draws it, changes not live included. */
  gmCard: Card;
  names: Names;
  party: readonly PartyCharacter[];
  /** Who the card is read as, from the address: `everyone`, a character's id, or null for the GM. */
  as: string | null;
  onAs: (as: SeeAs | null) => void;
}>) {
  const as: "gm" | SeeAs = asked === "everyone" || party.some((entry) => entry.id === asked) ? (asked as SeeAs) : "gm";
  const [read, setRead] = useState<Readonly<{ as: string; card: Card | null; error: string | null }> | null>(null);
  const character = party.find((entry) => entry.id === as);
  const audienceName = as === "gm" ? "you" : as === "everyone" ? "every player" : (character?.name ?? "that character");

  // The server's read for one player, whether or not anyone holds the character. Read again when the record moves.
  const docRev = doc?.rev ?? 0;
  useEffect(() => {
    if (as === "gm") return;
    let live = true;
    setRead(null);
    homebrewApi.seeAsContent(token, recordId, as).then(
      (answer) => {
        if (live)
          setRead({ as, card: answer.received && answer.entry ? cardOfEntry(answer.entry) : null, error: null });
      },
      (error: unknown) => {
        if (live) setRead({ as, card: null, error: error instanceof Error ? error.message : "Couldn't read that." });
      }
    );
    return () => {
      live = false;
    };
  }, [as, token, recordId, docRev]);

  const places = as === "gm" ? [] : placesFor(kind, as === "everyone" ? null : (character?.name ?? null));
  const shown = as === "gm" ? gmCard : read?.as === as ? read.card : undefined;
  const who = as === "everyone" ? "Everyone" : (character?.name ?? "");
  return (
    <div className="cp-cardtab">
      <div className="cp-seeas">
        <label className="cp-eyebrow" htmlFor={`cp-seeas-${recordId}`}>
          See as
        </label>
        <Select
          id={`cp-seeas-${recordId}`}
          value={as}
          onChange={(event) => onAs(event.target.value === "gm" ? null : (event.target.value as SeeAs))}
        >
          <option value="gm">GM</option>
          <option value="everyone">Everyone</option>
          {party.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </Select>
        <span className="cp-hint">
          {as === "gm"
            ? doc?.pendingChanges
              ? "Your copy, with the changes not live. Players read the published version until you press Update."
              : "Your copy, as you write it."
            : `From the server's read for ${as === "everyone" ? "every player" : `${who}'s player`}.`}
        </span>
      </div>
      {shown === undefined ? (
        <p className="cp-hint">Reading what {audienceName} gets.</p>
      ) : shown === null ? (
        <div className="cp-notsent" role="status">
          <p>
            <strong>
              {as === "everyone" ? "Players don't" : `${who}'s player doesn't`} receive this {kindLabel(kind)}.
            </strong>{" "}
            {read?.error ?? whyNot(doc, kind, party)}
          </p>
        </div>
      ) : (
        <div className="cp-cardframe">
          <CompendiumCard card={shown} names={names} />
        </div>
      )}
      {places.length > 0 && shown && (
        <>
          <p className="cp-eyebrow">Where it shows for {as === "everyone" ? "everyone" : who}</p>
          <ul className="cp-places">
            {places.map((place) => (
              <li key={place}>{place}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

import { useState } from "react";
import { Button, IconEyeOff, IconUser, cx, namesLabel, type PartyCharacter } from "@vtt/ui";
import type { HomebrewRecordDocument, RecordAudience } from "../../homebrew/api";
import type { Kind } from "../kinds";
import { placesFor } from "./words";
import { formatDay } from "../../lib/formatWhen";

const dayOf = (at: string) => formatDay(at);

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
 * SHARE in the record's side column (G pages spec 2.5): Everyone and each character as boxes (none ticked is Hidden),
 * each with when it reached them; what players will read; where they meet it and who it is not sent to; and the Cup
 * saying what it will do ("Share with Lyra", "Share with everyone", "Hide it"). On a draft the Cup publishes first;
 * a deleted record says to restore it instead.
 */
export function SharingTab({
  doc,
  kind,
  name,
  line,
  party,
  busy,
  onAudience,
  onPublish
}: Readonly<{
  doc: HomebrewRecordDocument;
  kind: Kind;
  name: string;
  /** The record's one line (size and type, level and school), for what they will read. */
  line?: string;
  party: readonly PartyCharacter[];
  busy: boolean;
  onAudience: (next: RecordAudience) => void;
  /** Publishes a draft; resolves once it is published. */
  onPublish?: () => Promise<unknown>;
}>) {
  const [everyone, setEveryone] = useState(doc.audience === "everyone");
  const [chosen, setChosen] = useState<readonly string[]>(doc.audience === "characters" ? doc.characterIds : []);
  // A change elsewhere (the Sharing page, another device) starts the boxes again from the record.
  const key = `${doc.audience}:${doc.characterIds.join(",")}`;
  const [shownFor, setShownFor] = useState(key);
  if (shownFor !== key) {
    setShownFor(key);
    setEveryone(doc.audience === "everyone");
    setChosen(doc.audience === "characters" ? doc.characterIds : []);
  }
  const stamp = (to: string) => [...doc.reveals].reverse().find((reveal) => reveal.to === to)?.at ?? null;
  const reached = (characterId: string) =>
    doc.audience === "everyone" || (doc.audience === "characters" && doc.characterIds.includes(characterId));
  const sentTo = party.filter((character) => reached(character.id));
  const notSent = party.filter((character) => !reached(character.id));

  const next: RecordAudience = everyone
    ? { audience: "everyone", characterIds: [] }
    : chosen.length > 0
      ? { audience: "characters", characterIds: [...chosen] }
      : { audience: "hidden", characterIds: [] };
  const names = party.filter((character) => chosen.includes(character.id)).map((character) => character.name);
  const share = everyone ? "Share with everyone" : names.length > 0 ? `Share with ${namesLabel(names)}` : "Hide it";
  const draft = doc.state === "draft";
  const unchanged = next.audience === doc.audience && next.characterIds.join() === doc.characterIds.join();
  const cup = draft ? `Publish and ${share.charAt(0).toLowerCase()}${share.slice(1)}` : share;
  const run = async () => {
    if (draft && onPublish) await onPublish();
    onAudience(next);
  };

  return (
    <div className="cp-sharingtab">
      <h3 className="cp-side-title">Share</h3>
      <ul className="cp-checklist" aria-label="Who sees it">
        <li>
          <label className={cx("nh-check", everyone && "is-on")}>
            <input
              type="checkbox"
              checked={everyone}
              disabled={busy || doc.deletedAt !== null}
              onChange={() => setEveryone((on) => !on)}
            />
            <span className="cp-check-text">
              <span>Everyone</span>
              {doc.audience === "everyone" && stamp("everyone") && (
                <small>{`Revealed since ${dayOf(stamp("everyone")!)}`}</small>
              )}
            </span>
          </label>
        </li>
        {party.map((character) => {
          const on = everyone || chosen.includes(character.id);
          const since = reached(character.id) ? stamp(doc.audience === "everyone" ? "everyone" : character.id) : null;
          return (
            <li key={character.id}>
              <label className={cx("nh-check", on && "is-on")}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy || everyone || doc.deletedAt !== null}
                  onChange={() =>
                    setChosen((held) =>
                      held.includes(character.id) ? held.filter((id) => id !== character.id) : [...held, character.id]
                    )
                  }
                />
                <span className="cp-check-text">
                  <span>{character.name}</span>
                  <small>
                    {reached(character.id) ? (since ? `Revealed since ${dayOf(since)}` : "Revealed") : "Not sent"}
                  </small>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="cp-eyebrow">What they will read</p>
      <div className="cp-share-preview">
        <b>{name}</b>
        {line && <small>{line}</small>}
      </div>
      {kind === "monster" && (
        <p className="cp-hint">Players never get a monster's stat block, whoever it is shared with.</p>
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
      {doc.deletedAt ? (
        <p className="cp-hint">Restore it before you share it.</p>
      ) : (
        <>
          {draft && <p className="cp-hint">Publish it before you share it.</p>}
          <Button
            variant="primary"
            className="cp-share-cup"
            disabled={busy || (!draft && unchanged)}
            onClick={() => void run()}
          >
            {cup}
          </Button>
        </>
      )}
    </div>
  );
}

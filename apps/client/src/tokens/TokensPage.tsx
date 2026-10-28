import { useState } from "react";
import type { GmActor, GmView } from "@vtt/domain";
import { Button } from "@vtt/ui";
import { ActorAvatar } from "../actors/ActorAvatar";
import { useMediaQuery } from "../lib/useMediaQuery";
import { navigate } from "../router";
import { TokenLibrary } from "./TokenLibrary";
import "./tokens-page.css";

const KIND_WORDS: Readonly<Record<GmActor["kind"], string>> = {
  "player-character": "Character",
  npc: "Character the GM plays",
  monster: "Monster"
};

/**
 * Prep's Tokens page: every creature at the table with the picture it shows, and Set token image to open the token
 * library for it. The library and its command are the same as on the sheet and the map; this page only lists who.
 */
export function TokensPage({ state, token }: Readonly<{ state: GmView; token: string }>) {
  const phone = useMediaQuery("(max-width: 760px)");
  const [choosing, setChoosing] = useState<GmActor | null>(null);
  const actors = state.actors.filter((actor) => !actor.archived);
  const sorted = [...actors].sort(
    (a, b) =>
      Number(b.kind === "player-character") - Number(a.kind === "player-character") || a.name.localeCompare(b.name)
  );
  const picture = (actor: GmActor) => (actor.tokenAssetId ? "Its own image" : "Default picture");

  return (
    <section className="tokens-page frame-col" aria-labelledby="tokens-page-title">
      <h1 id="tokens-page-title" className="nh-sr-only">
        Tokens
      </h1>
      <div className="scroll-y frame-fill tokens-page-body">
        {sorted.length === 0 ? (
          <div className="tokens-page-empty">
            <p>No characters or monsters yet.</p>
            <Button variant="secondary" onClick={() => void navigate("/roster")}>
              Open Party
            </Button>
          </div>
        ) : phone ? (
          <ul className="tokens-page-rows" aria-label="Tokens">
            {sorted.map((actor) => (
              <li key={actor.id}>
                <button type="button" className="tokens-page-row interactive" onClick={() => setChoosing(actor)}>
                  <ActorAvatar actor={actor} token={token} definitions={state.definitions} name={actor.name} />
                  <span className="tokens-page-row-text">
                    <b>{actor.name}</b>
                    <span>
                      {KIND_WORDS[actor.kind]} · {picture(actor)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <table className="tokens-page-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Kind</th>
                <th scope="col">Picture</th>
                <th scope="col">
                  <span className="nh-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((actor) => (
                <tr key={actor.id}>
                  <td>
                    <span className="tokens-page-name">
                      <ActorAvatar
                        actor={actor}
                        token={token}
                        definitions={state.definitions}
                        name={actor.name}
                        size="sm"
                      />
                      <b>{actor.name}</b>
                    </span>
                  </td>
                  <td>{KIND_WORDS[actor.kind]}</td>
                  <td>{picture(actor)}</td>
                  <td className="tokens-page-actions">
                    <Button variant="secondary" size="sm" onClick={() => setChoosing(actor)}>
                      Set token image…
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {choosing && (
        <TokenLibrary
          actorId={choosing.id}
          actorName={choosing.name}
          definitionId={choosing.definitionId ?? null}
          currentAssetId={choosing.tokenAssetId ?? null}
          token={token}
          role="gm"
          onClose={() => setChoosing(null)}
        />
      )}
    </section>
  );
}

import { rosterActors, type GmView } from "@vtt/domain";
import { Button, StatusLamp, cx } from "@vtt/ui";
import { ActorPortrait } from "../actors/ActorPortrait";
import { classLine, presenceLabel } from "../actors/actor-display";
import { JoinAddress } from "../components/JoinAddress";
import { navigate } from "../router";
import { SCENES_PATHS } from "../scenes/routes";
import "./lobby.css";

/** Who plays a character, in the roster's words (characters rule 4): on a player's device, at the table, or open. */
function whoPlays(
  actor: GmView["actors"][number]
): Readonly<{ word: string; tone: "device" | "table" | "open"; away: string | null }> {
  if (actor.ownerSessionId)
    return {
      word: "On a player's device",
      tone: "device",
      away: actor.presence && actor.presence !== "online" ? presenceLabel(actor.presence) : null
    };
  if (actor.playedAtTable) return { word: "At the table", tone: "table", away: null };
  return { word: "Open to claim", tone: "open", away: null };
}

/**
 * The GM's empty table is the lobby (arrival spec 2.4, ADR-0052): at the left, where players join (the code, the
 * address and Copy); at the right, the party with who plays each one, filling in as players claim, and Prepare an
 * encounter as the Cup. It reads only what the GM's view already holds: `ownerSessionId`, `presence` and
 * `playedAtTable`.
 */
export function Lobby({ state, token }: Readonly<{ state: GmView; token: string }>) {
  const definitions = state.definitions ?? [];
  const party = rosterActors(state.actors).filter((actor) => actor.kind === "player-character" && !actor.archived);
  const claimed = party.filter((actor) => actor.ownerSessionId || actor.playedAtTable).length;
  return (
    <div className="lobby-host">
      <div className="lobby scroll-y">
        <section className="lobby-join" aria-label="Players join at">
          <JoinAddress token={token} layout="lobby" />
        </section>
        <section className="lobby-party" aria-labelledby="lobby-party-title">
          <h2 id="lobby-party-title" className="lobby-title">
            The party{" "}
            <span className="lobby-count">
              {claimed} of {party.length} claimed
            </span>
          </h2>
          <ul className="lobby-rows">
            {party.map((actor) => {
              const who = whoPlays(actor);
              const definition = definitions.find((entry) => entry.id === actor.definitionId)?.definition;
              return (
                <li key={actor.id} className="lobby-row">
                  <ActorPortrait actor={actor} frame="party" size="sm" />
                  <span className="lobby-row-text">
                    <b>{actor.name}</b>
                    <span>{classLine(definition) ?? "Character"}</span>
                  </span>
                  <span className={cx("lobby-who", `is-${who.tone}`, who.away && "is-away")}>
                    <StatusLamp lit={who.tone !== "open"} />
                    {who.away ? `${who.word} · ${who.away}` : who.word}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="lobby-foot">
            <p className="lobby-line">The party fills in as players claim their characters.</p>
            <Button variant="primary" onClick={() => navigate(SCENES_PATHS.newScene)}>
              Prepare an encounter
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

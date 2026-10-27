import { useState, type ReactNode } from "react";
import type { GmActor, GmView } from "@vtt/domain";
import { Chip, IconChevronRight, Modal, Switch, cx } from "@vtt/ui";
import { ActorPortrait, frameOf } from "../actors/ActorPortrait";
import "./start-fight.css";

const SIDE_WORD: Readonly<Record<GmActor["kind"], string>> = {
  "player-character": "Party",
  npc: "NPC",
  monster: "Monster"
};

/** "Lyra", "Lyra and Borin", "Lyra, Borin and 2 more" for the phone's one-line rows. */
function namesOf(names: readonly string[]): string {
  if (names.length === 0) return "Nobody";
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/** A row's second line: whose side it is on and where its token is, or that players can't see it. */
function placeOf(actor: GmActor, tokens: GmView["combat"]["tokens"]): string {
  if (actor.visibility === "gm-only") return "Hidden from players";
  const token = tokens.find((entry) => entry.actorId === actor.id);
  const where = token?.position ? "on the map" : token ? "in the tray" : "not placed yet";
  return `${SIDE_WORD[actor.kind]}, ${where}`;
}

/** "3 of the party, 4 monsters": the phone's In this fight row. */
export function sidesOf(actors: readonly GmActor[]): string {
  const party = actors.filter((actor) => actor.kind === "player-character").length;
  const monsters = actors.filter((actor) => actor.kind === "monster").length;
  const npcs = actors.length - party - monsters;
  const parts = [
    party > 0 ? `${party} of the party` : null,
    monsters > 0 ? `${monsters} ${monsters === 1 ? "monster" : "monsters"}` : null,
    npcs > 0 ? `${npcs} ${npcs === 1 ? "NPC" : "NPCs"}` : null
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(", ") : "Nobody yet";
}

/**
 * The line under Start the fight: who rolls initiative. With players rolling, the claimed characters wait for their
 * players' rolls and the server rolls the rest.
 */
export function rollsLine(staged: readonly GmActor[], playersRoll: boolean): string {
  if (staged.length === 0) return "Tick at least one character or monster.";
  const claimed = playersRoll
    ? staged.filter((actor) => actor.kind === "player-character" && actor.ownerSessionId).length
    : 0;
  const rolledHere = staged.length - claimed;
  if (claimed === 0)
    return staged.length === 1 ? "Rolls initiative for 1" : `Rolls initiative for all ${staged.length}`;
  const players = `Players roll for their ${claimed} claimed ${claimed === 1 ? "character" : "characters"}`;
  return rolledHere === 0 ? `${players}.` : `Rolls initiative for ${rolledHere}. ${players}.`;
}

export type StartFightProps = Readonly<{
  state: GmView;
  token: string | null;
  /** Everyone the list offers: the staged characters and monsters, ticked or not. */
  candidates: readonly GmActor[];
  ticked: ReadonlySet<string>;
  onTick: (actorId: string, ticked: boolean) => void;
  surprised: ReadonlySet<string>;
  onSurprised: (actorId: string) => void;
  playersRoll: boolean;
  onPlayersRoll: (on: boolean) => void;
  groupMonsters: boolean;
  onGroupMonsters: (on: boolean) => void;
  busy: boolean;
  /** The spell areas on the map, which outlast a fight. */
  spellAreas: ReactNode;
  /** The map, the tray and the Add buttons: the same staging parts Prep uses. */
  staging: ReactNode;
  /** Why Start the fight can't run yet, when it can't. */
  blocked: string | null;
  phone: boolean;
}>;

/**
 * Start a fight: In this fight lists the staged characters and monsters, ticked, with hidden ones marked; the two
 * initiative switches; Surprised as one chip each, with the rule. On a phone the three are rows that open a sheet.
 */
export function StartFight(props: StartFightProps) {
  return props.phone ? <StartFightCard {...props} /> : <StartFightPanel {...props} />;
}

function StartFightPanel(props: StartFightProps) {
  return (
    <div className="start-fight" aria-labelledby="gm-encounter-title">
      <h2 id="gm-encounter-title" className="start-fight-title">
        Start a fight
      </h2>
      <p className="start-fight-lede">Everyone on the map is in. Untick anyone who isn&apos;t.</p>
      {props.spellAreas}
      <InThisFight {...props} />
      <Initiative {...props} />
      <Surprised {...props} />
      {props.blocked && (
        <p className="encounter-start-blocked" role="status">
          {props.blocked}
        </p>
      )}
    </div>
  );
}

type Sheet = "fight" | "initiative" | "surprised";

function StartFightCard(props: StartFightProps) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const staged = props.candidates.filter((actor) => props.ticked.has(actor.id));
  const surprisedNames = staged.filter((actor) => props.surprised.has(actor.id)).map((actor) => actor.name);
  const initiativeWords = [
    props.playersRoll ? "Players roll their own." : "Rolled here for everyone.",
    props.groupMonsters ? "Groups share a roll." : "Each monster rolls."
  ].join(" ");
  const close = () => setSheet(null);
  return (
    <div className="start-fight is-card" aria-labelledby="gm-encounter-title">
      <div className="start-fight-card-head">
        <h2 id="gm-encounter-title" className="start-fight-title">
          Start a fight
        </h2>
        <span className="start-fight-card-state">No fight running</span>
      </div>
      {staged.length > 0 && (
        <div
          className="start-fight-faces"
          role="img"
          aria-label={`In this fight: ${namesOf(staged.map((a) => a.name))}`}
        >
          {staged.map((actor) => (
            <ActorPortrait
              key={actor.id}
              actor={actor}
              token={props.token}
              definitions={props.state.definitions}
              frame={frameOf(actor, "gm")}
              size="sm"
            />
          ))}
        </div>
      )}
      {props.spellAreas}
      <ul className="start-fight-rows">
        <CardRow title="In this fight" value={sidesOf(staged)} onOpen={() => setSheet("fight")} />
        <CardRow title="Initiative" value={initiativeWords} onOpen={() => setSheet("initiative")} />
        <CardRow title="Surprised" value={namesOf(surprisedNames)} onOpen={() => setSheet("surprised")} />
      </ul>
      {props.blocked && (
        <p className="encounter-start-blocked" role="status">
          {props.blocked}
        </p>
      )}
      <Modal open={sheet === "fight"} onClose={close} title="In this fight" align="bottom">
        <InThisFight {...props} />
      </Modal>
      <Modal open={sheet === "initiative"} onClose={close} title="Initiative" align="bottom">
        <Initiative {...props} />
      </Modal>
      <Modal open={sheet === "surprised"} onClose={close} title="Surprised" align="bottom">
        <Surprised {...props} />
      </Modal>
    </div>
  );
}

function CardRow({ title, value, onOpen }: Readonly<{ title: string; value: string; onOpen: () => void }>) {
  return (
    <li>
      <button type="button" className="start-fight-row interactive" onClick={onOpen}>
        <span className="start-fight-row-text">
          <b>{title}</b>
          <span>{value}</span>
        </span>
        <IconChevronRight />
      </button>
    </li>
  );
}

function InThisFight(props: StartFightProps) {
  const { candidates, ticked, onTick, busy, state, token } = props;
  return (
    <section className="start-fight-section" aria-label="In this fight">
      {!props.phone && <h3 className="start-fight-label">In this fight</h3>}
      {candidates.length === 0 ? (
        <p className="start-fight-empty">No one staged yet. Add characters or monsters below.</p>
      ) : (
        <ul className="start-fight-list">
          {candidates.map((actor) => (
            <li key={actor.id}>
              <label className={cx("start-fight-pick", "interactive", !ticked.has(actor.id) && "is-out")}>
                <ActorPortrait
                  actor={actor}
                  token={token}
                  definitions={state.definitions}
                  frame={frameOf(actor, "gm")}
                  size="sm"
                />
                <span className="start-fight-pick-text">
                  <b>{actor.name}</b>
                  <span>{placeOf(actor, state.combat.tokens)}</span>
                </span>
                <span className="start-fight-tick">
                  <input
                    type="checkbox"
                    checked={ticked.has(actor.id)}
                    disabled={busy}
                    aria-label={`${actor.name} is in this fight`}
                    onChange={(event) => onTick(actor.id, event.target.checked)}
                  />
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {props.staging}
    </section>
  );
}

function Initiative(props: StartFightProps) {
  return (
    <section className="start-fight-section" aria-label="Initiative">
      {!props.phone && <h3 className="start-fight-label">Initiative</h3>}
      <Switch
        label="Players roll their own initiative"
        checked={props.playersRoll}
        disabled={props.busy}
        onChange={props.onPlayersRoll}
      />
      <Switch
        label="One roll for each group of identical monsters"
        checked={props.groupMonsters}
        disabled={props.busy}
        onChange={props.onGroupMonsters}
      />
    </section>
  );
}

function Surprised(props: StartFightProps) {
  const staged = props.candidates.filter((actor) => props.ticked.has(actor.id));
  if (staged.length === 0) return null;
  return (
    <fieldset className="start-fight-section encounter-surprise">
      <legend className="start-fight-label">Surprised</legend>
      <div className="encounter-surprise-chips">
        {staged.map((actor) => (
          <Chip
            key={actor.id}
            pressed={props.surprised.has(actor.id)}
            disabled={props.busy}
            onClick={() => props.onSurprised(actor.id)}
          >
            {actor.name}
          </Chip>
        ))}
      </div>
      <p className="start-fight-rule">Pick who is Surprised. They roll initiative at Disadvantage.</p>
    </fieldset>
  );
}

import type { ReactNode } from "react";
import { effectivePlayerDice, type GmActor, type GmView } from "@vtt/domain";
import { Chip, Group, IconMore, Menu, MenuItem, SegmentedControl, Switch, cx, useToast } from "@vtt/ui";
import { command } from "../lib/command";
import { ActorPortrait, frameOf } from "../actors/ActorPortrait";
import { DICE_MODE_PHRASE } from "../settings/table-words";
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
  /** Whether each party character is played at the table for this encounter (ADR-0042). */
  atTable: (actor: GmActor) => boolean;
  onAtTable: (actorId: string, on: boolean) => void;
  busy: boolean;
  /** The spell areas on the map, which outlast a fight. */
  spellAreas: ReactNode;
  /** The map, the tray and the Add buttons: the same staging parts Prep uses. */
  staging: ReactNode;
  /** Why Start the fight can't run yet, when it can't. */
  blocked: string | null;
  phone: boolean;
  /** Takes a creature off this list; it stays on the roster. */
  onRemove: (actorId: string) => void;
  /** The encounter's difficulty, an open group under the Cradles. */
  difficulty?: ReactNode;
}>;

/** What players' dice do in this encounter, from its own modes or the table's (ADR-0043). */
export function diceLine(state: GmView): string {
  const dice = effectivePlayerDice(state);
  return `Players' d20 rolls: ${DICE_MODE_PHRASE[dice.d20]}. Their damage: ${DICE_MODE_PHRASE[dice.damage]}.`;
}

/** "Lyra at the table", "Lyra and Borin at the table", or "All on their devices": the phone's Who plays row. */
export function playsOf(party: readonly GmActor[], atTable: (actor: GmActor) => boolean): string {
  const here = party.filter(atTable).map((actor) => actor.name);
  return here.length === 0 ? "All on their devices" : `${namesOf(here)} at the table`;
}

/**
 * Start an encounter as one form (C3 running spec 2.1), the same on every size: spell areas when there are any, then In
 * this encounter (the one list of who is in it, each row with its tick and a More menu, the map line and the Add
 * buttons from the staging parts), Who plays, Initiative and Surprised as Cradles, the difficulty as an open group, and
 * what keeps it from starting where it can't yet. On a phone it is the Switch's Encounter view.
 */
export function StartFight(props: StartFightProps) {
  return (
    <div className="start-fight" aria-labelledby="gm-encounter-title">
      <h2 id="gm-encounter-title" className="nh-sr-only">
        Start an encounter
      </h2>
      {props.spellAreas}
      <InThisFight {...props} />
      <WhoPlays {...props} />
      <Initiative {...props} />
      <Surprised {...props} />
      {props.difficulty}
      {props.blocked && (
        <p className="encounter-start-blocked" role="status">
          {props.blocked}
        </p>
      )}
    </div>
  );
}

/** A row's More menu: show it to players or hide it, or take it off this list (it stays on the roster). */
function RowMore({ actor, busy, onRemove }: Readonly<{ actor: GmActor; busy: boolean; onRemove: () => void }>) {
  const { toast } = useToast();
  const shown = actor.visibility !== "gm-only";
  const reveal = () =>
    void command("actor:set-visibility", { actorId: actor.id, visibility: shown ? "gm-only" : "public" }).then(
      (result) => {
        if (!result.ok) toast(result.message ?? "The token's visibility could not be changed.", { tone: "error" });
      }
    );
  return (
    <Menu trigger={<IconMore />} icon align="end" label={`More for ${actor.name}`}>
      <MenuItem disabled={busy} onClick={reveal}>
        {shown ? "Hide from players" : "Show to players"}
      </MenuItem>
      <MenuItem disabled={busy} onClick={onRemove}>
        Remove from this list
      </MenuItem>
    </Menu>
  );
}

/** The list's head choice: whether new tokens land shown to players, the table's standing default. */
function NewTokens({ state }: Readonly<{ state: GmView }>) {
  const { toast } = useToast();
  const shown = (state.stagingDefaults?.visibility ?? "public") === "public";
  return (
    <Switch
      label="New tokens shown to players"
      checked={shown}
      onChange={(next) =>
        void command("table:set-staging-defaults", { visibility: next ? "public" : "gm-only" }).then((result) => {
          if (!result.ok) toast(result.message ?? "The staging default could not be changed.", { tone: "error" });
        })
      }
    />
  );
}

function InThisFight(props: StartFightProps) {
  const { candidates, ticked, onTick, busy, state, token } = props;
  return (
    <Group
      title="In this encounter"
      headingLevel={3}
      actions={<NewTokens state={state} />}
      className="start-fight-group"
    >
      {candidates.length === 0 ? (
        <p className="start-fight-empty">No one staged yet. Add characters or monsters below.</p>
      ) : (
        <ul className="start-fight-list">
          {candidates.map((actor) => (
            <li key={actor.id} className="start-fight-item">
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
                    aria-label={`${actor.name} is in this encounter`}
                    onChange={(event) => onTick(actor.id, event.target.checked)}
                  />
                </span>
              </label>
              <RowMore actor={actor} busy={busy} onRemove={() => props.onRemove(actor.id)} />
            </li>
          ))}
        </ul>
      )}
      {props.staging}
    </Group>
  );
}

/** Each party character in the encounter is played at the table, by the GM, or on its player's device. A claimed one
 *  stays on its device: the server refuses the table until the claim is released. */
function WhoPlays(props: StartFightProps) {
  const party = props.candidates.filter((actor) => props.ticked.has(actor.id) && actor.kind === "player-character");
  if (party.length === 0) return null;
  return (
    <Group title="Who plays" headingLevel={3} className="start-fight-group">
      <ul className="start-fight-plays">
        {party.map((actor) => (
          <li key={actor.id}>
            <span className="start-fight-plays-name">
              <b>{actor.name}</b>
              {actor.ownerSessionId !== null && <span>Claimed on a player&apos;s device</span>}
            </span>
            <SegmentedControl
              size="sm"
              ariaLabel={`Where ${actor.name} is played`}
              value={props.atTable(actor) ? "table" : "device"}
              disabled={props.busy || actor.ownerSessionId !== null}
              onChange={(value) => props.onAtTable(actor.id, value === "table")}
              options={[
                { value: "table", label: "At the table" },
                { value: "device", label: "On their device" }
              ]}
            />
          </li>
        ))}
      </ul>
      <p className="start-fight-rule">At the table, you answer every prompt for the character and roll its dice.</p>
    </Group>
  );
}

function Initiative(props: StartFightProps) {
  return (
    <Group title="Initiative" headingLevel={3} className="start-fight-group">
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
      <p className="start-fight-rule">{diceLine(props.state)}</p>
    </Group>
  );
}

function Surprised(props: StartFightProps) {
  const staged = props.candidates.filter((actor) => props.ticked.has(actor.id));
  if (staged.length === 0) return null;
  return (
    <Group title="Surprised" headingLevel={3} className="start-fight-group encounter-surprise">
      <div className="encounter-surprise-chips" role="group" aria-label="Surprised">
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
    </Group>
  );
}

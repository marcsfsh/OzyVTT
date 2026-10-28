import { useState } from "react";
import type { GmView, PartyVisibility } from "@vtt/domain";
import { Button, Menu, MenuItem, Select } from "@vtt/ui";
import { useForceRelease } from "../actors/useForceRelease";
import { JoinAddress } from "../components/JoinAddress";
import { useMediaQuery } from "../lib/useMediaQuery";
import { TokenLibrary } from "../tokens/TokenLibrary";
import { SETTING } from "./sections";
import { SettingRow, SettingsSection } from "./SettingRow";
import { useTableWrites } from "./table-writes";
import { ActorAvatar } from "../actors/ActorAvatar";

/**
 * How much a player sees of another player's character. The wire values are
 * `off | name-and-class | full-sheet | sheet-and-resources`; only `apps/server/src/projections.ts`
 * enforces them, and nothing here filters (`PartyStrip` only uses the tier to decide whether to
 * mount). A `Select`: four labels this long are unreadable as a segmented control at 320px.
 */
const PARTY_VISIBILITY_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "name-and-class", label: "Name and class" },
  { value: "full-sheet", label: "Full sheet" },
  { value: "sheet-and-resources", label: "Sheet and resources" }
] as const;

/**
 * The promise the GM reads before choosing, so it must match what the tier does: at `off` a
 * character is still named in the turn order and their token still shows health and conditions;
 * what `off` removes is the party list and the sheet.
 */
const PARTY_VISIBILITY_HELP: Readonly<Record<PartyVisibility, string>> = {
  off: "Players see each other's tokens and turn order. There is no party list and no sheet to open.",
  "name-and-class": "Players see who's in the party and what they play.",
  "full-sheet": "Players can open each other's sheets, read-only.",
  "sheet-and-resources": "Players also see each other's spell slots, inventory and hit dice."
};

const PRESENCE_WORDS = { online: "Connected", reconnecting: "Reconnecting", offline: "Away" } as const;

type TokenFor = Readonly<{ id: string; name: string; definitionId?: string; assetId: string | null }>;

/**
 * Players: the join address, what players see of each other, and the characters claimed at the table with what the
 * GM can do for each. Projection guard: rows are built only from claim and presence the GM view already carries
 * (`ownerSessionId`, `presence`). No session id, token or address is in the projection or added here.
 */
export function PlayersSection({
  state,
  gmToken,
  onPreviewScreen
}: Readonly<{ state: GmView; gmToken: string; onPreviewScreen: () => void }>) {
  const { send } = useTableWrites(state);
  const phone = useMediaQuery("(max-width: 650px)");
  const [tokenFor, setTokenFor] = useState<TokenFor | null>(null);
  const forceRelease = useForceRelease();
  const claimed = state.actors.filter(
    (actor) => actor.kind === "player-character" && !actor.archived && actor.ownerSessionId !== null
  );
  const presence = (actor: (typeof claimed)[number]) =>
    actor.presence === "online" ? "online" : actor.presence === "reconnecting" ? "reconnecting" : "offline";
  const chooseToken = (actor: (typeof claimed)[number]) =>
    setTokenFor({
      id: actor.id,
      name: actor.name,
      ...(actor.definitionId ? { definitionId: actor.definitionId } : {}),
      assetId: actor.tokenAssetId ?? null
    });

  return (
    <SettingsSection id="players" gmOnly>
      <SettingRow setting={SETTING.joinAddress} stacked>
        <JoinAddress token={gmToken} />
      </SettingRow>

      <SettingRow setting={SETTING.partyVisibility} stacked>
        <Select
          value={state.partyVisibility}
          aria-label={SETTING.partyVisibility.label}
          onChange={(event) =>
            void send(
              "table:set-party-visibility",
              { visibility: event.target.value as GmView["partyVisibility"] },
              "That setting was rejected."
            )
          }
        >
          {PARTY_VISIBILITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <p className="settings-note">{PARTY_VISIBILITY_HELP[state.partyVisibility]}</p>
      </SettingRow>

      <SettingRow setting={SETTING.atTheTable} stacked>
        {claimed.length === 0 ? (
          <p className="settings-empty">No character is claimed yet. Players claim one when they join.</p>
        ) : phone ? (
          <ul className="settings-list" aria-label="Characters at the table">
            {claimed.map((actor) => (
              <li key={actor.id} className="settings-list-row">
                <ActorAvatar
                  actor={actor}
                  token={gmToken}
                  definitions={state.definitions}
                  name={actor.name}
                  size="sm"
                  presence={
                    presence(actor) === "online" ? "online" : presence(actor) === "reconnecting" ? "away" : "offline"
                  }
                />
                <span className="settings-list-text">
                  <b>{actor.name}</b>
                  <span>{PRESENCE_WORDS[presence(actor)]}</span>
                </span>
                <Menu align="end" trigger="Actions" label={`Actions for ${actor.name}`}>
                  <MenuItem onClick={() => void forceRelease.release(actor)}>Force release</MenuItem>
                  <MenuItem onClick={() => chooseToken(actor)}>Set token image…</MenuItem>
                </Menu>
              </li>
            ))}
          </ul>
        ) : (
          <table className="settings-table">
            <thead>
              <tr>
                <th scope="col">Character</th>
                <th scope="col">Player</th>
                <th scope="col">
                  <span className="nh-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {claimed.map((actor) => (
                <tr key={actor.id}>
                  <td>
                    <span className="settings-cell-name">
                      <ActorAvatar
                        actor={actor}
                        token={gmToken}
                        definitions={state.definitions}
                        name={actor.name}
                        size="sm"
                        presence={
                          presence(actor) === "online"
                            ? "online"
                            : presence(actor) === "reconnecting"
                              ? "away"
                              : "offline"
                        }
                      />
                      <b>{actor.name}</b>
                    </span>
                  </td>
                  <td>{PRESENCE_WORDS[presence(actor)]}</td>
                  <td className="settings-cell-actions">
                    <Button variant="secondary" size="sm" onClick={() => void forceRelease.release(actor)}>
                      Force release
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => chooseToken(actor)}>
                      Set token image…
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {/* What every player sees on the table screen; it is one screen for the whole table. */}
        <Button variant="secondary" onClick={onPreviewScreen}>
          Preview the table screen
        </Button>
      </SettingRow>

      {tokenFor && (
        <TokenLibrary
          actorId={tokenFor.id}
          actorName={tokenFor.name}
          definitionId={tokenFor.definitionId ?? null}
          currentAssetId={tokenFor.assetId}
          token={gmToken}
          role="gm"
          onClose={() => setTokenFor(null)}
        />
      )}
      {forceRelease.dialog}
    </SettingsSection>
  );
}

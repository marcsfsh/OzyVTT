import type { ReactNode } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import { IconCog, Menu, MenuItem, Portrait, ThemeToggle } from "@vtt/ui";
import { pictureOf } from "../actors/actor-picture";
import { useReleaseCharacter } from "../actors/MyCharacter";
import { useConfirm } from "../components/feedback";
import { navigate } from "../router";
import { TableScreenLamp, useTableScreen } from "../table/TvControl";
import { MenuFace } from "./MenuButton";
import { useLeaveTable } from "./useLeaveTable";

const onlineOf = (state: GmView) =>
  state.actors.filter(
    (actor) =>
      actor.kind === "player-character" && !actor.archived && actor.ownerSessionId && actor.presence === "online"
  );
const partyOf = (state: GmView) =>
  state.actors.filter((actor) => actor.kind === "player-character" && !actor.archived && actor.ownerSessionId);

/**
 * The GM's rows (frame spec 2.1), in the order the laptop's menu and the phone's More sheet both list them: who you
 * are, who is here, the table screen with its actions, the theme, Settings and Sign out.
 */
export function GmMenuRows({
  state,
  token,
  onSignOut,
  afterWho
}: Readonly<{ state: GmView; token: string; onSignOut: () => void; afterWho?: ReactNode }>) {
  const screen = useTableScreen(token, state);
  const { confirm, dialog } = useConfirm();
  const online = onlineOf(state);
  const party = partyOf(state);
  return (
    <>
      <div className="frame-menu-who">
        <MenuFace />
        <span className="frame-menu-who-text">
          <strong>Game master</strong>
          <span>Running this table</span>
        </span>
      </div>
      {afterWho}
      <div className="frame-menu-row" role="group" aria-label={`Who is here, ${online.length} of ${party.length}`}>
        <span className="frame-menu-label">Who is here</span>
        <span className="frame-menu-faces">
          {online.slice(0, 5).map((actor) => (
            <Portrait key={actor.id} size="xs" frame="party" picture={pictureOf(actor, null, state.definitions)} />
          ))}
        </span>
        <span className="frame-menu-value">
          {online.length} of {party.length}
        </span>
      </div>
      <div className="frame-menu-row" role="group" aria-label={`Table screen, ${screen.status}`}>
        <span className="frame-menu-label">Table screen</span>
        <TableScreenLamp on={screen.on} known={screen.presentation !== null} />
      </div>
      {screen.actions.map((action) => (
        <MenuItem key={action.label} className="frame-menu-sub" disabled={action.disabled} onClick={action.onSelect}>
          {action.label}
        </MenuItem>
      ))}
      <div className="frame-menu-row">
        <span className="frame-menu-label">Theme</span>
        <ThemeToggle />
      </div>
      <MenuItem icon={<IconCog />} onClick={() => void navigate("/settings")}>
        Settings
      </MenuItem>
      <MenuItem
        data-asks=""
        onClick={() =>
          void confirm({
            title: "Sign out on this device?",
            body: "The table keeps running, and the GM password signs you back in.",
            confirmLabel: "Sign out"
          }).then((ok) => ok && onSignOut())
        }
      >
        Sign out
      </MenuItem>
      {dialog}
    </>
  );
}

/**
 * A player's rows: who you are and what you play, Release when one character is claimed (with more, the sheet's menu
 * releases each), the theme, Settings and Leave the table.
 */
export function PlayerMenuRows({
  state,
  onLeave,
  afterWho
}: Readonly<{ state: PlayerView; onLeave: () => void; afterWho?: ReactNode }>) {
  const { release, releasing, dialog: releaseDialog } = useReleaseCharacter(state);
  const { leave, dialog: leaveDialog } = useLeaveTable(state, onLeave);
  const mine = state.actors.filter((actor) => actor.kind === "player-character" && actor.claimStatus === "mine");
  const first = mine[0];
  return (
    <>
      <div className="frame-menu-who">
        <MenuFace picture={first ? pictureOf(first, null) : null} />
        <span className="frame-menu-who-text">
          <strong>{first ? first.name : "No character yet"}</strong>
          <span>
            {first ? (first.classLine ?? "Playing") : "Claim one on the table"}
            {mine.length > 1 ? ` · and ${mine.length - 1} more` : ""}
          </span>
        </span>
      </div>
      {afterWho}
      {mine.length === 1 && first && (
        <MenuItem tone="danger" data-asks="" disabled={releasing} onClick={() => void release(first.name)}>
          Release {first.name}
        </MenuItem>
      )}
      <div className="frame-menu-row">
        <span className="frame-menu-label">Theme</span>
        <ThemeToggle />
      </div>
      <MenuItem icon={<IconCog />} onClick={() => void navigate("/settings")}>
        Settings
      </MenuItem>
      <MenuItem data-asks="" onClick={() => void leave()}>
        Leave the table
      </MenuItem>
      {releaseDialog}
      {leaveDialog}
    </>
  );
}

/** The laptop top bar's one menu (frame spec 2.1): the face on a Base line, opening under it. */
export function FrameMenu(
  props: Readonly<
    | { role: "gm"; state: GmView; token: string; onSignOut: () => void }
    | { role: "player"; state: PlayerView; onLeave: () => void }
  >
) {
  if (props.role === "gm") {
    const online = onlineOf(props.state).length;
    return (
      <Menu
        className="frame-menu"
        triggerClassName="frame-menu-trigger"
        align="end"
        label={`GM menu, ${online} ${online === 1 ? "player" : "players"} online`}
        trigger={<MenuFace online={online} />}
      >
        <GmMenuRows state={props.state} token={props.token} onSignOut={props.onSignOut} />
      </Menu>
    );
  }
  const first = props.state.actors.find((actor) => actor.kind === "player-character" && actor.claimStatus === "mine");
  return (
    <Menu
      className="frame-menu"
      triggerClassName="frame-menu-trigger"
      align="end"
      label={first ? `Menu, playing ${first.name.split(/\s+/)[0] ?? first.name}` : "Menu"}
      trigger={<MenuFace picture={first ? pictureOf(first, null) : null} />}
    >
      <PlayerMenuRows state={props.state} onLeave={props.onLeave} />
    </Menu>
  );
}

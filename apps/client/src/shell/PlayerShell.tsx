import type { PlayerView } from "@vtt/domain";
import { Badge, Wordmark } from "@vtt/ui";
import { MyCharacter } from "../actors/MyCharacter";
import { useRecapBadge } from "../codex/useRecapBadge";
import { lazySurface } from "../components/lazySurface";
import { NotFoundPage } from "../components/NotFoundView";
import {
  isGmOnlyPath,
  isKnownPath,
  lastLocationForTab,
  layerOf,
  litPlayerTab,
  navigate,
  useRoute,
  type Route
} from "../router";
import { AppTabs, type TabFit } from "./AppTabs";
import { isFullPageLayer, LayerView } from "./LayerView";
import { TableView } from "./TableView";
import type { Connection } from "./useSession";

const PlayerCodex = lazySurface(() => import("../codex/PlayerCodex").then((m) => m.PlayerCodex));
const SettingsPage = lazySurface(() => import("../settings/SettingsPage").then((m) => m.SettingsPage));
const ReplayList = lazySurface(() => import("../replay/ReplayList").then((m) => m.ReplayList));

/** The player's four views, and the tab each address lights (see `litPlayerTab`). */
const viewOf = (route: Route) => litPlayerTab(route.path);

/** Every tab down to 561px; a phone keeps three and puts Settings and Rules in the More menu. */
const PLAYER_TAB_FIT: TabFit = [4, 4, 4, 3];

/** Whether the address is the player's table itself (not the shared replays listed under it). */
export const onPlayerTable = (route: Route) => viewOf(route) === "table" && route.segments[0] !== "replays";

/**
 * The player's views are tabs at real addresses (`/table`, `/codex/*`), so Back walks between them and
 * pages can be linked. The recap count is part of the tab's accessible name ("Codex, 2 new"), not just
 * a coloured dot.
 */
export function PlayerTabBar({ token }: Readonly<{ token: string }>) {
  const route = useRoute();
  const view = viewOf(route);
  // "A recap you haven't read".
  const recapBadge = useRecapBadge(token);
  return (
    <div className="frame-tabbar rim-player">
      <Wordmark variant="solid" sun className="app-logo" aria-hidden="true" />
      <AppTabs
        className="player-view-tabs"
        ariaLabel="Player sections"
        fits={PLAYER_TAB_FIT}
        tabs={[
          /* The player's first tab: who they play, how they are doing, the sheet, the party, and the builder. */
          { id: "mine", label: "My character", name: "My character" },
          { id: "table", label: "Table", name: "Table" },
          {
            id: "codex",
            name: "Codex",
            label: (
              <>
                Codex
                {recapBadge.unread > 0 && (
                  <>
                    {" "}
                    <Badge tone="info" solid>
                      {recapBadge.unread} new
                    </Badge>
                  </>
                )}
              </>
            )
          },
          /* A player sees only the Mine group here. */
          { id: "settings", label: "Settings", name: "Settings" }
        ]}
        activeId={view}
        /* The Codex reopens on the page they were reading. */
        onChange={(id) => {
          if (id === "codex") recapBadge.markSeen();
          const home = id === "codex" ? "/codex" : id === "settings" ? "/settings" : id === "mine" ? "/me" : "/table";
          if (id === view) {
            navigate(home);
            return;
          }
          navigate(id === "codex" ? (lastLocationForTab("player", "codex") ?? "/codex") : home);
        }}
      />
    </div>
  );
}

/**
 * The player's pane. A GM-only or unknown address gets the not-found view, indistinguishable from each
 * other, so an address never confirms that it means something.
 */
export function PlayerShell({
  state,
  token,
  connection,
  onLeave
}: Readonly<{
  state: PlayerView;
  token: string;
  connection: Connection;
  onLeave: () => void;
}>) {
  const route = useRoute();
  const view = viewOf(route);
  const layer = layerOf(route.path);
  if (isFullPageLayer(layer))
    return <LayerView layer={layer} role="player" state={state} token={token} connection={connection} />;
  const reachable = isKnownPath(route.path) && !isGmOnlyPath(route.path);
  switch (view) {
    /* The player Codex owns its frame: a rail beside chrome rows over one scrolling region. */
    case "codex":
      return <PlayerCodex token={token} />;
    /* My character, the player's first tab: the claimed character's sheet, whose menu carries the release verb. */
    case "mine":
      return (
        <MyCharacter
          state={state}
          token={token}
          onCreateCharacter={() => navigate("/builder")}
          onLevel={(actorId) => navigate(`/characters/${actorId}/level`)}
          onGoToTable={() => navigate("/table")}
        />
      );
    /* One Settings component for both roles. `SettingsPage` renders the GM groups only for a GM token,
       so GM-only controls are absent from a player's tree, not hidden. `/settings/api` is GM-only. */
    case "settings":
      return reachable ? (
        <SettingsPage role="player" state={state} onLeave={onLeave} />
      ) : (
        <NotFoundPage role="player" />
      );
    case "table":
      if (!reachable) return <NotFoundPage role="player" />;
      /* The shared replay list sits at the same address as the GM's, with the Table tab lit. Unshared
         ids are 404 at the server, so the list is the truth. */
      if (route.segments[0] === "replays")
        return (
          <ReplayList
            role="player"
            token={token}
            onOpen={(archiveId) => navigate(`/replays/${archiveId}`)}
            onBack={() => navigate("/table")}
          />
        );
      return <TableView role="player" state={state} token={token} />;
  }
}

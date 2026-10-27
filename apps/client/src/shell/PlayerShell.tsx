import type { PlayerView } from "@vtt/domain";
import { MyCharacter } from "../actors/MyCharacter";
import { lazySurface } from "../components/lazySurface";
import { NotFoundPage } from "../components/NotFoundView";
import { isGmOnlyPath, isKnownPath, layerOf, litPlayerTab, navigate, useRoute, type Route } from "../router";
import { isFullPageLayer, LayerView } from "./LayerView";
import { TableView } from "./TableView";
import type { Connection } from "./useSession";

const PlayerCodex = lazySurface(() => import("../codex/PlayerCodex").then((m) => m.PlayerCodex));
const SettingsPage = lazySurface(() => import("../settings/SettingsPage").then((m) => m.SettingsPage));
const ReplayList = lazySurface(() => import("../replay/ReplayList").then((m) => m.ReplayList));

/** The player's four views, and the tab each address lights (see `litPlayerTab`). */
const viewOf = (route: Route) => litPlayerTab(route.path);

/** Whether the address is the player's table itself (not the shared replays listed under it). */
export const onPlayerTable = (route: Route) => viewOf(route) === "table" && route.segments[0] !== "replays";

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
    /* One Settings component for both roles. A player's page is the Device section alone, so GM-only controls are
       absent from a player's tree, and never just hidden. Every other section's address is GM-only. */
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

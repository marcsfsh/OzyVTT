import type { PlayerView } from "@vtt/domain";
import { RulesButton } from "../reference/RulesReference";
import { Badge, Tabs, Wordmark } from "@vtt/ui";
import { MyCharacter } from "../actors/MyCharacter";
import { useRecapBadge } from "../codex/useRecapBadge";
import { lazySurface } from "../components/lazySurface";
import { NotFoundPage } from "../components/NotFoundView";
import { isGmOnlyPath, isKnownPath, lastLocationForTab, layerOf, navigate, useRoute, type Route } from "../router";
import { isFullPageLayer, LayerView } from "./LayerView";
import { TableView } from "./TableView";
import type { Connection } from "./useSession";

const PlayerCodex = lazySurface(() => import("../codex/PlayerCodex").then((m) => m.PlayerCodex));
const SettingsPage = lazySurface(() => import("../settings/SettingsPage").then((m) => m.SettingsPage));
const ReplayList = lazySurface(() => import("../replay/ReplayList").then((m) => m.ReplayList));

type PlayerTab = "mine" | "table" | "codex" | "settings";

/** The player's four views. Every address that is not My character, the Codex or Settings is the table. */
const viewOf = (route: Route): PlayerTab =>
  route.segments[0] === "me"
    ? "mine"
    : route.segments[0] === "codex"
      ? "codex"
      : route.segments[0] === "settings"
        ? "settings"
        : "table";

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
      <Tabs
        className="player-view-tabs"
        ariaLabel="Player sections"
        tabs={[
          /* The player's first tab: who they play, how they are doing, the sheet, the party, and the builder. */
          { id: "mine", label: "My character" },
          { id: "table", label: "Table" },
          {
            id: "codex",
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
          { id: "settings", label: "Settings" }
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
      <RulesButton />
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
  onOpenLog,
  onLeave
}: Readonly<{
  state: PlayerView;
  token: string;
  connection: Connection;
  onOpenLog: () => void;
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
    /* My character, the player's first tab; it carries the release verb. */
    case "mine":
      return (
        <MyCharacter
          state={state}
          onOpenSheet={(actorId) => navigate(`/characters/${actorId}`)}
          onCreateCharacter={() => navigate("/builder")}
          onLevel={(actorId) => navigate(`/characters/${actorId}/level`)}
          onGoToTable={() => navigate("/table")}
        />
      );
    /* One Settings component for both roles. `SettingsPage` renders the GM groups only for a GM token,
       so GM-only controls are absent from a player's tree, not hidden. `/settings/api` is GM-only. */
    case "settings":
      return reachable ? <SettingsPage role="player" state={state} /> : <NotFoundPage role="player" />;
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
      return <TableView role="player" state={state} token={token} onOpenLog={onOpenLog} onLeave={onLeave} />;
  }
}

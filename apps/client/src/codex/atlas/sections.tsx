import { useCodexShell, useGmCodex, usePlayerCodex } from "../shell/context";
import { AtlasView } from "./AtlasView";
import { PlayerAtlas } from "./PlayerAtlas";

/** The atlas as the GM's Codex section: the shell's address and feeds handed to the view. */
export function GmAtlasSection() {
  const { token, recordId, query, go, setQuery } = useCodexShell();
  const gm = useGmCodex();
  return (
    <AtlasView
      gmToken={token}
      scenes={gm.scenes}
      actors={gm.actors}
      activeEncounterId={gm.activeEncounterId}
      onActivateScene={gm.onActivateScene}
      onOpenReplay={gm.onOpenReplay}
      mapId={recordId}
      pinId={query.get("pin")}
      filter={query.get("q") ?? ""}
      tagFilter={query.get("tag")}
      autosave={gm.autosave}
      onQuickCreate={gm.quickCreate}
      onNavigate={go}
      onReplaceQuery={setQuery}
    />
  );
}

/** The atlas as a player's Codex section, over the player's own feeds. */
export function PlayerAtlasSection() {
  const { token, recordId, query, go, setQuery, setFilter } = useCodexShell();
  const { feeds } = usePlayerCodex();
  return (
    <PlayerAtlas
      token={token}
      maps={feeds.maps}
      pages={feeds.pages}
      mapId={recordId}
      query={query}
      onFilterChange={setFilter}
      onQueryChange={setQuery}
      onOpen={go}
      partyMapId={feeds.party?.marker.mapId ?? null}
    />
  );
}

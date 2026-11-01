import { useEffect, type ComponentType } from "react";
import { BackupView } from "../BackupView";
import { CodexSettingsView } from "../CodexSettings";
import { tagPath, type CodexSection } from "../routes";
import { GmPagesSection, PlayerPagesSection } from "../page/PageSection";
import { GmHome, PlayerHome } from "../home/HomeView";
import { SearchView } from "../search/SearchView";
import { GmQuests, PlayerQuests } from "../quests/QuestsView";
import { RelationshipsView } from "../relationships/RelationshipsView";
import { GmCompendiumSection, PlayerCompendiumSection } from "../../compendium/player/CodexCompendium";
import { useCodexShell, useGmCodex } from "./context";
import { GmAtlasSection, PlayerAtlasSection } from "../atlas/sections";
import { GmTemplatesSection } from "../templates/sections";
import {
  GmSessionsSection,
  GmStorySection,
  GmTimelineSection,
  PlayerSessionsSection,
  PlayerStorySection,
  PlayerTimelineSection
} from "../story/sections";

/**
 * The section registry: which view each Codex section renders, for the GM and for a player. A view is a component
 * with no props that reads the shell's context (`useCodexShell`, and `useGmCodex` or `usePlayerCodex`). A section
 * with no player view is GM only: a player who reaches its address gets the not-found view. The shells look a
 * section up here and nowhere else, so adding a view is one line in this table.
 */
export type CodexSectionEntry = Readonly<{
  gm: ComponentType;
  /** Null for the GM's own sections (the GM menu's). */
  player: ComponentType | null;
}>;

/** The old tag address lands on the pages index filtered to the tag, for either reader. */
function TagRedirect() {
  const { segments, go } = useCodexShell();
  const tag = decodeURIComponent(segments[2] ?? "");
  useEffect(() => go(tagPath(tag), { replace: true }), [go, tag]);
  return null;
}

function GmBackup() {
  const { token } = useCodexShell();
  const { feeds } = useGmCodex();
  return (
    <div className="scroll-y cx-legacy">
      <BackupView
        gmToken={token}
        onChanged={() => {
          void feeds.list.reload();
          void feeds.sessionFeed.reload();
          void feeds.questFeed.reload();
          void feeds.campaignFeed.reload();
        }}
      />
    </div>
  );
}

function GmSettings() {
  const { token } = useCodexShell();
  const { feeds } = useGmCodex();
  return (
    <div className="scroll-y cx-legacy">
      <CodexSettingsView gmToken={token} onSettingsChanged={feeds.settingsFeed.setData} />
    </div>
  );
}

export const CODEX_SECTIONS: Readonly<Record<CodexSection, CodexSectionEntry>> = {
  // ----- The shell and the page -----
  home: { gm: GmHome, player: PlayerHome },
  search: { gm: SearchView, player: SearchView },
  pages: { gm: GmPagesSection, player: PlayerPagesSection },
  quests: { gm: GmQuests, player: PlayerQuests },
  relationships: { gm: RelationshipsView, player: RelationshipsView },
  // The SRD and the homebrew each reader receives, read only; the GM edits it in the Compendium tab.
  compendium: { gm: GmCompendiumSection, player: PlayerCompendiumSection },
  tags: { gm: TagRedirect, player: TagRedirect },
  backup: { gm: GmBackup, player: null },
  settings: { gm: GmSettings, player: null },

  // ----- The atlas, the story, sessions and templates -----
  atlas: { gm: GmAtlasSection, player: PlayerAtlasSection },
  story: { gm: GmStorySection, player: PlayerStorySection },
  timeline: { gm: GmTimelineSection, player: PlayerTimelineSection },
  sessions: { gm: GmSessionsSection, player: PlayerSessionsSection },
  templates: { gm: GmTemplatesSection, player: null }
};

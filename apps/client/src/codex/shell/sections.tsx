import type { ComponentType } from "react";
import { BackupView } from "../BackupView";
import { CodexSettingsView } from "../CodexSettings";
import { TagView } from "../TagView";
import type { CodexSection } from "../routes";
import { GmPagesSection, PlayerPagesSection } from "../page/PageSection";
import { GmHome, PlayerHome } from "../home/HomeView";
import { SearchView } from "../search/SearchView";
import { GmQuests, PlayerQuests } from "../quests/QuestsView";
import { RelationshipsView } from "../relationships/RelationshipsView";
import { useCodexShell, useGmCodex, usePlayerCodex } from "./context";
import {
  GmAtlasLegacy,
  GmSessionsLegacy,
  GmStoryLegacy,
  GmTimelineLegacy,
  PlayerAtlasLegacy,
  PlayerSessionsLegacy,
  PlayerStoryLegacy,
  PlayerTimelineLegacy
} from "./legacy";

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

function GmTags() {
  const { token, segments, go } = useCodexShell();
  const { feeds } = useGmCodex();
  return (
    <div className="scroll-y cx-legacy">
      <TagView
        gmToken={token}
        tag={decodeURIComponent(segments[2] ?? "")}
        pages={feeds.pages}
        maps={feeds.campaign.maps}
        records={feeds.campaign.records}
        sessions={feeds.sessions}
        quests={feeds.quests}
        onNavigate={go}
      />
    </div>
  );
}

/** Player rows carry no reveal state, so `TagView` cannot badge one. */
function PlayerTags() {
  const { token, segments, go } = useCodexShell();
  const { feeds } = usePlayerCodex();
  return (
    <div className="scroll-y cx-legacy">
      <TagView
        gmToken={token}
        player
        tag={decodeURIComponent(segments[2] ?? "")}
        pages={feeds.pages}
        maps={feeds.maps}
        records={feeds.timeline}
        sessions={feeds.sessions}
        quests={feeds.quests}
        onNavigate={go}
      />
    </div>
  );
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

/** Prep templates: the GM's library and editor. */
function GmTemplates() {
  return <p className="cx-empty">Prep templates open here.</p>;
}

export const CODEX_SECTIONS: Readonly<Record<CodexSection, CodexSectionEntry>> = {
  // ----- The shell and the page -----
  home: { gm: GmHome, player: PlayerHome },
  search: { gm: SearchView, player: SearchView },
  pages: { gm: GmPagesSection, player: PlayerPagesSection },
  quests: { gm: GmQuests, player: PlayerQuests },
  relationships: { gm: RelationshipsView, player: RelationshipsView },
  tags: { gm: GmTags, player: PlayerTags },
  backup: { gm: GmBackup, player: null },
  settings: { gm: GmSettings, player: null },

  // ----- The atlas, the story, sessions and templates -----
  atlas: { gm: GmAtlasLegacy, player: PlayerAtlasLegacy },
  story: { gm: GmStoryLegacy, player: PlayerStoryLegacy },
  timeline: { gm: GmTimelineLegacy, player: PlayerTimelineLegacy },
  sessions: { gm: GmSessionsLegacy, player: PlayerSessionsLegacy },
  templates: { gm: GmTemplates, player: null }
};

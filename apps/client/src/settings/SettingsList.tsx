import type { ReactNode } from "react";
import { IconCode, IconCog, IconDie, IconKey, IconLevelUp, IconUser, SideListGroup, SideListRow } from "@vtt/ui";
import { pathForSection, type SettingsSection, type SettingsSectionId } from "./sections";
import { codexToolPath, type CodexTool, type CodexToolId } from "./codexTools";
import { CodexIcon } from "../codex/icons";

export const SECTION_ICONS: Readonly<Record<SettingsSectionId, ReactNode>> = {
  players: <IconUser />,
  fights: <IconDie />,
  characters: <IconLevelUp />,
  device: <IconCog />,
  access: <IconKey />,
  api: <IconCode />
};

/**
 * Settings' list (settings spec 2.1, amended by ADR-0071): the search at its top, then each section as one row of the
 * side list with its icon, its name and a count where one helps, the section shown lit. While the search holds words,
 * its matches take the rows' place.
 */
export function SettingsList({
  sections,
  current,
  counts,
  search,
  searching,
  onGo,
  codex
}: Readonly<{
  sections: readonly SettingsSection[];
  current: SettingsSectionId | null;
  counts: Readonly<Partial<Record<SettingsSectionId, number | null>>>;
  /** The search field, which draws its matches under itself while it holds words. */
  search: ReactNode;
  /** The search holds words, so its matches show in place of the sections. */
  searching: boolean;
  onGo: (id: SettingsSectionId) => void;
  /** The GM's Codex tools as a group under the sections (F time spec 2.6). */
  codex?: Readonly<{
    tools: readonly CodexTool[];
    current: CodexToolId | null;
    /** What a tool holds now where a word helps: Autosave On, Version history 12. */
    counts?: Readonly<Partial<Record<CodexToolId, string | number>>>;
    onGo: (id: CodexToolId) => void;
  }>;
}>) {
  return (
    <aside className="settings-index">
      <div className="settings-index-search">{search}</div>
      <nav className="nh-sidelist settings-index-nav scroll-y" aria-label="Settings sections" hidden={searching}>
        <SideListGroup eyebrow="Sections">
          {sections.map((section) => (
            <SideListRow
              key={section.id}
              label={section.label}
              leading={SECTION_ICONS[section.id]}
              count={counts[section.id] ?? undefined}
              current={section.id === current}
              href={pathForSection(section.id)}
              onSelect={() => onGo(section.id)}
            />
          ))}
        </SideListGroup>
      </nav>
      {codex && (
        <nav
          className="nh-sidelist settings-index-nav settings-index-codexnav"
          aria-label="Codex tools"
          hidden={searching}
        >
          <SideListGroup eyebrow="Codex">
            {codex.tools.map((tool) => (
              <SideListRow
                key={tool.id}
                label={tool.label}
                leading={<CodexIcon iconId={tool.iconId} />}
                count={codex.counts?.[tool.id]}
                current={tool.id === codex.current}
                href={codexToolPath(tool.id)}
                onSelect={() => codex.onGo(tool.id)}
              />
            ))}
          </SideListGroup>
        </nav>
      )}
    </aside>
  );
}

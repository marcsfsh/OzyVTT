import type { ReactNode } from "react";
import { IconCode, IconCog, IconDie, IconKey, IconLevelUp, IconUser, SideListGroup, SideListRow } from "@vtt/ui";
import { pathForSection, type SettingsSection, type SettingsSectionId } from "./sections";

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
  onGo
}: Readonly<{
  sections: readonly SettingsSection[];
  current: SettingsSectionId | null;
  counts: Readonly<Partial<Record<SettingsSectionId, number | null>>>;
  /** The search field, which draws its matches under itself while it holds words. */
  search: ReactNode;
  /** The search holds words, so its matches show in place of the sections. */
  searching: boolean;
  onGo: (id: SettingsSectionId) => void;
}>) {
  return (
    <aside className="settings-list">
      <div className="settings-list-search">{search}</div>
      <nav className="nh-sidelist settings-list-nav scroll-y" aria-label="Settings sections" hidden={searching}>
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
    </aside>
  );
}

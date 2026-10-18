import { IconCog, IconPlus, Menu, MenuItem } from "@vtt/ui";
import { GM_MENU_SECTIONS, SECTION_TITLE, pathForSection, type CodexSection } from "../routes";
import type { CodexCharacter } from "./context";

/** The GM's New: a page (named and typed in the quick create), a quest or a session, each opened once made. */
export function NewMenu({
  compact = false,
  onNewPage,
  onNewQuest,
  onNewSession
}: Readonly<{
  compact?: boolean;
  onNewPage: () => void;
  onNewQuest: () => void;
  onNewSession: () => void;
}>) {
  return (
    <Menu
      trigger={
        <>
          <IconPlus className="cx-icon" />
          {!compact && "New"}
        </>
      }
      label={compact ? "New" : undefined}
      icon={compact}
      align="end"
      className="cx-new-menu"
    >
      <MenuItem onClick={onNewPage}>New page</MenuItem>
      <MenuItem onClick={onNewQuest}>New quest</MenuItem>
      <MenuItem onClick={onNewSession}>New session</MenuItem>
    </Menu>
  );
}

/**
 * The GM menu: Prep templates, Backup, and Autosave and history, then See as players for Everyone or one
 * character, which opens the real player Codex on a preview token.
 */
export function GmMenu({
  section,
  compact = false,
  party,
  go,
  onPreview
}: Readonly<{
  section: CodexSection | null;
  compact?: boolean;
  party: readonly CodexCharacter[];
  go: (path: string) => void;
  onPreview: (characterId: string | null) => void;
}>) {
  const lit = section !== null && GM_MENU_SECTIONS.includes(section);
  return (
    <Menu
      trigger={
        <>
          <IconCog className="cx-icon" />
          {!compact && "GM menu"}
        </>
      }
      label={compact ? "GM menu" : undefined}
      icon={compact}
      align="end"
      className={`cx-gm-menu${lit ? " is-on" : ""}`}
    >
      {GM_MENU_SECTIONS.map((item) => (
        <MenuItem
          key={item}
          aria-current={section === item ? "page" : undefined}
          onClick={() => go(pathForSection(item))}
        >
          {SECTION_TITLE[item]}
        </MenuItem>
      ))}
      <MenuItem onClick={() => onPreview(null)}>See as players: Everyone</MenuItem>
      {party.map((character) => (
        <MenuItem key={character.id} onClick={() => onPreview(character.id)}>
          See as {character.name}
        </MenuItem>
      ))}
    </Menu>
  );
}

import { IconMore, IconPlus, Menu, MenuItem } from "@vtt/ui";
import { useBarStepDown } from "../../shell/SectionBar";
import { GM_MENU_SECTIONS, SECTION_TITLE, pathForSection, type CodexSection } from "../routes";
import type { CodexCharacter } from "./context";

/**
 * The GM's New: a page (named and typed in the quick create), a quest or a session, each opened once made. On the
 * laptop's bar it is the Cup, stepping down to a Base line button while the page shows a Cup of its own (theme rule
 * 2); on a phone it is the header's + icon.
 */
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
  const stepDown = useBarStepDown();
  const items = (
    <>
      <MenuItem onClick={onNewPage}>New page</MenuItem>
      <MenuItem onClick={onNewQuest}>New quest</MenuItem>
      <MenuItem onClick={onNewSession}>New session</MenuItem>
    </>
  );
  return compact ? (
    <Menu trigger={<IconPlus className="cx-icon" />} label="New" icon align="end" className="cx-new-menu">
      {items}
    </Menu>
  ) : (
    <Menu
      trigger={
        stepDown ? (
          <>
            <IconPlus /> New
          </>
        ) : (
          "New"
        )
      }
      triggerButton={stepDown ? "secondary" : "primary"}
      align="end"
      className="cx-new-menu"
    >
      {items}
    </Menu>
  );
}

/**
 * The bar's More (Codex frame rule 3.8): Prep templates, Backup, and Autosave and history, then See the Codex as
 * players for Everyone or one character, which opens the real player Codex on a preview token.
 */
export function GmMenu({
  section,
  party,
  go,
  onPreview
}: Readonly<{
  section: CodexSection | null;
  party: readonly CodexCharacter[];
  go: (path: string) => void;
  onPreview: (characterId: string | null) => void;
}>) {
  const lit = section !== null && GM_MENU_SECTIONS.includes(section);
  return (
    <Menu
      trigger={<IconMore className="cx-icon" />}
      label="More in the Codex"
      icon
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
      <MenuItem onClick={() => onPreview(null)}>See the Codex as players: Everyone</MenuItem>
      {party.map((character) => (
        <MenuItem key={character.id} onClick={() => onPreview(character.id)}>
          See the Codex as {character.name}
        </MenuItem>
      ))}
    </Menu>
  );
}

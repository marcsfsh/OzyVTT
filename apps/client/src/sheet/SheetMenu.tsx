import type { ReactNode } from "react";
import type { RollVisibility } from "@vtt/domain";
import {
  Button,
  IconChevronLeft,
  IconCog,
  IconDockRight,
  IconLevelUp,
  IconMore,
  IconPencil,
  IconPlus,
  IconUser,
  IconX,
  Menu,
  MenuItem,
  Modal,
  SegmentedControl,
  Select
} from "@vtt/ui";
import { ROLL_VISIBILITY_WORD, VISIBILITY_OPTIONS } from "../dice/DicePanel";
import { useRollPreference } from "../dice/roll-preference";

/** What the sheet's menu offers beyond the roll settings; each item shows only when its door is passed. */
export type SheetMenuItems = Readonly<{
  /** Level up to `to` (or the cap's say): absent when this viewer may not level the character. */
  levelUp?: Readonly<{ to: number | null; onSelect: () => void }>;
  levelDown?: Readonly<{ to: number; onSelect: () => void }>;
  editNames?: () => void;
  tokenImage?: () => void;
  /** The player's own extras on My character: the rest of the party and the builder. */
  party?: () => void;
  createCharacter?: () => void;
  /** Laptop-only placements of the sheet. */
  dockDice?: Readonly<{ docked: boolean; onToggle: () => void }>;
  popOut?: Readonly<{ floating: boolean; onToggle: () => void }>;
  newTab?: () => void;
  /** The GM plays a party character at the table, or on its player's device (ADR-0042); `blocked` says why not. */
  playedAtTable?: Readonly<{ on: boolean; blocked: string | null; onToggle: () => void }>;
  /** A player gives the character back: the menu's last item. */
  release?: Readonly<{ name: string; onSelect: () => void }>;
}>;

/** The sheet menu behind the header's button: levelling, names, the token image, the roll settings and Release. */
export function SheetMenu({
  name,
  items,
  onRollSettings
}: Readonly<{ name: string; items: SheetMenuItems; onRollSettings: () => void }>) {
  const {
    levelUp,
    levelDown,
    editNames,
    tokenImage,
    playedAtTable,
    party,
    createCharacter,
    dockDice,
    popOut,
    newTab,
    release
  } = items;
  const entries: ReactNode[] = [];
  if (levelUp)
    entries.push(
      <MenuItem key="up" icon={<IconLevelUp />} disabled={levelUp.to === null} onClick={levelUp.onSelect}>
        {levelUp.to === null ? "At the table's highest level" : `Level up to ${levelUp.to}`}
      </MenuItem>
    );
  if (levelDown)
    entries.push(
      <MenuItem key="down" icon={<IconChevronLeft />} onClick={levelDown.onSelect}>
        Level down to {levelDown.to}
      </MenuItem>
    );
  if (editNames)
    entries.push(
      <MenuItem key="names" icon={<IconPencil />} onClick={editNames}>
        Edit names
      </MenuItem>
    );
  if (tokenImage)
    entries.push(
      <MenuItem key="token" icon={<IconUser />} onClick={tokenImage}>
        Token image
      </MenuItem>
    );
  entries.push(
    <MenuItem key="rolls" icon={<IconCog />} onClick={onRollSettings}>
      Roll settings
    </MenuItem>
  );
  if (dockDice)
    entries.push(
      <MenuItem key="dock" icon={<IconDockRight />} onClick={dockDice.onToggle}>
        {dockDice.docked ? "Hide the dice log" : "Dock the dice log"}
      </MenuItem>
    );
  if (popOut)
    entries.push(
      <MenuItem key="pop" onClick={popOut.onToggle}>
        {popOut.floating ? "Put the sheet back" : "Pop out"}
      </MenuItem>
    );
  if (newTab)
    entries.push(
      <MenuItem key="tab" onClick={newTab}>
        Open in a new tab
      </MenuItem>
    );
  if (playedAtTable)
    entries.push(
      <MenuItem key="at-table" disabled={playedAtTable.blocked !== null} onClick={playedAtTable.onToggle}>
        {playedAtTable.on ? "Play on a player's device" : "Play at the table"}
      </MenuItem>
    );
  if (party)
    entries.push(
      <MenuItem key="party" onClick={party}>
        The rest of the party
      </MenuItem>
    );
  if (createCharacter)
    entries.push(
      <MenuItem key="create" icon={<IconPlus />} onClick={createCharacter}>
        Create a character
      </MenuItem>
    );
  if (release)
    entries.push(
      <MenuItem key="release" icon={<IconX />} tone="danger" onClick={release.onSelect}>
        Release {release.name}
      </MenuItem>
    );
  return (
    <Menu trigger={<IconMore />} icon align="end" label={`Sheet menu for ${name}`} triggerClassName="cs-menu-trigger">
      {entries}
    </Menu>
  );
}

/**
 * The roll settings, set once per device: whether this browser throws the dice or takes the faces typed from
 * physical ones, who sees the sheet's rolls, and in a fight where an attack tapped on the table's sheet is aimed.
 */
export function RollSettings({
  role,
  visibility,
  onVisibility,
  attackModeChoice,
  onClose
}: Readonly<{
  role: "gm" | "player";
  visibility: RollVisibility;
  onVisibility: (next: RollVisibility) => void;
  /** Offered only on the table's own sheet, which can send an attack to the Turn tab. */
  attackModeChoice: boolean;
  onClose: () => void;
}>) {
  const { rollInput, mayType, sheetAttackMode, setRollInput, setSheetAttackMode } = useRollPreference();
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Roll settings"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="cs-roll-settings">
        {mayType ? (
          <div className="cs-setting">
            <span className="cs-eyebrow">Dice</span>
            <SegmentedControl
              ariaLabel="Roll input mode"
              value={rollInput}
              onChange={(mode) => setRollInput(mode as "digital" | "manual")}
              options={[
                { value: "digital", label: "Digital" },
                { value: "manual", label: "Manual" }
              ]}
            />
            <p className="cs-sub">Manual asks for the number your own die shows. The server adds the bonus.</p>
          </div>
        ) : (
          <p className="cs-sub">This table throws every player's dice on the server.</p>
        )}
        <label className="cs-setting">
          <span className="cs-eyebrow">Who sees the roll</span>
          <Select value={visibility} onChange={(event) => onVisibility(event.target.value as RollVisibility)}>
            {VISIBILITY_OPTIONS[role].map((value) => (
              <option key={value} value={value}>
                {ROLL_VISIBILITY_WORD[value]}
              </option>
            ))}
          </Select>
        </label>
        {attackModeChoice && (
          <div className="cs-setting">
            <span className="cs-eyebrow">Attacks from the sheet in an encounter</span>
            <SegmentedControl
              ariaLabel="Where attacks tapped on the sheet resolve"
              value={sheetAttackMode}
              onChange={(mode) => setSheetAttackMode(mode as "jump" | "inline")}
              options={[
                { value: "inline", label: "On the sheet" },
                { value: "jump", label: "In the Turn tab" }
              ]}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

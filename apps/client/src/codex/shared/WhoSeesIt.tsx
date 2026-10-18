import { IconCheck, IconEye, IconEyeOff, IconUser, Menu, MenuItem, cx } from "@vtt/ui";
import { EVERYONE, HIDDEN, audienceLabel, toggleCharacter, type Audience, type PartyCharacter } from "./audience";
import "./shared.css";

function AudienceIcon({ value }: Readonly<{ value: Audience }>) {
  if (value.audience === "everyone") return <IconEye className="cx-aud-icon" />;
  if (value.audience === "hidden") return <IconEyeOff className="cx-aud-icon" />;
  return <IconUser className="cx-aud-icon" />;
}

/**
 * Who sees something, as a chip: Everyone with the eye, Hidden in violet with the crossed eye, or the chosen
 * characters by name in cyan. Read-only; `WhoSeesItMenu` is the control.
 */
export function AudienceChip({
  value,
  party,
  className
}: Readonly<{ value: Audience; party: readonly PartyCharacter[]; className?: string }>) {
  return (
    <span className={cx("cx-aud", `is-${value.audience}`, className)}>
      <AudienceIcon value={value} />
      {audienceLabel(value, party)}
    </span>
  );
}

/**
 * The Who sees it control for a block or an objective: Everyone, Hidden, or characters. Choosing a character adds
 * or removes it from the chosen ones; removing the last makes the thing Hidden again. Players never mount it.
 */
export function WhoSeesItMenu({
  value,
  party,
  onChange,
  what,
  disabled = false,
  className
}: Readonly<{
  value: Audience;
  party: readonly PartyCharacter[];
  onChange: (next: Audience) => void;
  /** What the control sets, for its accessible name: "Who sees The debt". */
  what: string;
  disabled?: boolean;
  className?: string;
}>) {
  const chosen = value.audience === "characters" ? value.characterIds : [];
  const pick = (next: Audience) => {
    if (disabled) return;
    if (next.audience === value.audience && next.characterIds.join() === value.characterIds.join()) return;
    onChange(next);
  };
  return (
    <Menu
      align="end"
      label={`Who sees ${what}: ${audienceLabel(value, party)}`}
      className={cx("cx-aud-menu", className)}
      triggerClassName={cx("cx-aud", `is-${value.audience}`)}
      trigger={
        <>
          <AudienceIcon value={value} />
          {audienceLabel(value, party)}
        </>
      }
    >
      <MenuItem
        role="menuitemradio"
        aria-checked={value.audience === "everyone"}
        icon={<IconEye />}
        onClick={() => pick(EVERYONE)}
      >
        Everyone
      </MenuItem>
      <MenuItem
        role="menuitemradio"
        aria-checked={value.audience === "hidden"}
        icon={<IconEyeOff />}
        className="cx-aud-item-hidden"
        onClick={() => pick(HIDDEN)}
      >
        Hidden
      </MenuItem>
      {party.map((character) => (
        <MenuItem
          key={character.id}
          role="menuitemcheckbox"
          aria-checked={chosen.includes(character.id)}
          icon={chosen.includes(character.id) ? <IconCheck /> : <IconUser />}
          onClick={() => pick(toggleCharacter(value, character.id))}
        >
          {character.name}
        </MenuItem>
      ))}
    </Menu>
  );
}

/**
 * A field's Who sees it: a switch that is on for Everyone and off for Hidden, with its word under it. The word sits
 * under the switch so the switch never moves when the word changes.
 */
export function FieldAudienceToggle({
  hidden,
  onChange,
  field,
  disabled = false
}: Readonly<{ hidden: boolean; onChange: (hidden: boolean) => void; field: string; disabled?: boolean }>) {
  return (
    <span className={cx("cx-fieldaud", hidden && "is-hidden")}>
      <button
        type="button"
        role="switch"
        aria-checked={!hidden}
        aria-label={`Who sees ${field}: ${hidden ? "Hidden" : "Everyone"}`}
        disabled={disabled}
        className={cx("nh-switch", !hidden && "nh-switch--on", "tap-target", "interactive")}
        onClick={() => onChange(!hidden)}
      >
        <span className="nh-switch-track" aria-hidden="true">
          <span className="nh-switch-thumb" />
        </span>
      </button>
      <span className="cx-fieldaud-word" aria-hidden="true">
        {hidden ? "Hidden" : "Everyone"}
      </span>
    </span>
  );
}

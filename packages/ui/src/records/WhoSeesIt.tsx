import { Menu, MenuItem } from "../primitives/Menu";
import { IconCheck, IconEye, IconEyeOff, IconUser } from "../primitives/icons";
import { cx } from "../primitives/util";
import {
  EVERYONE,
  HIDDEN,
  audienceLabel,
  revealedLabel,
  toggleCharacter,
  type Audience,
  type PartyCharacter
} from "./audience";
import "./WhoSeesIt.css";

function AudienceIcon({ value }: Readonly<{ value: Audience }>) {
  if (value.audience === "everyone") return <IconEye className="nh-aud-icon" />;
  if (value.audience === "hidden") return <IconEyeOff className="nh-aud-icon" />;
  return <IconUser className="nh-aud-icon" />;
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
    <span className={cx("nh-aud", `is-${value.audience}`, className)}>
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
      className={cx("nh-aud-menu", className)}
      triggerClassName={cx("nh-aud", `is-${value.audience}`)}
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
        className="nh-aud-item-hidden"
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
    <span className={cx("nh-fieldaud", hidden && "is-hidden")}>
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
      <span className="nh-fieldaud-word" aria-hidden="true">
        {hidden ? "Hidden" : "Everyone"}
      </span>
    </span>
  );
}

/**
 * Who sees a whole record, inline with its title: Hidden, Everyone or chosen characters as three segments, with the
 * word under them so the control stays put when the word changes. Characters opens the party to tick. A record that
 * cannot be shown yet (a draft) keeps the control at Hidden, with the reason under it.
 */
export function WhoSeesItSwitch({
  value,
  party,
  onChange,
  what,
  word,
  disabledReason = null,
  className
}: Readonly<{
  value: Audience;
  party: readonly PartyCharacter[];
  onChange: (next: Audience) => void;
  /** What the control sets, for its accessible name: "Who sees Brine Burst". */
  what: string;
  /** The word under the control; "Revealed to Lyra Emberwise" when the caller has none of its own. */
  word?: string;
  /** Why the control cannot change now; it is said under it in place of the word. */
  disabledReason?: string | null;
  className?: string;
}>) {
  const disabled = disabledReason !== null;
  const chosen = value.audience === "characters" ? value.characterIds : [];
  const segment = (audience: Audience["audience"]) =>
    cx("nh-whoswitch-option", "interactive", value.audience === audience && "is-on", `is-${audience}`);
  return (
    <div className={cx("nh-whoswitch", className)}>
      <div className="nh-whoswitch-track" role="group" aria-label={`Who sees ${what}`}>
        <button
          type="button"
          className={segment("hidden")}
          aria-pressed={value.audience === "hidden"}
          disabled={disabled}
          onClick={() => value.audience !== "hidden" && onChange(HIDDEN)}
        >
          <IconEyeOff className="nh-aud-icon" />
          Hidden
        </button>
        <button
          type="button"
          className={segment("everyone")}
          aria-pressed={value.audience === "everyone"}
          disabled={disabled}
          onClick={() => value.audience !== "everyone" && onChange(EVERYONE)}
        >
          <IconEye className="nh-aud-icon" />
          Everyone
        </button>
        {disabled || party.length === 0 ? (
          <button type="button" className={segment("characters")} disabled aria-pressed={false}>
            <IconUser className="nh-aud-icon" />
            Characters
          </button>
        ) : (
          <Menu
            align="end"
            label={`Who sees ${what}: choose characters`}
            className="nh-whoswitch-menu"
            triggerClassName={segment("characters")}
            hideCaret
            trigger={
              <>
                <IconUser className="nh-aud-icon" />
                Characters
              </>
            }
          >
            {party.map((character) => (
              <MenuItem
                key={character.id}
                role="menuitemcheckbox"
                aria-checked={chosen.includes(character.id)}
                icon={chosen.includes(character.id) ? <IconCheck /> : <IconUser />}
                onClick={() => onChange(toggleCharacter(value, character.id))}
              >
                {character.name}
              </MenuItem>
            ))}
          </Menu>
        )}
      </div>
      <span className={cx("nh-whoswitch-word", disabled && "is-reason")} role="status">
        {disabledReason ?? word ?? revealedLabel(value, party)}
      </span>
    </div>
  );
}

import { Combobox } from "@vtt/ui";
import { DAMAGE_TYPE_OPTIONS } from "./manual-damage";

/**
 * THE damage-type chooser beside a hand-entered number, in one component so the GM's three entry
 * doors ask the same question the same way (register D7's client half).
 *
 * **A chooser, not a `<select>`, and not a bare box.** The damage vocabulary is OPEN — the server
 * calls the SRD thirteen "a suggestion list, never a gate" so a homebrew type can match a homebrew
 * defence — and a closed control over an open slug is its own defect. A bare text box is the opposite
 * failure: it asks a GM mid-fight to spell "bludgeoning" from memory, which is how `Rarity` read
 * before `FieldRenderer` put this same `Combobox` + `allowFreeText` pair on it. Empty IS the value
 * here: no chip means untyped, which is the fast path this feature must not disturb.
 *
 * **Its own row, deliberately.** All three hosts are dense flex rows already carrying a narrow number
 * field and two to five buttons, and a fourth inline control breaks every one of them at 375px. It
 * sits below them at `flex-basis: 100%` instead, which also gives the listbox the full width of its
 * host — `.nh-combobox-list` is `inset-inline: 0`, so squeezed into a 4rem column it would open a
 * 4rem-wide list of thirteen ellipsised words.
 */
export function DamageTypeField({ value, disabled, onChange }: Readonly<{
  value: string | null;
  disabled?: boolean;
  onChange: (next: string | null) => void;
}>) {
  return <Combobox
    className="damage-type-field"
    ariaLabel="Damage type"
    /* "Untyped" is the placeholder rather than a fourteenth row: it is the ABSENT value, and offering
       it as an option would invite a GM to pick a word the maths then has to special-case back out.
       `manualDamageType` still recognises it typed by hand, because a GM who types what the box says
       must not get a typed part nothing can resist. */
    placeholder="Untyped"
    options={DAMAGE_TYPE_OPTIONS}
    value={value}
    disabled={disabled}
    /* The WHOLE list, not `Combobox`'s default page of 8. Thirteen is a complete bounded vocabulary,
       and paging it would hide five of the thirteen behind a search a GM has no reason to expect —
       the exact defect `FieldRenderer` cites for its own damage-type rows. */
    limit={DAMAGE_TYPE_OPTIONS.length}
    allowFreeText
    onChange={onChange}
  />;
}

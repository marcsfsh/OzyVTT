import { Combobox } from "@vtt/ui";
import { DAMAGE_TYPE_OPTIONS } from "./manual-damage";

/**
 * The damage-type chooser beside a hand-entered number, shared by the GM's three damage entry
 * points. A `Combobox` with free text, because the vocabulary is open (homebrew types can match
 * homebrew defences) but nobody should have to spell "bludgeoning" from memory. Empty means
 * untyped, the fast path.
 *
 * On its own row (`flex-basis: 100%`): the hosts are dense rows that break at 375px with another
 * inline control, and `.nh-combobox-list` is `inset-inline: 0`, so the list gets the host's width.
 */
export function DamageTypeField({
  value,
  disabled,
  onChange
}: Readonly<{
  value: string | null;
  disabled?: boolean;
  onChange: (next: string | null) => void;
}>) {
  return (
    <div className="damage-type-field">
      {/* The visible twin of the field's accessible name: "Untyped" alone did not say what the field is for. */}
      <span className="damage-type-label" aria-hidden="true">
        Damage type
      </span>
      <Combobox
        className="damage-type-box"
        ariaLabel="Damage type"
        /* "Untyped" is the placeholder and no option: it is the absent value. `manualDamageType` still
         treats a hand-typed "untyped" as no type. */
        placeholder="Untyped"
        options={DAMAGE_TYPE_OPTIONS}
        value={value}
        disabled={disabled}
        /* The whole list where `Combobox` would show a page of 8: thirteen types is a complete,
         bounded vocabulary. */
        limit={DAMAGE_TYPE_OPTIONS.length}
        allowFreeText
        onChange={onChange}
      />
    </div>
  );
}

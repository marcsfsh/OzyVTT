# Character sheet — v6 UX feedback & fixes

Round-6 GM feedback after v5. "Looks better." Durable checklist. _Captured 2026-07-23; branch
`claude/character-sheet-discovery-a14i7f` (PR #45)._

## Items
1. The **prepare/prepared** tag and the **Always** tag look the same — the "Always" label needs its own
   visual treatment. — ✅ "Always" is now a violet-filled tag, distinct from the cyan toggleable
   "Prepared"; cantrip is dashed/dim. Render-verified.
2. Spell **names are centred**; they should be **left-justified** like the equipment list (prep status
   stays to the **left** of the name). — ✅ `justify-self: start` on `.sheet-spell-name` (a parent's
   inherited `text-align:center` was only visible once the name column got wide in the docked sheet).
3. The **spell-slot bubbles** (e.g. 3rd level 3/3) look **clunky / MS-paint** — restyle. — ✅ clean cyan
   capsule "charges" (filled = available, hollow = spent) with a subtle glow. Render-verified.
4. **Dice rolling area:**
   1. The roll readout is **scattered** — to read a result you look left (faces), above-right (the `+9`
      modifier next to `1d20`), then far-right (total); and the **attack/save type isn't shown**. Group
      it coherently and label the roll's purpose/type. — ✅ each roll now leads with a color-coded **type
      badge** (`DEX SAVE`, `ATHLETICS CHECK`, `GREATAXE TO HIT`, `FIREBALL AT 3RD`), roller/audience is a
      muted footer, and faces · formula = total read as one line. Added an optional `label` to the roll
      record threaded from the sheet, the save flow ("DEX save"), and action resolution (weapon name).
      Render-verified.
   2. Several **× buttons aren't centred** within their button. — ✅ the `×` (U+00D7) glyph renders
      upper-left; standardized on `✕` (U+2715) with fixed-size grid centering across the sheet/save-prompt/
      viewer close buttons. Render-verified.
5. **Equipment should have mechanical effect:** equip a greataxe → a **greataxe action** appears; equip
   armor → its **AC applies**. — ✅ (GM chose the full server version.) The SRD catalog already carries
   weapon `{damageDice,damageType,range}` + armor `{acBase,addDexModifier,dexModifierCap}`; the inventory
   item now stores those (additive-optional schema + JSON mirror + api-contract). **Armor → AC** is
   server-derived and authoritative: `armorClassFromEquipment()` in rules-5e (acBase + Dex, capped for
   medium / none for heavy, + shield), applied in `instantiate` and on every `set-inventory` (reverts to
   the stored stat-block AC when nothing is equipped, so imports are unaffected). **Weapon → action**:
   equipped weapons render as rollable attack actions on the sheet (to-hit = ability+PB, damage = die+mod;
   Dex for ranged, Str for melee — finesse/versatile aren't vendored, so those approximate). Tested
   (rules-5e AC cases + an equip→AC→unequip integration test) and render-verified. This ships a slice of
   what ADR-0021 had parked as builder work; see the ADR note.
6. **Proficiencies editor** is awkward: skills + buttons placed by text position, requires scrolling, bad
   layout. **"Save proficiencies" doesn't work**; a **"Done" button** next to Save is semantically
   confusing **and also doesn't work**. — ✅ Root cause of "Save doesn't work": the save *persisted fine*,
   but the GM's sheet renders from a module-level definition cache that nothing refreshed after an edit,
   so no change showed; "Done" separately *discarded* the draft. Fixed: proficiency edits now **auto-save
   on each toggle** (like slots/prepare/equip) AND sync the GM cache so the change shows at once; removed
   the redundant "Save proficiencies" button so **"Done" just closes** (no more discard trap, no Save/Done
   confusion). Same cache-sync applied to the identity editor. Layout: editor rows are a uniform
   name-fills + right-pinned-toggle grid (toggles align in a column regardless of name length), 2 columns,
   no clipped inner scroll. Render-verified.
7. **Standalone sheet vs "My Sheet" (map) diverge** — the embedded My-Sheet view is BETTER: slot icons
   look less bad, Always/Prepare/Prepared are consistent, spell labels left-aligned. Same component →
   a CSS divergence to reconcile (fixing it likely resolves #1/#2/#3 for the standalone). — ✅ resolved by
   #1/#2/#3: the divergence was width-driven (the wide docked sheet exposed the centred names + spread
   pips the narrow embedded hid). The fixes are global, so both views now match.
8. **Upcast cast bug:** upcasting a damage spell shows the new (upcast) damage in the list, but clicking
   **Cast rolled the NON-upcast** damage in the dice log. — ✅ real bug for **target-scaling** spells
   (Magic Missile / Scorching Ray): the `×N` was only a label, never multiplied into the rolled formula,
   so the cast rolled a single instance. Now one `spellEffectAt()` helper feeds BOTH the displayed effect
   and the rolled formula (repeating the die `targetCount` times), so display == rolled, always.

## Notes
- #7 is the key clue: reconcile the standalone/docked sheet CSS with the embedded one (embedded is right).
- #5 is the one genuinely larger feature (weapon→action, armor→AC derivation).
- #8: the display helper computes upcast damage but the cast path rolls base — trace castSpell vs the
  displayed effect.

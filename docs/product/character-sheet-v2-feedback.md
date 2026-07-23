# Character sheet — v2 playtest feedback & decisions

Durable record of the GM's feedback after importing the first full sample character
(Seraphina, L10 cleric) and testing the sheet. Kept here so nothing is lost as the working
session grows. Update the **Status** column as each item lands. Tasks tracked as #6–#10.

_Captured: 2026-07-23. Branch: `claude/character-sheet-discovery-a14i7f` (PR #45)._

## Decisions (from the GM)

- **Equipment framework (#7):** go **full** — a structured item content model, **vendor the SRD
  equipment catalog** (adventuring gear / tools / packs; weapons + armor already vendored), and a
  **browse-&-add-from-catalog** picker. This is the framework the future **homebrew** update builds on.
- **Upcasting (#2):** **reference the vendored SRD spells** (339 spells already carry upcasting data —
  `castingOptions`/`higherLevel`). Link each character spell to that content by id and auto-scale.
- **Sequence:** do the **equipment framework next**, then the rest in a sensible order.

## Feedback items (verbatim intent)

1. **Spells grouped by spell level.** — ✅ Wave 1.
2. **Upcasting / "Cast at" picker.** Each spell gets a "cast at" control: a dropdown of slot levels;
   each level shows **total** slots for that level and clearly distinguishes **remaining**; can't cast a
   level with no slots left.
   1. Upcasting a spell that **has** upcast effects should **auto-apply** those effects. (Non-upcastable
      spells cast at base only.) — **Decision: reference vendored SRD spell data.**
3. **Editing proficiencies doesn't work**, and the skill name is **too far** from the skill bonus (hard
   to read).
   1. The **spell list** has the same name↔value spacing problem.
   2. The **equipment list** has it **too**, AND shares the wonky-buttons problem (item 5).
   — ✅ Wave 1 (edit bug fixed; name↔value tightened across skills/spells/inventory).
4. **ALL skills listed**, proficient ones with a special indicator. The proficiencies editor wasn't
   working (add a proficiency + Save → nothing happened). — ✅ Wave 1 (all 18 skills + dots; save bug fixed).
5. **Spell-slot ±  buttons look wonky** — cleaner implementation. — ✅ Wave 1 (clickable pips).
6. **Roll button for each stat**, plus a **"roll with proficiency"** button — supports the GM calling for
   an unnamed/custom check and deciding whether the PC is proficient. — ✅ Wave 1 (check + "+P" per ability).
7. **Robust SRD equipment framework.** Equipment adding is rudimentary. Support the future **homebrew**
   roadmap item: **all SRD equipment available to add**, which means building the **framework for how
   equipment exists** so homebrew can later reference it. — **Decision: full catalog + vendor SRD gear.**
   — ✅ done. Unified `EquipmentReference` content model + a 132-entry hand-authored SRD gear bundle
   (ammunition / adventuring gear / tools / packs / focuses / consumables) folded together with the
   existing weapon & armor tables into one 183-item catalog (`loadEquipment`); served over a new
   `content:equipment` socket read (public reference, like `content:spells`); `InventoryItem` additively
   gains a `category` slug; the sheet's Inventory gains a searchable, category-filtered browse-and-add
   picker (upsert-aware, mobile full-screen). The `wondrous` category is reserved for the homebrew update.
8. **Manual roll entry** everywhere "click to roll" exists, PLUS a **sheet setting** controlling whether a
   typed roll **auto-applies the bonus** (you enter only the die result) or is **manual** (you enter the
   final total including your bonus — e.g. a 15 + 7 bonus → you type 22).
9. **Dice-roll log placement.** The in-sheet roll log is at the **bottom** (bad — rolling an ability at the
   top means scrolling to the bottom to see the result). Redesign:
   1. **Expand** the sheet panel height and (a bit of) width, and add a **player-specific dice-log panel**
      to the **right** of the sheet.
   2. The dice panel has **docking buttons** (like the GM initiative panel) controlling whether it sits
      **left or right** of the sheet.
   3. The sheet + dice-log are two **subpanels of one main panel**; that panel needs a **popout** button →
      a **moveable in-tab panel** (like the GM's "preview what players see"), and **another** button →
      a **separate browser tab** entirely (like the viewer preview).

## Status

| # | Item | Status | Task |
|---|---|---|---|
| 1 | Spells grouped by level | ✅ done (Wave 1) | #6 |
| 3 | Edit-proficiency bug + name↔value readability | ✅ done (Wave 1) | #6 |
| 4 | All skills listed + proficiency indicator + editor works | ✅ done (Wave 1) | #6 |
| 5 | Spell slots as pips (not wonky ±) | ✅ done (Wave 1) | #6 |
| 6 | Per-stat roll + roll-with-proficiency | ✅ done (Wave 1) | #6 |
| 7 | **Equipment framework (full catalog + vendor SRD gear)** | ✅ done | #9 |
| 2 | Upcasting cast-at (reference vendored SRD spells) | ▶ **next** | #7 |
| 8 | Manual roll entry + auto/manual bonus mode | ⏳ pending | #8 |
| 9 | Panel redesign: sheet + player dice-log, docking, popout | ⏳ pending | #10 |

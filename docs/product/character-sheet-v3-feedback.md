# Character sheet — v3 UX feedback & fixes

Round-3 GM feedback after the v2 workspace/redesign landed (screenshots of Seraphina, L10 cleric).
Durable checklist so nothing is lost as the session grows. Update **Status** as each lands.

_Captured: 2026-07-23. Branch: `claude/character-sheet-discovery-a14i7f` (PR #45)._

## Items (verbatim intent) + status

**1. Width.**
- 1.0 The sheet window needs to be **wider when docked**. — ⏳
- 1.1 The **dice-log panel width** (within the sheet) must be **adjustable** (drag divider). — ⏳

**2. Layout cleanup.**
- 2.1 The **× close** goes **top-right**; **Pop out** + **New tab** sit **to its left**. — ⏳
- 2.2 The **dice-log side (◧/◨) buttons** are **too big**; shrink them and move them **right** into the space the popout/newtab vacate. — ⏳
- 2.3 **HP / AC / Initiative / Speed boxes** are **too big**, with awkwardly placed/sized label + value text. — ⏳
- 2.4 The **Dmg / Heal / Temp** buttons + number entry are awkward — **regroup with HP**, simplified. — ⏳
- 2.5 The **"+ Add"** (condition add) is poorly placed/labeled; add a **"Conditions"** section label. — ⏳
- 2.6 The **Rolls** settings (Digital/Manual) are great but mis-located; move to a **narrow fixed top bar, always visible while scrolling**. — ⏳
- 2.7 **Skills:**
  - 2.7.1 Too **compact**. — ⏳
  - 2.7.2 Sort **top→bottom then left→right** (col1 A,B,C,D; col2 E,F,G,H) — not across-then-down. — ⏳
  - 2.7.3 Proficiency/expertise dots → **larger bubbles with a letter inside** (P / E) for accessibility. — ⏳
  - 2.7.4 **Saving throws are too small**. — ⏳
- 2.8 **Spells:**
  - 2.8.1 **Cast button** not vertically aligned with the level dropdown; size mismatch. — ⏳
  - 2.8.2 Clicking a **spell name opens its rules** popup (like the GM's spell list). — ⏳
  - 2.8.3 Damage-die helper: **always show** the die for damaging spells (updates on upcast); the bare **"2×"** for target-scaling spells is unclear — label it. — ⏳
    - 2.8.3.1 The **dropdown label text isn't centered**. — ⏳
  - 2.8.4 Add **subtle divider lines** between spell-level groups (a different style than the current lines). — ⏳
  - 2.8.5 The **caster-type line** (WIS caster · Save DC 17 · +9) — make it **more prominent with proper fields**. — ⏳
- 2.9 **Inventory:**
  - 2.9.1 The **Browse SRD** picker margins are too thin (content against the edges). — ⏳
    - 2.9.1.1 Its **× is not top-right** (a cross-app Modal styling issue — seen twice). — ⏳
    - 2.9.1.2 Move the **whole Browse-SRD-gear row above** the item list. — ⏳
  - 2.9.2 Quantity **−/+** and **×** buttons are wonky — polish + even spacing; add **column header labels**. — ⏳
  - 2.9.3 **Actions** area should be **grouped**: weapon actions, then spell actions (spell actions grouped by level). — ⏳

**3. Dice panel.** Clean up the whole dice-rolling panel (spacing, placement, intuitive layout) **and** add a filter: **whole table's rolls vs just yours**. — ⏳

**4. Identity prominence.** Character **level / class / race** must be **more prominent** — currently reads like a footnote above the header. — ⏳

## Decisions taken while implementing (no blocker warranted asking)
- 2.4: keep HP number-entry + Dmg/Heal/Temp as one compact HP control grouped under the HP box.
- 3 (roll filter): "just yours" = rolls tied to this sheet's character (`actorId === actor.id`); "all" = the table.
- 2.1/2.9.1.1 (× top-right): the sheet stops using the Modal's own header and renders one unified header row (title left; ◧◨ · Pop out · New tab · × right), which also fixes the picker by widening its Modal padding.

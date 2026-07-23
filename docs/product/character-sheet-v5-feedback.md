# Character sheet — v5 UX feedback & fixes

Round-5 GM feedback after v4. Durable checklist. _Captured 2026-07-23; branch
`claude/character-sheet-discovery-a14i7f` (PR #45)._

## Items
1. Spells without damage dice show a **strange artifact** (empty helper cell). — ✅ `.sheet-cast-effect:empty`
   drops the violet chip; the helper span is empty (not `.empty`-classed) when there's no die.
2. The damage-die label, level dropdown, and CAST button are **still non-uniform** (dropdown not on the
   dice/CAST centre line; different shapes/gaps). — ✅ flattened the old nested `.sheet-cast` grid into the
   row grid: helper/slot/Cast are three fixed columns (`3.4rem 6.6rem 3.6rem`), each 1.75rem tall and
   stretched, so all three align across every row.
3. **Browse SRD** window: margins **still too thin**, **× still not top-right** — "consistently not in the
   top-right corner." — ✅ **root cause:** nested modals (picker, spell card) render inside the sheet's
   `.character-sheet` dialog, so `.character-sheet .nh-modal-*` **descendant** selectors leaked into them
   (zeroed padding). Scoped those to direct children (`>`) + pinned the Modal × absolutely to the surface
   corner (works whether or not the modal has a header).
4. GM Character Roster should be a **gallery grid**, like the Scenes tab. — ✅ PartyRosterTab now renders
   the shared `.nh-gallery`/`.nh-card` grid (monogram thumb + claimed/HP/AC meta + View sheet / Archive),
   active and archived in their own grids.
5. Players need **short rest / long rest** from the character sheet. — ✅ a Rest block on the sheet (Hit-Dice
   spend + Short/Long rest); server `actor.rest` is now owner-or-GM (was GM-only) via `canInitiateForActor`.
6. GM roster issues:
   1. "Characters & claims" collapsed panel: rename to **Character Roster**, remove the **Show roster**
      button; the disclosure arrow toggles it. — ✅ the disclosure summary reads "Character Roster"; the
      inner minimize button + `collapsed` state are gone — the `<details>` arrow is the only toggle.
   2. The GM's roster area still shows **all** characters incl. archived — should show **active only**. — ✅
      ActorRoster filters archived PCs (already stripped for players); the GM manages archived ones on the
      Character Roster tab.
7. The **"You're playing…" bar** should **always** show, **outside** the roster (below the roster panel,
   above the dice/combat panels). Its **conditions "add" button needs a Conditions label**. — ✅ extracted a
   `YouArePlaying` bar rendered in the app shell (below the roster disclosure, above dice/combat); the
   conditions control now carries a "Conditions" label.
8. HP / AC / INIT / SPEED fields: **wonky text placement + label box sizing** — center labels within the
   border, remove dead space. — ✅ unified stat chips: centred label above centred value, thin border,
   tight padding; HP is the same chip widened for its controls.
9. **Cantrips need cast buttons** (some, e.g. Toll the Dead, deal damage). — ✅ cantrip rows now render the
   same cast controls (helper + "At will" tag + Cast); casting a damaging cantrip rolls its die, a utility
   cantrip just notes the cast. No slot spent.

## Notes
- #3 root cause + fix is the key one (recurring). Direct-child selectors + absolute-corner Modal ×.
- #6.2: the GM roster grid (ActorRoster) must filter archived like the player view does.

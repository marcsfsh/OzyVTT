> ## ⚠ ARCHIVED — 2026-08-01
>
> **What this is:** Round-4 GM playtest feedback on the character sheet, with the decisions it produced.
> **Current through:** 2026-07-24  (last commit that kept it true: `1e158de`)
> **Superseded by:** nothing; the round closed. Later rounds are `character-sheet-v5..v6-feedback.md`.
> **Read this for:** what the GM actually asked for, and which items reached beyond the sheet into app IA and the wire contract.
> **Do not read this for:** outstanding work. Its "Update **Status**" instruction is spent — do not act on it.
> **Paths, line numbers and counts inside this file are as of the date above and are not maintained.**

# Character sheet — v4 UX feedback & fixes

Round-4 GM feedback after v3 landed (Seraphina screenshots). Durable checklist. Update **Status**.
Some items reach beyond the sheet into app IA (GM tabs, roster, map-as-player) and the wire contract.

_Captured: 2026-07-23. Branch: `claude/character-sheet-discovery-a14i7f` (PR #45)._

**Status: all 10 items landed.** Commits: sheet-polish batch (#1,2,4,5,6,7), "Just me and the GM" +
own-character header (#3,#9), player map sheet/initiative toggle (#8), GM Character Roster tab +
archiving (#10). `check` + `build` green; server suite 421 tests. Live browser click-through still
pending (no e2e harness here). Note on #10: the Viewer tab was kept (it drives the shared screen),
placed after Character Roster in the reordered tab bar.

## Items

1. **Dmg / Heal / Temp buttons are far too wide.** — ⏳
2. **Sheet width:** the new width is good — make it a **little wider** and **adjustable** (drag the panel edge). — ⏳
3. **Dice "Who sees it?"** needs a **"Just me and the GM"** option (roller + GM see it; other players don't). — ⏳ (wire: new roll visibility + projection)
4. **Caster / Save DC / Spell Atk fields:** (1) center the values; (2) add a **border** around each field. — ⏳
5. **Spell list:**
   1. Right-hand controls (helper chip / dropdown / CAST) are **mismatched** in placement/size/shape across rows, and the left prep icon is mismatched relative to them — **align them into a consistent grid**. — ⏳
   2. Spell titles get a **dashed underline** (click affordance). The spell **rules popup** is cramped at the margins (text/buttons against the edge) and its **× is mis-placed**. — ⏳
      1. Same cramped margins as the **Browse SRD gear** window — still a bug. — ⏳
6. **Row alignment in long lists:** in inventory (and spells) it's hard to tell which right-hand button row lines up with which left item — add a **subtle grid / zebra** to keep rows visually connected. — ⏳
7. **Pop out / New tab** buttons should **match the shape/style** of the dice-log dock buttons. — ⏳
8. **Player map view:** the initiative area needs a **toggle between the initiative order and the player's character sheet** (this embedded sheet has **no** dice log, otherwise identical). — ⏳
9. **Own character out of the roster:** the player's claimed character must **not** appear under "Choose your place at the table" — it always shows in **its own header at the top**, even when the roster is minimized. — ⏳
10. **GM party roster:** add a **Character Roster** GM tab (peer of Scenes/Encounter/Viewer/Replays/VTT Setup). Reorder tabs to **Encounter | Scenes | Character Roster | Replays | VTT Setup**. The tab lists all characters; the GM can **archive** one. Archived characters are **hidden from players** and **excluded from the encounter builder / party**. — ⏳ (server: archived flag + projection + encounter-builder filter; viewer-safe)

## Notes / decisions
- #2: add a drag handle on the docked modal's edge → a persisted `sheetWidth` CSS var (clamped); the popout already resizes.
- #3: add a `RollVisibility` value (roller + GM); project it so only the roller and GM receive it (viewer never).
- #10: "archive" = a definition/actor flag; `projectPlayerView` omits archived PCs and the encounter builder filters them; GM-only, viewer-safe.

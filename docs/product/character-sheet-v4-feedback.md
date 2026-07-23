# Character sheet — v4 UX feedback & fixes

Round-4 GM feedback after v3 landed (Seraphina screenshots). Durable checklist. Update **Status**.
Some items reach beyond the sheet into app IA (GM tabs, roster, map-as-player) and the wire contract.

_Captured: 2026-07-23. Branch: `claude/character-sheet-discovery-a14i7f` (PR #45)._

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

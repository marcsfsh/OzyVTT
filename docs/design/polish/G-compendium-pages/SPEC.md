# G The Compendium's pages

Approved by the owner on 2026-10-30 after one round of mockups. Sources and export (G4), the Sharing page (G5), and a
record's history, merging and sharing (G6) in `../CATALOG.md`. They sit inside the Compendium's frame
(`../G-compendium/SPEC.md`: the Titled bar, three panes with the open records as tabs, the studio) and inherit the theme
(`../T-theme/SPEC.md`), the frame (`../A-frame/SPEC.md`), the folders at the side (`../E2-maps-tokens/SPEC.md` 2.1), and
the Codex's version history and revealing in the side column (`../F-finding-pages/SPEC.md` 2.4 and 2.5). `PLAN.md`
beside this file is the work to build it; `compendium-pages.html` is the approved mockup, and `history/` holds the round
as it was shown.

The consistency sweep (`../T-consistency/SPEC.md`, ADR-0072) gave a dialog on a phone its handle above its title and
close (T rule 16).

The second sweep (`../T-consistency/SPEC.md` section 5, ADR-0073) put a homebrew record's phone header as ‹ MONSTERS
with no strip, stepped Publish down while sharing's own Cup shows, and made Sharing's count plain words.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) wrote a record's history as "Oct 29, 2:08 PM" and
"Today, 2:20 PM" (T rule 20), made Cancel and Back ghosts and Clear and Clear all Base line buttons, drew table rows at
48 px, and gave an empty kind its New homebrew button.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) drew the empty spell lists' New homebrew at 36 px (T
2.5), the stat block note and the version band as the one notice (T rule 21), a record's sharing options at 44 px on a
phone (T rule 8), and its sheets' titles at 20 px (T 2.2).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew the stat block without its name inside its record,
the dialogs' close as the one close, a plain 18 px icon in 40 px, 44 px on a phone (T 2.2), the sharing icons at 15 px
(T 2.5), every tag in a 22 px box (T rule 7) and a record's title at 22 px, 20 px on a phone (T 2.2), and gave Dawn's
amber, magenta and violet words their text shades (T rule 9).

## 1. What it covers

| Id  | Surface                     | Decided here                                          |
| --- | --------------------------- | ----------------------------------------------------- |
| G4  | Sources and export          | Sources at the side (2.1)                             |
| G5  | Sharing                     | Kinds at the side (2.2)                               |
| G6  | A record's history          | Compact rows in the side column, as the Codex's (2.3) |
| G6  | When two devices changed it | A's dialog (2.4)                                      |
| G6  | A record's sharing          | In the side column (2.5)                              |
| G7  | The other kinds' editors    | Rule 3.3                                              |
| G9  | Search the SRD and homebrew | Rule 3.1                                              |
| G11 | The catalog picker          | Rule 3.2                                              |

## 2. The decisions

### 2.1 Sources sit at the side

- At the left (260 px), SOURCES: SRD 5.2.1, This table and each imported pack, each a row with its icon, its name and
  its record count in VT323, the chosen one lit as a chosen row; under them Import a pack.
- At the right, the chosen source:
  - Its name in Chakra Petch capitals, Export a selection and More (Rename and Credit, today's pack fields).
  - One line: where it came from and its counts ("Made here · 4 records, 2 published, 2 shared"; "From Garrett ·
    imported Oct 20 · 38 records"; the SRD's "Read only. Make a homebrew copy of anything.").
  - In pickers as a switch with its line ("In pickers: homebrew fields and the encounter builder offer these records").
    The SRD reads "Always in pickers".
  - BY KIND: a row per kind with Records, Drafts and Shared in VT323.
  - NEEDS YOU: the source's own rows from today's Needs you, each with its state and Open.
- Import a pack's review and Export a selection open as A's dialog, as today's do (rule 3.4).
- On a phone: the sources as chips with their counts, the chosen source's line, In pickers, the kinds, then Export a
  selection and Import a pack.

### 2.2 Sharing puts the kinds at the side

- At the left (240 px), KINDS: All homebrew and each kind with its count; then WHO SEES IT: Shared and Hidden with their
  counts. Both narrow the rows.
- At the right, the published records as rows: the kind's icon, the name, its kind and line ("Item · wondrous"), and Who
  sees it as a Base line control (Hidden, Everyone, Characters). Hidden reads violet (F rule 2).
- Characters opens A's menu at the control with a box for each character and when it reached them; the row's line then
  names who ("Item · wondrous · Lyra Emberwise").
- Choose in the toolbar ticks rows to set them together, as today's Tick records to set them together does.
- On a phone: the kinds as chips, each record with the control under its name.

### 2.3 A record's history is compact rows in the side column

- The History tab keeps the record's card and opens VERSIONS · {N} in a side column (300 px), F2's version history: one
  compact row a version, its number in VT323, when, and what changed; the newest reads Now.
- Choosing a version shows the record as it was under a cyan band: "Reading v2 · today 2:20 PM", Restore this version,
  Back to now. The band's More holds Compare with now (today's two-version comparison, field by field). Restore puts
  that version back as the editor's copy, which reaches players only with Update, as today.
- Under the versions: Based on {the record it was made from} with the number of differences and Compare, which shows
  today's comparison under the band ("Comparing with Goblin Boss, SRD 5.2.1"), with Open the SRD record.
- On a phone: the versions as rows under the record's tabs; choosing one opens it under the row with what changed and
  Restore this version.

### 2.4 When two devices changed a record, A's dialog asks

- When a save finds that another device saved first, A's dialog opens over the record: "Changed on two devices", then
  today's line ("Another device saved at 2:31 PM while this one was editing. Both changed HP and Grey Palm.").
- Each field both changed is a row: its name, then This device and The other device as two choices, this device's chosen
  first.
- Keep what is ticked is the Cup; Keep both changes keeps every field only one device changed and this device's value
  where both did, as today.
- When the other device changed nothing this one did, the dialog says so in today's words and offers Keep both changes.
- Closing the dialog leaves the conflict open: the record shows the amber line "Changed on two devices" with Choose,
  which opens the dialog again.
- On a phone the dialog rises from the foot, each field's two choices stacked.

### 2.5 A record's sharing opens in the side column

- The Sharing tab keeps the record's card and opens SHARE in the side column (320 px), as revealing does in the Codex
  (F2 2.4): Back at its head, then Everyone and each character as boxes (none ticked is Hidden), each with when it
  reached them on a published record.
- WHAT THEY WILL READ: the record as players get it (name, size and type, the first line of its description); for a
  monster, the line that players never get its stat block.
- The Cup reads what it will do: "Share with Lyra", "Share with everyone" or "Hide it". On a draft it sits under
  "Publish it before you share it." (G rule 3.4) and reads "Publish and share with Lyra": it publishes, then sets who
  sees it. A deleted record shows "Restore it before you share it." in place of the Cup.
- Where players meet it and Not sent to keep today's lines under the boxes.
- On a phone the Sharing tab shows the same parts as its body, Back returning to the card.

## 3. Rules for the Compendium's pages

1. Search is A's dialog. Ctrl K and Search the SRD and homebrew open A's search dialog looking in the Compendium (A
   2.3), as the Codex's does (F2 rule 1).
2. Picking a record is search. A homebrew field that links a record (the catalog picker, G11) opens A's search dialog in
   the Compendium, offering only that kind.
3. Every kind edits in the studio. Spells, items, feats and the other kinds take the studio's frame (G 2.4): each step's
   answer in its rail.
4. Import and export are A's dialog. Import a pack's review (what it adds, what clashes) and Export a selection open as
   A's dialog.
5. Stat blocks stay with the GM. Sharing a monster shares its name, look and description; players never get its stat
   block.
6. Hidden reads one way (F rule 2): violet with a dashed edge and an eye struck through.
7. Nothing new in what the controls do. Every import, export, publish, share, restore and merge keeps today's routes and
   words; Publish and share is today's two calls in turn.
8. Phones: side lists become chips, side columns become the tab's body, dialogs rise from the foot; 44 px hit areas.

## 4. Values

| Part             | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| Side lists       | Sources 260 px, kinds 240 px; rows 38 px; counts VT323 16 px |
| A source's name  | 22 px Chakra Petch capitals                                  |
| Sharing rows     | At least 52 px; the control's segments 32 px (44 px touch)   |
| Side columns     | Versions 300 px; Share 320 px                                |
| Version rows     | 40 px; the number VT323 17 px                                |
| The merge dialog | A's wide dialog; each choice at least 44 px                  |

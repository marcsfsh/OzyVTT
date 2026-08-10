# Area 4 (Codex) — re-verification against HEAD

**Date:** 2026-08-08 · **Branch:** `claude/feature-implementations-intake-c5eyu1` · **HEAD:** `7dd7729`
**Scope:** `5a`, `5a.1`, `5b`, `5c`, `5d`, `5e.1`–`5e.4`, `5f`. Re-checks
`docs/product/feature-implementations-plan.md` → "Area 4 — Codex" (and decision **D6**) against the
95 commits since `c2f3b6b`.

This is a delta, not a re-plan. **Six units are unchanged. Four moved. Two defects are new.**

---

## 0. The headline: no codex code changed

```
git log --oneline c2f3b6b..HEAD -- apps/client/src/codex/           → empty
git log --oneline c2f3b6b..HEAD -- apps/server/src/codex-store.ts \
                                   apps/server/src/codex-projections.ts → empty
git log --oneline c2f3b6b..HEAD -- packages/ui/src/primitives/forms.css → empty
```

Areas 1–3 touched **nothing** in codex territory. Every line number the plan cites *inside* codex is
therefore still live, and I re-checked the load-bearing ones individually (§2, §3). What moved is
strictly *around* the Codex: the shared primitives it composes from, the browser audits, and the ledger.
All three moved in Area 4's favour.

---

## 1. What moved

### 1.1 `5a` shrinks from M to S — `TagInput` is already the multi-picker

The plan says "Nothing like it exists — `Combobox` has flat options, no groups, `limit = 8`," and
specifies a new `CharacterPicker`. That is now wrong for the `5a` call site.

**"Who played" is a `TagInput`, not a `Combobox`** (`apps/client/src/codex/SessionsView.tsx:236-244`).
And `packages/ui/src/primitives/TagInput.tsx` gained everything `5a` asked for today:

- `suggestions` + `pick` — swaps the entry box for a visible `Combobox` chooser over the same list;
- `limit={Math.max(offered.length, 1)}` — **it already defeats the 8-cap**, and its own comment names
  the exact bug ("the default page of 8 would reintroduce 'ten of the thirteen damage types'");
- already-chosen entries drop out of the menu;
- `allowFreeText` passthrough, so a name the list never heard of still commits;
- `describedBy` wiring and the hint "Pick from the list, or type your own."

`SessionEditor` **already receives `pages`** (`SessionsView.tsx:43,142`), so the character list needs no
new plumbing. `5a` is now approximately:

```tsx
suggestions={pages.filter((p) => p.entityType === "character").map((p) => p.title)} pick
```

on the existing `TagInput` — with the existing `normalize={(raw) => raw.trim().slice(0, 40)}` override
preserved, which keeps "Garrett P." intact through `add()`. The wire shape stays `string[]`. **No new
component for the multi case.**

### 1.2 NEW DEFECT — the `Combobox limit = 8` trap is live in the Codex

`Combobox`'s default is `limit = 8` (`packages/ui/src/primitives/Combobox.tsx:52`), and it truncates
**silently** — `.slice(0, limit)` at `:64`, no "8 of 13" line, no scroll cue.

Both codex `Combobox` call sites pass **no `limit`**:

| Site | Control | Effect |
|---|---|---|
| `DowntimeView.tsx:146` | "Who spent the time" | a campaign with >8 character pages cannot reach the rest |
| `DowntimeView.tsx:216` | edit-row "Link to a character page" | same, and this one has no `allowFreeText` escape hatch |

This is the **same defect three lanes fixed elsewhere today** (rarity, damage types, the 13-item list)
and it is not in the register or the plan. `:216` is the worse of the two: without `allowFreeText` a
9th character is simply unlinkable. **Fix it first, alone (§5, step 0).**

### 1.3 `5e.3`'s archived grouping has a cheaper shape now

`ComboboxOption` carries `meta` — a muted suffix (`Combobox.tsx:12`, rendered at `:155`). Active-first
ordering plus `meta: "Archived"` gives the same discoverability as the plan's pre-collapsed `<details>`,
with **no new primitive surface**. A grouped `Combobox` would be new API on a control four lanes touched
today. **Recommend `meta` + ordering; take `<details>` only if the client asks for the fold by name.**

The plan's source-of-truth fork **stands and is confirmed**: `characterOptions` in `DowntimeView.tsx:68-71`
already sources from Codex `character` pages; `grep archived apps/server/src/codex-store.ts` → **zero
hits**, so Codex pages have no archive concept; `archived` lives on `GameState.Actor` (proved by
`PlayerActor = Omit<Actor, … "archived" …>`, `packages/domain/src/index.ts:654`). *Correction:* the plan
cites `domain/src/index.ts:974` for that field — `:974` is `effectGranted`. And the actor map is at
**`main.tsx:827`**, not `:828`; `CodexShell` already accepts an `actors` prop (`CodexShell.tsx:61,64`),
so widening it to `{id, name, archived}` reaches the shell without new plumbing.

### 1.4 `5b`/`5e.1`/`5e.2` — right fix, half-wrong diagnosis

The plan says the mechanism is `.nh-field` "inside **flex parents** with default `align-items: stretch`."
Two of the three parents are **grid**:

| Selector | `apps/client/src/codex/codex.css` | Display |
|---|---|---|
| `.codex-composer-meta` | `:975-976` (`flex: 1 1 130px`) | **flex** — plan correct |
| `.codex-downtime-form` | `:1411` (`repeat(auto-fit, minmax(180px, 1fr))`) | **grid** |
| `.codex-downtime-edit` | `:1415` (same) | **grid** |

Grid items stretch to row height under the same default, so **the prescribed fix is unchanged and
correct** — `align-content: start` scoped to `> .nh-field` on all three, never on bare `.nh-field`.
Only the explanation needs correcting, or the next reader hunts for a flex container in the downtime
form and does not find one.

Everything else here re-verifies exactly: `.nh-field { display: grid; gap }` with no `align-content`
(`packages/ui/src/primitives/forms.css:12`); `Input` renders a bare `<input class="nh-input">` with no
wrapper (`forms.tsx:19-20`) while `Combobox` and `NumberField` bring wrappers, which is why Activity is
the field that visibly stretches; help strings at **`SessionsView.tsx:214`** and **`DowntimeView.tsx:144`**
— both exact. The register-had-it-backwards correction stands.

### 1.5 `5d` is bigger than "five places" — and `chronicle.ts` is player-facing

**Eight non-test sites across five files**, not five:

| # | Site | What it is |
|---|---|---|
| 1 | `codex-store.ts:574` | `type CodexQuestStatus` |
| 2 | `codex-store.ts:1051` | **SQL `CHECK (status IN ('active','completed','failed'))`** — exact, unmoved |
| 3 | `codex-store.ts:2322` | `QUEST_STATUSES` set |
| 4 | `codex-store.ts:2326` | error string "A quest is active, completed, or failed." |
| 5 | `codex-http.ts:275` | `QuestStatusSchema` zod enum |
| 6 | `apps/client/src/codex/api.ts:984` | client type |
| 7 | **`apps/client/src/codex/chronicle.ts:99-102, 106, 240`** | **unlisted by the plan** |
| 8 | `packages/api-contract/src/index.ts:952` | `codexQuestStatus` |

`chronicle.ts:99` is `QUEST_EVENT_VERB: Readonly<Record<"active" | "completed" | "failed", string>>` — an
**exhaustive record**, so widening the union is an immediate typecheck failure, which is the good news.
The bad news is what it demands: **two new verbs that a player reads.** `questEventOf` returns a
`CodexPlayerChroniclePayload` ref (`:106`), so this is player-facing copy, not an internal label. Word it
deliberately.

Confirmed: the plan's default-status line is **`codex-store.ts:2325`** (`if (value === undefined) return "active"`)
— exact. `openQuests` is at **`quests.ts:42`** — exact, and its docblock at `:33` does assert "open is
`active`, and nothing else." **Migration count is 25** (`codex-store.ts:723` `MIGRATIONS`, versions 1–25,
latest at `:1581`) — the plan's figure is right, so `5d` is **v26**.

### 1.6 Ledger drift — one of the four bullets is already done

Plan item 7, re-checked at HEAD:

- **bullet 3 (replay map, mis-filed under `## Unverified`) — RESOLVED.** The entry is gone;
  `7dd7729` ("drops a bug that is fixed") removed it. Drop this from the packet.
- bullet 1 — **still stale, still at `known-bugs.md:76-78`.** `CampaignHome.tsx` renders
  `VisibilityBadge` **11 times**. Delete.
- bullet 2 — **still stale, still at `:83-85`.** `useStandingLimit` at `CampaignHome.tsx:134`, See-all
  at `:70`. Delete.
- bullet 4 — **still self-contradictory, `:99-107`.** Heading says four arms; `:105-106` says the
  journal arm is covered. Correct to three (page, map, marker) and re-measure.

---

## 2. `5e.4` re-verified end to end — unchanged, still not its own bug

Every link in the chain holds at HEAD, most of them to the exact line:

| Claim | HEAD | Verdict |
|---|---|---|
| Client handler correct | `DowntimeView.tsx:110-113` `confirmRow` → `journalApi.applyDowntime`, catches | ✅ |
| Round trip proved | `apps/server/test/codex-http.test.ts:1547-1567` | ✅ exact |
| Breaks in the store | `codex-store.ts:4498` `const target = this.proposedDateFor(existing);` | ✅ **exact** |
| The 400 message | `:4499` `"Set the campaign's current date before passing time."` | ✅ **byte-identical** |
| Error renders off-screen | `DowntimeView.tsx:138` — `{formError && <Alert tone="danger">…}`, first child of `.codex-downtime`, above the whole ~450px `Log downtime` section; Pending is the **second** `<section>` | ✅ exact |
| Bare "Confirm" fallback | `:127-128` `if (!calendar \|\| !target) return "Confirm";` | ✅ **exact** |

**Two corrections.**

1. `proposedDateFor`'s *definition* is at **`codex-store.ts:4468`**, not `:4498`. The plan conflated
   definition and call site; the call site it cites is right, so the conclusion is unaffected.
2. **A second failure mode the plan omits.** `applyDowntime` also throws
   `CodexRevisionConflictError` → **409** when `payload.applied` is already true (`:4497`), and
   `codex-http.test.ts:1567` asserts `[400, 409]`. A "disable Confirm and say why" design that only
   reasons about `proposedDate === null` will render a stale-page 409 as silence again. **The inline
   reason needs two branches: no campaign date (disable, explain) and already applied (re-fetch).**

**Verdict: `5e.4` remains `5f`(i) wearing a disguise.** Do not open it as its own unit.

---

## 3. `5f` re-verified — all three claims hold, line numbers included

### (a) An era already exists — confirmed

`CodexCalendar.yearName` at `codex-store.ts:287`; UI label **"Era suffix" at `CalendarEditor.tsx:41`**
(exact, with `help="Shown after the year, e.g. DR or AE"`); rendered as a **trailing** component at
`codex-store.ts:1924` (`` `${month.name} ${day}, ${year}${yearName ? ` ${yearName}` : ""}` ``); capped at
20 chars by `shortLabel(input.yearName, 20, "era")` at `:1878`. The three real defects the plan names —
singular, buried as the fourth field in a structure modal, a suffix rather than a leading component —
all confirmed. It is also already on the player's schema (`api-contract/src/index.ts:1833`), which is
the precedent that makes §3(c) safe.

### (b) The coupling is server-side and deliberate — confirmed, and the line has not moved

`codex-store.ts` grew to **5,640 lines**, but:

```
4199:    if (calendar.currentDate && this.getPublishedDate() === null) this.writePublishedDate(calendar.currentDate);
```

**`:4199` exact.** Docblock **`:4185-4198` exact** and it names K7 and the M11 rationale. The pin is
`codex-http.test.ts:1562` — **exact**: `expect((await calendar(base, PLAYER)).currentDate).toEqual({ year: 1492, month: 0, day: 10 })`,
with a comment stating the auto-publish premise in words. D6's own citations re-verify too:
`CalendarView.tsx:86` (`const diverged = !sameInWorldDate(now, published)`), `:123` / `:128` ("Not set" /
"Not shared yet" as plain `<strong>`), `:132` (`{diverged && <Button …>Publish the date</Button>}`). All
exact. **From the unset state there is still no visible publish act.**

### (c) The calendar-level `eras` list is safe — confirmed

`normalizeCalendar` is at **`:1870-1878`** (the plan said `:1874-1878`; the function opens at 1870) and
returns a fresh object literal, so `eras: input.eras ?? []` is a one-line additive read. `getCalendar`
(`:4137`) `JSON.parse`s a **single `calendar_json` TEXT blob** — so an existing blob upgrades by being
read. **No ALTER, no backfill, no stored date rewritten**, exactly as claimed. Verified there is no
`in_world_era` anywhere.

### (d) Projection — `5f`(iii) is confirmed the only `codex-projections.ts` edit in Area 4

`GmCodexCalendar` **`:1006`**, `PlayerCodexCalendar` **`:1034`**, `projectGmCalendar` **`:1041`**,
`projectPlayerCalendar` **`:1045`** — the plan's `:1006-1047` is exact. The player already receives
`yearName`, `months` and `weekdays`, so `eras` is structure, not secrets: **projected on both, never
filtered.** Viewer-safety review still required.

No other Area 4 unit touches the file. `5d` does not — quest `status` is projected as an opaque string
with no literal union in `codex-projections.ts`. `5a`/`5e.3` must not: the `attendees` GM-only note is at
**`:428`** (plan said `:429`), reinforced at `:456`, `:1065`, `:1108`, `:1162`. Binding attendees to
characters must not put them on `PlayerCodexSession`.

---

## 4. The label pairs — there are SEVEN, and the plan's stated pin is wrong

### The full list at HEAD

| Surface | player label | GM label | Line |
|---|---|---|---|
| Journal — entry | "Player-facing summary" | "GM-only notes" | `JournalView.tsx:40` / `:482` |
| Journal — deadline | "What will happen" | "GM-only notes" | `:42` / `:482` |
| Journal — downtime | "What the party knows" | "GM-only notes" | `:43` / `:482` |
| Journal — milestone | "What the party knows" | "GM-only notes" | `:44` / `:482` |
| Quests | "What the party was told" | "GM notes" | `QuestsView.tsx:243` |
| Page editor | "Player-facing" | "GM only" | `PageEditor.tsx:255` |
| **Backup — import side** | **"Player-facing side"** | **"GM-only side"** | **`BackupView.tsx:172`** |

**`BackupView.tsx:172` is a seventh pair the plan missed.** It is a `SegmentedControl` with the same two
words, but it names an import *destination*, not a body tab — arguably out of scope. It will be caught by
any copy-scan rule written against those strings, so **rule on it explicitly rather than discovering it
when the test goes red.**

Line drift: `JournalView.tsx:481` → **`:482`**; `PageEditor.tsx:254` → **`:255`**. Aria/placeholder sites
re-verified at `JournalView.tsx:492`, `QuestsView.tsx:215, 250, 253`, `PageEditor.tsx:263-264`.

The plan's other correction stands: the **session entry is not a toggle** — `SessionsView.tsx:250` and
`:256` are two stacked `Field`s ("Prep for this session" with a `GmOnlyTag`, and "Recap"). Leave it or
convert it deliberately.

### The pin — the plan names the wrong one

The plan cites `codex/vocabulary.test.ts:171-183` as a *reveal-axis pin* that retiring `"GM only"` would
break. At HEAD the reveal-axis test is at **`:175-186`**, and its assertion at `:180` matches only
`/Shown to players|Hidden from players/` — **it does not test "GM only" at all.** Its own comment says so:
"the CONTENT pill's 'GM only' is a different axis and legitimately still appears in Codex copy."

**The real trap is bigger and lives in source, not in that test.** Retiring the bare phrase `"GM only"`
would hit:

- `packages/ui/src/primitives/Reveal.tsx:147` — `GmOnlyTag` renders the literal, pinned by
  `packages/ui/src/primitives/reveal.test.tsx:133`;
- `apps/client/src/codex/AtlasView.tsx:45` — descend-lock `aria-label` **and** `title`;
- `apps/client/src/codex/ConnectionsPanel.tsx:185` — a `Switch` labelled "GM only";
- four test assertions: `calendar-view.test.tsx:163, 222`, `campaign-home.test.tsx:407`,
  `atlas-gm-mark.test.tsx:67, 70, 79`.

And the decisive one: the `RETIRED` array (`vocabulary.test.ts:64-83`) has **no "GM only" rule today**,
while `:73` *recommends* it (`use: "“Hidden from players” or “GM only”"`). A blanket retirement would
contradict a rule in the same array.

**→ Scope any new rule to the whole strings `"Player-facing"`, `"What the party was told"` and
`"GM notes"`. Leave the bare phrase `GM only` alone; leave `GmOnlyTag` alone.** Re-measure the corpus
floor at **`vocabulary.test.ts:127`** (`expect(strings.length).toBeGreaterThan(850)`) in the same commit —
deleting six labels moves it.

---

## 5. Harnesses

### `/codex` is tap-audited — thoroughly. The brief's premise is wrong.

`scripts/tap-audit.mjs:367-452` lists **~20 codex surfaces**, and codex was the *original* list —
`/homebrew` and the six `play-*` routes were today's late additions. Directly relevant entries:
`sessions` `:393`, `session-editor` `:399-401`, `quests` `:402`, `quest-editor` `:403-405`,
`journal` `:406`, `calendar` `:407`, **`downtime` `:408`**. Every Area 4 unit that adds a control lands
on an already-measured surface.

### The three new harnesses, mapped to Area 4 units

| Harness | Applies to | How |
|---|---|---|
| **`tap-audit.mjs` third overlay mechanism** (`:167-174`) | **`5a`, `5e.3`** | It excludes fields under an open `.nh-combobox-list` from the *reach* verdict while still measuring the listbox's own 44px route-1 rows. Both codex pickers are `Combobox`, so this is exactly the machinery they need. **Add an `open:` step to the `downtime` and `session-editor` entries** that types into the Who box — mirror `play-homebrew-picker`. Without it the new lists are never opened and never measured. |
| **`no-scroll-audit.mjs` inside-`.scroll-y` probe** | **`5b`, `5e.1`, `5e.2`** — *after a one-line change each* | It reaches `/codex` only at the **root** (`:334` GM, `:376` player). `/codex/downtime`, `/codex/sessions` and `/codex/calendar` are **absent**, so the new probe never sees the composers where the layout defects live. Three added lines make it the cheapest verification `5b` can get. |
| **`map-stability-audit.mjs`** (pixel-exact rect assertion) | **`5f`(iii)** — as a *pattern*, not directly | No codex surface. But its method — record state before and after a transition, demand byte-identity — is the shape of `5f`(iii) safety test #1 ("every row's `in_world_year/month/day`, `calendar_instant`, `in_world_label` byte-identical after `migrate()`"). Reuse the discipline, not the file. |

### Two existing codex harnesses the plan never mentions

- **`scripts/prep-clock-ux-check.mjs`** — a real-browser check of the prep-clock / publish / reveal flow
  at **375px and 320px**, which seeds its own fixture because the run publishes the clock. **This is the
  verification harness for `5f`(i)/(ii)**, and D6 will change what it asserts (Publish stops hiding
  itself). Update it in the same commit.
- **`scripts/codex-settings-ux-check.mjs`**, plus **`scripts/seed-codex.mjs`**, which tap-audit's codex
  fixture depends on.

### One harness that will *not* help

**`scripts/primitive-align-check.mjs` cannot verify `5b`/`5e.1`/`5e.2`.** It measures `/styleguide` only,
and these defects are *codex-scoped container* rules that never appear there. Its method (control tops
agree within 1px, at 390px and 1280px) is the right measurement — it needs a fourth pass over
`/codex/downtime` and `/codex/sessions`, or a small sibling script.

---

## 6. What Areas 1–3 broke or newly exposed in codex territory

**Broke: nothing.** No codex file changed. What they left behind:

- **Newly free (`5a`):** `TagInput` `pick` + `suggestions` + `optionLabel` — the multi-select picker,
  built and shipped, with the 8-cap already defeated. §1.1.
- **Newly free (`5e.3`, `5e.4`):** `Combobox` **commit-on-blur** (`:82-87`) — unmatched text used to
  survive only on Enter, so tabbing out of the downtime Who box silently discarded a typed name. That
  was an unreported `5e` sibling and it is already fixed. **Reopen-on-tap** (`:131`) fixes the "tapped
  the box and got nothing" case on the same field. Neither needs codex work.
- **Newly free (accessibility):** `describedBy` (`:38`, `:113`) — the downtime Who field's help text can
  now reach the accessibility tree, which matters if `5e.1` keeps a hint anywhere.
- **Newly exposed (`5e.3`, and a new defect):** the `limit = 8` truncation. Three lanes hit it today
  elsewhere and fixed it at their call sites; the two codex call sites were never revisited. §1.2.
- **Newly exposed (`5d`):** nothing from Areas 1–3, but the `chronicle.ts` exhaustive `Record` was always
  there and the plan never counted it. §1.5.

---

## 7. Revised order and sizes

The plan's order survives. **One step is inserted at the front, one step splits and shrinks, one grows.**

| # | Unit | Size | Basis | Change from plan |
|---|---|---|---|---|
| **0** | **`Combobox limit` at `DowntimeView.tsx:146` and `:216`** | **XS** | **measured** — 2 lines | **NEW.** Live truncation defect, independent of everything, and `5e.3` builds on it |
| 1 | `5b` + `5e.1` + `5e.2` — layout | **S** | **measured** — 2 `help=` deletions (`SessionsView.tsx:214`, `DowntimeView.tsx:144`) + 3 scoped CSS rules (`codex.css:975, 1411, 1415`) | unchanged; correct the *grid*-not-flex wording |
| 2a | `5a` — "Who played" picker | **S** *(was M)* | **measured** — 1 call site, `pages` already in scope | `TagInput pick`, **no `CharacterPicker`** |
| 2b | `5e.3` — downtime Who parity | **S** | **estimated** | `meta: "Archived"` + ordering on 2 existing `Combobox`es; widen `main.tsx:827` to `{id, name, archived}` |
| 3 | `5a.1` + `5c` — copy + `TwoLayerBodyTabs` | **M** | pair count **measured** (7 pairs, ~12 string sites); effort **estimated** | budget the 7th pair; **re-scope the copy-scan rules per §4** |
| 4 | `5d` — quest statuses | **L** *(was M)* | site count **measured** (8 sites, 5 files); migration **v26** measured; effort **estimated** | `chronicle.ts` was unlisted and is player-facing |
| 5 | `5f`(ii) → `5f`(i) → `5e.4` | **M** | **estimated** | unchanged; `5e.4` needs **two** branches (§2) |
| 6 | `5f`(iii) — eras | **L** | **estimated** | unchanged, last, **the only `codex-projections.ts` edit** |
| 7 | Ledger drift | **XS** | **measured** — 3 edits, not 4 | bullet 3 already done by `7dd7729` |

**Why step 0 goes first:** it is two lines, it is a defect users can hit today with a nine-character
party, it is the same class three lanes fixed today, and `5e.3` (step 2b) edits the exact two call
sites — doing it as part of 2b would bury a shipped-behaviour fix inside a design change.

**Why 2a and 2b split:** the plan bundled them as "one component, three call sites." They are now two
different mechanisms — a `TagInput` prop for the multi case, a `Combobox` option shape for the two
single cases. Shared *design* (active first, archived marked), not shared *code*. Bundling them
re-creates the `CharacterPicker` the primitives made unnecessary.

---

## 8. Unchanged — do not re-plan these

`5a.1`'s "session entry is not a toggle" correction · `5b`'s register-had-it-backwards correction ·
`5c`'s canonical wording · `5e.2`'s bare-`Input` diagnosis · `5e.4`'s "not its own bug" verdict ·
`5f`'s three corrections and the recommended `eras` design · D6 in full · the `attendees`-stays-GM-only
invariant · the `whoPageId`/`characterPageId` preservation requirement (D12) · the `string[]` wire shape
for attendees.

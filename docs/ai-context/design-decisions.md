# Design decisions, motifs, motion and voice

**Read this when:** you are inventing a new surface, adding a `@vtt/ui` primitive, reaching
for a motif or an animation, or writing words a user will read. The day-to-day rules a UI
change must obey are in `design-language.md`; this file is the settled reasoning behind them
plus the material you only need occasionally. Split out of `design-language.md` so the
routine read stays short.

---

## Locked design decisions (authoritative)

These are settled. Build to them; do not reopen them without a stated reason.

Intensity and themes
- One consistent moderate level of the aesthetic across the whole app. Hero
  zones are the boldest instances by degree, not a separate treatment.
- The look is fixed. There is no user-facing effects dial. The only switches are
  theme and OS accessibility (reduced motion / reduced transparency).
- Three themes: dark, dusk (in-between), light. The lighter two are
  accessibility-first; in light mode, legibility and usability outrank aesthetic.

Color
- Magenta leads, cyan supports, roughly 60/40.
- Dark base is a lifted deep indigo/purple, not true black.
- Violet is used meaningfully but occasionally (special states, gradients). A
  brighter `--violet-hi` exists for violet text so it stays legible on dark
  surfaces.
- Damage and danger use the magenta-adjacent rose-red.
- **Ruling R8 (D21): `--caution` is a warm orange.** It used to alias `--violet`, which
  invariant 8 reserves exclusively for GM-only content — so a warning badge and a GM-secret
  block were the same hue, and the one colour that must mean exactly one thing meant two.
  Orange is the only direction left that is neither loss-red, brand magenta/cyan, nor
  GM-violet, so the "no yellow/orange" restraint yields to the invariant rather than the other
  way round. It is scoped to the caution pair and nothing else, and its values are measured
  against WCAG 2.1 in `design-tokens.css`.

Texture and motifs
- Scanlines and faint static are a subtle everyday layer at the app-shell level,
  kept faint enough that text panels above them stay fully readable.
- The app wordmark carries a chrome-gradient fill; subtle chromatic fringing is
  an optional garnish on the wordmark only, never on functional or body text.
- The perspective grid is used sparingly (login, loading, empty states), not as
  a constant backdrop.
- The tactical battle-map grid stays neutral and quiet so map art and tokens
  dominate.

Type
- Display leans chunky 80s arcade, tiered so it never fights content: loudest on
  the wordmark and top-level titles (a heavy signage face with a chrome-gradient
  fill), a restrained bold face for section headers, a neutral legible body
  face. The look is arcade-cabinet and retro, deliberately not techno/sci-fi.
- Everyday UI text keeps some flavor (mono labels, uppercase eyebrows) with
  accessibility governing size and contrast.

Motion
- Tuned between snappy and glidey.
- Glow on live states switches on and off smoothly. No pulsing or breathing
  loops anywhere. One-shot cues (a crit flash, a jump-to flash, a bar filling
  once) are allowed because they settle rather than loop.

Mood and combat
- Mood is sleek, cool, and nostalgic: clean and precise with a nostalgic soul,
  not loud or playful.
- When an encounter starts, the encounter and map panels shift hue slightly to
  signal live combat. A quiet state change, not an intensity spike, and it must
  not reduce legibility.

---

## Signature motifs, texture, and the tabletop surface

Abstract motifs — grid, line, horizon geometry, screen texture. Keep all of this
off screens that hold dense text.

- **Perspective grid** (`.grid-floor`): a receding grid floor meeting a horizon,
  thin lines at low alpha. Reserve for login, loading, empty states.
- **Neon linework:** a bright horizon rule, occasional edge beams framing a hero
  zone, and the everyday 2px panel accent hairline. A line glows only when it is
  a hero element or an active state.
- **Screen texture** (`.scanlines`, `.static-noise`): faint horizontal lines +
  low-opacity grain at the app-shell level, behind solid panels. The wordmark
  fill (`.wordmark-name`) is chrome-gradient + bevel; optional `.chromatic`
  fringing is wordmark-only. All texture is off in light theme / reduced transparency.
- **Battle map:** the tactical grid overlay stays neutral and quiet. Empty/unloaded
  map = the perspective grid horizon with a `--grad-bloom` glow (the hero moment).
  Fog of war: `--void` at high alpha. (Fog is presentation, never a security boundary —
  `viewer-mode.md` owns that rule.)
- **Tokens on the grid:** circular 2px ring; selected `--cyan` + `--glow-cyan`;
  active turn `--magenta` + steady stronger glow (no pulse); targeted a one-shot
  `--danger` flash; team coding allies cyan / enemies magenta / neutrals indigo.
- **HP bars:** track `--surface-3`; fill is state, not a fixed hue — healthy cyan,
  bloodied magenta, critical danger, temp-HP a violet segment; always show the number
  in mono with `tabular-nums`. (On the shared screen a player sees a *band*, never a
  number — `viewer-mode.md`.)
- **Combat state (hue shift):** encounter + map panels take `.combat-active` (a
  quiet magenta tint) while an encounter is live; eases in/out, never pulses.

---

## Motion and interaction feel

- One easing (`--ease-settle`); a second (`--ease-drawer`) only for large sliding
  surfaces. The duration ladder is a token set in `design-tokens.css`, tiered press →
  hover → base → enter → reveal; use a token, and transition specific properties, never
  `all`.
- Animate context changes (view switches, tabs, dialogs, drawers) at the
  container level; leave frequently re-rendered lists alone (token list,
  initiative rows, chat).
- Selection and focus are the neon moments. Keyboard focus = a visible cyan ring
  on every interactive element; never remove focus outlines without replacing them.
- Depth through blur on sticky/floating surfaces; reduced-transparency replaces
  blur with a solid surface.
- A Cmd/Ctrl-K command palette is the search/jump/run surface. **Shipped
  Codex-scoped, deliberately not global** (D20, 2026-07-31): it is mounted only by
  `CodexShell` and the player shell, so ⌘K means nothing on the Encounter tab, and a
  test locks that — "make it global" is the obvious next step and is a separate
  decision, not an oversight. Its chrome is `Modal align="top"`, which is the only
  primitive change it needed; see `/styleguide#palette`, documented there as a
  composition rather than a component.
- Honor `prefers-reduced-motion` globally: neutralize entrances/drift/smooth
  scroll and present end states statically. Never gate information behind motion.

---

## Restraint rules ("not too overt")

1. At most one glowing element per region at rest. A *region* is one working area,
   not one screen: a faceted picker is one region, so its filter and its answer
   cannot both glow. When two candidates compete, the glow goes to the **answer**
   (the selected card), never to the control that narrowed the list — which is why
   `.nh-segmented-option[aria-pressed]` reads as pressed with `--surface-3` + `--text`
   and no glow at all.
2. Texture stays off dense text; the everyday grain lives at the shell level.
3. Neon is for edges and states; fills are dark (surface tokens).
4. The color-ramp bloom appears once per view at most.
5. Stack texture, don't pile it: one grid, at most one of scanlines/static, one bloom.
6. Body text is always `--text` on a surface token; never neon paragraphs.
7. If in doubt, remove one accent.
8. Nothing pulses.

---

## Voice and copy

Speak plainly, second person, about actions the player controls. Actions name
their result ("Roll initiative", "End turn", "Apply damage") and keep their name
through the flow ("Save encounter" → "Encounter saved"). Errors say what happened
and how to fix it. Sentence case throughout; all-caps only for small eyebrow
labels.

### The rule

**Say what the control does, or what belongs in the field. Nothing else.**

Copy describes the software, not the fiction. The Codex is a worldbuilding tool,
which makes it the surface most likely to start narrating; it may not. A GM
reading a hint wants to know what a control affects, what is required, what
players can see, and what cannot be changed later.

1. **No scene-setting or roleplay voice.** Not "the table", "the party's own
   words", "the hook", "tonight", "the truth behind…". Empty states name the
   record they lack, not a mood.
2. **No em-dashes in anything a user reads.** Not as an aside, not as a
   connector, not in place of a colon. One clause, or two short sentences. An
   aside that carries a real constraint earns its own sentence. This covers
   assembled labels and "no value" glyphs too: the Codex uses `·` between label
   fragments and the word "None" for an absent value. (Em-dashes in code
   comments are fine — the rule is about what reaches the screen.)
3. **No ellipsis placeholders.** A placeholder is a plain noun phrase naming the
   content, or a concrete example value. `…` survives only where it carries
   information: "New page…" means the action opens a dialog, "Saving…" means
   work in progress.
4. **No rhetorical framing, no invitations, no cleverness.** No questions except
   in a confirm dialog, which has to ask. No exclamation marks.
5. **A hint carries information or it is deleted.** If removing the banned
   constructions leaves a sentence that only restates the field name, delete the
   hint. Padding it back to look deliberate is worse than the silence.
6. **No LLM register.** No "simply", "just", "easily", "powerful", "seamlessly",
   "leverage", "note that", "keep in mind", "lets you", "allows you to". No
   throat-clearing before the sentence that matters, and no summary sentence
   restating what was just said.

### Calibration

| Instead of | Write |
| --- | --- |
| "The hook as the table heard it…" | "What players have been told about this quest" |
| "The truth behind the hook, who is really behind it, how it ends…" | "Details players cannot see" |
| "Beats, encounters, the questions you want answered tonight…" | "Prep notes for this session" |
| "Search what you know…" | "Search pages" |
| "Its kind brings the fields it needs. You can change it later." | "The kind determines which fields appear. You can change it later." |
| "Move this map elsewhere in the atlas. Everything under it travels along." | "Move this map elsewhere in the atlas. Any maps nested under it move with it." |
| "Days can't be edited — they're what the clock already moved by. A typo is a delete and re-log." | "Days cannot be changed after logging. Delete the entry and log it again to correct it." |
| "Longer pauses mean fewer saved versions, and more work at risk if the tab closes." | "Longer intervals save fewer versions and risk losing more unsaved work." |
| "Nothing bearing down on the party." | "No deadlines yet." |
| "Couldn't load the Codex — check your connection to the table." | "Couldn't load the Codex. Check your connection and try again." |

Already correct, and left alone: "Shown after the year, e.g. DR or AE" ·
"Use / to nest, e.g. NPCs/Villains".

**Plainer never means vaguer.** Destructive and disclosure copy keeps every
number and consequence it had: the restore confirm states its record counts, the
reveal-ahead warning names both dates, the kind-change confirm names each field
at risk and softens its recovery promise when version history is off. Cut the
flourish, keep the fact.

**One product, one set of words (D28).** The playable thing is a **character**, a
**monster** or an **NPC** — never an "actor" or a "combatant". The list is **Turn
order** and **Initiative** is the score. The event is a **fight**; the place is the
**Table**. Visibility is **Shown to players / Hidden from players / GM only**,
everywhere, in that spelling. Claim states are **Available / Claimed / Your
character**; the verbs are **Claim / Release**. The verb triad means what it says:
**Delete** is permanent and its confirm says "This cannot be undone", **Archive** is
reversible and its copy offers the way back, **Remove** takes a thing out of one list
and the thing survives. Wire names are not copy and keep their spelling.

Two glossaries fail the build on a retired word, off one shared scanner
(`apps/client/src/copy-scan.ts`): `codex/vocabulary.test.ts` for the Codex's dialect
and `apps/client/src/play-vocabulary.test.ts` for everything else — the play lock
reads the whole client tree minus a pinned exclusion list, so a new surface is scanned
without being registered anywhere. Reaching for a plainer phrase is exactly when a
retired word slips back in.

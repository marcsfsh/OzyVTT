# Horizon update: the Cup primary, Chakra Petch and Horizon light

Written on 2026-10-28 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, checked at `55c0707` ("Keep button icons at full size on narrow screens"). Light rail phases 0 to 8 are already built on that branch. This plan updates that work; it does not start anything over. File paths and line numbers were read at `55c0707`; confirm them before editing.

## 0. How to use this plan

- Read sections 1 to 4 before touching code. Section 5 is the work in six phases, each about one commit or PR.
- The references are the two mockups in this zip, also published for the user:
  - `mockups/light-rail-horizon.html` (https://claude.ai/artifact/WBJWQXU7LwBpHjrPT4Hpi9). The full Light rail player with a Tone switch in its top bar: Before is what the branch built, Horizon is the target. Every moment can be compared both ways, in Dusk and Dawn.
  - `mockups/cup-button.html` (https://claude.ai/artifact/Ft6TJBxrg2AD33hXs6FNb5#cup). The primary button the user chose, Cup, beside the versions they turned down. Its States section and five in-app scenes show every state.
- The mockups are the reference for look, colour and timing. Their CSS and JS are mockup code: port the values and the ideas into the existing engine and primitives. Section 8 says where each idea lives in the mockup source.
- `history/` holds the three rounds of button mockups that led here (the replacements for magenta, the fonts, the Rail versions). Context only; the choices are made.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The repo's Writing section in `docs/DESIGN.md` applies on top, and `apps/client/src/writing.test.ts` checks it.

## 1. What the user decided

1. The primary button changes from the magenta arcade key to the Cup: a plate like the other controls that holds a horizon. A 3 px horizon line runs along its base and 1 px lines run up both sides at full height, with no top. The horizon's colours tint the lower half of the plate. The label is white Chakra Petch capitals. A press sinks the plate 1 px, lights the base from the press point and fills the cup with a wash of the horizon that settles back.
2. Chakra Petch replaces Bungee wherever Bungee is plain: page and record titles, dialog titles and the primary's label. Bungee stays wherever the lettering is chrome: the wordmark, YOUR TURN, the acting creature's name and the table screen's acting name.
3. Light rail takes the Cup's Horizon tones:
   - A lit line that marks a choice (a chosen tab's ink, a lit row) is a horizon, cyan to yellow along its own length, with a faint cast of the same colours rising from it.
   - Where that ink lies on a line already painted as the horizon (the top bar's sections), it shows the horizon's own colours at that place, brightened, so the rail reads as glowing there. It never starts a second horizon over the first.
   - An ink always lies on its strip's line. It never stacks a second line above it.
   - A cast fades out sideways as well as away from its line. No cast ends in a hard vertical edge.
   - A comet that carries no meaning of its own takes the horizon's colour where it leaves and where it lands. A burst takes the colour where it lands.
   - An overlay's horizon top edge casts the same faint light down into the surface.
4. Hit points, damage, healing and targeting keep their own gold, red and cyan light, because those colours mean something. The sun frame, lamps, chrome catch, chroma settle, the life bar and the wash stay as built.

## 2. Rules that bind this work

- The branch is shared. Another session commits design work on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it.
- CLAUDE.md applies in full: the server decides, projections are the security boundary (nothing here adds data to any projection), players act only on their own character, and phones are first-class (check every change at 390 px with touch).
- `apps/client/src/design-conventions.test.ts`: colours only from `packages/ui/src/styles/design-tokens.css` (check (d)), `@media` widths on the ladder (check (f)), `.scroll-y` for scroll regions (check (h)).
- The pane rule (`apps/client/src/styles.css`): no transform, filter, backdrop-filter, perspective, will-change or `contain: paint` on `.app-pane` or its one child. Casts and glows live on inks, edges and buttons, never on the pane.
- Reduced motion: no press light, no comet, no burst (the engine's `canMove()` already covers the parts). Reduced transparency: no casts and no glows; the inks and the Cup's lines stay as flat colour.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before calling a phase done, and look at it at 390 px and 1280 px in Dusk and Dawn (the `verify` skill has the steps). None of this changes `GameState`, a command, an HTTP route or the actor schema, so `npm run map` should not be needed.
- `@fontsource/chakra-petch` is a client dependency of `packages/ui`, bundled by Vite like the other faces. The server never imports it, so the Dockerfile needs no new `COPY` line; confirm that the client build in the Dockerfile picks it up through `packages/ui/package.json`.

## 3. What is on the branch now

| Area | Where | What it does today |
| --- | --- | --- |
| Primary button | `packages/ui/src/primitives/Button.css:86-120`, `:147-149`, `:189-193` | Magenta face (`--primary-base`), dark Bungee ink (`--primary-ink`), 5 px `--primary-edge` shadow with a 5 px margin under it, `--glow-primary` |
| Encounter primary | `apps/client/src/encounter/encounter-panel.css:1012-1040` | `.encounter-primary` paints a magenta face inside a 3 px sun-gradient frame with `--glow-sun`; `.resume` swaps in a cyan edge |
| Primary glow override | `apps/client/src/actors/party-roster.css:17` | `--nh-glow: var(--glow-drop-magenta)` on the roster's primary |
| Primary tokens | `design-tokens.css:129`, `:168-173`, Dawn `:568`, `:585`, reduced `:676` | `--glow-primary`, `--primary-base`, `--primary-ink`, `--primary-edge`, `--primary-ink-shadow`, `--primary-tint(-hover)` |
| Fonts | `packages/ui/src/styles/fonts.css`, `design-tokens.css:334-336` | Bungee loads at 400; `--font-display` and `--font-wordmark` are both Bungee. `var(--font-display)` appears 76 times; 61 of those rules also set weight 400 |
| Chrome lettering | `design-tokens.css:998` (`.chrome`), `acting-card.css:20`, `encounter-panel.css:199`, `player-turn-card.css:14`, `screen-parts.css:177`, `:188` | `.chrome` paints the gradient; each element's own rule sets its face through `--font-display` |
| Strip ink | `packages/ui/src/primitives/StripInk.tsx`, `StripInk.css` | One 2 px line, `var(--nh-ink, var(--cyan))` with `--ink-glow`, placed under (or over, or beside) the chosen tab; `stripSwitch` drains and fills it |
| Strips that set the ink | `apps/client/src/shell/app-bar.css:57`, `:164`, `:216` | `--nh-ink: var(--state-on-edge)` (cyan) on the top bar's sections, the section bar's tabs and the phone's bottom tabs |
| Top bar horizon | `app-bar.css:15-25`, `:86-89` | `.app-bar::after` is the 2 px horizon; the sections' ink lies on it with `z-index: 1` |
| Overlay edge | `packages/ui/src/primitives/OverlayEdge.css` | `.nh-overlay-edge`, 2 px of `var(--nh-edge, var(--grad-horizon))` |
| Engine | `packages/ui/src/motion/lightRail.ts:14` (`Tone`), `comet` `:226`, `cometTo` `:259`, `burst` `:299`, `pop` `:335`, `lightLine` `:753`, `stripSwitch` `:781` | Untoned comets use `--spark` and `--spark-tail`; untoned bursts and pops use `--spark` |
| Light styles | `packages/ui/src/styles/light-rail.css:13-69` | `.lr-comet`, `.lr-burst`, `.lr-pop` and their gold, cyan and red tones |
| Page change | `apps/client/src/shell/pageLight.ts` | Comet and burst along the horizon, wash in the pane |
| Tests that pin the old primary | `packages/ui/src/primitives/button-ink.test.tsx:41-60`, `packages/ui/src/theme/themes.test.ts:178`, `apps/client/src/shell/landing-ink.test.tsx:34`, `packages/ui/src/primitives/cabinet.test.tsx:156` | Label ink on `--primary-base`, primary contrast, landing control colours |

## 4. Values

### 4.1 Tokens to add in `design-tokens.css`

Dusk on `:root`, Dawn in the `[data-theme="dawn"]` block, reduced transparency in `:root[data-transparency="reduced"]`.

| Token | Dusk | Dawn | Reduced transparency | Used for |
| --- | --- | --- | --- | --- |
| `--hz-1` to `--hz-5` | #4fe3ff, #9a5cff, #ff2f92, #ff8a1f, #ffe14d | #1d6a80, #6a46b0, #b0306e, #c4610f, #8a5612 | as the theme | The horizon's five stops for lit parts, at 0, 30, 60, 85 and 100% |
| `--hz-paint` | `linear-gradient(90deg, var(--hz-1), var(--hz-2) 30%, var(--hz-3) 60%, var(--hz-4) 85%, var(--hz-5))` | same expression | same | Inks, the Cup's lines and cast, a lit row |
| `--ink-cast` | 0.24 | 0.14 | 0 | A cast's strength |
| `--ink-bright` | `brightness(1.35) saturate(1.15)` | `brightness(0.8) saturate(1.2)` | as the theme | An ink lying on the horizon line |
| `--ink-glow` (change) | `0 0 8px rgba(255, 47, 146, 0.45)` | `0 0 #0000` | `0 0 #0000` | Was cyan; the ink is no longer cyan |
| `--primary-veil` | 66% | 80% | as the theme | How much of the plate covers the horizon in the Cup's cast at rest |
| `--primary-veil-hover` | 54% | 74% | as the theme | The same on hover and press |
| `--primary-drop` | `drop-shadow(0 0 4px rgba(255, 47, 146, 0.8))` | `none` | `none` | The glow on the Cup's lines |
| `--lr-head-k` | 0 | 1 | as the theme | 0: a horizon comet's head is `--spark` white. 1: the head is its landing colour |
| `--lr-glow-k` | 1 | 0 | 0 | Whether horizon comets and bursts glow |
| `--fw-display` | 600 | 600 | 600 | The display face's weight |

The Dawn stops are darker than Dawn's `--grad-horizon`, whose yellow end disappears on paper. Keep `--grad-horizon` as it is: it still paints the top bar's line and overlay edges in both themes.

`--font-display` becomes `"Chakra Petch", "Bai Jamjuree", system-ui, sans-serif`. `--font-wordmark` stays Bungee and also serves chrome lettering.

### 4.2 The Cup

Measured from `mockups/cup-src/page.css` (`.pbtn`, `.r-cup`) and the press recipe in `mockups/cup-src/tail.html` (`PRESS.cup`).

- Sizes: as today, 52 px with a 0 26 px padding, and 42 px with 0 18 px in a section bar (`--sm`). The 5 px pressed edge and the margin under the button go.
- Label: `--text`, Chakra Petch at `--fw-display`, 16 px (14 px small), `letter-spacing: 0.08em`, `text-transform: uppercase`. The code keeps labels in sentence case.
- Plate (`::before`): 1 px `--line-raised` edge. Background, top layer first: `linear-gradient(to top, transparent, <plate>)`, then a layer of `color-mix(in srgb, <plate> var(--primary-veil), transparent)`, then `var(--hz-paint)`. The plate is `--surface-2` at rest and `--surface-3` on hover and press, with `--line-raised-hover` for the edge and `--primary-veil-hover` for the veil, and the fade layer starting at 10% instead of 0.
- Lines (`::after`): `inset: 0`, `border: 1px solid transparent`, `border-top: 0`, `border-bottom-width: 3px`, `border-image: var(--hz-paint) 1`, masked with `linear-gradient(to top, #000 40%, rgba(0, 0, 0, 0.6))` (with `-webkit-mask-image` for Safari), and `filter: var(--primary-drop)`.
- Press: `translateY(1px)` on `:active`. With motion allowed, a press also runs two parts in the button: a `--hz-paint` layer behind the label that rises from the base (`scaleY` 0 to 1 from the bottom, opacity 0.45 to 0.32 by half way, then 0, 320 ms on `--ease-travel`), and a 3 px line in the head colour that fills outward from the press point along the base (380 ms: full length by 55%, then fades). A keyboard press starts from the middle.
- Disabled: unchanged. A flat `--surface-2` box with a 1 px `--line` edge, `--text-muted` label and no lines.
- Focus: the existing focus ring.

## 5. Phases

Pull before each phase, commit each phase on its own and push to `claude/friendly-babbage-g7gcge`. After U2, stop and ask the user to look at the primary button at phone and laptop sizes before going on. Don't open a pull request unless the user asks for one.

### U1: tokens and faces

- Add the tokens in 4.1 and change `--ink-glow` and `--font-display`.
- Install `@fontsource/chakra-petch` in `packages/ui` and import its 600 weight in `fonts.css`, with a comment line like the others. Update the comment at `design-tokens.css:326-333` that lists which face does what.
- Every rule that sets `var(--font-display)` gets `font-weight: var(--fw-display)` (61 of the 76 set 400 today) and `text-transform: uppercase`, unless it is chrome. Bungee was capitals only, so text in the code is in mixed case and would show as typed. Add `letter-spacing: 0.03em` where a title had none.
- Chrome keeps Bungee: `.chrome` (`design-tokens.css:998`) gains `font-family: var(--font-wordmark)`, and the chrome elements' own rules (`acting-card.css:20`, `encounter-panel.css:199`, `player-turn-card.css:14`, `screen-parts.css:177` and `:188`) take `var(--font-wordmark)` in their `font` so rule order can't undo it.
- Add a check to `design-conventions.test.ts`: a rule that names `var(--font-display)` also sets `text-transform: uppercase`. Keep an allowlist with a reason for any exception.
- Acceptance: titles across the app in Chakra Petch capitals; YOUR TURN, the acting name, the screen's acting name and the wordmark still Bungee; no title wraps at 390 px that didn't before (Chakra Petch is narrower than Bungee, so most get shorter).

### U2: the Cup primary

- Rewrite the primary in `Button.css` (`:86-120`, `:147-149`, `:189-193`) to 4.2. Keep `--nh-ink` as the label's hook (now `--text`).
- The press light: add a `cupPress(button, x)` part to `lightRail.ts` (the rising layer and the base fill from 4.2) and call it from `Button` on `pointerdown` for the primary variant, from the middle for a keyboard press. It goes through `canMove()` like every other part. Its parts are `lr-part` children of the button, `aria-hidden`, removed when done; the rising layer sits behind the label (`z-index: -1` inside the button's isolated stacking context, after the plate in DOM order).
- `.encounter-primary` (`encounter-panel.css:1012-1040`) becomes the Cup as well. The sun frame's one job is showing who is acting, so the primary action stops borrowing it. Keep `.resume` (the cyan step) and `.is-quiet` as they are.
- Remove the roster's magenta glow override (`party-roster.css:17`).
- Retire `--primary-base`, `--primary-ink`, `--primary-edge`, `--primary-ink-shadow`, `--primary-tint`, `--primary-tint-hover` and `--glow-primary` once nothing uses them (`git grep` each). `--magenta` stays for the Action lamp and pink words.
- Tests: `button-ink.test.tsx` checks the label against the plate, and against the plate with the cast at the label's midline (`--surface-2` with the yellow end mixed in at the veil's strength); `themes.test.ts:178` checks the same pair in both themes; update `landing-ink.test.tsx:34` and `cabinet.test.tsx:156` for the new tokens. Keep the 4.5:1 threshold.
- Acceptance: every primary in the app is the Cup, in every place the mockup's five scenes show (a section bar, the homebrew editor's Publish, the turn panel's End turn, a dialog, a phone's full-width button); pressing lights it; disabled is flat; nothing shifts by the 5 px the old edge used.

### U3: Horizon colours in the engine

- Add `horizonAt(t: number, el: Element): string` to `lightRail.ts`: read `--hz-1` to `--hz-5` from `getComputedStyle(el)` and interpolate between the stops at 0, 0.3, 0.6, 0.85 and 1. Unit test it against the tokens, in both themes.
- `comet()`: with no `tone`, set `--lr-tail-a` to the colour at `from` and `--lr-tail-b` to the colour at `to`, as shares of the host's length along the axis, and add the class `lr-hz`. `cometTo()` with no tone runs 0 to 1 along its trip.
- `burst()` and `pop()`: with no `tone` and no `color`, set `--lr-ring` to the colour at the landing point and add `lr-hz`.
- `light-rail.css`: for `.lr-comet.lr-hz`, the head is `color-mix(in srgb, var(--lr-tail-b) calc(var(--lr-head-k) * 100%), var(--spark))` and each face's gradient runs `transparent, var(--lr-tail-a) 40%, var(--lr-tail-b) 80%, var(--lr-head)` in that face's direction. The filter is `drop-shadow(0 0 3px rgba(255, 255, 255, calc(0.85 * var(--lr-glow-k)))) drop-shadow(0 0 8px color-mix(in srgb, var(--lr-tail-b) calc(var(--lr-glow-k) * 100%), transparent))`. For `.lr-burst.lr-hz` and `.lr-pop.lr-hz`, the background is `radial-gradient(closest-side, color-mix(in srgb, var(--lr-ring) calc(var(--lr-head-k) * 100%), var(--spark)), var(--lr-ring) 45%, transparent)` with a 6 px drop shadow in the ring colour at `--lr-glow-k`.
- Toned parts (`lr-gold`, `lr-cyan`, `lr-red`) don't change.
- Tests: `lightRail.test.tsx` checks that an untoned comet carries both colours and `lr-hz`, and that a toned one carries neither.

### U4: inks

- `StripInk.css`: the ink's background becomes `var(--nh-ink, var(--hz-paint))`. Remove the cyan `--nh-ink` overrides at `app-bar.css:57`, `:164` and `:216` (grep for any other strip that sets `--nh-ink` and keep only one that means something).
- The cast, a `::before` on `.nh-tabs-ink`: the same paint as the ink, `opacity: var(--ink-cast)`, 18 px deep, running 10 px past each end, on the side away from the line (above a bottom ink, below a top ink, beside a start ink). Mask it with an ellipse centred on the ink, `radial-gradient(50% 100% at 50% 100%, #000 25%, transparent 100%)` for a bottom ink (turn it for the other edges), so it fades sideways as well as away. The ghost `stripSwitch` clones gets the cast too, so it drains with it.
- Ink on the horizon: give `Tabs` and `StripInk` an `onHorizon` prop (Tabs hands it on at `Tabs.tsx:171`, where it passes `edge`), and pass it from the top bar's sections (`AppBar.tsx:96`, beside `inkEdge` and `onTravel`). In `place()`, measure the bar marked `data-horizon` and set `--ink-win-w` to its width and `--ink-win-x` to its left edge minus the ink's left edge. An ink with `data-on-horizon` is 3 px tall (1 px proud of the 2 px line), paints `var(--grad-horizon) var(--ink-win-x) 0 / var(--ink-win-w) 100% no-repeat` with `filter: var(--ink-bright)`, and its cast paints the same window shifted 10 px. The bottom-tab ink on a phone does not lie on the horizon, so it keeps a horizon of its own.
- Ink on the line: check every strip that carries an ink at 390 and 1280 px. The section bar's tabs (`app-bar.css:155-190`) put a 2 px ink just above the bar's 1 px bottom border, which reads as a second line: move it down to cover the border (a strip-level offset that `place()` adds is enough). A strip that is a sunken track keeps the ink as the chosen tab's underline, since it has no line under the tabs.
- Lines lit by `lightLine` (the scene lists) need nothing here: their comet and burst take the horizon in U3. Check marks and checked boxes stay cyan, since they show a state.
- Acceptance: switching tabs at 1280 and 390 px shows one line, never two; no cast ends in a vertical edge; the top bar's chosen section reads as the horizon glowing under it.

### U5: overlay casts

- `OverlayEdge.css`: `.nh-overlay-edge::after` casts the edge's own paint (`var(--nh-edge, var(--grad-horizon))`) 18 px down into the surface at `opacity: var(--ink-cast)`, masked `linear-gradient(to bottom, #000, transparent)`. Its ends meet the surface's sides, so it needs no side fade.
- Acceptance: dialogs, menus, drawers and toasts show the cast in Dusk, a fainter one in Dawn and none under reduced transparency; `overlay-edge.test.tsx` passes.

### U6: docs

- `docs/DESIGN.md`:
  - Look table: the Arcade button row becomes the Cup (Press this, the one primary action in a view); the Horizon line row adds the chosen tab's ink and the primary's lines to where it appears.
  - Colour table: the three primary rows become the Cup's (`--hz-paint`, `--text` on the plate, `--primary-veil`); add the `--hz-*` stops; the Selection row notes that the chosen tab's ink is now the horizon, while focus, targeting and the selected segment stay cyan.
  - Type table: Display is Chakra Petch 600 in capitals; add a Chrome row (Bungee through `--font-wordmark`, chrome lettering only). Line 157, "Uppercase belongs to Bungee titles", now says display titles.
  - Components: the Primary bullet describes the Cup (4.2).
  - Motion: add the horizon's colours for untoned comets and bursts, that an ink lies on its line, and that a cast fades at its ends.
- ADR-0046, "Horizon light and the Cup primary", from `docs/adr/template.md`, with its row in `docs/adr/README.md`. Context: the magenta key read as off-brand next to the glass and the thin lit lines; the user chose Rail, then Horizon, Chakra Petch and Cup over three rounds (this zip's `history/`). Consequences: the horizon gains the primary and the chosen ink as jobs; the sun frame goes back to its one job.
- Put this zip's mockups beside the earlier handoff, under `docs/design/light-rail/horizon/`.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, then `npm run build` and `npm run smoke`.
- By hand at 390 px with touch and at 1280 px, in Dusk and Dawn, with reduced motion on and off and reduced transparency on. Compare against the Horizon tone of `mockups/light-rail-horizon.html`, with Slow, 6x and the DevTools Animations panel at 10%.
- `e2e/themes.spec.ts` samples screenshot pixels. A cast near a tab could tint a sample: check that the samples avoid the strips, or wait for `document.getAnimations().length === 0` before sampling (as `e2e/smoke.ts:192` does).
- No `.lr-part` left in the DOM after a moment. No layout shift from a cast, a glow or the Cup.

## 7. Left as they are

- The segmented control's cyan underline, focus rings, targeting and the Reaction lamp: cyan still means selection and focus there. If the user wants segmented controls to match the tabs, it's the same ink paint on `SegmentedControl.css`'s `box-shadow` underline, and worth asking before doing.
- The sun frame, lamps, chrome catch on YOUR TURN, chroma settle on condition chips, the life bar, the VCR counter, the wash and the table screen's own light.
- Gold, cyan and red comets, bursts and pops.

## 8. Where each idea lives in the mockups

| Idea | Mockup source |
| --- | --- |
| The Horizon tone's tokens, inks, casts, overlay cast, Cup in the stages, display face and chrome exceptions | `mockups/light-rail-horizon-src/p4b-horizon.css` |
| Horizon colours for comets, bursts and pops (`hz`, `isDawn`, the `lr-hz` class) | `mockups/light-rail-horizon-src/p6-core.js`, the block after `px()` and the `comet`, `burst` and `pop` functions |
| An ink on the horizon showing the rail's own colours (`seatWindows`) | `mockups/light-rail-horizon-src/p11-controls.js`, at the end |
| The Tone switch | `p5-body.html` (the top bar) and `p11-controls.js` (`data-tone`) |
| The Cup: plate, lines, states | `mockups/cup-src/page.css`, `.pbtn`, `.pbtn::before` and `.r-cup` |
| The Cup's press | `mockups/cup-src/tail.html`, `PRESS.cup`, `cupFill` and `fillFrom` |
| Horizon and Chakra Petch as the page defaults | `mockups/cup-src/page.css`, the `:root` block after the colour comment |

`sh build.sh` in each source folder rebuilds its page after an edit.

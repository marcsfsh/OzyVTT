# Light rail: implementation plan

Written on 2026-10-28 for `marcsfsh/OzyVTT`. The research was done on branch `claude/friendly-babbage-g7gcge` at `beb0637`. That branch had moved to `5ebad1b` by the time this was written ("Sheet Actions tab, and the GM can pick players' targets"). The user chose this same branch for the work. Another session is doing design work on it at the same time, so section 2 has rules for sharing it. File paths and line numbers below were checked at `beb0637`; confirm them before editing.

## 0. How to use this plan

- Read sections 1 to 4 before touching code. Section 5 splits the work into phases, each about one PR. Appendix A lists every moment with its file and its trigger. Appendix B maps the mockup's source files.
- The approved mockup is `mockup/ozyvtt-light-rail.html` in this zip. Open it in Chromium, Safari or Firefox. Pick a group along the top and a moment along the bottom; Slow, 6x in the top bar stretches every timing. The same page is published at https://claude.ai/artifact/JiBCjnKGJkcj8TfLm6rYt8 for the user.
- The mockup is the reference for look, order and timing. Its CSS and JS are mockup code: port the numbers and the ideas, not the files. `docs/DESIGN.md` says the same about the existing static mockups.
- `mockup/history/` holds the two earlier rounds, for context only. The user has chosen; don't reopen the choice.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The repo's own Writing section in `docs/DESIGN.md` applies on top, and `apps/client/src/writing.test.ts` checks it.

## 1. What the user decided

1. Light rail replaces the scanline wipe and becomes the one motion language for change across the app.
2. Light travels along a line that's already on screen, from where something was to where it's going. The old place drains, a comet runs, a burst lands and the new place fills. A wash may fall onto what changed. The content itself only fades.
3. Two effects from earlier rounds stay, each in one place. Chrome catch, a sweep of the horizon's colours across letters, appears only on YOUR TURN, because chrome lettering's job is showing who's acting. Chroma settle, a pink and cyan split that settles, appears only when a condition chip arrives or concentration breaks.
4. Status gets its own lines (the reconnect bar's line, a plate's top edge). The horizon keeps its one job of marking the top of the app.
5. All 18 groups in the mockup are in scope, including two moments that are new features as well as motion: damage numbers rising from tokens (group 10) and the table screen gliding when it follows the GM's camera (group 14). The user said yes to both. Section 6 has their answers and the limits that come with them.
6. The timing rule in `docs/DESIGN.md` changes. Content starts fading in within 60 ms and is complete within 300 ms. The light around it ends within 500 ms, and sequences that light several things in order (a long rest, the start of an encounter) may run to 700 ms. Nothing waits on light, and nothing loops.

## 2. Rules from the repo that bind this work

- The server decides (CLAUDE.md invariant 1). Animation presents state that arrived from the server. Never animate a guess: no optimistic hit points, no client-side roll results.
- Projections are the security boundary (invariant 2). A moment may only show what that audience's projection already carries. This matters most for hit point comets and damage numbers on creatures a player sees as a band (`actor.set-health-display`, `encounter.set-health-display`). Read `.claude/rules/projections.md`.
- Phones are first-class (invariant 4). Check every moment at 390 px with touch.
- The branch is shared. Work on `claude/friendly-babbage-g7gcge`, where another session is also committing design work. Fetch and pull before each phase and again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it, because the other session's change may be the one to keep.
- `apps/client/src/design-conventions.test.ts` enforces these, among others:
  - (d) colours come only from `packages/ui/src/styles/design-tokens.css`.
  - (f) `@media` widths sit on the ladder: max 560, 650, 760, 849, 979 and min 561, 651, 761, 850, 980, 1280. The mockup used 420, 480, 520, 620, 640, 700, 760, 900 and 960; don't copy those.
  - (h) scroll regions use `.scroll-y`, never a bare `overflow: auto`.
- The pane rule (apps/client/src/styles.css:66-70 and :91-94): never put transform, filter, backdrop-filter, perspective, will-change or `contain: paint` on `.app-pane` or its one child, because fixed overlays would be trapped. Light lives in bars, strips, plates and overlays. The page only fades. A wash inside the pane is an absolutely positioned overlay that animates opacity only.
- Before calling a phase done: `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, then `npm run build` and `npm run smoke`, and look at it at phone and laptop widths. The `verify` skill has the steps.
- After changing `GameState`, a command, an HTTP route or the actor schema, run `npm run map`. This plan shouldn't need any of those. Damage numbers come from the hit point drop already in the viewer's projection, so they need no new field either. If a phase seems to need one, stop and ask the user.
- No new runtime package is needed. The Web Animations API is native.

## 3. Architecture

### 3.1 Tokens

Add to `packages/ui/src/styles/design-tokens.css`. Dusk values go on `:root`, Dawn values in the `[data-theme="dawn"]` block, and the reduced transparency overrides in `:root[data-transparency="reduced"]` (about line 591). Values come from `mockup/src/p2-base.css`.

These already exist and should be reused: `--grad-horizon`, `--glow-horizon`, `--glow-tab-text`, `--vcr-glow`, `--grid-neon`, `--chrome-split`, `--caution`, `--caution-hi`, `--grad-sun`, `--lamp-action` and the other lamps with their `--glow-lamp-*`, `--tab-on`, `--tab-on-sheen`, `--overlay`, `--dur-count`, `--ease-settle`.

Timing tokens to add:

| Token | Value | Used for |
| --- | --- | --- |
| `--dur-drain` | 130ms | The old place letting go |
| `--dur-comet` | 230ms | The trip, whatever the distance |
| `--dur-fill` | 140ms | The new place lighting |
| `--dur-burst` | 200ms | The flash on arrival |
| `--dur-wash` | 260ms | Light falling onto what changed |
| `--dur-content` | 200ms | The content fade |
| `--delay-content` | 60ms | When the content fade starts |
| `--delay-fill` | 170ms | When the new place starts to fill |
| `--delay-burst` | 210ms | When the burst lands |
| `--delay-wash` | 200ms | When the wash starts |
| `--ease-travel` | cubic-bezier(0.45, 0, 0.25, 1) | The comet, slow to start and slow to stop |

Light tokens to add (Dusk, then Dawn):

| Token | Dusk | Dawn |
| --- | --- | --- |
| `--spark` | #ffffff | #e0408a |
| `--spark-tail` | rgba(255, 214, 234, 0.55) | rgba(154, 92, 255, 0.5) |
| `--spark-glow` | drop-shadow(0 0 4px rgba(255, 255, 255, 0.9)) drop-shadow(0 0 10px rgba(255, 47, 146, 0.65)) | drop-shadow(0 0 0 transparent) |
| `--gold-head`, `--gold-tail` | #fff4c2, rgba(255, 213, 77, 0.65) | #b86a12, rgba(217, 164, 58, 0.6) |
| `--cyan-head`, `--cyan-tail` | #e6fbff, rgba(79, 227, 255, 0.6) | #1d6a80, rgba(42, 143, 168, 0.55) |
| `--red-head`, `--red-tail` | #ffe1de, rgba(255, 93, 80, 0.6) | #b8263a, rgba(217, 73, 63, 0.55) |
| `--wash-strength` | 0.24 | 0.14 |
| `--wash-blend` | screen | multiply |
| `--flash` | #ffffff | #ffffff |
| `--unlit` | rgba(255, 255, 255, 0.16) | #d3ccdc |
| `--ink-glow` | 0 0 8px rgba(43, 228, 255, 0.7) | 0 0 #0000 |
| `--split-cyan`, `--split-pink` | rgba(43, 228, 255, 0.6), rgba(255, 47, 146, 0.6) | rgba(42, 143, 168, 0.45), rgba(240, 85, 155, 0.45) |
| `--split-cyan-0`, `--split-pink-0` | the same colours at alpha 0 | the same colours at alpha 0 |
| `--sheen-a` to `--sheen-d` | #4fe3ff, #bb90ff, #ff5fae, #ffb35c | #2a8fa8, #8a62d6, #e0408a, #d07a1f |
| `--lamp-afterglow` | 0 0 18px 4px rgba(255, 47, 146, 0.9) | 0 0 0 3px rgba(240, 85, 155, 0.45) |
| `--pip-afterglow` | 0 0 14px 3px rgba(122, 162, 255, 0.85) | 0 0 0 3px rgba(74, 114, 217, 0.4) |
| `--use-afterglow` | 0 0 14px 3px rgba(79, 227, 255, 0.8) | 0 0 0 3px rgba(42, 143, 168, 0.4) |

Under reduced transparency, set `--spark-glow` to the Dawn value and `--wash-strength` to 0.

### 3.2 The engine

Add `packages/ui/src/motion/lightRail.ts` and export it from `packages/ui/src/index.ts`. Port it from `mockup/src/p6-core.js` and the helpers at the top of `mockup/src/p9b-more.js`.

- `canMove()` returns false when `matchMedia("(prefers-reduced-motion: reduce)")` matches, when `Element.prototype.animate` is missing (jsdom has none, so every existing unit test keeps passing), when `document.visibilityState` is hidden, or when the motion gate (3.4) is closed. Check the media query on every call; people change it with the app open.
- The global reduced-motion rule (design-tokens.css:1074) only shortens CSS animations and transitions. The Web Animations API ignores it, so `canMove()` is the only guard for the light.
- `rel(el, host)` gives an element's box in a positioned host's coordinates, including the host's scroll offset.
- The parts: `comet`, `burst`, `pop`, `wash`, `fill`, `drain`, `fadeIn`, `fadeOut`, `countUp`, `rollTo`, `sheen`, `splitIn`, `splitOut`, `cool`, `warm`, `flip`, `floatText`, `lightLine` and `stripSwitch`. Each takes a host and options and returns the Animation (or a promise for `countUp`).
- A comet's tail is as long as the trip, capped at 260 px (320 on the table screen). It stretches to full length at 65% of the time and shrinks into its head on arrival, as in the mockup.
- Throwaway elements get `aria-hidden="true"` and `pointer-events: none`, and are removed when their animation finishes or is cancelled.
- Read durations from the tokens with `getComputedStyle(host)` so Dawn or a later setting can change them. If that proves slow during a busy turn, mirror them as constants with a unit test that parses design-tokens.css and compares.
- Style the parts in a new `packages/ui/src/styles/light-rail.css`, imported next to design-tokens.css, using tokens only. Port from `mockup/src/p4-fx.css`. Prefix the classes `lr-` (the mockup's `.fx`, `.comet` and `.burst` are too generic for the app).

### 3.3 Hooks

Also in `packages/ui/src/motion/`, because primitives need them:

- `usePrevious(value)`, and `useOnChange(value, (previous, next) => ...)` that skips the first render. LifeBar.tsx:75 already does this by hand and can move to the hook.
- Run light in a `useLayoutEffect` after the new state is in the DOM: measure, then animate. Components keep rendering exactly as they do now; light is added on top.

### 3.4 Triggers, and when not to animate

State arrives as a whole projection on `state:updated` (apps/client/src/shell/useSession.ts:104, and apps/client/src/sheet-main.tsx:31 for the separate sheet window). Short-lived events arrive on `table:event` (packages/domain/src/socket.ts:244; kinds damage, heal, save, action, condition, reaction, effect and death-save, each with `actorIds` and `text`), `log:entry` (apps/client/src/encounter/CombatLog.tsx:49), `codex:changed` and `sound:changed`.

There are three kinds of trigger:

1. Local changes such as tabs, routes, overlays and controls. The component that changes runs the light.
2. Server state changes such as the turn, the round, lamps, hit points, conditions, the order, presence and slots. The component compares the previous and next value.
3. Events (`table:event`, `log:entry`). Subscribe where the moment lives.

Add a motion gate. A whole projection can change many things at once: on connect, on reconnect, after a tab comes back from the background, or when the GM switches scene. Lighting all of those at once is noise. `useSession` closes the gate when the socket connects or reconnects and opens it one animation frame after the first `state:updated` has rendered. While it's closed, `canMove()` returns false. Never animate on first mount either: opening a sheet shouldn't play healing from 0.

### 3.5 Where light is drawn

- The horizon: the top bar's bottom line (apps/client/src/shell/app-bar.css:22 paints it with `--grad-horizon`). On a phone the sections are bottom tabs, and the comet still runs along the top horizon at the tapped tab's x, as in the mockup's phone frame.
- Tab strips: the strip's bottom line, inside the `Tabs` primitive.
- Overlays: a new 2px top edge on Modal, Menu, Drawer and Toast.
- The pane: only the wash overlay.
- Every host is positioned. Parts are placed in host coordinates. When the host scrolls, `rel` accounts for it and the parts scroll with the content.

### 3.6 Reduced motion, reduced transparency and Dawn

- Reduced motion: no light at all, and content swaps instantly.
- Reduced transparency: no wash and no glow; comets and bursts stay as flat colour.
- Dawn: no glow. The comet's head is a saturated pink so it reads on pale surfaces, and the wash is about half as strong with a multiply blend.

## 4. Motion that exists today

| What | Where | What happens to it |
| --- | --- | --- |
| Pane scanline wipe | apps/client/src/styles.css:103-140 (`pane-wipe`, `--pane-wipe-band`) | Remove. `.app-pane > .anim-view` keeps an opacity fade timed by `--delay-content` and `--dur-content`. |
| View, popover, dialog and sheet entrances | design-tokens.css, about lines 1026-1046 (`.anim-view`, `.anim-popover`, `.anim-dialog`, `.anim-sheet`) | Keep as the content part. Overlays add the edge light. |
| View swap cascade | design-tokens.css, about line 1058 (`.anim-cascade`) | Keep. It belongs to arrival. |
| Tab underline | packages/ui/src/primitives/Tabs.css:83 and :92 (inset box-shadow) | Replace with an ink element. |
| Turn rise in the order | apps/client/src/encounter/InitiativeList.css:44 (`init-turn-rise`) | Replace with Next turn. |
| Token ring pulse on a new turn | apps/client/src/scene/encounter-map.css:297 | Keep. It plays once. |
| Table screen turn pulse | apps/client/src/viewer/viewer.css:202 | Keep. It plays once. |
| Roll flare | apps/client/src/dice/dice-panel.css:268 | Replace with A roll lands. |
| Table screen roll card landing | apps/client/src/viewer/screen-parts.css:213 | Replace with A roll lands. |
| Life bar damage flash | packages/ui/src/primitives/LifeBar.css:54 and LifeBar.tsx:75 | Keep, and add the comet. |
| Map ping | apps/client/src/scene/annotation.css:92 (`infinite`) | Replace with Ping. |
| Table screen ping | apps/client/src/viewer/viewer.css:251 (five pulses) | Replace with Ping. |
| Skeleton sweep | packages/ui/src/primitives/Skeleton.css:29 (`infinite`) | Replace with Loading. |
| Attention flash | design-tokens.css (`.is-flashing`, 1.2 s) | Leave for now; check it against the rules in phase 0. |
| Arrival sequences | apps/client/src/shell/landing.css (`entry-*`, `landing-*`) | Out of scope. The sunset scene owns arrival. |
| Drawer slide | packages/ui/src/primitives/Drawer.css:20 | Keep the slide and add the edge light. |

## 5. Phases

Phases 0 and 1 come first, because everything else uses them. After that the order is a suggestion; the user may want combat (phases 3 to 5) before the rest.

### Phase 0: foundation

- Tokens (3.1), `light-rail.css`, the engine (3.2), the hooks (3.3), and the motion gate wired into `useSession` (3.4).
- An ADR at the next free number in docs/adr (0045 when this was written), titled "Light rail motion", from docs/adr/template.md:
  - Context: the scanline wipe read as a CRT, and the user ran three rounds of options. Round one compared Chroma settle, Horizon glint and Tape shuttle. Round two compared four takes on the glint: Glint refined, Light rail, Horizon bloom and Chrome catch.
  - Decision: Light rail.
  - Consequences: the timing rule changes as in section 1, and decorative light never blocks input.
  - Mobile, security and visibility: no new data reaches any audience. Damage numbers appear only where the viewer's projection already has exact hit points (section 6, answer 2).
  - Reversibility: the light is tokens plus one engine, and reduced motion turns it off.
  - Add the ADR's row to docs/adr/README.md.
- Rewrite the Motion section of docs/DESIGN.md (line 326) with the ten rules from the mockup's Rules section (below the player) and the timing token table. Replace "Tabs and panels fade in over 120 ms" and the 120 to 200 ms rule. Keep the sun frame and life bar lines, reworded for Light rail.
- Tests:
  - Engine unit tests: comet keyframes for both directions and the length cap, drain and fill origins by direction, `flip` deltas, and `canMove()` returning false under reduced motion and without `animate`. apps/client/test/viewport.ts already stubs `matchMedia`.
  - Confirm check (d) scans `light-rail.css`; add it to the scan if not.
- Smoke: the projects in e2e/playwright.config.ts set no `reducedMotion`, and e2e/themes.spec.ts:70 samples pixels from a screenshot, so a wash in flight could tint a sample. Either set `reducedMotion: "reduce"` on the existing projects, or have the samples wait until `document.getAnimations().length === 0`. Add one journey with motion on that switches sections and tabs, then asserts there were no console errors and no `.lr-*` element is left behind.

### Phase 1: navigation (group 1)

- `Tabs` (packages/ui/src/primitives/Tabs.tsx and Tabs.css):
  - Add an `.nh-tabs-ink` element inside the bar, placed from the active tab's offsetLeft and offsetWidth. In vertical orientation use offsetTop and offsetHeight with the ink on the left edge. The existing ResizeObserver keeps it in place.
  - On an `activeId` change, run `stripSwitch`: the old ink drains toward the trip, a comet runs along the bar's line, a burst lands and the new ink fills from the side the light arrived on.
  - The bar scrolls the active tab into view smoothly (Tabs.tsx:78). Either scroll with `behavior: "auto"` when light will run, or host the parts inside the scrolling bar so they move with it.
  - Remove the inset box-shadow underline (Tabs.css:83 and :92) but keep `--tab-on` and its sheen.
  - The top bar's sections (apps/client/src/shell/AppBar.tsx `SectionTabs`) and every in-page strip use `Tabs`, so this one change lights all of them. On a phone the bottom tabs' ink sits on their top edge.
- Page change: `SectionTabs` hands the tab's x to a shell-level page light (a small store or context). It runs the comet and burst along the top bar's horizon, the wash in `.app-pane` and the content fade. Remove the scanline wipe.
- Open a record and Go back, for the Compendium and Codex lists.
- The search launcher, apps/client/src/shell/SearchLauncher.tsx, once phase 2's overlay edge exists.
- Acceptance:
  - Switching sections and tabs at 390 and 1280 px matches the mockup at real speed and at 6x (Chrome DevTools Animations panel at 10%).
  - No light runs under reduced motion.
  - No fixed overlay moves during a page change.
  - Existing tests pass.

### Phase 2: overlays (group 2)

- One shared `OverlayEdge` (a 2px horizon line, `.lr-edge`) for Modal (centred and bottom), Menu, Drawer and Toast.
- The opener: record `document.activeElement` when an overlay opens. The edge fills outward from the opener's x, clamped inside the surface. With no opener, as with a toast, fill from the left behind a comet.
- Closing: the edge drains back to its origin while the surface fades. Modal is a native `<dialog>` (Modal.tsx calls `showModal()` and `close()`), so delay `close()` until the drain finishes. Escape and the backdrop must keep working, and under reduced motion the dialog closes at once.
- Acceptance: focus handling is unchanged, and packages/ui/src/primitives/behaviour.test.tsx passes.

### Phase 3: turn flow and initiative (groups 3 and 11)

- TurnOrder and InitiativeList: the sun frame keeps its 200 ms slide, with a comet and burst along the order's rail. When the round wraps, the comet runs back to the VCR counter.
- VcrCounter (packages/ui/src/primitives/VcrCounter.tsx): the digits roll on a round change and when STOP and PLAY swap.
- Lamp (packages/ui/src/primitives/Lamp.tsx): `warm` when a lamp lights, and `cool` with an afterglow when it's spent. At the start and end of an encounter the four lamps light or cool in order.
- PlayerTurnCard: the YOUR TURN sheen plays once when the turn becomes yours.
- ReactionPrompt: the Reaction lamp lights, and the prompt's edge fills from the lamp.
- Order changes slide with `flip`, covering joins, falls and swaps. Legendary pips cool and recharge where they show.

### Phase 4: hit points and conditions (group 5)

- LifeBar: a comet runs from the old value to the new along the bar, red for damage and gold for healing, and regained segments fill behind it. Also the temporary hit points line and the drain to 0.
- DyingTracker: each pip fills with a pop, and three successes light STABLE.
- EffectChips: Chroma settle when a chip arrives; the split as it leaves when concentration breaks.
- Visibility: when a player sees a creature's health as a band, animate the band and never show a number. Check both health display settings.

### Phase 5: dice, attacks and requests (groups 4, 10 and 12)

- DicePanel and ScreenParts: a comet runs to the total, which counts up over 300 ms (`--dur-count` exists for the table screen). A natural 20 gets the two-frame flash and a gold double burst, and a natural 1 sends the light back. With advantage, light runs from the dropped die to the kept one.
- RollCallPanel and RollCallPrompt: answers drop in, and a comet runs under the list when all are in.
- ActionResultCard and the map: the aim line, hit, critical hit, miss, and held then released (DamageLook, PendingDamagePrompt).
- SavePrompt, RuleAsk and the player's waiting states: a comet runs along the horizon and the prompt rises; the answer goes back the other way; WAIT sits on an unlit line until it's settled.
- Damage numbers, as the mockup's Hit and Critical hit show them:
  - When damage lands, the number rises from the target's token on the map with `floatText`: gold numerals in `--font-numeric` with a dark drop shadow, about 32 px, and about 46 px on a critical hit. It starts 20 ms after the burst, reaches full opacity within about 200 ms, drifts up 26 px and is gone by 900 ms. The mockup's #ffd54d is `--hp-text` in design-tokens.css (line 69, with a darker Dawn value at line 491), so use that rather than a new colour.
  - The 900 ms is the one exception to the 500 ms light rule, because the number is a value someone has to read. It never blocks input, and the same value stays in the result card and the log.
  - Compute the number on the client from the drop in hit points between the previous and next projection for that actor (temporary hit points included). Add no field to `TableEvent` or any projection.
  - Show it only where that viewer already has exact hit points. The GM always sees it. A player sees it for their own character and for creatures their projection shows with numbers. The table screen follows its health display setting. Where a creature shows as a band (`actor.set-health-display` or `encounter.set-health-display`), play the burst and the band's drain with no number. Test each case.
  - Healing shows no rising number; the gold comet along the life bar (phase 4) covers it.

### Phase 6: map and table screen (group 6, plus the camera from group 14)

- EncounterMap:
  - Tokens glide in 240 ms with a fading trail.
  - Doors swing, lights fade up, spell zones spread and traps flash.
  - A one-pass ping replaces both loops.
- FogOverlay: a reveal sweeps from the side it opened from, behind an edge of light.
- ViewerApp: a scene change is the big horizon sweep.
- ViewerApp camera glide, which the user approved: when the table screen follows the GM's camera (ViewerApp.tsx, camera at :34 and the follow setting at :124), it glides to the new view over 320 ms on `--ease-travel` instead of jumping, and a wash falls on the screen as it settles (280 ms, starting at 300 ms). If the camera moves again mid-glide, cancel the running animation and start the next glide from where the view is now. Animate the map's transform layer only, never the screen's pane. Under reduced motion it jumps as it does today. A scene change uses the scene sweep instead of the glide.
- The map is DOM and SVG (ADR 003). Animate SVG with the Web Animations API on transform and CSS properties; `stroke-dashoffset` works for the trail.

### Phase 7: Codex, log and the table's people (groups 7, 13 and 14)

- The Codex reveal on the player's page, and the unread badge arriving.
- CombatLog: entries slide in at the top, the unread count rolls, and chat send lights the new line.
- AppBar: presence squares warm and cool, the table screen lamp lights and ON and OFF roll. ClaimCharacter lights the claimed card.

### Phase 8: character, rest, time, prep, sound, replay, controls and status (groups 8, 9 and 15 to 18)

- Uses and slot pips cool and relight, rests relight them in order, and Heroic Inspiration, experience and level each get their moment.
- HitPointDice, exhaustion and holding breath.
- Time passing (`time.pass`): each effect's remaining duration rolls down with `rollTo` by the time that passed, wherever durations show (EffectChips.tsx and the sheet). An effect that runs out leaves with the chroma split. Add no world clock readout; the user chose effect durations only.
- Steps in the builder, AbilitiesStep, EncounterMeter, and MapTokenTray with StagingTray.
- NowPlaying and ReplayStage.
- Switch, Checklist, JoinAddress, and drag reorder.
- ReconnectBar gets its own line, lit by a comet when the connection is back. Skeleton gets one comet and no loop.

## 6. Answers from the user

The user answered the four open questions on 2026-10-28.

1. Branch: `claude/friendly-babbage-g7gcge`, the branch the research was done on. Another session is working on it too; follow the sharing rules in section 2.
2. Damage numbers: yes, the way the mockup shows them, with one limit. The number shows only where the viewer already has exact hit points: always for the GM, for players on their own character and on creatures shown with numbers, and on the table screen according to its health display. Everywhere else the burst and the bar or band drain play with no number. Phase 5 has the details.
3. Camera: glide when the table screen follows the GM's camera, over 320 ms, with a wash where it settles. Phase 6 has the details.
4. Time: animate effect durations only. Don't add a world clock. Phase 8 has the details.

## 7. Verification for every phase

- `npm run lint`, `npm run check`, `npm test` and `npm run format:check`.
- `npm run build`, then `npm run smoke`.
- By hand at 390 px with touch and at 1280 px, in Dusk and Dawn, with reduced motion on and off and reduced transparency on. Compare against the mockup with the DevTools Animations panel at 10%.
- No `.lr-*` element is left in the DOM after a moment.
- No layout shift: light never moves or resizes content.
- Performance: one moment creates about six elements at most and animates transform, opacity, or clip-path on small elements. Check a busy combat turn with DevTools CPU throttling at 4x.
## Appendix A: every moment
Names, timings and descriptions are copied from the mockup. Timing is how long the light lasts, from the trigger to the last fade. Content is in place within 300 ms in every case. NEW means nothing animates there today. RESTYLE means something does, and it changes to Light rail. REPLACES means a current animation goes away.

### Anatomy

A page change shows all six parts. Every other moment uses some of them, in the same order.

- All six parts (ANATOMY, 460 ms). The old place drains, a comet runs along the horizon, the new place fills and a burst lands. A wash falls onto the content as it fades in. The chart's playhead follows along.
  - Where: reference only.
  - Trigger: none, because this is the anatomy demo.
  - Mockup key: `anatomy.play`.

### Group 1: Navigation

Light travels along the line you tapped on, from where you were to where you're going.

- Change page (REPLACES WIPE, 460 ms). The old section's underline drains into a comet that runs along the horizon and fills the new one from the side it arrived on. A short wash falls onto the page as it fades in.
  - Where: packages/ui/src/primitives/Tabs.tsx and Tabs.css (the ink and strip switch); apps/client/src/shell/AppBar.tsx `SectionTabs`; the pane wash overlay in the shell (apps/client/src/shell/App.tsx renders `.app-pane`); remove the wipe in apps/client/src/styles.css:103-140.
  - Trigger: the section tab's `activeId` changes (route change from the top bar or bottom tabs).
  - Mockup key: `nav.page`.

- Change tab (NEW, 380 ms). The same trip along the bottom edge of the tab strip. The panel fades in as the light lands.
  - Where: packages/ui/src/primitives/Tabs.tsx; every tab strip inherits it: apps/client/src/sheet/SheetTabs.tsx, the Compendium and Codex section bars, the GM sidebar.
  - Trigger: a `Tabs` `activeId` change inside a page.
  - Mockup key: `nav.tab`.

- Open a record (NEW, 420 ms). Light runs along the row you picked, then falls from the bar above as a wash while the record fades in. There's no sideways comet, since you moved deeper into the same section.
  - Where: Compendium list to record and Codex list to page (apps/client/src/compendium/, apps/client/src/codex/); the row's click handler captures the row before navigating.
  - Trigger: navigation deeper inside the same section (the section tab doesn't change).
  - Mockup key: `nav.open`.

- Go back (NEW, 300 ms). The list fades back in and the light runs back along the row you came from, so you can see where you were.
  - Where: same places as Open a record; restore scroll to the row before lighting it.
  - Trigger: navigation back up to the list the record came from.
  - Mockup key: `nav.back`.

- Search (NEW, 320 ms). The launcher's top edge fills outward from the point under the search button, with a burst where it starts. Closing drains it back to that point.
  - Where: apps/client/src/shell/SearchLauncher.tsx, through the overlay edge in phase 2.
  - Trigger: the launcher opens or closes.
  - Mockup key: `nav.search`.

### Group 2: Overlays

Every surface that opens above the page gets a horizon line along its top edge, lit from the control that opened it.

- Dialog (RESTYLE, 340 ms). The dialog rises 8 px as it fades in, and its top edge fills outward from above the button you pressed.
  - Where: packages/ui/src/primitives/Modal.tsx and Modal.css (centred dialogs, `anim-dialog`).
  - Trigger: the dialog opens; the opener is `document.activeElement` at open time.
  - Mockup key: `ov.dialog`.

- Menu (RESTYLE, 280 ms). The menu's top edge fills outward from the button it hangs from, over a shorter 200 ms.
  - Where: packages/ui/src/primitives/Menu.tsx (`anim-popover`).
  - Trigger: the menu opens from its trigger button.
  - Mockup key: `ov.menu`.

- Drawer (RESTYLE, 300 ms). The drawer slides in from the right, and a comet runs along its top edge in the same direction.
  - Where: packages/ui/src/primitives/Drawer.tsx and Drawer.css.
  - Trigger: the drawer opens.
  - Mockup key: `ov.drawer`.

- Phone sheet (RESTYLE, 300 ms). The sheet slides up from the bottom, with its top edge filling outward from the button that opened it.
  - Where: Modal.tsx with `align="bottom"` (`anim-sheet`), for example apps/client/src/sheet/CharacterSheet.tsx:769.
  - Trigger: the bottom sheet opens.
  - Mockup key: `ov.sheet`.

- Toast (RESTYLE, 340 ms). The toast rises, and a comet runs along its top edge from left to right. When it leaves, the line drains first.
  - Where: packages/ui/src/primitives/Toast.tsx (`anim-sheet` on `.nh-toast`).
  - Trigger: a toast is shown, and again when it times out.
  - Mockup key: `ov.toast`.

- Closing (NEW, 160 ms). Any of these drains its line back to where it started while the surface fades. Press the close button or outside the surface.
  - Where: Modal, Menu, Drawer and Toast close paths. Modal uses a native `<dialog>` and `showModal()`, so `close()` must wait until the drain and fade finish.
  - Trigger: any of these closes.
  - Mockup key: `ov.close`.

### Group 3: Turn flow

The turn order is a rail. Light moves along it whenever the turn or the round changes, and the lamps light and cool like a cabinet's bulbs.

- Next turn (RESTYLE, 400 ms). The sun frame slides to the next tile as it does today, with a comet under the tiles and a burst where it lands. The new creature's lamps light in order.
  - Where: apps/client/src/encounter/TurnOrder.tsx and InitiativeList.tsx (replaces `init-turn-rise`, InitiativeList.css:44); the map ring pulse in apps/client/src/scene/encounter-map.css:297 stays.
  - Trigger: the combat's acting creature changes within a round.
  - Mockup key: `tf.next`.

- New round (NEW, 520 ms). After the last tile, the comet runs all the way back to the round counter. RND 03 rolls over to RND 04 like a tape counter as the sun frame returns to the top of the order.
  - Where: TurnOrder/InitiativeList plus packages/ui/src/primitives/VcrCounter.tsx (the digit roll).
  - Trigger: the round number increases.
  - Mockup key: `tf.round`.

- Start encounter (NEW, 640 ms). STOP becomes PLAY and RND 01 rolls in. A comet runs from the counter to the first tile, and the four lamps light one after another, Action to Move.
  - Where: VcrCounter.tsx, TurnOrder, packages/ui/src/primitives/Lamp.tsx.
  - Trigger: combat goes from none to running (encounter.start).
  - Mockup key: `tf.start`.

- End encounter (NEW, 520 ms). The lamps go dark from Move back to Action and the sun frame drains. A comet returns to the counter as PLAY turns to STOP.
  - Where: same as Start encounter.
  - Trigger: combat goes from running to none (encounter.end).
  - Mockup key: `tf.end`.

- Use an action (NEW, 320 ms). The Action lamp switches off with a short afterglow, like a cabinet bulb cooling.
  - Where: Lamp.tsx and apps/client/src/encounter/LampToggle.tsx.
  - Trigger: a lamp goes from lit to spent.
  - Mockup key: `tf.use`.

- YOUR TURN (NEW, 440 ms). The chrome lettering catches one sweep of the horizon's colours when your turn starts. It's round two's Chrome catch, kept for the lettering whose job is showing who's acting.
  - Where: apps/client/src/encounter/PlayerTurnCard.tsx (the YOUR TURN chrome lettering).
  - Trigger: the player's own creature becomes the acting one.
  - Mockup key: `tf.yours`.

- Reaction prompt (NEW, 380 ms). The Reaction lamp lights with a burst, and the prompt opens below with its top edge filling outward from the lamp.
  - Where: apps/client/src/encounter/ReactionPrompt.tsx and Lamp.tsx.
  - Trigger: a reaction prompt appears for this player.
  - Mockup key: `tf.reaction`.

### Group 4: Dice and checks

A roll is light arriving at a number. The light runs to the total, and the total counts up as it lands.

- A roll lands (RESTYLE, 420 ms). A comet runs along the card's top edge to the total, which counts up over 300 ms as the burst lands.
  - Where: apps/client/src/dice/DicePanel.tsx (replaces `roll-flare`, dice-panel.css:268) and apps/client/src/viewer/ScreenParts.tsx (replaces `screen-roll-land`, screen-parts.css:213).
  - Trigger: a new roll appears in the audience's projection.
  - Mockup key: `dc.roll`.

- Natural 20 (NEW, 520 ms). The card flashes white once, for two frames, and the burst over the total lands twice as wide. NAT 20 lights beside the check.
  - Where: same as A roll lands.
  - Trigger: the kept d20 shows 20.
  - Mockup key: `dc.nat20`.

- Natural 1 (NEW, 360 ms). The light goes the other way. The card's top edge drains back toward the die, and the total dims briefly before settling.
  - Where: same as A roll lands.
  - Trigger: the kept d20 shows 1.
  - Mockup key: `dc.nat1`.

- Advantage (NEW, 440 ms). Both dice land, then light runs from the die that doesn't count to the one that does. The dropped die dims to 40%. Disadvantage runs the same way toward the lower die.
  - Where: same as A roll lands.
  - Trigger: a roll with two d20s, one kept.
  - Mockup key: `dc.adv`.

- Roll call (NEW, as answers come). Each answer drops into the list as it arrives. When the last one lands, a comet runs under the whole list and the header reads All in.
  - Where: apps/client/src/dice/RollCallPanel.tsx and apps/client/src/encounter/RollCallPrompt.tsx.
  - Trigger: a roll call answer arrives; the last answer.
  - Mockup key: `dc.call`.

### Group 5: Hit points and conditions

The life bar is a rail. Light runs along it from the old value to the new one, in the direction the hit points moved.

- Damage (RESTYLE, 400 ms). The lost segments flash white for two frames, as today. A comet then runs left along the bar to the new value and bursts there.
  - Where: packages/ui/src/primitives/LifeBar.tsx (the white flash already exists: LifeBar.tsx:75 and LifeBar.css:54).
  - Trigger: `current` decreases.
  - Mockup key: `hp.damage`.

- Healing (NEW, 400 ms). A gold comet runs right from the old value, and the regained segments fill in behind it.
  - Where: LifeBar.tsx.
  - Trigger: `current` increases.
  - Mockup key: `hp.heal`.

- Temporary hit points (NEW, 360 ms). A cyan line draws along the top of the bar with its own comet, and the TEMP readout appears.
  - Where: LifeBar.tsx (temporary hit points) and apps/client/src/sheet/HitPoints.tsx.
  - Trigger: temporary hit points go from 0 to more.
  - Mockup key: `hp.temp`.

- Dropping to 0 (NEW, 520 ms). The bar drains to empty and the portrait dims. The death save pips fade in under it.
  - Where: LifeBar.tsx, the Portrait primitive and apps/client/src/encounter/DyingTracker.tsx.
  - Trigger: hit points reach 0.
  - Mockup key: `hp.down`.

- Death saves (NEW, 300 ms). Each save fills its pip with a burst, cyan for a success and red for a failure. Three successes light STABLE.
  - Where: apps/client/src/encounter/DyingTracker.tsx.
  - Trigger: a death save success or failure is recorded.
  - Mockup key: `hp.saveok` and `hp.savebad`.

- A condition arrives (NEW, 200 ms). The chip arrives with round one's Chroma settle split, pink and cyan, which settles as it fades in.
  - Where: apps/client/src/encounter/EffectChips.tsx.
  - Trigger: a condition or effect is added.
  - Mockup key: `hp.cond`.

- Concentration breaks (NEW, 300 ms). The chip's edge drains away and the chip splits apart as it fades.
  - Where: EffectChips.tsx (the concentration chip).
  - Trigger: concentration ends.
  - Mockup key: `hp.conc`.

### Group 6: Map and table screen

On the map, light follows what moved. Tokens glide, areas open from the side they were opened from, and the table screen gets the one big version.

- Token moves (NEW, 300 ms). The token glides along its path in 240 ms, and a trail in its ring colour draws behind it and drains from the start.
  - Where: apps/client/src/scene/EncounterMap.tsx (token rendering).
  - Trigger: a token's square changes; glide along the path when the move carries one, otherwise straight.
  - Mockup key: `map.move`.

- Fog clears (NEW, 340 ms). The revealed room opens from the door side, with a thin edge of light moving across ahead of the reveal.
  - Where: apps/client/src/scene/FogOverlay.tsx.
  - Trigger: fog strokes or explored vision reveal new squares.
  - Mockup key: `map.fog`.

- Door opens (NEW, 200 ms). The door swings on its hinge with a small burst at the hinge.
  - Where: door rendering in EncounterMap.tsx (apps/client/src/scene/DoorMenu.tsx sets it).
  - Trigger: a door's state becomes open.
  - Mockup key: `map.door`.

- Light source (NEW, 280 ms). The torch's light fades up from the token as it grows to its full radius.
  - Where: the light layer in EncounterMap.tsx.
  - Trigger: a light is added or an item's light turns on.
  - Mockup key: `map.light`.

- Spell zone (NEW, 300 ms). A 20-foot Fireball spreads out from its point of origin, and its edge fills in behind the spread.
  - Where: apps/client/src/encounter/SpellAreas.tsx.
  - Trigger: a spell zone is placed.
  - Mockup key: `map.zone`.

- Trap springs (NEW, 240 ms). One red flash on the square, then the trap mark appears.
  - Where: trap rendering in EncounterMap.tsx.
  - Trigger: a trap springs (trap.spring).
  - Mockup key: `map.trap`.

- Ping (REPLACES LOOP, 600 ms). One ring spreads and fades, once. Today the map's ping pulses until it's removed and the table screen's pulses five times.
  - Where: apps/client/src/scene/MapAnnotationLayers.tsx and annotation.css:92 (infinite pulse); apps/client/src/viewer/viewer.css:251 (pulses five times).
  - Trigger: a ping is added.
  - Mockup key: `map.ping`.

- Scene change (NEW, 700 ms). Table screen only. A comet crosses the whole screen along the horizon and uncovers the new map behind it, and a wash falls as it lands.
  - Where: apps/client/src/viewer/ViewerApp.tsx.
  - Trigger: the table screen's scene or map changes.
  - Mockup key: `map.scene`.

### Group 7: Codex

Something new in the Codex arrives the way a page does, with light running to it.

- A GM reveal (NEW, 460 ms). On a player's screen, the revealed block fades in under a comet along its top edge and a wash that falls onto it. It brightens once and settles.
  - Where: the player's Codex page view (apps/client/src/codex/page/).
  - Trigger: after `codex:changed`, the refetched page has a block the player didn't have before.
  - Mockup key: `cx.reveal`.

- New pages (NEW, 400 ms). A comet runs along the Codex's own bar to Pages and bursts there as the 2 NEW count arrives. From another section, the same comet runs along the horizon and ends at Codex.
  - Where: the Codex unread badge (apps/client/src/shell/App.tsx:99 and :152 pass `recap.unread`) and the Codex section bar.
  - Trigger: the unread count increases.
  - Mockup key: `cx.new`.

### Group 8: Character and rest

Resources are lamps and pips. Spending one cools it, and a rest relights them in order.

- Spend a slot (NEW, 320 ms). The pip goes dark with a short afterglow.
  - Where: apps/client/src/sheet/Uses.tsx and the spell slot pips (apps/client/src/sheet/SpellsTab.tsx, CastDetail.tsx).
  - Trigger: a slot or use goes from available to spent.
  - Mockup key: `rs.spend`.

- Short rest (NEW, 480 ms). Arcane Recovery's use cools, and the slots it recovers relight one after another with a small burst each.
  - Where: apps/client/src/rest/PartyRest.tsx with Uses and the slot pips.
  - Trigger: a short rest finishes and restores uses.
  - Mockup key: `rs.short`.

- Long rest (NEW, 700 ms). Hit points refill along the bar with a gold comet, then every spent pip relights in order.
  - Where: apps/client/src/rest/PartyRest.tsx and LongRestUnderWay.tsx with LifeBar, Uses and the slot pips.
  - Trigger: a long rest finishes.
  - Mockup key: `rs.long`.

- Heroic Inspiration (NEW, 360 ms). A comet runs along the bottom edge of the badge and fills it, then INSPIRED lights.
  - Where: where Heroic Inspiration shows (apps/client/src/sheet/PlayFight.tsx, CharacterSheet.tsx).
  - Trigger: Heroic Inspiration goes from none to held.
  - Mockup key: `rs.insp`.

- Experience (NEW, 420 ms). The experience bar fills with a comet to the new total, and the number counts up.
  - Where: apps/client/src/sheet/Experience.tsx.
  - Trigger: experience points increase.
  - Mockup key: `rs.xp`.

- Level up (NEW, 640 ms). The level number rolls over like the round counter with a burst behind it. The experience bar then drains and starts again for the next level.
  - Where: apps/client/src/sheet/LevelBox.tsx and Experience.tsx.
  - Trigger: the level increases.
  - Mockup key: `rs.level`.

### Group 9: Connection and status

Status gets its own lines, so the horizon keeps its one job of marking the top of the app.

- Connection lost (NEW, 240 ms). The reconnecting bar drops in under the top bar. Its own line is grey and unlit while the app waits.
  - Where: apps/client/src/shell/ReconnectBar.tsx.
  - Trigger: the socket disconnects.
  - Mockup key: `st.lost`.

- Back at the table (RESTYLE, 400 ms). A comet runs along the bar's line and lights it in the horizon colours. The bar reads Back at the table for 2 seconds, then drains and goes.
  - Where: ReconnectBar.tsx.
  - Trigger: the socket reconnects (the bar already says Back at the table for 2 seconds).
  - Mockup key: `st.back`.

- Loading (REPLACES LOOP, 300 ms). One comet runs along the top of the loading area when loading starts, and the placeholders stay still. The content fades in over them when it arrives.
  - Where: packages/ui/src/primitives/Skeleton.tsx and Skeleton.css:29 (infinite sweep).
  - Trigger: a skeleton mounts.
  - Mockup key: `st.load`.

### Group 10: Attacks and damage

An attack is light travelling from the attacker to the target. Whether it lands, and how hard, is the result.

- Aim (NEW, 300 ms). Picking a target draws the attack line out from the attacker with a comet at its tip, and the reticle settles onto the target.
  - Where: apps/client/src/encounter/ActionTargetPicker.tsx and the map in EncounterMap.tsx (the attack line).
  - Trigger: a target is picked for an attack or spell.
  - Mockup key: `atk.aim`.

- Hit (NEW, 520 ms). A comet runs down the attack line and bursts on the target. The damage number rises from the token, and its bar drains to match.
  - Where: apps/client/src/encounter/ActionResultCard.tsx (outcome classes in action-runner.css:381) and EncounterMap.tsx. The number shows only where the viewer already has exact hit points (phase 5).
  - Trigger: a resolution with a hit outcome arrives; the number is the hit point drop between projections.
  - Mockup key: `atk.hit`.

- Critical hit (NEW, 600 ms). The same trip with a gold burst twice as wide, and the result card flashes white for two frames. The damage number lands larger.
  - Where: same as Hit, with the same limit on who sees the number.
  - Trigger: a critical hit outcome.
  - Mockup key: `atk.crit`.

- Miss (NEW, 360 ms). The comet runs out of light short of the target and fades. MISS shows at the reticle, and the target's bar doesn't move.
  - Where: same as Hit.
  - Trigger: a miss or fumble outcome.
  - Mockup key: `atk.miss`.

- Held, then released (NEW, 460 ms). While the GM waits on a reaction, the card shows WAIT on a grey, unlit line, and nothing pulses. Press again to release: light runs along the line and the damage lands.
  - Where: apps/client/src/encounter/DamageLook.tsx and PendingDamagePrompt.tsx with ActionResultCard.tsx.
  - Trigger: damage is held on a reaction, then released.
  - Mockup key: `atk.hold`.

### Group 11: Initiative and the turn order

When the turn order changes, the tiles slide to their new places and light runs between them along the rail.

- Roll initiative (NEW, 700 ms). Each tile's number lands in turn. The tiles then slide into order, a comet runs the length of the rail, and the sun frame settles on whoever goes first.
  - Where: TurnOrder.tsx, InitiativeList.tsx and apps/client/src/encounter/InitiativePrompt.tsx.
  - Trigger: initiative values arrive and the order is set.
  - Mockup key: `ini.roll`.

- A creature joins (NEW, 360 ms). The tiles after its place slide apart and the new tile fades into the gap. The rail fills under it with a burst.
  - Where: TurnOrder.tsx and InitiativeList.tsx.
  - Trigger: a combatant is added (encounter.add-combatant).
  - Mockup key: `ini.join`.

- A creature falls (NEW, 420 ms). Its portrait greys and the tile drains away, then the tiles after it slide back to close the gap.
  - Where: TurnOrder.tsx and InitiativeList.tsx.
  - Trigger: a combatant is defeated or removed.
  - Mockup key: `ini.fall`.

- Trading places (NEW, 360 ms). When a readied action or a swap changes the order, the two tiles cross and a comet runs each way along the rail.
  - Where: TurnOrder.tsx and InitiativeList.tsx.
  - Trigger: two combatants change places (initiative.swap, a readied action).
  - Mockup key: `ini.swap`.

- Legendary action (NEW, 320 ms). A pip under the dragon's name cools with an afterglow. Once all three are spent, the next press relights them in order, as at the end of its turn.
  - Where: where legendary actions show (apps/client/src/encounter/ActingConsole.tsx).
  - Trigger: a legendary action is used (turn.use-legendary), or they recharge.
  - Mockup key: `ini.legend`.

### Group 12: Requests to players

A request travels from the GM to a player's phone and the answer travels back, along the top of the screen.

- Save prompt arrives (NEW, 420 ms). A comet runs in along the horizon, and the prompt rises from the bottom with its top edge lit behind it.
  - Where: apps/client/src/encounter/SavePrompt.tsx.
  - Trigger: a save request arrives for this player.
  - Mockup key: `ask.save`.

- The answer goes (NEW, 460 ms). The roll lands in the prompt and counts up. Light then runs back along the prompt's edge toward the GM, and the prompt sinks away.
  - Where: SavePrompt.tsx.
  - Trigger: the player's answer is sent.
  - Mockup key: `ask.answer`.

- Waiting, then done (NEW, 380 ms). A request the GM hasn't settled shows WAIT on a grey line and stays still. When the GM settles it, light runs along the line and WAIT becomes DONE.
  - Where: PendingDamagePrompt.tsx and DamageLook.tsx (the player's side of a held decision).
  - Trigger: the GM settles what the player was waiting on.
  - Mockup key: `ask.wait`.

- A rules answer arrives (NEW, 380 ms). Your question sits under a grey line. The GM's answer arrives beneath it as the line lights from the left.
  - Where: apps/client/src/encounter/RuleAsk.tsx.
  - Trigger: the GM answers a rules question.
  - Mockup key: `ask.rules`.

### Group 13: Log and chat

New lines arrive at the top of the log, and light marks each one as it lands.

- A log entry arrives (NEW, 360 ms). The entries below slide down to make room. The new one fades in with a comet along its lower edge.
  - Where: apps/client/src/encounter/CombatLog.tsx (`log:entry` handler at CombatLog.tsx:49).
  - Trigger: a log entry arrives while the Log is showing.
  - Mockup key: `log.entry`.

- While you're on another tab (NEW, 400 ms). A comet runs along the tab strip from where you are to Log and bursts there, and the count rolls up by one like a tape counter.
  - Where: the GM sidebar's Log tab count and CombatLog.tsx.
  - Trigger: a log entry arrives while another tab is showing.
  - Mockup key: `log.count`.

- You send a message (NEW, 340 ms). The field clears and your message appears at the top. Light runs along its edge from the side the Send button is on.
  - Where: the chat field in the log (chat.send).
  - Trigger: the user sends a message.
  - Mockup key: `log.send`.

### Group 14: The table and its people

The GM's bar shows who's here and what the table screen is doing. Both change with a lamp lighting or cooling.

- A player joins (NEW, 300 ms). Their square brightens, and a line fills under it from the centre with a burst.
  - Where: apps/client/src/shell/AppBar.tsx `app-bar-connected` (AppBar.tsx:120) and the party roster presence.
  - Trigger: a player connects.
  - Mockup key: `tbl.join`.

- A player drops (NEW, 320 ms). Their square cools with a short afterglow, and its line drains.
  - Where: same as A player joins.
  - Trigger: a player disconnects.
  - Mockup key: `tbl.drop`.

- Table screen on or off (NEW, 420 ms). The lamp lights and OFF rolls over to ON, while a comet runs along the preview's horizon and the picture fades up. Turning it off runs the other way.
  - Where: the GM bar's table screen control in AppBar.tsx.
  - Trigger: the table screen turns on or off.
  - Mockup key: `tbl.screen`.

- The screen follows your view (NEW, 360 ms). When the table screen follows the GM's camera, it glides to the new view in 320 ms and a wash falls where it settles.
  - Where: apps/client/src/viewer/ViewerApp.tsx (camera at :34, follow setting at :124). The user approved the glide (phase 6).
  - Trigger: the followed GM camera moves; a new move mid-glide starts from where the view is.
  - Mockup key: `tbl.follow`.

- A character is claimed (NEW, 300 ms). On the join screen, the picked card's top edge fills outward from its centre and the other cards dim.
  - Where: apps/client/src/actors/ClaimCharacter.tsx.
  - Trigger: a character is claimed on the join screen.
  - Mockup key: `tbl.claim`.

### Group 15: Prep and building

Building something is a rail too. Steps, scores and budgets fill as they move.

- Next builder step (NEW, 380 ms). The character builder's step rail does a tab change. The step you finished keeps its tick, and the next step's page fades in.
  - Where: packages/ui/src/primitives/Steps.tsx and apps/client/src/builder/CharacterBuilder.tsx.
  - Trigger: the builder's step changes.
  - Mockup key: `prp.step`.

- Roll ability scores (NEW, 560 ms). The six scores land one after another, each counting up with a small burst.
  - Where: apps/client/src/builder/AbilitiesStep.tsx.
  - Trigger: rolled scores arrive (builder.roll-abilities).
  - Mockup key: `prp.roll`.

- Encounter budget rises (NEW, 380 ms). Adding a monster runs a comet out to the meter's new level. Crossing into a new band rolls the band's name over.
  - Where: apps/client/src/encounter/EncounterMeter.tsx (bands at :144).
  - Trigger: the budget value changes, and when it crosses a band.
  - Mockup key: `prp.meter`.

- A token is placed (NEW, 240 ms). A token dropped from the staging tray settles into its square with a burst.
  - Where: apps/client/src/scene/MapTokenTray.tsx and apps/client/src/scenes/StagingTray.tsx.
  - Trigger: a token is dropped onto a square.
  - Mockup key: `prp.place`.

### Group 16: Time and survival

Time is a counter. When it moves, every duration it touches moves with it.

- Time passes (NEW, 420 ms). When the GM passes time, each effect's duration rolls down by the time that passed, and an effect that runs out splits apart as it goes. There's no world clock.
  - Where: effect durations in EffectChips.tsx and wherever the sheet shows them. The user chose durations only, so add no world clock.
  - Trigger: time passes (time.pass).
  - Mockup key: `tim.pass`.

- Hit dice spent (NEW, 380 ms). A hit die cools with an afterglow, and a gold comet runs along the life bar to the healed value.
  - Where: apps/client/src/sheet/HitPointDice.tsx with LifeBar.
  - Trigger: a hit die is spent.
  - Mockup key: `tim.hd`.

- Exhaustion (NEW, 260 ms). The next level's pip fills red with a burst, and the penalty line updates.
  - Where: apps/client/src/sheet/StatusStrip.tsx and ChecksTab.tsx.
  - Trigger: the exhaustion level rises.
  - Mockup key: `tim.exh`.

- Holding breath (NEW, 260 ms). The rounds left roll down one at a time and the line under them drains a third. At zero the counter turns red and reads CHOKING.
  - Where: apps/client/src/encounter/RowTools.tsx (actor.hold-breath).
  - Trigger: the rounds of breath left go down.
  - Mockup key: `tim.breath`.

### Group 17: Sound and replay

Music and replays have their own transport, so their own lines carry the light.

- Next track (NEW, 380 ms). The progress line drains back to the start and the new title rolls in, with a burst where the line begins again.
  - Where: apps/client/src/sound/NowPlaying.tsx.
  - Trigger: the track changes (sound:changed).
  - Mockup key: `med.next`.

- Pause and play (NEW, 240 ms). PLAY and PAUSE swap like a tape deck's display, and the lit part of the progress line dims while paused.
  - Where: NowPlaying.tsx.
  - Trigger: play state changes.
  - Mockup key: `med.pause`.

- Next round in a replay (NEW, 420 ms). The round counter rolls over, and the playhead runs along the scrubber to the new round with a comet on the scrubber's line.
  - Where: apps/client/src/replay/ReplayStage.tsx (transport and scrubber at :152).
  - Trigger: the replay moves to another round.
  - Mockup key: `med.round`.

- Scrubbing (NEW, 300 ms). Letting go of the playhead glides it to the nearest round, with a burst where it stops.
  - Where: ReplayStage.tsx.
  - Trigger: the scrubber is released.
  - Mockup key: `med.scrub`.

### Group 18: Controls

Small controls use the same light at a smaller size.

- Switch (NEW, 200 ms). The thumb slides across and the track fills behind it from the side it left, with a small burst where it stops.
  - Where: packages/ui/src/primitives/Switch.tsx.
  - Trigger: the switch's checked state changes.
  - Mockup key: `ctl.switch`.

- Checkbox (NEW, 220 ms). The box fills with a burst, and a comet runs along the row's line as it lights.
  - Where: packages/ui/src/primitives/Checklist.tsx.
  - Trigger: an item is checked.
  - Mockup key: `ctl.check`.

- Copy the join address (NEW, 360 ms). A comet runs along the field's line, and Copy rolls over to Copied for two seconds.
  - Where: apps/client/src/components/JoinAddress.tsx (and viewer/ViewerControls.tsx:188).
  - Trigger: the copy succeeds.
  - Mockup key: `ctl.copy`.

- Reorder by dragging (NEW, 300 ms). The dropped row settles into its place as the rows around it slide, and its line fills with a burst.
  - Where: packages/ui/src/primitives/dragSurface.ts and the lists that use it.
  - Trigger: a drag reorder is dropped.
  - Mockup key: `ctl.reorder`.

## Appendix B: the mockup's source

The page is built from parts. `mockup/src/build.sh` stitches them into `mockup/ozyvtt-light-rail.html`. Each part is plain CSS, HTML or JavaScript with comments.

| File | What it holds | What to take from it |
| --- | --- | --- |
| `p1-head.html` | Title and fonts | Nothing |
| `p2-base.css` | Tokens for Dusk and Dawn, and the page layout | The token values in section 3.1 |
| `p3-demos.css` | Stage styles for groups 1 to 9 | Sizes and spacing for reference |
| `p3b-player.css` | The mockup's player (group and moment switchers) | Nothing; it's mockup chrome |
| `p3c-more.css` | Stage styles for groups 10 to 18 | Sizes and spacing for reference |
| `p4-fx.css` | How each part of the light looks | `light-rail.css` |
| `p5-body.html` | The page, each stage and every moment's copy | Appendix A came from here |
| `p6-core.js` | The engine: `rel`, `anim`, `temp`, `comet`, `burst`, `pop`, `wash`, `fill`, `drain`, `fadeIn`, `fadeOut`, `countUp`, `rollTo`, `sheen`, `splitIn`, `splitOut`, `cool`, `warm`, `Timers` | `lightRail.ts` |
| `p7-nav.js` | Anatomy, navigation and overlays | The order and timing of each moment |
| `p8-play.js` | Turn flow, dice and hit points | The same |
| `p9-rest.js` | Map, Codex, character and rest, connection | The same |
| `p9b-more.js` | `flip`, `floatText`, `lightLine` and `stripSwitch`, then groups 10 to 18 | The helpers go to `lightRail.ts` |
| `p10-player.js` | The mockup's player | Nothing; it's mockup chrome |
| `p11-controls.js` | The speed and theme switches | Nothing |
| `build.sh` | Stitches the parts | Run it after editing a part |

Each moment in the mockup is a function registered as `PLAY["<key>"]`. Appendix A gives each moment's key, so searching the source for the key finds its exact sequence of parts, delays and durations. The delays and durations are in milliseconds at real speed; the mockup multiplies them by its speed setting through `T()`.

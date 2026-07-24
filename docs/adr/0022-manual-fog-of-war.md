# ADR-0022: Manual fog of war

## Status

Accepted — 2026-07-19. Implements the BUILD_PLAN Phase-2 gate item ("the smallest intuitive
manual-fog/reveal slice over the recipient-safe scene boundary").

## Context and decision drivers

The owner asked what could be learned from AboveVTT and Foundry's dnd5e (design study only —
AboveVTT is AGPL-3.0, so its code is never read for reuse, and this repo's convention treats
Foundry the same way). AboveVTT's strongest table-facing idea absent here was manual fog of war:
the GM hides the map and reveals it area by area; players see darkness, the GM sees a dim veil.
The app deliberately has no vision/lighting engine (BUILD_PLAN excludes dynamic lighting and
line-of-sight by name), so fog must be a GM-painted mask, must survive the scene park/resume
lifecycle, and must never become a second, weaker version of the real visibility boundary
(hidden combatants, GM-only annotations).

## Considered options

- **Cell-set mask** (per-grid-cell booleans): exact but explodes on large maps (10k+ keys on the
  wire per stroke), meaningless on gridless maps, and expensive to render on phones.
- **Reveal-only polygon regions**: matches AboveVTT most closely but needs polygon subtraction the
  moment the GM wants to re-hide, and polygon drawing is poor on touch.
- **Ordered rect strokes folded over "all hidden"** (chosen): a painter's list — each stroke either
  reveals or re-covers a rectangle; later strokes win. Works identically on gridless maps
  (image-pixel space, the annotation convention), stays tiny on the wire (≤200 × 6 numbers),
  renders as ONE SVG mask, and re-hide needs no geometry math. The `kind: "rect"` discriminant
  leaves polygons as a purely additive later extension.

## Decision

`sceneCombatShape.fog = { enabled, shapes[] }` — enabled-false default (every existing save parses
unchanged; a no-op until switched on), enabled-with-no-strokes = fully hidden map. Three GM-only
commands under `scene:write` — `fog.set-enabled`, `fog.paint`, `fog.reset` — each accepting an
optional `sceneId` so the GM preps a parked scene's fog privately (the token-move pattern; the
active scene's stored slot stays empty per the single-source-of-truth invariant). The server owns
geometry: paint snaps to whole grid cells on calibrated unrotated maps (rotated grids keep the raw
rect — snapping an axis-aligned rect against a rotated lattice would distort; documented
simplification), clamps to the map bounds, compacts the list when a stroke covers the whole map
("Reveal all"), and caps at 200 strokes. `fog.reset` IS "Hide all".

Lifecycle decisions (each pinned by a test): encounter start/end **preserve** fog — it is scene
dressing prepped before a fight and persisting after it; scene park/resume carries each scene's
fog verbatim; fog is **excluded from the combat timeline's restorable slice** and survives
rewinds — revealing terrain is narration, not combat state, so a turn rewind must neither re-black
the players' map nor trip the "discard changes?" confirmation.

Rendering is one shared `FogOverlay` mask component: the GM sees the veil dimmed, above the map
and shapes but **below tokens**; players and the shared screen see it solid and **above
everything**, so anything inside fog is visually covered even where public data crossed the wire.

## Consequences and tradeoffs

Fog is presentation, **never the security boundary**: players receive the mask verbatim (it is
exactly what they must render), and hidden combatants / GM-only annotations remain stripped by
their own projection filters regardless of fog. The corollary a GM must know: a *public* token
inside fog is visually covered but still present in the player payload — hiding a monster's
existence still requires `gm-only` visibility, not fog. No token-vision, light sources, or
auto-reveal-on-move: v1 is deliberately manual (the combat-first "obvious GM action" over a
settings surface). The 200-stroke cap trades unbounded paint history for a bounded wire size, with
compaction making "Reveal all" a natural reset valve.

## Mobile, security, and visibility impact

The five fog tools sit behind one 🌫 toggle in the map toolbar (GM only), share the annotation
pointer plumbing so touch drags work, and were smoke-verified at 375 px. The viewer sanitizer
validates fog geometry like every other viewer field; the viewer projection sends fog only with
the public scene payload.

## Migration / reversibility

Additive-with-defaults on schemaVersion 1: pre-fog saves parse with `{enabled: false, shapes: []}`
(tested against a pre-fog fixture). Disabling fog is one command; removing the feature would strip
one state field and three commands with no data migration.

## Validation evidence

`apps/server/test/fog.test.ts` (fold order, grid snap + clamp, full-map compaction + cap,
sceneId targeting incl. live-scene rejection, timeline neutrality, player/viewer projection
parity, default fill) plus updated exact-literal projection pins. Live Playwright smoke with real
mouse drags: enable → GM dimmed veil; a sloppy drag lands grid-snapped (100,100 200×200); the
player map is solid-covered outside the reveal with fog stacked above tokens; hide-drag re-covers;
reveal-all compacts to one stroke; hide-all clears; all five tools present at 375 px. GM and
player screenshots captured. `npm run check` / `npm test` / `npm run build` green from the root.

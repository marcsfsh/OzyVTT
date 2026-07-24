# Character sheet — design-system compliance audit & remediation (2026-07-23)

The player character sheet shipped over ~6 feedback rounds (v2–v6) and works well, but it grew a large
bespoke UI layer. This is the record of a full audit against the repo's design system
(`docs/ai-context/design-language.md`, `packages/ui/src/styles/design-tokens.css`, the `@vtt/ui`
primitives) and the phased remediation that followed.

**Scope chosen (confirmed with the GM):** *Pragmatic* — migrate the clear-win controls to primitives and
tokenize the CSS, but **keep the specifically-tuned elements** (re-styling them onto tokens), migrating a
tuned element to a primitive only where the primitive reproduces the look cleanly. Every step was gated by
the headless-Chromium render harness (the only visual net — there is no client test suite), rendered in
light **and** dark.

## What the audit found

- **Primary offender `CharacterSheet.tsx`** hand-rolled ~40 controls (44 raw `<button>`, 8 `<input>`, 1
  `<select>`) instead of composing `@vtt/ui`; `DicePanel`/`ActorRoster` were half-migrated. The design
  language mandates (1) compose from primitives, don't hand-roll; (2) use tokens, never literals.
- **Reinvented primitives:** `SegmentedControl` ~5×, `Stepper` for inventory qty (while the real one was
  imported 4 lines away), dozens of raw buttons/inputs mapping to `Button`/`Input`/`IconButton`.
- **CSS token gaps:** ~250 raw-rem spacings, 164 literal font-sizes + 32 `font:` shorthands, a sub-`--fs-xs`
  micro type-tier with no token, 2 hardcoded colors (`white` pip sheen, `#8a84a8` caret), 2 phantom tokens
  (`--dur-1`, `--font-sans`) that silently fell back. Color/font-family were otherwise near-compliant.

## What changed, by phase

- **Phase 0 — foundations.** Added `--fs-2xs: 10px` (the missing micro tier) and `--line-hover`; fixed the
  two phantom tokens (`--dur-1`→`--dur-hover`, `--font-sans`→`--font-body`).
- **Phase 1 — clear-win primitive migrations.** close/remove ✕ → `IconButton`; inventory qty → the shared
  `Stepper`; the HP/rest/identity/coins/tool raw buttons → `Button`; roll-input, bonus-mode, dock-picker,
  phone Sheet/Dice tabs, and the DicePanel Table/Mine filter → `SegmentedControl`; the `ActorRoster` card
  buttons (own-HP Damage/Heal/Temp, Hit-Dice, rests, Claim/Release/Force-release) → `Button`. Each
  migration deleted its now-dead bespoke CSS.
- **Phase 2 — look-preserving primitive gains.** Added `Meter tone="health"` to the HP tile (design
  language §6 mandates a health bar — a compliance *gain*); attunement count → `Badge` (neutral / danger
  over the limit of 3).
- **Phase 3 — CSS token sweep.** Both hardcoded colors removed (pip sheen `white`→`--cyan-hi`; caret
  redrawn from `--text-dim` gradient halves — see below); `50%`→`--radius-pill`, `2px`→`--radius-sm`; the
  custom rem type scale snapped onto `--fs-2xs/xs/sm/body` (near-exact values are identical, between-token
  values snapped to the nearest token, render-gated on the densest sections). Applied file-wide in
  `encounter-panel.css` so the shared file stays consistently tokenized.
- **Phase 4 — cross-surface + closeout.** Same type sweep on the dice roll-card cluster in `styles.css`;
  styleguide updated for the icon-only SegmentedControl; this doc + the ledger.

## Primitive enhancement (backwards-compatible)

`SegmentedControl` gained optional per-option `ariaLabel` / `title`, and `label` became optional — so an
**icon-only** segmented control (the dock picker ◧/◨) announces a real name instead of a bare glyph. A
strict a11y win; demonstrated on `/styleguide`.

## Kept bespoke, on purpose (tokenized, never migrated)

These are the elements tuned over six rounds; each decision was screenshot-gated, and each keep is an
evidence-based fallback the plan anticipated.

- **The "cast at" cluster** (effect helper, slot `<select>`, at-will/no-slots tags, Cast button). A
  render-verified matched-set grid (border-box 1.9rem, shared radius/border/font); `Select`/`Button`/`Badge`
  carry different box models and would break the alignment. The lone reinvented `<select>` stays for this
  reason. Its caret can't be a token (a `background-image` data-URI can't hold a `var()`, and the matched-set
  grid rules out a masked pseudo-element), so the chevron is **drawn from two `--text-dim` gradient halves**
  — token-driven and theme-aware, same box, no DOM change.
- **Prep tags** (Cantrip / Always / Prepared) — the tuned violet-vs-cyan semantics.
- **Slot pips** — a click-to-spend capsule resource, not a passive bar (so not `Meter`).
- **Roll chips** (ability/skill/save/action/weapon) — a dense grid of ~50 live **mono** modifiers (`+7`);
  migrating needs a mono `Chip` variant and risks the tuned alignment.
- **Item-category tag** — a `Badge` pill adds weight to every dense inventory row; the subtle mono text is
  the tuned-density choice.
- **Filter/toggle pills** (equipment category filter, equip/attune) — the sheet's tuned **cyan-tinted
  active** pill reads as "selected" more clearly than the `Chip` primitive's monochrome inset-ring pressable
  state (muddy in dark). See "future primitive work" below.
- **Vital / spellcast tiles, spell-group dividers, workspace/dock layout, prof dot** — no primitive exists;
  bespoke-justified.

## Documented deviations (not oversights)

- **Spacing literals left as-is.** The dense declarations mix on-scale and off-scale values
  (`padding: .3rem .5rem`); a partial snap would litter the file with mixed literal/token declarations for
  marginal gain. Per the plan, spacing is "riskiest, lowest ROI" — left as tuned-density literals.
- **Large stat/HP numbers** (`1`–`1.3rem`) left literal — the only near tokens are *heading* sizes, a
  semantic mismatch for a number. One sub-9px inventory micro-label likewise left (snapping was +1.4px).
- **Input migration deferred** — `.nh-input`'s `width: 100%` would break the dense HP/coin fields; the raw
  inputs already inherit the compliant base `input` styling.

## Future primitive work (out of this pragmatic scope)

The sheet has a consistent **cyan-tinted "selected" pill** language (filter chips, equip/attune toggles)
that `@vtt/ui` `Chip` doesn't offer — its pressable active state is a monochrome inset ring. A future
`Chip` "selected accent" affordance (and a `tabular`/mono variant for the roll chips) would let those
elements migrate without regressing clarity. Deferred because it changes a shared primitive used elsewhere
(e.g. `conditions.tsx`).

## Verification

Per phase: `npm run check` (tsc) + `npm run build` (compiles the real shipped CSS) + `npm run test`
(server suite, 422/422) + headless render diff of the touched region in light + dark. The token scales are
authored for AA in all three themes (dark/dusk/light); migrations use AA-compliant primitives and the type
sweep changed no colors, so AA is preserved by construction. No client test suite exists — the render
harness is the visual net.

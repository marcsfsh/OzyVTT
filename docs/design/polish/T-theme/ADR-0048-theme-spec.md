# ADR-0048: The theme spec: titled bars, records-only headers, Cradle boxes and Base line controls

## Status

Accepted

## Context and decision drivers

The polish pass (`docs/design/polish/`) redesigns every surface, top down from the theme. Running the branch at
`f5e166f` and capturing every page as the GM and as a player showed the theme already built (Dusk and Dawn, Light rail,
the Cup) and three places where pages disagreed:

- The bar under the top bar came in three styles: plain words in Prep, boxed tabs with icons in the Codex and Settings,
  and a title in front of a boxed group with a filled tab in the Compendium.
- Pages named themselves five ways: big CODEX and ROSTER titles, an eyebrow over the builder's title, REPLAYS with a
  rule under it, ACCESS with a GM ONLY tag, and pages with no title.
- Every group was a plate, whether it took input or not, and secondary controls were filled boxes, so a row of them
  read as a row of plates.

The owner chose over four rounds of mockups, kept in `docs/design/polish/T-theme/history/`.

## Considered options

- Section bar: Plain, Titled, Boxed.
- Page header: Title row, Records only, Band.
- Groups: Plates, Open, Mixed.
- The box, over three rounds: Strip, Fieldset, Well, Lit edge; Lit fieldset, Rails, Brackets, Cradle; Rails refined,
  Fieldset refined, Shelf, Side rail.
- Secondary controls: today's filled boxes, Base line, Cradle, Ghost, Tint.

## Decision

1. The section bar is Titled: the section's name in Chakra Petch, then its pages as words with the horizon ink, its
   search and its primary at the right end.
2. A page header is for records only. Lists and settings start with their content and at most one line of description.
3. Groups are Mixed: a group you act in is a box, a group you only read is open.
4. The box is the Cradle: a base and sides that fade before the top, no fill, the heading in the open top. Its base
   lights cyan while you work inside.
5. Secondary controls sit on a Base line: the label on a 1 px line that lights cyan on hover; a chosen option keeps a
   2 px cyan line. Fields keep their box.
6. Twelve rules every area follows, listed in `docs/design/polish/T-theme/SPEC.md` section 3.

## Consequences and tradeoffs

- Fewer lines on screen, and each kind of line means one thing: a box takes input, a base line is a control, a field
  takes typing, the horizon is the top edge, the chosen tab and the primary.
- The segmented control loses its sunken well; DESIGN.md's Components section changes with it.
- Secondary controls change everywhere at once from the kit; local overrides that fight it must go.

## Mobile, security, and visibility impact

- Every control keeps its 44 px hit area. Phones keep the header row, one strip and the bottom tabs.
- No data, command or projection changes.

## Migration / reversibility

- Client and docs only. Reversible by reverting the kit and shell commits.

## Validation evidence

- The approved mockup: `docs/design/polish/T-theme/theme-spec.html`.
- The plan's checks at 390 by 844 and 1280 by 800 in Dusk and Dawn, with reduced motion and reduced transparency, plus
  the full checks and the smoke suite.

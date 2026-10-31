# ADR-0073: The shared parts, second sweep: one Cup in view, what a phone header names, a list's toolbar, fields, and states and kinds

## Status

Accepted

## Context and decision drivers

ADR-0072 brought the side lists, title rows, menus, phone sheets and dialogs of the 23 approved mockups into line. The
owner asked for a second sweep of the parts it left out. It captured the section bars, phone headers, tabs, segmented
controls, fields, toolbars, tags, cards, glass over maps, the top bar and the phone's tabs from every page, and where
every primary sits (`docs/design/polish/T-consistency/history/2-sweep.html`). It found eleven differences:

- On 18 Codex and Compendium pages the section bar's Cup and the page's own showed at once; Prep stepped its New down on
  an encounter and dropped its search and New on Sound, Replays and the table screen's Prep.
- Phone headers named a section's page by the section or by the page, and a record by four different things. The frame
  spec (A 2.2) and the theme spec (T 2.2) disagreed on where a record's title goes.
- Older mockups drew the story's tabs without Downtime, Prep's pages without Tokens, Sound and Replays, and the Codex
  bar without its More.
- Replays repeated its tab as a title row.
- Toolbars counted three ways and sorted three ways.
- Choice fields put the caret in three places; four find fields drew their placeholder as a value, one without its icon.
- Two Cups carried a + icon.
- A replay's "players see it" eye was magenta.
- A map's kind was drawn as a boxed state.
- A player's menu button carried words beside the face.
- Rule 13 asked an icon of every side list row, where every side list gives one only to rows naming a kind of thing.

The owner asked for all eleven to be fixed.

## Considered options

- Leave each area as approved.
- Fix the eleven in the approved mockups and specs, and write the recurring ones into the theme spec.

## Decision

1. All eleven are fixed in the approved mockups and their specs (A, E2, E3's sound and replays, F, F's finding and
   pages, story and people, time and tools, F3, G, G's pages, H, I and I's leftovers).
2. The theme spec gains rules 17 (a list's toolbar), 18 (fields) and 19 (states, kinds and readiness), and amends rule 2
   (one Cup in view; the Cup is words only), rule 9 (magenta's meanings; who sees something is never magenta), rule 12
   (what a phone header names), rule 13 (which side list rows carry an icon) and rule 14 (the crumb on a phone). A 2.2
   is amended to match rule 12.
3. The shared parts are built once in the kit and used everywhere, as ADR-0072 set out:
   `docs/design/polish/T-consistency/PLAN.md` adds the second sweep's phases.

## Consequences and tradeoffs

- A page shows one Cup. The section bar's New is a Base line button on any page with its own primary, which makes New
  quieter on record pages.
- A record on a phone loses the section's strip and its stacked crumb; Back says where it goes.
- Replays loses its title; the bar's lit page names it.
- A list's toolbar, a choice field and a find field each read one way.

## Mobile, security, and visibility impact

- Phone headers say where Back goes on every record. Hit areas are unchanged.
- No data, command, projection or route changes. Who sees something reads in the dim text colour or violet, never in a
  colour that means something else.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- `docs/design/polish/T-consistency/consistency.html`: every shared part as the approved mockups now draw it.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, plus the full checks and the smoke suite.

# ADR-0036: Settings and the four themes

## Status

Accepted

## Context and decision drivers

The owner reviewed redesigns of the sheet, the battlemap, the Codex and the Homebrew tab and asked for the remaining
pages to follow the patterns those reviews share (`docs/DESIGN.md`, "Page patterns"). Settings was one long page: the
GM scrolled past rules and builder settings to reach the join address or the credentials, the credential form had two
primaries (one with dark words on its dark plate), and the API reference was a list of disclosures with no filter or
sort. The owner also named the themes night, dusk and day, asked for a fourth (Dawn), asked for the theme on every
page, and reported dark words on the sign-in's button in Night and Dusk.

Drivers: the patterns (sections in a bar, lists as tables, a record as one document, one primary per view), every
capability of today's page kept, the projection boundary unchanged (players see Device and nothing else), phones
first-class, and saved theme choices surviving.

## Considered options

1. Keep one page and add a table of contents. Rejected: the page stays six screens long, and a table of contents is
   the left rail the owner turned down.
2. Sections in a bar, each at its own address, with a search over every setting. Chosen.
3. A settings dialog. Rejected: the API reference and the credentials need a page's width.

For the themes:

1. Rename the stored ids to the names. Rejected: every saved choice would fall back to Night.
2. Keep `dark` and `light` as ids, read them as Night and Day, add `dawn`. Chosen.

For the sign-in's dark words:

1. Exclude one more class from the page rule that coloured buttons in a card. Rejected: that was the fix already
   made once, and the same rule shape put dark words on the primaries of the credential form and the dice panel.
2. The Button primitive owns its primary's ink. Chosen.

## Decision

**Sections.** Settings is six sections: Players (join address, what players see of each other, the claimed
characters), Fights (the rules assistant and what it checks, players' hits, initiative and dice, health display, new
tokens), Characters (who builds, max level, ability scores, hit point rolls, random characters), Device (theme, how
you roll, arranging new scenes), Access (GM password, sign out, every GM browser, integration credentials) and API
(the reference). They sit in the Codex shell's section bar on a laptop and its tab bar on a phone, at
`/settings/<section>`; Players opens first because the join address is used every session. `settings/sections.ts`
declares the sections, their audience and every setting's label and one-sentence hint, so the page, the search and
the tests read one list. A player's page is the Device section alone, with no bar and no search.

**Search.** A combobox in the bar (Ctrl K, Command K on a Mac) matches every word typed against a setting's label,
hint and other words, lists matches with their section, and opens the section on the setting.

**One primary.** Access's New credential and the API's Download OpenAPI sit at the right end of the bar, placed there
by the section through a portal slot. The other sections change as you go and have none.

**Credentials** are a table (name, scopes, state, last used, expires) with Rotate, Revoke and History on each row, and
a list with an Actions menu on a phone. New credential opens a dialog; a new or rotated secret shows once in a dialog
that warns until it is copied; History opens the audit events in a dialog.

**The API reference** is a table of operations (method, path, summary, tag, who can call) with the tag as a dropdown
of checkboxes, every tag ticked; filters (method, who can call, scope) in the Codex's flyout, which leaves removable
chips; and the Codex search's multi-column Sort dialog, now given its columns by the caller. An operation opens at
`/settings/api/<operation id>` as one document (request, responses, an example in four languages) with a metadata
panel (method, path, who can call and with which scopes, operation id, tag) that follows the document on a phone. The
command catalog is a second table. The tag is the operation's tag from the route registry (ADR-0034), listed and
sorted in the document's order; a document without tags is grouped by path as before, and an operation without a
summary is named from its description or its id. An operation's example uses the document's example body where it
has one and builds one from the schema otherwise.

**Themes.** Night, Dusk, Dawn and Day, stored as `dark`, `dusk`, `dawn` and `light`. Dawn is Day's rules on a warm
ground: apricot and cream surfaces, plum ink, a rose and gold lip, and accents spread so the primary, selection,
GM-only, caution and danger hues stay apart. `themes.test.ts` checks every text ink on every surface and sky stop of
every theme at 4.5:1, the primary's and the on-state's labels, and the distance between the meaning hues. Every app
bar (GM, player, and the standalone sheet's header) carries `ThemeSwitch`, one 44px square that opens the four; the
title screen and Settings keep the four side by side. A phone bar that cannot fit its tabs with the switch moves the
last tab into More until it fits.

**The primary's ink.** The Button renders its words in `<nh-label>`, an element no page stylesheet names, coloured by
`--nh-ink`: the button's own colour for most variants, the primary ink for the primary and the muted ink when
disabled. A page that needs another ink sets the hook. Disabled buttons dim their words and keep full opacity.

**Shared screen.** The GM's preview draws the real screen at 1920 by 1080 and scales it, keeping 16:9 when resized;
the Shared screen tab opens it. Its one primary follows the next step (pair a screen, present a map, then point at
it), and its words are plain.

## Consequences and tradeoffs

- Settings reuses the Codex shell's bar and tab bar styles. The `Dropdown`, `FilterFlyout` and Sort dialog it shares
  with the Codex, the Compendium and Scenes moved to `packages/ui/src/records/` with Who sees it once that work landed.
- Six sections share a phone's tab bar, so the labels are small.
- The API reference keeps its filters and sort in the page. The address holds the open operation alone.
- A theme switch in every app bar takes 44px of the phone bar, paid for by tighter steps and, at 320px, a tab moved
  into More.

## Mobile, security, and visibility impact

No projection changes. A player's Settings mounts only Device; every other section's address is GM-only in the router
and renders not-found for a player. The credentials and the reference read GM-only routes as before. On a phone every
section is a column under the app's tabs with its own tab bar at the bottom, tables become lists with the two facts
that matter, and every control keeps the 44px floor.

## Migration / reversibility

Saved theme choices keep working: the ids did not change, and an unknown stored id falls back to Night. Old addresses
keep working: `/settings` opens the role's first section and `/settings/api` the reference. Reverting the sections is
a change to `settings/` alone.

## Validation evidence

Component tests: the sections declaration and search (`settings-groups.test.ts`), the page (`settings-page.test.tsx`),
the fight settings (`table-settings.test.tsx`), the credentials (`credentials-table.test.tsx`), the reference
(`api-reference.test.tsx`), the router's addresses, the theme switch in both shells and the no-flash scripts
(`theme-switch.test.tsx`), the themes' tokens (`themes.test.ts`), the primary's ink (`button-ink.test.tsx`) and every
button on the title screen and sign-in in all four themes painted with the real stylesheets (`landing-ink.test.tsx`).
Browser: every section, the title screen and the sign-in in all four themes at 1280x800 and 390x844 with touch, and
the shared screen at 1280, 1366, 1920 and 3840 wide.

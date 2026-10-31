# ADR-0066: The story and people: quests by status at the side, a ring on glass, standing in the side column, the composer at the head of the line, and a Downtime tab

## Status

Accepted

## Context and decision drivers

F's third round of the polish pass (`docs/design/polish/F-story-people/`), inside the Codex's frame (ADR-0054) and the
side column's swap (ADR-0064). Running the branch at `f5e166f` with three quests, three sessions and four ties showed:

- Quests were a Filters drawer beside the chosen quest's page.
- Relationships drew the centred page with its ties above and below it, and a panel of ties at the right.
- A faction's standing was a dialog from the Factions grid.
- Adding to the chronicle was a dialog with four kinds as tabs and two editors; the session it was filed under was a
  field inside it.
- Downtime was a card in the Chronicle's side column.

The owner asked that sub-areas keep to the settled design, and chose from one round of mockups with five options for
each question, kept in `docs/design/polish/F-story-people/history/`, each built only from settled parts. The owner put
two options together (the ring and the web on glass), asked that an entry can be added to a session other than the
latest from the composer, and asked that the Downtime tab's contents be their own question in the next round.

## Considered options

- Quests: Today's list and page, Status at the side, Quests and the quest, A board by status, Quest cards.
- Relationships: Today's web, A ring, Ties as rows, One grid, The web on glass.
- A faction's standing: Today's dialog, A's menu at the standing, In the side column, Choose the word, A record with its
  history.
- Adding to the chronicle: Today's dialog, At the head of the line, In the side column, A menu then a fitted dialog, One
  line.
- Downtime and deadlines: Today's card, Days and deadlines at the side, On the Timeline, A Downtime tab, On the home.

## Decision

1. Quests put Status and Who sees it at the side, the quests as rows; a quest opens as a page.
2. Relationships draw a ring across the whole page, with Centre on, the views and the ties on glass.
3. A faction's standing opens in its page's side column.
4. The composer opens at the head of the chronicle, filed under any session, with Add here on each session.
5. Downtime is a fourth tab on the story; what it holds was decided in the Atlas round (ADR-0067).
6. Seven rules, listed in `docs/design/polish/F-story-people/SPEC.md` section 3.

## Consequences and tradeoffs

- Quests read like the pages index, so the Codex's lists share one shape.
- The ring shows every tie at once; past eight ties the ring keeps eight and the list carries the rest.
- The Downtime tab's contents come from the Atlas round (ADR-0067); its phase builds them.

## Mobile, security, and visibility impact

- On a phone the side lists become chips, the ties a sheet from the foot, the standing a tab.
- No data, command, projection or route changes. Players see only what they see today.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/F-story-people/story-and-people.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, as the GM and as a player, plus the full checks and
  the smoke suite.

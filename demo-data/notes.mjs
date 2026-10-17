// Codex note pages: the player guide (handouts the table can read) and the GM's prep notes.

export const NOTES = [
  {
    key: "primer",
    title: "Welcome to the Ashen Reach",
    entityType: "note",
    folder: "Player Guide",
    tags: ["handout", "overview"],
    playerBody: `# Welcome to the Ashen Reach

*A one-page primer for players. Everything here is common knowledge.*

The dead do not stay down on their own in the Reach. For twelve hundred years before the [[The Reckoning]], every village burned its dead and still watched the graves. Then [[Saint Ilvara]] walked into the fire, and her ashes have kept the dead quiet ever since.

## Three things everyone knows
1. Every village has a shrine flame lit from the Saint's ash. Never let it go out.
2. Every new grave gets a lantern for a year. Never take one.
3. If you hear humming in a graveyard, walk the other way.

## Three things everyone argues about
- Whether Port Varrow's guild or Gloamshire's lords do more damage.
- Whether [[The Sooted]] protect the Reach or own it.
- Whether the old [[The Peat Mothers]] ever really went away.

## Where the campaign starts
Harvestide 1, 1347 AR. At midnight every shrine flame in [[Gloamshire Vale]] went out. You are at the coaching inn at [[Kettle Ford]], each for your own reasons, when Lord Ashdown's rider arrives.`,
    gmBody: "",
    revealed: true
  },
  {
    key: "house-rules",
    title: "House Rules",
    entityType: "note",
    folder: "Player Guide",
    tags: ["rules"],
    playerBody: `## House rules
- Milestone levelling. No XP.
- Drinking a potion yourself is a bonus action; feeding one to someone else is an action.
- Flanking does not give advantage.
- Critical hits roll double dice (2024 rules).
- Death saves are rolled in the open.
- Downtime is logged in the Codex, and the GM confirms before the calendar moves.

## Table tools
- The app rolls everything on the server. If a roll looks wrong, say so and we'll check the log.
- Combat replays from sessions are shared under Replays when the GM shares them.`,
    gmBody: "",
    revealed: true
  },
  {
    key: "zero",
    title: "Session Zero Agreements",
    entityType: "note",
    folder: "Player Guide",
    tags: ["session-zero", "safety"],
    playerBody: `What we agreed on at session zero (2026-08-01).

## Tone
Folk horror with warmth. Grief is a theme; cruelty for its own sake isn't. Humor is welcome, especially Grub.

## Lines (never in the game)
- Harm to children on screen.
- Body horror involving teeth.

## Veils (happen off screen)
- Torture.
- Drowning described in detail.

## Tools
An X-card on the table and a thumbs-down emoji in the group chat. No questions asked, no explanations needed.

## Logistics
Every other Saturday, 6 pm to 10 pm. Pizza rotates. If two players can't make it, we play a one-shot instead.`,
    gmBody: "",
    revealed: true
  },
  {
    key: "holidays",
    title: "Calendar and Holidays",
    entityType: "note",
    folder: "Player Guide",
    tags: ["calendar", "holidays"],
    playerBody: `The Reach counts years from [[The Reckoning]] (AR, *Ashen Reckoning*). Ten months, seven-day weeks: Ashday, Brightday, Coalday, Duskday, Emberday, Forgeday, Graveday.

## Months and holidays
- **Frostwane** (30): Kindling Day on the 1st. Hearths relit from the shrine.
- **Thawmoot** (30): the Moot meets at Moss End.
- **Seedfall** (30): the Saltblessing on the 12th at Tidewrack.
- **Greenrise** (31): planting.
- **Highsun** (31): Longlight on the 21st, the year's longest day.
- **Emberlight** (30): peat cutting ends.
- **Harvestide** (30): the Festival of Lanterns on the 15th.
- **Ashfall** (30): Ashing on the 1st, when graves are dusted with shrine ash.
- **Duskmarch** (29): the roads close.
- **Longnight** (32): Pyre Night on the 32nd, the last night of the year.`,
    gmBody: "",
    revealed: true
  },
  {
    key: "coin",
    title: "Coin and Prices",
    entityType: "note",
    folder: "Player Guide",
    tags: ["economy", "prices"],
    playerBody: `Standard coins, local names: copper *wicks*, silver *lamps*, gold *crowns*. Port Varrow also mints a square guild crown worth slightly more than a round one, which nobody outside the city accepts.

## Typical prices
- Room at the Lantern and Lamb: 5 sp a night, with breakfast.
- Room above the Brine and Barrel: 3 sp a night, without.
- A shrine candle: 1 cp. A grave lantern: 2 gp.
- A ferry across the Kettle: 2 cp, or 1 sp at spring tide.
- Hauling a cart out of the Drowned Road mud: whatever the fen folk think you can afford.
- Mags Thimble's prices: negotiable, always upward.`,
    gmBody: "",
    revealed: true
  },
  {
    key: "speech",
    title: "Names and Speech of the Reach",
    entityType: "note",
    folder: "Player Guide",
    tags: ["culture", "names"],
    playerBody: `## Greetings
- *Keep the fire.* Answer: *And the fire keeps us.*
- Port Varrow sailors say *Fair tide* and touch salt to their lips.
- Fen folk just nod, twice.

## Swears and sayings
- *Ash and ember!* (surprise)
- *Cold shrine* (an unlucky person or place)
- *He'd sell the lantern off his mother's grave* (a Varrow merchant)
- *Mud remembers* (a fen proverb about grudges)

## Names
- Vale: Hobb, Wat, Agnes, Brannoc, Ebb, Corvin, Elsbeth
- Port Varrow: Hessa, Sile, Tobin, Pell, Mags, Nan
- Fen: names after birds and weather, such as Wren, Heron, Squall`,
    gmBody: "",
    revealed: true
  },
  {
    key: "travel",
    title: "Travel Times",
    entityType: "note",
    folder: "Player Guide",
    tags: ["travel", "reference"],
    playerBody: `On foot, in good weather. Add a day for rain and two for a spring tide on the causeway.

- [[Kettle Ford]] to [[Hollowmere]]: half a day.
- Hollowmere to the [[Crypt of the Ashen Saint]]: two hours up the crypt road.
- Hollowmere to [[Moss End]]: one day.
- Kettle Ford to [[Port Varrow]] by [[The Drowned Road]]: two days.
- Hollowmere to [[Emberhold Abbey]]: five days, three of them uphill.
- Port Varrow to [[Tidewrack]]: one day along the cliffs.`,
    gmBody:
      "Through the Gloomwood by the goblin paths, Hollowmere to the Ruined Watchtower is one day. By the road it is three.",
    revealed: true
  },
  {
    key: "pitch",
    title: "Campaign Pitch",
    entityType: "note",
    folder: "GM Prep",
    tags: ["gm", "planning"],
    playerBody: "",
    gmBody: `# The Ashen Reach

Low-magic frontier horror for levels 7 to 11.

## The arc
1. **The ashes go cold** (sessions 1 to 6). Who stole the reliquary, and why?
2. **The Pale Choir's rite** (sessions 6 to 9). Stop the rite at the watchtower, or fail and face the drowned.
3. **The drowned army and the guilty city** (sessions 10+). Prove who burned the harbor, while the Sooted march on the vale.

## Themes
- Grief, and what people will trade to undo it.
- Duty to the dead against duty to the living.
- Every villain here has a point. None of them has the right answer.

## The central question
When the party learns the guild burned the harbor and the Wardens' founding story is a lie, who do they protect?`,
    revealed: false
  },
  {
    key: "secrets",
    title: "Secrets and Clues",
    entityType: "note",
    folder: "GM Prep",
    tags: ["gm", "secrets"],
    playerBody: "",
    gmBody: `Ten secrets to reveal however the party gets there. Strike them through when found.

1. ~~Aldous handed the reliquary to the Choir himself.~~ (ledger, session 5)
2. ~~Lord Ashdown moved the crypt guard to his manor.~~ (servant gossip, session 2)
3. The Choir's base is the Ruined Watchtower.
4. The rite completes at dawn on Harvestide 20.
5. The guild set the Harbor Fire of 1339.
6. Harbormaster Dunmore is "the Tidesman" in the ledger.
7. Elsbeth's locket can talk Aldous down.
8. The Peat Mothers' rite can relight a shrine without the reliquary.
9. Sung backwards, the Hollow Hymn unmakes the rite.
10. Saint Ilvara was chosen by lot.`,
    revealed: false
  },
  {
    key: "clock",
    title: "Vessa's Clock",
    entityType: "note",
    folder: "GM Prep",
    tags: ["gm", "villain", "pale-choir"],
    playerBody: "",
    gmBody: `What the Pale Choir does if the party does nothing. Dates are Harvestide unless noted.

- **12:** Choir ravens report the party is in Port Varrow.
- **14:** Vessa moves the last grave goods from the net loft on Cobble Wharf to the tower.
- **15:** Festival of Lanterns. Two sunken graves in Hollowmere open during it.
- **16:** Inquisitor Grieve arrives in Hollowmere with soldiers.
- **17 to 19:** Three nights of singing at the tower. Lights visible from Moss End.
- **20, dawn:** The rite completes. The reliquary cracks.
- **Ashfall 1:** Every churchyard within a mile of a cold shrine wakes.
- **Ashfall 3:** The drowned walk out of the surf at Tidewrack and march on Port Varrow.`,
    revealed: false
  },
  {
    key: "voices",
    title: "NPC Voices",
    entityType: "note",
    folder: "GM Prep",
    tags: ["gm", "npcs"],
    playerBody: "",
    gmBody: `Quick reference for the table.

- **Lord Corvin Ashdown:** over-polite; apologizes before every evasion; touches his signet ring.
- **Captain Hessa Marrow:** clipped; never says please; calls Rook "Corporal".
- **Mags Thimble:** sing-song; calls everyone "pet"; always eating something.
- **Nan Gull:** whispers, so people lean in; then shouts.
- **Grub:** third person; extravagant Goblin insults translated literally.
- **Old Wren:** answers questions with questions; laughs at the wrong moments.
- **Vessa the Pale:** gentle; patient; sounds like a teacher.
- **Inquisitor Grieve:** quiet and reasonable; quotes Ilvara; never blinks first.
- **Old Tobin:** every story is about a king he once served.`,
    revealed: false
  },
  {
    key: "encounters",
    title: "Random Encounters in the Vale",
    entityType: "note",
    folder: "GM Prep",
    tags: ["gm", "tables", "encounters"],
    playerBody: "",
    gmBody: `Roll a d8 once per half day of travel in Gloamshire while the shrines are cold.

1. A funeral party carrying their dead to Hollowmere for a lantern that isn't there.
2. Three Ashwalkers (skeletons) in a sunken farm graveyard, humming.
3. Mudfoot goblin scouts who saw the party spare Grub. Friendly, if Grub was.
4. A Warden courier riding hard for Emberhold. Carries a letter from Corra Lind.
5. A fog bank on the causeway. DC 13 Survival or lose two hours.
6. A Choir raven. If shot down, carries a note in Hollow Hymn notation.
7. A peddler selling "genuine shrine ash". It's peat ash.
8. Old Wren's moths, swarming toward the nearest grave.`,
    revealed: false
  },
  {
    key: "rumors",
    title: "Rumor Table",
    entityType: "note",
    folder: "GM Prep",
    tags: ["gm", "tables", "rumors"],
    playerBody: "",
    gmBody: `Roll a d10 when the party spends an evening in a tavern.

1. The guild burned the harbor on purpose. (true)
2. Lord Ashdown sold the urn to pay his debts. (false)
3. Lights on the old watchtower at night. (true)
4. Old Wren can talk to moths. (half true: they talk to her)
5. The goblins are eating the dead. (false; they're running from them)
6. Brother Aldous was seen in Port Varrow. (true, three weeks ago)
7. The Sooted are coming to burn the churchyards. (true)
8. The bells at Tidewrack ring at low tide. (true)
9. Mags Thimble works for the watch. (half true)
10. Someone has been buying up grave lanterns. (true; the Choir)`,
    revealed: false
  }
];

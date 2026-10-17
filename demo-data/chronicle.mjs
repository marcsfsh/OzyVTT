// The campaign as it happened: a dated history from before play began, then seven sessions with their prep,
// recaps and journal entries. seed.mjs walks this in order, so the auto-written combat, quest and standing
// records land in the right session and on the right in-world day.
//
// Entry fields: `day` (Harvestide unless `month`/`year` say otherwise), `text` (player side), `gm` (GM side),
// `page` / `marker` (what it is attached to), `reveal`, and for special kinds `kind` plus its payload.
import { PLAYERS } from "./campaign.mjs";

/**
 * Before play: dated entries for the timeline. The big events have their own Event pages, which already sit on
 * the timeline, so these are the smaller moments and the GM's secrets. Months: Frostwane 0 ... Longnight 9.
 */
export const HISTORY = [
  {
    year: -1200,
    month: 0,
    day: 1,
    page: "saint",
    text: "The Age of Embers begins. In the Greyspire valleys the first great pyres are lit, because the dead will not stay buried. For twelve centuries every village in the Reach burns its dead and still sets a watch on the ashes.",
    tags: ["history", "age-of-embers"],
    reveal: true
  },
  {
    year: 1301,
    month: 2,
    day: 4,
    page: "corvin",
    text: "Gloamshire Vale is granted to House Ashdown, with the duty of guarding the crypt road.",
    tags: ["history", "gloamshire"],
    reveal: true
  },
  {
    year: 1316,
    month: 4,
    day: 21,
    page: "tobin",
    text: "Old Tobin buys the Brine and Barrel with, he says, a single tip from a grateful king. The previous owner says it was a card game.",
    tags: ["history", "port-varrow"],
    reveal: true
  },
  {
    year: 1317,
    month: 7,
    day: 1,
    page: "aldous",
    text: "On Ashing day, Aldous Vane takes his vows as keeper of the Crypt of the Ashen Saint. He will not miss a vigil for thirty years.",
    tags: ["history", "aldous"],
    reveal: true
  },
  {
    year: 1327,
    month: 2,
    day: 12,
    page: "elsbeth",
    text: "Elsbeth Vane is born at Hollowmere on Saltblessing day. Her mother dies a week later. Aldous raises her in the crypt keeper's cottage.",
    tags: ["history", "aldous"],
    reveal: true
  },
  {
    year: 1340,
    month: 0,
    day: 1,
    page: "hessa",
    text: "Hessa Marrow is named Captain of the Varrow Watch, the first captain in eighty years not chosen by the guild. The guild cuts the watch budget the same month.",
    tags: ["history", "watch"],
    reveal: true
  },
  {
    year: 1344,
    month: 8,
    day: 10,
    page: "ivo",
    text: 'Ivo Quillfeather is dismissed from the Emberhold archive for "entering the sealed stacks without cause".',
    gm: "He had cause. He was looking for the lottery record, and found the Choir fragment beside it.",
    tags: ["history", "ivo"],
    reveal: true
  },
  {
    year: 1344,
    month: 9,
    day: 2,
    page: "tamsin",
    text: "Tamsin Vey leaves Port Varrow in a hurry, by the Drowned Road, at night.",
    gm: "After the Guild Hall job went wrong. Nan Gull covered her escape and added the cost to her debt.",
    tags: ["history", "tamsin"],
    reveal: true
  },
  {
    year: 1347,
    month: 3,
    day: 20,
    page: "corvin",
    text: "",
    gm: "Lord Ashdown withdraws the two crypt guards to the manor to save their wages. Nobody outside the manor is told.",
    tags: ["secret", "gloamshire"],
    reveal: false
  },
  {
    year: 1347,
    month: 4,
    day: 5,
    page: "aldous",
    text: "",
    gm: "Vessa visits Aldous at the crypt for the third time and makes her offer: the reliquary for his daughter.",
    tags: ["secret", "pale-choir"],
    reveal: false
  },
  {
    year: 1347,
    month: 5,
    day: 14,
    page: "tower",
    text: "",
    gm: "The Pale Choir moves into the Ruined Watchtower. The first lights are seen from Moss End a week later.",
    tags: ["secret", "pale-choir"],
    reveal: false
  }
];

export const SESSIONS = [
  {
    number: 0,
    realDate: "2026-08-01",
    status: "played",
    day: 1,
    attendees: [...PLAYERS, "Morgan"],
    tags: ["session-zero"],
    prepBody: `# Session 0: Before the Fire Goes Out

- Pitch the Reach (see [[Welcome to the Ashen Reach]]).
- Lines and veils, X-card, schedule.
- Make characters at level 7. Every PC needs one tie to another PC and one tie to the Reach.
- Short scene at the end: the Kettle Ford inn at midnight, Harvestide 1.`,
    recapBody: `# Session 0: Before the Fire Goes Out

We built the party and agreed the tone: folk horror with warmth (see [[Session Zero Agreements]]).

## The party
- [[Rook Ashgrave]], former Varrow watch corporal, now a caravan guard.
- [[Maelis Thorn]], Warden novice, on her way to the Hollowmere shrine.
- [[Ivo Quillfeather]], dismissed from the Emberhold archive and cagey about why.
- [[Tamsin Vey]], back in the Reach and avoiding Port Varrow for reasons.
- [[Corwin Hale]], Gloamshire tracker and the Speaker's nephew.
- [[Osric Fenn]], bard, whose player is moving away; Osric heads to Emberhold to write a ballad.

## Ties
Rook served under [[Captain Hessa Marrow]]. Maelis and Ivo knew each other at Emberhold, and not fondly. Tamsin owes somebody in Port Varrow a great deal of money. Corwin agreed to guide everyone to Hollowmere.

## The opening scene
Midnight at the [[Kettle Ford]] inn. The wayside shrine by the door went out mid-flicker, and every dog in the yard started howling. Maelis tried to relight it with her lantern and couldn't. At dawn a rider in Ashdown blue arrived with a letter for "any person of courage at the ford".`,
    after: [
      {
        day: 1,
        page: "ford",
        text: "Midnight at the Kettle Ford inn. The little wayside shrine by the door went out mid-flicker, as if a hand had closed over it. Maelis's lantern would not relight it. The dogs howled until dawn.",
        tags: ["omen", "kettle-ford"],
        reveal: true
      },
      {
        day: 1,
        page: "corvin",
        text: `*A letter, sealed in blue wax with the Ashdown lantern.*

To any person of courage at the ford:

Every shrine flame in my vale went out at midnight. I do not know why. I would know why before my people do. Come to Hollowmere. I will pay two hundred crowns for an answer and more for a remedy.

Corvin Ashdown, Lord of Gloamshire`,
        gm: "Ashdown already suspects theft. He leaves that out.",
        tags: ["handout", "hook"],
        reveal: true
      },
      {
        day: 1,
        page: "wat",
        text: "Wat Penhallow, the Hollowmere miller, offered 20 gp to anyone who would see his barley cart safely to Hollowmere. He mentioned goblins on the road. He mentioned them twice.",
        tags: ["job", "hollowmere"],
        reveal: true
      },
      {
        day: 1,
        page: "osric",
        text: "Osric Fenn took the north road toward Emberhold before dawn, promising a ballad and a verse for each of us.",
        tags: ["farewell"],
        reveal: true
      },
      { kind: "milestone", day: 1, level: 7, reason: "Campaign start", reveal: true }
    ],
    end: {
      quests: [
        { key: "cold-ash", status: "active" },
        { key: "cart", status: "active" },
        { key: "drowned-road", status: "active" }
      ]
    }
  },
  {
    number: 1,
    realDate: "2026-08-15",
    status: "played",
    day: 2,
    attendees: PLAYERS,
    tags: ["arc-1", "combat"],
    fight: "road",
    prepBody: `# Session 1: The Drowned Road

## Strong start
Fog on the ford. The miller's oxen stop dead mid-river. Something is splashing upstream.

## Scenes
- The ambush at the ford: six Mudfoot warriors and Grub.
- Grub surrenders when bloodied or alone. Grub begs for help against "the walking bones".
- The cart: if nobody holds the oxen, it goes into the river.

## Secrets
- The goblins are fleeing the risen dead near the crypt.
- Grub saw a cart go up the crypt road at night.

## Treasure
Grub's war drum. 14 sp and a jar of pickled eels.`,
    recapBody: `# Session 1: The Drowned Road

The party left Kettle Ford at first light with [[Wat Penhallow]]'s barley cart, Corwin walking ahead in the fog.

## The ambush
Halfway across the ford the oxen stopped dead. Mudfoot goblins came out of the reeds on both banks, six warriors and their chief, [[Grub]]. Rook held the middle of the ford, Ivo and Tamsin shot from the cart, and Maelis kept everyone standing. The fight lasted longer than it should have, mostly because the goblins kept falling in the river.

When the last warrior fell, Grub threw down a cleaver and begged. The tribe had been driven from their burrows near the crypt by "the walking bones, singing". The party spared Grub and took the tribe's war drum as surety.

## The cost
Nobody held the oxen. The cart went into the Kettle with forty sacks of barley. Wat was not pleased.

## Open threads
- What is walking near the crypt, and why is it singing?
- Grub saw a cart go up the crypt road the night the flames went out.`,
    before: [
      {
        day: 2,
        page: "corwin",
        text: `*From Corwin's trail notes.*

Fog off the river at dawn, thick as fleece. Fresh goblin sign on the east bank: web-footed, a dozen at least, all heading away from the ridge. Goblins don't run from anything they can eat. Told Rook. He loosened his sword and said nothing, which is how Rook agrees with you.`,
        tags: ["diary", "corwin"],
        reveal: true
      }
    ],
    after: [
      {
        day: 2,
        page: "grub",
        text: "Grub threw down the cleaver and begged. The Mudfoot goblins are running from walking bones in the Gloomwood, bones that sing. Grub swore the tribe would leave the road alone. The party kept the war drum as surety.",
        gm: "Grub keeps the promise if the drum comes back. Grub also saw the smugglers' cart on the crypt road.",
        tags: ["goblins", "mudfoot"],
        reveal: true
      },
      {
        day: 2,
        page: "wat",
        text: "The barley cart went into the Kettle with forty sacks aboard. Wat Penhallow walked the rest of the way to Hollowmere without speaking to anyone.",
        tags: ["job", "failed"],
        reveal: true
      },
      {
        day: 2,
        page: "ivo",
        text: `*From Ivo's notebook.*

Goblin vocabulary acquired today: *grakka* (bones), *grakka-hum* (bones that sing), *nub* (no), *nub nub nub* (absolutely not). Grub calls me something that translates as "the tall one who argues with fire". I am choosing to take it as a title.`,
        tags: ["diary", "ivo"],
        reveal: true
      }
    ],
    end: {
      quests: [
        { key: "drowned-road", status: "completed", done: [0, 1] },
        { key: "cart", status: "failed" }
      ],
      standing: [
        { faction: "mudfoot", value: -30, reason: "Ambushed the party at Kettle Ford", reveal: true },
        { faction: "mudfoot", value: -10, reason: "The party spared Grub", reveal: true }
      ]
    }
  },
  {
    number: 2,
    realDate: "2026-08-29",
    status: "played",
    day: 3,
    attendees: ["Alex", "Jordan", "Sam", "Riley"],
    tags: ["arc-1", "investigation"],
    prepBody: `# Session 2: Hollowmere

## Strong start
The party arrives at dusk. The shrine is dark, and half the village is standing outside it with candles that keep going out.

## Scenes
- The cold shrine and [[Sexton Hobb]].
- An audience with [[Lord Corvin Ashdown]] at the manor.
- An evening at [[The Lantern and Lamb]].
- A letter for Maelis from Emberhold.

## Secrets
- Ashdown moved the crypt guard to his manor. Any servant will say so.
- The flames went out at the same moment across the vale. Someone did this deliberately.
- Lights have been seen on the old watchtower.

## NPCs
Hobb, Ashdown, Widow Fairweather at the inn, the Ebbs (Choir sympathizers; play them friendly).`,
    recapBody: `# Session 2: Hollowmere

*Casey was away; Tamsin spent the session "asleep at the inn".*

## The cold shrine
[[Hollowmere]]'s shrine was dark and its doors were open. [[Sexton Hobb]] told the party the flame did not gutter, it went out "like a hand closed over it". Maelis tried the relighting prayer and felt nothing answer. Two graves in the churchyard have sunk.

## Ashdown Manor
[[Lord Corvin Ashdown]] received the party in his long gallery under eleven generations of lantern-holding ancestors. He told them about the reliquary's theft, which he had left out of his letter, and doubled the reward. He was vague about the crypt's guards. A kitchen maid was not: the two guards have been polishing silver at the manor since spring.

## The Lantern and Lamb
Over mutton and peat smoke, Widow Fairweather mentioned lights on the old Saltwar watchtower above the fens. Corwin knows the place. Nobody has used it in three hundred years.

## A letter for Maelis
A Warden courier found Maelis at the inn with a letter from [[Warden-Abbess Corra Lind]]: find the reliquary, report honestly on Lord Ashdown, and beware the Sooted.

## Open threads
- Why did Ashdown move the guard, and who knows?
- Lights on the watchtower.
- The Festival of Lanterns is on Harvestide 15, and the shrine is still cold.`,
    after: [
      {
        day: 3,
        page: "hollowmere",
        text: "The Hollowmere shrine stood dark with its doors open. The lamp was cold to the touch, and the ash in its bowl was grey and dead, like any hearth's. Maelis prayed for an hour. Nothing answered.",
        tags: ["hollowmere", "shrine"],
        reveal: true
      },
      {
        day: 3,
        page: "hobb",
        text: 'Sexton Hobb\'s account: the flame went out at midnight on Harvestide 1, all at once. Later that night he heard a cart go up the crypt road. Two graves have sunk since, "like something underneath turned over".',
        gm: "Hobb is reliable. The cart was the smugglers'.",
        tags: ["testimony", "hollowmere"],
        reveal: true
      },
      {
        day: 3,
        page: "corvin",
        text: "Audience at Ashdown Manor. Lord Ashdown admitted the reliquary was stolen from the crypt and doubled the reward: 500 crowns for its return. He changed the subject twice when asked about the crypt's guards.",
        gm: "A kitchen maid told Corwin that the guards have been at the manor since spring. Secret 2 found.",
        tags: ["gloamshire", "patron"],
        reveal: true
      },
      {
        day: 4,
        page: "corra",
        text: `*A letter for Maelis Thorn, brought by Warden courier.*

Maelis,

Find the urn. Tell me the truth about Ashdown, all of it, even if he is kind to you. Especially if he is kind to you.

The Sooted have heard. Grieve is asking to ride. I can hold him a fortnight, not more.

Keep the fire.
C.L.`,
        tags: ["handout", "wardens", "letter"],
        reveal: true
      },
      {
        day: 4,
        page: "lamb",
        text: "Overheard at the Lantern and Lamb: lights on the old Saltwar watchtower above the fens, three nights running. Widow Fairweather's cousin saw them from Moss End.",
        tags: ["rumor", "watchtower"],
        reveal: true
      },
      {
        day: 4,
        page: "maelis",
        text: `*From Maelis's prayer book.*

The Abbess writes as she speaks: as if every word costs her a coin. A fortnight. I have never heard her say she could hold anything for a fortnight; she has always just held it.

Lord Ashdown was gracious and frightened and lied to us about his guards. I will tell her that. I do not know yet whether I will tell her I liked him.`,
        tags: ["diary", "maelis"],
        reveal: true
      },
      {
        kind: "deadline",
        day: 15,
        page: "hollowmere",
        text: "The Festival of Lanterns in Hollowmere. The whole vale floats lanterns on the lake for the dead.",
        gm: "Two sunken graves open during the festival if the shrine is still cold.",
        tags: ["festival", "hollowmere"],
        reveal: true
      }
    ],
    end: {
      quests: [
        { key: "cold-ash", done: [0] },
        { key: "warden-report", status: "active" }
      ],
      standing: [
        { faction: "moot", value: 10, reason: "Helped Sexton Hobb and the people of Hollowmere", reveal: true },
        { faction: "wardens", value: 10, reason: "Maelis answered the Abbess's letter", reveal: true }
      ]
    }
  },
  {
    number: 3,
    realDate: "2026-09-12",
    status: "played",
    day: 6,
    attendees: PLAYERS,
    tags: ["arc-1", "dungeon", "combat"],
    fight: "crypt",
    prepBody: `# Session 3: The Saint's Ossuary

## Strong start
The crypt doors stand open. Humming comes up the stairs.

## Scenes
- The upper chapel: Aldous's cell, neat, bed made, cloak gone.
- The ossuary: three skeletons, two zombies and the Ash Wight. They hum the Choir's hymn.
- The reliquary niche: empty. Candles burned out days ago.

## Secrets
- The hymn the dead hum is the Pale Choir's.
- Elsbeth's locket is in the third ossuary niche.
- Cart tracks lead down the crypt road toward the Drowned Road.

## Treasure
The Ember-Etched Blade (homebrew) in the guardian alcove. Elsbeth's locket.`,
    recapBody: `# Session 3: The Saint's Ossuary

## Up the crypt road
Corwin found cart tracks on the crypt road: a heavy cart going up, a heavier one coming down. The crypt doors stood open, and humming drifted up the stairs.

## Aldous's cell
[[Brother Aldous Vane]]'s cell was neat, the bed made, his travelling cloak gone. Nothing was taken by force. Maelis noticed the vigil candle had been snuffed by hand.

## The ossuary
The honored dead were up. Skeletons and zombies came out of the niches, and behind them an Ash Wight packed with the Saint's spent ash. All of them were humming the same hymn. The Wight caught Tamsin with a withering claw and dropped her, and she was rolling death saves before Maelis reached her and pulled her back. Rook spent the rest of the fight frightened and swinging anyway.

## What was found
- The reliquary niche: empty.
- The [[Ember-Etched Blade]] in the guardian alcove. Rook took it.
- A silver locket hidden in the third niche, engraved *E.V.* ([[Elsbeth's Locket]]).
- Ivo recognized the hymn and refused to say where from.

## Open threads
- Who carted the grave goods away, and where to?
- Whose locket, and why was it hidden?
- Where did Ivo hear that hymn?`,
    before: [
      {
        day: 5,
        page: "crypt",
        text: "Cart tracks on the crypt road: one heavy cart going up, and a heavier one coming down. The ruts lead toward Kettle Ford and the Drowned Road.",
        gm: "The smugglers' cart, loaded with grave goods.",
        tags: ["clue", "tracks"],
        reveal: true
      },
      {
        day: 6,
        page: "aldous",
        text: "Brother Aldous's cell: neat, bed made, travelling cloak gone. The vigil candle was snuffed with fingers, not blown out. Nobody dragged him anywhere.",
        tags: ["clue", "aldous"],
        reveal: true
      }
    ],
    after: [
      {
        day: 6,
        page: "crypt",
        text: "The reliquary niche was empty and the candles had burned down days ago. The skeletons hummed a hymn as they fell apart. It sounded like a lullaby played backwards.",
        gm: "The hymn is the Pale Choir's. Ivo recognizes it (DC 14 History, or automatically).",
        tags: ["clue", "pale-choir"],
        reveal: true
      },
      {
        day: 6,
        page: "blade",
        text: "Rook claimed the Ember-Etched Blade from the guardian alcove. The runes along the fuller warmed in his hand.",
        tags: ["loot"],
        reveal: true
      },
      {
        day: 6,
        page: "locket",
        text: "In the third ossuary niche, tucked behind a skull: a silver locket engraved E.V. Inside, a curl of fair hair and a scrap of paper with three lines of a hymn.",
        gm: "Elsbeth Vane's. Aldous hid it here because he couldn't take it with him.",
        tags: ["clue", "keepsake"],
        reveal: true
      },
      {
        day: 6,
        page: "tamsin",
        text: `*Tamsin, later, at the Lantern and Lamb.*

Cold. Not like winter, like being forgotten. Then Maelis was shouting my name and I came back wrong-way-round and coughing ash. Rook says I owe her a drink. I owe her a lot more than that, and I am already bad at owing people things.`,
        tags: ["diary", "tamsin"],
        reveal: true
      },
      {
        kind: "downtime",
        day: 6,
        character: "maelis",
        who: "Maelis Thorn",
        activity: "Vigil at the cold Hollowmere shrine",
        days: 1,
        apply: true,
        text: "Maelis kept a night's vigil at the Hollowmere shrine with her Warden's Lantern. The two sunken graves stayed quiet while she sat by them.",
        reveal: true
      }
    ],
    end: {
      quests: [
        { key: "cold-ash", done: [0, 1] },
        { key: "locket", status: "active" }
      ],
      standing: [
        { faction: "wardens", value: 25, reason: "Cleared the risen dead from the Saint's crypt", reveal: true },
        { faction: "choir", value: -20, reason: "Destroyed the crypt's singing dead", reveal: false }
      ]
    }
  },
  {
    number: 4,
    realDate: "2026-09-26",
    status: "played",
    day: 9,
    attendees: ["Alex", "Jordan", "Riley", "Casey"],
    tags: ["arc-1", "port-varrow", "roleplay"],
    prepBody: `# Session 4: Salt and Smoke

## Strong start
The Drowned Road at spring tide: water to the axles, fog, and bells ringing somewhere out to sea.

## Scenes
- Arrival at Port Varrow. Rook is recognized by the watch.
- [[Captain Hessa Marrow]] asks a favor: find her leak.
- [[Mags Thimble]] at the Brine and Barrel offers a job: a crate in warehouse nine.
- [[Nan Gull]] reminds Tamsin of a debt.
- [[Mother Saltwhistle]] warns about the bells at Tidewrack.

## Secrets
- Warehouse nine on Cobble Wharf is where the crypt's grave goods went.
- The harbor tithe falls due tomorrow, and Mags can't pay it.
- Tidewrack's drowned bells are ringing.`,
    recapBody: `# Session 4: Salt and Smoke

*Sam was away; Ivo spent the session in the Port Varrow library, arguing with a librarian.*

## The Drowned Road
Two days over the causeway in fog. On the second night the spring tide covered the road to the axles, and from somewhere out to sea came the sound of bells. Corwin said there are no bells out there. Then he said there used to be.

## Port Varrow
The watch at the city gate recognized Rook, which got the party in without paying the gate toll and got Rook a long, quiet look from [[Captain Hessa Marrow]]. Over watch-house tea she asked a favor: someone in the watch is tipping off the smugglers, and she wants to know who.

## The Brine and Barrel
The party took rooms above [[The Brine and Barrel]] from [[Old Tobin]], who has served drinks to three kings and wants nobody bringing anything dead inside. [[Mags Thimble]] found them within the hour with a job: a crate of hers is in guild warehouse nine, held by smugglers who won't give it back. 100 gp, no questions.

## Old debts
On the way back from the market, an old woman selling smoked fish called Tamsin by a name she hasn't used in three years. [[Nan Gull]] wants her 300 gp by Harvestide 14.

## The shrine on the steps
Maelis lit a candle at the [[Shrine of the Drowned Mother]]. [[Mother Saltwhistle]] told her the bells at [[Tidewrack]] have started ringing at low tide, "which bells under water should not do".

## Open threads
- Warehouse nine.
- Tamsin's debt.
- The bells.`,
    before: [
      {
        day: 7,
        page: "road",
        text: `*From Corwin's trail notes.*

Spring tide on the causeway. Water to the axles by noon, and the fen folk out with their ropes and their prices. We paid. The carters who didn't are still there.`,
        tags: ["diary", "corwin", "travel"],
        reveal: true
      },
      {
        day: 8,
        page: "tidewrack",
        text: "Second night on the Drowned Road. Bells out to sea, slow and heavy, for about an hour after low tide. Corwin says there are no bells out there. Then he said there used to be, at Tidewrack.",
        gm: "The Choir is ringing the Drowned Bell from a rowing boat. Practice.",
        tags: ["omen", "tidewrack"],
        reveal: true
      }
    ],
    after: [
      {
        day: 9,
        page: "port",
        text: "Arrived in Port Varrow through the Saltgate. The watch waved Rook through and the rest of us with him. The harbor smells of tar, fish and old smoke.",
        tags: ["port-varrow", "travel"],
        reveal: true
      },
      {
        day: 9,
        page: "hessa",
        text: 'Captain Marrow\'s request, over watch-house tea: someone in the watch is tipping off the smugglers on Cobble Wharf. Find out who, quietly. She called Rook "Corporal" four times and did not smile once.',
        gm: "The leak is the harbormaster's man in the watch office, not Sergeant Pell.",
        tags: ["job", "watch"],
        reveal: true
      },
      {
        day: 9,
        page: "mags",
        text: "Mags Thimble's offer: a crate of hers is held in guild warehouse nine on Cobble Wharf by people who won't return it. 100 gp to fetch it, no questions asked or answered.",
        gm: "She sold the smugglers the key. The crate holds their ledger.",
        tags: ["job", "port-varrow"],
        reveal: true
      },
      {
        day: 9,
        page: "nan",
        text: 'Nan Gull, from behind a counter of smoked herring: "Three hundred, pet. By the fourteenth. Or we talk about other ways."',
        gm: "The other way is the Guild Hall job: steal the 1339 insurance records.",
        tags: ["debt", "gull-court"],
        reveal: true
      },
      {
        day: 9,
        page: "saltwhistle",
        text: "Mother Saltwhistle at the Shrine of the Drowned Mother: the bells at Tidewrack have rung at low tide every night this week. Someone has also been stealing pages from her hymnal.",
        tags: ["omen", "drowned-mother"],
        reveal: true
      },
      {
        day: 9,
        page: "corra",
        text: "Maelis sent her report to Emberhold by Warden courier: the theft, the crypt, Lord Ashdown and his guards. All of it.",
        gm: "Corra receives it on the 13th. It delays Grieve by two days only if the party also recovers the reliquary.",
        tags: ["wardens", "report"],
        reveal: true
      },
      {
        kind: "deadline",
        day: 10,
        page: "guild",
        text: "The harbor tithe is due to the guild.",
        gm: "The party is not on the hook for it, but Mags is.",
        tags: ["port-varrow", "guild"],
        reveal: true
      },
      {
        kind: "deadline",
        day: 14,
        page: "nan",
        text: "Tamsin's 300 gp is due to Nan Gull.",
        tags: ["debt", "gull-court"],
        reveal: true
      },
      {
        kind: "deadline",
        month: 7,
        day: 1,
        page: "guild",
        text: "The guild council votes on next year's watch budget.",
        gm: "If the ledger is public by then, the vote goes Hessa's way.",
        tags: ["port-varrow", "politics"],
        reveal: true
      }
    ],
    end: {
      quests: [
        { key: "warden-report", status: "completed", done: [0] },
        { key: "shipment", status: "active" },
        { key: "informant", status: "active" },
        { key: "gulls-due", status: "active" },
        { key: "bells", status: "not-started" }
      ],
      standing: [
        { faction: "gulls", value: -15, reason: "Tamsin's old debt is still unpaid", reveal: true },
        { faction: "guild", value: 5, reason: "Paid their berth and gate fees like honest folk", reveal: true }
      ]
    }
  },
  {
    number: 5,
    realDate: "2026-10-10",
    status: "played",
    day: 11,
    attendees: PLAYERS,
    tags: ["arc-1", "port-varrow", "combat"],
    fight: "warehouse",
    prepBody: `# Session 5: The Warehouse Job

## Strong start
Cobble Wharf at the change of the watch. Warehouse nine's lock is new and expensive.

## Scenes
- Casing the wharf. The watch patrol is suspiciously absent.
- Inside: the smugglers' captain, four bandits and a pirate muscle.
- Crates of grave goods from the crypt, and the ledger.
- Hessa arrives after the fight. The harbormaster's note arrives the next morning.

## Secrets
- The ledger names Aldous ("A.V., paid in promises") and three shipments "to the tower".
- The "Tidesman" in the ledger is Dunmore.
- An entry from 1339: *paid for the quiet night*.`,
    recapBody: `# Session 5: The Warehouse Job

## Casing the wharf
Tamsin watched Cobble Wharf for a day and found the watch patrol skipped warehouse nine on every round. Rook found that worrying. Hessa, when told, found it very interesting.

## The job
At the change of the watch Tamsin opened warehouse nine's lock. Inside: a smugglers' captain, four bandits and a pirate with a boarding axe, all of whom had been expecting someone. The captain knocked Corwin flat in the first exchange. It went downhill for the smugglers from there.

## What was in the crates
Grave goods from the Saint's crypt: candlesticks, burial rings, a reliquary cloth. And in Mags's "crate", the smugglers' ledger, eleven years of it, half in cipher.

## Captain Marrow arrives
The watch arrived after the fight, led by [[Captain Hessa Marrow]] and [[Sergeant Pell Okafor]]. Hessa read three pages of the ledger, went pale, and let the party keep it "for now". Next morning a polite note from [[Harbormaster Sile Dunmore]] offered a reward for its safe return.

## What the ledger says so far
- Three shipments of "grey goods" marked *to the tower*.
- An entry against the initials *A.V.*: *paid in promises*.
- A regular payment to "the Tidesman".
- From Ashfall 1339: *paid for the quiet night*.

## Open threads
- What tower? (The table is fairly sure.)
- Who is the Tidesman?
- What was the quiet night?
- Level up to 8 before next session.`,
    before: [
      {
        day: 10,
        page: "tamsin",
        text: `*Tamsin's notes, Cobble Wharf.*

Watch patrol passes nine every round, doesn't look at it once. New lock on the door, guild brass, the kind you have to know somebody to buy. Smoke from the roof vent after dark. Somebody's living in there, and somebody's being paid to not notice.`,
        tags: ["diary", "tamsin", "port-varrow"],
        reveal: true
      }
    ],
    after: [
      {
        day: 11,
        page: "warehouse",
        text: "Warehouse nine was full of grave goods from the Saint's crypt: candlesticks, burial rings, an embroidered reliquary cloth. Maelis wept, briefly, and then catalogued every piece.",
        tags: ["clue", "grave-goods"],
        reveal: true
      },
      {
        day: 11,
        page: "ledger",
        text: 'The smugglers\' ledger: eleven years of shipping records, half in cipher. Three shipments of "grey goods" marked to the tower. A line against the initials A.V.: paid in promises.',
        gm: "Secret 1 found: Aldous gave up the reliquary himself. The rest of the cipher hides the Tidesman and the 1339 payment.",
        tags: ["clue", "ledger"],
        reveal: true
      },
      {
        day: 11,
        page: "hessa",
        text: 'Captain Marrow arrived with Sergeant Okafor after the fight. She read three pages of the ledger, went pale, and let the party keep it, "for now, Corporal".',
        tags: ["watch"],
        reveal: true
      },
      {
        day: 12,
        page: "dunmore",
        text: `*A note on heavy blue paper, delivered to the Brine and Barrel.*

The Harbor Guild thanks you for your service in recovering guild property from warehouse nine. We understand certain records may have been removed in the confusion. The Guild will pay one hundred crowns for their safe return, and no further questions will trouble anyone.

S. Dunmore, Harbormaster`,
        gm: "Money first. Then lawyers. Then knives.",
        tags: ["handout", "guild"],
        reveal: true
      },
      {
        kind: "milestone",
        day: 11,
        level: 8,
        reason: "Broke the smuggling ring (level up before Session 6)",
        reveal: true
      },
      {
        kind: "downtime",
        day: 11,
        character: "rook",
        who: "Rook Ashgrave",
        activity: "Training with the Ember Wardens",
        days: 1,
        apply: true,
        text: "Rook drills with the Ember Wardens' sergeant at the Varrow chapter house, learning to fight beside a lantern.",
        reveal: true
      },
      {
        kind: "downtime",
        day: 12,
        character: "ivo",
        who: "Ivo Quillfeather",
        activity: "Transcribing a spell",
        days: 2,
        text: "Ivo copies Cinderburst from the crypt scroll into the spellbook, swearing at the scribe's handwriting.",
        reveal: true
      },
      {
        kind: "downtime",
        day: 12,
        character: "tamsin",
        who: "Tamsin Vey",
        activity: "Carousing for rumors",
        days: 1,
        text: "Tamsin works the dice tables at the Brine and Barrel, listening.",
        gm: "She hears rumor 7: the Sooted are coming to burn the churchyards.",
        reveal: false
      },
      {
        kind: "downtime",
        day: 12,
        character: "corwin",
        who: "Corwin Hale",
        activity: "Mapping the fen paths to the watchtower",
        days: 3,
        text: "Corwin wants three days on the fen paths to find a way to the old watchtower that doesn't use the road.",
        reveal: true
      },
      {
        day: 12,
        marker: "brine",
        text: "The party takes rooms above the Brine and Barrel for another week. Old Tobin has started leaving a lantern lit on the landing.",
        tags: ["port-varrow", "base"],
        reveal: true
      },
      {
        day: 12,
        page: "wren",
        text: `*A pale moth landed on the window of Corwin's room at dusk and would not leave. Tied to its leg, a strip of birch bark:*

Hale's boy. The fire can be found again without the silver pot. Come to the wood before the lanterns float. Bring the grieving one. W.`,
        gm: "Old Wren means Maelis's lantern and Aldous, or anyone who mourns. She wants Corwin as her successor.",
        tags: ["handout", "wren"],
        reveal: true
      },
      {
        day: 12,
        page: "ivo",
        text: `*From Ivo's notebook.*

The cipher is a substitution with a rotating key, and the key is a hymn. Of course it is. I know four lines of it from a book I was thrown out of a library for reading. Four more lines and I can read the whole ledger. I have not told the others where I learned them. I will. Soon.`,
        tags: ["diary", "ivo", "cipher"],
        reveal: true
      },
      {
        kind: "deadline",
        day: 16,
        page: "grieve",
        text: "",
        gm: "Inquisitor Grieve reaches Hollowmere with twenty soldiers unless the reliquary is back.",
        tags: ["sooted", "clock"],
        reveal: false
      },
      {
        kind: "deadline",
        day: 20,
        page: "tower",
        text: "",
        gm: "Dawn: the Pale Choir's rite completes at the watchtower and the reliquary cracks.",
        tags: ["pale-choir", "clock"],
        reveal: false
      },
      {
        kind: "deadline",
        month: 7,
        day: 3,
        page: "tidewrack",
        text: "",
        gm: "If the rite completed, the drowned walk out of the surf at Tidewrack and march on Port Varrow.",
        tags: ["pale-choir", "clock", "tidewrack"],
        reveal: false
      }
    ],
    end: {
      quests: [
        { key: "cold-ash", done: [0, 1, 2, 3] },
        { key: "shipment", done: [0, 1] },
        { key: "informant", status: "canceled" },
        { key: "wren", status: "not-started" },
        { key: "tidesman", status: "not-started" }
      ],
      standing: [
        { faction: "guild", value: -15, reason: "Raided guild warehouse nine", reveal: true },
        { faction: "gulls", value: -5, reason: "Nan is still waiting, and has heard about the ledger", reveal: true },
        { faction: "choir", value: -50, reason: "Took back the Choir's grave goods", reveal: false }
      ]
    }
  },
  {
    number: 6,
    realDate: "2026-10-24",
    status: "planned",
    day: null,
    attendees: [],
    tags: ["arc-2"],
    prepBody: `# Session 6: Into the Gloomwood (planned)

Everyone levels up to 8 before we start.

## Strong start
Dawn on Harvestide 13. A moth on the window, a note from the harbormaster under the door, and the sound of the Tidewrack bells even here.

## Likely scenes
- Decide what to do with the ledger: Hessa, Mags, Nan or Dunmore all want it.
- Ride back over the Drowned Road, or Corwin's fen paths.
- Return Grub's drum and take the goblin paths through the Gloomwood.
- [[Old Wren]]'s hut: the Peat Mothers' rite, and her offer to Corwin.
- If they move fast: the assault on the [[Ruined Watchtower]] (scene is staged on the table).

## Secrets ready to drop
- The tower is the Choir's base (Mags will sell it; the ledger confirms it).
- The rite completes at dawn on the 20th.
- Elsbeth's locket can talk Aldous down.
- Sung backwards, the hymn unmakes the rite (Ivo, once the cipher is done).

## Monsters
4 Pale Choir initiates, 2 Cinder Hounds, Vessa on the stair. She flees at half HP.`,
    recapBody: ""
  }
];

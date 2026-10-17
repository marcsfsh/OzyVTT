// Codex pages for the places, things, creatures, faiths and history of the Ashen Reach. Invented
// placeholder content; `revealed` pages are visible to players, and gmBody / gmFields never are.

export const PLACES = [
  {
    key: "reach",
    title: "The Ashen Reach",
    entityType: "location",
    folder: "Places",
    tags: ["region", "overview"],
    fields: {
      kind: "Frontier region",
      region: "The north coast",
      population: "About 40,000",
      ruler: "Several lords, one guild and a church; nobody in charge",
      climate: "Cool, wet and foggy; hard winters"
    },
    playerBody: `A frontier of fog, peat bog and old graves between the [[Greyspire Mountains]] and the sea. For thirteen centuries the ashes of [[Saint Ilvara]] have kept its dead in the ground, and the people of the Reach have built their lives around that promise: a shrine in every village, a lantern on every grave, and a habit of looking twice at anyone walking after dark.

## Regions
- [[Gloamshire Vale]]: farms, peat, the crypt of the Saint.
- [[Brackwater Fens]]: salt pans, eels and causeways.
- [[Port Varrow]]: the only real city, on the river mouth.
- [[The Drowned Road]]: the causeway that ties them together.
- The [[Greyspire Mountains]], where [[Emberhold Abbey]] keeps watch.
- The drowned coast around [[Tidewrack]].

## Who holds power
[[Lord Corvin Ashdown]] holds the vale, the [[Varrow Harbor Guild]] holds the port, [[The Ember Wardens]] hold the shrines, and [[The Peat Moot]] holds grudges.`,
    gmBody: `Every graveyard in the Reach goes restless within a month if the ashes are not relit. The first will be the ones nearest the crypt: [[Hollowmere]] by Harvestide 18, [[Moss End]] by Harvestide 24.`,
    revealed: true
  },
  {
    key: "vale",
    title: "Gloamshire Vale",
    entityType: "location",
    folder: "Places/Gloamshire Vale",
    tags: ["region", "gloamshire"],
    fields: {
      kind: "Farming vale",
      region: "The Ashen Reach",
      population: "About 3,000",
      ruler: "Lord Corvin Ashdown",
      climate: "Mild and misty; early frosts"
    },
    playerBody: `A green, misty vale of barley farms and peat cuttings along the river Kettle. Its market village is [[Hollowmere]], and a dozen hamlets hang off it like beads on a string. The [[Crypt of the Ashen Saint]] sits on the northern ridge above the [[Gloomwood]], and [[Ashdown Manor]] looks down on all of it.

Vale folk are polite, slow to trust and quick to bury. Every farm has a lantern-post by its family graves, and every lantern was lit from the Hollowmere shrine.`,
    gmBody: "",
    revealed: true
  },
  {
    key: "hollowmere",
    title: "Hollowmere",
    entityType: "location",
    folder: "Places/Gloamshire Vale",
    tags: ["village", "gloamshire"],
    fields: {
      kind: "Market village",
      region: "Gloamshire Vale",
      population: "600",
      ruler: "Lord Corvin Ashdown",
      climate: "Misty, by a cold lake"
    },
    playerBody: `A lakeside market village, rebuilt in grey stone after [[The Burning of Hollowmere]] in 1342. It has a shrine, a churchyard of nine hundred graves, a mill, an inn ([[The Lantern and Lamb]]) and opinions.

## Notable
- The shrine flame went out at midnight on Harvestide 1. [[Sexton Hobb]] saw it.
- The Festival of Lanterns on Harvestide 15 is the biggest night of the year: lanterns floated on the lake for the dead.
- Two graves in the churchyard have sunk. Nobody will walk past them after dark.`,
    gmBody:
      "Two Choir sympathizers live here: the chandler, Mistress Ebb, and her son. They send ravens to the watchtower.",
    revealed: true
  },
  {
    key: "lamb",
    title: "The Lantern and Lamb",
    entityType: "location",
    folder: "Places/Gloamshire Vale",
    tags: ["inn", "hollowmere"],
    fields: {
      kind: "Inn",
      region: "Hollowmere",
      population: "Full on market days",
      ruler: "Widow Agnes Fairweather",
      climate: "Warm, smells of peat smoke and mutton"
    },
    playerBody:
      "Hollowmere's inn. Low beams, a peat fire that has not gone out in eighty years, and a landlady who knows everyone's business. The party stayed here in session 2 and heard the rumor about lights on the old watchtower.",
    gmBody: "",
    revealed: true
  },
  {
    key: "manor",
    title: "Ashdown Manor",
    entityType: "location",
    folder: "Places/Gloamshire Vale",
    tags: ["manor", "gloamshire", "noble"],
    fields: {
      kind: "Fortified manor",
      region: "Gloamshire Vale",
      population: "Lord Ashdown, 20 servants, 8 guards",
      ruler: "Lord Corvin Ashdown",
      climate: "Drafty"
    },
    playerBody: `[[Lord Corvin Ashdown]]'s house on the hill above Hollowmere. Portraits of eleven generations of Ashdowns, most of them holding lanterns. The party was received in the long gallery in session 2.`,
    gmBody:
      "The two crypt guards are here, polishing silver. Any servant will say so if asked kindly and away from the steward.",
    revealed: true
  },
  {
    key: "ford",
    title: "Kettle Ford",
    entityType: "location",
    folder: "Places/Gloamshire Vale",
    tags: ["ford", "road", "battle"],
    fields: {
      kind: "River crossing and coaching inn",
      region: "Gloamshire Vale",
      population: "30",
      ruler: "The Peat Moot",
      climate: "Wet"
    },
    playerBody: `Where [[The Drowned Road]] crosses the river Kettle, with a coaching inn on the east bank and a treaty stone on the west. The [[The Saltwar]] ended here in 1022. The party met at the inn in session 0 and fought the Mudfoot goblins at the ford in session 1.`,
    gmBody: "",
    revealed: true
  },
  {
    key: "mossend",
    title: "Moss End",
    entityType: "location",
    folder: "Places/Gloamshire Vale",
    tags: ["village", "peat-moot"],
    fields: {
      kind: "Peat-cutting village",
      region: "Edge of the Brackwater Fens",
      population: "250",
      ruler: "The Peat Moot",
      climate: "Damp, always"
    },
    playerBody: `A village of turf-roofed houses where the vale meets the fens. Seat of [[The Peat Moot]] and home of [[Brannoc Hale]]. Its shrine was the first ever to go cold, in [[The First Guttering]] of 211 AR, and the village has never quite trusted the Wardens since.`,
    gmBody: "",
    revealed: true
  },
  {
    key: "crypt",
    title: "Crypt of the Ashen Saint",
    entityType: "location",
    folder: "Places/Gloamshire Vale",
    tags: ["dungeon", "gloamshire", "battle"],
    fields: {
      kind: "Crypt and shrine",
      region: "Gloamshire Vale",
      population: "The honored dead",
      ruler: "Brother Aldous Vane (missing)",
      climate: "Cold and very dry"
    },
    playerBody: `The resting place of the reliquary between pilgrimages, cut into the northern ridge. An upper chapel, a long ossuary of the Saint's honored dead, and the reliquary niche at the end.

## Session 3
The niche was empty and the candles had burned out days before. The ossuary's guardians had risen as [[Ashwalkers]], an Ash Wight among them, and they hummed as they fought. The party cleared it and found the [[Ember-Etched Blade]] in the guardian alcove.`,
    gmBody:
      "[[Elsbeth's Locket]] was in the third ossuary niche, where Aldous hid it before he left. The party found it.",
    revealed: true
  },
  {
    key: "gloomwood",
    title: "Gloomwood",
    entityType: "location",
    folder: "Places/Gloamshire Vale",
    tags: ["forest", "gloamshire"],
    fields: {
      kind: "Old forest",
      region: "Gloamshire Vale",
      population: "Goblins, moths, one witch",
      ruler: "Nobody, and Old Wren",
      climate: "Dark, damp and quiet"
    },
    playerBody: `An old forest of black pines on the ridge behind the crypt. [[Gloam Moths]] glow in it at dusk. The [[Mudfoot Tribe]] lives at its southern edge, [[Old Wren]] somewhere in the middle, and nobody sensible goes in after dark.`,
    gmBody: "The goblin paths cut straight through it to the [[Ruined Watchtower]]. Grub knows them.",
    revealed: true
  },
  {
    key: "tower",
    title: "Ruined Watchtower",
    entityType: "location",
    folder: "Places/Gloamshire Vale",
    tags: ["ruin", "pale-choir"],
    fields: {
      kind: "Ruined tower",
      region: "Northern Gloamshire",
      population: "Unknown",
      ruler: "Unknown",
      climate: "Windswept"
    },
    playerBody:
      "A broken watchtower on the cliffs above the [[Brackwater Fens]], left over from [[The Saltwar]]. Lights have been seen there at night.",
    gmBody: `The Pale Choir's base. Ground floor: four initiates and two [[Cinder Hounds]]. Stair: [[Vessa the Pale]], watching. Top floor: [[Brother Aldous Vane]] and [[The Saint's Reliquary]] on an altar of drowned driftwood.

The rite needs three nights of singing and finishes at dawn on Harvestide 20.`,
    revealed: false
  },
  {
    key: "fens",
    title: "Brackwater Fens",
    entityType: "location",
    folder: "Places/The Wider Reach",
    tags: ["region", "fens"],
    fields: {
      kind: "Salt marsh",
      region: "The Ashen Reach",
      population: "About 2,000 in stilt villages",
      ruler: "The Peat Moot",
      climate: "Fog nine days in ten"
    },
    playerBody: `Salt marsh and reed beds between the vale and the sea, crossed by [[The Drowned Road]]. Fen villages live on stilts, eels and salt. The salt pans are the reason [[The Saltwar]] was fought.`,
    gmBody: "",
    revealed: true
  },
  {
    key: "road",
    title: "The Drowned Road",
    entityType: "location",
    folder: "Places/The Wider Reach",
    tags: ["road", "travel"],
    fields: {
      kind: "Causeway road",
      region: "Gloamshire to Port Varrow",
      population: "Carters, pilgrims, smugglers",
      ruler: "Nobody maintains it",
      climate: "Floods at spring tides"
    },
    playerBody: `An old stone causeway from [[Kettle Ford]] across the fens to [[Port Varrow]]. Two days on foot when dry. Twice a month the spring tides cover it, which is how it got its name, and how the fen villages make a living hauling carts out of the mud.`,
    gmBody: "",
    revealed: true
  },
  {
    key: "greyspire",
    title: "Greyspire Mountains",
    entityType: "location",
    folder: "Places/The Wider Reach",
    tags: ["mountains"],
    fields: {
      kind: "Mountain range",
      region: "North of the Reach",
      population: "Shepherds and the abbey",
      ruler: "The Ember Wardens, in practice",
      climate: "Snow eight months of the year"
    },
    playerBody: `The mountains that wall off the Reach to the north. [[Saint Ilvara]] was a shepherd's daughter from these slopes. [[Emberhold Abbey]] sits in the foothills where the great pyre burned.`,
    gmBody: "",
    revealed: true
  },
  {
    key: "emberhold",
    title: "Emberhold Abbey",
    entityType: "location",
    folder: "Places/The Wider Reach",
    tags: ["abbey", "wardens"],
    fields: {
      kind: "Fortified abbey",
      region: "Greyspire foothills",
      population: "About 300",
      ruler: "Warden-Abbess Corra Lind",
      climate: "Cold, clear"
    },
    playerBody: `Seat of [[The Ember Wardens]], built on the ground where Saint Ilvara's pyre burned. Its great hearth has not gone out in thirteen hundred years. The reliquary rests here between its pilgrimages to the crypt in Gloamshire.

The abbey library holds the largest archive in the Reach, including the sealed stacks that [[Ivo Quillfeather]] was dismissed for reading.`,
    gmBody: "The Black Cloister, home of [[The Sooted]], is a separate wing. Its doors open outward only.",
    revealed: true
  },
  {
    key: "tidewrack",
    title: "Tidewrack",
    entityType: "location",
    folder: "Places/The Wider Reach",
    tags: ["drowned", "coast", "rumor"],
    fields: {
      kind: "Drowned village and cliff cemetery",
      region: "The drowned coast",
      population: "14 living; many more in the water",
      ruler: "Nobody",
      climate: "Gales"
    },
    playerBody: `A fishing village half lost to the sea two centuries ago. Its old chapel and bell tower stand under the water at the foot of the cliffs. The village holds the Saltblessing every Seedfall 12, when boats are blessed over the drowned chapel. [[Elsbeth Vane]] drowned there in 1346.

[[Mother Saltwhistle]] says the drowned bells have started ringing at low tide.`,
    gmBody:
      "If the rite completes, the drowned of 1339 and of every Saltblessing walk out of the surf here on Ashfall 3. [[The Drowned Bell]] is the Choir's signal.",
    revealed: true
  },
  {
    key: "port",
    title: "Port Varrow",
    entityType: "location",
    folder: "Places/Port Varrow",
    tags: ["city", "port-varrow"],
    fields: {
      kind: "Harbor city",
      region: "Mouth of the Kettle",
      population: "12,000",
      ruler: "Varrow Harbor Guild council",
      climate: "Salt fog; smells of fish and tar"
    },
    playerBody: `The Reach's only real city: fish, salt, smuggling and the [[Varrow Harbor Guild]]. Built on the mud of the river mouth and propped up with timber, stone and spite.

## Districts
- The [[Saltmarsh Docks]], rebuilt after the [[Harbor Fire of 1339]].
- Guild Row, where the [[Guild Hall]] and the counting houses are.
- The fish market, where [[Nan Gull]] keeps her stall.
- Chapel Steps, with the [[Shrine of the Drowned Mother]].

The [[Varrow Watch House]] sits between Guild Row and the docks, which tells you most of what you need to know about the watch.`,
    gmBody: "",
    revealed: true
  },
  {
    key: "docks",
    title: "Saltmarsh Docks",
    entityType: "location",
    folder: "Places/Port Varrow",
    tags: ["district", "port-varrow"],
    fields: {
      kind: "Harbor district",
      region: "Port Varrow",
      population: "About 3,000",
      ruler: "The guild by day, the Gull Court by night",
      climate: "Wet"
    },
    playerBody:
      "Wharves, warehouses, net lofts and taverns, rebuilt in a hurry after 1339 and leaning on each other ever since. [[Tamsin Vey]] grew up here. [[The Brine and Barrel]] and the [[Port Varrow Warehouse]] are both on the waterfront.",
    gmBody: "A dozen dock families who lost people in 1339 sing with the Choir in a net loft on Cobble Wharf.",
    revealed: true
  },
  {
    key: "brine",
    title: "The Brine and Barrel",
    entityType: "location",
    folder: "Places/Port Varrow",
    tags: ["tavern", "port-varrow", "base"],
    fields: {
      kind: "Tavern with rooms",
      region: "Saltmarsh Docks",
      population: "Busy after dark",
      ruler: "Old Tobin",
      climate: "Smoky"
    },
    playerBody:
      "Dockside tavern and the party's base in Port Varrow. The fish stew is better than it smells. [[Old Tobin]] owns it, and [[Mags Thimble]] works out of the back room.",
    gmBody: "",
    revealed: true
  },
  {
    key: "warehouse",
    title: "Port Varrow Warehouse",
    entityType: "location",
    folder: "Places/Port Varrow",
    tags: ["warehouse", "port-varrow", "battle"],
    fields: {
      kind: "Guild warehouse",
      region: "Saltmarsh Docks",
      population: "Smugglers (cleared)",
      ruler: "Varrow Harbor Guild",
      climate: "Damp"
    },
    playerBody: `Guild warehouse number nine on Cobble Wharf. Smugglers used it to move stolen grave goods from the crypt. The party broke in and cleared it in session 5 and took the [[Smugglers' Ledger]].`,
    gmBody: "The guild's harbormaster knew exactly what the warehouse was used for and took a cut.",
    revealed: true
  },
  {
    key: "guildhall",
    title: "Guild Hall",
    entityType: "location",
    folder: "Places/Port Varrow",
    tags: ["guild", "port-varrow"],
    fields: {
      kind: "Guild hall and counting house",
      region: "Guild Row",
      population: "Clerks, merchants, guards",
      ruler: "Harbormaster Sile Dunmore",
      climate: "Well heated"
    },
    playerBody:
      "A tall blue-and-silver hall with a weathervane shaped like a coin. The council of the [[Varrow Harbor Guild]] meets here.",
    gmBody:
      "The insurance records for 1339 are in a locked chest in the harbormaster's study. [[Nan Gull]] wants them.",
    revealed: true
  },
  {
    key: "mothershrine",
    title: "Shrine of the Drowned Mother",
    entityType: "location",
    folder: "Places/Port Varrow",
    tags: ["shrine", "drowned-mother", "port-varrow"],
    fields: {
      kind: "Sea shrine",
      region: "Chapel Steps",
      population: "Fishers' families",
      ruler: "Mother Saltwhistle",
      climate: "Salt spray"
    },
    playerBody: `A shrine of driftwood and whale bone on the steps above the harbor, kept by [[Mother Saltwhistle]]. The walls are covered in the names of people the sea has taken. Sailors leave salt and a coin before every voyage.`,
    gmBody: "",
    revealed: true
  },
  {
    key: "watchhouse",
    title: "Varrow Watch House",
    entityType: "location",
    folder: "Places/Port Varrow",
    tags: ["watch", "port-varrow"],
    fields: {
      kind: "Watch barracks and cells",
      region: "Between Guild Row and the docks",
      population: "40 watch officers",
      ruler: "Captain Hessa Marrow",
      climate: "Drafty"
    },
    playerBody:
      "Headquarters of the city watch, under [[Captain Hessa Marrow]]. Under-staffed, under-paid and over-worked.",
    gmBody: "",
    revealed: true
  }
];

export const ITEMS = [
  {
    key: "reliquary",
    title: "The Saint's Reliquary",
    entityType: "item",
    folder: "Items",
    tags: ["artifact", "quest-item"],
    fields: {
      kind: "Artifact",
      rarity: "Artifact",
      owner: "Stolen",
      attunement: "No",
      properties: "Holds the ashes of Saint Ilvara. Undead within a mile cannot rise. Source of every shrine flame."
    },
    playerBody: `A silver urn the size of a lantern, engraved with the Saint's last words. It holds the ashes of [[Saint Ilvara]], and every shrine flame in the Reach burns an ember drawn from it. It travels between [[Emberhold Abbey]] and the [[Crypt of the Ashen Saint]] on a pilgrimage cycle.

It was stolen on [[The Night the Ash Went Cold]].`,
    gmBody:
      "On an altar at the top of the [[Ruined Watchtower]]. If Vessa completes her rite, the urn cracks, the effect reverses, and the dead within a mile wake instead.",
    revealed: true
  },
  {
    key: "blade",
    title: "Ember-Etched Blade",
    entityType: "item",
    folder: "Items",
    tags: ["magic-item", "loot", "homebrew"],
    fields: {
      kind: "Weapon (longsword)",
      rarity: "Uncommon",
      owner: "Rook Ashgrave",
      attunement: "Yes",
      properties: "+1d4 fire damage on a hit; sheds dim light in a 10-foot radius."
    },
    playerBody: `Found in the guardian alcove of the [[Crypt of the Ashen Saint]]. Runes along the fuller glow like banked coals. Carried by [[Rook Ashgrave]], who says it hums when the dead are near.`,
    gmBody:
      "It does. Give Rook a warning hum one round before any undead ambush. Also on the Homebrew list as a full item.",
    revealed: true
  },
  {
    key: "ledger",
    title: "Smugglers' Ledger",
    entityType: "item",
    folder: "Items",
    tags: ["clue", "port-varrow"],
    fields: {
      kind: "Book",
      rarity: "Mundane",
      owner: "The party",
      attunement: "No",
      properties: "Coded shipping records, eleven years of them."
    },
    playerBody: `Taken from the [[Port Varrow Warehouse]]. Half of it is plain shipping records; half is a substitution cipher [[Ivo Quillfeather]] is still working on.

## Decoded so far
- Three shipments of "grey goods" marked *to the tower*.
- A recurring payment to someone called "the Tidesman".
- An entry from Ashfall 1339 that just says *paid for the quiet night*.`,
    gmBody:
      "The Tidesman is [[Harbormaster Sile Dunmore]]. The 1339 entry is the payment to keep the watch off the quay before the Harbor Fire. The last page, once decoded, is a copy of a verse from the [[Hymnal of Hollow Notes]].",
    revealed: true
  },
  {
    key: "locket",
    title: "Elsbeth's Locket",
    entityType: "item",
    folder: "Items",
    tags: ["quest-item", "keepsake"],
    fields: {
      kind: "Silver locket",
      rarity: "Mundane",
      owner: "Maelis Thorn",
      attunement: "No",
      properties: "Holds a curl of fair hair and a scrap of a hymn."
    },
    playerBody: `A small silver locket found hidden in the third ossuary niche of the crypt. Engraved *E.V.* Inside: a curl of fair hair and a scrap of paper with three lines of a hymn nobody recognizes, except perhaps Ivo.`,
    gmBody:
      "It belonged to [[Elsbeth Vane]]. Aldous hid it before he left because he couldn't bear to take it. Showing it to him is the best way to talk him down.",
    revealed: true
  },
  {
    key: "hymnal",
    title: "Hymnal of Hollow Notes",
    entityType: "item",
    folder: "Items",
    tags: ["artifact", "pale-choir", "secret"],
    fields: {
      kind: "Book",
      rarity: "Very rare",
      owner: "Vessa the Pale",
      attunement: "Yes, by a singer",
      properties:
        "Its ink is made from grave goods. Singing from it can wake the dead or, sung backwards, lay them down."
    },
    playerBody: "",
    gmBody: `The Pale Choir's holy book, written over three centuries in ink ground from grave goods. Vessa's rite is its last hymn. A fragment survives in Emberhold's sealed stacks, which [[Ivo Quillfeather]] read.

Sung backwards, the last hymn unmakes the rite. That is the party's way to win without killing Aldous.`,
    revealed: false
  },
  {
    key: "lantern",
    title: "Warden's Lantern",
    entityType: "item",
    folder: "Items",
    tags: ["wardens", "item"],
    fields: {
      kind: "Brass lantern",
      rarity: "Common",
      owner: "Maelis Thorn",
      attunement: "No",
      properties: "Carries a shrine ember without fuel for a year and a day."
    },
    playerBody:
      "The brass lantern every Warden novice is given at their vows. [[Maelis Thorn]]'s holds an ember from the great hearth at Emberhold. It cannot relight a shrine by itself, but it keeps the dead from rising within a few feet of it.",
    gmBody: "Combined with the Peat Mothers' rite, this ember can relight the Hollowmere shrine without the reliquary.",
    revealed: true
  },
  {
    key: "drum",
    title: "Grub's War Drum",
    entityType: "item",
    folder: "Items",
    tags: ["goblins", "loot"],
    fields: {
      kind: "Drum",
      rarity: "Mundane, to anyone but a goblin",
      owner: "The party (as surety)",
      attunement: "No",
      properties: "Loud. Smells of eel."
    },
    playerBody:
      "The Mudfoot tribe's war drum, taken as surety when the party spared [[Grub]]. Corwin is carrying it. Nobody has asked him to.",
    gmBody: "Returning it earns Grub's guidance through the Gloomwood.",
    revealed: true
  },
  {
    key: "bell",
    title: "The Drowned Bell",
    entityType: "item",
    folder: "Items",
    tags: ["tidewrack", "rumor"],
    fields: {
      kind: "Chapel bell",
      rarity: "Unknown",
      owner: "The sea",
      attunement: "No",
      properties: "Rings under water at low tide."
    },
    playerBody: "The great bell of the drowned chapel at [[Tidewrack]]. It has started ringing again.",
    gmBody:
      "The Choir rings it from a rowing boat with a rope and a weight. Each ring wakes a few more of the drowned. It is practice.",
    revealed: true
  }
];

export const CREATURES = [
  {
    key: "bog-goblins",
    title: "Bog Goblins",
    entityType: "species",
    folder: "Bestiary",
    tags: ["goblins", "bestiary"],
    fields: {
      category: "Humanoid",
      habitat: "Peat bogs and forest edges",
      diet: "Eels, frogs, anything",
      size: "Small",
      traits: "Hold breath for 15 minutes; mud camouflage; afraid of floating things."
    },
    playerBody:
      "Goblins of the Reach's bogs, greenish-brown and web-toed. They bury their dead in the peat, which keeps them, and they are more frightened of the walking dead than anyone. See the [[Mudfoot Tribe]].",
    gmBody: "",
    revealed: true
  },
  {
    key: "moths",
    title: "Gloam Moths",
    entityType: "species",
    folder: "Bestiary",
    tags: ["beast", "bestiary", "gloomwood"],
    fields: {
      category: "Beast",
      habitat: "Gloomwood",
      diet: "Grave moss",
      size: "Tiny",
      traits: "Glow pale green at dusk, brighter near the dead."
    },
    playerBody:
      "Pale moths that glow at dusk in the [[Gloomwood]]. Locals say they glow brighter near the restless dead. [[Old Wren]] keeps hundreds.",
    gmBody:
      "True. A jar of them works as an undead detector out to 60 feet. A queen moth can carry a message anywhere in the Reach.",
    revealed: true
  },
  {
    key: "ashborn",
    title: "Ashborn",
    entityType: "species",
    folder: "Bestiary",
    tags: ["playable", "homebrew"],
    fields: {
      category: "Humanoid",
      habitat: "Shrine towns of the Reach",
      diet: "As humans",
      size: "Medium",
      traits: "Ember-grey skin, warm to the touch; resistant to fire."
    },
    playerBody: `People born on the night a shrine flame is relit. Their skin is ember-grey and warm to the touch, and old ash clings to their hair however often they wash it. Ashborn are thought lucky in the vale and unlucky in Port Varrow. A playable homebrew species (see the Homebrew tab).`,
    gmBody: "",
    revealed: true
  },
  {
    key: "ashwalkers",
    title: "Ashwalkers",
    entityType: "species",
    folder: "Bestiary",
    tags: ["undead", "bestiary"],
    fields: {
      category: "Undead",
      habitat: "Graveyards near cold shrines",
      diet: "None",
      size: "Medium",
      traits: "Rise where a shrine flame dies; hum the Hollow Hymn; crumble in shrine light."
    },
    playerBody: `The dead that rise where a shrine has gone cold: skeletons and corpses that walk with ash in their joints. The worst of them, crypt guardians packed with the Saint's own spent ash, are called Ash Wights. One nearly killed Tamsin in the crypt.`,
    gmBody: "Use skeletons, zombies and the homebrew Ash Wight. They hum because the Choir's rite is calling them.",
    revealed: true
  },
  {
    key: "brinewights",
    title: "Brinewights",
    entityType: "species",
    folder: "Bestiary",
    tags: ["undead", "bestiary", "drowned"],
    fields: {
      category: "Undead",
      habitat: "The sea",
      diet: "Warmth",
      size: "Medium",
      traits: "Drowned dead; remember their names but not why they mattered."
    },
    playerBody: "Sailors' tales of the drowned who come back up. Fishers in Port Varrow won't say the word on a boat.",
    gmBody:
      "This is what the Choir's rite will raise from the sea. Use wights with the swimming trait and resistance to cold.",
    revealed: true
  },
  {
    key: "hounds",
    title: "Cinder Hounds",
    entityType: "species",
    folder: "Bestiary",
    tags: ["fiend", "bestiary", "homebrew", "pale-choir"],
    fields: {
      category: "Fiend",
      habitat: "Wherever the Choir keeps them",
      diet: "Coal and spite",
      size: "Medium",
      traits: "Breathe burning ash."
    },
    playerBody: "",
    gmBody:
      "Gaunt hounds of smoke and ember bred by the Choir to guard the watchtower. Homebrew monster, hidden from players.",
    revealed: false
  }
];

export const FAITHS = [
  {
    key: "saint",
    title: "The Ashen Saint",
    entityType: "religion",
    folder: "Lore/Faiths",
    tags: ["faith", "saint"],
    fields: {
      deity: "Saint Ilvara the Ashen",
      domains: "Life, Light",
      alignment: "Lawful good",
      followers: "Most of the Reach"
    },
    playerBody: `The faith of the Reach. [[Saint Ilvara]] is not a god; she is the woman who gave herself so the dead would rest, and her followers honor the gift by keeping the fire. Its clergy are [[The Ember Wardens]].

## Practice
- A shrine flame in every village, lit from the reliquary.
- A lantern on every grave for the first year after burial.
- Pyre Night (Longnight 32) and the Festival of Lanterns (Harvestide 15).
- The greeting *Keep the fire*, answered *and the fire keeps us*.`,
    gmBody: "",
    revealed: true
  },
  {
    key: "mother",
    title: "The Drowned Mother",
    entityType: "religion",
    folder: "Lore/Faiths",
    tags: ["faith", "sea", "port-varrow"],
    fields: {
      deity: "The Drowned Mother",
      domains: "Tempest, Death",
      alignment: "Neutral",
      followers: "Fishers and sailors of Port Varrow and the coast"
    },
    playerBody: `An older faith than the Saint's, kept by people who work the sea. The Drowned Mother takes who she takes, and keeps them. Her priests do not light lanterns for the drowned, because the sea is already their grave.

Her great festival is the Saltblessing on Seedfall 12, when boats are blessed over [[Tidewrack]].`,
    gmBody: "The Choir has twisted her hymns for their rites. [[Mother Saltwhistle]] has noticed.",
    revealed: true
  },
  {
    key: "hymn",
    title: "The Hollow Hymn",
    entityType: "religion",
    folder: "Lore/Faiths",
    tags: ["faith", "pale-choir", "secret"],
    fields: {
      deity: "None; the dead themselves",
      domains: "Death",
      alignment: "Neutral evil",
      followers: "The Pale Choir"
    },
    playerBody: "",
    gmBody: `The Pale Choir's creed: the dead are owed a second life, and the living owe them service. Its hymns are sung to the dead, not to any god. It began in Tidewrack after the sea took the village, and it has always drawn its people from the grieving.`,
    revealed: false
  },
  {
    key: "peat-mothers",
    title: "The Peat Mothers",
    entityType: "religion",
    folder: "Lore/Faiths",
    tags: ["faith", "folk", "gloamshire"],
    fields: {
      deity: "The Peat Mothers (three, unnamed)",
      domains: "Nature, Grave",
      alignment: "Neutral",
      followers: "Old families of the fens and the vale"
    },
    playerBody:
      "The folk faith of the vale before the Saint: three mothers under the peat who keep the dead and the seed alike. Mostly remembered now in nursery rhymes and the corn dollies hung over doors at harvest.",
    gmBody:
      "The Peat Mothers' rite can relight a shrine flame from a living ember and a willing mourner, without the reliquary. [[Old Wren]] is its last keeper.",
    revealed: true
  }
];

export const EVENTS = [
  {
    key: "reckoning",
    title: "The Reckoning",
    entityType: "event",
    folder: "Lore/History",
    tags: ["history", "saint"],
    fields: {
      when: "Longnight 32, 0 AR",
      where: "Emberhold",
      participants: "Saint Ilvara and the Ember Host",
      outcome: "The dead of the Reach were laid to rest. The calendar began the next morning."
    },
    playerBody: `The night [[Saint Ilvara]] walked into the great pyre at Emberhold and ended the Age of Embers. Every year since begins the morning after, on Frostwane 1.`,
    gmBody: "",
    revealed: true,
    inWorldDate: { year: 0, month: 9, day: 32 }
  },
  {
    key: "emberhold-founding",
    title: "Founding of Emberhold",
    entityType: "event",
    folder: "Lore/History",
    tags: ["history", "wardens"],
    fields: {
      when: "3 AR",
      where: "Emberhold",
      participants: "Warden Aumry and the first Wardens",
      outcome: "The Ember Wardens founded; the shrine network begun."
    },
    playerBody:
      "Ilvara's disciple, Warden Aumry, built the first abbey around the pyre's hearth and carried the first embers to the villages. See [[The Ember Wardens]].",
    gmBody: "",
    revealed: true,
    inWorldDate: { year: 3, month: 0, day: 1 }
  },
  {
    key: "guttering",
    title: "The First Guttering",
    entityType: "event",
    folder: "Lore/History",
    tags: ["history", "moss-end"],
    fields: {
      when: "Thawmoot 211 AR",
      where: "Moss End",
      participants: "The village of Moss End",
      outcome: "The first shrine to go cold, relit with an ember from the reliquary."
    },
    playerBody: `The shrine flame at [[Moss End]] went out in a flood. Within a week the churchyard was restless. The Wardens relit it with an ember carried from the reliquary, and the rite of relighting has been done the same way ever since.`,
    gmBody:
      "Before the Wardens arrived, a village wise-woman relit it for a night with the Peat Mothers' rite. That part of the story was dropped from the official record.",
    revealed: true,
    inWorldDate: { year: 211, month: 1, day: 17 }
  },
  {
    key: "charter",
    title: "Charter of Port Varrow",
    entityType: "event",
    folder: "Lore/History",
    tags: ["history", "port-varrow"],
    fields: {
      when: "640 AR",
      where: "Port Varrow",
      participants: "Seven merchant houses",
      outcome: "The Varrow Harbor Guild chartered; the city founded."
    },
    playerBody:
      "Seven merchant houses bought the mud of the river mouth from the Ashdowns and founded the [[Varrow Harbor Guild]]. The city grew around the guild, not the other way round.",
    gmBody: "",
    revealed: true,
    inWorldDate: { year: 640, month: 3, day: 1 }
  },
  {
    key: "saltwar",
    title: "The Saltwar",
    entityType: "event",
    folder: "Lore/History",
    tags: ["history", "war"],
    fields: {
      when: "1019 to 1022 AR",
      where: "The Brackwater Fens",
      participants: "Port Varrow against the fen villages",
      outcome: "Treaty of Kettle Ford; the Peat Moot founded."
    },
    playerBody: `Three years of raids over the fen salt pans. It ended with the Treaty of [[Kettle Ford]], which gave the villages their salt and gave the guild the right to buy it first. [[The Peat Moot]] was founded to hold the guild to it. The [[Ruined Watchtower]] is one of the Saltwar's forts.`,
    gmBody: "",
    revealed: true,
    inWorldDate: { year: 1022, month: 4, day: 21 }
  },
  {
    key: "schism",
    title: "The Lamplighters' Schism",
    entityType: "event",
    folder: "Lore/History",
    tags: ["history", "wardens", "sooted"],
    fields: {
      when: "1180 AR",
      where: "Emberhold",
      participants: "The Ember Wardens",
      outcome: "The Sooted split from the order, then returned as its inquisitors."
    },
    playerBody:
      "A faction of Wardens argued that the shrines should be guarded by soldiers as well as fire. They walked out, came back twenty years later, and became [[The Sooted]].",
    gmBody: "",
    revealed: true,
    inWorldDate: { year: 1180, month: 8, day: 3 }
  },
  {
    key: "harbor-fire",
    title: "Harbor Fire of 1339",
    entityType: "event",
    folder: "Lore/History",
    tags: ["history", "port-varrow", "tragedy"],
    fields: {
      when: "Ashfall 14, 1339 AR",
      where: "Saltmarsh Docks, Port Varrow",
      participants: "The harbor district",
      outcome: "Three hundred drowned or burned. The docks rebuilt."
    },
    playerBody: `A fire on the Saltmarsh Docks that spread to the moored ships. Hundreds jumped into the harbor; most drowned. [[Captain Hessa Marrow]] lost her brother. [[Rook Ashgrave]] pulled eleven people out of the water. The guild blamed a dropped lamp.`,
    gmBody:
      "The guild set it to collect on overinsured warehouses and paid to keep the watch off the quay. [[Vessa the Pale]] lost her family that night. So did [[Nan Gull]].",
    revealed: true,
    inWorldDate: { year: 1339, month: 7, day: 14 }
  },
  {
    key: "burning",
    title: "The Burning of Hollowmere",
    entityType: "event",
    folder: "Lore/History",
    tags: ["history", "gloamshire"],
    fields: {
      when: "Highsun 9, 1342 AR",
      where: "Hollowmere",
      participants: "Raiders from the bogs",
      outcome: "Half the village burned; rebuilt in stone."
    },
    playerBody:
      "Raiders out of the fens burned half of [[Hollowmere]] in a dry summer. Lord Ashdown rebuilt it in stone and has reminded everyone of that since.",
    gmBody: "",
    revealed: true,
    inWorldDate: { year: 1342, month: 4, day: 9 }
  },
  {
    key: "drowning",
    title: "The Drowning at Tidewrack",
    entityType: "event",
    folder: "Lore/History",
    tags: ["history", "tidewrack"],
    fields: {
      when: "Seedfall 12, 1346 AR",
      where: "Tidewrack",
      participants: "The Saltblessing boats",
      outcome: "Two boats overturned; six drowned, including Elsbeth Vane."
    },
    playerBody:
      "A squall caught the Saltblessing boats over the drowned chapel at [[Tidewrack]]. Six people drowned, among them [[Elsbeth Vane]].",
    gmBody: "Vessa was in the crowd on the cliff that day. That is where she first spoke to Aldous.",
    revealed: true,
    inWorldDate: { year: 1346, month: 2, day: 12 }
  },
  {
    key: "cold",
    title: "The Night the Ash Went Cold",
    entityType: "event",
    folder: "Lore/History",
    tags: ["history", "campaign"],
    fields: {
      when: "Harvestide 1, 1347 AR",
      where: "Crypt of the Ashen Saint",
      participants: "Brother Aldous Vane",
      outcome: "The reliquary vanished; every shrine flame in Gloamshire went out."
    },
    playerBody:
      "The night the campaign began. At midnight every shrine flame in Gloamshire went out at once. In the morning the reliquary was gone from the crypt and so was [[Brother Aldous Vane]].",
    gmBody:
      "Aldous handed the urn to the Choir at the crypt door. The smugglers' cart took the crypt's grave goods down the road the same night.",
    revealed: true,
    inWorldDate: { year: 1347, month: 6, day: 1 }
  }
];

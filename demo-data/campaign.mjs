// The demo campaign's words: a small frontier setting, "The Ashen Reach", where a dead saint's ashes hold
// the restless dead in their graves and the ashes have started to go cold. Everything here is invented
// placeholder content for trying the app; seed.mjs turns it into records.

export const CALENDAR = {
  yearName: "AR",
  eras: [
    { name: "Age of Embers", startYear: -1200 },
    { name: "Ashen Reckoning", startYear: 1 }
  ],
  months: [
    { name: "Frostwane", days: 30 },
    { name: "Thawmoot", days: 30 },
    { name: "Seedfall", days: 30 },
    { name: "Greenrise", days: 31 },
    { name: "Highsun", days: 31 },
    { name: "Emberlight", days: 30 },
    { name: "Harvestide", days: 30 },
    { name: "Ashfall", days: 30 },
    { name: "Duskmarch", days: 29 },
    { name: "Longnight", days: 32 }
  ],
  weekdays: ["Ashday", "Brightday", "Coalday", "Duskday", "Emberday", "Forgeday", "Graveday"]
};

/** Harvestide is month index 6. */
export const date = (day, month = 6, year = 1347) => ({ year, month, day });

export const FOLDERS = [
  "People",
  "People/Port Varrow",
  "People/Gloamshire",
  "Places",
  "Places/Port Varrow",
  "Factions",
  "Lore",
  "Lore/Faiths",
  "Lore/History",
  "Items",
  "Bestiary",
  "GM Prep"
];

// `revealed` pages are visible to players; the GM half (gmBody, gmFields) never is.
export const PAGES = [
  // People
  {
    key: "hessa",
    title: "Captain Hessa Marrow",
    entityType: "character",
    folder: "People/Port Varrow",
    tags: ["npc", "ally", "port-varrow"],
    fields: {
      race: "Human",
      gender: "Woman",
      age: "44",
      role: "Captain of the Varrow Watch",
      status: "Alive",
      location: "Port Varrow"
    },
    gmFields: { goals: "Keep the harbor guild honest without starting a war with it. Secretly pays Mags for tips." },
    playerBody:
      "The captain of the [[Port Varrow]] watch. Weathered, blunt and fond of the party since they cleared the [[Port Varrow Warehouse]].\n\n## What the party knows\n- Lost her brother in the **Harbor Fire of 1339**.\n- Distrusts the [[Varrow Harbor Guild]], but needs their coin to pay her guards.\n- Owes the party a favor.",
    gmBody:
      "Hessa has been quietly buying information from [[Mags Thimble]] for two years. If the party exposes Mags, Hessa loses her best source and will ask them to keep it quiet.\n\n*Voice:* clipped sentences, never says please.",
    revealed: true
  },
  {
    key: "aldous",
    title: "Brother Aldous Vane",
    entityType: "character",
    folder: "People/Gloamshire",
    tags: ["npc", "villain", "pale-choir"],
    fields: {
      race: "Human",
      gender: "Man",
      age: "61",
      role: "Keeper of the Ashen Saint's crypt",
      status: "Missing",
      location: "Crypt of the Ashen Saint"
    },
    gmFields: { goals: "Trade the Saint's ashes to the Pale Choir in exchange for his dead daughter's return." },
    playerBody:
      "The elderly keeper of the [[Crypt of the Ashen Saint]]. Kind, forgetful, always smells of candle smoke. He vanished the night the ashes went cold.",
    gmBody:
      "Aldous stole the [[The Saint's Reliquary]] himself and handed it to [[Vessa the Pale]]. He is being held (willingly) at the [[Ruined Watchtower]]. He can be talked down with DC 15 Persuasion if the party brings his daughter's locket from the crypt.",
    revealed: true
  },
  {
    key: "mags",
    title: "Mags Thimble",
    entityType: "character",
    folder: "People/Port Varrow",
    tags: ["npc", "neutral", "port-varrow"],
    fields: {
      race: "Halfling",
      gender: "Woman",
      age: "38",
      role: "Fence and information broker",
      status: "Alive",
      location: "The Brine and Barrel"
    },
    gmFields: { goals: "Stay useful to everyone and loyal to no one." },
    playerBody:
      "Runs a stall of 'salvage' behind [[The Brine and Barrel]]. Buys anything, sells everything, remembers every face.",
    gmBody:
      "Mags sold the smugglers the warehouse key. She will sell the party the location of the [[Ruined Watchtower]] for 50 gp, or for the smugglers' ledger.",
    revealed: true
  },
  {
    key: "corvin",
    title: "Lord Corvin Ashdown",
    entityType: "character",
    folder: "People/Gloamshire",
    tags: ["npc", "patron", "noble"],
    fields: {
      race: "Human",
      gender: "Man",
      age: "52",
      role: "Lord of Gloamshire Vale",
      status: "Alive",
      location: "Hollowmere"
    },
    gmFields: { goals: "Recover the reliquary before the Ember Wardens learn how badly he guarded it." },
    playerBody:
      "The lord who hired the party to find out why the [[Ashen Saint]]'s ashes went cold. Generous, proud, and nervous.",
    gmBody:
      "Corvin moved the reliquary's guard to his own manor last spring to save money. He will pay double to keep that from the [[The Ember Wardens]].",
    revealed: true
  },
  {
    key: "wren",
    title: "Old Wren",
    entityType: "character",
    folder: "People/Gloamshire",
    tags: ["npc", "ally", "hedge-witch"],
    fields: {
      race: "Half-elf",
      gender: "Woman",
      age: "Unknown",
      role: "Hedge witch of the Gloomwood",
      status: "Alive",
      location: "Gloomwood"
    },
    gmFields: { goals: "Find a new keeper for the Gloomwood before she dies." },
    playerBody:
      "A hedge witch who lives among the [[Gloam Moths]] in the [[Gloomwood]]. She trades remedies for stories.",
    gmBody:
      "Wren knows the old rite that can relight the ashes. She will only teach it to someone who agrees to keep the Gloomwood after her.",
    revealed: false
  },
  {
    key: "vessa",
    title: "Vessa the Pale",
    entityType: "character",
    folder: "People",
    tags: ["npc", "villain", "pale-choir"],
    fields: {
      race: "Human",
      gender: "Woman",
      role: "Choirmistress of the Pale Choir",
      status: "Alive",
      location: "Ruined Watchtower"
    },
    gmFields: { goals: "Use the Saint's ashes to raise the drowned dead of the Harbor Fire as an army." },
    playerBody: "A name whispered by the skeletons in the crypt. Nobody the party has met will say more.",
    gmBody:
      "Necromancer, CR 6 (use the **Mage** stat block with Animate Dead). Leads the [[The Pale Choir]] from the [[Ruined Watchtower]]. Her rite completes on Harvestide 20 unless the party stops it.",
    revealed: true
  },
  {
    key: "grub",
    title: "Grub",
    entityType: "character",
    folder: "People/Gloamshire",
    tags: ["npc", "goblin", "neutral"],
    fields: {
      race: "Bog goblin",
      gender: "Unknown",
      role: "Chief of the Mudfoot tribe",
      status: "Alive",
      location: "Gloomwood"
    },
    gmFields: { goals: "Get the tribe away from the crypt before the dead wake for good." },
    playerBody:
      "The goblin boss who ambushed the party on the forest road, then surrendered and begged for help against 'the walking bones'.",
    gmBody: "Grub will guide the party through the Gloomwood if they gave him back his drum.",
    revealed: true
  },
  // Places
  {
    key: "reach",
    title: "The Ashen Reach",
    entityType: "location",
    folder: "Places",
    tags: ["region"],
    fields: {
      kind: "Frontier region",
      region: "The Ashen Reach",
      population: "About 40,000",
      ruler: "Several lords; none in charge",
      climate: "Cool, wet, foggy"
    },
    playerBody:
      "A frontier of fog, peat bogs and old graves on the edge of the known world. The ashes of the [[Ashen Saint]] have kept its dead quiet for 1,300 years.\n\nNotable places: [[Gloamshire Vale]], [[Port Varrow]], the [[Gloomwood]].",
    gmBody: "Every graveyard in the Reach goes restless within a month if the ashes are not relit.",
    revealed: true
  },
  {
    key: "vale",
    title: "Gloamshire Vale",
    entityType: "location",
    folder: "Places",
    tags: ["region", "gloamshire"],
    fields: {
      kind: "Farming vale",
      region: "The Ashen Reach",
      population: "About 3,000",
      ruler: "Lord Corvin Ashdown",
      climate: "Mild, misty"
    },
    playerBody:
      "A quiet vale of barley farms and peat cutters. Its villages are [[Hollowmere]] and a dozen hamlets. The [[Crypt of the Ashen Saint]] sits on its northern ridge.",
    gmBody: "",
    revealed: true
  },
  {
    key: "hollowmere",
    title: "Hollowmere",
    entityType: "location",
    folder: "Places",
    tags: ["village", "gloamshire"],
    fields: {
      kind: "Village",
      region: "Gloamshire Vale",
      population: "600",
      ruler: "Lord Corvin Ashdown",
      climate: "Misty"
    },
    playerBody:
      "A lakeside village, rebuilt after **the Burning of Hollowmere** in 1342. Home of Lord Ashdown's manor.",
    gmBody: "Two villagers are Pale Choir sympathizers. They report the party's movements to the watchtower by raven.",
    revealed: true
  },
  {
    key: "crypt",
    title: "Crypt of the Ashen Saint",
    entityType: "location",
    folder: "Places",
    tags: ["dungeon", "gloamshire"],
    fields: {
      kind: "Crypt",
      region: "Gloamshire Vale",
      population: "The dead",
      ruler: "Brother Aldous Vane (missing)",
      climate: "Cold, dry"
    },
    playerBody:
      "The resting place of the [[Ashen Saint]]. The party fought their way through its risen guardians in session 2.",
    gmBody: "Aldous's daughter's locket is in the third ossuary niche. It matters for talking him down later.",
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
      region: "The Ashen Reach",
      population: "12,000",
      ruler: "Varrow Harbor Guild council",
      climate: "Salt fog"
    },
    playerBody:
      "The Reach's only real city: fish, salt, smuggling and the [[Varrow Harbor Guild]]. Watched over, barely, by [[Captain Hessa Marrow]].",
    gmBody: "",
    revealed: true
  },
  {
    key: "brine",
    title: "The Brine and Barrel",
    entityType: "location",
    folder: "Places/Port Varrow",
    tags: ["tavern", "port-varrow"],
    fields: {
      kind: "Tavern",
      region: "Port Varrow",
      population: "Busy after dark",
      ruler: "Old Tobin",
      climate: "Smoky"
    },
    playerBody:
      "Dockside tavern and the party's base in Port Varrow. The fish stew is better than it smells. [[Mags Thimble]] works out of the back room.",
    gmBody: "",
    revealed: true
  },
  {
    key: "warehouse",
    title: "Port Varrow Warehouse",
    entityType: "location",
    folder: "Places/Port Varrow",
    tags: ["warehouse", "port-varrow"],
    fields: {
      kind: "Warehouse",
      region: "Port Varrow",
      population: "Smugglers (cleared)",
      ruler: "Varrow Harbor Guild",
      climate: "Damp"
    },
    playerBody: "A guild warehouse used by smugglers to move stolen grave goods. Cleared by the party in session 3.",
    gmBody: "The guild's harbormaster knew about the smugglers and took a cut.",
    revealed: true
  },
  {
    key: "tower",
    title: "Ruined Watchtower",
    entityType: "location",
    folder: "Places",
    tags: ["ruin", "pale-choir"],
    fields: {
      kind: "Ruin",
      region: "Gloamshire Vale",
      population: "Pale Choir cultists",
      ruler: "Vessa the Pale",
      climate: "Windswept"
    },
    playerBody: "A broken watchtower on the cliffs above the bogs. Lights have been seen there at night.",
    gmBody: "The Pale Choir's base. Vessa, Aldous, 6 cultists and 2 Cinder Hounds. The reliquary is on the top floor.",
    revealed: false
  },
  {
    key: "gloomwood",
    title: "Gloomwood",
    entityType: "location",
    folder: "Places",
    tags: ["forest", "gloamshire"],
    fields: {
      kind: "Forest",
      region: "Gloamshire Vale",
      population: "Goblins, moths, one witch",
      ruler: "Nobody",
      climate: "Dark and damp"
    },
    playerBody:
      "An old forest of black pines where [[Gloam Moths]] glow at dusk. The Mudfoot goblins live at its edge.",
    gmBody: "",
    revealed: true
  },
  // Factions
  {
    key: "wardens",
    title: "The Ember Wardens",
    entityType: "faction",
    folder: "Factions",
    tags: ["faction", "church"],
    fields: {
      kind: "Holy order",
      leader: "Warden-Abbess Corra Lind",
      headquarters: "Emberhold Abbey",
      size: "About 200 knights and priests"
    },
    gmFields: { goals: "Take the reliquary into their own keeping and away from the lords for good." },
    playerBody:
      "The holy order sworn to the [[Ashen Saint]]. They tend the ashes in every shrine of the Reach. Maelis trained with them.",
    gmBody: "The Wardens suspect Lord Ashdown of negligence and will strip him of the reliquary if they find out.",
    revealed: true
  },
  {
    key: "choir",
    title: "The Pale Choir",
    entityType: "faction",
    folder: "Factions",
    tags: ["faction", "villains", "pale-choir"],
    fields: {
      kind: "Necromantic cult",
      leader: "Vessa the Pale",
      headquarters: "Ruined Watchtower",
      size: "A few dozen"
    },
    gmFields: { goals: "Raise the drowned dead of the Harbor Fire and take Port Varrow." },
    playerBody: "A cult that sings to the dead. The skeletons in the crypt hummed their hymn as they fought.",
    gmBody: "Cells in Hollowmere and Port Varrow. They pay the smugglers to move grave goods.",
    revealed: true
  },
  {
    key: "guild",
    title: "Varrow Harbor Guild",
    entityType: "faction",
    folder: "Factions",
    tags: ["faction", "port-varrow", "merchants"],
    fields: {
      kind: "Merchant guild",
      leader: "Harbormaster Sile Dunmore",
      headquarters: "Guild Hall, Port Varrow",
      size: "Most of the harbor"
    },
    gmFields: { goals: "Profit. Keep the watch underfunded." },
    playerBody: "The merchants who run [[Port Varrow]] in all but name.",
    gmBody: "Dunmore took a cut from the smugglers. He will try to buy the party's silence.",
    revealed: true
  },
  {
    key: "mudfoot",
    title: "Mudfoot Tribe",
    entityType: "faction",
    folder: "Factions",
    tags: ["faction", "goblins"],
    fields: { kind: "Goblin tribe", leader: "Grub", headquarters: "Gloomwood edge", size: "About 40 goblins" },
    gmFields: { goals: "Survive the walking dead." },
    playerBody:
      "The bog goblins of the [[Gloomwood]]. Hostile at first; uneasy allies after the party spared [[Grub]].",
    gmBody: "",
    revealed: true
  },
  // Items
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
      properties: "Holds the ashes of the Ashen Saint. Undead within 1 mile cannot rise."
    },
    playerBody:
      "A silver urn the size of a lantern. Its ashes keep the dead of the Reach in their graves. It was stolen the night the ashes went cold.",
    gmBody:
      "Currently on the top floor of the [[Ruined Watchtower]]. If Vessa completes her rite, the urn cracks and the effect reverses.",
    revealed: true
  },
  {
    key: "blade",
    title: "Ember-Etched Blade",
    entityType: "item",
    folder: "Items",
    tags: ["magic-item", "loot"],
    fields: {
      kind: "Weapon (longsword)",
      rarity: "Uncommon",
      owner: "Rook Ashgrave",
      attunement: "Yes",
      properties: "+1d4 fire damage; sheds dim light."
    },
    playerBody:
      "Found in the crypt's guardian alcove. The runes along the fuller glow faintly orange. Now carried by Rook.",
    gmBody: "Also on the homebrew list as a full item.",
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
      properties: "Coded shipping records."
    },
    playerBody: "Taken from the warehouse. Half the entries are in a cipher Ivo is still working on.",
    gmBody: "Decoded, it names Harbormaster Dunmore and lists three shipments to 'the tower'.",
    revealed: true
  },
  // Species
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
      traits: "Hold breath for 15 minutes; mud camouflage."
    },
    playerBody:
      "Goblins adapted to the bogs of the Reach. Greenish-brown, web-toed and suspicious of anything that floats.",
    gmBody: "",
    revealed: true
  },
  {
    key: "moths",
    title: "Gloam Moths",
    entityType: "species",
    folder: "Bestiary",
    tags: ["beast", "bestiary"],
    fields: {
      category: "Beast",
      habitat: "Gloomwood",
      diet: "Grave moss",
      size: "Tiny",
      traits: "Glow when the dead are near."
    },
    playerBody: "Pale moths that glow at dusk. Locals say they glow brighter near the restless dead.",
    gmBody: "True. A swarm of them can be used as an undead detector.",
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
      traits: "Ember-grey skin; resistant to fire."
    },
    playerBody:
      "People born on the night of a shrine's relighting. Grey-skinned, warm to the touch. A playable homebrew species.",
    gmBody: "",
    revealed: true
  },
  // Faiths
  {
    key: "saint",
    title: "Ashen Saint",
    entityType: "religion",
    folder: "Lore/Faiths",
    tags: ["faith", "saint"],
    fields: {
      deity: "Saint Ilvara the Ashen",
      domains: "Life, Light",
      alignment: "Lawful good",
      followers: "Most of the Reach"
    },
    playerBody:
      "Saint Ilvara burned herself on the pyre that ended the Age of Embers. Her ashes have held the dead in their graves ever since. Tended by [[The Ember Wardens]].",
    gmBody: "",
    revealed: true
  },
  {
    key: "mother",
    title: "The Drowned Mother",
    entityType: "religion",
    folder: "Lore/Faiths",
    tags: ["faith", "sea"],
    fields: {
      deity: "The Drowned Mother",
      domains: "Tempest, Death",
      alignment: "Neutral",
      followers: "Fishers and sailors of Port Varrow"
    },
    playerBody: "Sailors leave salt and a coin at her shrine before every voyage. Those she keeps, she keeps.",
    gmBody: "The Pale Choir twists her hymns for their rites.",
    revealed: true
  },
  {
    key: "hollow",
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
    gmBody: "The Pale Choir's creed: the dead are owed a second life, and the living owe them service.",
    revealed: false
  },
  // History
  {
    key: "reckoning",
    title: "The Reckoning",
    entityType: "event",
    folder: "Lore/History",
    tags: ["history"],
    fields: {
      when: "Year 1",
      where: "Emberhold",
      participants: "Saint Ilvara, the Ember Host",
      outcome: "The dead were laid to rest; the calendar restarted."
    },
    playerBody: "The night the Ashen Saint burned. The calendar of the Reach counts from it.",
    gmBody: "",
    revealed: true,
    inWorldDate: { year: 1, month: 9, day: 32 }
  },
  {
    key: "harbor-fire",
    title: "Harbor Fire of 1339",
    entityType: "event",
    folder: "Lore/History",
    tags: ["history", "port-varrow"],
    fields: {
      when: "Ashfall 1339",
      where: "Port Varrow",
      participants: "The harbor district",
      outcome: "Three hundred drowned or burned."
    },
    playerBody:
      "A fire on the docks that spread to the ships. Hundreds died in the water. Captain Marrow lost her brother.",
    gmBody: "Started by the guild to collect insurance. The drowned are the army Vessa wants.",
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
      when: "Highsun 1342",
      where: "Hollowmere",
      participants: "Raiders from the bogs",
      outcome: "The village was rebuilt."
    },
    playerBody: "Raiders burned half of Hollowmere. Lord Ashdown rebuilt it with stone.",
    gmBody: "",
    revealed: true,
    inWorldDate: { year: 1342, month: 4, day: 9 }
  },
  {
    key: "cold",
    title: "The Night the Ash Went Cold",
    entityType: "event",
    folder: "Lore/History",
    tags: ["history", "campaign"],
    fields: {
      when: "Harvestide 1, 1347",
      where: "Crypt of the Ashen Saint",
      participants: "Brother Aldous Vane",
      outcome: "The reliquary vanished; the dead began to stir."
    },
    playerBody: "The inciting event of the campaign. Every shrine flame in the Reach guttered at midnight.",
    gmBody: "Aldous handed the urn to the Choir at the crypt door.",
    revealed: true,
    inWorldDate: { year: 1347, month: 6, day: 1 }
  },
  // Notes
  {
    key: "pitch",
    title: "Campaign Pitch",
    entityType: "note",
    folder: "GM Prep",
    tags: ["gm", "planning"],
    playerBody: "",
    gmBody:
      "# The Ashen Reach\n\nLow-magic frontier horror. Levels 5 to 10.\n\n## Arc\n1. The ashes go cold (sessions 1-3)\n2. The Pale Choir's rite (sessions 4-6)\n3. The drowned army (sessions 7+)\n\n## Themes\n- Grief, and what people will trade to undo it\n- Duty to the dead",
    revealed: false
  },
  {
    key: "house-rules",
    title: "House Rules",
    entityType: "note",
    folder: "Lore",
    tags: ["rules"],
    playerBody:
      "## House rules\n- Milestone leveling.\n- Potions: drinking one is a bonus action; feeding one to someone else is an action.\n- Flanking does **not** give advantage.\n- Critical hits roll double dice (2024 rules).",
    gmBody: "",
    revealed: true
  },
  {
    key: "rumors",
    title: "Rumor Table",
    entityType: "note",
    folder: "GM Prep",
    tags: ["gm", "tables"],
    playerBody: "",
    gmBody:
      "| d6 | Rumor |\n|---|---|\n\n1. The guild burned the harbor on purpose. (true)\n2. Lord Ashdown sold the urn. (false)\n3. Lights in the old watchtower. (true)\n4. Old Wren can talk to moths. (half true)\n5. Goblins are eating the dead. (false)\n6. Brother Aldous was seen in Port Varrow. (true)",
    revealed: false
  }
];

export const CONNECTIONS = [
  ["aldous", "vessa", "serves", "gm"],
  ["aldous", "crypt", "keeper of", "player"],
  ["vessa", "choir", "leads", "player"],
  ["choir", "tower", "based at", "gm"],
  ["choir", "wardens", "enemy of", "player"],
  ["hessa", "port", "guards", "player"],
  ["hessa", "mags", "pays", "gm"],
  ["hessa", "guild", "rival of", "player"],
  ["mags", "brine", "works at", "player"],
  ["corvin", "vale", "rules", "player"],
  ["corvin", "wardens", "rival of", "gm"],
  ["wren", "gloomwood", "lives in", "player"],
  ["grub", "mudfoot", "leads", "player"],
  ["mudfoot", "gloomwood", "lives in", "player"],
  ["reliquary", "saint", "related to", "player"],
  ["wardens", "saint", "serves", "player"],
  ["guild", "harbor-fire", "caused", "gm"],
  ["harbor-fire", "hessa", "related to", "player"],
  ["cold", "aldous", "related to", "player"],
  ["cold", "reliquary", "related to", "player"],
  ["choir", "hollow", "worships", "gm"],
  ["mother", "port", "worshipped in", "player"],
  ["hollowmere", "vale", "located in", "player"],
  ["crypt", "vale", "located in", "player"],
  ["tower", "vale", "located in", "player"],
  ["brine", "port", "located in", "player"],
  ["warehouse", "port", "located in", "player"],
  ["moths", "gloomwood", "lives in", "player"],
  ["bog-goblins", "mudfoot", "related to", "player"]
];

// Pages that get a placeholder banner image.
export const BANNERS = ["reach", "port", "crypt", "choir", "reliquary"];

export const QUESTS = [
  {
    key: "cold-ash",
    title: "The Cold Ash",
    status: "active",
    playerBody: "Find out why the Ashen Saint's ashes went cold and bring back the stolen reliquary for Lord Ashdown.",
    gmBody: "Main arc. Resolves at the Ruined Watchtower.",
    objectives: [
      { text: "Investigate the Crypt of the Ashen Saint", done: true },
      { text: "Find out who took the reliquary", done: true },
      { text: "Locate the Pale Choir's hideout", done: false },
      { text: "Recover the Saint's Reliquary", done: false }
    ],
    pages: ["reliquary", "corvin", "crypt", "aldous"],
    tags: ["main"],
    revealed: true
  },
  {
    key: "drowned-road",
    title: "Goblins on the Drowned Road",
    status: "active",
    playerBody: "Bog goblins have been robbing carts on the forest road into Gloamshire.",
    gmBody: "Grub's tribe is fleeing the risen dead, not raiding for fun.",
    objectives: [
      { text: "Clear the ambush on the forest road", done: true },
      { text: "Deal with the goblin chief", done: true }
    ],
    pages: ["grub", "mudfoot"],
    tags: ["side"],
    revealed: true
  },
  {
    key: "shipment",
    title: "Mags's Missing Shipment",
    status: "active",
    playerBody: "Mags wants a crate back from the smugglers in the guild warehouse. No questions asked.",
    gmBody: "The crate holds the smugglers' ledger. Mags wants it to blackmail the harbormaster.",
    objectives: [
      { text: "Get into the warehouse", done: true },
      { text: "Recover Mags's crate", done: true },
      { text: "Decide whether to hand over the ledger", done: false }
    ],
    pages: ["mags", "warehouse", "ledger"],
    tags: ["side", "port-varrow"],
    revealed: true
  },
  {
    key: "lantern",
    title: "Old Wren's Moth Lantern",
    status: "not-started",
    playerBody: "",
    gmBody: "Wren asks the party to catch a queen gloam moth. Reward: the relighting rite.",
    objectives: [
      { text: "Find Old Wren in the Gloomwood", done: false },
      { text: "Catch a queen gloam moth", done: false }
    ],
    pages: ["wren", "moths"],
    tags: ["side", "gloamshire"],
    revealed: false
  },
  {
    key: "cart",
    title: "Escort the Miller's Cart",
    status: "failed",
    playerBody: "Get the miller's barley cart from the ford to Hollowmere before dark.",
    gmBody: "The goblins scattered the oxen during the ambush. The cart went into the river.",
    objectives: [{ text: "Bring the cart to Hollowmere", done: false }],
    pages: ["hollowmere"],
    tags: ["side", "gloamshire"],
    revealed: true
  },
  {
    key: "informant",
    title: "Captain Marrow's Informant",
    status: "active",
    playerBody: "Captain Marrow asked the party to find out who has been tipping off the smugglers.",
    gmBody: "It was the harbormaster. Becomes moot once the ledger is read.",
    objectives: [{ text: "Find the leak in the watch", done: false }],
    pages: ["hessa", "guild"],
    tags: ["side", "port-varrow"],
    revealed: true
  }
];

export const PLAYERS = ["Alex", "Jordan", "Sam", "Riley", "Casey"];

export const SESSIONS = [
  {
    number: 1,
    realDate: "2026-09-12",
    status: "played",
    date: date(2),
    prepBody: "- Open on the forest road at dusk\n- Goblin ambush (4 warriors + Grub)\n- Grub surrenders at half HP",
    recapBody:
      "The party met on the road to Hollowmere, hired by **Lord Ashdown** to find out why the shrine flames went out. Bog goblins ambushed them at the ford. Rook held the line, and **Grub** surrendered when his warriors fell. He told them the dead are walking in the Gloomwood.",
    tags: ["arc-1"]
  },
  {
    number: 2,
    realDate: "2026-09-26",
    status: "played",
    date: date(6),
    prepBody: "- Crypt crawl\n- Skeleton guardians + Ash Wight\n- Clue: the Pale Choir's hymn",
    recapBody:
      "The party descended into the **Crypt of the Ashen Saint**. The reliquary was gone and the guardians had risen. Tamsin went down to the Ash Wight's claws and Maelis pulled her back. Rook found the *Ember-Etched Blade*. The skeletons hummed a hymn as they died.",
    tags: ["arc-1", "dungeon"]
  },
  {
    number: 3,
    realDate: "2026-10-10",
    status: "played",
    date: date(11),
    prepBody: "- Port Varrow intro\n- Mags's job\n- Warehouse fight\n- Ledger clue",
    recapBody:
      "In **Port Varrow** the party took a job from Mags Thimble and raided a guild warehouse full of smugglers. They found grave goods from the crypt and a coded ledger. Captain Marrow arrived after the fight and let them keep the ledger, for now.",
    tags: ["arc-1", "port-varrow"]
  },
  {
    number: 4,
    realDate: "2026-10-24",
    status: "planned",
    date: null,
    prepBody:
      "## Plan\n- Mags sells the tower's location (or the party decodes the ledger)\n- Travel through the Gloomwood: Old Wren encounter\n- Assault on the Ruined Watchtower\n\n## Encounter\nCultists x4, Cinder Hounds x2 on the tower floor. Vessa watches from the stairs and flees at half HP.",
    recapBody: "",
    tags: ["arc-2"]
  }
];

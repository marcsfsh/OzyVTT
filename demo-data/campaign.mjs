// The demo campaign's structure: a small frontier setting, "The Ashen Reach", where a dead saint's ashes hold
// the restless dead in their graves and the ashes have started to go cold. The words live in lore-*.mjs,
// notes.mjs and chronicle.mjs; this file holds the calendar, folders, links, quests and atlas pins.
import { FACTIONS, PARTY, PEOPLE } from "./lore-people.mjs";
import { CREATURES, EVENTS, FAITHS, ITEMS, PLACES } from "./lore-world.mjs";
import { NOTES } from "./notes.mjs";

export { PARTY };

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
  "Party",
  "People",
  "People/Gloamshire",
  "People/Port Varrow",
  "People/Emberhold",
  "Places",
  "Places/Gloamshire Vale",
  "Places/Port Varrow",
  "Places/The Wider Reach",
  "Factions",
  "Items",
  "Bestiary",
  "Lore",
  "Lore/Faiths",
  "Lore/History",
  "Player Guide",
  "GM Prep"
];

export const PAGES = [...PEOPLE, ...FACTIONS, ...PLACES, ...ITEMS, ...CREATURES, ...FAITHS, ...EVENTS, ...NOTES];

// [from, to, label, layer]. Party pages ("rook", "maelis", ...) exist by the time these are made.
export const CONNECTIONS = [
  // The party
  ["rook", "hessa", "served under", "player"],
  ["rook", "harbor-fire", "survived", "player"],
  ["rook", "blade", "carries", "player"],
  ["maelis", "corra", "student of", "player"],
  ["maelis", "wardens", "member of", "player"],
  ["maelis", "lantern", "carries", "player"],
  ["maelis", "grieve", "watched by", "gm"],
  ["ivo", "emberhold", "dismissed from", "player"],
  ["ivo", "hymnal", "read from", "gm"],
  ["ivo", "maelis", "rival of", "player"],
  ["tamsin", "nan", "owes", "player"],
  ["tamsin", "gulls", "member of", "player"],
  ["tamsin", "docks", "grew up in", "player"],
  ["corwin", "brannoc", "nephew of", "player"],
  ["corwin", "wren", "chosen by", "gm"],
  ["corwin", "drum", "carries", "player"],
  ["osric", "emberhold", "lives in", "player"],
  // Gloamshire
  ["corvin", "vale", "rules", "player"],
  ["corvin", "manor", "lives in", "player"],
  ["corvin", "wardens", "rival of", "gm"],
  ["aldous", "crypt", "keeper of", "player"],
  ["aldous", "elsbeth", "father of", "player"],
  ["aldous", "vessa", "serves", "gm"],
  ["elsbeth", "drowning", "related to", "player"],
  ["locket", "elsbeth", "belonged to", "gm"],
  ["hobb", "hollowmere", "lives in", "player"],
  ["wat", "hollowmere", "lives in", "player"],
  ["brannoc", "moot", "leads", "player"],
  ["brannoc", "mossend", "lives in", "player"],
  ["wren", "gloomwood", "lives in", "player"],
  ["wren", "peat-mothers", "keeper of", "gm"],
  ["grub", "mudfoot", "leads", "player"],
  ["drum", "mudfoot", "belongs to", "player"],
  ["mudfoot", "gloomwood", "lives in", "player"],
  ["bog-goblins", "mudfoot", "related to", "player"],
  ["moths", "gloomwood", "lives in", "player"],
  ["hollowmere", "vale", "located in", "player"],
  ["manor", "vale", "located in", "player"],
  ["lamb", "hollowmere", "located in", "player"],
  ["crypt", "vale", "located in", "player"],
  ["ford", "vale", "located in", "player"],
  ["mossend", "fens", "located in", "player"],
  ["tower", "vale", "located in", "player"],
  ["gloomwood", "vale", "located in", "player"],
  // Emberhold and the faith
  ["corra", "wardens", "leads", "player"],
  ["grieve", "sooted", "leads", "player"],
  ["sooted", "wardens", "member of", "player"],
  ["sooted", "schism", "related to", "player"],
  ["wardens", "saint", "serves", "player"],
  ["wardens", "emberhold", "based at", "player"],
  ["emberhold", "greyspire", "located in", "player"],
  ["ilvara", "saint", "related to", "player"],
  ["ilvara", "reckoning", "related to", "player"],
  ["reliquary", "ilvara", "related to", "player"],
  ["reliquary", "tower", "located in", "gm"],
  ["guttering", "mossend", "related to", "player"],
  ["emberhold-founding", "wardens", "related to", "player"],
  // Port Varrow
  ["hessa", "watchhouse", "commands", "player"],
  ["pell", "hessa", "serves", "player"],
  ["hessa", "mags", "pays", "gm"],
  ["hessa", "guild", "rival of", "player"],
  ["harbor-fire", "hessa", "related to", "player"],
  ["mags", "brine", "works at", "player"],
  ["tobin", "brine", "owns", "player"],
  ["nan", "gulls", "leads", "player"],
  ["gulls", "guild", "enemy of", "gm"],
  ["dunmore", "guild", "leads", "player"],
  ["dunmore", "guildhall", "works at", "player"],
  ["guild", "harbor-fire", "caused", "gm"],
  ["guild", "charter", "related to", "player"],
  ["ledger", "dunmore", "related to", "gm"],
  ["ledger", "warehouse", "found in", "player"],
  ["saltwhistle", "mothershrine", "keeper of", "player"],
  ["saltwhistle", "mother", "serves", "player"],
  ["mother", "tidewrack", "worshipped in", "player"],
  ["port", "docks", "related to", "player"],
  ["brine", "docks", "located in", "player"],
  ["warehouse", "docks", "located in", "player"],
  ["guildhall", "port", "located in", "player"],
  ["mothershrine", "port", "located in", "player"],
  ["watchhouse", "port", "located in", "player"],
  // The Choir
  ["vessa", "choir", "leads", "player"],
  ["vessa", "harbor-fire", "survived", "gm"],
  ["choir", "tower", "based at", "gm"],
  ["choir", "wardens", "enemy of", "player"],
  ["choir", "hymn", "worships", "gm"],
  ["choir", "hymnal", "owns", "gm"],
  ["hounds", "choir", "related to", "gm"],
  ["bell", "tidewrack", "located in", "player"],
  ["brinewights", "tidewrack", "related to", "gm"],
  ["ashwalkers", "crypt", "related to", "player"],
  ["cold", "aldous", "related to", "player"],
  ["cold", "reliquary", "related to", "player"],
  ["road", "fens", "located in", "player"],
  ["saltwar", "ford", "related to", "player"],
  ["saltwar", "moot", "related to", "player"],
  ["burning", "hollowmere", "related to", "player"]
];

// Pages that get a placeholder banner image.
export const BANNERS = [
  "reach",
  "port",
  "crypt",
  "choir",
  "reliquary",
  "emberhold",
  "tidewrack",
  "hollowmere",
  "primer"
];

/** Every quest starts not-started; chronicle.mjs moves them along session by session. */
export const QUESTS = [
  {
    key: "cold-ash",
    title: "The Cold Ash",
    playerBody: "Find out why the shrine flames went out and bring the stolen reliquary back to Lord Ashdown.",
    gmBody: "Main arc. Resolves at the Ruined Watchtower, one way or another.",
    objectives: [
      "Learn why the shrine flames went out",
      "Search the Crypt of the Ashen Saint",
      "Find out who took the reliquary",
      "Follow the grave goods to their buyer",
      "Find the Pale Choir's hideout",
      "Recover the reliquary before it is too late"
    ],
    pages: ["reliquary", "corvin", "crypt", "aldous", "choir"],
    tags: ["main"],
    revealed: true
  },
  {
    key: "drowned-road",
    title: "Goblins on the Drowned Road",
    playerBody: "Bog goblins have been robbing carts at Kettle Ford.",
    gmBody: "Grub's tribe is fleeing the risen dead, not raiding for fun.",
    objectives: ["Clear the ambush at the ford", "Deal with the goblin chief"],
    pages: ["grub", "mudfoot", "ford"],
    tags: ["side"],
    revealed: true
  },
  {
    key: "cart",
    title: "Escort the Miller's Cart",
    playerBody: "Get Wat Penhallow's barley cart from Kettle Ford to Hollowmere. 20 gp.",
    gmBody: "The goblins scattered the oxen during the ambush. The cart went into the river.",
    objectives: ["Bring the cart to Hollowmere"],
    pages: ["wat", "hollowmere"],
    tags: ["side", "gloamshire"],
    revealed: true
  },
  {
    key: "warden-report",
    title: "The Abbess's Letter",
    playerBody: "Warden-Abbess Corra Lind asked Maelis for an honest report on Lord Ashdown.",
    gmBody: "Completing it honestly earns the Wardens' trust and costs Ashdown his guardianship.",
    objectives: ["Send Corra Lind the truth about Lord Ashdown"],
    pages: ["corra", "maelis", "corvin"],
    tags: ["side", "wardens"],
    revealed: true
  },
  {
    key: "locket",
    title: "The Keeper's Locket",
    playerBody: "A silver locket engraved E.V. was hidden in the crypt's ossuary. Whose is it, and why hide it there?",
    gmBody: "Showing it to Aldous is the best way to talk him down at the tower.",
    objectives: ["Find out who E.V. was", "Return the locket to its family"],
    pages: ["locket", "aldous", "elsbeth"],
    tags: ["side", "personal"],
    revealed: true
  },
  {
    key: "shipment",
    title: "Mags's Missing Shipment",
    playerBody: "Mags Thimble wants a crate back from the smugglers in warehouse nine. No questions asked.",
    gmBody: "The crate holds the smugglers' ledger. Mags wants it to blackmail the harbormaster.",
    objectives: ["Get into warehouse nine", "Recover Mags's crate", "Decide whether to hand over the ledger"],
    pages: ["mags", "warehouse", "ledger"],
    tags: ["side", "port-varrow"],
    revealed: true
  },
  {
    key: "informant",
    title: "Captain Marrow's Informant",
    playerBody: "Captain Marrow asked the party to find out who in the watch is tipping off the smugglers.",
    gmBody: "It was the harbormaster's man in the watch office. Moot once the ledger is read.",
    objectives: ["Find the leak in the watch"],
    pages: ["hessa", "pell", "guild"],
    tags: ["side", "port-varrow"],
    revealed: true
  },
  {
    key: "gulls-due",
    title: "The Gull Court's Due",
    playerBody: "Tamsin owes Nan Gull 300 gp, due Harvestide 14.",
    gmBody: "Nan will take the 1339 insurance records from the Guild Hall instead of the money.",
    objectives: ["Pay Nan Gull, or", "Do Nan Gull's job"],
    pages: ["nan", "tamsin", "gulls"],
    tags: ["side", "personal", "port-varrow"],
    revealed: true
  },
  {
    key: "bells",
    title: "The Bells of Tidewrack",
    playerBody: "The drowned bells at Tidewrack ring at low tide. Mother Saltwhistle wants to know why.",
    gmBody: "The Choir is ringing them. It is practice for Ashfall 3.",
    objectives: ["Go to Tidewrack at low tide", "Find out who rings the bells"],
    pages: ["tidewrack", "bell", "saltwhistle"],
    tags: ["rumor", "tidewrack"],
    revealed: true
  },
  {
    key: "wren",
    title: "Old Wren's Summons",
    playerBody: "A moth brought Corwin a note: come to the wood before the lanterns float, and bring the grieving one.",
    gmBody: "The Peat Mothers' rite, and Wren's offer to make Corwin the next keeper.",
    objectives: ["Go to the Gloomwood before Harvestide 15", "Bring the grieving one"],
    pages: ["wren", "corwin", "peat-mothers"],
    tags: ["side", "gloomwood"],
    revealed: true
  },
  {
    key: "tidesman",
    title: "The Tidesman",
    playerBody: "",
    gmBody: "The thread the party hasn't pulled yet: decode the ledger's last page and prove who set the Harbor Fire.",
    objectives: ["Decode the ledger's last page", "Prove who set the Harbor Fire of 1339"],
    pages: ["ledger", "dunmore", "harbor-fire"],
    tags: ["gm", "arc-3"],
    revealed: false
  }
];

export const PLAYERS = ["Alex", "Jordan", "Sam", "Riley", "Casey"];

// Atlas pins. `map` is the atlas map, `sub` a map it opens, `scene` a battle fought there (linked after it
// happens), `actor` a roster name, `party` the one party pin.
export const PINS = [
  {
    key: "w-vale",
    map: "world",
    x: 620,
    y: 520,
    icon: "hills",
    color: "#57E39A",
    label: "Gloamshire Vale",
    pages: ["vale"],
    sub: "vale"
  },
  {
    key: "w-port",
    map: "world",
    x: 1380,
    y: 760,
    icon: "city",
    color: "#2DE2FF",
    label: "Port Varrow",
    pages: ["port"],
    sub: "port"
  },
  {
    key: "w-emberhold",
    map: "world",
    x: 900,
    y: 240,
    icon: "temple",
    color: "#FFB020",
    label: "Emberhold Abbey",
    pages: ["emberhold", "wardens"]
  },
  {
    key: "w-greyspire",
    map: "world",
    x: 1060,
    y: 110,
    icon: "mountain",
    color: "#94A3B8",
    label: "Greyspire Mountains",
    pages: ["greyspire", "ilvara"]
  },
  {
    key: "w-gloomwood",
    map: "world",
    x: 440,
    y: 420,
    icon: "forest",
    color: "#57E39A",
    label: "Gloomwood",
    pages: ["gloomwood", "moths"]
  },
  {
    key: "w-fens",
    map: "world",
    x: 960,
    y: 860,
    icon: "swamp",
    color: "#94A3B8",
    label: "Brackwater Fens",
    pages: ["fens", "moot"]
  },
  {
    key: "w-road",
    map: "world",
    x: 1100,
    y: 690,
    icon: "road",
    color: "#E8ECF4",
    label: "The Drowned Road",
    pages: ["road"]
  },
  {
    key: "w-tidewrack",
    map: "world",
    x: 1700,
    y: 1100,
    icon: "water",
    color: "#2DE2FF",
    label: "Tidewrack",
    pages: ["tidewrack", "bell", "drowning"]
  },
  {
    key: "hollowmere",
    map: "vale",
    x: 700,
    y: 560,
    icon: "village",
    color: "#E8ECF4",
    label: "Hollowmere",
    pages: ["hollowmere", "hobb", "lamb"]
  },
  {
    key: "manor",
    map: "vale",
    x: 800,
    y: 430,
    icon: "castle",
    color: "#FFB020",
    label: "Ashdown Manor",
    pages: ["manor", "corvin"]
  },
  {
    key: "crypt",
    map: "vale",
    x: 820,
    y: 220,
    icon: "dungeon",
    color: "#FF2D5E",
    label: "Crypt of the Ashen Saint",
    pages: ["crypt", "aldous"],
    sub: "crypt",
    scene: "crypt"
  },
  {
    key: "ford",
    map: "vale",
    x: 360,
    y: 760,
    icon: "battle",
    color: "#FF2E9A",
    label: "Kettle Ford",
    pages: ["ford", "wat"],
    sub: "road",
    scene: "road"
  },
  {
    key: "mossend",
    map: "vale",
    x: 1180,
    y: 860,
    icon: "village",
    color: "#E8ECF4",
    label: "Moss End",
    pages: ["mossend", "brannoc"]
  },
  {
    key: "mudfoot",
    map: "vale",
    x: 540,
    y: 300,
    icon: "camp",
    color: "#57E39A",
    label: "Mudfoot camp",
    pages: ["mudfoot", "grub"]
  },
  {
    key: "tower",
    map: "vale",
    x: 1260,
    y: 300,
    icon: "watchtower",
    color: "#A45CFF",
    label: "Ruined Watchtower",
    pages: ["tower", "vessa"],
    sub: "tower",
    scene: "tower",
    hidden: true
  },
  {
    key: "wren",
    map: "vale",
    x: 260,
    y: 380,
    icon: "forest",
    color: "#57E39A",
    label: "Old Wren's Hut",
    pages: ["wren"],
    actor: "Old Wren",
    hidden: true
  },
  {
    key: "brine",
    map: "port",
    x: 520,
    y: 640,
    icon: "flag",
    color: "#FFB020",
    label: "The Brine and Barrel",
    pages: ["brine", "tobin", "mags"],
    actor: "Mags Thimble",
    party: true
  },
  {
    key: "warehouse",
    map: "port",
    x: 860,
    y: 700,
    icon: "treasure",
    color: "#FF2D5E",
    label: "Warehouse nine",
    pages: ["warehouse", "ledger"],
    sub: "warehouse",
    scene: "warehouse"
  },
  {
    key: "watchhouse",
    map: "port",
    x: 700,
    y: 380,
    icon: "fort",
    color: "#2DE2FF",
    label: "Varrow Watch House",
    pages: ["watchhouse", "hessa", "pell"],
    actor: "Captain Hessa Marrow"
  },
  {
    key: "guildhall",
    map: "port",
    x: 980,
    y: 300,
    icon: "capital",
    color: "#94A3B8",
    label: "Guild Hall",
    pages: ["guildhall", "guild", "dunmore"]
  },
  {
    key: "mothershrine",
    map: "port",
    x: 300,
    y: 820,
    icon: "shrine",
    color: "#E8ECF4",
    label: "Shrine of the Drowned Mother",
    pages: ["mothershrine", "saltwhistle", "mother"]
  },
  {
    key: "market",
    map: "port",
    x: 420,
    y: 470,
    icon: "anchor",
    color: "#FFB020",
    label: "Fish market",
    pages: ["nan", "gulls"]
  },
  {
    key: "loft",
    map: "port",
    x: 960,
    y: 820,
    icon: "skull",
    color: "#A45CFF",
    label: "Net loft on Cobble Wharf",
    pages: ["choir"],
    hidden: true
  }
];

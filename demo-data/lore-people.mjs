// Codex pages for the people of the Ashen Reach and the factions they belong to. Invented placeholder
// content; `revealed` pages are visible to players, and gmBody / gmFields never are.

export const PEOPLE = [
  {
    key: "ilvara",
    title: "Saint Ilvara",
    entityType: "character",
    folder: "People",
    tags: ["saint", "history"],
    fields: {
      race: "Human",
      gender: "Woman",
      age: "Died aged 33",
      role: "The Ashen Saint",
      status: "Dead since the Reckoning",
      location: "Her ashes: The Saint's Reliquary"
    },
    gmFields: { goals: "None. Her ashes still hold a fragment of her will, which is why they can be relit." },
    playerBody: `A shepherd's daughter from the [[Greyspire Mountains]] who walked into the great pyre at [[Emberhold Abbey]] on the last night of the Age of Embers. Her ashes, gathered into [[The Saint's Reliquary]], laid every grave in the Reach to rest. The calendar counts from that night.

## What every child in the Reach knows
- She was not a priest, a noble or a warrior. She was the one who said yes.
- Her last words are carved over every shrine door: *Let the fire keep what the earth cannot.*
- Each shrine flame in the Reach burns a pinch of her ash. Put one out and the graves around it grow restless.

See [[The Reckoning]] and [[The Ashen Saint]].`,
    gmBody: `The faith teaches that Ilvara went willingly. A letter in the sealed archive at Emberhold says otherwise: she was chosen by lot, and her sister took her place in the lottery's record so that the story would read better. Only [[Ivo Quillfeather]] has seen that letter, and only part of it.

The relighting rite works because some of Ilvara's will remains in the ash. [[Vessa the Pale]]'s rite tries to turn that will around.`,
    revealed: true
  },
  {
    key: "corvin",
    title: "Lord Corvin Ashdown",
    entityType: "character",
    folder: "People/Gloamshire",
    tags: ["npc", "patron", "noble", "gloamshire"],
    fields: {
      race: "Human",
      gender: "Man",
      age: "52",
      role: "Lord of Gloamshire Vale",
      status: "Alive, anxious",
      location: "Ashdown Manor"
    },
    gmFields: {
      goals: "Recover the reliquary quietly, before the Ember Wardens learn he moved its guard to save money."
    },
    playerBody: `Lord of [[Gloamshire Vale]] and the man who hired the party. Silver-haired, beautifully dressed, and visibly short of sleep. His family has held the vale since 1301 and guarded the crypt road for most of that time.

## Dealings with the party
- Offered 200 gp to find out why the shrine flames went out, and 500 gp more for the return of [[The Saint's Reliquary]].
- Received the party at [[Ashdown Manor]] in session 2 and answered most questions. Not all.
- Insists the [[The Ember Wardens]] need not be troubled "until we know more".`,
    gmBody: `Last spring Corvin moved the crypt's two guards to his manor to cut costs. The night the ash went cold, nobody was watching the crypt road but [[Brother Aldous Vane]].

If the Wardens learn this, [[Warden-Abbess Corra Lind]] will strip House Ashdown of its guardianship and [[Inquisitor Halvard Grieve]] will use it as an excuse to occupy the vale. Corvin knows it and will pay, bargain or lie to prevent it.

*Voice:* warm, over-polite, apologizes before every evasion.`,
    revealed: true
  },
  {
    key: "aldous",
    title: "Brother Aldous Vane",
    entityType: "character",
    folder: "People/Gloamshire",
    tags: ["npc", "villain", "pale-choir", "gloamshire"],
    fields: {
      race: "Human",
      gender: "Man",
      age: "61",
      role: "Keeper of the Ashen Saint's crypt",
      status: "Missing",
      location: "Unknown"
    },
    gmFields: { goals: "Bring back his drowned daughter, Elsbeth, whatever the price." },
    playerBody: `The keeper of the [[Crypt of the Ashen Saint]] for thirty years. Kind, forgetful, smelling always of candle smoke and wet wool. He vanished the night the ash went cold.

## What people say
- [[Sexton Hobb]]: "Never missed a vigil. Not even the week his girl drowned."
- [[Lord Corvin Ashdown]]: "A gentle old man. Someone has taken him, mark my words."
- His cell in the crypt was neat, his bed made, and his travelling cloak gone.`,
    gmBody: `Aldous handed the reliquary to [[Vessa the Pale]] at the crypt door. She promised that the rite would bring [[Elsbeth Vane]] back from the sea. He is at the [[Ruined Watchtower]], willing, and ashamed.

He can be talked down (DC 15 Persuasion, advantage) if the party shows him [[Elsbeth's Locket]] and tells him what the drowned actually become: [[Brinewights]], not daughters.`,
    revealed: true
  },
  {
    key: "elsbeth",
    title: "Elsbeth Vane",
    entityType: "character",
    folder: "People/Gloamshire",
    tags: ["npc", "dead", "tidewrack"],
    fields: {
      race: "Human",
      gender: "Woman",
      age: "Died aged 19",
      role: "Daughter of Brother Aldous",
      status: "Drowned",
      location: "The sea off Tidewrack"
    },
    playerBody: `[[Brother Aldous Vane]]'s only child. She drowned off [[Tidewrack]] during the Saltblessing of 1346, when a squall overturned the blessing boats. Her body was never recovered.`,
    gmBody: `Elsbeth is one of the drowned the Pale Choir means to raise. What would come back is one of the [[Brinewights]], wearing her face. If the rite completes, she walks out of the surf at Tidewrack on Ashfall 3 and goes looking for her father.`,
    revealed: true
  },
  {
    key: "hobb",
    title: "Sexton Hobb",
    entityType: "character",
    folder: "People/Gloamshire",
    tags: ["npc", "ally", "hollowmere"],
    fields: {
      race: "Halfling",
      gender: "Man",
      age: "70",
      role: "Sexton and gravedigger of Hollowmere",
      status: "Alive",
      location: "Hollowmere"
    },
    playerBody: `Hollowmere's gravedigger and shrine-sweeper. He saw the shrine flame die at midnight on Harvestide 1 and has not slept properly since. He talks to the graves and swears some of them have started answering.

## Testimony (session 2)
- The flame "didn't gutter, it went *out*, like a hand closed over it".
- A cart went up the crypt road that night, after dark. He heard it; he didn't see it.
- Two fresh graves in the churchyard have sunk, as if something underneath had turned over.`,
    gmBody: "Hobb is reliable. The cart was the smugglers' cart that took the crypt's grave goods to Port Varrow.",
    revealed: true
  },
  {
    key: "wat",
    title: "Wat Penhallow",
    entityType: "character",
    folder: "People/Gloamshire",
    tags: ["npc", "hollowmere"],
    fields: {
      race: "Human",
      gender: "Man",
      age: "45",
      role: "Miller of Hollowmere",
      status: "Alive, out of pocket",
      location: "Hollowmere"
    },
    playerBody:
      "The miller who paid the party to escort his barley cart from [[Kettle Ford]] to [[Hollowmere]]. The goblins scattered his oxen and the cart went into the river. He has not forgiven anyone involved, including the river.",
    gmBody: "Wat will sell the party flour at double price for a month. After that he will admit they did their best.",
    revealed: true
  },
  {
    key: "brannoc",
    title: "Brannoc Hale",
    entityType: "character",
    folder: "People/Gloamshire",
    tags: ["npc", "peat-moot", "ally"],
    fields: {
      race: "Human",
      gender: "Man",
      age: "58",
      role: "Speaker of the Peat Moot",
      status: "Alive",
      location: "Moss End"
    },
    gmFields: { goals: "Keep the Wardens' soldiers out of the villages, and keep his nephew alive." },
    playerBody: `Speaker of [[The Peat Moot]] and [[Corwin Hale]]'s uncle. A peat-cutter with forearms like fence posts, a slow voice and a long memory for broken promises, mostly Port Varrow's.`,
    gmBody: `Brannoc knows the old folk rite of [[The Peat Mothers]] exists but not how it works. He will send the party to [[Old Wren]] if asked about relighting a shrine without the reliquary.`,
    revealed: true
  },
  {
    key: "wren",
    title: "Old Wren",
    entityType: "character",
    folder: "People/Gloamshire",
    tags: ["npc", "ally", "hedge-witch", "gloomwood"],
    fields: {
      race: "Half-elf",
      gender: "Woman",
      age: "Nobody knows",
      role: "Hedge witch of the Gloomwood",
      status: "Alive",
      location: "Gloomwood"
    },
    gmFields: { goals: "Find a new keeper for the Gloomwood before she dies." },
    playerBody: `A hedge witch who lives among the [[Gloam Moths]] in the [[Gloomwood]]. Villagers leave her bread and salt at the forest edge and pretend they don't. She trades remedies for stories, and she can tell when a story is true.`,
    gmBody: `Wren is the last keeper of the rite of [[The Peat Mothers]], which can relight a shrine flame from a living ember of grief rather than from the reliquary. She will teach it only to someone who swears to keep the Gloomwood after her. She has her eye on [[Corwin Hale]].

She sent a moth with a note to the party in Port Varrow (see the journal, Harvestide 12).`,
    revealed: true
  },
  {
    key: "grub",
    title: "Grub",
    entityType: "character",
    folder: "People/Gloamshire",
    tags: ["npc", "goblin", "mudfoot"],
    fields: {
      race: "Bog goblin",
      gender: "Unknown, and Grub thinks the question is rude",
      age: "About 30",
      role: "Chief of the Mudfoot Tribe",
      status: "Alive, humbled",
      location: "Gloomwood edge"
    },
    gmFields: { goals: "Get the tribe away from the crypt before the dead wake for good." },
    playerBody: `Chief of the [[Mudfoot Tribe]]. Led the ambush at [[Kettle Ford]], then threw down a cleaver and begged for help against "the walking bones". The party spared Grub and kept the tribe's war drum as surety.

Grub speaks Common badly and Goblin beautifully, and is convinced that [[Ivo Quillfeather]] is a sort of minor god.`,
    gmBody: `If the party returns [[Grub's War Drum]], Grub will guide them through the Gloomwood by the goblin paths, which halves the journey to the [[Ruined Watchtower]] and avoids the Choir's lookouts.`,
    revealed: true
  },
  {
    key: "corra",
    title: "Warden-Abbess Corra Lind",
    entityType: "character",
    folder: "People/Emberhold",
    tags: ["npc", "wardens", "emberhold"],
    fields: {
      race: "Dwarf",
      gender: "Woman",
      age: "140",
      role: "Warden-Abbess of the Ember Wardens",
      status: "Alive",
      location: "Emberhold Abbey"
    },
    gmFields: {
      goals: "Recover the reliquary without handing the Sooted the war they want."
    },
    playerBody: `Head of [[The Ember Wardens]] for forty years, and [[Maelis Thorn]]'s teacher. Small, iron-haired and impossible to hurry. She writes short letters and expects shorter answers.

Her letter to Maelis arrived in Hollowmere in session 2. See the journal.`,
    gmBody: `Corra suspects [[Lord Corvin Ashdown]] and wants Maelis's honest report on him. She also suspects her own inquisitor, [[Inquisitor Halvard Grieve]], is looking for an excuse to put the vale under martial law, and she is right.`,
    revealed: true
  },
  {
    key: "grieve",
    title: "Inquisitor Halvard Grieve",
    entityType: "character",
    folder: "People/Emberhold",
    tags: ["npc", "sooted", "antagonist"],
    fields: {
      race: "Human",
      gender: "Man",
      age: "47",
      role: "Inquisitor of the Sooted",
      status: "Alive",
      location: "On the road to Gloamshire"
    },
    gmFields: {
      goals: "Burn every grave in Gloamshire before it can rise, and bring the lords of the Reach to heel."
    },
    playerBody:
      "An inquisitor of [[The Sooted]], the Wardens' hard-line order. Nobody in the party has met him yet. People lower their voices when they say his name.",
    gmBody: `Grieve arrives in Hollowmere on Harvestide 16 with twenty soldiers if the reliquary has not been recovered. He will start digging up the churchyard to burn the dead "before they walk", which turns the village against the Wardens and plays straight into the Choir's hands.

*Voice:* quiet, reasonable, never raises it. Quotes Ilvara constantly and selectively.`,
    revealed: true
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
      age: "About 40",
      role: "Choirmistress of the Pale Choir",
      status: "Alive",
      location: "Unknown"
    },
    gmFields: {
      goals: "Use the Saint's ashes to raise the drowned of the Harbor Fire as an army and take Port Varrow."
    },
    playerBody:
      "A name the skeletons in the crypt hummed as they fought. A name in the smugglers' ledger beside three shipments marked *to the tower*. Nobody the party has met will say more.",
    gmBody: `Necromancer, CR 6 (Mage stat block, swap in Animate Dead and Vampiric Touch). Leads [[The Pale Choir]] from the [[Ruined Watchtower]].

She lost her husband and two sons in the [[Harbor Fire of 1339]], which the [[Varrow Harbor Guild]] set for the insurance money. She wants the drowned to take the harbor back from the men who burned it. Her rite completes on Harvestide 20. See [[Vessa's Clock]].

She is not cruel for its own sake, and she is honest with [[Brother Aldous Vane]] about everything except what Elsbeth will be.`,
    revealed: true
  },
  {
    key: "hessa",
    title: "Captain Hessa Marrow",
    entityType: "character",
    folder: "People/Port Varrow",
    tags: ["npc", "ally", "watch", "port-varrow"],
    fields: {
      race: "Human",
      gender: "Woman",
      age: "44",
      role: "Captain of the Varrow Watch",
      status: "Alive",
      location: "Varrow Watch House"
    },
    gmFields: {
      goals: "Keep the harbor guild honest without starting a war with it. Secretly pays Mags for tips."
    },
    playerBody: `Captain of the [[Port Varrow]] watch. Weathered, blunt and fond of the party since they cleared the [[Port Varrow Warehouse]]. She served alongside [[Rook Ashgrave]] years ago and still calls him "Corporal".

## What the party knows
- Lost her brother in the [[Harbor Fire of 1339]].
- Distrusts the [[Varrow Harbor Guild]] but needs their coin to pay her guards.
- Let the party keep the [[Smugglers' Ledger]] "for now".
- Owes the party a favor and says so out loud, which for Hessa is close to an embrace.`,
    gmBody: `Hessa has been buying information from [[Mags Thimble]] for two years. If the party exposes Mags, Hessa loses her best source and will ask them to keep it quiet.

She suspects the guild set the Harbor Fire but has never been able to prove it. The decoded ledger would be the first real evidence.

*Voice:* clipped sentences, never says please.`,
    revealed: true
  },
  {
    key: "pell",
    title: "Sergeant Pell Okafor",
    entityType: "character",
    folder: "People/Port Varrow",
    tags: ["npc", "watch", "port-varrow"],
    fields: {
      race: "Human",
      gender: "Man",
      age: "31",
      role: "Watch sergeant",
      status: "Alive",
      location: "Varrow Watch House"
    },
    playerBody:
      "[[Captain Hessa Marrow]]'s sergeant. Young, tired, scrupulously honest and terrible at cards. He arrived at the warehouse with the watch after the fight and wrote down everything, including Tamsin's complaint about the smell.",
    gmBody: "Pell is not the leak. He is the person most likely to be blamed for it.",
    revealed: true
  },
  {
    key: "mags",
    title: "Mags Thimble",
    entityType: "character",
    folder: "People/Port Varrow",
    tags: ["npc", "neutral", "fence", "port-varrow"],
    fields: {
      race: "Halfling",
      gender: "Woman",
      age: "38",
      role: "Fence and information broker",
      status: "Alive",
      location: "The Brine and Barrel"
    },
    gmFields: { goals: "Stay useful to everyone and loyal to no one." },
    playerBody: `Runs a stall of "salvage" behind [[The Brine and Barrel]]. Buys anything, sells everything, remembers every face. Hired the party to recover a crate from the [[Port Varrow Warehouse]] and paid in full, which surprised everyone.`,
    gmBody: `Mags sold the smugglers the warehouse key and then hired the party to rob them. She wants the [[Smugglers' Ledger]] to blackmail [[Harbormaster Sile Dunmore]].

She will sell the location of the [[Ruined Watchtower]] for 50 gp, or for the ledger.`,
    revealed: true
  },
  {
    key: "nan",
    title: "Nan Gull",
    entityType: "character",
    folder: "People/Port Varrow",
    tags: ["npc", "gull-court", "port-varrow"],
    fields: {
      race: "Human",
      gender: "Woman",
      age: "77",
      role: "Queen of the Gull Court",
      status: "Alive",
      location: "Varrow fish market"
    },
    gmFields: { goals: "Collect what she's owed. Keep the Choir off her docks." },
    playerBody: `A tiny old woman who sells smoked fish at the Varrow market and runs [[The Gull Court]] from a stool behind the counter. [[Tamsin Vey]] owes her 300 gp from a job that went wrong, and Nan has not forgotten.`,
    gmBody: `Nan will forgive the debt in exchange for one job: steal the guild's insurance records for 1339 from the [[Guild Hall]]. She has her own reasons to want the Harbor Fire proven.`,
    revealed: true
  },
  {
    key: "dunmore",
    title: "Harbormaster Sile Dunmore",
    entityType: "character",
    folder: "People/Port Varrow",
    tags: ["npc", "guild", "antagonist", "port-varrow"],
    fields: {
      race: "Human",
      gender: "Man",
      age: "56",
      role: "Harbormaster of the Varrow Harbor Guild",
      status: "Alive",
      location: "Guild Hall"
    },
    gmFields: { goals: "Bury 1339 forever. Keep taking his cut." },
    playerBody:
      'The harbormaster who runs the [[Varrow Harbor Guild]]. Charming, well fed and always on his way to somewhere more important. He sent a polite note to the party after the warehouse raid offering a reward for the ledger\'s "safe return".',
    gmBody: `Dunmore signed off on the [[Harbor Fire of 1339]] and has taken a cut from the smugglers for years. He knows the ledger names him. He will try money first, then lawyers, then knives.`,
    revealed: true
  },
  {
    key: "tobin",
    title: "Old Tobin",
    entityType: "character",
    folder: "People/Port Varrow",
    tags: ["npc", "tavern", "port-varrow"],
    fields: {
      race: "Dwarf",
      gender: "Man",
      age: "210",
      role: "Owner of the Brine and Barrel",
      status: "Alive",
      location: "The Brine and Barrel"
    },
    playerBody:
      'Owner of [[The Brine and Barrel]]. Claims to have served drinks to three kings, two saints and a sea serpent. Rents the party the rooms upstairs at a fair rate on the condition that nobody brings anything dead inside, "or anything that used to be".',
    gmBody:
      "Tobin remembers the Harbor Fire clearly and saw guild men on the quay before it started. He has never told anyone.",
    revealed: true
  },
  {
    key: "saltwhistle",
    title: "Mother Saltwhistle",
    entityType: "character",
    folder: "People/Port Varrow",
    tags: ["npc", "drowned-mother", "port-varrow"],
    fields: {
      race: "Human",
      gender: "Woman",
      age: "63",
      role: "Priestess of the Drowned Mother",
      status: "Alive",
      location: "Shrine of the Drowned Mother"
    },
    playerBody: `Priestess at the [[Shrine of the Drowned Mother]]. She keeps a list of every name the sea has taken in Port Varrow for forty years, and reads it aloud on Saltblessing. In session 4 she warned the party that the bells at [[Tidewrack]] have started ringing at low tide, "which bells under water should not do".`,
    gmBody: "Saltwhistle knows the Choir has been stealing her hymns. She does not yet know why.",
    revealed: true
  }
];

// Party pages are completed from the rolled characters: `{summary}` becomes the sheet's one-line summary at seed
// time, since species and subclass come out of the dice.
export const PARTY = [
  {
    key: "rook",
    title: "Rook Ashgrave",
    tags: ["pc", "party"],
    fields: { role: "Fighter, the party's front line", status: "Adventuring", location: "Port Varrow" },
    gmFields: { goals: "Find out who started the Harbor Fire, and forgive himself for the people he couldn't reach." },
    playerBody: `*{summary}*

Former corporal of the Varrow watch, later a caravan guard on [[The Drowned Road]]. He was on the quay the night of the [[Harbor Fire of 1339]] and pulled eleven people out of the water. He talks about the eleven, never about the rest.

## At the table
- Carries the [[Ember-Etched Blade]] from the crypt.
- Served under [[Captain Hessa Marrow]], who still calls him "Corporal".
- Training with the Wardens' sergeant in Port Varrow during downtime.`,
    gmBody:
      "Rook's old commander, now retired, was paid by the guild to keep the watch off the quay that night. Rook doesn't know. The decoded ledger names the commander in an entry from 1339."
  },
  {
    key: "maelis",
    title: "Maelis Thorn",
    tags: ["pc", "party", "wardens"],
    fields: { role: "Cleric of the Ashen Saint", status: "Adventuring", location: "Port Varrow" },
    gmFields: { goals: "Prove herself to Corra Lind. Keep the Sooted out of Hollowmere." },
    playerBody: `*{summary}*

A novice of [[The Ember Wardens]], trained at [[Emberhold Abbey]] under [[Warden-Abbess Corra Lind]]. She was on her way to tend the [[Hollowmere]] shrine when it went cold, and she has taken that personally.

## At the table
- Carries the [[Warden's Lantern]], with a borrowed ember from Emberhold inside.
- Pulled Tamsin back from death in the crypt (session 3).
- Writes reports to Corra Lind that are mostly true.`,
    gmBody:
      "[[Inquisitor Halvard Grieve]] has a file on Maelis. He considers her too soft and too close to the vale's lords. If she defies him openly he will try to have her recalled."
  },
  {
    key: "ivo",
    title: "Ivo Quillfeather",
    tags: ["pc", "party"],
    fields: { role: "Wizard and cipher-breaker", status: "Adventuring", location: "Port Varrow" },
    gmFields: { goals: "Read the rest of the sealed archive. Find out what the Hollow Hymn really does." },
    playerBody: `*{summary}*

Former apprentice archivist at [[Emberhold Abbey]], dismissed for reading what he shouldn't have in the sealed stacks. Talks fast, writes faster, and has opinions about everyone's handwriting.

## At the table
- Working on the cipher in the [[Smugglers' Ledger]].
- Recognized the hymn the crypt's dead were humming. Has not said where from.
- [[Grub]] believes Ivo is a minor god. Ivo has not corrected this.`,
    gmBody:
      "What Ivo read in the sealed stacks was a fragment of the [[Hymnal of Hollow Notes]] and part of a letter about [[Saint Ilvara]]'s selection by lot. The fragment is a piece of Vessa's rite. If Ivo sings it backwards it unmakes the rite, which he will work out only if he decodes the ledger's last page."
  },
  {
    key: "tamsin",
    title: "Tamsin Vey",
    tags: ["pc", "party", "gull-court"],
    fields: { role: "Rogue, locksmith and liar", status: "Adventuring, in debt", location: "Port Varrow" },
    gmFields: { goals: "Clear the debt to Nan Gull without anyone finding out what the job was." },
    playerBody: `*{summary}*

Grew up on the [[Saltmarsh Docks]] of Port Varrow and ran messages for [[The Gull Court]] before she could read. Left town three years ago after a job went wrong and came back owing [[Nan Gull]] 300 gp.

## At the table
- Went down to the Ash Wight in the crypt, and got back up.
- Owes the Gull Court 300 gp, due Harvestide 14.
- Can open the warehouse's lock in her sleep. Did, in fact, nearly fall asleep doing it.`,
    gmBody:
      "The job that went wrong three years ago was a burglary at the [[Guild Hall]]. Tamsin saw a ledger page about 1339 and didn't understand it. Nan Gull did."
  },
  {
    key: "corwin",
    title: "Corwin Hale",
    tags: ["pc", "party", "gloamshire"],
    fields: { role: "Ranger and guide", status: "Adventuring", location: "Port Varrow" },
    gmFields: { goals: "Keep his uncle's villages safe. Decide whether to answer Old Wren." },
    playerBody: `*{summary}*

A Gloamshire tracker who has hunted the [[Gloomwood]] since he was ten. Nephew of [[Brannoc Hale]], Speaker of the Peat Moot. Quiet, patient, and the only member of the party the goblins are afraid of.

## At the table
- Guided the party over [[The Drowned Road]] to Port Varrow.
- Knocked prone by the smugglers' captain and is still annoyed about it.
- Knows [[Old Wren]] by sight. She has never spoken to him, until now.`,
    gmBody:
      "[[Old Wren]] wants Corwin to be the next keeper of the Gloomwood. Saying yes would mean leaving the party eventually."
  },
  {
    key: "osric",
    title: "Osric Fenn",
    tags: ["pc", "retired"],
    fields: { role: "Bard (retired)", status: "Retired after session 0", location: "Emberhold" },
    playerBody: `*{summary}*

Played in session zero, then retired when his player moved away. In the fiction he went to [[Emberhold Abbey]] to write the ballad of the Night the Ash Went Cold. He has promised everyone a verse.`,
    gmBody: "Osric can return as an NPC with news from Emberhold, or as a replacement character if anyone needs one."
  }
];

export const FACTIONS = [
  {
    key: "wardens",
    title: "The Ember Wardens",
    entityType: "faction",
    folder: "Factions",
    tags: ["faction", "church", "emberhold"],
    fields: {
      kind: "Holy order",
      leader: "Warden-Abbess Corra Lind",
      headquarters: "Emberhold Abbey",
      size: "About 200 knights and priests, and every shrine-keeper in the Reach"
    },
    gmFields: { goals: "Take the reliquary into their own keeping and away from the lords for good." },
    playerBody: `The holy order sworn to [[Saint Ilvara]]. They tend the shrine flames in every village of the Reach, train the shrine-keepers, and guard the road to [[Emberhold Abbey]]. Founded in 3 AR by the Saint's disciple, Warden Aumry.

## How they work
- Each shrine flame burns a pinch of the Saint's ash. Wardens carry embers between shrines in brass lanterns.
- A shrine that goes cold is relit with an ember carried from the reliquary. Without the reliquary, there are no new embers.
- The order's hard-line inquisitors are [[The Sooted]].

[[Maelis Thorn]] trained with them.`,
    gmBody: `The order is split. Corra Lind wants to recover the reliquary quietly. Grieve wants a crusade. Whichever side the party helps will owe them.`,
    revealed: true
  },
  {
    key: "sooted",
    title: "The Sooted",
    entityType: "faction",
    folder: "Factions",
    tags: ["faction", "wardens", "inquisition"],
    fields: {
      kind: "Inquisitorial order within the Ember Wardens",
      leader: "Inquisitor Halvard Grieve",
      headquarters: "The Black Cloister, Emberhold",
      size: "About 40 inquisitors and their soldiers"
    },
    gmFields: { goals: "Martial law over every vale with a cold shrine." },
    playerBody:
      "The Wardens' inquisitors, named for the soot they rub on their faces at funerals. They split from the main order in the [[The Lamplighters' Schism]] of 1180 and came back on their own terms. They believe the dead must be guarded by steel as well as fire.",
    gmBody:
      "See [[Inquisitor Halvard Grieve]]. The Sooted arrive in Hollowmere on Harvestide 16 unless the reliquary is back.",
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
      headquarters: "Unknown",
      size: "A few dozen"
    },
    gmFields: { goals: "Raise the drowned of the Harbor Fire and take Port Varrow." },
    playerBody: `A cult that sings to the dead. The skeletons in the crypt hummed their hymn as they fought. Choir initiates wear grey, hum constantly, and do not seem to blink.`,
    gmBody: `Cells in [[Hollowmere]] (two sympathizers who report by raven) and [[Port Varrow]] (a dozen dockworkers who lost family in 1339). The Choir pays the smugglers to move grave goods, which it grinds into the ink for [[Hymnal of Hollow Notes]].

Headquarters: the [[Ruined Watchtower]].`,
    revealed: true
  },
  {
    key: "guild",
    title: "Varrow Harbor Guild",
    entityType: "faction",
    folder: "Factions",
    tags: ["faction", "merchants", "port-varrow"],
    fields: {
      kind: "Merchant guild",
      leader: "Harbormaster Sile Dunmore",
      headquarters: "Guild Hall, Port Varrow",
      size: "Most of the harbor"
    },
    gmFields: { goals: "Profit. Keep the watch underfunded. Keep 1339 buried." },
    playerBody: `The merchant houses that run [[Port Varrow]] in all but name, chartered in 640 AR. They own the docks, the salt pans and most of the council. Their colors are blue and silver; their motto is *The tide pays all debts*.`,
    gmBody:
      "The guild set the [[Harbor Fire of 1339]] to collect on overinsured warehouses. Three of the current council knew.",
    revealed: true
  },
  {
    key: "gulls",
    title: "The Gull Court",
    entityType: "faction",
    folder: "Factions",
    tags: ["faction", "thieves", "port-varrow"],
    fields: {
      kind: "Thieves' guild",
      leader: "Nan Gull",
      headquarters: "Varrow fish market",
      size: "About 60 thieves, runners and lookouts"
    },
    gmFields: { goals: "Prove the guild burned the harbor, and take the docks back." },
    playerBody: `Port Varrow's thieves, pickpockets and lookouts, ruled from a fish stall by [[Nan Gull]]. Gull Court children run messages across the city for a copper. Gull Court adults run everything else.

[[Tamsin Vey]] was one of those children.`,
    gmBody:
      "Nan lost her son in the Harbor Fire. Her grudge against the guild is older and deeper than anyone's but Vessa's.",
    revealed: true
  },
  {
    key: "mudfoot",
    title: "Mudfoot Tribe",
    entityType: "faction",
    folder: "Factions",
    tags: ["faction", "goblins", "gloomwood"],
    fields: {
      kind: "Goblin tribe",
      leader: "Grub",
      headquarters: "Gloomwood edge",
      size: "About 40 goblins"
    },
    gmFields: { goals: "Survive the walking dead." },
    playerBody: `The [[Bog Goblins]] of the [[Gloomwood]]. Hostile at first, uneasy allies after the party spared [[Grub]]. They raided the [[The Drowned Road]] because the dead had driven them out of their burrows near the crypt.`,
    gmBody: "",
    revealed: true
  },
  {
    key: "moot",
    title: "The Peat Moot",
    entityType: "faction",
    folder: "Factions",
    tags: ["faction", "villages", "gloamshire"],
    fields: {
      kind: "Council of villages",
      leader: "Brannoc Hale, Speaker",
      headquarters: "Moss End",
      size: "Twelve villages of the vale and the fens"
    },
    gmFields: { goals: "Keep both the Sooted and the guild out of the villages." },
    playerBody: `The council of the fen and vale villages, founded at the end of [[The Saltwar]] in 1022. It meets four times a year at [[Moss End]] and agrees on almost nothing, except that Port Varrow should keep its hands off their salt.`,
    gmBody: "",
    revealed: true
  }
];

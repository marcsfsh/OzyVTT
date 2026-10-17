# SRD 5.2.1 coverage (generated - do not edit by hand)

Regenerate with `npm run map`; a test (`apps/server/test/srd-coverage.test.ts`) fails when this is stale
or a condition, glossary entry or monster trait has no classification. Every SRD record is in one state:

- **Enforced:** the server applies it (rolls, damage, conditions, uses, Armor Class, the builder's picks).
- **Guided:** the app tracks it and walks the table through it (a spent slot, a counted use, a reminder, a
  rolled save); a person applies the rest.
- **Reference:** readable in the app where it's needed; there is nothing to apply.

Records are classified from the mechanics their content bundle carries, since the engine is data-driven,
with curated rows for what data can't say (`apps/server/src/srd-coverage-curated.ts`). Known gaps in
enforced records are GitHub issues.

## Summary

| Records | Enforced | Guided | Reference |
| --- | --- | --- | --- |
| Spells (339) | 126 | 204 | 9 |
| Monster actions (989) | 732 | 144 | 113 |
| Monster traits (106) | 0 | 0 | 106 |
| Barbarian features (23) | 16 | 1 | 6 |
| Bard features (16) | 11 | 0 | 5 |
| Cleric features (19) | 12 | 1 | 6 |
| Druid features (21) | 15 | 1 | 5 |
| Fighter features (21) | 13 | 2 | 6 |
| Monk features (30) | 17 | 1 | 12 |
| Paladin features (26) | 20 | 0 | 6 |
| Ranger features (22) | 13 | 2 | 7 |
| Rogue features (23) | 12 | 1 | 10 |
| Sorcerer features (18) | 12 | 3 | 3 |
| Warlock features (20) | 15 | 2 | 3 |
| Wizard features (15) | 7 | 2 | 6 |
| Species traits (77) | 64 | 1 | 12 |
| Backgrounds (4) | 4 | 0 | 0 |
| Feats (19) | 16 | 1 | 2 |
| Magic items (268) | 112 | 70 | 86 |
| Gear and tools (139) | 10 | 0 | 129 |
| Weapons (38) | 38 | 0 | 0 |
| Armor (13) | 13 | 0 | 0 |
| Conditions (15) | 0 | 0 | 15 |
| Rules glossary (155) | 0 | 0 | 155 |

## Spells

**Enforced (126):** Acid Arrow, Acid Splash, Animal Friendship, Arcane Sword, Bane, Banishment, Befuddlement, Black Tentacles, Blade Barrier, Bless, Blight, Blindness/Deafness, Burning Hands, Call Lightning, Chain Lightning, Charm Monster, Charm Person, Chill Touch, Chromatic Orb, Circle of Death, Cloudkill, Color Spray, Compulsion, Cone of Cold, Conjure Animals, Conjure Celestial, Conjure Elemental, Conjure Fey, Conjure Woodland Beings, Contact Other Plane, Contagion, Cure Wounds, Delayed Blast Fireball, Disintegrate, Dissonant Whispers, Divine Smite, Dominate Beast, Dominate Monster, Dominate Person, Dragon's Breath, Earthquake, Eldritch Blast, Ensnaring Strike, Entangle, Faerie Fire, Faithful Hound, Fear, Finger of Death, Fire Bolt, Fire Storm, Fireball, Flame Blade, Flame Strike, Flaming Sphere, Flesh to Stone, Freezing Sphere, Geas, Grease, Guiding Bolt, Harm, Haste, Heal, Healing Word, Heat Metal, Hellish Rebuke, Hex, Hideous Laughter, Hold Monster, Hold Person, Hunter's Mark, Hypnotic Pattern, Ice Knife, Ice Storm, Incendiary Cloud, Inflict Wounds, Insect Plague, Irresistible Dance, Lightning Bolt, Mage Armor, Magic Missile, Mass Cure Wounds, Mass Healing Word, Mass Suggestion, Meteor Swarm, Mind Spike, Modify Memory, Moonbeam, Phantasmal Killer, Poison Spray, Power Word Stun, Prayer of Healing, Prismatic Wall, Produce Flame, Ray of Frost, Ray of Sickness, Regenerate, Sacred Flame, Scorching Ray, Searing Smite, Shatter, Shield, Shield of Faith, Shining Smite, Shocking Grasp, Sleep, Sleet Storm, Sorcerous Burst, Spirit Guardians, Spiritual Weapon, Starry Wisp, Stinking Cloud, Storm of Vengeance, Suggestion, Sunbeam, Sunburst, Thunderwave, Tsunami, Vampiric Touch, Vicious Mockery, Vitriolic Sphere, Wall of Fire, Wall of Ice, Wall of Thorns, Web, Weird, Wind Wall

**Guided (204):** Aid, Alarm, Alter Self, Animal Messenger, Animal Shapes, Animate Dead, Animate Objects, Antilife Shell, Antimagic Field, Antipathy/Sympathy, Arcane Eye, Arcane Hand, Arcane Lock, Arcanist's Magic Aura, Astral Projection, Augury, Aura of Life, Awaken, Barkskin, Beacon of Hope, Bestow Curse, Blink, Blur, Calm Emotions, Clairvoyance, Clone, Command, Commune, Commune with Nature, Comprehend Languages, Confusion, Conjure Minor Elementals, Contingency, Continual Flame, Control Water, Control Weather, Counterspell, Create Food and Water, Create or Destroy Water, Create Undead, Creation, Dancing Lights, Darkness, Darkvision, Daylight, Death Ward, Demiplane, Detect Evil and Good, Detect Magic, Detect Poison and Disease, Detect Thoughts, Dimension Door, Disguise Self, Dispel Evil and Good, Dispel Magic, Divination, Divine Favor, Divine Word, Dream, Druidcraft, Elementalism, Enhance Ability, Enlarge/Reduce, Enthrall, Etherealness, Expeditious Retreat, Eyebite, Fabricate, False Life, Feather Fall, Find Familiar, Find Steed, Find the Path, Find Traps, Fire Shield, Floating Disk, Fly, Fog Cloud, Forbiddance, Forcecage, Foresight, Freedom of Movement, Gaseous Form, Gate, Gentle Repose, Giant Insect, Glibness, Globe of Invulnerability, Glyph of Warding, Goodberry, Greater Invisibility, Greater Restoration, Guardian of Faith, Guards and Wards, Guidance, Gust of Wind, Hallow, Hallucinatory Terrain, Heroes' Feast, Heroism, Holy Aura, Identify, Illusory Script, Imprisonment, Instant Summons, Invisibility, Jump, Knock, Legend Lore, Lesser Restoration, Levitate, Locate Animals or Plants, Locate Creature, Locate Object, Longstrider, Magic Circle, Magic Jar, Magic Mouth, Magic Weapon, Magnificent Mansion, Major Image, Mass Heal, Maze, Meld into Stone, Mind Blank, Minor Illusion, Mirage Arcane, Mirror Image, Mislead, Misty Step, Move Earth, Nondetection, Pass without Trace, Passwall, Phantasmal Force, Phantom Steed, Planar Ally, Planar Binding, Plane Shift, Plant Growth, Polymorph, Power Word Heal, Power Word Kill, Prismatic Spray, Private Sanctum, Programmed Illusion, Project Image, Protection from Energy, Protection from Evil and Good, Protection from Poison, Purify Food and Drink, Raise Dead, Ray of Enfeeblement, Reincarnate, Remove Curse, Resilient Sphere, Resistance, Resurrection, Reverse Gravity, Revivify, Rope Trick, Sanctuary, Scrying, Secret Chest, See Invisibility, Seeming, Sending, Sequester, Shapechange, Silence, Silent Image, Simulacrum, Slow, Speak with Animals, Speak with Dead, Speak with Plants, Spider Climb, Spike Growth, Stone Shape, Stoneskin, Summon Dragon, Symbol, Telekinesis, Telepathic Bond, Teleport, Teleportation Circle, Time Stop, Tiny Hut, Tongues, Transport via Plants, Tree Stride, True Polymorph, True Resurrection, True Seeing, Unseen Servant, Wall of Force, Wall of Stone, Warding Bond, Water Breathing, Water Walk, Wind Walk, Wish, Word of Recall, Zone of Truth

**Reference (9):** Light, Mage Hand, Mending, Message, Prestidigitation, Shillelagh, Spare the Dying, Thaumaturgy, True Strike

## Monster actions

**Enforced (732):** (listed by count only)

**Guided (144):** Aboleth: Lash, Aboleth: Psychic Drain, Adult Black Dragon: Frightful Presence, Adult Black Dragon: Pounce, Adult Blue Dragon: Cloaked Flight, Adult Blue Dragon: Sonic Boom, Adult Blue Dragon: Tail Swipe, Adult Brass Dragon: Blazing Light, Adult Brass Dragon: Pounce, Adult Bronze Dragon: Guiding Light, Adult Bronze Dragon: Pounce, Adult Copper Dragon: Mind Jolt, Adult Copper Dragon: Pounce, Adult Gold Dragon: Guiding Light, Adult Gold Dragon: Pounce, Adult Green Dragon: Mind Invasion, Adult Green Dragon: Pounce, Adult Red Dragon: Commanding Presence, Adult Red Dragon: Fiery Rays, Adult Red Dragon: Pounce, Adult Silver Dragon: Chill, Adult Silver Dragon: Pounce, Adult White Dragon: Frightful Presence, Adult White Dragon: Pounce, Ancient Black Dragon: Frightful Presence, Ancient Black Dragon: Pounce, Ancient Blue Dragon: Cloaked Flight, Ancient Blue Dragon: Sonic Boom, Ancient Blue Dragon: Tail Swipe, Ancient Brass Dragon: Blazing Light, Ancient Brass Dragon: Pounce, Ancient Bronze Dragon: Guiding Light, Ancient Bronze Dragon: Pounce, Ancient Copper Dragon: Mind Jolt, Ancient Copper Dragon: Pounce, Ancient Gold Dragon: Guiding Light, Ancient Gold Dragon: Pounce, Ancient Green Dragon: Mind Invasion, Ancient Green Dragon: Pounce, Ancient Red Dragon: Commanding Presence, Ancient Red Dragon: Fiery Rays, Ancient Red Dragon: Pounce, Ancient Silver Dragon: Chill, Ancient Silver Dragon: Pounce, Ancient White Dragon: Frightful Presence, Ancient White Dragon: Pounce, Archmage: Misty Step (3/Day), Assassin: Multiattack, Bandit Captain: Multiattack, Behir: Multiattack, Blink Dog: Teleport (Recharge 4-6), Bugbear Stalker: Multiattack, Centaur Trooper: Multiattack, Chimera: Multiattack, Clay Golem: Hasten (Recharge 5-6), Cloaker: Multiattack, Cloaker: Phantasms (Recharge after a Short or Long Rest), Cloud Giant: Multiattack, Couatl: Divine Aid (2/Day), Cultist Fanatic: Spiritual Weapon (2/Day), Darkmantle: Darkness Aura (1/Day), Deva: Divine Aid (2/Day), Djinni: Multiattack, Drider: Magic of the Spider Queen (Recharge 5-6), Drider: Multiattack, Druid: Multiattack, Dryad: Multiattack, Dust Mephit: Sleep (1/Day), Earth Elemental: Multiattack, Efreeti: Multiattack, Fire Giant: Multiattack, Frost Giant: Multiattack, Frost Giant: War Cry (Recharge 5-6), Giant Constrictor Snake: Multiattack, Giant Hyena: Rampage (1/Day), Giant Octopus: Ink Cloud (1/Day), Gnoll Warrior: Rampage (1/Day), Goblin Boss: Multiattack, Guard Captain: Multiattack, Hill Giant: Multiattack, Hobgoblin Captain: Multiattack, Horned Devil: Multiattack, Hydra: Multiattack, Ice Devil: Ice Wall (Recharge 6), Ice Mephit: Fog Cloud (1/Day), Iron Golem: Multiattack, Knight: Multiattack, Kraken: Storm Bolt, Lich: Deathly Teleport, Lich: Frightening Gaze, Lich: Multiattack, Mage: Misty Step (3/Day), Manticore: Multiattack, Marilith: Multiattack, Marilith: Teleport (Recharge 5-6), Merrow: Multiattack, Mummy Lord: Dread Command, Mummy Lord: Glare, Mummy Lord: Multiattack, Mummy Lord: Necrotic Strike, Night Hag: Nightmare Haunting (1/Day), Octopus: Ink Cloud (1/Day), Oni: Multiattack, Otyugh: Multiattack, Pirate Captain: Multiattack, Pit Fiend: Hellfire Spellcasting (Recharge 4-6), Pit Fiend: Multiattack, Planetar: Divine Aid (2/Day), Priest Acolyte: Divine Aid (1/Day), Priest: Divine Aid (3/Day), Priest: Multiattack, Roc: Swoop (Recharge 5-6), Rust Monster: Multiattack, Scout: Multiattack, Solar: Divine Aid (3/Day), Sphinx of Lore: Arcane Prowl, Sphinx of Valor: Arcane Prowl, Sphinx of Wonder: Burst of Ingenuity (2/Day), Spirit Naga: Multiattack, Stone Giant: Deflect Missile (Recharge 5-6), Stone Giant: Multiattack, Stone Golem: Multiattack, Stone Golem: Slow (Recharge 5-6), Storm Giant: Multiattack, Succubus: Multiattack, Tarrasque: Multiattack, Tarrasque: Onslaught, Tarrasque: World-Shaking Movement, Tough Boss: Multiattack, Treant: Animate Trees (1/Day), Unicorn: Charging Horn, Unicorn: Shimmering Shield, Unicorn: Unicorn's Blessing (3/Day), Vampire: Beguile, Vampire: Charm (Recharge 5-6), Vampire: Deathless Strike, Warrior Veteran: Multiattack, Werebear: Multiattack, Wereboar: Multiattack, Wererat: Multiattack, Weretiger: Multiattack, Werewolf: Multiattack, Wight: Multiattack, Xorn: Multiattack

**Reference (113):** Adult Black Dragon: Spellcasting, Adult Blue Dragon: Spellcasting, Adult Brass Dragon: Spellcasting, Adult Bronze Dragon: Spellcasting, Adult Copper Dragon: Spellcasting, Adult Gold Dragon: Spellcasting, Adult Green Dragon: Spellcasting, Adult Red Dragon: Spellcasting, Adult Silver Dragon: Spellcasting, Ancient Black Dragon: Spellcasting, Ancient Blue Dragon: Spellcasting, Ancient Brass Dragon: Spellcasting, Ancient Bronze Dragon: Spellcasting, Ancient Copper Dragon: Spellcasting, Ancient Gold Dragon: Spellcasting, Ancient Green Dragon: Spellcasting, Ancient Red Dragon: Spellcasting, Ancient Silver Dragon: Spellcasting, Archmage: Spellcasting, Assassin: Cunning Action, Balor: Teleport, Black Pudding: Split, Bulette: Leap, Chain Devil: Unnerving Gaze, Cloud Giant: Misty Step, Cloud Giant: Spellcasting, Couatl: Spellcasting, Cultist Fanatic: Spellcasting, Deva: Spellcasting, Djinni: Spellcasting, Doppelganger: Read Thoughts, Doppelganger: Shape-Shift, Druid: Spellcasting, Dryad: Spellcasting, Dryad: Tree Stride, Efreeti: Spellcasting, Ettercap: Reel, Ghost: Etherealness, Giant Ape: Leap, Giant Frog: Swallow, Giant Owl: Spellcasting, Giant Seahorse: Bubble Dash, Giant Toad: Swallow, Glabrezu: Spellcasting, Goblin Boss: Nimble Escape, Goblin Boss: Redirect Attack, Goblin Minion: Nimble Escape, Goblin Warrior: Nimble Escape, Green Hag: Spellcasting, Guardian Naga: Spellcasting, Half-Dragon: Leap, Hezrou: Leap, Imp: Invisibility, Imp: Shape-Shift, Incubus: Spellcasting, Lamia: Leap, Lamia: Spellcasting, Lich: Spellcasting, Mage: Spellcasting, Magmin: Ignited Illumination, Mimic: Shape-Shift, Mummy Lord: Spellcasting, Nalfeshnee: Pursuit, Nalfeshnee: Teleport, Night Hag: Shape-Shift, Night Hag: Spellcasting, Nightmare: Ethereal Stride, Ochre Jelly: Split, Oni: Invisibility, Oni: Shape-Shift, Oni: Spellcasting, Panther: Nimble Escape, Phase Spider: Ethereal Jaunt, Planetar: Spellcasting, Priest Acolyte: Spellcasting, Priest: Spellcasting, Quasit: Invisibility, Quasit: Shape-Shift, Rakshasa: Spellcasting, Roper: Reel, Rust Monster: Destroy Metal, Rust Monster: Reflexive Antennae, Saber-Toothed Tiger: Nimble Escape, Sahuagin Warrior: Aquatic Charge, Sea Hag: Illusory Appearance, Seahorse: Bubble Dash, Shadow: Shadow Stealth, Shield Guardian: Protection, Shrieker Fungus: Shriek, Solar: Spellcasting, Sphinx of Lore: Spellcasting, Sphinx of Valor: Spellcasting, Spirit Naga: Spellcasting, Sprite: Invisibility, Spy: Cunning Action, Storm Giant: Spellcasting, Succubus: Charm, Succubus: Shape-Shift, Tiger: Nimble Escape, Troll: Charge, Unicorn: Spellcasting, Vampire Familiar: Deathless Agility, Vampire Spawn: Deathless Agility, Vampire: Shape-Shift, Werebear: Shape-Shift, Wereboar: Shape-Shift, Wererat: Shape-Shift, Weretiger: Prowl (Tiger or Hybrid Form Only), Weretiger: Shape-Shift, Werewolf: Shape-Shift, Will-o'-Wisp: Vanish, Wraith: Create Specter, Xorn: Charge

## Monster traits

| Record | State | How |
| --- | --- | --- |
| Abduct (2) | reference | not classified |
| Aberrant Ground (1) | reference | not classified |
| Acid Absorption (1) | reference | not classified |
| Adhesive (1) | reference | not classified |
| Agile (2) | reference | not classified |
| Air Form (2) | reference | not classified |
| Amorphous (4) | reference | not classified |
| Amphibious (31) | reference | not classified |
| Aura of Authority (1) | reference | not classified |
| Aversion to Fire (1) | reference | not classified |
| Barbed Hide (1) | reference | not classified |
| Beast of Burden (1) | reference | not classified |
| Berserk (2) | reference | not classified |
| Blood Frenzy (1) | reference | not classified |
| Bloodied Frenzy (1) | reference | not classified |
| Bloodied Fury (2) | reference | not classified |
| Blurred Form (1) | reference | not classified |
| Bound (1) | reference | not classified |
| Celestial Restoration (1) | reference | not classified |
| Compression (1) | reference | not classified |
| Confer Fire Resistance (1) | reference | not classified |
| Corrosive Form (2) | reference | not classified |
| Death Burst (5) | reference | not classified |
| Death Throes (1) | reference | not classified |
| Demonic Restoration (5) | reference | not classified |
| Diabolical Restoration (7) | reference | not classified |
| Divine Awareness (2) | reference | not classified |
| Draconic Origin (1) | reference | not classified |
| Earth Glide (2) | reference | not classified |
| Eldritch Restoration (1) | reference | not classified |
| Elemental Restoration (2) | reference | not classified |
| Ephemeral (1) | reference | not classified |
| Ethereal Sight (2) | reference | not classified |
| Evasion (1) | reference | not classified |
| Exalted Restoration (3) | reference | not classified |
| Fear Aura (1) | reference | not classified |
| Fiendish Restoration (2) | reference | not classified |
| Fire Absorption (1) | reference | not classified |
| Fire Aura (4) | reference | not classified |
| Fire Form (1) | reference | not classified |
| Flyby (7) | reference | not classified |
| Freeze (1) | reference | not classified |
| Gibbering (1) | reference | not classified |
| Greater Magic Resistance (1) | reference | not classified |
| Heat Aura (1) | reference | not classified |
| Hellish Restoration (1) | reference | not classified |
| Hold Breath (6) | reference | not classified |
| Ice Walk (4) | reference | not classified |
| Illumination (5) | reference | not classified |
| Immutable Form (4) | reference | not classified |
| Incorporeal Movement (4) | reference | not classified |
| Incubus Form (1) | reference | not classified |
| Inscrutable (2) | reference | not classified |
| Invisibility (1) | reference | not classified |
| Iron Scent (1) | reference | not classified |
| Jumper (1) | reference | not classified |
| Legendary Resistance (32) | reference | not classified |
| Light Sensitivity (1) | reference | not classified |
| Lightning Absorption (2) | reference | not classified |
| Limited Amphibiousness (1) | reference | not classified |
| Loathsome Limbs (1) | reference | not classified |
| Magic Resistance (34) | reference | not classified |
| Magic Rope (1) | reference | not classified |
| Mimicry (2) | reference | not classified |
| Misty Escape (1) | reference | not classified |
| Mucus Cloud (1) | reference | not classified |
| Multiple Heads (1) | reference | not classified |
| Ooze Cube (1) | reference | not classified |
| Pack Tactics (18) | reference | not classified |
| Probing Telepathy (1) | reference | not classified |
| Reactive (1) | reference | not classified |
| Reactive Heads (1) | reference | not classified |
| Reflective Carapace (1) | reference | not classified |
| Regeneration (4) | reference | not classified |
| Running Leap (2) | reference | not classified |
| Sense Magic (1) | reference | not classified |
| Shark Telepathy (1) | reference | not classified |
| Shielded Mind (1) | reference | not classified |
| Siege Monster (4) | reference | not classified |
| Soul Bag (1) | reference | not classified |
| Speak with Beasts and Plants (1) | reference | not classified |
| Spell Storing (1) | reference | not classified |
| Spider Climb (14) | reference | not classified |
| Spirit Jar (1) | reference | not classified |
| Standing Leap (3) | reference | not classified |
| Stench (2) | reference | not classified |
| Succubus Form (1) | reference | not classified |
| Sunlight Sensitivity (5) | reference | not classified |
| Sunlight Weakness (1) | reference | not classified |
| Swarm (7) | reference | not classified |
| Telepathic Bond (1) | reference | not classified |
| Training (1) | reference | not classified |
| Transparent (1) | reference | not classified |
| Treasure Sense (1) | reference | not classified |
| Troll Spawn (1) | reference | not classified |
| Tunneler (2) | reference | not classified |
| Undead Fortitude (2) | reference | not classified |
| Undead Restoration (1) | reference | not classified |
| Vampire Weakness (2) | reference | not classified |
| Vampiric Connection (1) | reference | not classified |
| Vile Appearance (1) | reference | not classified |
| Water Breathing (9) | reference | not classified |
| Water Form (1) | reference | not classified |
| Water Susceptibility (1) | reference | not classified |
| Web Walker (5) | reference | not classified |
| Wishes (2) | reference | not classified |

## Barbarian features

**Enforced (16):** Ability Score Improvement, Barbarian Subclass, Danger Sense, Epic Boon, Extra Attack, Fast Movement, Feral Instinct, Intimidating Presence (Path of the Berserker), Mindless Rage (Path of the Berserker), Primal Champion, Primal Knowledge, Rage, Reckless Attack, Retaliation (Path of the Berserker), Unarmored Defense, Weapon Mastery

**Guided (1):** Persistent Rage

**Reference (6):** Brutal Strike, Frenzy (Path of the Berserker), Improved Brutal Strike, Indomitable Might, Instinctive Pounce, Relentless Rage

## Bard features

**Enforced (11):** Ability Score Improvement, Bard Subclass, Bardic Inspiration, Bonus Proficiencies (College of Lore), Cutting Words (College of Lore), Epic Boon, Expertise, Magical Discoveries (College of Lore), Magical Secrets, Peerless Skill (College of Lore), Words Of Creation

**Reference (5):** Countercharm, Font Of Inspiration, Jack Of All Trades, Spellcasting, Superior Inspiration

## Cleric features

**Enforced (12):** Ability Score Improvement, Blessed Strikes, Channel Divinity, Cleric Subclass, Divine Intervention, Divine Order, Epic Boon, Life Domain Spells (Level 5) (Life Domain), Life Domain Spells (Level 7) (Life Domain), Life Domain Spells (Level 9) (Life Domain), Life Domain Spells (Life Domain), Preserve Life (Life Domain)

**Guided (1):** Improved Blessed Strikes

**Reference (6):** Blessed Healer (Life Domain), Disciple of Life (Life Domain), Greater Divine Intervention, Sear Undead, Spellcasting, Supreme Healing (Life Domain)

## Druid features

**Enforced (15):** Ability Score Improvement, Circle of the Land Spells (Circle of the Land), Circle of the Land Spells (Level 5) (Circle of the Land), Circle of the Land Spells (Level 7) (Circle of the Land), Circle of the Land Spells (Level 9) (Circle of the Land), Druid Subclass, Druidic, Elemental Fury, Epic Boon, Land's Aid (Circle of the Land), Nature's Sanctuary (Circle of the Land), Nature's Ward (Circle of the Land), Primal Order, Wild Companion, Wild Shape

**Guided (1):** Improved Elemental Fury

**Reference (5):** Archdruid, Beast Spells, Natural Recovery (Circle of the Land), Spellcasting, Wild Resurgence

## Fighter features

**Enforced (13):** Ability Score Improvement, Additional Fighting Style (Champion), Epic Boon, Extra Attack, Fighter Subclass, Fighting Style, Improved Critical (Champion), Remarkable Athlete (Champion), Second Wind, Superior Critical (Champion), Three Extra Attacks, Two Extra Attacks, Weapon Mastery

**Guided (2):** Action Surge, Indomitable

**Reference (6):** Heroic Warrior (Champion), Studied Attacks, Survivor (Champion), Tactical Master, Tactical Mind, Tactical Shift

## Monk features

**Enforced (17):** Ability Score Improvement, Body And Mind, Disciplined Survivor, Epic Boon, Extra Attack, Monk Subclass, Monks Focus, Quivering Palm (Warrior of the Open Hand), Stunning Strike, Superior Defense, Unarmored Defense, Unarmored Movement, Unarmored Movement, Unarmored Movement, Unarmored Movement, Unarmored Movement, Wholeness of Body (Warrior of the Open Hand)

**Guided (1):** Uncanny Metabolism

**Reference (12):** Acrobatic Movement, Deflect Attacks, Deflect Energy, Empowered Strikes, Evasion, Fleet Step (Warrior of the Open Hand), Heightened Focus, Martial Arts, Open Hand Technique (Warrior of the Open Hand), Perfect Focus, Self Restoration, Slow Fall

## Paladin features

**Enforced (20):** Ability Score Improvement, Abjure Foes, Aura Of Courage, Aura of Devotion (Oath of Devotion), Channel Divinity, Epic Boon, Extra Attack, Faithful Steed, Fighting Style, Holy Nimbus (Oath of Devotion), Oath of Devotion Spells (Level 13) (Oath of Devotion), Oath of Devotion Spells (Level 17) (Oath of Devotion), Oath of Devotion Spells (Level 5) (Oath of Devotion), Oath of Devotion Spells (Level 9) (Oath of Devotion), Oath of Devotion Spells (Oath of Devotion), Paladin Subclass, Paladins Smite, Radiant Strikes, Sacred Weapon (Oath of Devotion), Weapon Mastery

**Reference (6):** Aura Expansion, Aura Of Protection, Lay On Hands, Restoring Touch, Smite of Protection (Oath of Devotion), Spellcasting

## Ranger features

**Enforced (13):** Ability Score Improvement, Deft Explorer, Epic Boon, Expertise, Extra Attack, Favored Enemy, Feral Senses, Fighting Style, Natures Veil, Ranger Subclass, Roving, Tireless, Weapon Mastery

**Guided (2):** Defensive Tactics (Hunter), Hunter's Prey (Hunter)

**Reference (7):** Foe Slayer, Hunter's Lore (Hunter), Precise Hunter, Relentless Hunter, Spellcasting, Superior Hunter's Defense (Hunter), Superior Hunter's Prey (Hunter)

## Rogue features

**Enforced (12):** Ability Score Improvement, Epic Boon, Expertise, Fast Hands (Thief), Rogue Subclass, Slippery Mind, Sneak Attack, Steady Aim, Thieves Cant, Uncanny Dodge, Use Magic Device (Thief), Weapon Mastery

**Guided (1):** Stroke Of Luck

**Reference (10):** Cunning Action, Cunning Strike, Devious Strikes, Elusive, Evasion, Improved Cunning Strike, Reliable Talent, Second-Story Work (Thief), Supreme Sneak (Thief), Thief's Reflexes (Thief)

## Sorcerer features

**Enforced (12):** Ability Score Improvement, Draconic Resilience (Draconic Sorcery), Draconic Spells (Draconic Sorcery), Draconic Spells (Level 5) (Draconic Sorcery), Draconic Spells (Level 7) (Draconic Sorcery), Draconic Spells (Level 9) (Draconic Sorcery), Dragon Companion (Draconic Sorcery), Dragon Wings (Draconic Sorcery), Elemental Affinity (Draconic Sorcery), Epic Boon, Innate Sorcery, Sorcerer Subclass

**Guided (3):** Font Of Magic, Metamagic, Sorcerous Restoration

**Reference (3):** Arcane Apotheosis, Sorcery Incarnate, Spellcasting

## Warlock features

**Enforced (15):** Ability Score Improvement, Contact Patron, Eldritch Invocations, Epic Boon, Fiend Spells (Fiend Patron), Fiend Spells (Level 5) (Fiend Patron), Fiend Spells (Level 7) (Fiend Patron), Fiend Spells (Level 9) (Fiend Patron), Fiendish Resilience (Fiend Patron), Hurl Through Hell (Fiend Patron), Mystic Arcanum Level 6 Spell, Mystic Arcanum Level 7 Spell, Mystic Arcanum Level 8 Spell, Mystic Arcanum Level 9 Spell, Warlock Subclass

**Guided (2):** Dark One's Own Luck (Fiend Patron), Magical Cunning

**Reference (3):** Dark One's Blessing (Fiend Patron), Eldritch Master, Pact Magic

## Wizard features

**Enforced (7):** Ability Score Improvement, Epic Boon, Evocation Savant (Evoker), Scholar, Signature Spells, Spell Mastery, Wizard Subclass

**Guided (2):** Arcane Recovery, Overchannel (Evoker)

**Reference (6):** Empowered Evocation (Evoker), Memorize Spell, Potent Cantrip (Evoker), Ritual Adept, Sculpt Spells (Evoker), Spellcasting

## Species traits

**Enforced (64):** Abyssal Legacy (Tiefling), Adrenaline Rush (Orc), Arcane Cantrip (Elf), Breath Weapon (Acid) (Dragonborn), Breath Weapon (Acid) (Dragonborn), Breath Weapon (Cold) (Dragonborn), Breath Weapon (Cold) (Dragonborn), Breath Weapon (Fire) (Dragonborn), Breath Weapon (Fire) (Dragonborn), Breath Weapon (Fire) (Dragonborn), Breath Weapon (Lightning) (Dragonborn), Breath Weapon (Lightning) (Dragonborn), Breath Weapon (Poison) (Dragonborn), Chthonic Legacy (Tiefling), Damage Resistance (Acid) (Dragonborn), Damage Resistance (Acid) (Dragonborn), Damage Resistance (Cold) (Dragonborn), Damage Resistance (Cold) (Dragonborn), Damage Resistance (Fire) (Dragonborn), Damage Resistance (Fire) (Dragonborn), Damage Resistance (Fire) (Dragonborn), Damage Resistance (Lightning) (Dragonborn), Damage Resistance (Lightning) (Dragonborn), Damage Resistance (Poison) (Dragonborn), Dancing Lights (Elf), Darkness (Elf), Darkness (Tiefling), Darkvision (Dragonborn), Darkvision (Dwarf), Darkvision (Elf), Darkvision (Gnome), Darkvision (Orc), Darkvision (Tiefling), Detect Magic (Elf), Draconic Ancestry (Dragonborn), Draconic Flight (Dragonborn), Druidcraft (Elf), Dwarven Resilience (Dwarf), Dwarven Toughness (Dwarf), Elven Lineage (Elf), Faerie Fire (Elf), False Life (Tiefling), Fiendish Legacy (Tiefling), Fleet of Foot (Elf), Giant Ancestry (Goliath), Gnomish Lineage (Gnome), Hellish Rebuke (Tiefling), Hold Person (Tiefling), Infernal Legacy (Tiefling), Keen Senses (Elf), Large Form (Goliath), Longstrider (Elf), Minor Illusion (Gnome), Misty Step (Elf), Otherworldly Presence (Tiefling), Pass without Trace (Elf), Ray of Enfeeblement (Tiefling), Ray of Sickness (Tiefling), Rock Gnome Cantrips (Gnome), Skillful (Human), Speak with Animals (Gnome), Stonecunning (Dwarf), Superior Darkvision (Elf), Versatile (Human)

**Guided (1):** Relentless Endurance (Orc)

**Reference (12):** Brave (Halfling), Breath Weapon (Dragonborn), Clockwork Devices (Gnome), Damage Resistance (Dragonborn), Fey Ancestry (Elf), Gnomish Cunning (Gnome), Halfling Nimbleness (Halfling), Luck (Halfling), Naturally Stealthy (Halfling), Powerful Build (Goliath), Resourceful (Human), Trance (Elf)

## Backgrounds

**Enforced (4):** Acolyte, Criminal, Sage, Soldier

## Feats

**Enforced (16):** Ability Score Improvement, Alert, Archery, Boon of Combat Prowess, Boon of Dimensional Travel, Boon of Fate, Boon of Irresistible Offense, Boon of Spell Recall, Boon of the Night Spirit, Boon of Truesight, Defense, Grappler, Magic Initiate (Cleric), Magic Initiate (Druid), Magic Initiate (Wizard), Skilled

**Guided (1):** Savage Attacker

**Reference (2):** Great Weapon Fighting, Two-Weapon Fighting

## Magic items

**Enforced (112):** Ammunition, +1, Ammunition, +2, Ammunition, +3, Animated Shield, Armor of Invulnerability, Armor of Resistance, Armor, +1, Armor, +2, Armor, +3, Arrow-Catching Shield, Bag of Tricks, Berserker Axe, Boots of Elvenkind, Boots of the Winterlands, Bowl of Commanding Water Elementals, Bracers of Archery, Bracers of Defense, Brazier of Commanding Fire Elementals, Brooch of Shielding, Censer of Controlling Air Elementals, Cloak of Arachnida, Cloak of Elvenkind, Cloak of Invisibility, Cloak of Protection, Cloak of the Bat, Crystal Ball, Crystal Ball of Mind Reading, Crystal Ball of Telepathy, Crystal Ball of True Seeing, Cubic Gate, Dagger of Venom, Decanter of Endless Water, Defender, Demon Armor, Dragon Scale Mail, Dragon Slayer, Dwarven Plate, Dwarven Thrower, Elven Chain, Eyes of Charming, Flame Tongue, Frost Brand, Gem of Seeing, Giant Slayer, Glamoured Studded Leather, Gloves of Thievery, Hammer of Thunderbolts, Hat of Disguise, Helm of Comprehending Languages, Helm of Telepathy, Holy Avenger, Iron Bands, Iron Flask, Luck Blade, Mace of Smiting, Medallion of Thoughts, Nine Lives Stealer, Periapt of Proof against Poison, Pipes of Haunting, Pipes of the Sewers, Plate Armor of Etherealness, Quarterstaff of the Acrobat, Ring of Animal Influence, Ring of Evasion, Ring of Jumping, Ring of Protection, Ring of Resistance, Ring of Shooting Stars, Ring of Telekinesis, Ring of Water Walking, Robe of Scintillating Colors, Robe of Stars, Rod of Alertness, Rod of Rulership, Rope of Entanglement, Scarab of Protection, Scimitar of Speed, Sending Stones, Sentinel Shield, Shield of Missile Attraction, Shield of the Cavalier, Shield, +1, Shield, +2, Shield, +3, Spellguard Shield, Staff of Charming, Staff of Fire, Staff of Frost, Staff of Power, Staff of Swarming Insects, Staff of the Magi, Staff of the Woodlands, Staff of Thunder and Lightning, Stone of Controlling Earth Elementals, Stone of Good Luck (Luckstone), Sword of Wounding, Trident of Fish Command, Vorpal Sword, Wand of Enemy Detection, Wand of Fear, Wand of Fireballs, Wand of Lightning Bolts, Wand of Magic Detection, Wand of Paralysis, Wand of Polymorph, Wand of Secrets, Wand of Wonder, Weapon of Warning, Weapon, +1, Weapon, +2, Weapon, +3, Winged Boots

**Guided (70):** Amulet of Health, Amulet of Proof against Detection and Location, Amulet of the Planes, Armor of Vulnerability, Belt of Dwarvenkind, Belt of Giant Strength, Boots of Levitation, Boots of Speed, Boots of Striding and Springing, Broom of Flying, Candle of Invocation, Cloak of Displacement, Cloak of the Manta Ray, Cube of Force, Dancing Sword, Dragon Orb, Energy Bow, Gauntlets of Ogre Power, Gloves of Missile Snaring, Gloves of Swimming and Climbing, Hat of Many Spells, Headband of Intellect, Helm of Brilliance, Helm of Teleportation, Instant Fortress, Ioun Stone, Mace of Disruption, Mace of Terror, Mantle of Spell Resistance, Necklace of Adaptation, Necklace of Prayer Beads, Oathbow, Pearl of Power, Periapt of Health, Periapt of Wound Closure, Ring of Djinni Summoning, Ring of Elemental Command, Ring of Feather Falling, Ring of Free Action, Ring of Invisibility, Ring of Mind Shielding, Ring of Regeneration, Ring of Spell Storing, Ring of Spell Turning, Ring of the Ram, Ring of Warmth, Ring of X-ray Vision, Robe of Eyes, Robe of the Archmagi, Rod of Absorption, Rod of Lordly Might, Rod of Resurrection, Slippers of Spider Climbing, Staff of Healing, Staff of Striking, Staff of the Python, Staff of Withering, Sun Blade, Sword of Life Stealing, Sword of Sharpness, Talisman of Pure Good, Talisman of the Sphere, Talisman of Ultimate Evil, Thunderous Greatclub, Wand of Binding, Wand of the War Mage, +1, Wand of the War Mage, +2, Wand of the War Mage, +3, Wand of Web, Wings of Flying

**Reference (86):** Adamantine Armor, Ammunition of Slaying, Apparatus of the Crab, Bag of Beans, Bag of Devouring, Bag of Holding, Bead of Force, Bead of Nourishment, Cape of the Mountebank, Carpet of Flying, Chime of Opening, Circlet of Blasting, Deck of Illusions, Dimensional Shackles, Dust of Disappearance, Dust of Dryness, Dust of Sneezing and Choking, Efficient Quiver, Efreeti Bottle, Elemental Gem, Elixir of Health, Eversmoking Bottle, Eyes of Minute Seeing, Eyes of the Eagle, Feather Token, Figurine of Wondrous Power, Folding Boat, Gem of Brightness, Goggles of Night, Handy Haversack, Horn of Blasting, Horn of Valhalla, Horseshoes of a Zephyr, Horseshoes of Speed, Immovable Rod, Javelin of Lightning, Lantern of Revealing, Manual of Bodily Health, Manual of Gainful Exercise, Manual of Golems, Manual of Quickness of Action, Marvelous Pigments, Mirror of Life Trapping, Mithral Armor, Mysterious Deck, Necklace of Fireballs, Oil of Etherealness, Oil of Sharpness, Oil of Slipperiness, Philter of Love, Portable Hole, Potion of Animal Friendship, Potion of Clairvoyance, Potion of Climbing, Potion of Diminution, Potion of Flying, Potion of Gaseous Form, Potion of Giant Strength, Potion of Growth, Potion of Heroism, Potion of Invisibility, Potion of Invulnerability, Potion of Longevity, Potion of Mind Reading, Potion of Poison, Potion of Resistance, Potion of Speed, Potion of Vitality, Potion of Water Breathing, Potions of Healing, Ring of Swimming, Ring of Three Wishes, Robe of Useful Items, Rod of Security, Rope of Climbing, Sovereign Glue, Spell Scroll, Sphere of Annihilation, Tome of Clear Thought, Tome of Leadership and Influence, Tome of Understanding, Universal Solvent, Vicious Weapon, Wand of Magic Missiles, Well of Many Worlds, Wind Fan

## Gear and tools

**Enforced (10):** Acid (vial), Alchemist's Fire (flask), Arrows (20), Blowgun Needles (50), Crossbow Bolts (20), Firearm Bullets (10), Holy Water (flask), Net, Potion of Healing, Sling Bullets (20)

**Reference (129):** Alchemist's Supplies, Antitoxin (vial), Arcane Focus (Crystal), Arcane Focus (Orb), Arcane Focus (Rod), Arcane Focus (Staff), Arcane Focus (Wand), Backpack, Ball Bearings (bag of 1,000), Barrel, Basket, Bedroll, Bell, Blanket, Block and Tackle, Book, Bottle, Glass, Brewer's Supplies, Bucket, Burglar's Pack, Calligrapher's Supplies, Caltrops (bag of 20), Candle, Carpenter's Tools, Cartographer's Tools, Case, Crossbow Bolt, Case, Map or Scroll, Chain (10 feet), Chalk (1 piece), Chest, Climber's Kit, Clothes, Fine, Clothes, Traveler's, Cobbler's Tools, Component Pouch, Cook's Utensils, Costume, Crowbar, Diplomat's Pack, Disguise Kit, Druidic Focus (Sprig of Mistletoe), Druidic Focus (Totem), Druidic Focus (Wooden Staff), Druidic Focus (Yew Wand), Dungeoneer's Pack, Entertainer's Pack, Explorer's Pack, Flask or Tankard, Forgery Kit, Gaming Set (Dice), Gaming Set (Dragonchess), Gaming Set (Playing Cards), Gaming Set (Three-Dragon Ante), Glassblower's Tools, Grappling Hook, Hammer, Healer's Kit, Herbalism Kit, Holy Symbol (Amulet), Holy Symbol (Emblem), Holy Symbol (Reliquary), Hunting Trap, Ink (1-ounce bottle), Ink Pen, Jeweler's Tools, Jug or Pitcher, Ladder (10-foot), Lamp, Lantern, Bullseye, Lantern, Hooded, Leatherworker's Tools, Lock, Magnifying Glass, Manacles, Map, Mason's Tools, Mess Kit, Mirror, Steel, Musical Instrument (Bagpipes), Musical Instrument (Drum), Musical Instrument (Dulcimer), Musical Instrument (Flute), Musical Instrument (Horn), Musical Instrument (Lute), Musical Instrument (Lyre), Musical Instrument (Pan Flute), Musical Instrument (Shawm), Musical Instrument (Viol), Navigator's Tools, Oil (flask), Painter's Supplies, Paper (one sheet), Parchment (one sheet), Perfume (vial), Poison, Basic (vial), Poisoner's Kit, Pole (10-foot), Pot, Iron, Potter's Tools, Pouch, Priest's Pack, Quiver, Ram, Portable, Rations (1 day), Robe, Rope (50 feet), Sack, Scale, Merchant's, Scholar's Pack, Sealing Wax, Shovel, Signal Whistle, Signet Ring, Smith's Tools, Soap, Spellbook, Spikes, Iron (10), Spyglass, String (10 feet), Tent, Two-Person, Thieves' Tools, Tinderbox, Tinker's Tools, Torch, Vial, Waterskin, Weaver's Tools, Whetstone, Woodcarver's Tools

## Weapons

**Enforced (38):** Battleaxe, Blowgun, Club, Dagger, Dart, Flail, Glaive, Greataxe, Greatclub, Greatsword, Halberd, Hand Crossbow, Handaxe, Heavy Crossbow, Javelin, Lance, Light Crossbow, Light Hammer, Longbow, Longsword, Mace, Maul, Morningstar, Musket, Pike, Pistol, Quarterstaff, Rapier, Scimitar, Shortbow, Shortsword, Sickle, Sling, Spear, Trident, War Pick, Warhammer, Whip

## Armor

**Enforced (13):** Breastplate, Chain Mail, Chain Shirt, Half Plate Armor, Hide Armor, Leather Armor, Padded Armor, Plate Armor, Ring Mail, Scale Mail, Shield, Splint Armor, Studded Leather Armor

## Conditions

| Record | State | How |
| --- | --- | --- |
| Blinded | reference | not classified |
| Charmed | reference | not classified |
| Deafened | reference | not classified |
| Exhaustion | reference | not classified |
| Frightened | reference | not classified |
| Grappled | reference | not classified |
| Incapacitated | reference | not classified |
| Invisible | reference | not classified |
| Paralyzed | reference | not classified |
| Petrified | reference | not classified |
| Poisoned | reference | not classified |
| Prone | reference | not classified |
| Restrained | reference | not classified |
| Stunned | reference | not classified |
| Unconscious | reference | not classified |

## Rules glossary

| Record | State | How |
| --- | --- | --- |
| Ability Check | reference | not classified |
| Ability Score and Modifier | reference | not classified |
| Action | reference | not classified |
| Advantage | reference | not classified |
| Adventure | reference | not classified |
| Alignment | reference | not classified |
| Ally | reference | not classified |
| Area of Effect | reference | not classified |
| Armor Class | reference | not classified |
| Armor Training | reference | not classified |
| Attack | reference | not classified |
| Attack Roll | reference | not classified |
| Attitude | reference | not classified |
| Attunement | reference | not classified |
| Blinded | reference | not classified |
| Blindsight | reference | not classified |
| Bloodied | reference | not classified |
| Bonus Action | reference | not classified |
| Breaking Objects | reference | not classified |
| Bright Light | reference | not classified |
| Burning | reference | not classified |
| Burrow Speed | reference | not classified |
| Campaign | reference | not classified |
| Cantrip | reference | not classified |
| Carrying Capacity | reference | not classified |
| Challenge Rating | reference | not classified |
| Character Sheet | reference | not classified |
| Charmed | reference | not classified |
| Climb Speed | reference | not classified |
| Climbing | reference | not classified |
| Concentration | reference | not classified |
| Condition | reference | not classified |
| Cone | reference | not classified |
| Cover | reference | not classified |
| Crawling | reference | not classified |
| Creature | reference | not classified |
| Creature Type | reference | not classified |
| Critical Hit | reference | not classified |
| Cube | reference | not classified |
| Curses | reference | not classified |
| Cylinder | reference | not classified |
| D20 Test | reference | not classified |
| Damage | reference | not classified |
| Damage Roll | reference | not classified |
| Damage Threshold | reference | not classified |
| Damage Types | reference | not classified |
| Darkness | reference | not classified |
| Darkvision | reference | not classified |
| Dash | reference | not classified |
| Dead | reference | not classified |
| Deafened | reference | not classified |
| Death Saving Throw | reference | not classified |
| Dehydration | reference | not classified |
| Difficult Terrain | reference | not classified |
| Difficulty Class | reference | not classified |
| Dim Light | reference | not classified |
| Disadvantage | reference | not classified |
| Disengage | reference | not classified |
| Dodge | reference | not classified |
| Emanation | reference | not classified |
| Encounter | reference | not classified |
| Enemy | reference | not classified |
| Exhaustion | reference | not classified |
| Experience Points | reference | not classified |
| Expertise | reference | not classified |
| Falling | reference | not classified |
| Fly Speed | reference | not classified |
| Flying | reference | not classified |
| Friendly | reference | not classified |
| Frightened | reference | not classified |
| Grappled | reference | not classified |
| Grappling | reference | not classified |
| Hazard | reference | not classified |
| Healing | reference | not classified |
| Heavily Obscured | reference | not classified |
| Help | reference | not classified |
| Heroic Inspiration | reference | not classified |
| Hide | reference | not classified |
| High Jump | reference | not classified |
| Hit Point Dice | reference | not classified |
| Hit Points | reference | not classified |
| Hostile | reference | not classified |
| Hover | reference | not classified |
| Illusions | reference | not classified |
| Immunity | reference | not classified |
| Improvised Weapons | reference | not classified |
| Incapacitated | reference | not classified |
| Indifferent | reference | not classified |
| Influence | reference | not classified |
| Initiative | reference | not classified |
| Invisible | reference | not classified |
| Jumping | reference | not classified |
| Knocking Out a Creature | reference | not classified |
| Lightly Obscured | reference | not classified |
| Line | reference | not classified |
| Long Jump | reference | not classified |
| Long Rest | reference | not classified |
| Magic | reference | not classified |
| Magical Effect | reference | not classified |
| Malnutrition | reference | not classified |
| Monster | reference | not classified |
| Nonplayer Character | reference | not classified |
| Object | reference | not classified |
| Occupied Space | reference | not classified |
| Opportunity Attacks | reference | not classified |
| Paralyzed | reference | not classified |
| Passive Perception | reference | not classified |
| Per Day | reference | not classified |
| Petrified | reference | not classified |
| Player Character | reference | not classified |
| Poisoned | reference | not classified |
| Possession | reference | not classified |
| Proficiency | reference | not classified |
| Prone | reference | not classified |
| Reach | reference | not classified |
| Reaction | reference | not classified |
| Ready | reference | not classified |
| Resistance | reference | not classified |
| Restrained | reference | not classified |
| Ritual | reference | not classified |
| Round Down | reference | not classified |
| Save | reference | not classified |
| Saving Throw | reference | not classified |
| Search | reference | not classified |
| Shape-Shifting | reference | not classified |
| Short Rest | reference | not classified |
| Simultaneous Effects | reference | not classified |
| Size | reference | not classified |
| Skill | reference | not classified |
| Speed | reference | not classified |
| Spell | reference | not classified |
| Spell Attack | reference | not classified |
| Spellcasting Focus | reference | not classified |
| Sphere | reference | not classified |
| Stable | reference | not classified |
| Stat Block | reference | not classified |
| Study | reference | not classified |
| Stunned | reference | not classified |
| Suffocation | reference | not classified |
| Surprise | reference | not classified |
| Swim Speed | reference | not classified |
| Swimming | reference | not classified |
| Target | reference | not classified |
| Telepathy | reference | not classified |
| Teleportation | reference | not classified |
| Temporary Hit Points | reference | not classified |
| Tremorsense | reference | not classified |
| Truesight | reference | not classified |
| Unarmed Strike | reference | not classified |
| Unconscious | reference | not classified |
| Unoccupied Space | reference | not classified |
| Utilize | reference | not classified |
| Vulnerability | reference | not classified |
| Weapon | reference | not classified |
| Weapon Attack | reference | not classified |

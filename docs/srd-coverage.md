# SRD 5.2.1 coverage (generated, do not edit by hand)

This page lists every record in the SRD 5.2.1 content and says what the app does with it. Each record is in
one of three states:

- **Enforced:** the server applies it in play. The GM may still supply a fact the map can't see, such as a
  creature's line of sight or its degree of cover, and a note names any narrative part left to the table.
- **Guided:** the app tracks it or applies part of it, and a person applies the rest. It may count a use, open a
  prompt, roll a check or post a reminder. The note says which part is the table's.
- **Reference:** the app shows the text and applies nothing.

A note names the module that applies a record, so it can be checked in the code. Enforcement follows the
table's rules policy: under advise the server warns where it would refuse, and under off it says nothing.

Regenerate this page with `npm run map`. A test (`apps/server/test/srd-coverage.test.ts`) fails when the page
is stale, when a curated row is missing or names a record that no longer exists, and when a sampled claim
stops matching the engine. Known gaps in enforced records are GitHub issues.

## Summary

| Records | Enforced | Guided | Reference |
| --- | --- | --- | --- |
| Spells (339) | 125 | 214 | 0 |
| Monster actions (992) | 883 | 65 | 44 |
| Monster traits (106) | 26 | 4 | 76 |
| Barbarian features (23) | 19 | 0 | 4 |
| Bard features (16) | 14 | 1 | 1 |
| Cleric features (19) | 11 | 3 | 5 |
| Druid features (21) | 13 | 4 | 4 |
| Fighter features (21) | 17 | 0 | 4 |
| Monk features (30) | 21 | 3 | 6 |
| Paladin features (26) | 22 | 3 | 1 |
| Ranger features (22) | 15 | 2 | 5 |
| Rogue features (23) | 17 | 3 | 3 |
| Sorcerer features (18) | 15 | 3 | 0 |
| Warlock features (20) | 15 | 3 | 2 |
| Wizard features (15) | 9 | 2 | 4 |
| Species traits (77) | 63 | 3 | 11 |
| Backgrounds (4) | 4 | 0 | 0 |
| Feats (19) | 12 | 6 | 1 |
| Magic items (270) | 54 | 139 | 77 |
| Gear and tools (141) | 16 | 37 | 88 |
| Weapons (38) | 38 | 0 | 0 |
| Armor (13) | 13 | 0 | 0 |
| Conditions (15) | 12 | 3 | 0 |
| Rules glossary (155) | 99 | 15 | 41 |
| All records (2423) | 1533 | 513 | 377 |

## How records are classified

Most records are classified from the mechanics their content bundle carries, because the engine is data-driven
(`apps/server/src/srd-coverage.ts`); the rest are curated (`apps/server/src/srd-coverage-curated.ts`).

- **Spells:** a cast resolves in `action-resolution.ts` and the steps in `resolution/`, at the caster's own
  numbers. A spell is enforced when its cast applies its attack, save, damage, healing or lasting effect, ends
  spells or curses (`resolution/dispel.ts`), or when the area it leaves applies them as creatures enter it or
  start or end a turn there (`spell-zones.ts`).
  Guided when the app spends the slot and holds the Concentration, the area or a save while a person applies
  what the spell does. A spell whose cast leaves a rider to the table (Storm of Vengeance's later turns) is
  curated as guided, with a note.
- **Monster actions:** enforced when the attack, save, damage, healing or effect resolves, or when the server
  offers the action as the generic action it names (Nimble Escape's Disengage or Hide). An action that casts
  spells takes the state of the spells it casts, each a cast action at the stat block's numbers. Guided when the
  server resolves it and reminds the GM of the rest, or only counts a use, a legendary cost or a recharge.
- **Class features, species traits and feats:** enforced when their riders (an action that resolves, an
  effect, a modifier the engine reads, a grant) or the builder's picks apply them. Guided when the app counts
  their uses or offers an action that only spends a use, or when part of what they do is left to a person.
- **Magic items and gear:** enforced for weapons, armor, ammunition, Spell Scrolls and items whose riders
  apply. An item that casts spells takes the state of the spells it casts. Guided when the app only tracks
  Attunement, charges or a curse, or binds the item to a base weapon or armor without its magic. Tools are
  guided too: the server rolls their checks, and the GM sets what they achieve.
- **Backgrounds, weapons and armor:** enforced. The builder applies a background, and every weapon and armor
  statistic reaches the rolls.
- **Monster traits, conditions and the rules glossary:** curated by hand, each with a note.

Records the data can't classify, because the engine handles them in code or their data applies only part of
what they do, are curated too (`RECORD_OVERRIDES`). Each group lists their notes after its records.

## Spells

**Enforced (125):** Acid Arrow · Acid Splash · Aid · Animal Friendship · Arcane Sword · Bane · Banishment · Barkskin · Befuddlement · Black Tentacles · Blade Barrier · Bless · Blight · Blindness/Deafness · Blur · Burning Hands · Call Lightning · Chain Lightning · Charm Monster · Charm Person · Chill Touch · Circle of Death · Cloudkill · Color Spray · Cone of Cold · Conjure Animals · Conjure Fey · Conjure Woodland Beings · Contact Other Plane · Counterspell · Cure Wounds · Death Ward · Disintegrate · Dispel Magic · Divine Favor · Divine Smite · Dragon's Breath · Eldritch Blast · Enhance Ability · Ensnaring Strike · Entangle · Faerie Fire · False Life · Finger of Death · Fire Bolt · Fire Storm · Fireball · Flame Blade · Flame Strike · Flaming Sphere · Fly · Foresight · Freezing Sphere · Geas · Grease · Greater Invisibility · Guardian of Faith · Guiding Bolt · Harm · Haste · Heal · Healing Word · Heat Metal · Hellish Rebuke · Heroism · Hex · Hold Monster · Hold Person · Hunter's Mark · Hypnotic Pattern · Ice Knife · Ice Storm · Incendiary Cloud · Inflict Wounds · Insect Plague · Invisibility · Lesser Restoration · Lightning Bolt · Longstrider · Mage Armor · Magic Missile · Mass Cure Wounds · Mass Heal · Mass Healing Word · Mass Suggestion · Meteor Swarm · Mind Spike · Modify Memory · Moonbeam · Poison Spray · Power Word Heal · Power Word Stun · Produce Flame · Protection from Energy · Protection from Poison · Ray of Frost · Ray of Sickness · Remove Curse · Sacred Flame · Scorching Ray · Searing Smite · Shatter · Shield · Shield of Faith · Shining Smite · Shocking Grasp · Slow · Spare the Dying · Spider Climb · Spike Growth · Spirit Guardians · Spiritual Weapon · Starry Wisp · Stinking Cloud · Stoneskin · Suggestion · Sunbeam · Sunburst · Thunderwave · Vampiric Touch · Vicious Mockery · Vitriolic Sphere · Wall of Fire · Wall of Thorns · Web

**Guided (214):** Alarm · Alter Self · Animal Messenger · Animal Shapes · Animate Dead · Animate Objects · Antilife Shell · Antimagic Field · Antipathy/Sympathy · Arcane Eye · Arcane Hand · Arcane Lock · Arcanist's Magic Aura · Astral Projection · Augury · Aura of Life · Awaken · Beacon of Hope · Bestow Curse · Blink · Calm Emotions · Chromatic Orb · Clairvoyance · Clone · Command · Commune · Commune with Nature · Comprehend Languages · Compulsion · Confusion · Conjure Celestial · Conjure Elemental · Conjure Minor Elementals · Contagion · Contingency · Continual Flame · Control Water · Control Weather · Create Food and Water · Create or Destroy Water · Create Undead · Creation · Dancing Lights · Darkness · Darkvision · Daylight · Delayed Blast Fireball · Demiplane · Detect Evil and Good · Detect Magic · Detect Poison and Disease · Detect Thoughts · Dimension Door · Disguise Self · Dispel Evil and Good · Dissonant Whispers · Divination · Divine Word · Dominate Beast · Dominate Monster · Dominate Person · Dream · Druidcraft · Earthquake · Elementalism · Enlarge/Reduce · Enthrall · Etherealness · Expeditious Retreat · Eyebite · Fabricate · Faithful Hound · Fear · Feather Fall · Find Familiar · Find Steed · Find the Path · Find Traps · Fire Shield · Flesh to Stone · Floating Disk · Fog Cloud · Forbiddance · Forcecage · Freedom of Movement · Gaseous Form · Gate · Gentle Repose · Giant Insect · Glibness · Globe of Invulnerability · Glyph of Warding · Goodberry · Greater Restoration · Guards and Wards · Guidance · Gust of Wind · Hallow · Hallucinatory Terrain · Heroes' Feast · Hideous Laughter · Holy Aura · Identify · Illusory Script · Imprisonment · Instant Summons · Irresistible Dance · Jump · Knock · Legend Lore · Levitate · Light · Locate Animals or Plants · Locate Creature · Locate Object · Mage Hand · Magic Circle · Magic Jar · Magic Mouth · Magic Weapon · Magnificent Mansion · Major Image · Maze · Meld into Stone · Mending · Message · Mind Blank · Minor Illusion · Mirage Arcane · Mirror Image · Mislead · Misty Step · Move Earth · Nondetection · Pass without Trace · Passwall · Phantasmal Force · Phantasmal Killer · Phantom Steed · Planar Ally · Planar Binding · Plane Shift · Plant Growth · Polymorph · Power Word Kill · Prayer of Healing · Prestidigitation · Prismatic Spray · Prismatic Wall · Private Sanctum · Programmed Illusion · Project Image · Protection from Evil and Good · Purify Food and Drink · Raise Dead · Ray of Enfeeblement · Regenerate · Reincarnate · Resilient Sphere · Resistance · Resurrection · Reverse Gravity · Revivify · Rope Trick · Sanctuary · Scrying · Secret Chest · See Invisibility · Seeming · Sending · Sequester · Shapechange · Shillelagh · Silence · Silent Image · Simulacrum · Sleep · Sleet Storm · Sorcerous Burst · Speak with Animals · Speak with Dead · Speak with Plants · Stone Shape · Storm of Vengeance · Summon Dragon · Symbol · Telekinesis · Telepathic Bond · Teleport · Teleportation Circle · Thaumaturgy · Time Stop · Tiny Hut · Tongues · Transport via Plants · Tree Stride · True Polymorph · True Resurrection · True Seeing · True Strike · Tsunami · Unseen Servant · Wall of Force · Wall of Ice · Wall of Stone · Warding Bond · Water Breathing · Water Walk · Weird · Wind Walk · Wind Wall · Wish · Word of Recall · Zone of Truth

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Befuddlement | enforced | A failed save deals the Psychic damage and bars the target from casting spells and the Magic action (resolution/economy.ts). The save every 30 days, and Greater Restoration, Heal or Wish ending it, are the GM's. |
| Bestow Curse | guided | A failed save leaves the curse on the target for the slot's duration (resolution/concentration.ts: with Concentration below level 5, 10 minutes from a level 4 slot, 8 hours from 5, 24 hours from 7, until dispelled from 9), and Remove Curse or Dispel Magic ends it. The curse the caster chooses, and what it does, are the GM's to apply. |
| Blur | enforced | Attack rolls against the caster have Disadvantage while it lasts. An attacker that perceives the caster with Blindsight or Truesight is the GM's to spare. |
| Chromatic Orb | guided | The attack and the chosen damage type are applied. The leap to another target on matching dice is the GM's. |
| Compulsion | guided | A failed save imposes Charmed. The move it forces each turn, and the save after it, are the GM's. |
| Conjure Celestial | guided | The Healing Light on the cast is applied. Searing Light, and moving the Cylinder, are the GM's. |
| Conjure Elemental | guided | spell-zones.ts asks for the spirit's Dexterity save when an enemy enters its space or starts its turn within 5 feet of it, while it has no creature Restrained: 8d8 damage of its element and Restrained until the spell ends on a failure. The Restrained creature's repeat save with 4d8 damage at the start of each of its turns is the GM's. |
| Contact Other Plane | enforced | The caster makes the DC 15 Intelligence save (resolution/pending.ts); a failure deals 6d6 Psychic damage and leaves it Incapacitated until it finishes a Long Rest (rests.ts). The entity's answers, and a Greater Restoration ending the condition, are the GM's. |
| Contagion | guided | The save's 11d8 Necrotic damage and Poisoned condition are applied. The Disadvantage on saves with the chosen ability, and the three repeat saves, are the GM's. |
| Counterspell | enforced | resolution/counter.ts holds a cast with components while each creature that sees its caster within 60 feet and has Counterspell, a slot and its Reaction answers. counter-answers.ts rolls the caster's Constitution save against the reactor's DC: a failure ends the spell with no effect and leaves its slot unspent, and a success lets it go ahead. |
| Death Ward | enforced | hit-points.ts leaves the target at 1 Hit Point the first time it would drop to 0, and ends the spell. Negating an effect that would kill it without damage is the GM's. |
| Delayed Blast Fireball | guided | Cast in a fight, the bead waits at its point and spell-zones.ts explodes it when the spell ends, Concentration broken included: the Dexterity save and 12d6 Fire damage, plus 1d6 for each of the caster's turns that ended while it waited. A creature touching the bead, and a bead left outside a fight, are the GM's. |
| Dispel Magic | enforced | resolution/dispel.ts ends each spell on the target creature of the slot's level or lower, and for each higher one rolls the caster's spellcasting ability check against DC 10 plus its level. The GM can aim it at a spell's area on the map instead. A spell on an object the app doesn't track is the GM's. |
| Dissonant Whispers | guided | The save and its Psychic damage are applied. The target's move away with its Reaction is the GM's. |
| Dominate Beast | guided | A failed save imposes Charmed for the spell's duration, longer from a higher slot (resolution/concentration.ts). The repeat save each time the target takes damage, and its orders, are the GM's. |
| Dominate Monster | guided | A failed save imposes Charmed for the spell's duration, longer from a level 9 slot (resolution/concentration.ts). The repeat save each time the target takes damage, and its orders, are the GM's. |
| Dominate Person | guided | A failed save imposes Charmed for the spell's duration, longer from a higher slot (resolution/concentration.ts). The repeat save each time the target takes damage, and its orders, are the GM's. |
| Earthquake | guided | The cast's Dexterity save and Prone condition are applied. The save at the end of each of the caster's turns, the broken Concentration and the fissures are the GM's. |
| Faithful Hound | guided | Cast in a fight, spell-zones.ts makes the hound bite at the start of each of the caster's turns: the enemy nearest it within 5 feet makes the Dexterity save against 4d8 Force damage. Cast before a fight, the bite is a later action the GM runs. Its warning bark and its sight of Invisible creatures are the GM's. |
| Fear | guided | A failed save imposes Frightened. The Dash away on each of its turns, and the save out of the caster's sight, are the GM's. |
| Flesh to Stone | guided | A failed save imposes Restrained. The repeat saves toward Petrified, and Speed 0 on a success, are the GM's. |
| Freedom of Movement | guided | speed.ts gives the target a Swim Speed equal to its Speed. Ignoring Difficult Terrain, the immunity to magical Paralyzed and Restrained, and slipping free of restraints are the GM's. |
| Gust of Wind | guided | The cast's save pushes a creature that fails 15 feet away from the caster. The save at the end of a creature's turn in the Line, the doubled cost of moving toward the caster and turning the Line are the GM's. |
| Heal | enforced | resolution/heal.ts restores 70 Hit Points, 10 more for each slot level above 6, and ends Blinded, Deafened and Poisoned, for one creature (resolution/spell-targets.ts). |
| Hideous Laughter | guided | A failed save imposes Prone and Incapacitated, repeated at the end of each of the target's turns. The save with Advantage each time it takes damage is the GM's. |
| Hold Person | enforced | A failed save imposes Paralyzed, repeated at the end of each of the target's turns. resolution/spell-targets.ts takes one Humanoid, one more for each slot level above 2. |
| Irresistible Dance | guided | A failed save imposes Charmed. The dance's Disadvantage, the Advantage against the dancer and its save to collect itself are the GM's. |
| Light | guided | The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. The light and the object it shines from are the GM's. |
| Mage Hand | guided | The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. The hand and what it does are the GM's. |
| Major Image | guided | resolution/concentration.ts holds the caster's Concentration on it, and from a level 4 slot it lasts until dispelled with none. The illusion itself is the GM's to run. |
| Mass Cure Wounds | enforced | resolution/heal.ts restores 5d8 plus the modifier to up to six creatures the caster picks, and resolution/spell-targets.ts keeps them within one 30-foot Sphere centered within 60 feet. |
| Mass Heal | enforced | resolution/heal.ts divides the 700 Hit Points evenly among the creatures the caster picks, none past its maximum, and ends Blinded, Deafened and Poisoned on each. A different split is the caster's to make by hand. |
| Mass Suggestion | enforced | A failed save imposes Charmed on up to twelve creatures (resolution/spell-targets.ts). What the suggestion makes them do is the GM's. |
| Mending | guided | The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. The repair is the GM's. |
| Message | guided | The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. The whisper and its reply are the table's. |
| Phantasmal Killer | guided | The save and its 4d10 Psychic damage are applied, and a failure leaves Disadvantage on the target's ability checks and attack rolls, with the save repeated at the end of each of its turns until it succeeds (resolution/pending.ts). The 4d10 damage on each failed repeat is the GM's. |
| Power Word Heal | enforced | resolution/heal.ts restores all the target's Hit Points and ends Charmed, Frightened, Paralyzed, Poisoned and Stunned, for one creature (resolution/spell-targets.ts). Standing up from Prone with its Reaction is the creature's choice. |
| Power Word Stun | enforced | A target with 150 Hit Points or fewer is Stunned and repeats the save at the end of each of its turns; a tougher one's Speed is 0 until the start of the caster's next turn (resolution/pending.ts). |
| Prayer of Healing | guided | The 2d8 Hit Points are applied. The Short Rest's benefits, and the limit of once per Long Rest, are the GM's. |
| Prestidigitation | guided | The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. Its minor tricks are the GM's. |
| Prismatic Wall | guided | The save against Blinded for a creature near the wall is applied. Each layer's save and effect are the GM's. |
| Protection from Poison | enforced | The cast ends Poisoned and leaves Resistance to Poison damage and Advantage on saves to avoid or end Poisoned, for an hour counted on the game clock (game-time.ts). |
| Regenerate | guided | The 4d8 + 15 Hit Points are applied to one creature (resolution/spell-targets.ts). The 1 Hit Point at the start of each of the target's turns, and regrowing severed parts, are the GM's. |
| Remove Curse | enforced | resolution/dispel.ts ends every effect marked a curse on the target (Hex, Bestow Curse, Geas), and breaks its Attunement to a cursed item so the item can be removed; the item's own curse stays. A curse the app doesn't track is the GM's. |
| Shillelagh | guided | The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. The weapon's spellcasting ability, larger damage die and Force damage are the GM's. |
| Sleep | guided | A failed save imposes Incapacitated until the end of the target's next turn, and damage ends it. The second save, and Unconscious on its failure, are the GM's. |
| Sleet Storm | guided | spell-zones.ts asks for the Dexterity save when a creature enters the area or starts its turn there, and a failure leaves it Prone and ends its Concentration. The Difficult Terrain is the GM's to paint, and the Heavily Obscured area and the doused flames are the GM's. |
| Sorcerous Burst | guided | The attack and the chosen damage type are applied. Rolling another d8 on each 8 is the GM's. |
| Spare the Dying | enforced | The cast makes a creature at 0 Hit Points Stable with no check (resolution/stabilize.ts), within 15 feet, 30 at level 5, 60 at level 11 and 120 at level 17 (resolution/spell-targets.ts). |
| Spirit Guardians | enforced | spell-zones.ts asks for the save when a creature enters the Emanation or ends its turn there, and charges an affected creature double for each step it moves inside (terrain.ts). The creatures the caster designates are its allies. |
| Storm of Vengeance | guided | The first turn's save, Thunder damage and Deafened condition are applied. The storm's turns 2 to 10 are the GM's. |
| Thaumaturgy | guided | The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. Its wonders are the GM's. |
| True Strike | guided | The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. The weapon attack with the spellcasting ability, and its Radiant damage, are the GM's. |
| Tsunami | guided | The wall's first save and damage are applied. Its movement and the damage on later turns are the GM's. |
| Wall of Ice | guided | The save and its Cold damage for creatures in the wall's space are applied. The wall itself and its frigid air are the GM's. |
| Weird | guided | The save, its Psychic damage and Frightened are applied, with the repeat save at the end of each turn. The 5d10 Psychic damage on a failed repeat is the GM's. |
| Wind Wall | guided | The save and its Bludgeoning damage are applied. The projectiles the wall turns aside are the GM's. |

## Monster actions

**Enforced (883):** too many to list, so the guided and reference actions below stand out.

**Guided (65):** Adult Black Dragon: Frightful Presence · Adult Red Dragon: Commanding Presence · Adult White Dragon: Frightful Presence · Ancient Black Dragon: Frightful Presence · Ancient Red Dragon: Commanding Presence · Ancient White Dragon: Frightful Presence · Archmage: Misty Step (3/Day) · Bearded Devil: Infernal Glaive · Behir: Swallow · Blink Dog: Teleport (Recharge 4-6) · Cloaker: Phantasms (Recharge after a Short or Long Rest) · Cloud Giant: Misty Step · Cloud Giant: Spellcasting · Couatl: Spellcasting · Darkmantle: Darkness Aura (1/Day) · Deva: Spellcasting · Djinni: Create Whirlwind · Doppelganger: Read Thoughts · Dust Mephit: Sleep (1/Day) · Frost Giant: War Cry (Recharge 5-6) · Gelatinous Cube: Engulf · Ghost: Etherealness · Giant Hyena: Rampage (1/Day) · Giant Octopus: Ink Cloud (1/Day) · Giant Owl: Spellcasting · Gnoll Warrior: Rampage (1/Day) · Horned Devil: Infernal Tail · Hydra: Multiattack · Ice Devil: Ice Wall (Recharge 6) · Ice Mephit: Fog Cloud (1/Day) · Incubus: Nightmare (Recharge 6) · Invisible Stalker: Vortex · Kraken: Swallow · Lich: Deathly Teleport · Lich: Frightening Gaze · Mage: Misty Step (3/Day) · Marilith: Teleport (Recharge 5-6) · Mummy Lord: Dread Command · Mummy Lord: Necrotic Strike · Night Hag: Nightmare Haunting (1/Day) · Octopus: Ink Cloud (1/Day) · Otyugh: Bite · Pit Fiend: Hellfire Spellcasting (Recharge 4-6) · Planetar: Spellcasting · Priest Acolyte: Spellcasting · Purple Worm: Swallow · Remorhaz: Swallow · Roc: Swoop (Recharge 5-6) · Rust Monster: Reflexive Antennae · Sea Hag: Death Glare (Recharge 5-6) · Sea Hag: Illusory Appearance · Shambling Mound: Engulf · Solar: Slaying Bow · Solar: Spellcasting · Sphinx of Valor: Roar (3/Day) · Stone Giant: Deflect Missile (Recharge 5-6) · Storm Giant: Spellcasting · Succubus: Charm · Tarrasque: Onslaught · Tarrasque: Swallow · Tarrasque: World-Shaking Movement · Treant: Animate Trees (1/Day) · Unicorn: Shimmering Shield · Vampire: Beguile · Water Elemental: Whelm (Recharge 4-6)

**Reference (44):** Balor: Teleport · Black Pudding: Split · Bulette: Leap · Chain Devil: Unnerving Gaze · Doppelganger: Shape-Shift · Dryad: Tree Stride · Ettercap: Reel · Giant Ape: Leap · Giant Frog: Swallow · Giant Seahorse: Bubble Dash · Giant Toad: Swallow · Goblin Boss: Redirect Attack · Half-Dragon: Leap · Hezrou: Leap · Imp: Shape-Shift · Lamia: Leap · Magmin: Ignited Illumination · Mimic: Shape-Shift · Nalfeshnee: Pursuit · Nalfeshnee: Teleport · Night Hag: Shape-Shift · Nightmare: Ethereal Stride · Ochre Jelly: Split · Oni: Shape-Shift · Phase Spider: Ethereal Jaunt · Quasit: Shape-Shift · Roper: Reel · Rust Monster: Destroy Metal · Sahuagin Warrior: Aquatic Charge · Seahorse: Bubble Dash · Shield Guardian: Protection · Shrieker Fungus: Shriek · Succubus: Shape-Shift · Troll: Charge · Vampire: Shape-Shift · Werebear: Shape-Shift · Wereboar: Shape-Shift · Wererat: Shape-Shift · Weretiger: Prowl (Tiger or Hybrid Form Only) · Weretiger: Shape-Shift · Werewolf: Shape-Shift · Will-o'-Wisp: Vanish · Wraith: Create Specter · Xorn: Charge

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Rust Monster: Reflexive Antennae | guided | damage-reactions.ts offers it when a creature within 5 feet damages the rust monster, and using it resolves Antennae against that creature, opening its Dexterity save. It is offered on any damage, not only a hit's, so the GM declines it for a spell. |
| Sphinx of Wonder: Burst of Ingenuity (2/Day) | enforced | roll-answers.ts offers it on the sphinx's own check or save and asks it by a prompt about another creature's within 30 feet. Using it adds 2 to the roll, twice a day. |
| Stone Giant: Deflect Missile (Recharge 5-6) | guided | A ranged hit with Bludgeoning, Piercing or Slashing damage opens the giant's reaction prompt (damage-window.ts), and using it takes 1d10 + 6 off the damage, recharging on a 5 or 6. Redirecting the force at another creature when the damage reaches 0 is the GM's. |

## Monster traits

The number after each trait is how many stat blocks print it.

| Record | State | How |
| --- | --- | --- |
| Abduct (2) | enforced | movement-rules.ts charges the bugbear no extra movement to drag a creature it grapples. |
| Aberrant Ground (1) | reference | The GM can paint the Emanation as difficult terrain (terrain.ts), but the painted terrain doesn't move with the mouther. |
| Acid Absorption (1) | reference | hit-points.ts applies the stat block's Immunity to Acid damage. The Hit Points it regains from that damage are the GM's to add. |
| Adhesive (1) | reference | Sticking to what touches it is the GM's to apply with the Grappled condition. |
| Agile (2) | enforced | movement-rules.ts opens no Opportunity Attack when it moves out of an enemy's reach. |
| Air Form (2) | enforced | movement-rules.ts lets the elemental end a move in another creature's space. Fitting through a narrow gap is the GM's to allow. |
| Amorphous (4) | reference | The map has no walls or gaps, so squeezing through is the GM's to allow. |
| Amphibious (31) | reference | Breathing isn't tracked. |
| Aura of Authority (1) | enforced | statblock-traits.ts gives the hobgoblin and its allies within 10 feet Advantage on attack rolls and saving throws while it isn't Incapacitated. |
| Aversion to Fire (1) | reference | The Disadvantage after it takes Fire damage is the GM's to apply. |
| Barbed Hide (1) | enforced | trait-turns.ts deals 1d10 Piercing damage at the start of the devil's turns to each creature it grapples or that grapples it. |
| Beast of Burden (1) | reference | Carrying capacity isn't tracked. |
| Berserk (2) | enforced | trait-turns.ts rolls the d6 when the golem starts its turn Bloodied and keeps it berserk until it isn't Bloodied. Choosing what it attacks is the GM's. |
| Blood Frenzy (1) | enforced | resolution/attack.ts gives the sahuagin Advantage against a creature that doesn't have all its Hit Points. |
| Bloodied Frenzy (1) | enforced | resolution/attack.ts and saving-throws.ts give the Bloodied berserker Advantage on attack rolls and saving throws. |
| Bloodied Fury (2) | enforced | resolution/attack.ts gives the Bloodied creature Advantage on attack rolls. |
| Blurred Form (1) | reference | The Disadvantage on attack rolls against the mephit is the GM's to apply. |
| Bound (1) | reference | The amulet and the damage it shares are the GM's to run. |
| Celestial Restoration (1) | reference | Its return after death happens off the table; the GM runs it. |
| Compression (1) | reference | The map has no walls or gaps, so squeezing through is the GM's to allow. |
| Confer Fire Resistance (1) | reference | Granting its rider Resistance is the GM's to apply. |
| Corrosive Form (2) | guided | resolution/struck.ts deals the black pudding's 1d8 Acid damage to a creature that hits it with a melee attack. The gray ooze's printing deals none, and the damage to weapons and ammunition is the GM's. |
| Death Burst (5) | enforced | statblock-traits.ts opens the save for each creature in the Emanation when it dies, with the damage rolled once. |
| Death Throes (1) | enforced | statblock-traits.ts opens the Dexterity save for each creature within 30 feet when the balor dies, with its Fire and Force damage rolled once. Its new body in the Abyss is the GM's. |
| Demonic Restoration (5) | reference | Its return after death happens off the table; the GM runs it. |
| Diabolical Restoration (7) | reference | Its return after death happens off the table; the GM runs it. |
| Divine Awareness (2) | reference | Communication and senses like this are the GM's to run. |
| Draconic Origin (1) | reference | The GM picks the damage type and edits the stat block to match. |
| Earth Glide (2) | reference | Its Burrow Speed moves it on the map; passing through stone without a trace is the GM's to allow. |
| Eldritch Restoration (1) | reference | Its return after death happens off the table; the GM runs it. |
| Elemental Restoration (2) | reference | Its return after death happens off the table; the GM runs it. |
| Ephemeral (1) | reference | What it can carry is the GM's to rule. |
| Ethereal Sight (2) | reference | Communication and senses like this are the GM's to run. |
| Evasion (1) | enforced | saving-throws.ts takes no damage on a successful Dexterity save for half damage and half on a failure, while the assassin isn't Incapacitated. |
| Exalted Restoration (3) | reference | Its return after death happens off the table; the GM runs it. |
| Fear Aura (1) | enforced | trait-turns.ts opens the Wisdom save for each enemy that starts its turn in the aura while the pit fiend isn't Incapacitated. A failure is Frightened until the start of its next turn, and a success makes it immune for the fight. |
| Fiendish Restoration (2) | reference | Its return after death happens off the table; the GM runs it. |
| Fire Absorption (1) | reference | hit-points.ts applies the stat block's Immunity to Fire damage. The Hit Points it regains from that damage are the GM's to add. |
| Fire Aura (4) | enforced | trait-turns.ts deals the Fire damage at the end of the bearer's turns to each creature in the Emanation, or to an azer's enemies there. A fire elemental's aura also sets them burning. |
| Fire Form (1) | guided | movement-rules.ts lets the elemental end a move in a creature's space. The 1d10 Fire damage when it first enters a space on a turn is the GM's to deal. |
| Flyby (7) | enforced | movement-rules.ts opens no Opportunity Attack when it flies out of an enemy's reach. |
| Freeze (1) | reference | The slower Speed after Cold damage is the GM's to apply. |
| Gibbering (1) | guided | trait-turns.ts opens the Wisdom save for each creature that starts its turn within 20 feet. The d8 table on a failure is the GM's to roll. |
| Greater Magic Resistance (1) | enforced | saving-throws.ts makes the rakshasa succeed on saves against spells and magic items without a roll, and resolution/attack.ts makes spell attack rolls miss it. Hiding from divination is the GM's. |
| Heat Aura (1) | enforced | trait-turns.ts deals 3d10 Fire damage at the end of the remorhaz's turns to each creature within 5 feet. |
| Hellish Restoration (1) | reference | Its return after death happens off the table; the GM runs it. |
| Hold Breath (6) | reference | Breathing isn't tracked. |
| Ice Walk (4) | reference | Ice and snow aren't marked on the map, so the GM waives the cost. |
| Illumination (5) | reference | The map has no light levels, so the GM applies it. |
| Immutable Form (4) | reference | Shape-changing isn't modeled, so there is nothing to refuse. |
| Incorporeal Movement (4) | reference | Passing through creatures and objects, and the Force damage for ending a turn inside one, are the GM's. |
| Incubus Form (1) | reference | Changing form is the GM's to run; the token keeps this stat block. |
| Inscrutable (2) | reference | The Disadvantage on Insight checks about it is the GM's to apply. |
| Invisibility (1) | reference | The GM sets the Invisible condition on the token; the stat block doesn't add it. |
| Iron Scent (1) | reference | Communication and senses like this are the GM's to run. |
| Jumper (1) | reference | Jumps aren't measured. |
| Legendary Resistance (32) | enforced | saving-throws.ts lets the GM turn a failed save into a success, as many times a day as the stat block prints. A Long Rest restores them; the extra use in the lair is the GM's. |
| Light Sensitivity (1) | reference | The map has no light levels, so the GM applies it. |
| Lightning Absorption (2) | reference | hit-points.ts applies the stat block's Immunity to Lightning damage. The Hit Points it regains from that damage are the GM's to add. |
| Limited Amphibiousness (1) | reference | Breathing isn't tracked. |
| Loathsome Limbs (1) | reference | Severed limbs are the GM's to place as Troll Limb stat blocks. |
| Magic Resistance (34) | enforced | saving-throws.ts gives it Advantage on saves against spells and magic items, saves a spell asks it to repeat included. |
| Magic Rope (1) | reference | The rope and its statistics are the GM's to run. |
| Mimicry (2) | reference | Communication and senses like this are the GM's to run. |
| Misty Escape (1) | reference | Turning to mist at 0 Hit Points is the GM's to run. |
| Mucus Cloud (1) | reference | The save at the end of the aboleth's turn and its curse are the GM's to run. |
| Multiple Heads (1) | reference | Heads lost and regrown, and the Hit Points that come with them, are the GM's to track. |
| Ooze Cube (1) | reference | Entering the cube, and pulling a creature out, are the GM's to run with its Engulf. |
| Pack Tactics (18) | enforced | resolution/attack.ts gives Advantage when an ally of the attacker that isn't Incapacitated is within 5 feet of the target. |
| Probing Telepathy (1) | reference | Communication and senses like this are the GM's to run. |
| Reactive (1) | enforced | encounter.ts gives the marilith a fresh Reaction at the start of every turn. |
| Reactive Heads (1) | reference | The extra Reactions are the GM's to allow. |
| Reflective Carapace (1) | reference | The d6 against spells aimed at it is the GM's to roll. |
| Regeneration (4) | enforced | trait-turns.ts restores the Hit Points at the start of its turns, stopped for a turn by the damage types it names. statblock-traits.ts keeps a troll at 0 Hit Points alive until a turn starts without regenerating. |
| Running Leap (2) | reference | Jumps aren't measured. |
| Sense Magic (1) | reference | Communication and senses like this are the GM's to run. |
| Shark Telepathy (1) | reference | Communication and senses like this are the GM's to run. |
| Shielded Mind (1) | reference | Communication and senses like this are the GM's to run. |
| Siege Monster (4) | reference | Objects and structures have no Hit Points in the app. |
| Soul Bag (1) | reference | The bag and its statistics are the GM's to run. |
| Speak with Beasts and Plants (1) | reference | Communication and senses like this are the GM's to run. |
| Spell Storing (1) | reference | Storing and casting the spell is the GM's to run. |
| Spider Climb (14) | reference | Its Climb Speed moves it on the map; which surfaces it can climb is the GM's call. |
| Spirit Jar (1) | reference | Its return after death happens off the table; the GM runs it. |
| Standing Leap (3) | reference | Jumps aren't measured. |
| Stench (2) | enforced | trait-turns.ts opens the Constitution save for each creature that starts its turn within 5 feet. A failure is Poisoned until the start of its next turn, and a success makes it immune for the fight. |
| Succubus Form (1) | reference | Changing form is the GM's to run; the token keeps this stat block. |
| Sunlight Sensitivity (5) | reference | The map has no light levels, so the GM applies it. |
| Sunlight Weakness (1) | reference | The map has no light levels, so the GM applies it. |
| Swarm (7) | guided | movement-rules.ts and terrain.ts let the swarm and other creatures share a space. Refusing it Hit Points and Temporary Hit Points is the GM's. |
| Telepathic Bond (1) | reference | Communication and senses like this are the GM's to run. |
| Training (1) | reference | The GM picks the skill and applies its Advantage. |
| Transparent (1) | reference | Noticing the cube is the GM's call, with the DC the trait prints. |
| Treasure Sense (1) | reference | Communication and senses like this are the GM's to run. |
| Troll Spawn (1) | reference | What becomes of a severed limb is the GM's to run. |
| Tunneler (2) | reference | Tunnels aren't drawn on the map; the GM places them. |
| Undead Fortitude (2) | enforced | statblock-traits.ts rolls the Constitution save of DC 5 plus the damage when damage drops it to 0, and leaves it at 1 Hit Point on a success. Radiant damage and Critical Hits get no save. |
| Undead Restoration (1) | reference | Its return after death happens off the table; the GM runs it. |
| Vampire Weakness (2) | reference | Running water, invitations and the stake are the GM's to apply. |
| Vampiric Connection (1) | reference | Communication and senses like this are the GM's to run. |
| Vile Appearance (1) | enforced | trait-turns.ts opens the Wisdom save for each Beast or Humanoid that starts its turn within 30 feet of the hag. A failure is Frightened until the start of its next turn, and a success makes it immune for the fight. Whether the creature can see the hag's true form is the GM's, who dismisses the save when it can't. |
| Water Breathing (9) | reference | Breathing isn't tracked. |
| Water Form (1) | enforced | movement-rules.ts lets the elemental end a move in another creature's space. Fitting through a narrow gap is the GM's to allow. |
| Water Susceptibility (1) | reference | Water on the map isn't tracked, so the Cold damage is the GM's to deal. |
| Web Walker (5) | reference | Webs aren't marked on the map; the GM waives what they would cost it. |
| Wishes (2) | reference | The djinni's wishes are the GM's to run. |

## Barbarian features

**Enforced (19):** Ability Score Improvement · Barbarian Subclass · Brutal Strike · Danger Sense · Epic Boon · Extra Attack · Fast Movement · Feral Instinct · Improved Brutal Strike · Intimidating Presence (Path of the Berserker) · Mindless Rage (Path of the Berserker) · Persistent Rage · Primal Champion · Primal Knowledge · Rage · Reckless Attack · Retaliation (Path of the Berserker) · Unarmored Defense · Weapon Mastery

**Reference (4):** Frenzy (Path of the Berserker) · Indomitable Might · Instinctive Pounce · Relentless Rage

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Brutal Strike | enforced | After Reckless Attack, the tap forgoes the Advantage of the Barbarian's next Strength attack this turn (resolution/attack.ts), and its hit carries 1d10 of the weapon's type and one effect (resolution/hit-options.ts): Forceful Blow's 15-foot push and half Speed of movement, or Hamstring Blow's 15 feet less Speed, one at a time on a creature. |
| Improved Brutal Strike | enforced | Staggering Blow (Disadvantage on the next save and no Opportunity Attacks) and Sundering Blow (+5 to the next attack roll another creature makes against the target) join Brutal Strike's effects, and from Barbarian 17 a hit carries 2d10 and two effects (resolution/hit-options.ts, resolution/attack.ts). |
| Mindless Rage (Path of the Berserker) | enforced | Immunity to Charmed and Frightened while raging is applied (equipment-derivation.ts), and either condition ends as the Rage starts (resolution/grant.ts). |
| Persistent Rage | enforced | Taking the Persistent Rage action restores every expended use of Rage, once per Long Rest (resolution/rage.ts). A Rage under it lasts 10 minutes, and only Unconscious ends it early (effects.ts). |
| Primal Knowledge | enforced | The extra skill is applied. While raging, Acrobatics, Intimidation, Perception, Stealth and Survival checks are made as Strength checks when that is the better roll (ability-checks.ts). |

## Bard features

**Enforced (14):** Ability Score Improvement · Bard Subclass · Bonus Proficiencies (College of Lore) · Countercharm · Cutting Words (College of Lore) · Epic Boon · Expertise · Font of Inspiration · Jack of All Trades · Magical Discoveries (College of Lore) · Magical Secrets · Peerless Skill (College of Lore) · Spellcasting · Words of Creation

**Guided (1):** Bardic Inspiration

**Reference (1):** Superior Inspiration

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Bardic Inspiration | guided | The Bonus Action gives another creature the Bard's die, a d6 growing to a d12, one die at a time, and roll-answers.ts offers it when that creature fails an attack roll, a save, a check or a death save: the die is added and spent. Measuring the 60 feet, and ending an unused die after an hour, are the GM's. |
| Countercharm | enforced | roll-answers.ts asks the Bard by a reaction prompt when it or a creature within 30 feet fails a save against an effect that would make it Charmed or Frightened. The save waits, and using the Reaction rerolls it with Advantage. |
| Cutting Words (College of Lore) | enforced | roll-answers.ts asks the Bard by a reaction prompt when a creature it can see within 60 feet hits with an attack roll, succeeds on a check or rolls damage. Using it spends a Bardic Inspiration use and the Reaction and takes the die off the roll, which can turn the hit into a miss or lower the damage before it lands (damage-window.ts). |
| Jack of All Trades | enforced | ability-checks.ts adds half the Proficiency Bonus, rounded down, to a skill check the Bard isn't proficient in. |
| Peerless Skill (College of Lore) | enforced | roll-answers.ts offers it on the Bard's failed attack roll or check: the Bardic Inspiration die is added, and the use is kept when the roll still fails. |
| Spellcasting | enforced | character-build.ts gives the class its slots, cantrips and prepared spells, and each spell is a cast action at the class's spell save DC and attack bonus. resolution/economy.ts spends the slot, and rests.ts restores slots on a Long Rest. |
| Words of Creation | enforced | Power Word Heal and Power Word Kill are always prepared, and either may take a second creature within 10 feet of the first (resolution/action-targets.ts). |

## Cleric features

**Enforced (11):** Ability Score Improvement · Blessed Strikes · Channel Divinity · Cleric Subclass · Epic Boon · Life Domain Spells (Level 5) (Life Domain) · Life Domain Spells (Level 7) (Life Domain) · Life Domain Spells (Level 9) (Life Domain) · Life Domain Spells (Life Domain) · Preserve Life (Life Domain) · Spellcasting

**Guided (3):** Divine Intervention · Divine Order · Improved Blessed Strikes

**Reference (5):** Blessed Healer (Life Domain) · Disciple of Life (Life Domain) · Greater Divine Intervention · Sear Undead · Supreme Healing (Life Domain)

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Divine Order | guided | Protector's training and Thaumaturge's extra cantrip are applied. Thaumaturge's bonus to Arcana and Religion checks is the GM's. |
| Spellcasting | enforced | character-build.ts gives the class its slots, cantrips and prepared spells, and each spell is a cast action at the class's spell save DC and attack bonus. resolution/economy.ts spends the slot, and rests.ts restores slots on a Long Rest. |

## Druid features

**Enforced (13):** Ability Score Improvement · Circle of the Land Spells (Circle of the Land) · Circle of the Land Spells (Level 5) (Circle of the Land) · Circle of the Land Spells (Level 7) (Circle of the Land) · Circle of the Land Spells (Level 9) (Circle of the Land) · Druid Subclass · Druidic · Elemental Fury · Epic Boon · Nature's Ward (Circle of the Land) · Spellcasting · Wild Companion · Wild Shape

**Guided (4):** Improved Elemental Fury · Land's Aid (Circle of the Land) · Nature's Sanctuary (Circle of the Land) · Primal Order

**Reference (4):** Archdruid · Beast Spells · Natural Recovery (Circle of the Land) · Wild Resurgence

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Elemental Fury | enforced | Primal Strike's extra damage, of the type the Druid picks, is applied once a turn. Potent Spellcasting adds the Druid's Wisdom modifier to the damage of Poison Spray, Produce Flame and Starry Wisp. |
| Land's Aid (Circle of the Land) | guided | The save and its Necrotic damage against the Druid's spell save DC are applied, and a use of Wild Shape is spent. Healing the creature it picks is the GM's. |
| Primal Order | guided | Magician's extra cantrip and Warden's training are applied. The Wisdom bonus to the checks each role names is the GM's. |
| Spellcasting | enforced | character-build.ts gives the class its slots, cantrips and prepared spells, and each spell is a cast action at the class's spell save DC and attack bonus. resolution/economy.ts spends the slot, and rests.ts restores slots on a Long Rest. |

## Fighter features

**Enforced (17):** Ability Score Improvement · Action Surge · Additional Fighting Style (Champion) · Epic Boon · Extra Attack · Fighter Subclass · Fighting Style · Heroic Warrior (Champion) · Improved Critical (Champion) · Indomitable · Remarkable Athlete (Champion) · Second Wind · Superior Critical (Champion) · Tactical Mind · Three Extra Attacks · Two Extra Attacks · Weapon Mastery

**Reference (4):** Studied Attacks · Survivor (Champion) · Tactical Master · Tactical Shift

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Action Surge | enforced | resolution/economy.ts gives one more action on the Fighter's own turn, once a turn, and refuses it for the Magic action. |
| Heroic Warrior (Champion) | enforced | turn-boundaries.ts gives the Champion Heroic Inspiration at the start of its turn in a fight when it has none. |
| Indomitable | enforced | roll-answers.ts offers it on the Fighter's failed save: the save is rerolled with the Fighter level added, and the new roll stands. |
| Tactical Mind | enforced | roll-answers.ts offers it on the Fighter's failed check: a Second Wind use adds 1d10 to the check, and the use is kept when the check still fails. |

## Monk features

**Enforced (21):** Ability Score Improvement · Body and Mind · Deflect Energy · Disciplined Survivor · Epic Boon · Evasion · Extra Attack · Martial Arts · Monk Subclass · Monk's Focus · Open Hand Technique (Warrior of the Open Hand) · Quivering Palm (Warrior of the Open Hand) · Stunning Strike · Superior Defense · Unarmored Defense · Unarmored Movement (level 2) · Unarmored Movement (level 6) · Unarmored Movement (level 10) · Unarmored Movement (level 14) · Unarmored Movement (level 18) · Wholeness of Body (Warrior of the Open Hand)

**Guided (3):** Deflect Attacks · Heightened Focus · Uncanny Metabolism

**Reference (6):** Acrobatic Movement · Empowered Strikes · Fleet Step (Warrior of the Open Hand) · Perfect Focus · Self-Restoration · Slow Fall

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Deflect Attacks | guided | A hit whose damage includes Bludgeoning, Piercing or Slashing opens a reaction prompt (damage-window.ts), and using it takes 1d10 plus the Dexterity modifier and Monk level off the damage before it lands. Redirecting the attack's force for a Focus Point after reducing it to 0 is the GM's. |
| Deflect Energy | enforced | character-build.ts lets Deflect Attacks meet a hit of any damage type from Monk level 13 (damage-window.ts). |
| Evasion | enforced | saving-throws.ts takes no damage on a successful Dexterity save for half damage and half on a failure, while the creature isn't Incapacitated. |
| Heightened Focus | guided | Flurry of Blows makes three strikes from Monk level 10 (Monk's Focus carries it). The Temporary Hit Points from Patient Defense and the creature carried by Step of the Wind are the GM's. |
| Martial Arts | enforced | builtin-actions.ts offers an Unarmed Strike as a Bonus Action, and resolution/attack.ts rolls Unarmed Strikes and Monk weapons with the Martial Arts die and the better of Strength and Dexterity. |
| Open Hand Technique (Warrior of the Open Hand) | enforced | A Flurry of Blows hit carries Addle, Push or Topple (resolution/hit-options.ts): no Opportunity Attacks until the target's next turn, a Strength save against a 15-foot push, or a Dexterity save against Prone. |
| Quivering Palm (Warrior of the Open Hand) | enforced | An Unarmed Strike's hit can spend 4 Focus Points to set the vibrations on its target, one creature at a time (resolution/hit-rider-outcomes.ts). The ending action targets only that creature: a Constitution save for 10d12 Force, half on a success. The days they last are the GM's. |
| Stunning Strike | enforced | It rides a hit with a Monk weapon or an Unarmed Strike (resolution/hit-options.ts), never tapped alone: a target that fails its Constitution save against the Monk's DC is Stunned until the start of the Monk's next turn, once a turn for a Focus Point. On a success resolution/pending.ts halves its Speed until then (speed.ts), and the next attack roll against it before then has Advantage and spends it (resolution/attack.ts). |

## Paladin features

**Enforced (22):** Ability Score Improvement · Aura Expansion · Aura of Courage · Aura of Devotion (Oath of Devotion) · Aura of Protection · Epic Boon · Extra Attack · Faithful Steed · Fighting Style · Holy Nimbus (Oath of Devotion) · Lay On Hands · Oath of Devotion Spells (Level 5) (Oath of Devotion) · Oath of Devotion Spells (Level 9) (Oath of Devotion) · Oath of Devotion Spells (Level 13) (Oath of Devotion) · Oath of Devotion Spells (Level 17) (Oath of Devotion) · Oath of Devotion Spells (Oath of Devotion) · Paladin Subclass · Paladin's Smite · Radiant Strikes · Smite of Protection (Oath of Devotion) · Spellcasting · Weapon Mastery

**Guided (3):** Abjure Foes · Channel Divinity · Sacred Weapon (Oath of Devotion)

**Reference (1):** Restoring Touch

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Abjure Foes | guided | The Wisdom save against the Paladin's spell save DC, its Frightened and the Channel Divinity use are applied, on up to the Charisma modifier's number of creatures it can see within 60 feet (resolution/action-targets.ts). resolution/economy.ts holds the frightened creature to one of an action or a Bonus Action on its turn; a move after acting is the GM's. |
| Aura Expansion | enforced | saving-throws.ts widens Aura of Protection to 30 feet. |
| Aura of Courage | enforced | paladin-auras.ts makes the Paladin and its allies in its Aura of Protection immune to Frightened while it isn't Incapacitated, and an ally already Frightened has no Disadvantage from it there (resolution/attack.ts, check-rolls.ts). |
| Aura of Devotion (Oath of Devotion) | enforced | paladin-auras.ts makes the Paladin and its allies in its Aura of Protection immune to Charmed while it isn't Incapacitated, and an ally already Charmed may target its charmer while there (resolution/economy.ts). |
| Aura of Protection | enforced | saving-throws.ts adds the Paladin's Charisma modifier, at least 1, to its own saves and its allies' within 10 feet, while it isn't Incapacitated. A creature in two auras gets the better one. |
| Holy Nimbus (Oath of Devotion) | enforced | The Bonus Action puts Holy Nimbus on the Paladin for 10 minutes. turn-boundaries.ts deals its Radiant damage to an enemy that starts its turn in the aura, and saving-throws.ts gives the Paladin Advantage on saves a Fiend or an Undead forces. The sunlight is the GM's, since the map has no light. |
| Lay On Hands | enforced | The Bonus Action spends the points the Paladin picks to heal one creature it touches, within 5 feet (resolution/action-targets.ts), or 5 points to end Poisoned. |
| Smite of Protection (Oath of Devotion) | enforced | resolution/hit-options.ts marks the Paladin when Divine Smite rides a hit, and until its next turn the creatures in its aura have Half Cover against attacks and on Dexterity saves (resolution/validate.ts, resolution/pending.ts). |
| Spellcasting | enforced | character-build.ts gives the class its slots, cantrips and prepared spells, and each spell is a cast action at the class's spell save DC and attack bonus. resolution/economy.ts spends the slot, and rests.ts restores slots on a Long Rest. |

## Ranger features

**Enforced (15):** Ability Score Improvement · Defensive Tactics (Hunter) · Deft Explorer · Epic Boon · Expertise · Extra Attack · Favored Enemy · Fighting Style · Nature's Veil · Ranger Subclass · Roving · Spellcasting · Superior Hunter's Defense (Hunter) · Tireless · Weapon Mastery

**Guided (2):** Hunter's Prey (Hunter) · Superior Hunter's Prey (Hunter)

**Reference (5):** Feral Senses · Foe Slayer · Hunter's Lore (Hunter) · Precise Hunter · Relentless Hunter

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Spellcasting | enforced | character-build.ts gives the class its slots, cantrips and prepared spells, and each spell is a cast action at the class's spell save DC and attack bonus. resolution/economy.ts spends the slot, and rests.ts restores slots on a Long Rest. |
| Superior Hunter's Defense (Hunter) | enforced | damage-window.ts offers it when the Ranger is about to take damage from a hit or a failed save. Using it gives Resistance to the damage's largest type, that damage included, until the end of the current turn. |
| Superior Hunter's Prey (Hunter) | guided | The tap deals the mark's 1d6 Force (1d10 from Foe Slayer) to one other creature the Ranger can see, once a turn. That the marked creature took the Ranger's damage this turn, and the 30 feet from it, are the GM's. |

## Rogue features

**Enforced (17):** Ability Score Improvement · Cunning Action · Cunning Strike · Devious Strikes · Epic Boon · Evasion · Expertise · Improved Cunning Strike · Reliable Talent · Rogue Subclass · Slippery Mind · Sneak Attack · Steady Aim · Stroke of Luck · Thieves' Cant · Uncanny Dodge · Weapon Mastery

**Guided (3):** Fast Hands (Thief) · Supreme Sneak (Thief) · Use Magic Device (Thief)

**Reference (3):** Elusive · Second-Story Work (Thief) · Thief's Reflexes (Thief)

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Cunning Action | enforced | builtin-actions.ts offers Dash, Disengage and Hide as Bonus Actions, and each resolves as its action does. |
| Cunning Strike | enforced | Sneak Attack's hit can trade dice for Poison (with a Poisoner's Kit), Trip or Withdraw, with saves against 8 + Dexterity + Proficiency Bonus (resolution/hit-options.ts). |
| Devious Strikes | enforced | Daze (one of moving, an action or a Bonus Action, resolution/economy.ts), Knock Out (Unconscious that ends on damage, with repeat saves) and Obscure (Blinded) join Cunning Strike's effects. A Dazed creature's move after acting is the GM's. |
| Evasion | enforced | saving-throws.ts takes no damage on a successful Dexterity save for half damage and half on a failure, while the creature isn't Incapacitated. |
| Improved Cunning Strike | enforced | A Sneak Attack hit carries two Cunning Strike effects (resolution/hit-options.ts). |
| Reliable Talent | enforced | ability-checks.ts treats a d20 of 9 or lower as a 10 on a check with a skill or tool the Rogue is proficient in. |
| Stroke of Luck | enforced | roll-answers.ts offers it on the Rogue's failed D20 Test: the d20 becomes a 20, which makes an attack roll a Critical Hit, and the use returns on a Short or Long Rest. |
| Supreme Sneak (Thief) | guided | Stealth Attack joins Cunning Strike's effects, and the attack leaves the Rogue's Invisible from the Hide action on (resolution/release.ts). Whether it ends the turn behind Three-Quarters or Total Cover is the GM's, said with the hit. |
| Use Magic Device (Thief) | guided | The fourth attuned item is applied (inventory.ts). The roll to save a charge, and reading any Spell Scroll, are the GM's. |

## Sorcerer features

**Enforced (15):** Ability Score Improvement · Arcane Apotheosis · Draconic Resilience (Draconic Sorcery) · Draconic Spells (Draconic Sorcery) · Draconic Spells (Level 5) (Draconic Sorcery) · Draconic Spells (Level 7) (Draconic Sorcery) · Draconic Spells (Level 9) (Draconic Sorcery) · Dragon Companion (Draconic Sorcery) · Dragon Wings (Draconic Sorcery) · Elemental Affinity (Draconic Sorcery) · Epic Boon · Innate Sorcery · Metamagic · Sorcerer Subclass · Spellcasting

**Guided (3):** Font of Magic · Sorcerous Restoration · Sorcery Incarnate

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Arcane Apotheosis | enforced | While Innate Sorcery is active, the first Metamagic option on each of the Sorcerer's turns in a fight costs no Sorcery Points (resolution/metamagic.ts). |
| Metamagic | enforced | A cast carries one Metamagic option the Sorcerer knows, paid in Sorcery Points and applied by the server (resolution/metamagic.ts, resolution/economy.ts). Empowered Spell can join another option, and Seeking Spell is offered when a spell attack misses (roll-answers.ts). The server refuses an option the spell can't take, and picks the dice Empowered Spell rerolls. Careful Spell covers the save the cast itself calls for (resolution/pending.ts). |
| Sorcery Incarnate | guided | While Innate Sorcery is active, a cast may carry two Metamagic options (resolution/metamagic.ts). Activating Innate Sorcery for 2 Sorcery Points once its uses are spent is the GM's. |
| Spellcasting | enforced | character-build.ts gives the class its slots, cantrips and prepared spells, and each spell is a cast action at the class's spell save DC and attack bonus. resolution/economy.ts spends the slot, and rests.ts restores slots on a Long Rest. |

## Warlock features

**Enforced (15):** Ability Score Improvement · Contact Patron · Dark One's Own Luck (Fiend Patron) · Epic Boon · Fiend Spells (Fiend Patron) · Fiend Spells (Level 5) (Fiend Patron) · Fiend Spells (Level 7) (Fiend Patron) · Fiend Spells (Level 9) (Fiend Patron) · Fiendish Resilience (Fiend Patron) · Mystic Arcanum (level 6 spell) · Mystic Arcanum (level 7 spell) · Mystic Arcanum (level 8 spell) · Mystic Arcanum (level 9 spell) · Pact Magic · Warlock Subclass

**Guided (3):** Eldritch Invocations · Hurl Through Hell (Fiend Patron) · Magical Cunning

**Reference (2):** Dark One's Blessing (Fiend Patron) · Eldritch Master

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Dark One's Own Luck (Fiend Patron) | enforced | roll-answers.ts offers it on the Warlock's check or save once the roll is seen: 1d10 is added, and a use is spent. |
| Eldritch Invocations | guided | Agonizing Blast's damage, Eldritch Spear's range on a spell attack, Repelling Blast's push (resolution/masteries.ts), Eldritch Mind's Advantage and the free casts are applied. Eldritch Smite's Pact Magic slot dice and Prone, and Lifedrinker's damage and Hit Point Die, ride a pact weapon's hit (resolution/hit-options.ts). The senses (Devil's Sight, Witch Sight), Lessons of the First Ones, Gaze of Two Minds, Gift of the Protectors and Investment of the Chain Master are the GM's. |
| Hurl Through Hell (Fiend Patron) | guided | It rides an attack roll's hit once a Long Rest: the Charisma save, 8d10 Psychic unless the target is a Fiend, and Incapacitated with nothing able to target it until the end of the Warlock's next turn (resolution/action-targets.ts). Its return to its space, or the nearest, is the GM's. |
| Pact Magic | enforced | character-build.ts gives the Warlock its Pact Magic slots at the level its table prints, and resolution/economy.ts spends them. rests.ts restores them on a Short or Long Rest. |

## Wizard features

**Enforced (9):** Ability Score Improvement · Epic Boon · Evocation Savant (Evoker) · Scholar · Sculpt Spells (Evoker) · Signature Spells · Spell Mastery · Spellcasting · Wizard Subclass

**Guided (2):** Arcane Recovery · Overchannel (Evoker)

**Reference (4):** Empowered Evocation (Evoker) · Memorize Spell · Potent Cantrip (Evoker) · Ritual Adept

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Sculpt Spells (Evoker) | enforced | An Evoker's Evocation spell protects up to 1 plus the spell's level creatures the Wizard can see: they succeed on its save with no roll and take no damage (resolution/pending.ts). Saves its area calls for later are rolled as usual. |
| Spellcasting | enforced | character-build.ts gives the class its slots, cantrips and prepared spells, and each spell is a cast action at the class's spell save DC and attack bonus. resolution/economy.ts spends the slot, and rests.ts restores slots on a Long Rest. |

## Species traits

**Enforced (63):** Abyssal Legacy (Abyssal) · Adrenaline Rush (Orc) · Arcane Cantrip (High Elf) · Brave (Halfling) · Breath Weapon (Acid) (Black Dragon) · Breath Weapon (Acid) (Copper Dragon) · Breath Weapon (Cold) (Silver Dragon) · Breath Weapon (Cold) (White Dragon) · Breath Weapon (Dragonborn) · Breath Weapon (Fire) (Brass Dragon) · Breath Weapon (Fire) (Gold Dragon) · Breath Weapon (Fire) (Red Dragon) · Breath Weapon (Lightning) (Blue Dragon) · Breath Weapon (Lightning) (Bronze Dragon) · Breath Weapon (Poison) (Green Dragon) · Chthonic Legacy (Chthonic) · Damage Resistance (Acid) (Black Dragon) · Damage Resistance (Acid) (Copper Dragon) · Damage Resistance (Cold) (Silver Dragon) · Damage Resistance (Cold) (White Dragon) · Damage Resistance (Dragonborn) · Damage Resistance (Fire) (Brass Dragon) · Damage Resistance (Fire) (Gold Dragon) · Damage Resistance (Fire) (Red Dragon) · Damage Resistance (Lightning) (Blue Dragon) · Damage Resistance (Lightning) (Bronze Dragon) · Damage Resistance (Poison) (Green Dragon) · Dancing Lights (Drow) · Darkness (Drow) · Darkness (Infernal) · Detect Magic (High Elf) · Draconic Ancestry (Dragonborn) · Draconic Flight (Dragonborn) · Druidcraft (Wood Elf) · Dwarven Resilience (Dwarf) · Dwarven Toughness (Dwarf) · Elven Lineage (Elf) · Faerie Fire (Drow) · False Life (Chthonic) · Fey Ancestry (Elf) · Fiendish Legacy (Tiefling) · Fleet of Foot (Wood Elf) · Gnomish Cunning (Gnome) · Gnomish Lineage (Gnome) · Hellish Rebuke (Infernal) · Hold Person (Abyssal) · Infernal Legacy (Infernal) · Keen Senses (Elf) · Longstrider (Wood Elf) · Luck (Halfling) · Minor Illusion (Forest Gnome) · Misty Step (High Elf) · Otherworldly Presence (Tiefling) · Pass without Trace (Wood Elf) · Powerful Build (Goliath) · Ray of Enfeeblement (Chthonic) · Ray of Sickness (Abyssal) · Relentless Endurance (Orc) · Resourceful (Human) · Rock Gnome Cantrips (Rock Gnome) · Skillful (Human) · Speak with Animals (Forest Gnome) · Versatile (Human)

**Guided (3):** Giant Ancestry (Goliath) · Large Form (Goliath) · Stonecunning (Dwarf)

**Reference (11):** Clockwork Devices (Rock Gnome) · Darkvision (Dragonborn) · Darkvision (Dwarf) · Darkvision (Elf) · Darkvision (Gnome) · Darkvision (Orc) · Darkvision (Tiefling) · Halfling Nimbleness (Halfling) · Naturally Stealthy (Halfling) · Superior Darkvision (Drow) · Trance (Elf)

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Breath Weapon (Dragonborn) | enforced | The ancestry's own Breath Weapon row carries the save, the area and the damage, and resolution/economy.ts takes it in place of an attack. |
| Damage Resistance (Dragonborn) | enforced | The ancestry's own Damage Resistance row grants the Resistance, which hit-points.ts applies. |
| Giant Ancestry (Goliath) | guided | Fire's Burn, Frost's Chill and Hill's Tumble ride a hit that deals damage (resolution/hit-options.ts), Storm's Thunder is offered as a Reaction, and Stone's Endurance as a Reaction to damage from a hit or a failed save, taking 1d12 plus the Constitution modifier off it before it lands (damage-window.ts). Cloud's Jaunt's teleport is the GM's. |
| Large Form (Goliath) | guided | The Bonus Action gives +10 feet of Speed and Advantage on Strength checks for 10 minutes. Becoming Large on the map, and whether the space is big enough, are the GM's. |
| Luck (Halfling) | enforced | roll-answers.ts offers a reroll when the d20 of the Halfling's attack roll, check, save or death save shows a 1, and the new roll stands. |
| Powerful Build (Goliath) | enforced | The escape from a grapple rolls with Advantage (resolution/builtins.ts). The app doesn't track carrying capacity, so counting one size larger for it is the GM's. |
| Relentless Endurance (Orc) | enforced | hit-points.ts holds an Orc reduced to 0 Hit Points, but not killed outright, at 1 Hit Point instead, once a Long Rest. It is taken the first time it can be. |
| Resourceful (Human) | enforced | rests.ts gives a Human Heroic Inspiration when it finishes a Long Rest. |

## Backgrounds

**Enforced (4):** Acolyte · Criminal · Sage · Soldier

## Feats

**Enforced (12):** Ability Score Improvement · Alert · Archery · Boon of Combat Prowess · Boon of Fate · Defense · Magic Initiate (Cleric) · Magic Initiate (Druid) · Magic Initiate (Wizard) · Savage Attacker · Skilled · Two-Weapon Fighting

**Guided (6):** Boon of Dimensional Travel · Boon of Irresistible Offense · Boon of Spell Recall · Boon of the Night Spirit · Boon of Truesight · Grappler

**Reference (1):** Great Weapon Fighting

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Boon of Combat Prowess | enforced | The ability score increase is applied, and roll-answers.ts offers Peerless Aim on a missed attack roll: the attack hits, and the boon waits for the start of the creature's next turn. |
| Boon of Dimensional Travel | guided | The ability score increase is applied. The teleport of Blink Steps is the GM's to move. |
| Boon of Fate | enforced | The ability score increase is applied. roll-answers.ts offers Improve Fate on the holder's own D20 Test, and asks by a prompt about another creature's within 60 feet: 2d4 is added or taken off, and the use returns when Initiative is rolled or on a rest. |
| Boon of Irresistible Offense | guided | The ability score increase is applied. Overcoming Resistance, and the extra damage on a 20, are the GM's. |
| Boon of Spell Recall | guided | The ability score increase is applied. Casting a spell without spending its slot is the GM's. |
| Boon of the Night Spirit | guided | The ability score increase is applied. Merging with shadows, and Resistance in Dim Light or Darkness, are the GM's. |
| Boon of Truesight | guided | The ability score increase is applied. Truesight on a character sheet isn't read in play, so the GM applies it. |
| Grappler | guided | The ability score increase is applied. Punch and Grab, Attack Advantage and Fast Wrestler are the GM's. |
| Savage Attacker | enforced | resolution/hit-options.ts offers it on a weapon hit once a turn. Chosen, resolution/damage.ts rolls the weapon's damage dice twice and uses the higher roll. |
| Two-Weapon Fighting | enforced | equipment-derivation.ts adds the ability modifier to the damage of the Light property's extra attack. |

## Magic items

**Enforced (54):** Ammunition, +1 · Ammunition, +2 · Ammunition, +3 · Armor of Resistance · Armor of Vulnerability · Armor, +1 · Armor, +2 · Armor, +3 · Boots of Elvenkind · Boots of the Winterlands · Bracers of Defense · Cloak of Elvenkind · Cloak of Protection · Dagger of Venom · Decanter of Endless Water · Dragon Slayer · Elven Chain · Eyes of Charming · Flame Tongue · Frost Brand · Giant Slayer · Glamoured Studded Leather · Gloves of Missile Snaring · Gloves of Thievery · Mithral Armor · Periapt of Proof against Poison · Potion of Flying · Potion of Healing (greater) · Potion of Healing (superior) · Potion of Healing (supreme) · Ring of Animal Influence · Ring of Evasion · Ring of Protection · Ring of Resistance · Ring of Swimming · Rod of Rulership · Sentinel Shield · Shield of the Cavalier · Shield, +1 · Shield, +2 · Shield, +3 · Slippers of Spider Climbing · Spell Scroll · Staff of Striking · Staff of Thunder and Lightning · Staff of Withering · Stone of Good Luck (Luckstone) · Sword of Wounding · Vicious Weapon · Wand of Paralysis · Weapon, +1 · Weapon, +2 · Weapon, +3 · Winged Boots

**Guided (139):** Adamantine Armor · Ammunition of Slaying · Amulet of Health · Amulet of Proof against Detection and Location · Amulet of the Planes · Animated Shield · Armor of Invulnerability · Arrow-Catching Shield · Bag of Tricks · Belt of Dwarvenkind · Belt of Giant Strength · Berserker Axe · Boots of Levitation · Boots of Speed · Boots of Striding and Springing · Bowl of Commanding Water Elementals · Bracers of Archery · Brazier of Commanding Fire Elementals · Brooch of Shielding · Broom of Flying · Candle of Invocation · Censer of Controlling Air Elementals · Cloak of Arachnida · Cloak of Displacement · Cloak of Invisibility · Cloak of the Bat · Cloak of the Manta Ray · Crystal Ball · Crystal Ball of Mind Reading · Crystal Ball of Telepathy · Crystal Ball of True Seeing · Cube of Force · Cubic Gate · Dancing Sword · Defender · Demon Armor · Dragon Orb · Dragon Scale Mail · Dwarven Plate · Dwarven Thrower · Energy Bow · Gauntlets of Ogre Power · Gem of Seeing · Gloves of Swimming and Climbing · Hammer of Thunderbolts · Hat of Disguise · Hat of Many Spells · Headband of Intellect · Helm of Brilliance · Helm of Comprehending Languages · Helm of Telepathy · Helm of Teleportation · Holy Avenger · Instant Fortress · Ioun Stone · Iron Bands · Iron Flask · Javelin of Lightning · Luck Blade · Mace of Disruption · Mace of Smiting · Mace of Terror · Mantle of Spell Resistance · Medallion of Thoughts · Necklace of Adaptation · Necklace of Prayer Beads · Nine Lives Stealer · Oathbow · Pearl of Power · Periapt of Health · Periapt of Wound Closure · Pipes of Haunting · Pipes of the Sewers · Plate Armor of Etherealness · Quarterstaff of the Acrobat · Ring of Djinni Summoning · Ring of Elemental Command · Ring of Feather Falling · Ring of Free Action · Ring of Invisibility · Ring of Jumping · Ring of Mind Shielding · Ring of Regeneration · Ring of Shooting Stars · Ring of Spell Storing · Ring of Spell Turning · Ring of Telekinesis · Ring of the Ram · Ring of Warmth · Ring of Water Walking · Ring of X-ray Vision · Robe of Eyes · Robe of Scintillating Colors · Robe of Stars · Robe of the Archmagi · Rod of Absorption · Rod of Alertness · Rod of Lordly Might · Rod of Resurrection · Rope of Entanglement · Scarab of Protection · Scimitar of Speed · Sending Stones · Shield of Missile Attraction · Spellguard Shield · Staff of Charming · Staff of Fire · Staff of Frost · Staff of Healing · Staff of Power · Staff of Swarming Insects · Staff of the Magi · Staff of the Python · Staff of the Woodlands · Stone of Controlling Earth Elementals · Sun Blade · Sword of Life Stealing · Sword of Sharpness · Talisman of Pure Good · Talisman of the Sphere · Talisman of Ultimate Evil · Thunderous Greatclub · Trident of Fish Command · Vorpal Sword · Wand of Binding · Wand of Enemy Detection · Wand of Fear · Wand of Fireballs · Wand of Lightning Bolts · Wand of Magic Detection · Wand of Polymorph · Wand of Secrets · Wand of the War Mage, +1 · Wand of the War Mage, +2 · Wand of the War Mage, +3 · Wand of Web · Wand of Wonder · Weapon of Warning · Wings of Flying

**Reference (77):** Apparatus of the Crab · Bag of Beans · Bag of Devouring · Bag of Holding · Bead of Force · Bead of Nourishment · Cape of the Mountebank · Carpet of Flying · Chime of Opening · Circlet of Blasting · Deck of Illusions · Dimensional Shackles · Dust of Disappearance · Dust of Dryness · Dust of Sneezing and Choking · Efficient Quiver · Efreeti Bottle · Elemental Gem · Elixir of Health · Eversmoking Bottle · Eyes of Minute Seeing · Eyes of the Eagle · Feather Token · Figurine of Wondrous Power · Folding Boat · Gem of Brightness · Goggles of Night · Handy Haversack · Horn of Blasting · Horn of Valhalla · Horseshoes of a Zephyr · Horseshoes of Speed · Immovable Rod · Lantern of Revealing · Manual of Bodily Health · Manual of Gainful Exercise · Manual of Golems · Manual of Quickness of Action · Marvelous Pigments · Mirror of Life Trapping · Mysterious Deck · Necklace of Fireballs · Oil of Etherealness · Oil of Sharpness · Oil of Slipperiness · Philter of Love · Portable Hole · Potion of Animal Friendship · Potion of Clairvoyance · Potion of Climbing · Potion of Diminution · Potion of Gaseous Form · Potion of Giant Strength · Potion of Growth · Potion of Heroism · Potion of Invisibility · Potion of Invulnerability · Potion of Longevity · Potion of Mind Reading · Potion of Poison · Potion of Resistance · Potion of Speed · Potion of Vitality · Potion of Water Breathing · Ring of Three Wishes · Robe of Useful Items · Rod of Security · Rope of Climbing · Sovereign Glue · Sphere of Annihilation · Tome of Clear Thought · Tome of Leadership and Influence · Tome of Understanding · Universal Solvent · Wand of Magic Missiles · Well of Many Worlds · Wind Fan

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Armor of Invulnerability | guided | Resistance to Bludgeoning, Piercing and Slashing damage is applied. The once-a-day Immunity to them is the GM's. |
| Berserker Axe | guided | The +1 to attack and damage rolls and the curse's lock on Attunement are applied. The extra Hit Points and the curse's save are the GM's. |
| Bracers of Archery | guided | Proficiency with the Longbow and Shortbow is applied. The +2 damage with them is the GM's. |
| Brooch of Shielding | guided | Resistance to Force damage is applied. Immunity to Magic Missile is the GM's. |
| Cloak of Arachnida | guided | Resistance to Poison damage is applied. Climbing like a spider, and the Web cast, are the GM's. |
| Cloak of the Bat | guided | Advantage on Dexterity (Stealth) checks is applied. The Fly Speed in darkness and the Polymorph cast are the GM's. |
| Dagger of Venom | enforced | The +1 to attack and damage rolls is applied. Coating the blade is a Bonus Action once a day, and the dagger's next hit spends it on a DC 15 Constitution save against 2d10 Poison and Poisoned for 1 minute (resolution/on-hit.ts). |
| Defender | guided | The +3 to attack and damage rolls is applied. Moving the bonus to AC is the GM's. |
| Demon Armor | guided | The +1 AC and the curse's lock on Attunement are applied. The clawed Unarmed Strikes and the Disadvantage against demons are the GM's. |
| Dragon Scale Mail | guided | The +1 AC and the Resistance to one type are applied. Advantage on saves against a dragon's breath, and sensing dragons, are the GM's. |
| Dwarven Plate | guided | The +2 AC is applied. The Reaction against forced movement is the GM's. |
| Dwarven Thrower | guided | The +3 to attack and damage rolls is applied. Throwing it, its return and the extra damage against Giants are the GM's. |
| Giant Slayer | enforced | The +1 to attack and damage rolls and the extra 2d6 against Giants are applied, and a hit on a Giant opens its DC 15 Strength save against Prone (resolution/on-hit.ts). |
| Gloves of Missile Snaring | enforced | A hit by a weapon from range opens a reaction prompt (damage-window.ts), and using it takes 1d10 plus the wearer's Dexterity modifier off the damage. Whether a hand is free, and catching the missile, are the GM's. |
| Hammer of Thunderbolts | guided | The +1 to attack and damage rolls is applied. Its thrown thunderclap and its powers against Giants are the GM's. |
| Helm of Telepathy | guided | Its Detect Thoughts and Suggestion casts are cast actions. The telepathy itself is the GM's. |
| Holy Avenger | guided | The +3 to attack and damage rolls and the extra 2d10 Radiant against Fiends and Undead are applied. The aura's Advantage on saves against spells for its wielder's allies is the GM's. |
| Iron Bands | guided | The throw's attack roll is applied. Restraining the target on a hit, and the check to break free, are the GM's. |
| Iron Flask | guided | The command's save is applied. Trapping the creature in the flask is the GM's. |
| Luck Blade | guided | The +1 to attack and damage rolls and saving throws is applied, and roll-answers.ts offers its Luck reroll on a failed D20 Test once a day while the wielder isn't Incapacitated. Its Wish is the GM's. |
| Mace of Disruption | guided | The extra 2d6 Radiant against Fiends and Undead is applied. The save against destruction at 25 Hit Points or fewer, and the Frightened condition a success leaves, are the GM's. |
| Mace of Smiting | guided | The +1 to attack and damage rolls, +3 against Constructs, and the 7 Bludgeoning on a rolled 20 (14 against a Construct) are applied. Destroying a Construct left at 25 Hit Points or fewer is the GM's, said with the hit. |
| Nine Lives Stealer | guided | The +2 to attack and damage rolls is applied. Life Stealing on a Critical Hit is the GM's. |
| Pipes of Haunting | guided | The save against Frightened, with its repeat at the end of each turn, is applied. The immunity after a success is the GM's. |
| Quarterstaff of the Acrobat | guided | The +2 to attack and damage rolls is applied, and Attack Deflection is offered once a rest when a hit would land, adding 5 to AC against it (resolution/pending.ts). Its forms, its throw and Acrobatic Assist are the GM's. |
| Ring of Shooting Stars | guided | Its at-will cantrips and the one-charge Shooting Stars are applied. Faerie Fire, the Lightning Spheres and the larger Shooting Stars are the GM's. |
| Robe of Scintillating Colors | guided | The save against Stunned is applied. The light, the Disadvantage on attacks against the wearer and ending the stun are the GM's. |
| Robe of Stars | guided | The +1 to saving throws is applied. The Magic Missile stars and the trip to the Astral Plane are the GM's. |
| Rod of Alertness | guided | Advantage on Initiative and Wisdom (Perception) checks, and its detection casts, are applied. The Protective Aura's benefit to allies is the GM's. |
| Rod of Lordly Might | guided | It swings as a +3 Mace. Drain Life and Paralyze ride a melee hit and Terrify is an action, each once a day. The buttons' other forms, and Drain Life's healing, are the GM's. |
| Rope of Entanglement | guided | The save against Restrained is applied. The check to escape the rope is the GM's. |
| Scarab of Protection | guided | The +1 AC is applied. Advantage on saves against spells, and its Preservation, are the GM's. |
| Scimitar of Speed | guided | The +2 to attack and damage rolls is applied. The extra attack as a Bonus Action is the GM's. |
| Spellguard Shield | guided | Spell attack rolls against its holder have Disadvantage (resolution/attack.ts). Advantage on saves against spells and other magical effects is the GM's. |
| Staff of Charming | guided | Its one-charge casts are cast actions, and roll-answers.ts offers to turn a failed save against an Enchantment spell aimed only at the holder into a success once a day. Turning the spell back on its caster is the GM's. |
| Staff of Fire | guided | Resistance to Fire damage and its one-charge Burning Hands are applied. Fireball and Wall of Fire, which cost more charges, are the GM's. |
| Staff of Frost | guided | Resistance to Cold damage and its one-charge Fog Cloud are applied. The spells that cost more charges are the GM's. |
| Staff of Power | guided | It swings as a +2 Quarterstaff, and the +2 to AC, saving throws and spell attack rolls is applied. Its spells and its Retributive Strike are the GM's. |
| Staff of Striking | enforced | It swings as a +3 Quarterstaff, and a melee hit can spend 1, 2 or 3 of its 10 charges for 1d6 Force each (resolution/hit-options.ts). |
| Staff of the Magi | guided | It swings as a +2 Quarterstaff, and its four casts that cost no charge and the +2 to spell attack rolls are applied. The spells that cost charges, Spell Absorption and Retributive Strike are the GM's. |
| Staff of the Woodlands | guided | It swings as a +2 Quarterstaff, its one-charge casts are cast actions, Tree Form's use is counted, and the +2 to spell attack rolls is applied. The spells that cost more charges are the GM's. |
| Staff of Thunder and Lightning | enforced | It swings as a +2 Quarterstaff. Lightning and Thunder ride a melee hit, Thunder and Lightning does both as a Bonus Action (resolution/hit-options.ts), and Lightning Strike and Thunderclap are actions, each once a day. |
| Staff of Withering | enforced | It swings as a Quarterstaff, and a hit can spend a charge for 2d10 Necrotic and a DC 15 Constitution save against Disadvantage on Strength and Constitution checks and saves (resolution/hit-options.ts). The hour it lasts is the GM's. |
| Sun Blade | guided | It swings as a +2 Finesse Longsword that deals Radiant damage, with 1d8 Radiant more against an Undead. The Bonus Action that makes the blade appear, and its sunlight, are the GM's. |
| Sword of Sharpness | guided | A rolled 20 against a creature adds 14 Slashing damage and a level of Exhaustion (resolution/damage.ts, resolution/on-hit.ts). Maximized damage against an object is the GM's. |
| Sword of Wounding | enforced | The extra Necrotic damage is applied, and a hit opens a DC 15 Constitution save whose failure stops the target regaining Hit Points until it succeeds on the save it repeats at the end of each of its turns (resolution/on-hit.ts). |
| Talisman of Pure Good | guided | The +2 to spell attack rolls is applied. The 8d6 Radiant it deals a Fiend or an Undead that touches it, and Pure Rebuke's fissure on its charges, are the GM's. |
| Talisman of Ultimate Evil | guided | The +2 to spell attack rolls is applied. The 8d6 Necrotic it deals a creature other than a Fiend or an Undead that touches it, and Ultimate End's fissure on its charges, are the GM's. |
| Vorpal Sword | guided | The +3 to attack and damage rolls is applied. Ignoring Resistance to Slashing damage, and the head it takes on a rolled 20, are the GM's, said with the hit. |
| Wand of Fireballs | guided | Fireball at DC 15 on its charges is applied. Spending more charges for a higher-level Fireball is the GM's. |
| Wand of Lightning Bolts | guided | Lightning Bolt at DC 15 on its charges is applied. Spending more charges for a higher-level Lightning Bolt is the GM's. |
| Wand of the War Mage, +1 | guided | The +1 to spell attack rolls is applied. Ignoring Half Cover on a spell attack is the GM's, who sets the cover. |
| Wand of the War Mage, +2 | guided | The +2 to spell attack rolls is applied. Ignoring Half Cover on a spell attack is the GM's, who sets the cover. |
| Wand of the War Mage, +3 | guided | The +3 to spell attack rolls is applied. Ignoring Half Cover on a spell attack is the GM's, who sets the cover. |
| Weapon of Warning | guided | Advantage on Initiative for its wielder is applied. The same for allies within 30 feet, and waking them, are the GM's. |

## Gear and tools

**Enforced (16):** Acid (vial) · Alchemist's Fire (flask) · Antitoxin (vial) · Arrows (20) · Blowgun Needles (50) · Crossbow Bolts (20) · Firearm Bullets (10) · Healer's Kit · Holy Water (flask) · Net · Oil (flask) · Poison, Basic (vial) · Potion of Healing · Sling Bullets (20) · Spell Scroll (Cantrip) · Spell Scroll (Level 1)

**Guided (37):** Alchemist's Supplies · Brewer's Supplies · Calligrapher's Supplies · Carpenter's Tools · Cartographer's Tools · Cobbler's Tools · Cook's Utensils · Disguise Kit · Forgery Kit · Gaming Set (Dice) · Gaming Set (Dragonchess) · Gaming Set (Playing Cards) · Gaming Set (Three-Dragon Ante) · Glassblower's Tools · Herbalism Kit · Jeweler's Tools · Leatherworker's Tools · Mason's Tools · Musical Instrument (Bagpipes) · Musical Instrument (Drum) · Musical Instrument (Dulcimer) · Musical Instrument (Flute) · Musical Instrument (Horn) · Musical Instrument (Lute) · Musical Instrument (Lyre) · Musical Instrument (Pan Flute) · Musical Instrument (Shawm) · Musical Instrument (Viol) · Navigator's Tools · Painter's Supplies · Poisoner's Kit · Potter's Tools · Smith's Tools · Thieves' Tools · Tinker's Tools · Weaver's Tools · Woodcarver's Tools

**Reference (88):** Arcane Focus (Crystal) · Arcane Focus (Orb) · Arcane Focus (Rod) · Arcane Focus (Staff) · Arcane Focus (Wand) · Backpack · Ball Bearings (bag of 1,000) · Barrel · Basket · Bedroll · Bell · Blanket · Block and Tackle · Book · Bottle, Glass · Bucket · Burglar's Pack · Caltrops (bag of 20) · Candle · Case, Crossbow Bolt · Case, Map or Scroll · Chain (10 feet) · Chalk (1 piece) · Chest · Climber's Kit · Clothes, Fine · Clothes, Traveler's · Component Pouch · Costume · Crowbar · Diplomat's Pack · Druidic Focus (Sprig of Mistletoe) · Druidic Focus (Totem) · Druidic Focus (Wooden Staff) · Druidic Focus (Yew Wand) · Dungeoneer's Pack · Entertainer's Pack · Explorer's Pack · Flask or Tankard · Grappling Hook · Hammer · Holy Symbol (Amulet) · Holy Symbol (Emblem) · Holy Symbol (Reliquary) · Hunting Trap · Ink (1-ounce bottle) · Ink Pen · Jug or Pitcher · Ladder (10-foot) · Lamp · Lantern, Bullseye · Lantern, Hooded · Lock · Magnifying Glass · Manacles · Map · Mess Kit · Mirror, Steel · Paper (one sheet) · Parchment (one sheet) · Perfume (vial) · Pole (10-foot) · Pot, Iron · Pouch · Priest's Pack · Quiver · Ram, Portable · Rations (1 day) · Robe · Rope (50 feet) · Sack · Scale, Merchant's · Scholar's Pack · Sealing Wax · Shovel · Signal Whistle · Signet Ring · Soap · Spellbook · Spikes, Iron (10) · Spyglass · String (10 feet) · Tent, Two-Person · Tinderbox · Torch · Vial · Waterskin · Whetstone

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Healer's Kit | enforced | stabilize.ts spends one use of the kit to make a creature at 0 Hit Points Stable with no check, and the last use takes the kit. |

## Weapons

**Enforced (38):** Battleaxe · Blowgun · Club · Dagger · Dart · Flail · Glaive · Greataxe · Greatclub · Greatsword · Halberd · Hand Crossbow · Handaxe · Heavy Crossbow · Javelin · Lance · Light Crossbow · Light Hammer · Longbow · Longsword · Mace · Maul · Morningstar · Musket · Pike · Pistol · Quarterstaff · Rapier · Scimitar · Shortbow · Shortsword · Sickle · Sling · Spear · Trident · War Pick · Warhammer · Whip

## Armor

**Enforced (13):** Breastplate · Chain Mail · Chain Shirt · Half Plate Armor · Hide Armor · Leather Armor · Padded Armor · Plate Armor · Ring Mail · Scale Mail · Shield · Splint Armor · Studded Leather Armor

## Conditions

| Record | State | How |
| --- | --- | --- |
| Blinded | enforced | resolution/attack.ts: its attack rolls have Disadvantage and attack rolls against it have Advantage. movement-rules.ts: it makes an Opportunity Attack only against a mover in its Blindsight. The GM rules on checks that need sight. |
| Charmed | guided | resolution/economy.ts: a creature Charmed by a spell or an action can't attack its charmer or target it with a save or damage. A Charmed chip the GM sets names no charmer, so nothing is refused. The charmer's Advantage on social checks is the GM's. |
| Deafened | guided | actor-conditions.ts tracks it on the creature. The GM rules on checks that need hearing; nothing else in the condition changes a roll. |
| Exhaustion | enforced | condition-rules.ts takes 2 per level from every D20 Test, and speed.ts takes 5 feet per level from Speed. effects.ts kills the creature at level 6, and rests.ts removes a level on each Long Rest. |
| Frightened | guided | resolution/attack.ts and ability-checks.ts: Disadvantage on its attack rolls and ability checks while the condition lasts, since the map has no line of sight. Moving closer to the source of its fear isn't refused; the GM rules on it. |
| Grappled | enforced | speed.ts: Speed 0. resolution/attack.ts: Disadvantage on attack rolls against anyone but the grappler. movement-rules.ts lets the grappler drag it, and resolution/builtins.ts rolls Escape a Grapple against the escape DC. |
| Incapacitated | enforced | resolution/economy.ts refuses its actions, Bonus Actions and Reactions. effects.ts ends its Concentration and its grapples, and encounter.ts gives it Disadvantage on Initiative. |
| Invisible | enforced | resolution/attack.ts: Advantage on its attack rolls and Disadvantage on attack rolls against it, unless Faerie Fire outlines it. encounter.ts: Advantage on Initiative. movement-rules.ts: it provokes an Opportunity Attack only from a creature whose Blindsight or Truesight reaches it. Effects that need sight of it are the GM's. |
| Paralyzed | enforced | It counts as Incapacitated, and speed.ts sets its Speed to 0. saving-throws.ts fails its Strength and Dexterity saves. resolution/attack.ts gives attack rolls against it Advantage and makes a hit from within 5 feet a Critical Hit. |
| Petrified | enforced | It counts as Incapacitated, with Speed 0 and failed Strength and Dexterity saves, and attack rolls against it have Advantage. hit-points.ts gives it Resistance to all damage, and effects.ts makes it immune to the Poisoned condition. Its change of substance is narrative. |
| Poisoned | enforced | resolution/attack.ts and ability-checks.ts: Disadvantage on its attack rolls and ability checks, Initiative included. |
| Prone | enforced | movement-rules.ts charges an extra foot per foot while it crawls, and actor-conditions.ts charges half its Speed to stand up. resolution/attack.ts: Disadvantage on its attack rolls, and attack rolls against it have Advantage within 5 feet and Disadvantage beyond. |
| Restrained | enforced | speed.ts: Speed 0. resolution/attack.ts: Disadvantage on its attack rolls and Advantage on attack rolls against it. saving-throws.ts: Disadvantage on its Dexterity saves. |
| Stunned | enforced | It counts as Incapacitated. saving-throws.ts fails its Strength and Dexterity saves, and resolution/attack.ts gives attack rolls against it Advantage. |
| Unconscious | enforced | effects.ts adds Prone, and it counts as Incapacitated with Speed 0. saving-throws.ts fails its Strength and Dexterity saves. resolution/attack.ts gives attack rolls against it Advantage and makes a hit from within 5 feet a Critical Hit. Dropping what it holds is the GM's. |

## Rules glossary

| Record | State | How |
| --- | --- | --- |
| Ability Check | enforced | check-rolls.ts and ability-checks.ts roll it on the server. The roll adds the ability modifier and any proficiency or Expertise, with the Advantage and Disadvantage the rules give. |
| Ability Score and Modifier | enforced | The builder sets the scores, and every roll adds the modifier from abilityModifier in rules-5e. |
| Action | enforced | resolution/economy.ts allows one action on a creature's turn and refuses a second unless a feature such as Action Surge gives one. |
| Advantage | enforced | rules-5e rolls two d20s and keeps the higher. Any Advantage and any Disadvantage on the same roll cancel. |
| Adventure | reference | A definition; there is nothing to apply. |
| Alignment | reference | A definition; nothing in play reads it. |
| Ally | enforced | creature-sides.ts puts player characters and friendly creatures on one side, by token disposition. Auras, Pack Tactics and Help read it. |
| Area of Effect | enforced | commands/actions.ts places the template and area-targeting.ts finds who is inside. The creature a Cone, a Line or an Emanation comes from is left out of it. |
| Armor Class | enforced | armor-class.ts in the domain package works out AC from armor, Shield, Dexterity and riders, and every attack roll is compared with it. |
| Armor Training | enforced | equipment-derivation.ts gives untrained armor Disadvantage on Strength and Dexterity D20 Tests, and resolution/economy.ts refuses spells while it is worn. An untrained Shield adds no AC. Training an item grants counts too (Elven Chain). |
| Attack | enforced | resolution/economy.ts counts the attacks the Attack action allows, Extra Attack included, and lets the creature move between them. Equipping or stowing a weapon is the table's. |
| Attack Roll | enforced | resolution/attack.ts rolls it on the server and compares it with the target's AC. |
| Attitude | reference | Attitudes aren't tracked. The GM decides how a monster responds to Influence. |
| Attunement | enforced | inventory.ts holds a creature to three attuned items, and an item that needs Attunement gives nothing until it has it. |
| Blinded | enforced | resolution/attack.ts: its attack rolls have Disadvantage and attack rolls against it have Advantage. movement-rules.ts: it makes an Opportunity Attack only against a mover in its Blindsight. The GM rules on checks that need sight. |
| Blindsight | guided | movement-rules.ts reads the stat block's range to let it spot a mover for an Opportunity Attack while Blinded or against an Invisible creature. Attack rolls against a creature it perceives this way are the GM's to adjust. |
| Bloodied | enforced | The server counts half Hit Points or fewer as Bloodied (healthBandOf in hit-points.ts) for the rules that name it, such as monster traits and damage that changes when Bloodied. |
| Bonus Action | enforced | resolution/economy.ts allows one Bonus Action on a turn, and only from a feature, spell or item that offers one. |
| Breaking Objects | reference | Objects have no AC or Hit Points in the app. |
| Bright Light | reference | The map has no light levels. |
| Burning | enforced | hazards.ts deals 1d4 Fire damage at the start of each of the creature's turns. Put Out the Fire (resolution/builtins.ts) ends it and leaves the creature Prone. |
| Burrow Speed | enforced | speed.ts and movement-rules.ts let a creature with a Burrow Speed move by burrowing, charged against that speed. |
| Campaign | reference | A definition; there is nothing to apply. |
| Cantrip | enforced | Every cantrip a sheet or stat block knows is a cast action with no slot (character-build.ts, monster-spells.ts), and its damage grows at the character levels its row prints (cantripTierAt in the content package). |
| Carrying Capacity | reference | Weight carried isn't checked against Strength. |
| Challenge Rating | guided | The bestiary shows each monster's CR and XP, and the encounter budget (EncounterBudget.tsx, encounters.ts in rules-5e) rates a fight for the party's levels. The GM decides what to run. |
| Character Sheet | reference | A definition. The app's own sheet is where each character's records live. |
| Charmed | guided | resolution/economy.ts: a creature Charmed by a spell or an action can't attack its charmer or target it with a save or damage. A Charmed chip the GM sets names no charmer, so nothing is refused. The charmer's Advantage on social checks is the GM's. |
| Climb Speed | enforced | speed.ts gives a creature with a Climb Speed its own budget for climbing, with no extra cost. |
| Climbing | enforced | movement-rules.ts charges an extra foot per foot of climbing without a Climb Speed. A check for a slippery surface is the GM's. |
| Concentration | enforced | resolution/concentration.ts ends the first Concentration spell when a second starts. hit-points.ts asks for a Constitution save against DC 10 or half the damage, up to 30, and effects.ts ends it when the caster is Incapacitated or dies, or when a spell that only affects creatures has none left under it. Its duration counts down on the game clock (game-time.ts). |
| Condition | enforced | effects.ts applies every condition through applyCondition, which honours immunities, ends one a creature becomes immune to, and ends it when its save says or its duration runs out, in rounds during a fight and on the game clock between them (game-time.ts). |
| Cone | enforced | area-targeting.ts: its width at any point equals that point's distance from the origin. The server finds every creature with a cell centre inside the template. |
| Cover | enforced | The GM marks the degree of cover (cover.ts). The server adds 2 or 5 to AC and Dexterity saves, and resolution/validate.ts refuses an attack against Total Cover. |
| Crawling | enforced | movement-rules.ts charges an extra foot per foot while a creature is Prone. |
| Creature | reference | A definition; there is nothing to apply. |
| Creature Type | enforced | statblock-facts.ts reads the stat block's type, and riders gated on a creature type read it (Divine Smite's extra die against Fiends and Undead). |
| Critical Hit | enforced | resolution/attack.ts makes a 20 on the d20 hit, and the damage step rolls the attack's damage dice twice. |
| Cube | enforced | area-targeting.ts: a Cube is a square on the map with its own size for each side. The server finds every creature with a cell centre inside the template. |
| Curses | guided | inventory.ts hides a cursed item's curse until it is attuned, and its bearer can't end the Attunement. Hex, Bestow Curse and Geas mark what they leave as a curse, which Remove Curse ends (resolution/dispel.ts), and Remove Curse breaks the Attunement to a cursed item. A monster's curse, and other magic that ends curses, are the GM's to track. |
| Cylinder | enforced | area-targeting.ts: a Cylinder is drawn as a circle of its radius, and its height is the GM's. The server finds every creature with a cell centre inside the template. |
| D20 Test | enforced | Ability checks, attack rolls and saving throws all roll on the server, and riders that name D20 Tests reach each of them. |
| Damage | enforced | hit-points.ts takes damage off Temporary Hit Points first and then Hit Points. |
| Damage Roll | enforced | The server rolls damage dice and adds the modifiers the action carries. |
| Damage Threshold | reference | Nothing in the app has a damage threshold. |
| Damage Types | enforced | Damage carries one of the 13 types, and hit-points.ts applies Immunity, Resistance and Vulnerability by type. |
| Darkness | reference | The map has no light levels; the GM rules on what a creature can see. |
| Darkvision | reference | The builder shows a species' range, and the trait's text is on the sheet. The map has no light levels, so the GM decides what a creature sees. |
| Dash | enforced | resolution/grant.ts and speed.ts add the creature's Speed to its movement for the turn. |
| Dead | enforced | death.ts counts a creature dead at three failed death saves, at Exhaustion 6 or from massive damage, and a monster dead at 0 Hit Points. resolution/heal.ts gives the dead no Hit Points; only the GM's revival brings one back. |
| Deafened | guided | actor-conditions.ts tracks it on the creature. The GM rules on checks that need hearing; nothing else in the condition changes a roll. |
| Death Saving Throw | enforced | death-saves.ts rolls it from the dying character's sheet: 10 or more succeeds, a 1 counts as two failures and a 20 restores 1 Hit Point. hit-points.ts adds a failure for damage taken at 0 Hit Points, two for a Critical Hit. |
| Dehydration | reference | Water isn't tracked. |
| Difficult Terrain | enforced | The GM paints difficult terrain on the map (terrain.ts), and movement-rules.ts charges double through it and through an enemy's space. |
| Difficulty Class | enforced | The server works out spell save DCs and feature DCs from the sheet and compares every save and check with its DC. |
| Dim Light | reference | The map has no light levels. |
| Disadvantage | enforced | rules-5e rolls two d20s and keeps the lower. Any Advantage and any Disadvantage on the same roll cancel. |
| Disengage | enforced | movement-rules.ts opens no Opportunity Attacks against the creature for the rest of its turn. |
| Dodge | enforced | builtin-actions.ts gives attack rolls against it Disadvantage and its Dexterity saves Advantage until its next turn. Both lapse while it is Incapacitated. |
| Emanation | enforced | area-targeting.ts: an Emanation is a circle around its creature, which isn't in the area. The server finds every creature with a cell centre inside the template. |
| Encounter | reference | A definition. Fights run in the encounter tracker, which the other rows describe. |
| Enemy | enforced | creature-sides.ts puts monsters and hostile creatures against the party, by token disposition. Opportunity Attacks, auras and Sneak Attack read it. |
| Exhaustion | enforced | condition-rules.ts takes 2 per level from every D20 Test, and speed.ts takes 5 feet per level from Speed. effects.ts kills the creature at level 6, and rests.ts removes a level on each Long Rest. |
| Experience Points | reference | The bestiary prints each monster's XP. Characters' XP isn't tracked, and the GM levels a character up in the builder. |
| Expertise | enforced | ability-checks.ts doubles the Proficiency Bonus on a check with a skill the sheet has Expertise in. |
| Falling | reference | Falls and their damage are the GM's to apply. |
| Fly Speed | enforced | speed.ts gives a creature with a Fly Speed its own budget for flying. |
| Flying | guided | movement-rules.ts lets a creature with a Fly Speed fly a move. Whether it falls when Incapacitated, Prone or at Fly Speed 0 is the GM's. |
| Friendly | reference | Attitudes aren't tracked; the GM applies the Advantage on Influence. |
| Frightened | guided | resolution/attack.ts and ability-checks.ts: Disadvantage on its attack rolls and ability checks while the condition lasts, since the map has no line of sight. Moving closer to the source of its fear isn't refused; the GM rules on it. |
| Grappled | enforced | speed.ts: Speed 0. resolution/attack.ts: Disadvantage on attack rolls against anyone but the grappler. movement-rules.ts lets the grappler drag it, and resolution/builtins.ts rolls Escape a Grapple against the escape DC. |
| Grappling | enforced | resolution/builtins.ts rolls the target's Strength or Dexterity save against 8 plus Strength plus the Proficiency Bonus, and refuses a target more than one size larger. The grapple ends when the grappler is Incapacitated or moves out of reach (effects.ts). |
| Hazard | reference | A definition. Burning has its own row; the other hazards aren't tracked. |
| Healing | enforced | resolution/heal.ts restores Hit Points up to the maximum, and healing a dying character brings it back to consciousness. |
| Heavily Obscured | reference | The map has no obscurement; the GM rules on what a creature can see. |
| Help | guided | resolution/attack.ts gives the next attack roll by an ally against the distracted enemy Advantage. Helping with an ability check is the GM's to apply. |
| Heroic Inspiration | guided | held-rolls.ts spends it to reroll the d20 of an attack, a check, a save or a death save while the roll is shown. rests.ts gives it to a Human on a Long Rest, and turn-boundaries.ts to a Champion at the start of its turn. Rerolling a damage die or Initiative, and giving a second one to another character, are the GM's. |
| Hide | enforced | resolution/builtins.ts rolls a DC 15 Dexterity (Stealth) check and makes the creature Invisible on a success, until it attacks. Whether it can hide there is the GM's call. |
| High Jump | reference | Jumps aren't measured. |
| Hit Point Dice | enforced | rests.ts spends them on a Short Rest, each healing its roll plus the Constitution modifier, and restores them all on a Long Rest. |
| Hit Points | enforced | hit-points.ts keeps Hit Points between 0 and the maximum, and a creature at 0 falls Unconscious or dies. |
| Hostile | reference | Attitudes aren't tracked; the GM applies the Disadvantage on Influence. |
| Hover | guided | speed.ts records whether a creature hovers. Falling while flying is the GM's to apply. |
| Illusions | reference | Illusions are the GM's to run. |
| Immunity | enforced | hit-points.ts ignores damage of an immune type. effects.ts refuses a condition the creature is immune to, and a creature that becomes immune (Heroism, a Periapt of Proof against Poison) loses the condition it already has. |
| Improvised Weapons | reference | An improvised attack is the GM's to set up. |
| Incapacitated | enforced | resolution/economy.ts refuses its actions, Bonus Actions and Reactions. effects.ts ends its Concentration and its grapples, and encounter.ts gives it Disadvantage on Initiative. |
| Indifferent | reference | Attitudes aren't tracked. |
| Influence | guided | resolution/builtins.ts rolls the chosen Charisma or Wisdom check against 15 or the monster's Intelligence, whichever is higher. The GM decides what the monster does. |
| Initiative | enforced | encounter.ts rolls Initiative as a Dexterity check with its Advantage and Disadvantage, and orders the turns. |
| Invisible | enforced | resolution/attack.ts: Advantage on its attack rolls and Disadvantage on attack rolls against it, unless Faerie Fire outlines it. encounter.ts: Advantage on Initiative. movement-rules.ts: it provokes an Opportunity Attack only from a creature whose Blindsight or Truesight reaches it. Effects that need sight of it are the GM's. |
| Jumping | reference | Jumps aren't measured. |
| Knocking Out a Creature | enforced | A melee hit's confirm offers Knock out (resolution/knock-out.ts), and every apply path then lands it: hit-points.ts leaves a creature it drops at 1 Hit Point and Unconscious until it regains Hit Points, stabilize.ts gives it first aid, or an hour passes on the game clock and its Short Rest ends (game-time.ts). |
| Lightly Obscured | reference | The map has no obscurement. |
| Line | enforced | area-targeting.ts: a Line has a fixed width, and the point it starts from isn't in it. The server finds every creature with a cell centre inside the template. |
| Long Jump | reference | Jumps aren't measured. |
| Long Rest | enforced | rests.ts needs 1 Hit Point and 16 hours since the last one. It restores Hit Points, Hit Point Dice, spell slots and uses, removes a level of Exhaustion and ends what lasts until a Long Rest. The party's Long Rest moves the game clock 8 hours, which counts down every effect (game-time.ts). |
| Magic | enforced | resolution/economy.ts spends the action when a spell or an item's action is used. A creature's own spell of a minute or more takes the action on each of its turns in a fight and resolves on the last (resolution/long-casting.ts); outside a fight it completes at once and moves the game clock by its whole hours. An item's long cast in a fight is a reminder to the GM (resolution/validate.ts). |
| Magical Effect | enforced | resolution/pending.ts marks a save against a spell or a magic item as magical, which Magic Resistance reads. |
| Malnutrition | reference | Food isn't tracked. |
| Monster | reference | A definition; there is nothing to apply. |
| Nonplayer Character | reference | A definition; there is nothing to apply. |
| Object | reference | Objects have no game statistics in the app. |
| Occupied Space | enforced | movement-rules.ts refuses a move that ends in another creature's space, unless one of them can share it. |
| Opportunity Attacks | enforced | movement-rules.ts opens a Reaction prompt when a mover leaves an enemy's reach, and reactions.ts resolves it as one melee attack. Disengage, teleporting and forced movement provoke none. |
| Paralyzed | enforced | It counts as Incapacitated, and speed.ts sets its Speed to 0. saving-throws.ts fails its Strength and Dexterity saves. resolution/attack.ts gives attack rolls against it Advantage and makes a hit from within 5 feet a Critical Hit. |
| Passive Perception | enforced | ability-checks.ts works it out as 10 plus the Wisdom (Perception) bonus, 5 more with Advantage and 5 less with Disadvantage. The GM compares it with what is hidden. |
| Per Day | enforced | use-pools.ts counts the uses, and a Long Rest gives them back. |
| Petrified | enforced | It counts as Incapacitated, with Speed 0 and failed Strength and Dexterity saves, and attack rolls against it have Advantage. hit-points.ts gives it Resistance to all damage, and effects.ts makes it immune to the Poisoned condition. Its change of substance is narrative. |
| Player Character | reference | A definition; there is nothing to apply. |
| Poisoned | enforced | resolution/attack.ts and ability-checks.ts: Disadvantage on its attack rolls and ability checks, Initiative included. |
| Possession | reference | Possession is the GM's to run. |
| Proficiency | enforced | The server adds the Proficiency Bonus to attacks, saves and checks the sheet is proficient in. |
| Prone | enforced | movement-rules.ts charges an extra foot per foot while it crawls, and actor-conditions.ts charges half its Speed to stand up. resolution/attack.ts: Disadvantage on its attack rolls, and attack rolls against it have Advantage within 5 feet and Disadvantage beyond. |
| Reach | enforced | resolution/economy.ts refuses a melee attack beyond reach, 5 feet unless the weapon or stat block says more. Opportunity Attacks use the same reach. |
| Reaction | enforced | resolution/economy.ts refuses a second Reaction before the creature's next turn, when encounter.ts gives it back. |
| Ready | enforced | resolution/ready.ts holds the response until the start of the creature's next turn and spends its Reaction to take it. A readied spell spends its slot at once and holds Concentration. |
| Resistance | enforced | hit-points.ts halves damage of a resisted type, rounded down, once per instance of damage. |
| Restrained | enforced | speed.ts: Speed 0. resolution/attack.ts: Disadvantage on its attack rolls and Advantage on attack rolls against it. saving-throws.ts: Disadvantage on its Dexterity saves. |
| Ritual | enforced | character-build.ts gives each Ritual spell on a sheet a cast with no slot, which resolution/economy.ts refuses unprepared except a Wizard's from the spellbook it carries (ritual-adept.ts). resolution/long-casting.ts adds the 10 minutes: in a fight the cast takes the action on each turn until it completes. |
| Round Down | enforced | The server rounds down wherever a rule divides (halved damage, half Speed, DCs). |
| Save | enforced | Another name for a saving throw; see that row. |
| Saving Throw | enforced | saving-throws.ts opens a save prompt for each target and rolls it on the server, with the proficiency, riders, Advantage and Disadvantage that apply. |
| Search | guided | resolution/builtins.ts rolls the chosen Wisdom check. The GM sets the DC and says what the creature finds. |
| Shape-Shifting | reference | Changing form is the GM's to run; the sheet keeps the creature's own statistics. |
| Short Rest | enforced | rests.ts needs 1 Hit Point, lets Hit Point Dice be spent, gives back what a Short Rest restores and ends what lasts until one. The party's Short Rest moves the game clock an hour when the GM finishes it. short-rest-interruptions.ts ends it for anyone who rolls Initiative, takes damage or casts a spell above a cantrip. |
| Simultaneous Effects | reference | The order of simultaneous effects is the table's. |
| Size | enforced | token-placement.ts sizes each token's space by its size, and size limits (grappling, shoving) are checked on the server. |
| Skill | enforced | ability-checks.ts adds the Proficiency Bonus to a check with a skill the sheet is proficient in. |
| Speed | enforced | movement-rules.ts charges each move against the creature's Speed for the turn, and each special speed has its own budget. |
| Spell | enforced | Every spell a sheet or stat block knows is a cast action that spends its casting time and slot (resolution/economy.ts) and is told to the table as cast (cast-narration.ts). Each spell's own row under Spells says what else the app does with it. |
| Spell Attack | enforced | resolution/attack.ts rolls it with the caster's spell attack bonus, Advantage and Disadvantage included. |
| Spellcasting Focus | enforced | resolution/components.ts checks a cast's components: a Verbal one needs a caster who can speak outside Silence, a Somatic one a free hand (a Shield or bound hands fill one), and a Material one a Component Pouch, the focus the class names or the material itself. A priced material must be carried, and a consumed one is used up. A stat block's cast is held to its Verbal component unless its text says it needs none; its hands and materials are the GM's. |
| Sphere | enforced | area-targeting.ts: a Sphere is a circle of its radius, and the point it starts from is in it. The server finds every creature with a cell centre inside the template. |
| Stable | enforced | stabilize.ts stops death saves after three successes, first aid or Spare the Dying. effects.ts rolls the 1d4 hours on the game clock after which the creature regains 1 Hit Point, and damage before then starts its dying again. |
| Stat Block | reference | A definition. Each monster's actions and traits have their own rows above. |
| Study | guided | resolution/builtins.ts rolls the chosen Intelligence check. The GM sets the DC and says what the creature learns. |
| Stunned | enforced | It counts as Incapacitated. saving-throws.ts fails its Strength and Dexterity saves, and resolution/attack.ts gives attack rolls against it Advantage. |
| Suffocation | reference | Breath isn't tracked. |
| Surprise | enforced | encounter.ts gives a creature the GM marks as surprised Disadvantage on its Initiative roll. |
| Swim Speed | enforced | speed.ts gives a creature with a Swim Speed its own budget for swimming, with no extra cost. |
| Swimming | enforced | movement-rules.ts charges an extra foot per foot of swimming without a Swim Speed. A check in rough water is the GM's. |
| Target | enforced | resolution/spell-targets.ts holds a spell to the number of targets it names (more with a higher slot), the creature type it affects, the ones the caster can see when dynamic vision is on, its range, and for creatures of the caster's choice in an area, to those inside it. |
| Telepathy | reference | Telepathy is the table's to run. |
| Teleportation | enforced | movement-rules.ts moves a teleporting creature with no movement spent and no Opportunity Attack. A player's teleport needs the GM's go-ahead. |
| Temporary Hit Points | enforced | hit-points.ts takes damage from Temporary Hit Points first, and a Long Rest clears them. A new grant replaces the old one; choosing to keep the higher is the GM's. |
| Tremorsense | reference | Senses other than Blindsight and Truesight aren't read in play. |
| Truesight | guided | movement-rules.ts lets it spot an Invisible mover for an Opportunity Attack. Attack rolls, illusions and shape-shifters are the GM's to adjust. |
| Unarmed Strike | enforced | resolution/builtins.ts rolls the strike for 1 plus Strength Bludgeoning damage, or the grapple or shove save against 8 plus Strength plus the Proficiency Bonus. |
| Unconscious | enforced | effects.ts adds Prone, and it counts as Incapacitated with Speed 0. saving-throws.ts fails its Strength and Dexterity saves. resolution/attack.ts gives attack rolls against it Advantage and makes a hit from within 5 feet a Critical Hit. Dropping what it holds is the GM's. |
| Unoccupied Space | enforced | movement-rules.ts ends a move only in a space no other creature fills. |
| Utilize | guided | resolution/economy.ts spends the action. What the object does is the GM's. |
| Vulnerability | enforced | hit-points.ts doubles damage of a type the creature is vulnerable to, once per instance. |
| Weapon | reference | A definition. Each weapon's own row under Weapons says what the app does with it. |
| Weapon Attack | enforced | resolution/attack.ts rolls it with the weapon's ability, proficiency, properties and mastery. |

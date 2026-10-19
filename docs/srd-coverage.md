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
| Spells (339) | 150 | 189 | 0 |
| Monster actions (992) | 912 | 53 | 27 |
| Monster traits (106) | 39 | 17 | 50 |
| Barbarian features (23) | 21 | 0 | 2 |
| Bard features (16) | 15 | 1 | 0 |
| Cleric features (19) | 11 | 3 | 5 |
| Druid features (21) | 17 | 3 | 1 |
| Fighter features (21) | 18 | 0 | 3 |
| Monk features (30) | 24 | 2 | 4 |
| Paladin features (26) | 23 | 3 | 0 |
| Ranger features (22) | 17 | 2 | 3 |
| Rogue features (23) | 19 | 2 | 2 |
| Sorcerer features (18) | 17 | 1 | 0 |
| Warlock features (20) | 17 | 2 | 1 |
| Wizard features (15) | 10 | 4 | 1 |
| Species traits (77) | 73 | 1 | 3 |
| Backgrounds (4) | 4 | 0 | 0 |
| Feats (19) | 16 | 2 | 1 |
| Magic items (270) | 91 | 118 | 61 |
| Gear and tools (141) | 24 | 38 | 79 |
| Weapons (38) | 38 | 0 | 0 |
| Armor (13) | 13 | 0 | 0 |
| Conditions (15) | 13 | 2 | 0 |
| Rules glossary (155) | 115 | 11 | 29 |
| All records (2423) | 1697 | 454 | 272 |

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

**Enforced (150):** Acid Arrow · Acid Splash · Aid · Alarm · Animal Friendship · Antilife Shell · Arcane Sword · Bane · Barkskin · Befuddlement · Black Tentacles · Bless · Blight · Blindness/Deafness · Blur · Burning Hands · Chain Lightning · Charm Monster · Charm Person · Chill Touch · Circle of Death · Cloudkill · Color Spray · Cone of Cold · Conjure Animals · Conjure Fey · Conjure Woodland Beings · Contact Other Plane · Continual Flame · Counterspell · Cure Wounds · Dancing Lights · Darkness · Darkvision · Daylight · Death Ward · Detect Evil and Good · Disintegrate · Dispel Magic · Dissonant Whispers · Divine Favor · Divine Smite · Divine Word · Dragon's Breath · Eldritch Blast · Enhance Ability · Ensnaring Strike · Entangle · Faerie Fire · False Life · Feather Fall · Finger of Death · Fire Bolt · Fire Shield · Fire Storm · Fireball · Flame Blade · Flame Strike · Flaming Sphere · Fly · Fog Cloud · Forbiddance · Foresight · Freezing Sphere · Geas · Gentle Repose · Globe of Invulnerability · Grease · Greater Invisibility · Guardian of Faith · Guiding Bolt · Harm · Haste · Heal · Healing Word · Heat Metal · Hellish Rebuke · Heroism · Hex · Hold Monster · Hold Person · Holy Aura · Hunter's Mark · Hypnotic Pattern · Ice Knife · Ice Storm · Inflict Wounds · Insect Plague · Invisibility · Jump · Lesser Restoration · Lightning Bolt · Longstrider · Mage Armor · Magic Missile · Mass Cure Wounds · Mass Heal · Mass Healing Word · Mass Suggestion · Meteor Swarm · Mind Spike · Mirror Image · Misty Step · Modify Memory · Moonbeam · Pass without Trace · Poison Spray · Power Word Heal · Power Word Kill · Power Word Stun · Prayer of Healing · Produce Flame · Protection from Energy · Protection from Poison · Raise Dead · Ray of Frost · Ray of Sickness · Remove Curse · Resurrection · Revivify · Sacred Flame · Scorching Ray · Searing Smite · See Invisibility · Shatter · Shield · Shield of Faith · Shining Smite · Shocking Grasp · Slow · Spare the Dying · Spider Climb · Spike Growth · Spirit Guardians · Spiritual Weapon · Starry Wisp · Stinking Cloud · Stoneskin · Suggestion · Sunbeam · Sunburst · Thunderwave · True Resurrection · True Seeing · Vampiric Touch · Vicious Mockery · Vitriolic Sphere · Wall of Fire · Wall of Thorns · Web

**Guided (189):** Alter Self · Animal Messenger · Animal Shapes · Animate Dead · Animate Objects · Antimagic Field · Antipathy/Sympathy · Arcane Eye · Arcane Hand · Arcane Lock · Arcanist's Magic Aura · Astral Projection · Augury · Aura of Life · Awaken · Banishment · Beacon of Hope · Bestow Curse · Blade Barrier · Blink · Call Lightning · Calm Emotions · Chromatic Orb · Clairvoyance · Clone · Command · Commune · Commune with Nature · Comprehend Languages · Compulsion · Confusion · Conjure Celestial · Conjure Elemental · Conjure Minor Elementals · Contagion · Contingency · Control Water · Control Weather · Create Food and Water · Create or Destroy Water · Create Undead · Creation · Delayed Blast Fireball · Demiplane · Detect Magic · Detect Poison and Disease · Detect Thoughts · Dimension Door · Disguise Self · Dispel Evil and Good · Divination · Dominate Beast · Dominate Monster · Dominate Person · Dream · Druidcraft · Earthquake · Elementalism · Enlarge/Reduce · Enthrall · Etherealness · Expeditious Retreat · Eyebite · Fabricate · Faithful Hound · Fear · Find Familiar · Find Steed · Find the Path · Find Traps · Flesh to Stone · Floating Disk · Forcecage · Freedom of Movement · Gaseous Form · Gate · Giant Insect · Glibness · Glyph of Warding · Goodberry · Greater Restoration · Guards and Wards · Guidance · Gust of Wind · Hallow · Hallucinatory Terrain · Heroes' Feast · Hideous Laughter · Identify · Illusory Script · Imprisonment · Incendiary Cloud · Instant Summons · Irresistible Dance · Knock · Legend Lore · Levitate · Light · Locate Animals or Plants · Locate Creature · Locate Object · Mage Hand · Magic Circle · Magic Jar · Magic Mouth · Magic Weapon · Magnificent Mansion · Major Image · Maze · Meld into Stone · Mending · Message · Mind Blank · Minor Illusion · Mirage Arcane · Mislead · Move Earth · Nondetection · Passwall · Phantasmal Force · Phantasmal Killer · Phantom Steed · Planar Ally · Planar Binding · Plane Shift · Plant Growth · Polymorph · Prestidigitation · Prismatic Spray · Prismatic Wall · Private Sanctum · Programmed Illusion · Project Image · Protection from Evil and Good · Purify Food and Drink · Ray of Enfeeblement · Regenerate · Reincarnate · Resilient Sphere · Resistance · Reverse Gravity · Rope Trick · Sanctuary · Scrying · Secret Chest · Seeming · Sending · Sequester · Shapechange · Shillelagh · Silence · Silent Image · Simulacrum · Sleep · Sleet Storm · Sorcerous Burst · Speak with Animals · Speak with Dead · Speak with Plants · Stone Shape · Storm of Vengeance · Summon Dragon · Symbol · Telekinesis · Telepathic Bond · Teleport · Teleportation Circle · Thaumaturgy · Time Stop · Tiny Hut · Tongues · Transport via Plants · Tree Stride · True Polymorph · True Strike · Tsunami · Unseen Servant · Wall of Force · Wall of Ice · Wall of Stone · Warding Bond · Water Breathing · Water Walk · Weird · Wind Walk · Wind Wall · Wish · Word of Recall · Zone of Truth

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Alarm | enforced | The warded area lasts 8 hours, in a fight or out of one, on the game clock (spell-zones.ts, game-time.ts). When an enemy of the caster enters it, the GM is told who in a line only the GM sees. The GM wards a door or a window by hand, and passes on the bell or the ping. |
| Antilife Shell | enforced | zone-barriers.ts holds every creature but Constructs and Undead out of the 10-foot Emanation. A walk goes round its edge, and strict rules refuse a move or a melee attack across it (resolution/validate.ts). A Ranged attack, a Reach weapon and a spell go through. The caster's move that forces the edge across such a creature ends the spell. |
| Augury | guided | Each cast after the first before a Long Rest rolls the d100 against a 25 percent chance of no answer for each earlier cast (resolution/divinations.ts). The omen is the GM's. |
| Aura of Life | guided | zone-auras.ts gives the caster and its allies Resistance to Necrotic damage while they stand in the 30-foot Emanation. spell-zones.ts gives an ally at 0 Hit Points that starts its turn there 1 Hit Point. Keeping their Hit Point maximums from dropping is the GM's. |
| Banishment | guided | A failed save Incapacitates the target and takes it off the map while the caster concentrates (off-plane.ts); it can't be targeted, and it returns to the space it left or the nearest unoccupied one. An extraplanar creature that stays gone after the full minute is the GM's. |
| Befuddlement | enforced | A failed save deals the Psychic damage and bars the target from casting spells and the Magic action (resolution/economy.ts). The save every 30 days, and Greater Restoration, Heal or Wish ending it, are the GM's. |
| Bestow Curse | guided | A failed save leaves the curse on the target for the slot's duration (resolution/concentration.ts: with Concentration below level 5, 10 minutes from a level 4 slot, 8 hours from 5, 24 hours from 7, until dispelled from 9), and Remove Curse or Dispel Magic ends it. The curse the caster chooses, and what it does, are the GM's to apply. |
| Black Tentacles | enforced | spell-zones.ts asks for the Strength save on the cast and when a creature enters the square or ends its turn there, once a turn: 3d6 Bludgeoning damage and Restrained, escaped with a Strength (Athletics) check against the spell save DC. zone-ground.ts makes the square Difficult Terrain. |
| Blade Barrier | guided | spell-zones.ts asks for the Dexterity save against 6d10 Force damage on the cast and when a creature enters the wall or ends its turn there, once a turn. zone-ground.ts makes the wall's space Difficult Terrain. Its Three-Quarters Cover and its ring form are the GM's. |
| Blink | guided | The server rolls the d6 as the caster's turn ends; on a 4 or more the caster leaves the map until the start of its next turn (off-plane.ts) and returns to the space it left or the nearest unoccupied one. Picking another space within 10 feet is the GM's. |
| Blur | enforced | Attack rolls against the caster have Disadvantage while it lasts, except from an attacker whose Blindsight or Truesight reaches it (resolution/attack.ts). |
| Call Lightning | guided | The cast and each later Magic action strike a 5-foot Sphere with the Dexterity save against 3d10 Lightning damage, at the cast's slot level. Keeping the bolts under the cloud, and the extra 1d10 in a storm, are the GM's. |
| Chromatic Orb | guided | The attack and the chosen damage type are applied. The leap to another target on matching dice is the GM's. |
| Cloudkill | enforced | spell-zones.ts asks for the Constitution save against 5d8 Poison damage on the cast and when a creature enters the Sphere or ends its turn there, once a turn. At the start of each of the caster's turns it moves the Sphere 10 feet straight away from the caster, and a creature the Sphere moves onto makes the save. The Sphere is Heavily Obscured for dynamic vision (vision/cast-sight.ts). |
| Commune | guided | Each cast after the first before a Long Rest rolls the d100 against a 25 percent chance of no answer for each earlier cast (resolution/divinations.ts). The deity's answers are the GM's. |
| Compulsion | guided | A failed save imposes Charmed. The move it forces each turn, and the save after it, are the GM's. |
| Conjure Celestial | guided | The Healing Light on the cast is applied, and Bright Light fills the Cylinder for dynamic vision (vision/cast-sight.ts). Searing Light, and moving the Cylinder, are the GM's. |
| Conjure Elemental | guided | spell-zones.ts asks for the spirit's Dexterity save when an enemy enters its space or starts its turn within 5 feet of it, while it has no creature Restrained: 8d8 damage of its element and Restrained until the spell ends on a failure. The Restrained creature's repeat save with 4d8 damage at the start of each of its turns is the GM's. |
| Conjure Minor Elementals | guided | zone-ground.ts makes the ground in the 15-foot Emanation Difficult Terrain for the caster's enemies. The extra 2d8 damage on the caster's hits within it is the GM's. |
| Contact Other Plane | enforced | The caster makes the DC 15 Intelligence save (resolution/pending.ts); a failure deals 6d6 Psychic damage and leaves it Incapacitated until it finishes a Long Rest (rests.ts). The entity's answers, and a Greater Restoration ending the condition, are the GM's. |
| Contagion | guided | The save's 11d8 Necrotic damage and Poisoned condition are applied. The Disadvantage on saves with the chosen ability, and the three repeat saves, are the GM's. |
| Counterspell | enforced | resolution/counter.ts holds a cast with components while each creature that sees its caster within 60 feet and has Counterspell, a slot and its Reaction answers. counter-answers.ts rolls the caster's Constitution save against the reactor's DC: a failure ends the spell with no effect and leaves its slot unspent, and a success lets it go ahead. |
| Death Ward | enforced | hit-points.ts leaves the target at 1 Hit Point the first time it would drop to 0, and ends the spell. An effect that would kill it outright without dealing damage (Power Word Kill, Divine Word, a Slaying Bow) ends the spell instead (hit-points.ts, fatal-saves.ts). |
| Delayed Blast Fireball | guided | The bead waits at its point, in a fight or out of one, and spell-zones.ts explodes it when the spell ends, Concentration broken included: the Dexterity save and 12d6 Fire damage, plus 1d6 for each of the caster's turns that ended while it waited. A creature that touches or throws the bead is the GM's to run. |
| Dimension Door | guided | granted-moves.ts gives the caster a 500-foot teleport for the turn to any space, seen or not; arriving where a creature it didn't perceive stands fails and deals it 4d6 Force damage. Taking a willing creature along is the GM's. |
| Disintegrate | enforced | The save and its Force damage are applied, and a target it drops to 0 Hit Points dies with nothing left of its body (hit-points.ts): only True Resurrection or Wish brings it back (resolution/revival.ts). The gear it leaves is the GM's. |
| Dispel Magic | enforced | resolution/dispel.ts ends each spell on the target creature of the slot's level or lower, and for each higher one rolls the caster's spellcasting ability check against DC 10 plus its level. The GM can aim it at a spell's area on the map instead. A spell on an object the app doesn't track is the GM's. |
| Dissonant Whispers | enforced | The save and its Psychic damage are applied. On a failure the target spends its Reaction, when it can take one, on a move of its Speed that must end farther from the caster (granted-moves.ts), provoking as any move does; the route is the mover's. |
| Divination | guided | Each cast after the first before a Long Rest rolls the d100 against a 25 percent chance of no answer for each earlier cast (resolution/divinations.ts). The truthful reply is the GM's. |
| Divine Word | enforced | A failed Charisma save acts by the target's Hit Points (fatal-saves.ts): 20 or fewer dies, 30 or fewer is Blinded, Deafened and Stunned for 1 hour, 40 or fewer Blinded and Deafened for 10 minutes, and 50 or fewer Deafened for 1 minute. A Celestial, an Elemental, a Fey or a Fiend that fails leaves the map for 24 hours (off-plane.ts). |
| Dominate Beast | guided | A failed save imposes Charmed for the spell's duration, longer from a higher slot (resolution/concentration.ts). The repeat save each time the target takes damage, and its orders, are the GM's. |
| Dominate Monster | guided | A failed save imposes Charmed for the spell's duration, longer from a level 9 slot (resolution/concentration.ts). The repeat save each time the target takes damage, and its orders, are the GM's. |
| Dominate Person | guided | A failed save imposes Charmed for the spell's duration, longer from a higher slot (resolution/concentration.ts). The repeat save each time the target takes damage, and its orders, are the GM's. |
| Earthquake | guided | The cast places the 100-foot circle, and its Dexterity save leaves a creature Prone with its Concentration broken on a failure. spell-zones.ts repeats the save for each creature in the circle at the end of each of the caster's turns, and zone-ground.ts makes the circle Difficult Terrain. Sparing a creature off the ground is the GM's. So are the fissures and the damage to structures. |
| Entangle | enforced | The cast's Strength save leaves a creature in the square Restrained, escaped with a Strength (Athletics) check against the spell save DC. zone-ground.ts makes the square Difficult Terrain for the duration. Leaving the caster out of its own square is the GM's. |
| Etherealness | guided | The caster leaves the map for the Border Ethereal until it ends the spell (off-plane.ts), out of reach of the creatures on the plane, and returns to the space it left or the nearest unoccupied one. Moving while ethereal, the Force damage of being shunted and the creatures an upcast takes along are the GM's. |
| Faithful Hound | guided | The hound stays at its point in a fight or out of one, and spell-zones.ts makes it bite at the start of each of the caster's turns in a fight: the enemy nearest it within 5 feet makes the Dexterity save against 4d8 Force damage. Moving the hound and its warning bark are the GM's, and so is its sight of Invisible creatures. |
| Fear | guided | A failed save imposes Frightened. The Dash away on each of its turns, and the save out of the caster's sight, are the GM's. |
| Finger of Death | enforced | The save and its Necrotic damage are applied. A Humanoid it kills rises as a Zombie on the caster's side at the start of the caster's next turn, in the corpse's space and acting after the caster (risen.ts). Its orders are the GM's to give. |
| Flaming Sphere | enforced | spell-zones.ts asks for the Dexterity save against 2d6 Fire damage when a creature ends its turn within 5 feet of the sphere. The Bonus Action moves the sphere up to 30 feet (zone-moves.ts), and a creature it rams makes the save. It sheds its light for dynamic vision (vision/cast-sight.ts). |
| Flesh to Stone | guided | A failed save imposes Restrained. The repeat saves toward Petrified, and Speed 0 on a success, are the GM's. |
| Fog Cloud | enforced | The Sphere is Heavily Obscured for dynamic vision (vision/cast-sight.ts), and its radius grows 20 feet for each slot level above 1 (spell-zone-state.ts). Gust of Wind disperses it. |
| Forbiddance | enforced | The warded area, up to a 200-foot square, lasts a day on the game clock (spell-zones.ts, game-time.ts). An Aberration, Celestial, Elemental, Fey, Fiend or Undead that enters it for the first time on a turn or ends its turn there takes 5d10 Radiant or Necrotic damage, chosen at the cast. Strict rules refuse a teleport into it (zone-barriers.ts). The password that spares a creature is the GM's. |
| Freedom of Movement | guided | speed.ts gives the target a Swim Speed equal to its Speed, and terrain.ts charges it nothing extra for Difficult Terrain. The immunity to magical Paralyzed and Restrained, and slipping free of restraints, are the GM's. |
| Gentle Repose | enforced | resolution/revival.ts takes only a corpse, and the game time it spends under the spell's 10 days doesn't count against a revival's limit (death.ts). Keeping it from becoming Undead is the GM's. |
| Globe of Invulnerability | enforced | The 10-foot Emanation stays where its caster stood (spell-zones.ts). zone-barriers.ts keeps a spell of level 5 or lower cast from outside from affecting the creatures within, one level higher for each slot level above 6. |
| Glyph of Warding | guided | The explosive rune lasts until it goes off, in a fight or out of one, drawn for the GM and the caster's player alone. The first creature that steps onto it sets it off: each creature in the 20-foot Sphere makes the Dexterity save against 5d8 damage of the type chosen at the cast, and the spell ends (spell-zones.ts). Other triggers, noticing the glyph and the spell glyph are the GM's. |
| Grease | enforced | spell-zones.ts asks for the Dexterity save when a creature enters the square or ends its turn there, and a failure leaves it Prone. zone-ground.ts makes the square Difficult Terrain. |
| Gust of Wind | guided | The cast's save pushes a creature that fails 15 feet away from the caster, and the Line disperses the fog and clouds it overlaps (vision/cast-sight.ts). The save at the end of a creature's turn in the Line, the doubled cost of moving toward the caster and turning the Line are the GM's. |
| Heal | enforced | resolution/heal.ts restores 70 Hit Points, 10 more for each slot level above 6, and ends Blinded, Deafened and Poisoned, for one creature (resolution/spell-targets.ts). |
| Hideous Laughter | guided | A failed save imposes Prone and Incapacitated, repeated at the end of each of the target's turns. The save with Advantage each time it takes damage is the GM's. |
| Hold Person | enforced | A failed save imposes Paralyzed, repeated at the end of each of the target's turns. resolution/spell-targets.ts takes one Humanoid, one more for each slot level above 2. |
| Holy Aura | enforced | While the caster and its allies stand in the 30-foot Emanation, zone-auras.ts gives them Advantage on saving throws and Disadvantage to attack rolls against them. A Fiend or an Undead that hits one with a melee attack makes the Constitution save or is Blinded until the end of its next turn (resolution/struck.ts). |
| Ice Storm | enforced | The cast's Dexterity save deals the Bludgeoning and Cold damage, half on a success. zone-ground.ts makes the Cylinder Difficult Terrain of ice until the end of the caster's next turn. |
| Imprisonment | guided | A failed save takes the target off the map until the GM ends the spell (off-plane.ts). The form of the prison, the 24 hours of immunity on a success and the ending trigger are the GM's. |
| Incendiary Cloud | guided | spell-zones.ts asks for the Dexterity save against 10d8 Fire damage on the cast and when a creature enters the cloud or ends its turn there, once a turn. At the start of each of the caster's turns it moves the cloud 10 feet straight away from the caster, and a creature the cloud moves onto makes the save. The cloud is Heavily Obscured for dynamic vision (vision/cast-sight.ts). Choosing another direction is the GM's, who drags the area. |
| Insect Plague | enforced | spell-zones.ts asks for the Constitution save against 4d10 Piercing damage on the cast and when a creature enters the Sphere or ends its turn there, once a turn. zone-ground.ts makes the Sphere Difficult Terrain, and it is Lightly Obscured for dynamic vision (vision/cast-sight.ts). |
| Irresistible Dance | guided | A failed save imposes Charmed. The dance's Disadvantage, the Advantage against the dancer and its save to collect itself are the GM's. |
| Jump | enforced | Each target can leap up to 30 feet for 10 feet of movement once on each of its turns for 1 minute (jumping.ts). |
| Levitate | guided | A failed save lifts the target 20 feet (falling.ts); while levitating it moves only as if climbing (altitude.ts), and it floats gently down when the spell ends. A willing target's save, and moving it up or down on the caster's turn, are the GM's, who sets its height. |
| Light | guided | The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. The light and the object it shines from are the GM's. |
| Mage Hand | guided | The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. The hand and what it does are the GM's. |
| Magic Circle | guided | zone-barriers.ts keeps Celestials, Elementals, Fey, Fiends and Undead from walking into the Cylinder, and strict rules refuse their move across its edge. Their Disadvantage on attacks into it, their teleport save and the inverted circle are the GM's. |
| Major Image | guided | resolution/concentration.ts holds the caster's Concentration on it, and from a level 4 slot it lasts until dispelled with none. The illusion itself is the GM's to run. |
| Mass Cure Wounds | enforced | resolution/heal.ts restores 5d8 plus the modifier to up to six creatures the caster picks, and resolution/spell-targets.ts keeps them within one 30-foot Sphere centered within 60 feet. |
| Mass Heal | enforced | resolution/heal.ts divides the 700 Hit Points evenly among the creatures the caster picks, none past its maximum, and ends Blinded, Deafened and Poisoned on each. A different split is the caster's to make by hand. |
| Mass Suggestion | enforced | A failed save imposes Charmed on up to twelve creatures (resolution/spell-targets.ts). What the suggestion makes them do is the GM's. |
| Maze | guided | The target leaves the map while the caster concentrates (off-plane.ts) and returns to the space it left or the nearest unoccupied one. Its DC 20 Intelligence (Investigation) check to escape is the GM's, who ends the effect. |
| Mending | guided | The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. The repair is the GM's. |
| Message | guided | The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. The whisper and its reply are the table's. |
| Mirror Image | enforced | The caster has three duplicates for a minute. Each hit on it rolls a d6 a duplicate, and on a 3 or higher the hit lands on a duplicate, which is destroyed, ending the spell with the last; an attacker Blinded or with Blindsight or Truesight is unaffected (resolution/mirror-image.ts). |
| Misty Step | enforced | granted-moves.ts gives the caster a 30-foot teleport for the turn, which movement-rules.ts takes at once to an unoccupied space it can see and refuses beyond its range. |
| Moonbeam | enforced | spell-zones.ts asks for the Constitution save against 2d10 Radiant damage on the cast and when a creature enters the Cylinder or ends its turn there, once a turn. On the caster's later turns a Magic action moves the Cylinder up to 60 feet (zone-moves.ts), and a creature it moves onto makes the save. Its Dim Light is placed for dynamic vision (vision/cast-sight.ts), and the shape-shifter's change back is the GM's. |
| Pass without Trace | enforced | zone-auras.ts gives the caster and its allies +10 to Dexterity (Stealth) checks while they stand in the 30-foot Emanation. Leaving no tracks is the GM's to narrate. |
| Phantasmal Killer | guided | The save and its 4d10 Psychic damage are applied, and a failure leaves Disadvantage on the target's ability checks and attack rolls, with the save repeated at the end of each of its turns until it succeeds (resolution/pending.ts). The 4d10 damage on each failed repeat is the GM's. |
| Plant Growth | guided | Overgrowth makes a creature spend 4 feet of movement for every foot it moves in the Sphere (zone-ground.ts), until the GM ends the area. Leaving parts of the Sphere out, and the 8-hour Enrichment, are the GM's. |
| Power Word Heal | enforced | resolution/heal.ts restores all the target's Hit Points and ends Charmed, Frightened, Paralyzed, Poisoned and Stunned, for one creature (resolution/spell-targets.ts). Standing up from Prone with its Reaction is the creature's choice. |
| Power Word Kill | enforced | resolution/kill.ts kills a target with 100 Hit Points or fewer outright, a character with no death saves, and deals 12d12 Psychic damage to any other. Death Ward turns the death aside. |
| Power Word Stun | enforced | A target with 150 Hit Points or fewer is Stunned and repeats the save at the end of each of its turns; a tougher one's Speed is 0 until the start of the caster's next turn (resolution/pending.ts). |
| Prayer of Healing | enforced | The 2d8 Hit Points are applied, each target gains a Short Rest's benefits, and a creature it healed is refused until it finishes a Long Rest (resolution/prayer-of-healing.ts). |
| Prestidigitation | guided | The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. Its minor tricks are the GM's. |
| Prismatic Wall | guided | The save against Blinded for a creature near the wall is applied. Each layer's save and effect are the GM's. |
| Protection from Poison | enforced | The cast ends Poisoned and leaves Resistance to Poison damage and Advantage on saves to avoid or end Poisoned, for an hour counted on the game clock (game-time.ts). |
| Raise Dead | enforced | resolution/revival.ts refuses a target dead more than 10 days of game time, less any time under Gentle Repose, one Undead when it died, and one whose body or head is gone. It returns with 1 Hit Point and no longer Poisoned, and takes a -4 penalty to D20 Tests that eases by 1 with each Long Rest (death.ts). |
| Regenerate | guided | The 4d8 + 15 Hit Points are applied to one creature (resolution/spell-targets.ts). The 1 Hit Point at the start of each of the target's turns, and regrowing severed parts, are the GM's. |
| Reincarnate | guided | resolution/revival.ts refuses a target dead more than 10 days and returns it with all its Hit Points in a new body, rolling the d10 for its species (a 1 rolls again) and noting it on the creature. Rebuilding the sheet with the new species, and the soul's consent, are the GM's. |
| Remove Curse | enforced | resolution/dispel.ts ends every effect marked a curse on the target (Hex, Bestow Curse, Geas), and breaks its Attunement to a cursed item so the item can be removed; the item's own curse stays. A curse the app doesn't track is the GM's. |
| Resurrection | enforced | resolution/revival.ts refuses a target dead more than a century, one Undead when it died, and one whose body is gone; a lost head is restored. It returns with all its Hit Points, no longer Poisoned, with a -4 penalty to D20 Tests that eases by 1 with each Long Rest (death.ts). For a creature dead 365 days or longer the caster can't cast spells and has Disadvantage on D20 Tests until a Long Rest. Death by old age is the GM's to rule. |
| Revivify | enforced | resolution/revival.ts refuses a target that isn't dead, died more than a minute of game time ago (death.ts keeps the time of death: a fight's rounds, then the game clock), or lost its body or its head. The cast returns it with 1 Hit Point and spends the diamond (resolution/components.ts). Death by old age is the GM's to rule. |
| Shillelagh | guided | The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. The weapon's spellcasting ability, larger damage die and Force damage are the GM's. |
| Silence | guided | zone-auras.ts makes a creature Deafened while it stands in the Sphere. Its Immunity to Thunder damage there, and the refusal of spells with a Verbal component, are the GM's. |
| Sleep | guided | A failed save imposes Incapacitated until the end of the target's next turn, and damage ends it. The second save, and Unconscious on its failure, are the GM's. |
| Sleet Storm | guided | spell-zones.ts asks for the Dexterity save when a creature enters the Cylinder or starts its turn there, and a failure leaves it Prone and ends its Concentration. zone-ground.ts makes the Cylinder Difficult Terrain of ice, and it is Heavily Obscured for dynamic vision (vision/cast-sight.ts). Dousing the flames in it is the GM's. |
| Sorcerous Burst | guided | The attack and the chosen damage type are applied. Rolling another d8 on each 8 is the GM's. |
| Spare the Dying | enforced | The cast makes a creature at 0 Hit Points Stable with no check (resolution/stabilize.ts), within 15 feet, 30 at level 5, 60 at level 11 and 120 at level 17 (resolution/spell-targets.ts). |
| Spike Growth | enforced | spell-zones.ts deals 2d4 Piercing damage for every 5 feet a creature travels into or within the Sphere, and zone-ground.ts makes the Sphere Difficult Terrain. Whether a creature saw the danger before it moved in is the GM's. |
| Spirit Guardians | enforced | spell-zones.ts asks for the save when a creature enters the Emanation or ends its turn there, and charges an affected creature double for each step it moves inside (terrain.ts). The creatures the caster designates are its allies. |
| Storm of Vengeance | guided | The first turn's save, Thunder damage and Deafened condition are applied. The storm's turns 2 to 10 are the GM's. |
| Thaumaturgy | guided | The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. Its wonders are the GM's. |
| Time Stop | guided | time-stop.ts rolls 1d4 + 1 and gives the caster that many turns in a row; an action of its that targets another creature, or a move more than 1,000 feet from where it cast the spell, ends it. An effect it created that later reaches another creature is the GM's to end it on. |
| True Resurrection | enforced | resolution/revival.ts refuses a target dead more than 200 years, and brings back one whose body is gone (Disintegrate) in a new body. It returns with all its Hit Points, its poison, curses and Contagion ended. Where a new body appears, and the stat block of an Undead returned to life, are the GM's. |
| True Strike | guided | The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. The weapon attack with the spellcasting ability, and its Radiant damage, are the GM's. |
| Tsunami | guided | The wall's first save and damage are applied. Its movement and the damage on later turns are the GM's. |
| Wall of Ice | guided | The save and its Cold damage for creatures in the wall's space are applied. The wall itself and its frigid air are the GM's. |
| Wall of Thorns | enforced | spell-zones.ts asks for the Dexterity save against 7d8 Slashing damage when a creature enters the wall or ends its turn there, once a turn, after the cast's 7d8 Piercing. zone-ground.ts makes a creature spend 4 feet of movement for every foot it moves through the wall. The wall's block on sight and its circle form are the GM's. |
| Web | enforced | spell-zones.ts asks for the Dexterity save the first time a creature enters the webs on a turn or starts its turn there, and a failure leaves it Restrained, escaped with a Strength (Athletics) check against the spell save DC. zone-ground.ts makes the webs Difficult Terrain, and they are Lightly Obscured for dynamic vision (vision/cast-sight.ts). Burning the webs away is the GM's, who ends the area. |
| Weird | guided | The save, its Psychic damage and Frightened are applied, with the repeat save at the end of each turn. The 5d10 Psychic damage on a failed repeat is the GM's. |
| Wind Wall | guided | The save and its Bludgeoning damage are applied. The projectiles the wall turns aside are the GM's. |

## Monster actions

**Enforced (912):** too many to list, so the guided and reference actions below stand out.

**Guided (53):** Adult Black Dragon: Frightful Presence · Adult Red Dragon: Commanding Presence · Adult White Dragon: Frightful Presence · Ancient Black Dragon: Frightful Presence · Ancient Red Dragon: Commanding Presence · Ancient White Dragon: Frightful Presence · Balor: Teleport · Bearded Devil: Infernal Glaive · Behir: Swallow · Centaur Trooper: Trampling Charge (Recharge 5-6) · Djinni: Create Whirlwind · Doppelganger: Read Thoughts · Dryad: Tree Stride · Dust Mephit: Sleep (1/Day) · Frost Giant: War Cry (Recharge 5-6) · Gelatinous Cube: Engulf · Ghost: Etherealness · Giant Hyena: Rampage (1/Day) · Giant Octopus: Ink Cloud (1/Day) · Gnoll Warrior: Rampage (1/Day) · Horned Devil: Infernal Tail · Ice Devil: Ice Wall (Recharge 6) · Incubus: Nightmare (Recharge 6) · Invisible Stalker: Vortex · Kraken: Swallow · Lich: Deathly Teleport · Lich: Frightening Gaze · Mummy Lord: Dread Command · Mummy Lord: Necrotic Strike · Mummy Lord: Whirlwind of Sand · Night Hag: Nightmare Haunting (1/Day) · Octopus: Ink Cloud (1/Day) · Otyugh: Bite · Pit Fiend: Hellfire Spellcasting (Recharge 4-6) · Priest Acolyte: Spellcasting · Purple Worm: Swallow · Remorhaz: Swallow · Roc: Swoop (Recharge 5-6) · Rust Monster: Reflexive Antennae · Sea Hag: Illusory Appearance · Shambling Mound: Engulf · Sphinx of Valor: Roar (3/Day) · Stone Giant: Deflect Missile (Recharge 5-6) · Storm Giant: Spellcasting · Succubus: Charm · Tarrasque: Onslaught · Tarrasque: Swallow · Tarrasque: World-Shaking Movement · Treant: Animate Trees (1/Day) · Unicorn: Shimmering Shield · Vampire: Beguile · Water Elemental: Whelm (Recharge 4-6) · Weretiger: Prowl (Tiger or Hybrid Form Only)

**Reference (27):** Black Pudding: Split · Chain Devil: Unnerving Gaze · Doppelganger: Shape-Shift · Ettercap: Reel · Giant Frog: Swallow · Giant Toad: Swallow · Goblin Boss: Redirect Attack · Imp: Shape-Shift · Mimic: Shape-Shift · Nalfeshnee: Pursuit · Night Hag: Shape-Shift · Nightmare: Ethereal Stride · Ochre Jelly: Split · Oni: Shape-Shift · Phase Spider: Ethereal Jaunt · Quasit: Shape-Shift · Roper: Reel · Rust Monster: Destroy Metal · Shield Guardian: Protection · Shrieker Fungus: Shriek · Succubus: Shape-Shift · Vampire: Shape-Shift · Werebear: Shape-Shift · Wereboar: Shape-Shift · Wererat: Shape-Shift · Weretiger: Shape-Shift · Werewolf: Shape-Shift

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Balor: Teleport | guided | A 60-foot teleport is granted (granted-moves.ts). Teleporting a willing demon within 10 feet instead is the GM's. |
| Centaur Trooper: Trampling Charge (Recharge 5-6) | guided | It can be taken move first: a move of its Speed that provokes no Opportunity Attacks is granted (granted-moves.ts), and the Strength save, damage and Prone apply to the creatures the GM picks. Passing through Medium or smaller creatures' spaces needs the GM's go-ahead on the map. |
| Dryad: Tree Stride | guided | A teleport of up to 65 feet is granted (granted-moves.ts). Whether a Large tree stands at each end is the GM's, since trees aren't on the map. |
| Giant Hyena: Rampage (1/Day) | guided | It can be taken move first: the use is spent and a move of half its Speed granted (granted-moves.ts). The Bite it then makes, and the Bloodied creature it needs to have damaged, are the GM's. |
| Giant Octopus: Ink Cloud (1/Day) | guided | The Reaction fills its 10-foot Cube with ink, Heavily Obscured for 1 minute (vision/cast-sight.ts), and gives a swim of its Swim Speed (granted-moves.ts). Offering it when the octopus takes damage underwater is the GM's. |
| Gibbering Mouther: Bite | enforced | The hit's damage, and Prone on a Medium or smaller target, are applied. A creature it drops to 0 Hit Points dies outright with nothing left of its body (hit-points.ts). |
| Gnoll Warrior: Rampage (1/Day) | guided | It can be taken move first: the use is spent and a move of half its Speed granted (granted-moves.ts). The Rend it then makes, and the Bloodied creature it needs to have damaged, are the GM's. |
| Hydra: Multiattack | enforced | effective-actions.ts makes the Multiattack one Bite per living head, which death-traits.ts counts as heads die and grow back (Multiple Heads). |
| Lich: Deathly Teleport | guided | The legendary use is spent and a 60-foot teleport granted (granted-moves.ts). Who stood within 10 feet of the space it left, for the Necrotic damage, is the GM's to pick. |
| Mummy Lord: Whirlwind of Sand | guided | The Reaction gives a 60-foot teleport (granted-moves.ts). The +2 AC against the triggering attack and the creatures it blinds are the GM's. |
| Octopus: Ink Cloud (1/Day) | guided | The Reaction fills its 5-foot Cube with ink, Heavily Obscured for 1 minute (vision/cast-sight.ts), and gives a swim of its Swim Speed (granted-moves.ts). Offering it when a creature ends its turn beside the octopus underwater is the GM's. |
| Roc: Swoop (Recharge 5-6) | guided | The recharge is spent and a flight of half its Fly Speed granted that provokes no Opportunity Attacks (granted-moves.ts). Dropping the grappled creature is the GM's, who makes it fall (actor.fall). |
| Rust Monster: Reflexive Antennae | guided | damage-reactions.ts offers it when a creature within 5 feet damages the rust monster, and using it resolves Antennae against that creature, opening its Dexterity save. It is offered on any damage, not only a hit's, so the GM declines it for a spell. |
| Sea Hag: Death Glare (Recharge 5-6) | enforced | Only a Frightened creature the hag can see within 30 feet can be targeted (resolution/action-targets.ts). On a failed save one with 20 Hit Points or fewer drops to 0, and any other takes 3d8 Psychic damage (fatal-saves.ts). |
| Solar: Slaying Bow | enforced | On a failed DC 21 Dexterity save a creature with 100 Hit Points or fewer dies outright, a character with no death saves, and Death Ward turns it aside; any other takes the Piercing and Radiant damage (fatal-saves.ts). |
| Sphinx of Wonder: Burst of Ingenuity (2/Day) | enforced | roll-answers.ts offers it on the sphinx's own check or save and asks it by a prompt about another creature's within 30 feet. Using it adds 2 to the roll, twice a day. |
| Stone Giant: Deflect Missile (Recharge 5-6) | guided | A ranged hit with Bludgeoning, Piercing or Slashing damage opens the giant's reaction prompt (damage-window.ts), and using it takes 1d10 + 6 off the damage, recharging on a 5 or 6. Redirecting the force at another creature when the damage reaches 0 is the GM's. |
| Tarrasque: Onslaught | guided | It can be taken move first: the legendary use is spent and a move of half its Speed granted (granted-moves.ts). The Claw or Tail attack it then makes is the GM's to take. |
| Tarrasque: World-Shaking Movement | guided | The legendary use is spent, a move of its Speed granted (granted-moves.ts) and its Emanation offered. Ending Concentration and knocking Medium or smaller creatures Prone in it are the GM's. |
| Weretiger: Prowl (Tiger or Hybrid Form Only) | guided | A move of its Speed that provokes no Opportunity Attacks is granted (granted-moves.ts). The Hide at the end of it is the GM's. |
| Wraith: Create Specter | enforced | resolution/revival.ts takes a Humanoid corpse within 10 feet dead no longer than 1 minute, and refuses an eighth specter. Its spirit rises as a Specter on the wraith's side in the corpse's space, acting right after the wraith (risen.ts), and the corpse leaves the fight. |

## Monster traits

The number after each trait is how many stat blocks print it.

| Record | State | How |
| --- | --- | --- |
| Abduct (2) | enforced | movement-rules.ts charges the bugbear no extra movement to drag a creature it grapples. |
| Aberrant Ground (1) | reference | The GM can paint the Emanation as difficult terrain (terrain.ts), but the painted terrain doesn't move with the mouther. |
| Acid Absorption (1) | reference | hit-points.ts applies the stat block's Immunity to Acid damage. The Hit Points it regains from that damage are the GM's to add. |
| Adhesive (1) | reference | Sticking to what touches it is the GM's to apply with the Grappled condition. |
| Agile (2) | enforced | movement-rules.ts opens no Opportunity Attack when it moves out of an enemy's reach. |
| Air Form (2) | enforced | movement-rules.ts lets the elemental end a move in another creature's space, and the map's drag preview (movePreview.ts) charges the same path. Fitting through a narrow gap is the GM's to allow. |
| Amorphous (4) | reference | A gap sized for one size smaller is passed as Difficult Terrain (terrain.ts); one narrower still, an inch wide, is the GM's to allow. |
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
| Celestial Restoration (1) | guided | death-traits.ts tells the GM as the creature dies that it may come back, and marks a body that disappears as gone (death.ts). When and where it returns are the GM's. |
| Compression (1) | reference | A gap sized for one size smaller is passed as Difficult Terrain (terrain.ts); one narrower still, an inch wide, is the GM's to allow. |
| Confer Fire Resistance (1) | reference | Granting its rider Resistance is the GM's to apply. |
| Corrosive Form (2) | guided | resolution/struck.ts deals the black pudding's 1d8 Acid damage to a creature that hits it with a melee attack. The gray ooze's printing deals none, and the damage to weapons and ammunition is the GM's. |
| Death Burst (5) | enforced | statblock-traits.ts opens the save for each creature in the Emanation when it dies, with the damage rolled once. |
| Death Throes (1) | enforced | statblock-traits.ts opens the Dexterity save for each creature within 30 feet when the balor dies, with its Fire and Force damage rolled once. Its new body in the Abyss is the GM's. |
| Demonic Restoration (5) | guided | death-traits.ts tells the GM as the creature dies that it may come back, and marks a body that disappears as gone (death.ts). When and where it returns are the GM's. |
| Diabolical Restoration (7) | guided | death-traits.ts tells the GM as the creature dies that it may come back, and marks a body that disappears as gone (death.ts). When and where it returns are the GM's. |
| Divine Awareness (2) | reference | Communication and senses like this are the GM's to run. |
| Draconic Origin (1) | reference | The GM picks the damage type and edits the stat block to match. |
| Earth Glide (2) | reference | Its Burrow Speed moves it on the map; passing through stone without a trace is the GM's to allow. |
| Eldritch Restoration (1) | guided | death-traits.ts tells the GM as the creature dies that it may come back, and marks a body that disappears as gone (death.ts). When and where it returns are the GM's. |
| Elemental Restoration (2) | guided | death-traits.ts tells the GM as the creature dies that it may come back, and marks a body that disappears as gone (death.ts). When and where it returns are the GM's. |
| Ephemeral (1) | reference | What it can carry is the GM's to rule. |
| Ethereal Sight (2) | reference | Communication and senses like this are the GM's to run. |
| Evasion (1) | enforced | saving-throws.ts takes no damage on a successful Dexterity save for half damage and half on a failure, while the assassin isn't Incapacitated. |
| Exalted Restoration (3) | guided | death-traits.ts tells the GM as the creature dies that it may come back, and marks a body that disappears as gone (death.ts). When and where it returns are the GM's. |
| Fear Aura (1) | enforced | trait-turns.ts opens the Wisdom save for each enemy that starts its turn in the aura while the pit fiend isn't Incapacitated. A failure is Frightened until the start of its next turn, and a success makes it immune for the fight. |
| Fiendish Restoration (2) | guided | death-traits.ts tells the GM as the creature dies that it may come back, and marks a body that disappears as gone (death.ts). When and where it returns are the GM's. |
| Fire Absorption (1) | reference | hit-points.ts applies the stat block's Immunity to Fire damage. The Hit Points it regains from that damage are the GM's to add. |
| Fire Aura (4) | enforced | trait-turns.ts deals the Fire damage at the end of the bearer's turns to each creature in the Emanation, or to an azer's enemies there. A fire elemental's aura also sets them burning. |
| Fire Form (1) | guided | movement-rules.ts lets the elemental end a move in a creature's space, and the map's drag preview (movePreview.ts) charges the same path. The 1d10 Fire damage when it first enters a space on a turn is the GM's to deal. |
| Flyby (7) | enforced | movement-rules.ts opens no Opportunity Attack when it flies out of an enemy's reach. |
| Freeze (1) | reference | The slower Speed after Cold damage is the GM's to apply. |
| Gibbering (1) | guided | trait-turns.ts opens the Wisdom save for each creature that starts its turn within 20 feet. The d8 table on a failure is the GM's to roll. |
| Greater Magic Resistance (1) | enforced | saving-throws.ts makes the rakshasa succeed on saves against spells and magic items without a roll, and resolution/attack.ts makes spell attack rolls miss it. Hiding from divination is the GM's. |
| Heat Aura (1) | enforced | trait-turns.ts deals 3d10 Fire damage at the end of the remorhaz's turns to each creature within 5 feet. |
| Hellish Restoration (1) | guided | death-traits.ts tells the GM as the creature dies that it may come back, and marks a body that disappears as gone (death.ts). When and where it returns are the GM's. |
| Hold Breath (6) | reference | Breathing isn't tracked. |
| Ice Walk (4) | enforced | zone-ground.ts charges the creature nothing extra on the ice a spell leaves (Ice Storm's hail, Sleet Storm). Ice and snow the GM paints as Difficult Terrain still cost it, so the GM waives that cost. |
| Illumination (5) | enforced | vision/senses.ts gives the creature its printed Bright and Dim Light, carried with its token. |
| Immutable Form (4) | reference | Shape-changing isn't modeled, so there is nothing to refuse. |
| Incorporeal Movement (4) | guided | terrain.ts passes it through walls and creatures as Difficult Terrain. The Force damage for ending a turn inside an object is the GM's, since walls are lines with no inside. |
| Incubus Form (1) | reference | Changing form is the GM's to run; the token keeps this stat block. |
| Inscrutable (2) | reference | The Disadvantage on Insight checks about it is the GM's to apply. |
| Invisibility (1) | enforced | actor-roster.ts gives the stalker the Invisible condition when it joins the roster. |
| Iron Scent (1) | reference | Communication and senses like this are the GM's to run. |
| Jumper (1) | enforced | jumping.ts measures its jumps with Dexterity in place of Strength. |
| Legendary Resistance (32) | enforced | saving-throws.ts lets the GM turn a failed save into a success, as many times a day as the stat block prints. A Long Rest restores them; the extra use in the lair is the GM's. |
| Light Sensitivity (1) | enforced | resolution/attack.ts gives the cloaker Disadvantage on attack rolls while it stands in Bright Light (vision/rules.ts). With dynamic vision off, the light is the GM's. |
| Lightning Absorption (2) | reference | hit-points.ts applies the stat block's Immunity to Lightning damage. The Hit Points it regains from that damage are the GM's to add. |
| Limited Amphibiousness (1) | reference | Breathing isn't tracked. |
| Loathsome Limbs (1) | enforced | death-traits.ts severs a limb when the troll ends any turn Bloodied after taking 15 Slashing damage or more in it, four times a day. The limb joins the fight as a Troll Limb on the troll's side in its space and acts right after the troll (risen.ts). The troll has 1 Exhaustion level for each missing limb until it next regains Hit Points, when they grow back. |
| Magic Resistance (34) | enforced | saving-throws.ts gives it Advantage on saves against spells and magic items, saves a spell asks it to repeat included. |
| Magic Rope (1) | reference | The rope and its statistics are the GM's to run. |
| Mimicry (2) | reference | Communication and senses like this are the GM's to run. |
| Misty Escape (1) | guided | death-traits.ts keeps the vampire alive at 0 Hit Points as mist that can't take actions or speak until it regains Hit Points; in sunlight, read with dynamic vision on, it is destroyed instead. The mist form's statistics, running water and the 2 hours to reach its resting place are the GM's. |
| Mucus Cloud (1) | reference | The save at the end of the aboleth's turn and its curse are the GM's to run. |
| Multiple Heads (1) | enforced | death-traits.ts kills one head on each turn the hydra takes 25 damage or more, and the hydra with its last. At the end of its turn it grows two heads for each one lost since its last turn and regains 20 Hit Points, unless it took Fire damage since then. Its Multiattack makes one Bite per living head (effective-actions.ts). |
| Ooze Cube (1) | reference | Entering the cube, and pulling a creature out, are the GM's to run with its Engulf. |
| Pack Tactics (18) | enforced | resolution/attack.ts gives Advantage when an ally of the attacker that isn't Incapacitated is within 5 feet of the target. |
| Probing Telepathy (1) | reference | Communication and senses like this are the GM's to run. |
| Reactive (1) | enforced | encounter.ts gives the marilith a fresh Reaction at the start of every turn. |
| Reactive Heads (1) | reference | The extra Reactions are the GM's to allow. |
| Reflective Carapace (1) | reference | The d6 against spells aimed at it is the GM's to roll. |
| Regeneration (4) | enforced | trait-turns.ts restores the Hit Points at the start of its turns, stopped for a turn by the damage types it names. statblock-traits.ts keeps a troll at 0 Hit Points alive until a turn starts without regenerating. |
| Running Leap (2) | enforced | jumping.ts lets it Long Jump the printed distance after 10 feet of movement, half from a standing start. |
| Sense Magic (1) | reference | Communication and senses like this are the GM's to run. |
| Shark Telepathy (1) | reference | Communication and senses like this are the GM's to run. |
| Shielded Mind (1) | reference | Communication and senses like this are the GM's to run. |
| Siege Monster (4) | reference | Objects and structures have no Hit Points in the app. |
| Soul Bag (1) | reference | The bag and its statistics are the GM's to run. |
| Speak with Beasts and Plants (1) | reference | Communication and senses like this are the GM's to run. |
| Spell Storing (1) | reference | Storing and casting the spell is the GM's to run. |
| Spider Climb (14) | enforced | speed.ts moves it at its Climb Speed with no extra cost and no check, and a climb may change its height on the map (altitude.ts). Which surfaces it climbs is the GM's, as walls have no height. |
| Spirit Jar (1) | guided | death-traits.ts tells the GM as the creature dies that it may come back, and marks a body that disappears as gone (death.ts). When and where it returns are the GM's. |
| Standing Leap (3) | enforced | jumping.ts lets it jump the printed Long and High Jump distances with or without a running start. |
| Stench (2) | enforced | trait-turns.ts opens the Constitution save for each creature that starts its turn within 5 feet. A failure is Poisoned until the start of its next turn, and a success makes it immune for the fight. |
| Succubus Form (1) | reference | Changing form is the GM's to run; the token keeps this stat block. |
| Sunlight Sensitivity (5) | enforced | resolution/attack.ts and ability-checks.ts give it Disadvantage on attack rolls and ability checks while it stands in sunlight (vision/rules.ts). With dynamic vision off, the light is the GM's. |
| Sunlight Weakness (1) | enforced | resolution/attack.ts, ability-checks.ts and saving-throws.ts give it Disadvantage on D20 Tests while it stands in sunlight (vision/rules.ts). With dynamic vision off, the light is the GM's. |
| Swarm (7) | guided | movement-rules.ts and terrain.ts let the swarm and other creatures share a space, and the map's drag preview (movePreview.ts) charges the same path. Refusing it Hit Points and Temporary Hit Points is the GM's. |
| Telepathic Bond (1) | reference | Communication and senses like this are the GM's to run. |
| Training (1) | reference | The GM picks the skill and applies its Advantage. |
| Transparent (1) | reference | Noticing the cube is the GM's call, with the DC the trait prints. |
| Treasure Sense (1) | reference | Communication and senses like this are the GM's to run. |
| Troll Spawn (1) | reference | What becomes of a severed limb is the GM's to run. |
| Tunneler (2) | reference | Tunnels aren't drawn on the map; the GM places them. |
| Undead Fortitude (2) | enforced | statblock-traits.ts rolls the Constitution save of DC 5 plus the damage when damage drops it to 0, and leaves it at 1 Hit Point on a success. Radiant damage and Critical Hits get no save. |
| Undead Restoration (1) | guided | death-traits.ts tells the GM as the creature dies that it may come back, and marks a body that disappears as gone (death.ts). When and where it returns are the GM's. |
| Vampire Weakness (2) | guided | trait-turns.ts deals the vampire 20 Radiant damage when it starts its turn in sunlight, where resolution/attack.ts and ability-checks.ts give it Disadvantage on attack rolls and ability checks (vision/rules.ts). Running water, invitations and the stake are the GM's. |
| Vampiric Connection (1) | reference | Communication and senses like this are the GM's to run. |
| Vile Appearance (1) | enforced | trait-turns.ts opens the Wisdom save for each Beast or Humanoid that starts its turn within 30 feet of the hag. A failure is Frightened until the start of its next turn, and a success makes it immune for the fight. With dynamic vision on, only a creature that sees the hag (vision/sight.ts) makes the save; whether the hag is disguised is the GM's. |
| Water Breathing (9) | reference | Breathing isn't tracked. |
| Water Form (1) | enforced | movement-rules.ts lets the elemental end a move in another creature's space, and the map's drag preview (movePreview.ts) charges the same path. Fitting through a narrow gap is the GM's to allow. |
| Water Susceptibility (1) | reference | Water on the map isn't tracked, so the Cold damage is the GM's to deal. |
| Web Walker (5) | enforced | Web's webs cost the creature nothing extra (zone-ground.ts), and spell-zones.ts asks it for no save there. Webs the GM paints as Difficult Terrain still cost it, so the GM waives that cost. |
| Wishes (2) | reference | The djinni's wishes are the GM's to run. |

## Barbarian features

**Enforced (21):** Ability Score Improvement · Barbarian Subclass · Brutal Strike · Danger Sense · Epic Boon · Extra Attack · Fast Movement · Feral Instinct · Improved Brutal Strike · Instinctive Pounce · Intimidating Presence (Path of the Berserker) · Mindless Rage (Path of the Berserker) · Persistent Rage · Primal Champion · Primal Knowledge · Rage · Reckless Attack · Relentless Rage · Retaliation (Path of the Berserker) · Unarmored Defense · Weapon Mastery

**Reference (2):** Frenzy (Path of the Berserker) · Indomitable Might

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Brutal Strike | enforced | After Reckless Attack, the tap forgoes the Advantage of the Barbarian's next Strength attack this turn (resolution/attack.ts), and its hit carries 1d10 of the weapon's type and one effect (resolution/hit-options.ts): Forceful Blow's 15-foot push and a move of half its Speed that must end nearer the target and provokes no Opportunity Attacks (granted-moves.ts), or Hamstring Blow's 15 feet less Speed, one at a time on a creature. |
| Improved Brutal Strike | enforced | Staggering Blow (Disadvantage on the next save and no Opportunity Attacks) and Sundering Blow (+5 to the next attack roll another creature makes against the target) join Brutal Strike's effects, and from Barbarian 17 a hit carries 2d10 and two effects (resolution/hit-options.ts, resolution/attack.ts). |
| Instinctive Pounce | enforced | The Bonus Action that starts a Rage gives the Barbarian a move of half its Speed for the turn (resolution/movement-grants.ts), charged to its own grant (movement-rules.ts). |
| Intimidating Presence (Path of the Berserker) | enforced | The Bonus Action's Wisdom save against Frightened is applied, and conversions.ts restores its use for one use of Rage (actor.convert). |
| Mindless Rage (Path of the Berserker) | enforced | Immunity to Charmed and Frightened while raging is applied (equipment-derivation.ts), and either condition ends as the Rage starts (resolution/grant.ts). |
| Persistent Rage | enforced | When the Barbarian rolls Initiative, initiative-hooks.ts opens its window and the Persistent Rage action restores every expended use of Rage, once per Long Rest (resolution/rage.ts). A Rage under it lasts 10 minutes, and only Unconscious ends it early (effects.ts). |
| Primal Knowledge | enforced | The extra skill is applied. While raging, Acrobatics, Intimidation, Perception, Stealth and Survival checks are made as Strength checks when that is the better roll (ability-checks.ts). |
| Relentless Rage | enforced | hit-points.ts rolls the Constitution save when a raging Barbarian drops to 0 Hit Points and isn't killed outright: DC 10, 5 more for each use since its last rest (rests.ts clears the count). A success leaves it at twice its Barbarian level. |
| Weapon Mastery | enforced | equipment-derivation.ts applies the mastery property of each picked weapon kind. A Barbarian picks melee weapons and a Rogue the weapons it is proficient with. In the step a Long Rest opens, actor.rechoose swaps picks and rebuilds the sheet (ledger-rechoice.ts): one for a Barbarian or Fighter, any for a Paladin, Ranger or Rogue. |

## Bard features

**Enforced (15):** Ability Score Improvement · Bard Subclass · Bonus Proficiencies (College of Lore) · Countercharm · Cutting Words (College of Lore) · Epic Boon · Expertise · Font of Inspiration · Jack of All Trades · Magical Discoveries (College of Lore) · Magical Secrets · Peerless Skill (College of Lore) · Spellcasting · Superior Inspiration · Words of Creation

**Guided (1):** Bardic Inspiration

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Bardic Inspiration | guided | The Bonus Action gives another creature the Bard's die, a d6 growing to a d12, one die at a time, and roll-answers.ts offers it when that creature fails an attack roll, a save, a check or a death save: the die is added and spent. Measuring the 60 feet, and ending an unused die after an hour, are the GM's. |
| Countercharm | enforced | roll-answers.ts asks the Bard by a reaction prompt when it or a creature within 30 feet fails a save against an effect that would make it Charmed or Frightened. The save waits, and using the Reaction rerolls it with Advantage. |
| Cutting Words (College of Lore) | enforced | roll-answers.ts asks the Bard by a reaction prompt when a creature it can see within 60 feet hits with an attack roll, succeeds on a check or rolls damage. Using it spends a Bardic Inspiration use and the Reaction and takes the die off the roll, which can turn the hit into a miss or lower the damage before it lands (damage-window.ts). |
| Font of Inspiration | enforced | Bardic Inspiration comes back on a Short Rest, and conversions.ts spends a spell slot for one use of it. |
| Jack of All Trades | enforced | ability-checks.ts adds half the Proficiency Bonus, rounded down, to a skill check the Bard isn't proficient in. |
| Peerless Skill (College of Lore) | enforced | roll-answers.ts offers it on the Bard's failed attack roll or check: the Bardic Inspiration die is added, and the use is kept when the roll still fails. |
| Spellcasting | enforced | character-build.ts gives the class its slots, cantrips and prepared spells, and each spell is a cast action at the class's spell save DC and attack bonus. resolution/economy.ts spends the slot, and rests.ts restores slots on a Long Rest. level-up-picks.ts lets a player's level up replace only the cantrips and spells the class's level allows. |
| Superior Inspiration | enforced | When the Bard rolls Initiative with fewer than two uses of Bardic Inspiration left, initiative-hooks.ts brings it up to two. |
| Words of Creation | enforced | Power Word Heal and Power Word Kill are always prepared, and either may take a second creature within 10 feet of the first (resolution/action-targets.ts). |

## Cleric features

**Enforced (11):** Ability Score Improvement · Blessed Strikes · Channel Divinity · Cleric Subclass · Epic Boon · Life Domain Spells (Level 5) (Life Domain) · Life Domain Spells (Level 7) (Life Domain) · Life Domain Spells (Level 9) (Life Domain) · Life Domain Spells (Life Domain) · Preserve Life (Life Domain) · Spellcasting

**Guided (3):** Divine Intervention · Divine Order · Improved Blessed Strikes

**Reference (5):** Blessed Healer (Life Domain) · Disciple of Life (Life Domain) · Greater Divine Intervention · Sear Undead · Supreme Healing (Life Domain)

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Divine Order | guided | Protector's training and Thaumaturge's extra cantrip are applied. Thaumaturge's bonus to Arcana and Religion checks is the GM's. |
| Spellcasting | enforced | character-build.ts gives the class its slots, cantrips and prepared spells, and each spell is a cast action at the class's spell save DC and attack bonus. resolution/economy.ts spends the slot, and rests.ts restores slots on a Long Rest. level-up-picks.ts lets a player's level up replace only the cantrips and spells the class's level allows. |

## Druid features

**Enforced (17):** Ability Score Improvement · Archdruid · Circle of the Land Spells (Circle of the Land) · Circle of the Land Spells (Level 5) (Circle of the Land) · Circle of the Land Spells (Level 7) (Circle of the Land) · Circle of the Land Spells (Level 9) (Circle of the Land) · Druid Subclass · Druidic · Elemental Fury · Epic Boon · Improved Elemental Fury · Natural Recovery (Circle of the Land) · Nature's Ward (Circle of the Land) · Spellcasting · Wild Companion · Wild Resurgence · Wild Shape

**Guided (3):** Land's Aid (Circle of the Land) · Nature's Sanctuary (Circle of the Land) · Primal Order

**Reference (1):** Beast Spells

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Archdruid | enforced | When the Druid rolls Initiative with no use of Wild Shape left, initiative-hooks.ts restores one. conversions.ts turns uses of Wild Shape into one spell slot, two levels a use, once per Long Rest (Nature Magician). Its slow aging is narrative. |
| Elemental Fury | enforced | Primal Strike's extra damage, of the type the Druid picks, is applied once a turn. Potent Spellcasting adds the Druid's Wisdom modifier to the damage of Poison Spray, Produce Flame and Starry Wisp. |
| Improved Elemental Fury | enforced | Primal Strike deals 2d8. Improved Potent Spellcasting adds 300 feet to a Druid cantrip of 10 feet or more (effective-actions.ts, resolution/spell-targets.ts). |
| Land's Aid (Circle of the Land) | guided | The save and its Necrotic damage against the Druid's spell save DC are applied, and a use of Wild Shape is spent. Healing the creature it picks is the GM's. |
| Natural Recovery (Circle of the Land) | enforced | In the step a Short Rest opens, conversions.ts recovers slots of combined level up to half the Druid level, none of level 6 or higher, once per Long Rest. |
| Primal Order | guided | Magician's extra cantrip and Warden's training are applied. The Wisdom bonus to the checks each role names is the GM's. |
| Spellcasting | enforced | character-build.ts gives the class its slots, cantrips and prepared spells, and each spell is a cast action at the class's spell save DC and attack bonus. resolution/economy.ts spends the slot, and rests.ts restores slots on a Long Rest. level-up-picks.ts lets a player's level up replace only the cantrips and spells the class's level allows. |
| Wild Resurgence | enforced | conversions.ts spends a spell slot for a use of Wild Shape once a turn, and a use of Wild Shape for a level 1 slot once per Long Rest. |

## Fighter features

**Enforced (18):** Ability Score Improvement · Action Surge · Additional Fighting Style (Champion) · Epic Boon · Extra Attack · Fighter Subclass · Fighting Style · Heroic Warrior (Champion) · Improved Critical (Champion) · Indomitable · Remarkable Athlete (Champion) · Second Wind · Superior Critical (Champion) · Tactical Mind · Tactical Shift · Three Extra Attacks · Two Extra Attacks · Weapon Mastery

**Reference (3):** Studied Attacks · Survivor (Champion) · Tactical Master

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Action Surge | enforced | resolution/economy.ts gives one more action on the Fighter's own turn, once a turn, and refuses it for the Magic action. |
| Heroic Warrior (Champion) | enforced | turn-boundaries.ts gives the Champion Heroic Inspiration at the start of its turn in a fight when it has none. |
| Indomitable | enforced | roll-answers.ts offers it on the Fighter's failed save: the save is rerolled with the Fighter level added, and the new roll stands. |
| Tactical Mind | enforced | roll-answers.ts offers it on the Fighter's failed check: a Second Wind use adds 1d10 to the check, and the use is kept when the check still fails. |
| Tactical Shift | enforced | Second Wind gives the Fighter a move of half its Speed for the turn that provokes no Opportunity Attacks (resolution/movement-grants.ts), charged to its own grant (movement-rules.ts). |
| Weapon Mastery | enforced | equipment-derivation.ts applies the mastery property of each picked weapon kind. A Barbarian picks melee weapons and a Rogue the weapons it is proficient with. In the step a Long Rest opens, actor.rechoose swaps picks and rebuilds the sheet (ledger-rechoice.ts): one for a Barbarian or Fighter, any for a Paladin, Ranger or Rogue. |

## Monk features

**Enforced (24):** Ability Score Improvement · Body and Mind · Deflect Energy · Disciplined Survivor · Epic Boon · Evasion · Extra Attack · Martial Arts · Monk Subclass · Monk's Focus · Open Hand Technique (Warrior of the Open Hand) · Perfect Focus · Quivering Palm (Warrior of the Open Hand) · Slow Fall · Stunning Strike · Superior Defense · Unarmored Defense · Unarmored Movement (level 2) · Unarmored Movement (level 6) · Unarmored Movement (level 10) · Unarmored Movement (level 14) · Unarmored Movement (level 18) · Uncanny Metabolism · Wholeness of Body (Warrior of the Open Hand)

**Guided (2):** Deflect Attacks · Heightened Focus

**Reference (4):** Acrobatic Movement · Empowered Strikes · Fleet Step (Warrior of the Open Hand) · Self-Restoration

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Deflect Attacks | guided | A hit whose damage includes Bludgeoning, Piercing or Slashing opens a reaction prompt (damage-window.ts), and using it takes 1d10 plus the Dexterity modifier and Monk level off the damage before it lands. Redirecting the attack's force for a Focus Point after reducing it to 0 is the GM's. |
| Deflect Energy | enforced | character-build.ts lets Deflect Attacks meet a hit of any damage type from Monk level 13 (damage-window.ts). |
| Evasion | enforced | saving-throws.ts takes no damage on a successful Dexterity save for half damage and half on a failure, while the creature isn't Incapacitated. |
| Heightened Focus | guided | Flurry of Blows makes three strikes from Monk level 10 (Monk's Focus carries it). The Temporary Hit Points from Patient Defense and the creature carried by Step of the Wind are the GM's. |
| Martial Arts | enforced | builtin-actions.ts offers an Unarmed Strike as a Bonus Action, and resolution/attack.ts rolls Unarmed Strikes and Monk weapons with the Martial Arts die and the better of Strength and Dexterity. |
| Open Hand Technique (Warrior of the Open Hand) | enforced | A Flurry of Blows hit carries Addle, Push or Topple (resolution/hit-options.ts): no Opportunity Attacks until the target's next turn, a Strength save against a 15-foot push, or a Dexterity save against Prone. |
| Perfect Focus | enforced | When the Monk rolls Initiative with 3 Focus Points or fewer, initiative-hooks.ts brings them up to 4. |
| Quivering Palm (Warrior of the Open Hand) | enforced | An Unarmed Strike's hit can spend 4 Focus Points to set the vibrations on its target, one creature at a time (resolution/hit-rider-outcomes.ts). The ending action targets only that creature: a Constitution save for 10d12 Force, half on a success. The days they last are the GM's. |
| Stunning Strike | enforced | It rides a hit with a Monk weapon or an Unarmed Strike (resolution/hit-options.ts), never tapped alone: a target that fails its Constitution save against the Monk's DC is Stunned until the start of the Monk's next turn, once a turn for a Focus Point. On a success resolution/pending.ts halves its Speed until then (speed.ts), and the next attack roll against it before then has Advantage and spends it (resolution/attack.ts). |
| Uncanny Metabolism | enforced | When the Monk rolls Initiative, initiative-hooks.ts offers it: all Focus Points back and Hit Points equal to its Monk level plus a Martial Arts die, once per Long Rest (conversions.ts). |

## Paladin features

**Enforced (23):** Ability Score Improvement · Aura Expansion · Aura of Courage · Aura of Devotion (Oath of Devotion) · Aura of Protection · Channel Divinity · Epic Boon · Extra Attack · Faithful Steed · Fighting Style · Holy Nimbus (Oath of Devotion) · Lay On Hands · Oath of Devotion Spells (Level 5) (Oath of Devotion) · Oath of Devotion Spells (Level 9) (Oath of Devotion) · Oath of Devotion Spells (Level 13) (Oath of Devotion) · Oath of Devotion Spells (Level 17) (Oath of Devotion) · Oath of Devotion Spells (Oath of Devotion) · Paladin Subclass · Paladin's Smite · Radiant Strikes · Smite of Protection (Oath of Devotion) · Spellcasting · Weapon Mastery

**Guided (3):** Abjure Foes · Restoring Touch · Sacred Weapon (Oath of Devotion)

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Abjure Foes | guided | The Wisdom save against the Paladin's spell save DC, its Frightened and the Channel Divinity use are applied, on up to the Charisma modifier's number of creatures it can see within 60 feet (resolution/action-targets.ts). resolution/economy.ts holds the frightened creature to one of an action or a Bonus Action on its turn; a move after acting is the GM's. |
| Aura Expansion | enforced | saving-throws.ts widens Aura of Protection to 30 feet. |
| Aura of Courage | enforced | paladin-auras.ts makes the Paladin and its allies in its Aura of Protection immune to Frightened while it isn't Incapacitated, and an ally already Frightened has no Disadvantage from it there (resolution/attack.ts, check-rolls.ts). |
| Aura of Devotion (Oath of Devotion) | enforced | paladin-auras.ts makes the Paladin and its allies in its Aura of Protection immune to Charmed while it isn't Incapacitated, and an ally already Charmed may target its charmer while there (resolution/economy.ts). |
| Aura of Protection | enforced | saving-throws.ts adds the Paladin's Charisma modifier, at least 1, to its own saves and its allies' within 10 feet, while it isn't Incapacitated. A creature in two auras gets the better one. |
| Holy Nimbus (Oath of Devotion) | enforced | The Bonus Action puts Holy Nimbus on the Paladin for 10 minutes. turn-boundaries.ts deals its Radiant damage to an enemy that starts its turn in the aura, and saving-throws.ts gives the Paladin Advantage on saves a Fiend or an Undead forces. Its 30 feet of sunlight is carried with the Paladin's token (vision/senses.ts), which Sunlight Sensitivity reads. conversions.ts restores the use with a level 5 slot. |
| Lay On Hands | enforced | The Bonus Action spends the points the Paladin picks to heal one creature it touches, within 5 feet (resolution/action-targets.ts), or 5 points to end Poisoned. |
| Restoring Touch | guided | From Paladin 14, Lay on Hands spends 5 points to end one of Blinded, Charmed, Deafened, Frightened, Paralyzed or Stunned on a creature it touches (resolution/heal.ts). Ending several in one Bonus Action takes one use each here. |
| Sacred Weapon (Oath of Devotion) | guided | A use of Channel Divinity puts Sacred Weapon on the Paladin for 10 minutes, and its 20 feet of Bright Light and 20 of Dim are carried with the Paladin's token (vision/senses.ts). The Charisma bonus to attack rolls with the weapon and its Radiant damage are the GM's. |
| Smite of Protection (Oath of Devotion) | enforced | resolution/hit-options.ts marks the Paladin when Divine Smite rides a hit, and until its next turn the creatures in its aura have Half Cover against attacks and on Dexterity saves (resolution/validate.ts, resolution/pending.ts). |
| Spellcasting | enforced | character-build.ts gives the class its slots, cantrips and prepared spells, and each spell is a cast action at the class's spell save DC and attack bonus. resolution/economy.ts spends the slot, and rests.ts restores slots on a Long Rest. level-up-picks.ts lets a player's level up replace only the cantrips and spells the class's level allows. |
| Weapon Mastery | enforced | equipment-derivation.ts applies the mastery property of each picked weapon kind. A Barbarian picks melee weapons and a Rogue the weapons it is proficient with. In the step a Long Rest opens, actor.rechoose swaps picks and rebuilds the sheet (ledger-rechoice.ts): one for a Barbarian or Fighter, any for a Paladin, Ranger or Rogue. |

## Ranger features

**Enforced (17):** Ability Score Improvement · Defensive Tactics (Hunter) · Deft Explorer · Epic Boon · Expertise · Extra Attack · Favored Enemy · Feral Senses · Fighting Style · Nature's Veil · Ranger Subclass · Relentless Hunter · Roving · Spellcasting · Superior Hunter's Defense (Hunter) · Tireless · Weapon Mastery

**Guided (2):** Hunter's Prey (Hunter) · Superior Hunter's Prey (Hunter)

**Reference (3):** Foe Slayer · Hunter's Lore (Hunter) · Precise Hunter

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Defensive Tactics (Hunter) | enforced | Escape the Horde gives Opportunity Attacks against the Ranger Disadvantage, and Multiattack Defense marks a creature that hit it (resolution/struck.ts). The option is swapped after a Short or Long Rest (ledger-rechoice.ts). |
| Hunter's Prey (Hunter) | guided | The option is picked at build and swapped after a Short or Long Rest (ledger-rechoice.ts). Colossus Slayer's extra die and Horde Breaker's attack are the GM's. |
| Relentless Hunter | enforced | hit-points.ts opens no Concentration save from damage when the only spell the Ranger concentrates on is Hunter's Mark. |
| Spellcasting | enforced | character-build.ts gives the class its slots, cantrips and prepared spells, and each spell is a cast action at the class's spell save DC and attack bonus. resolution/economy.ts spends the slot, and rests.ts restores slots on a Long Rest. level-up-picks.ts lets a player's level up replace only the cantrips and spells the class's level allows. |
| Superior Hunter's Defense (Hunter) | enforced | damage-window.ts offers it when the Ranger is about to take damage from a hit or a failed save. Using it gives Resistance to the damage's largest type, that damage included, until the end of the current turn. |
| Superior Hunter's Prey (Hunter) | guided | The tap deals the mark's 1d6 Force (1d10 from Foe Slayer) to one other creature the Ranger can see, once a turn. That the marked creature took the Ranger's damage this turn, and the 30 feet from it, are the GM's. |
| Weapon Mastery | enforced | equipment-derivation.ts applies the mastery property of each picked weapon kind. A Barbarian picks melee weapons and a Rogue the weapons it is proficient with. In the step a Long Rest opens, actor.rechoose swaps picks and rebuilds the sheet (ledger-rechoice.ts): one for a Barbarian or Fighter, any for a Paladin, Ranger or Rogue. |

## Rogue features

**Enforced (19):** Ability Score Improvement · Cunning Action · Cunning Strike · Devious Strikes · Epic Boon · Evasion · Expertise · Improved Cunning Strike · Reliable Talent · Rogue Subclass · Second-Story Work (Thief) · Slippery Mind · Sneak Attack · Steady Aim · Stroke of Luck · Thieves' Cant · Uncanny Dodge · Use Magic Device (Thief) · Weapon Mastery

**Guided (2):** Fast Hands (Thief) · Supreme Sneak (Thief)

**Reference (2):** Elusive · Thief's Reflexes (Thief)

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Cunning Action | enforced | builtin-actions.ts offers Dash, Disengage and Hide as Bonus Actions, and each resolves as its action does. |
| Cunning Strike | enforced | Sneak Attack's hit can trade dice for Poison (with a Poisoner's Kit), Trip or Withdraw, with saves against 8 + Dexterity + Proficiency Bonus (resolution/hit-options.ts). Withdraw's move of half the Rogue's Speed provokes no Opportunity Attacks (granted-moves.ts). |
| Devious Strikes | enforced | Daze (one of moving, an action or a Bonus Action, resolution/economy.ts), Knock Out (Unconscious that ends on damage, with repeat saves) and Obscure (Blinded) join Cunning Strike's effects. A Dazed creature's move after acting is the GM's. |
| Evasion | enforced | saving-throws.ts takes no damage on a successful Dexterity save for half damage and half on a failure, while the creature isn't Incapacitated. |
| Improved Cunning Strike | enforced | A Sneak Attack hit carries two Cunning Strike effects (resolution/hit-options.ts). |
| Reliable Talent | enforced | ability-checks.ts treats a d20 of 9 or lower as a 10 on a check with a skill or tool the Rogue is proficient in. |
| Stroke of Luck | enforced | roll-answers.ts offers it on the Rogue's failed D20 Test: the d20 becomes a 20, which makes an attack roll a Critical Hit, and the use returns on a Short or Long Rest. |
| Supreme Sneak (Thief) | guided | Stealth Attack joins Cunning Strike's effects, and the attack leaves the Rogue's Invisible from the Hide action on (resolution/release.ts). Whether it ends the turn behind Three-Quarters or Total Cover is the GM's, said with the hit. |
| Use Magic Device (Thief) | enforced | The fourth attuned item is applied (inventory.ts), and resolution/charges.ts rolls the d6 when an item's charges are spent, giving them back on a 6. Reading any Spell Scroll is the GM's. |
| Weapon Mastery | enforced | equipment-derivation.ts applies the mastery property of each picked weapon kind. A Barbarian picks melee weapons and a Rogue the weapons it is proficient with. In the step a Long Rest opens, actor.rechoose swaps picks and rebuilds the sheet (ledger-rechoice.ts): one for a Barbarian or Fighter, any for a Paladin, Ranger or Rogue. |

## Sorcerer features

**Enforced (17):** Ability Score Improvement · Arcane Apotheosis · Draconic Resilience (Draconic Sorcery) · Draconic Spells (Draconic Sorcery) · Draconic Spells (Level 5) (Draconic Sorcery) · Draconic Spells (Level 7) (Draconic Sorcery) · Draconic Spells (Level 9) (Draconic Sorcery) · Dragon Companion (Draconic Sorcery) · Dragon Wings (Draconic Sorcery) · Epic Boon · Font of Magic · Innate Sorcery · Metamagic · Sorcerer Subclass · Sorcerous Restoration · Sorcery Incarnate · Spellcasting

**Guided (1):** Elemental Affinity (Draconic Sorcery)

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Arcane Apotheosis | enforced | While Innate Sorcery is active, the first Metamagic option on each of the Sorcerer's turns in a fight costs no Sorcery Points (resolution/metamagic.ts). |
| Dragon Wings (Draconic Sorcery) | enforced | The Bonus Action gives a Fly Speed of 60 feet, once per Long Rest, and conversions.ts restores the use for 3 Sorcery Points. |
| Elemental Affinity (Draconic Sorcery) | guided | Resistance to the chosen type is applied, and the Charisma modifier is added to a spell's damage of that type, never a weapon's (resolution/damage.ts). A spell of several rolls gets it on each, which the GM trims to one. |
| Font of Magic | enforced | conversions.ts turns a spell slot into Sorcery Points equal to its level, and Sorcery Points into a slot at the SRD costs (2, 3, 5, 6 or 7 for levels 1 to 5, each at its Sorcerer level) as a Bonus Action. A created slot is gone after a Long Rest, which sets the slots to their maximum. |
| Metamagic | enforced | A cast carries one Metamagic option the Sorcerer knows, paid in Sorcery Points and applied by the server (resolution/metamagic.ts, resolution/economy.ts). Empowered Spell can join another option, and Seeking Spell is offered when a spell attack misses (roll-answers.ts). The server refuses an option the spell can't take, and picks the dice Empowered Spell rerolls. Careful Spell covers the save the cast itself calls for (resolution/pending.ts). |
| Sorcerous Restoration | enforced | In the step a Short Rest opens, conversions.ts restores Sorcery Points up to half the Sorcerer level, once per Long Rest. |
| Sorcery Incarnate | enforced | While Innate Sorcery is active, a cast may carry two Metamagic options (resolution/metamagic.ts), and with no use of Innate Sorcery left conversions.ts spends 2 Sorcery Points for one. |
| Spellcasting | enforced | character-build.ts gives the class its slots, cantrips and prepared spells, and each spell is a cast action at the class's spell save DC and attack bonus. resolution/economy.ts spends the slot, and rests.ts restores slots on a Long Rest. level-up-picks.ts lets a player's level up replace only the cantrips and spells the class's level allows. |

## Warlock features

**Enforced (17):** Ability Score Improvement · Contact Patron · Dark One's Own Luck (Fiend Patron) · Eldritch Master · Epic Boon · Fiend Spells (Fiend Patron) · Fiend Spells (Level 5) (Fiend Patron) · Fiend Spells (Level 7) (Fiend Patron) · Fiend Spells (Level 9) (Fiend Patron) · Fiendish Resilience (Fiend Patron) · Magical Cunning · Mystic Arcanum (level 6 spell) · Mystic Arcanum (level 7 spell) · Mystic Arcanum (level 8 spell) · Mystic Arcanum (level 9 spell) · Pact Magic · Warlock Subclass

**Guided (2):** Eldritch Invocations · Hurl Through Hell (Fiend Patron)

**Reference (1):** Dark One's Blessing (Fiend Patron)

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Contact Patron | enforced | Contact Other Plane is always prepared and cast once per Long Rest with no slot, and that cast succeeds on its own Intelligence save with no roll (resolution/pending.ts). What the patron answers is the GM's. |
| Dark One's Own Luck (Fiend Patron) | enforced | roll-answers.ts offers it on the Warlock's check or save once the roll is seen: 1d10 is added, and a use is spent. |
| Eldritch Invocations | guided | Agonizing Blast's damage, Eldritch Spear's range on a spell attack, Repelling Blast's push (resolution/masteries.ts), Eldritch Mind's Advantage and the free casts are applied, and level-up-picks.ts lets a level up replace one invocation. Eldritch Smite's Pact Magic slot dice and Prone, and Lifedrinker's damage and Hit Point Die, ride a pact weapon's hit (resolution/hit-options.ts). Devil's Sight and Witch Sight are senses dynamic vision reads (vision/senses.ts), and One with Shadows' Invisibility is refused in Bright Light (resolution/validate.ts). Lessons of the First Ones, Gaze of Two Minds, Gift of the Protectors and Investment of the Chain Master are the GM's. |
| Eldritch Master | enforced | Magical Cunning restores every expended Pact Magic slot (conversions.ts). |
| Hurl Through Hell (Fiend Patron) | guided | It rides an attack roll's hit once a Long Rest: the Charisma save, 8d10 Psychic unless the target is a Fiend, and Incapacitated off the map with nothing able to target it until the end of the Warlock's next turn, when it returns to the space it left or the nearest unoccupied one (off-plane.ts). conversions.ts restores the use with a Pact Magic slot. |
| Magical Cunning | enforced | Outside a fight, conversions.ts restores expended Pact Magic slots up to half the maximum, once per Long Rest. |
| Pact Magic | enforced | character-build.ts gives the Warlock its Pact Magic slots at the level its table prints, and resolution/economy.ts spends them. rests.ts restores them on a Short or Long Rest. |

## Wizard features

**Enforced (10):** Ability Score Improvement · Arcane Recovery · Epic Boon · Evocation Savant (Evoker) · Memorize Spell · Potent Cantrip (Evoker) · Scholar · Sculpt Spells (Evoker) · Spellcasting · Wizard Subclass

**Guided (4):** Empowered Evocation (Evoker) · Overchannel (Evoker) · Signature Spells · Spell Mastery

**Reference (1):** Ritual Adept

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Arcane Recovery | enforced | In the step a Short Rest opens, conversions.ts recovers slots of combined level up to half the Wizard level, none of level 6 or higher, once per Long Rest. |
| Empowered Evocation (Evoker) | guided | The Intelligence modifier is added to an Evocation spell's damage (resolution/damage.ts). A spell of several rolls (Scorching Ray's rays) gets it on each, which the GM trims to one. |
| Memorize Spell | enforced | Finishing a Short Rest opens a prepare step with one change (rests.ts): one prepared spell swapped for another from the spellbook. |
| Overchannel (Evoker) | guided | A cast sent with overchannel (action.resolve) deals a Wizard spell's maximum damage with a level 1 to 5 slot, and from the second use before a Long Rest the Evoker takes 2d12 Necrotic a slot level, 1d12 more each time, past its defences (resolution/overchannel.ts). The sheet has no control for it yet, so the table asks for it through the API. |
| Potent Cantrip (Evoker) | enforced | resolution/damage.ts deals half an Evoker's cantrip damage on a missed attack roll, and resolution/pending.ts halves it on a successful save, with no other effect. |
| Sculpt Spells (Evoker) | enforced | An Evoker's Evocation spell protects up to 1 plus the spell's level creatures the Wizard can see: they succeed on its save with no roll and take no damage (resolution/pending.ts). Saves its area calls for later are rolled as usual. |
| Signature Spells | guided | Both spells are always prepared, and each is cast once at level 3 with no slot, back on a Short or Long Rest, on its own counter (character-build.ts). That they come from the spellbook is the player's to keep. |
| Spell Mastery | guided | The level 1 and level 2 picks are always prepared and cast at will at their own level with no slot (character-build.ts). That they come from the spellbook with a casting time of an action, and swapping one after a Long Rest, are the GM's. |
| Spellcasting | enforced | character-build.ts gives the class its slots, cantrips and prepared spells, and each spell is a cast action at the class's spell save DC and attack bonus. resolution/economy.ts spends the slot, and rests.ts restores slots on a Long Rest. level-up-picks.ts lets a player's level up replace only the cantrips and spells the class's level allows. |

## Species traits

**Enforced (73):** Abyssal Legacy (Abyssal) · Adrenaline Rush (Orc) · Arcane Cantrip (High Elf) · Brave (Halfling) · Breath Weapon (Acid) (Black Dragon) · Breath Weapon (Acid) (Copper Dragon) · Breath Weapon (Cold) (Silver Dragon) · Breath Weapon (Cold) (White Dragon) · Breath Weapon (Dragonborn) · Breath Weapon (Fire) (Brass Dragon) · Breath Weapon (Fire) (Gold Dragon) · Breath Weapon (Fire) (Red Dragon) · Breath Weapon (Lightning) (Blue Dragon) · Breath Weapon (Lightning) (Bronze Dragon) · Breath Weapon (Poison) (Green Dragon) · Chthonic Legacy (Chthonic) · Damage Resistance (Acid) (Black Dragon) · Damage Resistance (Acid) (Copper Dragon) · Damage Resistance (Cold) (Silver Dragon) · Damage Resistance (Cold) (White Dragon) · Damage Resistance (Dragonborn) · Damage Resistance (Fire) (Brass Dragon) · Damage Resistance (Fire) (Gold Dragon) · Damage Resistance (Fire) (Red Dragon) · Damage Resistance (Lightning) (Blue Dragon) · Damage Resistance (Lightning) (Bronze Dragon) · Damage Resistance (Poison) (Green Dragon) · Dancing Lights (Drow) · Darkness (Drow) · Darkness (Infernal) · Darkvision (Dragonborn) · Darkvision (Dwarf) · Darkvision (Elf) · Darkvision (Gnome) · Darkvision (Orc) · Darkvision (Tiefling) · Detect Magic (High Elf) · Draconic Ancestry (Dragonborn) · Draconic Flight (Dragonborn) · Druidcraft (Wood Elf) · Dwarven Resilience (Dwarf) · Dwarven Toughness (Dwarf) · Elven Lineage (Elf) · Faerie Fire (Drow) · False Life (Chthonic) · Fey Ancestry (Elf) · Fiendish Legacy (Tiefling) · Fleet of Foot (Wood Elf) · Giant Ancestry (Goliath) · Gnomish Cunning (Gnome) · Gnomish Lineage (Gnome) · Hellish Rebuke (Infernal) · Hold Person (Abyssal) · Infernal Legacy (Infernal) · Keen Senses (Elf) · Longstrider (Wood Elf) · Luck (Halfling) · Minor Illusion (Forest Gnome) · Misty Step (High Elf) · Naturally Stealthy (Halfling) · Otherworldly Presence (Tiefling) · Pass without Trace (Wood Elf) · Powerful Build (Goliath) · Ray of Enfeeblement (Chthonic) · Ray of Sickness (Abyssal) · Relentless Endurance (Orc) · Resourceful (Human) · Rock Gnome Cantrips (Rock Gnome) · Skillful (Human) · Speak with Animals (Forest Gnome) · Stonecunning (Dwarf) · Superior Darkvision (Drow) · Versatile (Human)

**Guided (1):** Large Form (Goliath)

**Reference (3):** Clockwork Devices (Rock Gnome) · Halfling Nimbleness (Halfling) · Trance (Elf)

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Breath Weapon (Dragonborn) | enforced | The ancestry's own Breath Weapon row carries the save, the area and the damage, and resolution/economy.ts takes it in place of an attack. |
| Damage Resistance (Dragonborn) | enforced | The ancestry's own Damage Resistance row grants the Resistance, which hit-points.ts applies. |
| Giant Ancestry (Goliath) | enforced | Fire's Burn, Frost's Chill and Hill's Tumble ride a hit that deals damage (resolution/hit-options.ts), Storm's Thunder is offered as a Reaction, and Stone's Endurance as a Reaction to damage from a hit or a failed save, taking 1d12 plus the Constitution modifier off it before it lands (damage-window.ts). Cloud's Jaunt gives a 30-foot teleport taken on the map at once to an unoccupied space the Goliath can see (granted-moves.ts). |
| Large Form (Goliath) | guided | The Bonus Action gives +10 feet of Speed and Advantage on Strength checks for 10 minutes. Becoming Large on the map, and whether the space is big enough, are the GM's. |
| Luck (Halfling) | enforced | roll-answers.ts offers a reroll when the d20 of the Halfling's attack roll, check, save or death save shows a 1, and the new roll stands. |
| Naturally Stealthy (Halfling) | enforced | With dynamic vision on, resolution/validate.ts lets a Halfling Hide behind a creature at least one size larger than it (vision/rules.ts). |
| Powerful Build (Goliath) | enforced | The escape from a grapple rolls with Advantage (resolution/builtins.ts). The app doesn't track carrying capacity, so counting one size larger for it is the GM's. |
| Relentless Endurance (Orc) | enforced | hit-points.ts holds an Orc reduced to 0 Hit Points, but not killed outright, at 1 Hit Point instead, once a Long Rest. It is taken the first time it can be. |
| Resourceful (Human) | enforced | rests.ts gives a Human Heroic Inspiration when it finishes a Long Rest. |

## Backgrounds

**Enforced (4):** Acolyte · Criminal · Sage · Soldier

## Feats

**Enforced (16):** Ability Score Improvement · Alert · Archery · Boon of Combat Prowess · Boon of Dimensional Travel · Boon of Fate · Boon of Spell Recall · Boon of the Night Spirit · Boon of Truesight · Defense · Magic Initiate (Cleric) · Magic Initiate (Druid) · Magic Initiate (Wizard) · Savage Attacker · Skilled · Two-Weapon Fighting

**Guided (2):** Boon of Irresistible Offense · Grappler

**Reference (1):** Great Weapon Fighting

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Boon of Combat Prowess | enforced | The ability score increase is applied, and roll-answers.ts offers Peerless Aim on a missed attack roll: the attack hits, and the boon waits for the start of the creature's next turn. |
| Boon of Dimensional Travel | enforced | The ability score increase is applied, and after the Attack or Magic action resolution/movement-grants.ts gives a 30-foot teleport for the turn, which movement-rules.ts takes at once to an unoccupied space the creature can see. |
| Boon of Fate | enforced | The ability score increase is applied. roll-answers.ts offers Improve Fate on the holder's own D20 Test, and asks by a prompt about another creature's within 60 feet: 2d4 is added or taken off, and the use returns when Initiative is rolled or on a rest. |
| Boon of Irresistible Offense | guided | The ability score increase is applied. Overcoming Resistance, and the extra damage on a 20, are the GM's. |
| Boon of Spell Recall | enforced | The ability score increase is applied, and resolution/spell-recall.ts rolls a d4 for a spell cast with a level 1 to 4 slot, keeping the slot when it matches the level. |
| Boon of the Night Spirit | enforced | The ability score increase is applied. With dynamic vision on, Merge with Shadows makes the creature Invisible as a Bonus Action only in Dim Light or Darkness (resolution/validate.ts), until it next takes an action, a Bonus Action or a Reaction (resolution/release.ts), and hit-points.ts gives it Resistance to all damage but Psychic and Radiant there. |
| Boon of Truesight | enforced | The ability score increase is applied, and Truesight 60 feet is a sense dynamic vision and attack rolls read (vision/senses.ts). |
| Grappler | guided | The ability score increase is applied. Punch and Grab, Attack Advantage and Fast Wrestler are the GM's. |
| Savage Attacker | enforced | resolution/hit-options.ts offers it on a weapon hit once a turn. Chosen, resolution/damage.ts rolls the weapon's damage dice twice and uses the higher roll. |
| Two-Weapon Fighting | enforced | equipment-derivation.ts adds the ability modifier to the damage of the Light property's extra attack. |

## Magic items

**Enforced (91):** Ammunition, +1 · Ammunition, +2 · Ammunition, +3 · Armor of Resistance · Armor of Vulnerability · Armor, +1 · Armor, +2 · Armor, +3 · Belt of Dwarvenkind · Boots of Elvenkind · Boots of the Winterlands · Bracers of Defense · Candle of Invocation · Chime of Opening · Cloak of Arachnida · Cloak of Elvenkind · Cloak of Protection · Cube of Force · Dagger of Venom · Decanter of Endless Water · Dragon Slayer · Elven Chain · Eversmoking Bottle · Eyes of Charming · Flame Tongue · Frost Brand · Gem of Brightness · Gem of Seeing · Giant Slayer · Glamoured Studded Leather · Gloves of Missile Snaring · Gloves of Thievery · Goggles of Night · Lantern of Revealing · Mace of Disruption · Mace of Smiting · Manual of Bodily Health · Manual of Gainful Exercise · Manual of Quickness of Action · Mithral Armor · Necklace of Fireballs · Pearl of Power · Periapt of Proof against Poison · Periapt of Wound Closure · Potion of Flying · Potion of Healing (greater) · Potion of Healing (superior) · Potion of Healing (supreme) · Ring of Animal Influence · Ring of Evasion · Ring of Feather Falling · Ring of Jumping · Ring of Protection · Ring of Resistance · Ring of Swimming · Ring of X-ray Vision · Robe of Eyes · Rod of Resurrection · Rod of Rulership · Sentinel Shield · Shield of the Cavalier · Shield, +1 · Shield, +2 · Shield, +3 · Slippers of Spider Climbing · Spell Scroll · Staff of Fire · Staff of Frost · Staff of Healing · Staff of Striking · Staff of Swarming Insects · Staff of the Woodlands · Staff of Thunder and Lightning · Staff of Withering · Stone of Good Luck (Luckstone) · Sword of Wounding · Tome of Clear Thought · Tome of Leadership and Influence · Tome of Understanding · Vicious Weapon · Wand of Binding · Wand of Fireballs · Wand of Lightning Bolts · Wand of Magic Missiles · Wand of Paralysis · Wand of Web · Weapon, +1 · Weapon, +2 · Weapon, +3 · Winged Boots · Wings of Flying

**Guided (118):** Adamantine Armor · Ammunition of Slaying · Amulet of Health · Amulet of Proof against Detection and Location · Amulet of the Planes · Animated Shield · Armor of Invulnerability · Arrow-Catching Shield · Bag of Tricks · Belt of Giant Strength · Berserker Axe · Boots of Levitation · Boots of Speed · Boots of Striding and Springing · Bowl of Commanding Water Elementals · Bracers of Archery · Brazier of Commanding Fire Elementals · Brooch of Shielding · Broom of Flying · Cape of the Mountebank · Censer of Controlling Air Elementals · Cloak of Displacement · Cloak of Invisibility · Cloak of the Bat · Cloak of the Manta Ray · Crystal Ball · Crystal Ball of Mind Reading · Crystal Ball of Telepathy · Crystal Ball of True Seeing · Cubic Gate · Dancing Sword · Defender · Demon Armor · Dragon Orb · Dragon Scale Mail · Dwarven Plate · Dwarven Thrower · Energy Bow · Gauntlets of Ogre Power · Gloves of Swimming and Climbing · Hammer of Thunderbolts · Hat of Disguise · Hat of Many Spells · Headband of Intellect · Helm of Brilliance · Helm of Comprehending Languages · Helm of Telepathy · Helm of Teleportation · Holy Avenger · Horn of Valhalla · Instant Fortress · Ioun Stone · Iron Bands · Iron Flask · Javelin of Lightning · Luck Blade · Mace of Terror · Mantle of Spell Resistance · Medallion of Thoughts · Necklace of Adaptation · Necklace of Prayer Beads · Nine Lives Stealer · Oathbow · Periapt of Health · Pipes of Haunting · Pipes of the Sewers · Plate Armor of Etherealness · Quarterstaff of the Acrobat · Ring of Djinni Summoning · Ring of Elemental Command · Ring of Free Action · Ring of Invisibility · Ring of Mind Shielding · Ring of Regeneration · Ring of Shooting Stars · Ring of Spell Storing · Ring of Spell Turning · Ring of Telekinesis · Ring of the Ram · Ring of Three Wishes · Ring of Warmth · Ring of Water Walking · Robe of Scintillating Colors · Robe of Stars · Robe of the Archmagi · Rod of Absorption · Rod of Alertness · Rod of Lordly Might · Rope of Entanglement · Scarab of Protection · Scimitar of Speed · Sending Stones · Shield of Missile Attraction · Spellguard Shield · Staff of Charming · Staff of Power · Staff of the Magi · Staff of the Python · Stone of Controlling Earth Elementals · Sun Blade · Sword of Life Stealing · Sword of Sharpness · Talisman of Pure Good · Talisman of the Sphere · Talisman of Ultimate Evil · Thunderous Greatclub · Trident of Fish Command · Vorpal Sword · Wand of Enemy Detection · Wand of Fear · Wand of Magic Detection · Wand of Polymorph · Wand of Secrets · Wand of the War Mage, +1 · Wand of the War Mage, +2 · Wand of the War Mage, +3 · Wand of Wonder · Weapon of Warning

**Reference (61):** Apparatus of the Crab · Bag of Beans · Bag of Devouring · Bag of Holding · Bead of Force · Bead of Nourishment · Carpet of Flying · Circlet of Blasting · Deck of Illusions · Dimensional Shackles · Dust of Disappearance · Dust of Dryness · Dust of Sneezing and Choking · Efficient Quiver · Efreeti Bottle · Elemental Gem · Elixir of Health · Eyes of Minute Seeing · Eyes of the Eagle · Feather Token · Figurine of Wondrous Power · Folding Boat · Handy Haversack · Horn of Blasting · Horseshoes of a Zephyr · Horseshoes of Speed · Immovable Rod · Manual of Golems · Marvelous Pigments · Mirror of Life Trapping · Mysterious Deck · Oil of Etherealness · Oil of Sharpness · Oil of Slipperiness · Philter of Love · Portable Hole · Potion of Animal Friendship · Potion of Clairvoyance · Potion of Climbing · Potion of Diminution · Potion of Gaseous Form · Potion of Giant Strength · Potion of Growth · Potion of Heroism · Potion of Invisibility · Potion of Invulnerability · Potion of Longevity · Potion of Mind Reading · Potion of Poison · Potion of Resistance · Potion of Speed · Potion of Vitality · Potion of Water Breathing · Robe of Useful Items · Rod of Security · Rope of Climbing · Sovereign Glue · Sphere of Annihilation · Universal Solvent · Well of Many Worlds · Wind Fan

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Armor of Invulnerability | guided | Resistance to Bludgeoning, Piercing and Slashing damage is applied. The once-a-day Immunity to them is the GM's. |
| Berserker Axe | guided | The +1 to attack and damage rolls and the curse's lock on Attunement are applied. The extra Hit Points and the curse's save are the GM's. |
| Boots of Levitation | guided | The action levitates the wearer with no save for the spell's 10 minutes: it rises 20 feet, moves only as if climbing, and floats down when the levitation ends (falling.ts). Concentration on it is the wearer's to end sooner on the sheet. |
| Boots of Striding and Springing | guided | The once-a-turn leap of 30 feet for 10 feet of movement is applied (jumping.ts). The Speed of at least 30 feet, unreduced by armor or weight, is the GM's. |
| Bracers of Archery | guided | Proficiency with the Longbow and Shortbow is applied. The +2 damage with them is the GM's. |
| Brooch of Shielding | guided | Resistance to Force damage is applied. Immunity to Magic Missile is the GM's. |
| Broom of Flying | guided | The action gives the rider a Fly Speed of 50 feet with hover until it ends it on the sheet. The 30 feet while carrying over 200 pounds is the GM's, since weight isn't tracked. |
| Cape of the Mountebank | guided | The cast of Dimension Door, once a dawn, teleports the wearer on the map (granted-moves.ts). The smoke cloud is the GM's. |
| Chime of Opening | enforced | Each strike casts Knock on its 10 charges, which never come back, and the last one cracks it (resolution/charges.ts). |
| Cloak of Arachnida | enforced | Resistance to Poison damage and a Climb Speed equal to its wearer's Speed are applied. The webs of a Web spell can't hold the wearer (spell-zones.ts), and its Web cast is DC 13 over a 40-foot Cube once a Long Rest. Climbing upside down on ceilings is the GM's to allow. |
| Cloak of the Bat | guided | Advantage on Dexterity (Stealth) checks is applied. The Fly Speed in darkness and the Polymorph cast are the GM's. |
| Dagger of Venom | enforced | The +1 to attack and damage rolls is applied. Coating the blade is a Bonus Action once a day, and the dagger's next hit spends it on a DC 15 Constitution save against 2d10 Poison and Poisoned for 1 minute (resolution/on-hit.ts). |
| Defender | guided | The +3 to attack and damage rolls is applied. Moving the bonus to AC is the GM's. |
| Demon Armor | guided | The +1 AC and the curse's lock on Attunement are applied. The clawed Unarmed Strikes and the Disadvantage against demons are the GM's. |
| Dragon Scale Mail | guided | The +1 AC and the Resistance to one type are applied. Advantage on saves against a dragon's breath, and sensing dragons, are the GM's. |
| Dwarven Plate | guided | The +2 AC is applied. The Reaction against forced movement is the GM's. |
| Dwarven Thrower | guided | The +3 to attack and damage rolls is applied. Throwing it, its return and the extra damage against Giants are the GM's. |
| Gem of Brightness | enforced | Its light is lit and put out on the row, and its beam (1 charge) and flare (5 charges) open the DC 15 Constitution save against Blinded on its 50 charges, which never come back. |
| Giant Slayer | enforced | The +1 to attack and damage rolls and the extra 2d6 against Giants are applied, and a hit on a Giant opens its DC 15 Strength save against Prone (resolution/on-hit.ts). |
| Gloves of Missile Snaring | enforced | A hit by a weapon from range opens a reaction prompt (damage-window.ts), and using it takes 1d10 plus the wearer's Dexterity modifier off the damage. Whether a hand is free, and catching the missile, are the GM's. |
| Hammer of Thunderbolts | guided | The +1 to attack and damage rolls is applied. Its thrown thunderclap and its powers against Giants are the GM's. |
| Helm of Telepathy | guided | Its Detect Thoughts and Suggestion casts are cast actions. The telepathy itself is the GM's. |
| Holy Avenger | guided | The +3 to attack and damage rolls and the extra 2d10 Radiant against Fiends and Undead are applied. The aura's Advantage on saves against spells for its wielder's allies is the GM's. |
| Horn of Valhalla | guided | Blowing it is counted, and clock-pools.ts keeps it from being blown again until 7 days have passed on the game clock. The Berserkers it calls, and the requirement of its metal, are the GM's. |
| Iron Bands | guided | The throw's attack roll is applied. Restraining the target on a hit, and the check to break free, are the GM's. |
| Iron Flask | guided | The command's save is applied. Trapping the creature in the flask is the GM's. |
| Luck Blade | guided | The +1 to attack and damage rolls and saving throws is applied, and roll-answers.ts offers its Luck reroll on a failed D20 Test once a day while the wielder isn't Incapacitated. Its Wish casts on 1d3 charges rolled when it is added, which never come back; its once a day limit, and what a Wish does, are the GM's. |
| Mace of Disruption | enforced | The extra 2d6 Radiant against Fiends and Undead and the weapon's light are applied. A Fiend or an Undead the hit leaves at 25 Hit Points or fewer makes the DC 15 Wisdom save (resolution/kill.ts): a failure destroys it, and a success leaves it Frightened until the end of the wielder's next turn. |
| Mace of Smiting | enforced | The +1 to attack and damage rolls, +3 against Constructs, and the 7 Bludgeoning on a rolled 20 (14 against a Construct) are applied. A Construct that rolled 20 leaves at 25 Hit Points or fewer is destroyed (resolution/kill.ts). |
| Manual of Bodily Health | enforced | item-study.ts records the study in the reader's build, so Constitution rises by 2 (to at most 30) and stays through every rebuild, and the copy's magic is spent. The 48 hours of study are downtime the GM gives, and the GM moves the clock. |
| Manual of Gainful Exercise | enforced | item-study.ts records the study in the reader's build, so Strength rises by 2 (to at most 30) and stays through every rebuild, and the copy's magic is spent. The 48 hours of study are downtime the GM gives, and the GM moves the clock. |
| Manual of Quickness of Action | enforced | item-study.ts records the study in the reader's build, so Dexterity rises by 2 (to at most 30) and stays through every rebuild, and the copy's magic is spent. The 48 hours of study are downtime the GM gives, and the GM moves the clock. |
| Necklace of Fireballs | enforced | inventory.ts rolls its 1d6 + 3 beads when it is added, and each bead casts a level 3 Fireball at DC 15 and never comes back. Hurling several beads at once is the GM's. |
| Nine Lives Stealer | guided | The +2 to attack and damage rolls is applied. On a rolled 20 against a creature with fewer than 100 Hit Points, other than a Construct or an Undead, the target makes the DC 15 Constitution save, and a failure slays it (resolution/kill.ts). The 1d8 + 1 charges, one spent per slaying, are the GM's to count. |
| Pearl of Power | enforced | Its Magic action restores one expended slot of level 3 or lower, once per Long Rest (conversions.ts). |
| Periapt of Wound Closure | enforced | death-saves.ts counts an attuned wearer's death save of 9 or lower as a 10, and rests.ts and resolution/hit-point-die.ts double what each Hit Point Die it rolls to heal restores. |
| Pipes of Haunting | guided | The save against Frightened, with its repeat at the end of each turn, is applied. The immunity after a success is the GM's. |
| Quarterstaff of the Acrobat | guided | The +2 to attack and damage rolls is applied, and Attack Deflection is offered once a rest when a hit would land, adding 5 to AC against it (resolution/pending.ts). Its forms, its throw and Acrobatic Assist are the GM's. |
| Ring of Shooting Stars | guided | Its at-will cantrips and the one-charge Shooting Stars are applied. Faerie Fire, the Lightning Spheres and the larger Shooting Stars are the GM's. |
| Ring of Three Wishes | guided | Its three Wish casts are counted and never come back (resolution/charges.ts). What a Wish does is the GM's. |
| Robe of Scintillating Colors | guided | The save against Stunned is applied. The light, the Disadvantage on attacks against the wearer and ending the stun are the GM's. |
| Robe of Stars | guided | The +1 to saving throws is applied, and its six stars each cast a level 5 Magic Missile, 1d6 coming back at dusk or a Long Rest. The trip to the Astral Plane is the GM's. |
| Rod of Alertness | guided | Advantage on Initiative and Wisdom (Perception) checks, and its detection casts, are applied. The Protective Aura's benefit to allies is the GM's. |
| Rod of Lordly Might | guided | It swings as a +3 Mace. Drain Life and Paralyze ride a melee hit and Terrify is an action, each once a day. The buttons' other forms, and Drain Life's healing, are the GM's. |
| Rod of Resurrection | enforced | Its casts spend their printed charges, and it regains 1 charge at dawn or at a Long Rest (item-charges.ts). |
| Rope of Entanglement | guided | The save against Restrained is applied. The check to escape the rope is the GM's. |
| Scarab of Protection | guided | The +1 AC is applied. Advantage on saves against spells, and its Preservation, are the GM's. |
| Scimitar of Speed | guided | The +2 to attack and damage rolls is applied. The extra attack as a Bonus Action is the GM's. |
| Spellguard Shield | guided | Spell attack rolls against its holder have Disadvantage (resolution/attack.ts). Advantage on saves against spells and other magical effects is the GM's. |
| Staff of Charming | guided | Its one-charge casts are cast actions, and roll-answers.ts offers to turn a failed save against an Enchantment spell aimed only at the holder into a success once a day. Turning the spell back on its caster is the GM's. |
| Staff of Fire | enforced | Resistance to Fire damage is applied, and Burning Hands, Fireball and Wall of Fire spend their printed charges (item-actions.ts); a 1 on the last charge's d20 destroys it (resolution/charges.ts). |
| Staff of Frost | enforced | Resistance to Cold damage is applied, and Fog Cloud, Cone of Cold, Ice Storm and Wall of Ice spend their printed charges (item-actions.ts); a 1 on the last charge's d20 destroys it (resolution/charges.ts). |
| Staff of Power | guided | It swings as a +2 Quarterstaff, the +2 to AC, saving throws and spell attack rolls is applied, and its spells spend their printed charges; a 20 on the last charge's d20 gives 1d8 + 2 back (resolution/charges.ts). Retributive Strike, and a 1 on that d20, are the GM's. |
| Staff of Striking | enforced | It swings as a +3 Quarterstaff, and a melee hit can spend 1, 2 or 3 of its 10 charges for 1d6 Force each (resolution/hit-options.ts). |
| Staff of the Magi | guided | It swings as a +2 Quarterstaff, the +2 to spell attack rolls is applied, and its spells spend their printed charges from 50; a 20 on the last charge's d20 gives 1d12 + 1 back (resolution/charges.ts). Advantage on saves against spells, Spell Absorption and Retributive Strike are the GM's. |
| Staff of the Woodlands | enforced | It swings as a +2 Quarterstaff, the +2 to spell attack rolls is applied, its spells spend their printed charges and Tree Form's use is counted. A 1 on the last charge's d20 leaves a plain Quarterstaff (resolution/charges.ts). |
| Staff of Thunder and Lightning | enforced | It swings as a +2 Quarterstaff. Lightning and Thunder ride a melee hit, Thunder and Lightning does both as a Bonus Action (resolution/hit-options.ts), and Lightning Strike and Thunderclap are actions, each once a day. |
| Staff of Withering | enforced | It swings as a Quarterstaff, and a hit can spend a charge for 2d10 Necrotic and a DC 15 Constitution save against Disadvantage on Strength and Constitution checks and saves (resolution/hit-options.ts). The hour it lasts is the GM's. |
| Sun Blade | guided | It swings as a +2 Finesse Longsword that deals Radiant damage, with 1d8 Radiant more against an Undead. The Bonus Action that makes the blade appear, and its sunlight, are the GM's. |
| Sword of Sharpness | guided | A rolled 20 against a creature adds 14 Slashing damage and a level of Exhaustion (resolution/damage.ts, resolution/on-hit.ts). Maximized damage against an object is the GM's. |
| Sword of Wounding | enforced | The extra Necrotic damage is applied, and a hit opens a DC 15 Constitution save whose failure stops the target regaining Hit Points until it succeeds on the save it repeats at the end of each of its turns (resolution/on-hit.ts). |
| Talisman of Pure Good | guided | The +2 to spell attack rolls is applied. The 8d6 Radiant it deals a Fiend or an Undead that touches it, and Pure Rebuke's fissure on its charges, are the GM's. |
| Talisman of Ultimate Evil | guided | The +2 to spell attack rolls is applied. The 8d6 Necrotic it deals a creature other than a Fiend or an Undead that touches it, and Ultimate End's fissure on its charges, are the GM's. |
| Tome of Clear Thought | enforced | item-study.ts records the study in the reader's build, so Intelligence rises by 2 (to at most 30) and stays through every rebuild, and the copy's magic is spent. The 48 hours of study are downtime the GM gives, and the GM moves the clock. |
| Tome of Leadership and Influence | enforced | item-study.ts records the study in the reader's build, so Charisma rises by 2 (to at most 30) and stays through every rebuild, and the copy's magic is spent. The 48 hours of study are downtime the GM gives, and the GM moves the clock. |
| Tome of Understanding | enforced | item-study.ts records the study in the reader's build, so Wisdom rises by 2 (to at most 30) and stays through every rebuild, and the copy's magic is spent. The 48 hours of study are downtime the GM gives, and the GM moves the clock. |
| Vorpal Sword | guided | The +3 to attack and damage rolls is applied. On a rolled 20 it cuts off the target's head (resolution/kill.ts): the creature dies, and only a revival that restores lost parts brings it back. A creature with no head, Immunity to Slashing damage, a neck too big (larger than Large) or Legendary Resistance to spend takes 30 Slashing damage more instead, and a hydra loses one head. Ignoring Resistance to Slashing damage, and a creature that lives without its head, are the GM's. |
| Wand of Fireballs | enforced | Fireball at DC 15 on its charges, each charge past the first raising its level by 1 up to 3 (item-actions.ts); a 1 on the last charge's d20 destroys it (resolution/charges.ts). |
| Wand of Lightning Bolts | enforced | Lightning Bolt at DC 15 on its charges, each charge past the first raising its level by 1 up to 3 (item-actions.ts); a 1 on the last charge's d20 destroys it (resolution/charges.ts). |
| Wand of the War Mage, +1 | guided | The +1 to spell attack rolls is applied. Ignoring Half Cover on a spell attack is the GM's, who sets the cover. |
| Wand of the War Mage, +2 | guided | The +2 to spell attack rolls is applied. Ignoring Half Cover on a spell attack is the GM's, who sets the cover. |
| Wand of the War Mage, +3 | guided | The +3 to spell attack rolls is applied. Ignoring Half Cover on a spell attack is the GM's, who sets the cover. |
| Weapon of Warning | guided | Advantage on Initiative for its wielder is applied. The same for allies within 30 feet, and waking them, are the GM's. |
| Wings of Flying | enforced | The action gives a Fly Speed of 60 feet for an hour, or until the wearer ends it on the sheet; a creature in the air when it ends falls (falling.ts). clock-pools.ts keeps the wings from being used again until 1d12 + 1 hours of game time have passed from their use (the hour they last, then the wait). |

## Gear and tools

**Enforced (24):** Acid (vial) · Alchemist's Fire (flask) · Antitoxin (vial) · Arrows (20) · Ball Bearings (bag of 1,000) · Blowgun Needles (50) · Caltrops (bag of 20) · Candle · Crossbow Bolts (20) · Firearm Bullets (10) · Healer's Kit · Holy Water (flask) · Lamp · Lantern, Bullseye · Lantern, Hooded · Net · Oil (flask) · Poison, Basic (vial) · Potion of Healing · Sling Bullets (20) · Spell Scroll (Cantrip) · Spell Scroll (Level 1) · Tinderbox · Torch

**Guided (38):** Alchemist's Supplies · Brewer's Supplies · Calligrapher's Supplies · Carpenter's Tools · Cartographer's Tools · Cobbler's Tools · Cook's Utensils · Disguise Kit · Forgery Kit · Gaming Set (Dice) · Gaming Set (Dragonchess) · Gaming Set (Playing Cards) · Gaming Set (Three-Dragon Ante) · Glassblower's Tools · Herbalism Kit · Hunting Trap · Jeweler's Tools · Leatherworker's Tools · Mason's Tools · Musical Instrument (Bagpipes) · Musical Instrument (Drum) · Musical Instrument (Dulcimer) · Musical Instrument (Flute) · Musical Instrument (Horn) · Musical Instrument (Lute) · Musical Instrument (Lyre) · Musical Instrument (Pan Flute) · Musical Instrument (Shawm) · Musical Instrument (Viol) · Navigator's Tools · Painter's Supplies · Poisoner's Kit · Potter's Tools · Smith's Tools · Thieves' Tools · Tinker's Tools · Weaver's Tools · Woodcarver's Tools

**Reference (79):** Arcane Focus (Crystal) · Arcane Focus (Orb) · Arcane Focus (Rod) · Arcane Focus (Staff) · Arcane Focus (Wand) · Backpack · Barrel · Basket · Bedroll · Bell · Blanket · Block and Tackle · Book · Bottle, Glass · Bucket · Burglar's Pack · Case, Crossbow Bolt · Case, Map or Scroll · Chain (10 feet) · Chalk (1 piece) · Chest · Climber's Kit · Clothes, Fine · Clothes, Traveler's · Component Pouch · Costume · Crowbar · Diplomat's Pack · Druidic Focus (Sprig of Mistletoe) · Druidic Focus (Totem) · Druidic Focus (Wooden Staff) · Druidic Focus (Yew Wand) · Dungeoneer's Pack · Entertainer's Pack · Explorer's Pack · Flask or Tankard · Grappling Hook · Hammer · Holy Symbol (Amulet) · Holy Symbol (Emblem) · Holy Symbol (Reliquary) · Ink (1-ounce bottle) · Ink Pen · Jug or Pitcher · Ladder (10-foot) · Lock · Magnifying Glass · Manacles · Map · Mess Kit · Mirror, Steel · Paper (one sheet) · Parchment (one sheet) · Perfume (vial) · Pole (10-foot) · Pot, Iron · Pouch · Priest's Pack · Quiver · Ram, Portable · Rations (1 day) · Robe · Rope (50 feet) · Sack · Scale, Merchant's · Scholar's Pack · Sealing Wax · Shovel · Signal Whistle · Signet Ring · Soap · Spellbook · Spikes, Iron (10) · Spyglass · String (10 feet) · Tent, Two-Person · Vial · Waterskin · Whetstone

Notes on the curated rows:

| Record | State | How |
| --- | --- | --- |
| Ball Bearings (bag of 1,000) | enforced | Spilling them from the pack places a 10-foot square that rolls nothing as it lands (resolution/concentration.ts). spell-zones.ts asks a creature that enters it for the DC 10 Dexterity save, once a turn, and a failure leaves it Prone. The square stays until the GM ends it, which is gathering them up. |
| Caltrops (bag of 20) | enforced | Spreading them from the pack places a 5-foot square that rolls nothing as it lands (resolution/concentration.ts). spell-zones.ts asks a creature that enters it for the DC 15 Dexterity save, once a turn: 1 Piercing damage and a Speed of 0 until the start of its next turn on a failure. The square stays until the GM ends it, which is gathering them up. |
| Healer's Kit | enforced | stabilize.ts spends one use of the kit to make a creature at 0 Hit Points Stable with no check, and the last use takes the kit. |
| Hunting Trap | guided | Setting it places a 5-foot square (resolution/concentration.ts). The first creature that enters it makes the DC 13 Dexterity save, with 1d4 Piercing damage and a Speed of 0 until the start of its next turn on a failure, and the trap springs and leaves the map (spell-zones.ts). The chain that holds the creature after that, and the Strength (Athletics) check to break free, are the GM's. |
| Tinderbox | enforced | item-light.ts lights a Candle, Lamp, Lantern or Torch in hand only when its bearer holds a Tinderbox or another flame, spending its Bonus Action in a fight. Lighting any other fire is the GM's. |

## Weapons

**Enforced (38):** Battleaxe · Blowgun · Club · Dagger · Dart · Flail · Glaive · Greataxe · Greatclub · Greatsword · Halberd · Hand Crossbow · Handaxe · Heavy Crossbow · Javelin · Lance · Light Crossbow · Light Hammer · Longbow · Longsword · Mace · Maul · Morningstar · Musket · Pike · Pistol · Quarterstaff · Rapier · Scimitar · Shortbow · Shortsword · Sickle · Sling · Spear · Trident · War Pick · Warhammer · Whip

## Armor

**Enforced (13):** Breastplate · Chain Mail · Chain Shirt · Half Plate Armor · Hide Armor · Leather Armor · Padded Armor · Plate Armor · Ring Mail · Scale Mail · Shield · Splint Armor · Studded Leather Armor

## Conditions

| Record | State | How |
| --- | --- | --- |
| Blinded | enforced | resolution/attack.ts: its attack rolls have Disadvantage and attack rolls against it have Advantage. ability-checks.ts fails its Perception check to find a creature unless its Blindsight reaches it. movement-rules.ts: it makes an Opportunity Attack only against a mover in its Blindsight, and with dynamic vision on vision/sight.ts lets it see only within Blindsight. The GM rules on other checks that need sight. |
| Charmed | guided | resolution/economy.ts: a creature Charmed by a spell or an action can't attack its charmer or target it with a save or damage. A Charmed chip the GM sets names no charmer, so nothing is refused. The charmer's Advantage on social checks is the GM's. |
| Deafened | guided | actor-conditions.ts tracks it on the creature. The GM rules on checks that need hearing; nothing else in the condition changes a roll. |
| Exhaustion | enforced | condition-rules.ts takes 2 per level from every D20 Test, and speed.ts takes 5 feet per level from Speed. effects.ts kills the creature at level 6, and rests.ts removes a level on each Long Rest. |
| Frightened | enforced | resolution/attack.ts, ability-checks.ts and encounter.ts give it Disadvantage on attack rolls, ability checks and Initiative while the source of its fear is within line of sight (vision/rules.ts; always with dynamic vision off, or when the GM set the condition by hand). movement-rules.ts refuses a willing move, a granted one included, that ends closer to the source, measuring height too. |
| Grappled | enforced | speed.ts: Speed 0. resolution/attack.ts: Disadvantage on attack rolls against anyone but the grappler. movement-rules.ts lets the grappler drag it, and resolution/builtins.ts rolls Escape a Grapple against the escape DC. |
| Incapacitated | enforced | resolution/economy.ts refuses its actions, Bonus Actions and Reactions. effects.ts ends its Concentration and its grapples, and encounter.ts gives it Disadvantage on Initiative. |
| Invisible | enforced | resolution/attack.ts: Advantage on its attack rolls and Disadvantage on attack rolls against it, unless the other creature sees it (Blindsight, Truesight or See Invisibility within range, or the map with dynamic vision on) or Faerie Fire outlines it. encounter.ts: Advantage on Initiative. movement-rules.ts: it provokes an Opportunity Attack only from a creature whose Blindsight or Truesight reaches it. |
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
| Area of Effect | enforced | commands/actions.ts places the template and area-targeting.ts finds who is inside. The creature a Cone, a Line or an Emanation comes from is left out of it, and with dynamic vision on a creature every straight line to which a wall or closed door blocks from the point of origin is left out too. |
| Armor Class | enforced | armor-class.ts in the domain package works out AC from armor, Shield, Dexterity and riders, and every attack roll is compared with it. |
| Armor Training | enforced | equipment-derivation.ts gives untrained armor Disadvantage on Strength and Dexterity D20 Tests, and resolution/economy.ts refuses spells while it is worn. An untrained Shield adds no AC. Training an item grants counts too (Elven Chain). |
| Attack | enforced | resolution/economy.ts counts the attacks the Attack action allows, Extra Attack included, and lets the creature move between them. Equipping or stowing a weapon is the table's. |
| Attack Roll | enforced | resolution/attack.ts rolls it on the server and compares it with the target's AC. |
| Attitude | reference | Attitudes aren't tracked. The GM decides how a monster responds to Influence. |
| Attunement | enforced | inventory.ts holds a creature to three attuned items, and an item that needs Attunement gives nothing until it has it. |
| Blinded | enforced | resolution/attack.ts: its attack rolls have Disadvantage and attack rolls against it have Advantage. ability-checks.ts fails its Perception check to find a creature unless its Blindsight reaches it. movement-rules.ts: it makes an Opportunity Attack only against a mover in its Blindsight, and with dynamic vision on vision/sight.ts lets it see only within Blindsight. The GM rules on other checks that need sight. |
| Blindsight | enforced | vision/senses.ts reads it from stat blocks, features, items and effects. Within its range a creature perceives what no wall hides, Blinded, in darkness or fog, or against the Invisible condition (vision/sight.ts). Attack rolls, Hide, Search and Opportunity Attacks read it, by the distance between the tokens with dynamic vision off. |
| Bloodied | enforced | The server counts half Hit Points or fewer as Bloodied (healthBandOf in hit-points.ts) for the rules that name it, such as monster traits and damage that changes when Bloodied. |
| Bonus Action | enforced | resolution/economy.ts allows one Bonus Action on a turn, and only from a feature, spell or item that offers one. |
| Breaking Objects | reference | Objects have no AC or Hit Points in the app. |
| Bright Light | enforced | With dynamic vision on, vision/sight.ts gives Bright Light under the scene's bright ambient light, in a painted bright area and within a light's bright radius, and a creature sees normally there. |
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
| Cover | enforced | With dynamic vision on, cover.ts works out Half, Three-Quarters and Total Cover from the walls between the attacker or the effect's origin and the target, and Half Cover from a creature in the way; the GM can mark more. The server adds 2 or 5 to AC and Dexterity saves, and resolution/validate.ts refuses an attack against Total Cover. |
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
| Darkness | enforced | With dynamic vision on, vision/sight.ts treats an unlit point in a dark scene or a painted dark area as Heavily Obscured: only Darkvision, Blindsight, Truesight or Devil's Sight see there, and only Blindsight, Truesight or Devil's Sight into magical Darkness. Attack rolls, Hide, Search and what each player sees read it. |
| Darkvision | enforced | vision/senses.ts reads it from species, stat blocks, items and effects, and with dynamic vision on vision/sight.ts lets the creature see Dim Light within its range as Bright Light and Darkness as Dim Light, so a creature in darkness there is Lightly Obscured to it. |
| Dash | enforced | resolution/grant.ts and speed.ts add the creature's Speed to its movement for the turn. |
| Dead | enforced | death.ts counts a creature dead at three failed death saves, at Exhaustion 6 or from massive damage, and a monster dead at 0 Hit Points. resolution/heal.ts gives the dead no Hit Points; only the GM's revival brings one back. |
| Deafened | guided | actor-conditions.ts tracks it on the creature. The GM rules on checks that need hearing; nothing else in the condition changes a roll. |
| Death Saving Throw | enforced | death-saves.ts rolls it from the dying character's sheet: 10 or more succeeds, a 1 counts as two failures and a 20 restores 1 Hit Point. hit-points.ts adds a failure for damage taken at 0 Hit Points, two for a Critical Hit. |
| Dehydration | reference | Water isn't tracked. |
| Difficult Terrain | enforced | The GM paints difficult terrain on the map (terrain.ts), and movement-rules.ts charges double through it, through an enemy's space and through an opening sized for a creature one size smaller (footprintStepPassage). Freedom of Movement ignores it. |
| Difficulty Class | enforced | The server works out spell save DCs and feature DCs from the sheet and compares every save and check with its DC. |
| Dim Light | enforced | With dynamic vision on, vision/sight.ts knows Dim Light (dim ambient light, a painted dim area, a light's outer radius) and treats it as Lightly Obscured. |
| Disadvantage | enforced | rules-5e rolls two d20s and keeps the lower. Any Advantage and any Disadvantage on the same roll cancel. |
| Disengage | enforced | movement-rules.ts opens no Opportunity Attacks against the creature for the rest of its turn. |
| Dodge | enforced | builtin-actions.ts gives attack rolls against it Disadvantage from an attacker it can see (vision/rules.ts) and its Dexterity saves Advantage until its next turn. Both lapse while it is Incapacitated. |
| Emanation | enforced | area-targeting.ts: an Emanation is a circle around its creature, which isn't in the area. The server finds every creature with a cell centre inside the template. |
| Encounter | reference | A definition. Fights run in the encounter tracker, which the other rows describe. |
| Enemy | enforced | creature-sides.ts puts monsters and hostile creatures against the party, by token disposition. Opportunity Attacks, auras and Sneak Attack read it. |
| Exhaustion | enforced | condition-rules.ts takes 2 per level from every D20 Test, and speed.ts takes 5 feet per level from Speed. effects.ts kills the creature at level 6, and rests.ts removes a level on each Long Rest. |
| Experience Points | enforced | experience.ts keeps each character's XP total, which the GM awards as an amount or as a share of the defeated creatures' stat block XP (the lair XP for one fought in its lair). The sheet shows the next level's threshold and offers the level up once the total reaches it. How much to award, or levelling by milestone, is the GM's. |
| Expertise | enforced | ability-checks.ts doubles the Proficiency Bonus on a check with a skill the sheet has Expertise in. |
| Falling | enforced | falling.ts rolls 1d6 Bludgeoning for every 10 feet fallen, to 20d6, through the damage rules, and lands the creature Prone unless it took no damage. Into water it uses its Reaction for a DC 15 Strength (Athletics) or Dexterity (Acrobatics) check, the better of the two, a success halving the damage. The GM starts a fall with actor.fall, and a creature that can't stay in the air falls by itself; Feather Fall and Slow Fall are offered as Reactions to it. What it fell from and where it lands are the GM's. |
| Fly Speed | enforced | speed.ts gives a creature with a Fly Speed its own budget for flying. |
| Flying | enforced | altitude.ts keeps the height a fly move or the GM gives a token, and every distance counts it. falling.ts drops a flier that is Prone, Incapacitated or at a Fly Speed of 0 unless it can hover, and one left with nothing to fly with, after any command. |
| Friendly | reference | Attitudes aren't tracked; the GM applies the Advantage on Influence. |
| Frightened | enforced | resolution/attack.ts, ability-checks.ts and encounter.ts give it Disadvantage on attack rolls, ability checks and Initiative while the source of its fear is within line of sight (vision/rules.ts; always with dynamic vision off, or when the GM set the condition by hand). movement-rules.ts refuses a willing move, a granted one included, that ends closer to the source, measuring height too. |
| Grappled | enforced | speed.ts: Speed 0. resolution/attack.ts: Disadvantage on attack rolls against anyone but the grappler. movement-rules.ts lets the grappler drag it, and resolution/builtins.ts rolls Escape a Grapple against the escape DC. |
| Grappling | enforced | resolution/builtins.ts rolls the target's Strength or Dexterity save against 8 plus Strength plus the Proficiency Bonus, and refuses a target more than one size larger. The grapple ends when the grappler is Incapacitated or moves out of reach (effects.ts). |
| Hazard | reference | A definition. Burning has its own row; the other hazards aren't tracked. |
| Healing | enforced | resolution/heal.ts restores Hit Points up to the maximum, and healing a dying character brings it back to consciousness. |
| Heavily Obscured | enforced | With dynamic vision on, no one sees into a Heavily Obscured space (darkness beyond a creature's senses, a painted fog or foliage area, a spell's cloud) in vision/sight.ts, so an attack there is against an unseen target, a creature there may Hide, and a Perception check to find a creature there fails (ability-checks.ts). |
| Help | guided | resolution/attack.ts gives the next attack roll by an ally against the distracted enemy Advantage. Helping with an ability check is the GM's to apply. |
| Heroic Inspiration | guided | held-rolls.ts spends it to reroll the d20 of an attack, a check, a save or a death save while the roll is shown. Only the GM gives it by hand. rests.ts gives it to a Human on a Long Rest, and turn-boundaries.ts to a Champion at the start of its turn. A character who gains a second one passes it to a player character without it or lets it go (heroic-inspiration.ts). Rerolling a damage die or Initiative is the GM's. |
| Hide | enforced | resolution/builtins.ts rolls a DC 15 Dexterity (Stealth) check and makes the creature Invisible on a success, until it attacks, casts a spell with a Verbal component or an enemy's Search meets its total. With dynamic vision on, resolution/validate.ts asks that it be Heavily Obscured or behind Three-Quarters or Total Cover and out of every enemy's sight (vision/rules.ts). A sound louder than a whisper is the GM's call. |
| High Jump | enforced | jumping.ts lets a jump rise up to 3 plus the Strength modifier with 10 feet moved this turn before it, half from a standing start, a foot of movement for each foot. Reaching up half its height more is the GM's. |
| Hit Point Dice | enforced | rests.ts lets a creature spend them only during a Short Rest (its own or the party's), each healing its roll plus the Constitution modifier, and restores them all on a Long Rest. The GM may spend them any time. |
| Hit Points | enforced | hit-points.ts keeps Hit Points between 0 and the maximum, and a creature at 0 falls Unconscious or dies. |
| Hostile | reference | Attitudes aren't tracked; the GM applies the Disadvantage on Influence. |
| Hover | enforced | speed.ts records whether a creature hovers, and falling.ts keeps a hovering flier in the air while it is Prone, Incapacitated or at a Fly Speed of 0. |
| Illusions | reference | Illusions are the GM's to run. |
| Immunity | enforced | hit-points.ts ignores damage of an immune type. effects.ts refuses a condition the creature is immune to, and a creature that becomes immune (Heroism, a Periapt of Proof against Poison) loses the condition it already has. |
| Improvised Weapons | reference | An improvised attack is the GM's to set up. |
| Incapacitated | enforced | resolution/economy.ts refuses its actions, Bonus Actions and Reactions. effects.ts ends its Concentration and its grapples, and encounter.ts gives it Disadvantage on Initiative. |
| Indifferent | reference | Attitudes aren't tracked. |
| Influence | guided | resolution/builtins.ts rolls the chosen Charisma or Wisdom check against 15 or the monster's Intelligence, whichever is higher. The GM decides what the monster does. |
| Initiative | enforced | encounter.ts rolls Initiative as a Dexterity check with its Advantage and Disadvantage, and orders the turns. |
| Invisible | enforced | resolution/attack.ts: Advantage on its attack rolls and Disadvantage on attack rolls against it, unless the other creature sees it (Blindsight, Truesight or See Invisibility within range, or the map with dynamic vision on) or Faerie Fire outlines it. encounter.ts: Advantage on Initiative. movement-rules.ts: it provokes an Opportunity Attack only from a creature whose Blindsight or Truesight reaches it. |
| Jumping | enforced | token.move's `jump` way of moving goes straight over what lies between, measured as a Long Jump across and a High Jump up (jumping.ts), and a landing in Difficult Terrain rolls a DC 10 Dexterity (Acrobatics) check or leaves the jumper Prone. |
| Knocking Out a Creature | enforced | A melee hit's confirm offers Knock out (resolution/knock-out.ts), and every apply path then lands it: hit-points.ts leaves a creature it drops at 1 Hit Point and Unconscious until it regains Hit Points, stabilize.ts gives it first aid, or an hour passes on the game clock and its Short Rest ends (game-time.ts). |
| Lightly Obscured | enforced | With dynamic vision on, vision/sight.ts knows Lightly Obscured points (Dim Light, a painted light fog or foliage area), and ability-checks.ts gives a Perception check to find a creature there Disadvantage. Passive Perception against it is the GM's. |
| Line | enforced | area-targeting.ts: a Line has a fixed width, and the point it starts from isn't in it. The server finds every creature with a cell centre inside the template. |
| Long Jump | enforced | jumping.ts lets a jump cover up to the Strength score with 10 feet moved this turn before it, half from a standing start, a foot of movement for each foot, and rolls the DC 10 Dexterity (Acrobatics) check on a landing in Difficult Terrain. Clearing a low obstacle is the GM's. |
| Long Rest | enforced | rests.ts needs 1 Hit Point and 16 hours since the last one. It restores Hit Points, Hit Point Dice, spell slots and uses, removes a level of Exhaustion and ends what lasts until a Long Rest. The party's Long Rest moves the game clock 8 hours, which counts down every effect (game-time.ts). |
| Magic | enforced | resolution/economy.ts spends the action when a spell or an item's action is used. A creature's own spell of a minute or more takes the action on each of its turns in a fight and resolves on the last (resolution/long-casting.ts); outside a fight it completes at once and moves the game clock by its whole hours. An item's long cast in a fight is a reminder to the GM (resolution/validate.ts). |
| Magical Effect | enforced | resolution/pending.ts marks a save against a spell or a magic item as magical, which Magic Resistance reads. |
| Malnutrition | reference | Food isn't tracked. |
| Monster | reference | A definition; there is nothing to apply. |
| Nonplayer Character | reference | A definition; there is nothing to apply. |
| Object | reference | Objects have no game statistics in the app. |
| Occupied Space | enforced | movement-rules.ts refuses a move that ends in another creature's space, unless one of them can share it, and occupied-space.ts leaves a creature that ends its turn in another's space Prone unless it is Tiny or larger than the other. |
| Opportunity Attacks | enforced | movement-rules.ts opens a Reaction prompt when a mover leaves an enemy's reach, and reactions.ts resolves it as one melee attack. The mover waits at the edge of that reach while the prompt is open and carries on once it is answered, unless the attack dropped it, grappled it or knocked it Prone (held-moves.ts). Disengage, teleporting and forced movement provoke none. |
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
| Search | guided | resolution/builtins.ts rolls the chosen Wisdom check. With dynamic vision on, a Perception search finds each hidden creature in its line of sight whose Hide total it meets and ends its hiding. The GM sets any other DC and says what else the creature finds. |
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
| Teleportation | enforced | movement-rules.ts moves a teleporting creature with no movement spent and no Opportunity Attack. A teleport a spell, feature or action granted for the turn (granted-moves.ts) is taken at once when it keeps to its range, an unoccupied space and one the creature can see; any other teleport of a player's needs the GM's go-ahead. |
| Temporary Hit Points | enforced | hit-points.ts takes damage from Temporary Hit Points first, and a Long Rest clears them. A new grant replaces the old one; choosing to keep the higher is the GM's. |
| Tremorsense | guided | vision/senses.ts reads it, and with dynamic vision on vision/sight.ts lets the creature pinpoint creatures within range, walls or not, without seeing them. Whether a creature is touching the ground is the GM's. |
| Truesight | enforced | Within its range vision/sight.ts lets a creature see Invisible creatures and into normal and magical Darkness, and attack rolls read it, by the distance between the tokens with dynamic vision off. Illusions, true forms and the Ethereal Plane are the GM's. |
| Unarmed Strike | enforced | resolution/builtins.ts rolls the strike for 1 plus Strength Bludgeoning damage, or the grapple or shove save against 8 plus Strength plus the Proficiency Bonus. |
| Unconscious | enforced | effects.ts adds Prone, and it counts as Incapacitated with Speed 0. saving-throws.ts fails its Strength and Dexterity saves. resolution/attack.ts gives attack rolls against it Advantage and makes a hit from within 5 feet a Critical Hit. Dropping what it holds is the GM's. |
| Unoccupied Space | enforced | movement-rules.ts ends a move only in a space no other creature fills. |
| Utilize | guided | resolution/economy.ts spends the action. What the object does is the GM's. |
| Vulnerability | enforced | hit-points.ts doubles damage of a type the creature is vulnerable to, once per instance. |
| Weapon | reference | A definition. Each weapon's own row under Weapons says what the app does with it. |
| Weapon Attack | enforced | resolution/attack.ts rolls it with the weapon's ability, proficiency, properties and mastery. |

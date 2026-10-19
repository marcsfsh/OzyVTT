/**
 * The coverage rows the data can't compute (`srd-coverage.ts`): the 15 conditions, the rules glossary, each kind of
 * monster trait, and records the engine handles in code that the data-driven pass gets wrong. Each says where it
 * happens, so the owner can check it. The states:
 * - enforced: the server applies the record in play. The GM may still supply a fact the map can't see (sight, light,
 *   a degree of cover), and the note names any narrative part left to the table.
 * - guided: the app tracks the record (a counted use, a prompt, a reminder, a rolled check) or applies part of it,
 *   and a person applies the rest. The note says which part is which.
 * - reference: the app shows the text and applies nothing.
 */
export type CoverageState = "enforced" | "guided" | "reference";
export type CuratedCoverage = Readonly<{ state: CoverageState; note: string }>;

const enforced = (note: string): CuratedCoverage => ({ state: "enforced", note });
const guided = (note: string): CuratedCoverage => ({ state: "guided", note });
/** A spell whose cast the server makes (its action, components and the table's line), with what it does left to a
 *  person. */
const castOnly = (rest: string): CuratedCoverage =>
  guided(
    `The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. ${rest}`
  );
const reference = (note: string): CuratedCoverage => ({ state: "reference", note });

export const CONDITION_COVERAGE: Readonly<Record<string, CuratedCoverage>> = {
  blinded: enforced(
    "resolution/attack.ts: its attack rolls have Disadvantage and attack rolls against it have Advantage. ability-checks.ts fails its Perception check to find a creature unless its Blindsight reaches it, and any check the GM marks as needing sight (check-rolls.ts, a call for a roll). movement-rules.ts: it makes an Opportunity Attack only against a mover in its Blindsight, and with dynamic vision on vision/sight.ts lets it see only within Blindsight."
  ),
  charmed: enforced(
    "resolution/economy.ts: a Charmed creature can't attack its charmer or target it with a save, damage or a spell, whether the condition came from a spell, an action or the GM's chip naming the charmer (actor-conditions.ts). ability-checks.ts gives the charmer Advantage on Charisma checks and Animal Handling against it (Influence, or a check the GM calls naming it)."
  ),
  deafened: enforced(
    "ability-checks.ts fails a check the GM marks as needing hearing (check-rolls.ts, a call for a roll); nothing else in the condition changes a roll."
  ),
  exhaustion: enforced(
    "condition-rules.ts takes 2 per level from every D20 Test, and speed.ts takes 5 feet per level from Speed. effects.ts kills the creature at level 6, and rests.ts removes a level on each Long Rest, except the levels hunger and thirst hold until the creature eats and drinks its fill (survival.ts). Breathing again takes off the levels suffocating gave (breath.ts)."
  ),
  frightened: enforced(
    "resolution/attack.ts, ability-checks.ts and encounter.ts give it Disadvantage on attack rolls, ability checks and Initiative while the source of its fear is within line of sight (vision/rules.ts; always with dynamic vision off, or when the GM set the condition by hand without naming its source). movement-rules.ts refuses a willing move, a granted one included, that ends closer to the source, measuring height too."
  ),
  grappled: enforced(
    "speed.ts: Speed 0. resolution/attack.ts: Disadvantage on attack rolls against anyone but the grappler. movement-rules.ts lets the grappler drag it, and resolution/builtins.ts rolls Escape a Grapple against the escape DC."
  ),
  incapacitated: enforced(
    "resolution/economy.ts refuses its actions, Bonus Actions and Reactions. effects.ts ends its Concentration and its grapples, and encounter.ts gives it Disadvantage on Initiative."
  ),
  invisible: enforced(
    "resolution/attack.ts: Advantage on its attack rolls and Disadvantage on attack rolls against it, unless the other creature sees it (Blindsight, Truesight or See Invisibility within range, or the map with dynamic vision on) or Faerie Fire outlines it. encounter.ts: Advantage on Initiative. movement-rules.ts: it provokes an Opportunity Attack only from a creature whose Blindsight or Truesight reaches it."
  ),
  paralyzed: enforced(
    "It counts as Incapacitated, and speed.ts sets its Speed to 0. saving-throws.ts fails its Strength and Dexterity saves. resolution/attack.ts gives attack rolls against it Advantage and makes a hit from within 5 feet a Critical Hit."
  ),
  petrified: enforced(
    "It counts as Incapacitated, with Speed 0 and failed Strength and Dexterity saves, and attack rolls against it have Advantage. hit-points.ts gives it Resistance to all damage, and effects.ts makes it immune to the Poisoned condition. Its change of substance is narrative."
  ),
  poisoned: enforced(
    "resolution/attack.ts and ability-checks.ts: Disadvantage on its attack rolls and ability checks, Initiative included."
  ),
  prone: enforced(
    "movement-rules.ts charges an extra foot per foot while it crawls, and actor-conditions.ts charges half its Speed to stand up. resolution/attack.ts: Disadvantage on its attack rolls, and attack rolls against it have Advantage within 5 feet and Disadvantage beyond."
  ),
  restrained: enforced(
    "speed.ts: Speed 0. resolution/attack.ts: Disadvantage on its attack rolls and Advantage on attack rolls against it. saving-throws.ts: Disadvantage on its Dexterity saves."
  ),
  stunned: enforced(
    "It counts as Incapacitated. saving-throws.ts fails its Strength and Dexterity saves, and resolution/attack.ts gives attack rolls against it Advantage."
  ),
  unconscious: enforced(
    "effects.ts adds Prone, and it counts as Incapacitated with Speed 0. saving-throws.ts fails its Strength and Dexterity saves. resolution/attack.ts gives attack rolls against it Advantage and makes a hit from within 5 feet a Critical Hit. effects.ts and hit-points.ts take the weapons, wands, staffs and rods it holds out of its hands; they stay carried, and what one gave its Armor Class goes with it (held-items.ts)."
  )
};

/** A glossary entry that is a condition says what the condition's own row says. */
const condition = (id: string): CuratedCoverage => CONDITION_COVERAGE[id]!;

const areaShape = (note: string) =>
  enforced(`area-targeting.ts: ${note} The server finds every creature with a cell centre inside the template.`);

export const GLOSSARY_COVERAGE: Readonly<Record<string, CuratedCoverage>> = {
  "ability-check": enforced(
    "check-rolls.ts and ability-checks.ts roll it on the server. The roll adds the ability modifier and any proficiency or Expertise, with the Advantage and Disadvantage the rules give."
  ),
  "ability-score-and-modifier": enforced(
    "The builder sets the scores, and every roll adds the modifier from abilityModifier in rules-5e."
  ),
  action: enforced(
    "resolution/economy.ts allows one action on a creature's turn and refuses a second unless a feature such as Action Surge gives one."
  ),
  advantage: enforced(
    "rules-5e rolls two d20s and keeps the higher. Any Advantage and any Disadvantage on the same roll cancel."
  ),
  adventure: reference("A definition; there is nothing to apply."),
  alignment: reference("A definition; nothing in play reads it."),
  ally: enforced(
    "creature-sides.ts puts player characters and friendly creatures on one side, by token disposition. Auras, Pack Tactics and Help read it."
  ),
  "area-of-effect": enforced(
    "commands/actions.ts places the template and area-targeting.ts finds who is inside. The creature a Cone, a Line or an Emanation comes from is left out of it, and with dynamic vision on a creature every straight line to which a wall or closed door blocks from the point of origin is left out too."
  ),
  "armor-class": enforced(
    "armor-class.ts in the domain package works out AC from armor, Shield, Dexterity and riders, and every attack roll is compared with it."
  ),
  "armor-training": enforced(
    "equipment-derivation.ts gives untrained armor Disadvantage on Strength and Dexterity D20 Tests, and resolution/economy.ts refuses spells while it is worn. An untrained Shield adds no AC. Training an item grants counts too (Elven Chain)."
  ),
  attack: enforced(
    "resolution/economy.ts counts the attacks the Attack action allows, Extra Attack included, and lets the creature move between them. Equipping or stowing a weapon is the table's."
  ),
  "attack-roll": enforced("resolution/attack.ts rolls it on the server and compares it with the target's AC."),
  attitude: guided(
    "The GM sets a monster's or NPC's attitude from its row (actor.set-attitude), Indifferent until then and never sent to a player. ability-checks.ts reads it in Influence and in Charisma checks naming the creature: Advantage against a Friendly one, Disadvantage against a Hostile one. What the creature does about it is the GM's."
  ),
  attunement: enforced(
    "inventory.ts holds a creature to three attuned items, and an item that needs Attunement gives nothing until it has it."
  ),
  blinded: condition("blinded"),
  blindsight: enforced(
    "vision/senses.ts reads it from stat blocks, features, items and effects. Within its range a creature perceives what no wall hides, Blinded, in darkness or fog, or against the Invisible condition (vision/sight.ts). Attack rolls, Hide, Search and Opportunity Attacks read it, by the distance between the tokens with dynamic vision off."
  ),
  bloodied: enforced(
    "The server counts half Hit Points or fewer as Bloodied (healthBandOf in hit-points.ts) for the rules that name it, such as monster traits and damage that changes when Bloodied."
  ),
  "bonus-action": enforced(
    "resolution/economy.ts allows one Bonus Action on a turn, and only from a feature, spell or item that offers one."
  ),
  "breaking-objects": enforced(
    "A door or wall on the map, and what holds a creature (a Net, a web, a rope), can be an object with an Armor Class, Hit Points and a damage threshold (objects.ts); the GM's door editor sets them from the substance and size tables. object.attack rolls a creature's attack against it (object-strikes.ts) and object.damage deals the GM's damage. Poison and Psychic damage do nothing, and at 0 Hit Points a wall or door is gone and a held creature is freed."
  ),
  "bright-light": enforced(
    "With dynamic vision on, vision/sight.ts gives Bright Light under the scene's bright ambient light, in a painted bright area and within a light's bright radius, and a creature sees normally there."
  ),
  burning: enforced(
    "hazards.ts deals 1d4 Fire damage at the start of each of the creature's turns. Put Out the Fire (resolution/builtins.ts) ends it and leaves the creature Prone."
  ),
  "burrow-speed": enforced(
    "speed.ts and movement-rules.ts let a creature with a Burrow Speed move by burrowing, charged against that speed."
  ),
  campaign: reference("A definition; there is nothing to apply."),
  cantrip: enforced(
    "Every cantrip a sheet or stat block knows is a cast action with no slot (character-build.ts, monster-spells.ts), and its damage grows at the character levels its row prints (cantripTierAt in the content package)."
  ),
  "carrying-capacity": enforced(
    "carrying.ts weighs a character's rows and coins (fifty to the pound) against its Strength times its size's figure, and speed.ts holds its Speed to 5 feet while it carries more; the Gear tab shows the load. Dragging, lifting or pushing something it doesn't carry is the GM's."
  ),
  "challenge-rating": guided(
    "The bestiary shows each monster's CR and XP, and the encounter budget (EncounterBudget.tsx, encounters.ts in rules-5e) rates a fight for the party's levels. The GM decides what to run."
  ),
  "character-sheet": reference("A definition. The app's own sheet is where each character's records live."),
  charmed: condition("charmed"),
  climbing: enforced(
    "movement-rules.ts charges an extra foot per foot of climbing without a Climb Speed. A check for a slippery surface is the GM's."
  ),
  "climb-speed": enforced(
    "speed.ts gives a creature with a Climb Speed its own budget for climbing, with no extra cost."
  ),
  concentration: enforced(
    "resolution/concentration.ts ends the first Concentration spell when a second starts. hit-points.ts asks for a Constitution save against DC 10 or half the damage, up to 30, and effects.ts ends it when the caster is Incapacitated or dies, or when a spell that only affects creatures has none left under it. Its duration counts down on the game clock (game-time.ts)."
  ),
  condition: enforced(
    "effects.ts applies every condition through applyCondition, which honours immunities, ends one a creature becomes immune to, and ends it when its save says or its duration runs out, in rounds during a fight and on the game clock between them (game-time.ts)."
  ),
  cone: areaShape("its width at any point equals that point's distance from the origin."),
  cover: enforced(
    "With dynamic vision on, cover.ts works out Half, Three-Quarters and Total Cover from the walls between the attacker or the effect's origin and the target, and Half Cover from a creature in the way; a spell's wall gives the cover its text names (Blade Barrier's Three-Quarters, zone-walls.ts), and the GM can mark more. The server adds 2 or 5 to AC and Dexterity saves, and resolution/validate.ts refuses an attack against Total Cover, or across a sphere of force (enclosures.ts)."
  ),
  crawling: enforced("movement-rules.ts charges an extra foot per foot while a creature is Prone."),
  creature: reference("A definition; there is nothing to apply."),
  "creature-type": enforced(
    "statblock-facts.ts reads the stat block's type, and riders gated on a creature type read it (Divine Smite's extra die against Fiends and Undead)."
  ),
  "critical-hit": enforced(
    "resolution/attack.ts makes a 20 on the d20 hit, and the damage step rolls the attack's damage dice twice."
  ),
  cube: areaShape("a Cube is a square on the map with its own size for each side."),
  curses: guided(
    "inventory.ts hides a cursed item's curse until it is attuned, and its bearer can't end the Attunement. Hex, Bestow Curse and Geas mark what they leave as a curse, which Remove Curse ends (resolution/dispel.ts), and Remove Curse breaks the Attunement to a cursed item. A monster's curse, and other magic that ends curses, are the GM's to track."
  ),
  cylinder: areaShape("a Cylinder is drawn as a circle of its radius, and its height is the GM's."),
  "d20-test": enforced(
    "Ability checks, attack rolls and saving throws all roll on the server, and riders that name D20 Tests reach each of them."
  ),
  damage: enforced("hit-points.ts takes damage off Temporary Hit Points first and then Hit Points."),
  "damage-roll": enforced("The server rolls damage dice and adds the modifiers the action carries."),
  "damage-threshold": enforced(
    "An object on the map with a damage threshold takes no damage from a hit or effect below it, and the whole of one at or above it (objects.ts). No SRD stat block prints one."
  ),
  "damage-types": enforced(
    "Damage carries one of the 13 types, and hit-points.ts applies Immunity, Resistance and Vulnerability by type."
  ),
  darkness: enforced(
    "With dynamic vision on, vision/sight.ts treats an unlit point in a dark scene or a painted dark area as Heavily Obscured: only Darkvision, Blindsight, Truesight or Devil's Sight see there, and only Blindsight, Truesight or Devil's Sight into magical Darkness. Attack rolls, Hide, Search and what each player sees read it."
  ),
  darkvision: enforced(
    "vision/senses.ts reads it from species, stat blocks, items and effects, and with dynamic vision on vision/sight.ts lets the creature see Dim Light within its range as Bright Light and Darkness as Dim Light, so a creature in darkness there is Lightly Obscured to it."
  ),
  dash: enforced("resolution/grant.ts and speed.ts add the creature's Speed to its movement for the turn."),
  dead: enforced(
    "death.ts counts a creature dead at three failed death saves, at Exhaustion 6 or from massive damage, and a monster dead at 0 Hit Points. resolution/heal.ts gives the dead no Hit Points; only the GM's revival brings one back."
  ),
  deafened: condition("deafened"),
  "death-saving-throw": enforced(
    "death-saves.ts rolls it from the dying character's sheet: 10 or more succeeds, a 1 counts as two failures and a 20 restores 1 Hit Point. hit-points.ts adds a failure for damage taken at 0 Hit Points, two for a Critical Hit."
  ),
  dehydration: enforced(
    "survival.ts, while the GM tracks food and water: each character drinks from its Waterskins as the game day ends, as far as its need goes; less than half its water costs a level of Exhaustion that no rest removes until it drinks its fill. The GM gives a drink at a source."
  ),
  "difficult-terrain": enforced(
    "The GM paints difficult terrain on the map (terrain.ts), and movement-rules.ts charges double through it, through an enemy's space and through an opening sized for a creature one size smaller (footprintStepPassage). Freedom of Movement ignores it."
  ),
  "difficulty-class": enforced(
    "The server works out spell save DCs and feature DCs from the sheet and compares every save and check with its DC."
  ),
  "dim-light": enforced(
    "With dynamic vision on, vision/sight.ts knows Dim Light (dim ambient light, a painted dim area, a light's outer radius) and treats it as Lightly Obscured."
  ),
  disadvantage: enforced(
    "rules-5e rolls two d20s and keeps the lower. Any Advantage and any Disadvantage on the same roll cancel."
  ),
  disengage: enforced("movement-rules.ts opens no Opportunity Attacks against the creature for the rest of its turn."),
  dodge: enforced(
    "builtin-actions.ts gives attack rolls against it Disadvantage from an attacker it can see (vision/rules.ts) and its Dexterity saves Advantage until its next turn. Both lapse while it is Incapacitated."
  ),
  emanation: areaShape("an Emanation is a circle around its creature, which isn't in the area."),
  encounter: reference("A definition. Fights run in the encounter tracker, which the other rows describe."),
  enemy: enforced(
    "creature-sides.ts puts monsters and hostile creatures against the party, by token disposition. Opportunity Attacks, auras and Sneak Attack read it."
  ),
  exhaustion: condition("exhaustion"),
  "experience-points": enforced(
    "experience.ts keeps each character's XP total, which the GM awards as an amount or as a share of the defeated creatures' stat block XP (the lair XP for one fought in its lair). The sheet shows the next level's threshold and offers the level up once the total reaches it. How much to award, or levelling by milestone, is the GM's."
  ),
  expertise: enforced(
    "ability-checks.ts doubles the Proficiency Bonus on a check with a skill the sheet has Expertise in."
  ),
  falling: enforced(
    "falling.ts rolls 1d6 Bludgeoning for every 10 feet fallen, to 20d6, through the damage rules, and lands the creature Prone unless it took no damage. Into water it uses its Reaction for a DC 15 Strength (Athletics) or Dexterity (Acrobatics) check, the better of the two, a success halving the damage. The GM starts a fall with actor.fall, and a creature that can't stay in the air falls by itself; Feather Fall and Slow Fall are offered as Reactions to it. What it fell from and where it lands are the GM's."
  ),
  flying: enforced(
    "altitude.ts keeps the height a fly move or the GM gives a token, and every distance counts it. falling.ts drops a flier that is Prone, Incapacitated or at a Fly Speed of 0 unless it can hover, and one left with nothing to fly with, after any command."
  ),
  "fly-speed": enforced("speed.ts gives a creature with a Fly Speed its own budget for flying."),
  friendly: enforced(
    "ability-checks.ts gives an Influence check, or a Charisma check naming the creature, Advantage against a creature the GM set Friendly."
  ),
  frightened: condition("frightened"),
  grappled: condition("grappled"),
  grappling: enforced(
    "resolution/builtins.ts rolls the target's Strength or Dexterity save against 8 plus Strength plus the Proficiency Bonus, and refuses a target more than one size larger. The grapple ends when the grappler is Incapacitated or moves out of reach (effects.ts)."
  ),
  hazard: reference("A definition. Burning has its own row; the other hazards aren't tracked."),
  healing: enforced(
    "resolution/heal.ts restores Hit Points up to the maximum, and healing a dying character brings it back to consciousness."
  ),
  "heavily-obscured": enforced(
    "With dynamic vision on, no one sees into a Heavily Obscured space (darkness beyond a creature's senses, a painted fog or foliage area, a spell's cloud) in vision/sight.ts, so an attack there is against an unseen target, a creature there may Hide, and a Perception check to find a creature there fails (ability-checks.ts)."
  ),
  help: guided(
    "resolution/attack.ts gives the next attack roll by an ally against the distracted enemy Advantage. Help with a Check gives an ally Advantage on its next check with one of the helper's skill or tool proficiencies before the helper's next turn (help-assist.ts), in a fight or outside one from the sheet's Checks tab. Whether the ally is near enough to assist is the GM's."
  ),
  "heroic-inspiration": guided(
    "held-rolls.ts spends it to reroll the d20 of an attack, a check, a save or a death save while the roll is shown, initiative-reroll.ts an initiative die before the character's first turn, and resolution/held-damage.ts one die of an action's damage looked at before it counts. Only the GM gives it by hand. rests.ts gives it to a Human on a Long Rest, and turn-boundaries.ts to a Champion at the start of its turn. A character who gains a second one passes it to a player character without it or lets it go (heroic-inspiration.ts). The dice of a hit's extras (Sneak Attack, a smite), a reaction's strike, healing and Hit Point Dice are the GM's to reroll."
  ),
  hide: enforced(
    "resolution/builtins.ts rolls a DC 15 Dexterity (Stealth) check and makes the creature Invisible on a success, until it attacks, casts a spell with a Verbal component or an enemy's Search meets its total. With dynamic vision on, resolution/validate.ts asks that it be Heavily Obscured or behind Three-Quarters or Total Cover and out of every enemy's sight (vision/rules.ts). A sound louder than a whisper is the GM's call."
  ),
  "high-jump": enforced(
    "jumping.ts lets a jump rise up to 3 plus the Strength modifier with 10 feet moved this turn before it, half from a standing start, a foot of movement for each foot. Reaching up half its height more is the GM's."
  ),
  "hit-point-dice": enforced(
    "rests.ts lets a creature spend them only during a Short Rest (its own or the party's), each healing its roll plus the Constitution modifier, and restores them all on a Long Rest. The GM may spend them any time."
  ),
  "hit-points": enforced(
    "hit-points.ts keeps Hit Points between 0 and the maximum, and a creature at 0 falls Unconscious or dies."
  ),
  hostile: enforced(
    "ability-checks.ts gives an Influence check, or a Charisma check naming the creature, Disadvantage against a creature the GM set Hostile."
  ),
  hover: enforced(
    "speed.ts records whether a creature hovers, and falling.ts keeps a hovering flier in the air while it is Prone, Incapacitated or at a Fly Speed of 0."
  ),
  illusions: reference("Illusions are the GM's to run."),
  immunity: enforced(
    "hit-points.ts ignores damage of an immune type. effects.ts refuses a condition the creature is immune to, and a creature that becomes immune (Heroism, a Periapt of Proof against Poison) loses the condition it already has."
  ),
  "improvised-weapons": reference("An improvised attack is the GM's to set up."),
  incapacitated: condition("incapacitated"),
  indifferent: enforced(
    "A creature is Indifferent until the GM sets another attitude: its checks roll normally, and Perfume's Advantage reads it (ability-checks.ts)."
  ),
  influence: guided(
    "resolution/builtins.ts rolls the chosen Charisma or Wisdom check against 15 or the monster's Intelligence, whichever is higher, with Advantage against a Friendly creature or its charmer and Disadvantage against a Hostile one (ability-checks.ts). Animal Handling is refused against a creature that is neither a Beast nor a Monstrosity. The GM decides what the monster does."
  ),
  initiative: enforced(
    "encounter.ts rolls Initiative as a Dexterity check, with its Advantage, Disadvantage and the bonuses Dexterity checks take, flat or rolled (a Stone of Good Luck's +1), and orders the turns. The players order their characters tied on a score before either acts (initiative.order-tie); the GM orders tied monsters."
  ),
  invisible: condition("invisible"),
  jumping: enforced(
    "token.move's `jump` way of moving goes straight over what lies between, measured as a Long Jump across and a High Jump up (jumping.ts), and a landing in Difficult Terrain rolls a DC 10 Dexterity (Acrobatics) check or leaves the jumper Prone."
  ),
  "knocking-out-a-creature": enforced(
    "A melee hit's confirm offers Knock out (resolution/knock-out.ts), and every apply path then lands it: hit-points.ts leaves a creature it drops at 1 Hit Point and Unconscious until it regains Hit Points, stabilize.ts gives it first aid, or an hour passes on the game clock and its Short Rest ends (game-time.ts)."
  ),
  "lightly-obscured": enforced(
    "With dynamic vision on, vision/sight.ts knows Lightly Obscured points (Dim Light, a painted light fog or foliage area), and ability-checks.ts gives a Perception check to find a creature there Disadvantage, and a Passive Perception compared with a Hide total 5 less (resolution/builtins.ts)."
  ),
  line: areaShape("a Line has a fixed width, and the point it starts from isn't in it."),
  "long-jump": enforced(
    "jumping.ts lets a jump cover up to the Strength score with 10 feet moved this turn before it, half from a standing start, a foot of movement for each foot, and rolls the DC 10 Dexterity (Acrobatics) check on a landing in Difficult Terrain. Clearing a low obstacle is the GM's."
  ),
  "long-rest": enforced(
    "rests.ts needs 1 Hit Point and 16 hours since the last one. It restores Hit Points, Hit Point Dice, spell slots and uses, removes a level of Exhaustion and ends what lasts until a Long Rest. The party's Long Rest moves the game clock 8 hours, which counts down every effect (game-time.ts)."
  ),
  magic: enforced(
    "resolution/economy.ts spends the action when a spell or an item's action is used. A creature's own spell of a minute or more takes the action on each of its turns in a fight and resolves on the last (resolution/long-casting.ts); outside a fight it completes at once and moves the game clock by its whole hours. An item's long cast in a fight is a reminder to the GM (resolution/validate.ts)."
  ),
  "magical-effect": enforced(
    "resolution/pending.ts marks a save against a spell or a magic item as magical, which Magic Resistance reads."
  ),
  malnutrition: enforced(
    "survival.ts, while the GM tracks food and water: each character eats its Rations as the game day ends, as far as its need goes; less than half its food asks a DC 10 Constitution save against a level of Exhaustion, and five days with no food give a level each day. Those levels stay until it eats its fill. The GM gives a meal."
  ),
  monster: reference("A definition; there is nothing to apply."),
  "nonplayer-character": reference("A definition; there is nothing to apply."),
  object: enforced(
    "Doors and walls on the map, and the nets, webs and ropes that hold creatures, can carry an object's Armor Class and Hit Points (objects.ts). An object takes damage from attacks (object.attack). It fails every saving throw, so an area's full damage on one is the GM's to deal with object.damage."
  ),
  "occupied-space": enforced(
    "movement-rules.ts refuses a move that ends in another creature's space, unless one of them can share it, and occupied-space.ts leaves a creature that ends its turn in another's space Prone unless it is Tiny or larger than the other."
  ),
  "opportunity-attacks": enforced(
    "movement-rules.ts opens a Reaction prompt when a mover leaves an enemy's reach, and reactions.ts resolves it as one melee attack. The mover waits at the edge of that reach while the prompt is open and carries on once it is answered, unless the attack dropped it, grappled it or knocked it Prone (held-moves.ts), and the spell areas on the rest of its way act on it as it goes on. Disengage, teleporting and forced movement provoke none."
  ),
  paralyzed: condition("paralyzed"),
  "passive-perception": enforced(
    "ability-checks.ts works it out as 10 plus the Wisdom (Perception) bonus, 5 more with Advantage and 5 less with Disadvantage. After a successful Hide, resolution/builtins.ts names to the GM each enemy whose score meets the Stealth total; whether it notices, and anything else hidden, is the GM's."
  ),
  "per-day": enforced("use-pools.ts counts the uses, and a Long Rest gives them back."),
  petrified: condition("petrified"),
  "player-character": reference("A definition; there is nothing to apply."),
  poisoned: condition("poisoned"),
  possession: reference("Possession is the GM's to run."),
  proficiency: enforced(
    "The server adds the Proficiency Bonus to attacks, saves and checks the sheet is proficient in."
  ),
  prone: condition("prone"),
  reach: enforced(
    "resolution/economy.ts refuses a melee attack beyond reach, 5 feet unless the weapon or stat block says more. Opportunity Attacks use the same reach."
  ),
  reaction: enforced(
    "resolution/economy.ts refuses a second Reaction before the creature's next turn, when encounter.ts gives it back."
  ),
  ready: enforced(
    "resolution/ready.ts holds the response until the start of the creature's next turn and spends its Reaction to take it. A readied spell spends its slot at once and holds Concentration."
  ),
  resistance: enforced("hit-points.ts halves damage of a resisted type, rounded down, once per instance of damage."),
  restrained: condition("restrained"),
  ritual: enforced(
    "character-build.ts gives each Ritual spell on a sheet a cast with no slot, which resolution/economy.ts refuses unprepared except a Wizard's from the spellbook it carries (ritual-adept.ts). resolution/long-casting.ts adds the 10 minutes: in a fight the cast takes the action on each turn until it completes."
  ),
  "round-down": enforced("The server rounds down wherever a rule divides (halved damage, half Speed, DCs)."),
  save: enforced("Another name for a saving throw; see that row."),
  "saving-throw": enforced(
    "saving-throws.ts opens a save prompt for each target and rolls it on the server, with the proficiency, riders, Advantage and Disadvantage that apply. A creature may choose to fail it without a roll (save.answer)."
  ),
  search: guided(
    "resolution/builtins.ts rolls the chosen Wisdom check. With dynamic vision on, a Perception search finds each hidden creature in its line of sight whose Hide total it meets and ends its hiding. The GM sets any other DC and says what else the creature finds."
  ),
  "shape-shifting": enforced(
    "transform/assume.ts takes a form as an effect on the creature: a stat block's statistics replace its own, with what the effect says it keeps (transform/compose.ts), or one of its printed forms changes its size and speeds. Its Hit Points stay its own, conditions and effects carry over, and the token takes the form's size (transform/forms.ts). It reverts when the effect ends or it dies (transform/rules.ts)."
  ),
  "short-rest": enforced(
    "rests.ts needs 1 Hit Point, lets Hit Point Dice be spent, gives back what a Short Rest restores and ends what lasts until one. The party's Short Rest moves the game clock an hour when the GM finishes it. short-rest-interruptions.ts ends it for anyone who rolls Initiative, takes damage or casts a spell above a cantrip."
  ),
  "simultaneous-effects": guided(
    "simultaneous-effects.ts: two or more things that change Hit Points as a turn starts or ends (ongoing damage, Hit Points or Temporary Hit Points regained, a trait that burns or regenerates) wait for the creature's controller, its player or the GM, to put them in order, and turn-boundaries.ts plays them out that way. The saves a turn opens are prompts answered in any order. Other things that happen at once (effects set off by the same hit) run in the server's order, which the GM may correct."
  ),
  size: enforced(
    "token-placement.ts sizes each token's space by its size, and size limits (grappling, shoving) are checked on the server."
  ),
  skill: enforced("ability-checks.ts adds the Proficiency Bonus to a check with a skill the sheet is proficient in."),
  speed: enforced(
    "movement-rules.ts charges each move against the creature's Speed for the turn, and each special speed has its own budget."
  ),
  spell: enforced(
    "Every spell a sheet or stat block knows is a cast action that spends its casting time and slot (resolution/economy.ts) and is told to the table as cast (cast-narration.ts). Each spell's own row under Spells says what else the app does with it."
  ),
  "spell-attack": enforced(
    "resolution/attack.ts rolls it with the caster's spell attack bonus, Advantage and Disadvantage included."
  ),
  "spellcasting-focus": enforced(
    "resolution/components.ts checks a cast's components: a Verbal one needs a caster who can speak outside Silence, a Somatic one a free hand (a Shield or bound hands fill one), and a Material one a Component Pouch, the focus the class names or the material itself. A priced material must be carried, and a consumed one is used up. A stat block's cast is held to its Verbal component unless its text says it needs none; its hands and materials are the GM's."
  ),
  sphere: areaShape("a Sphere is a circle of its radius, and the point it starts from is in it."),
  stable: enforced(
    "stabilize.ts stops death saves after three successes, first aid or Spare the Dying. effects.ts rolls the 1d4 hours on the game clock after which the creature regains 1 Hit Point, and damage before then starts its dying again."
  ),
  "stat-block": reference("A definition. Each monster's actions and traits have their own rows above."),
  study: guided(
    "resolution/builtins.ts rolls the chosen Intelligence check. The GM sets the DC and says what the creature learns."
  ),
  stunned: condition("stunned"),
  suffocation: enforced(
    "breath.ts: a creature out of air holds its breath for 1 plus its Constitution modifier minutes (at least 30 seconds, or a Hold Breath trait's time), counted as its turns end and as game time passes, then gains a level of Exhaustion at the end of each of its turns; breathing again takes those levels off. The GM starts it from the creature's row, and an underwater fight, a gelatinous cube's Engulf or a water elemental's Whelm starts it too. Amphibious, Water Breathing and a Cloak of the Manta Ray spare a creature."
  ),
  surprise: enforced("encounter.ts gives a creature the GM marks as surprised Disadvantage on its Initiative roll."),
  swimming: enforced(
    "movement-rules.ts charges an extra foot per foot of swimming without a Swim Speed. A check in rough water is the GM's."
  ),
  "swim-speed": enforced(
    "speed.ts gives a creature with a Swim Speed its own budget for swimming, with no extra cost."
  ),
  target: enforced(
    "resolution/spell-targets.ts holds a spell to the number of targets it names (more with a higher slot), the creature type it affects, the ones the caster can see when dynamic vision is on, its range, and for creatures of the caster's choice in an area, to those inside it."
  ),
  telepathy: reference("Telepathy is the table's to run."),
  teleportation: enforced(
    "movement-rules.ts moves a teleporting creature with no movement spent and no Opportunity Attack. A teleport a spell, feature or action granted for the turn (granted-moves.ts) is taken at once when it keeps to its range, an unoccupied space and one the creature can see; any other teleport of a player's needs the GM's go-ahead."
  ),
  "temporary-hit-points": enforced(
    "hit-points.ts takes damage from Temporary Hit Points first, and a Long Rest clears them. A new grant replaces the old one; choosing to keep the higher is the GM's."
  ),
  tremorsense: guided(
    "vision/senses.ts reads it, and with dynamic vision on vision/sight.ts lets the creature pinpoint creatures within range, walls or not, without seeing them. Whether a creature is touching the ground is the GM's."
  ),
  truesight: enforced(
    "Within its range vision/sight.ts lets a creature see Invisible creatures and into normal and magical Darkness, and attack rolls read it, by the distance between the tokens with dynamic vision off. Illusions, true forms and the Ethereal Plane are the GM's."
  ),
  "unarmed-strike": enforced(
    "resolution/builtins.ts rolls the strike for 1 plus Strength Bludgeoning damage, or the grapple or shove save against 8 plus Strength plus the Proficiency Bonus."
  ),
  unconscious: condition("unconscious"),
  "unoccupied-space": enforced("movement-rules.ts ends a move only in a space no other creature fills."),
  utilize: guided(
    "resolution/economy.ts spends the action, and a Shield donned or doffed in a fight takes it (held-items.ts). The sheet offers each tool's Utilize uses as checks at their printed DCs. What the object does is the GM's."
  ),
  vulnerability: enforced("hit-points.ts doubles damage of a type the creature is vulnerable to, once per instance."),
  weapon: reference("A definition. Each weapon's own row under Weapons says what the app does with it."),
  "weapon-attack": enforced(
    "resolution/attack.ts rolls it with the weapon's ability, proficiency, properties and mastery."
  )
};

/** A trait that brings a creature back to life somewhere else, which happens off the table. */
const revives = guided(
  "death-traits.ts tells the GM as the creature dies that it may come back, and marks a body that disappears as gone (death.ts). When and where it returns are the GM's."
);
/** A trait about breathing, which breath.ts reads. */
const breath = enforced(
  "breath.ts reads it: the creature breathes water, or holds its breath for the time it prints, when it is out of air."
);
/** A tool's row: its check and its Utilize uses are the sheet's; crafting with it is the GM's. */
const toolUse = guided(
  "The sheet rolls its check with the ability it names and offers its Utilize uses at their printed DCs (ability-checks.ts toolUses). In a fight that is the Utilize action, and crafting with it is the GM's."
);
/** A trait that lights the map around its creature. */
const sheds = enforced("vision/senses.ts gives the creature its printed Bright and Dim Light, carried with its token.");
/** A trait that hinders a creature standing in sunlight, read from the light where its token stands. */
const sunlightHinders = (rolls: string, files: string) =>
  enforced(
    `${files} give it Disadvantage on ${rolls} while it stands in sunlight (vision/rules.ts). With dynamic vision off, the light is the GM's.`
  );
/** A trait about communicating or sensing, which play doesn't read. */
const senses = reference("Communication and senses like this are the GM's to run.");
/** A trait about squeezing through narrow gaps, an inch wide (wall-passage.ts). */
const squeezes = enforced(
  "With dynamic vision on, terrain.ts lets the creature through any gap in the walls its body can follow, however narrow, at no extra cost (wall-passage.ts, slipsThroughStep in rules-5e), and the map's drag preview (movePreview.ts) charges the same path. A closed door still stops it."
);
/** A trait about jumping, which the app doesn't measure. */
/** A trait about changing into another stat block after a Long Rest, which is a swap of stat blocks. */
const changesForm = reference(
  "Changing to the other stat block after a Long Rest is the GM's: place that stat block on the map in this one's stead."
);
/** A trait that regains Hit Points from damage of one type, which the creature is also immune to. */
const absorbs = (type: string) =>
  enforced(
    `Each time ${type} damage lands on it, the creature regains Hit Points equal to the ${type} damage dealt (damage-traits.ts), beside the stat block's own defences against it (hit-points.ts).`
  );

export const MONSTER_TRAIT_COVERAGE: Readonly<Record<string, CuratedCoverage>> = {
  Abduct: enforced("movement-rules.ts charges the bugbear no extra movement to drag a creature it grapples."),
  "Aberrant Ground": reference(
    "The GM can paint the Emanation as difficult terrain (terrain.ts), but the painted terrain doesn't move with the mouther."
  ),
  "Acid Absorption": absorbs("Acid"),
  Adhesive: reference("Sticking to what touches it is the GM's to apply with the Grappled condition."),
  Agile: enforced("movement-rules.ts opens no Opportunity Attack when it moves out of an enemy's reach."),
  "Air Form": enforced(
    "movement-rules.ts lets the air elemental end a move in another creature's space, and terrain.ts lets it through any gap in the walls an inch wide at no extra cost (wall-passage.ts). The map's drag preview (movePreview.ts) charges the same path."
  ),
  Amorphous: squeezes,
  Amphibious: breath,
  "Aura of Authority": enforced(
    "statblock-traits.ts gives the hobgoblin and its allies within 10 feet Advantage on attack rolls and saving throws while it isn't Incapacitated."
  ),
  "Aversion to Fire": enforced(
    "Fire damage that lands gives the golem Disadvantage on attack rolls and ability checks until the end of its next turn (damage-traits.ts)."
  ),
  "Barbed Hide": enforced(
    "trait-turns.ts deals 1d10 Piercing damage at the start of the devil's turns to each creature it grapples or that grapples it."
  ),
  "Beast of Burden": reference("A stat block carries nothing the app weighs, so what the creature hauls is the GM's."),
  Berserk: enforced(
    "trait-turns.ts rolls the d6 when the golem starts its turn Bloodied and keeps it berserk until it isn't Bloodied. Choosing what it attacks is the GM's."
  ),
  "Blood Frenzy": enforced(
    "resolution/attack.ts gives the sahuagin Advantage against a creature that doesn't have all its Hit Points."
  ),
  "Bloodied Frenzy": enforced(
    "resolution/attack.ts and saving-throws.ts give the Bloodied berserker Advantage on attack rolls and saving throws."
  ),
  "Bloodied Fury": enforced("resolution/attack.ts gives the Bloodied creature Advantage on attack rolls."),
  "Blurred Form": enforced(
    "Attack rolls against the mephit have Disadvantage unless it is Incapacitated (resolution/attack.ts)."
  ),
  Bound: reference("The amulet and the damage it shares are the GM's to run."),
  "Celestial Restoration": revives,
  Compression: squeezes,
  "Confer Fire Resistance": reference("Granting its rider Resistance is the GM's to apply."),
  "Corrosive Form": guided(
    "resolution/struck.ts deals the black pudding's 1d8 Acid damage to a creature that hits it with a melee attack. The gray ooze's printing deals none, and the damage to weapons and ammunition is the GM's."
  ),
  "Death Burst": enforced(
    "statblock-traits.ts opens the save for each creature in the Emanation when it dies, with the damage rolled once."
  ),
  "Death Throes": enforced(
    "statblock-traits.ts opens the Dexterity save for each creature within 30 feet when the balor dies, with its Fire and Force damage rolled once. Its new body in the Abyss is the GM's."
  ),
  "Demonic Restoration": revives,
  "Diabolical Restoration": revives,
  "Divine Awareness": senses,
  "Draconic Origin": reference("The GM picks the damage type and edits the stat block to match."),
  "Earth Glide": enforced(
    "A burrowing move passes it through the map's walls at no extra cost (terrain.ts, wall-passage.ts), and a wall a spell raised still stops it. Leaving no trace is the GM's."
  ),
  "Eldritch Restoration": revives,
  "Elemental Restoration": revives,
  Ephemeral: enforced("inventory.ts refuses any item given to the wisp to wear or carry."),
  "Ethereal Sight": senses,
  Evasion: enforced(
    "saving-throws.ts takes no damage on a successful Dexterity save for half damage and half on a failure, while the assassin isn't Incapacitated."
  ),
  "Exalted Restoration": revives,
  "Fear Aura": enforced(
    "trait-turns.ts opens the Wisdom save for each enemy that starts its turn in the aura while the pit fiend isn't Incapacitated. A failure is Frightened until the start of its next turn, and a success makes it immune for the fight."
  ),
  "Fiendish Restoration": revives,
  "Fire Absorption": absorbs("Fire"),
  "Fire Aura": enforced(
    "trait-turns.ts deals the Fire damage at the end of the bearer's turns to each creature in the Emanation, or to an azer's enemies there. A fire elemental's aura also sets them burning."
  ),
  "Fire Form": enforced(
    "movement-rules.ts lets the elemental end a move in a creature's space and terrain.ts lets it through any gap in the walls an inch wide, which the map's drag preview (movePreview.ts) charges the same way. A move of its own deals 1d10 Fire damage to each creature whose space it enters, once a turn per creature (wall-passage.ts)."
  ),
  Flyby: enforced("movement-rules.ts opens no Opportunity Attack when it flies out of an enemy's reach."),
  Freeze: enforced(
    "Cold damage that lands lowers the elemental's Speed by 20 feet until the end of its next turn (damage-traits.ts)."
  ),
  Gibbering: enforced(
    "trait-turns.ts opens the Wisdom save for each creature that starts its turn within 20 feet, and on a failure random-outcomes.ts rolls the d8: doing nothing takes its actions, Bonus Action, Reaction and Speed for the turn, wandering its actions and Bonus Action, and the random attack is said to the table."
  ),
  "Greater Magic Resistance": enforced(
    "saving-throws.ts makes the rakshasa succeed on saves against spells and magic items without a roll, and resolution/attack.ts makes spell attack rolls miss it. Hiding from divination is the GM's."
  ),
  "Heat Aura": enforced(
    "trait-turns.ts deals 3d10 Fire damage at the end of the remorhaz's turns to each creature within 5 feet."
  ),
  "Hellish Restoration": revives,
  "Hold Breath": breath,
  "Ice Walk": enforced(
    "zone-ground.ts charges the creature nothing extra on the ice a spell leaves (Ice Storm's hail, Sleet Storm). Ice and snow the GM paints as Difficult Terrain still cost it, so the GM waives that cost."
  ),
  Illumination: sheds,
  "Immutable Form": reference("Shape-changing isn't modeled, so there is nothing to refuse."),
  "Incorporeal Movement": guided(
    "terrain.ts passes it through walls and creatures as Difficult Terrain, and a wall a spell raised (Wall of Force) still stops it. The Force damage for ending a turn inside an object is the GM's, since walls are lines with no inside."
  ),
  "Incubus Form": changesForm,
  Inscrutable: reference("The Disadvantage on Insight checks about it is the GM's to apply."),
  Invisibility: enforced("actor-roster.ts gives the stalker the Invisible condition when it joins the roster."),
  "Iron Scent": senses,
  Jumper: enforced("jumping.ts measures its jumps with Dexterity in place of Strength."),
  "Legendary Resistance": enforced(
    "saving-throws.ts lets the GM turn a failed save into a success, as many times a day as the stat block prints, or its lair count while the GM marks it fighting in its lair (lair.ts). A Long Rest restores them."
  ),
  "Light Sensitivity": enforced(
    "resolution/attack.ts gives the cloaker Disadvantage on attack rolls while it stands in Bright Light (vision/rules.ts). With dynamic vision off, the light is the GM's."
  ),
  "Lightning Absorption": absorbs("Lightning"),
  "Limited Amphibiousness": guided(
    "breath.ts lets it breathe water. Its four hours out of water before it starts to suffocate are the GM's to count."
  ),
  "Loathsome Limbs": enforced(
    "death-traits.ts severs a limb when the troll ends any turn Bloodied after taking 15 Slashing damage or more in it, four times a day. The limb joins the fight as a Troll Limb under the troll's command and on its side in its space, and acts right after the troll (summons.ts). The troll has 1 Exhaustion level for each missing limb until it next regains Hit Points, when they grow back."
  ),
  "Magic Resistance": enforced(
    "saving-throws.ts gives it Advantage on saves against spells and magic items, saves a spell asks it to repeat included."
  ),
  "Magic Rope": guided(
    "The erinyes' Entangling Rope leaves its target Restrained and held by the rope, an object with AC 20, 90 Hit Points and Immunity to Poison and Psychic damage that an attack can break, which frees it (objects.ts). Restoring the rope on a rest is the GM's."
  ),
  Mimicry: senses,
  "Misty Escape": enforced(
    "death-traits.ts keeps the vampire alive at 0 Hit Points as mist that can't take actions or speak; in sunlight, read with dynamic vision on, it is destroyed instead. The mist is its Shape-Shift's printed form (transform/at-zero.ts): Medium, flying 20 feet with hover, with Resistance to all damage, and no change of form at 0 Hit Points. It lasts the 2 hours it has to reach its resting place, after which it is destroyed, and regaining Hit Points ends it. Running water and the Paralyzed condition at its resting place are the GM's."
  ),
  "Mucus Cloud": enforced(
    "trait-turns.ts asks the Constitution save of each creature within 5 feet at the end of the aboleth's turn while the fight is underwater, and a failure curses it: it breathes water, and it regains no Hit Points out of water (hit-points.ts, rests.ts). The acid out of water every 10 minutes is the GM's."
  ),
  "Multiple Heads": enforced(
    "death-traits.ts kills one head on each turn the hydra takes 25 damage or more, and the hydra with its last. At the end of its turn it grows two heads for each one lost since its last turn and regains 20 Hit Points, unless it took Fire damage since then. Its Multiattack makes one Bite per living head (effective-actions.ts)."
  ),
  "Ooze Cube": enforced(
    "Any creature may move into the cube's space, and one that does makes the Engulf save with Disadvantage (space-entry.ts). Engulf holds one Large or four smaller creatures inside, with Total Cover from outside, and a creature within 5 feet can pull one out with an action and the Athletics check, taking the acid."
  ),
  "Pack Tactics": enforced(
    "resolution/attack.ts gives Advantage when an ally of the attacker that isn't Incapacitated is within 5 feet of the target."
  ),
  "Probing Telepathy": senses,
  "Reactive Heads": reference("The extra Reactions are the GM's to allow."),
  Reactive: enforced("encounter.ts gives the marilith a fresh Reaction at the start of every turn."),
  "Reflective Carapace": reference("The d6 against spells aimed at it is the GM's to roll."),
  Regeneration: enforced(
    "trait-turns.ts restores the Hit Points at the start of its turns, stopped for a turn by the damage types it names. statblock-traits.ts keeps a troll at 0 Hit Points alive until a turn starts without regenerating."
  ),
  "Running Leap": enforced(
    "jumping.ts lets it Long Jump the printed distance after 10 feet of movement, half from a standing start."
  ),
  "Sense Magic": senses,
  "Shark Telepathy": senses,
  "Shielded Mind": senses,
  "Siege Monster": enforced(
    "objects.ts doubles the creature's damage to a door, a wall or another object before its threshold and immunities are read."
  ),
  "Soul Bag": reference("The bag and its statistics are the GM's to run."),
  "Speak with Beasts and Plants": senses,
  "Spell Storing": reference("Storing and casting the spell is the GM's to run."),
  "Spider Climb": enforced(
    "speed.ts moves it at its Climb Speed with no extra cost and no check, and a climb may change its height on the map (altitude.ts). Which surfaces it climbs is the GM's, as walls have no height."
  ),
  "Spirit Jar": revives,
  "Standing Leap": enforced(
    "jumping.ts lets it jump the printed Long and High Jump distances with or without a running start."
  ),
  Stench: enforced(
    "trait-turns.ts opens the Constitution save for each creature that starts its turn within 5 feet. A failure is Poisoned until the start of its next turn, and a success makes it immune for the fight."
  ),
  "Succubus Form": changesForm,
  "Sunlight Sensitivity": sunlightHinders(
    "attack rolls and ability checks",
    "resolution/attack.ts and ability-checks.ts"
  ),
  "Sunlight Weakness": sunlightHinders("D20 Tests", "resolution/attack.ts, ability-checks.ts and saving-throws.ts"),
  Swarm: enforced(
    "movement-rules.ts and terrain.ts let the swarm and other creatures share a space, and let it through any gap in the walls a Tiny creature fits at no extra cost (wall-passage.ts). The map's drag preview (movePreview.ts) charges the same path. Healing a swarm restores nothing (resolution/heal.ts)."
  ),
  "Telepathic Bond": senses,
  Training: reference("The GM picks the skill and applies its Advantage."),
  Transparent: reference("Noticing the cube is the GM's call, with the DC the trait prints."),
  "Treasure Sense": senses,
  "Troll Spawn": reference("What becomes of a severed limb is the GM's to run."),
  Tunneler: guided(
    "A burrowing move passes it through the map's walls at double cost, as through solid rock (terrain.ts, wall-passage.ts), and a wall a spell raised still stops it. The tunnel it leaves is the GM's to draw."
  ),
  "Undead Fortitude": enforced(
    "statblock-traits.ts rolls the Constitution save of DC 5 plus the damage when damage drops it to 0, and leaves it at 1 Hit Point on a success. Radiant damage and Critical Hits get no save."
  ),
  "Undead Restoration": revives,
  "Vampire Weakness": guided(
    "trait-turns.ts deals the vampire 20 Radiant damage when it starts its turn in sunlight, where resolution/attack.ts and ability-checks.ts give it Disadvantage on attack rolls and ability checks (vision/rules.ts). Running water, invitations and the stake are the GM's."
  ),
  "Vampiric Connection": senses,
  "Vile Appearance": enforced(
    "trait-turns.ts opens the Wisdom save for each Beast or Humanoid that starts its turn within 30 feet of the hag. A failure is Frightened until the start of its next turn, and a success makes it immune for the fight. With dynamic vision on, only a creature that sees the hag (vision/sight.ts) makes the save; whether the hag is disguised is the GM's."
  ),
  "Water Breathing": breath,
  "Water Form": enforced(
    "movement-rules.ts lets the water elemental end a move only in an enemy's space, and terrain.ts lets it through any gap in the walls an inch wide at no extra cost (wall-passage.ts). The map's drag preview (movePreview.ts) charges the same path."
  ),
  "Water Susceptibility": reference("Water on the map isn't tracked, so the Cold damage is the GM's to deal."),
  "Web Walker": enforced(
    "Web's webs cost the creature nothing extra (zone-ground.ts), and spell-zones.ts asks it for no save there. Webs the GM paints as Difficult Terrain still cost it, so the GM waives that cost."
  ),
  Wishes: reference("The djinni's wishes are the GM's to run.")
};

/** A stat block's Shape-Shift into its printed forms. */
const printedForms = (forms: string) =>
  `transform/assume.ts takes ${forms}, or returns to the true form, as a Bonus Action or an action as printed; the rest of its statistics stay its own.`;

/** A lycanthrope's attack that curses a Humanoid. */
const lycanthropeBite = (name: string) =>
  guided(
    `It works only in the animal and hybrid forms (transform/rules.ts). A hit opens the curse's Constitution save on a Humanoid, and a cursed creature that drops to 0 Hit Points becomes a ${name} with 10 Hit Points instead (transform/at-zero.ts). The 24 hours of immunity after a success, and the GM's control of the cursed creature, are the GM's.`
  );

/** A manual or tome, whose study the GM marks done. */
const studied = (ability: string) =>
  enforced(
    `item-study.ts records the study in the reader's build, so ${ability} rises by 2 (to at most 30) and stays through every rebuild, and the copy's magic is spent. The 48 hours of study are downtime the GM gives, and the GM moves the clock.`
  );

/**
 * Records the data-driven pass gets wrong: those the engine handles in code by id or by name, the base rows of a choice
 * whose chosen row carries the mechanics, and records whose data applies only part of what they do. Keyed `spell:`,
 * `feature:`, `item:` or `action:<monster>/<action id>`.
 */
export const RECORD_OVERRIDES: Readonly<Record<string, CuratedCoverage>> = {
  // Summoned and commanded creatures (summons.ts, summon-orders.ts, summon-turns.ts, summon-strikes.ts).
  "spell:animate-dead": enforced(
    "Each dead Humanoid corpse it targets within 10 feet rises as a Zombie (or a Skeleton), two more for each slot level above 3 (summons.ts), on the caster's side on its own Initiative. A Bonus Action commands every one within 60 feet (summon-orders.ts); uncommanded, one takes the Dodge action (summon-turns.ts). After 24 hours it obeys no one, and casting it again on up to four of them renews that. A pile of bones, and how an order is carried out, are the GM's."
  ),
  "spell:animate-objects": enforced(
    "Animated Objects of the sizes picked, up to the caster's spellcasting modifier with a Large one counting as two and a Huge one as three (summons.ts), act right after the caster with its spell attack modifier and the slot's Slam damage. A Bonus Action commands them within 500 feet; uncommanded, they take the Dodge action. Which objects lie near is the GM's."
  ),
  "spell:arcane-eye": enforced(
    "An Invisible, invulnerable eye appears within 30 feet (summons.ts) with Darkvision 30 feet, and the caster's player sees what it sees (vision/audience.ts). A Bonus Action moves it up to 30 feet (summon-orders.ts). Gaps an inch wide are the GM's."
  ),
  "spell:arcane-hand": guided(
    "The hand appears within 120 feet with AC 20 and the caster's Hit Point maximum, and the spell ends when it drops to 0 (summons.ts). Clenched Fist's attack and Grasping Hand's Dexterity save reach a creature within 5 feet of the hand, which moves up to 60 feet first (summon-strikes.ts), and the crush deals its damage. Forceful Hand's push, Interposing Hand's cover, the grapple's escape DC and the size limits are the GM's."
  ),
  "spell:arcane-sword": enforced(
    "The sword appears within 90 feet (summons.ts) and the cast's attack reaches a creature within 5 feet of it; each later Bonus Action moves it up to 30 feet first and strikes from there (summon-strikes.ts)."
  ),
  "spell:conjure-fey": enforced(
    "The spirit appears within 60 feet (summons.ts) and the cast's attack reaches a creature within 5 feet of it, Frightening on a hit; each later Bonus Action teleports it up to 30 feet first and strikes from there (summon-strikes.ts). The space being unoccupied is the GM's."
  ),
  "spell:create-undead": enforced(
    "Up to three Ghouls rise from dead Humanoid corpses within 10 feet, more from higher slots, or Ghasts, Wights or Mummies from levels 8 and 9 (summons.ts). A Bonus Action commands them within 120 feet (summon-orders.ts); uncommanded, they take the Dodge action. After 24 hours they obey no one, and casting it again renews that."
  ),
  "spell:find-familiar": enforced(
    "The familiar takes one of the spell's forms or another Challenge Rating 0 Beast, as a Celestial, Fey or Fiend, within 10 feet (summons.ts). It rolls its own Initiative and can't attack. A Bonus Action lets the caster's player see through its eyes until the start of the caster's next turn (vision/audience.ts), and a Magic action dismisses it or sends it to its pocket dimension and calls it back (summon-orders.ts). A touch spell is delivered from its space with its Reaction within 100 feet (summons.ts). Casting it again changes its form. Its telepathy is the GM's."
  ),
  "spell:find-steed": enforced(
    "The Otherworldly Steed at the slot's level, a Celestial, Fey or Fiend, appears within 30 feet and acts right after the caster (summons.ts); it can be ridden (mounts.ts). It disappears at 0 Hit Points or when the caster dies, and a new casting replaces it."
  ),
  "spell:floating-disk": castOnly(
    "The disk, what it carries and how it follows the caster are the GM's: weight isn't tracked."
  ),
  "spell:giant-insect": enforced(
    "A Giant Insect at the slot's level in the form picked appears within 60 feet and acts right after the caster with its spell attack modifier and save DC (summons.ts); uncommanded, it takes the Dodge action (summon-turns.ts). It disappears at 0 Hit Points or when the Concentration ends."
  ),
  "spell:mislead": enforced(
    "The caster turns Invisible until it attacks, deals damage or casts a spell, while the spell goes on (resolution/attack.ts), and its illusory double appears in its space (summons.ts): invulnerable and in no one's way, seeing for the caster's player (vision/audience.ts), moved twice the caster's Speed with a Magic action (summon-orders.ts). How the double behaves is the player's to describe."
  ),
  "spell:phantom-steed": enforced(
    "A Riding Horse with a Speed of 100 feet appears within 30 feet for the hour (summons.ts) and can be ridden (mounts.ts); any damage ends it."
  ),
  "spell:planar-binding": enforced(
    "Only a Celestial, an Elemental, a Fey or a Fiend can be the target. A failed Charisma save binds it to serve the caster for the spell's duration (resolution/concentration.ts), under the caster's command and on its side (summons.ts). What it is told to do, and lengthening another spell's summoning, are the GM's."
  ),
  "spell:project-image": enforced(
    "The illusory copy appears anywhere on the map (summons.ts), seeing for the caster's player (vision/audience.ts) and moved 60 feet with a Magic action (summon-orders.ts). Any damage to it ends it and the spell. Its intangibility to touch and a Study action to discern it are the GM's."
  ),
  "spell:spiritual-weapon": enforced(
    "The force appears within 60 feet (summons.ts) and the cast's attack reaches a creature within 5 feet of it; each later Bonus Action moves it up to 20 feet first and strikes from there (summon-strikes.ts). The force can't be harmed and fills no space."
  ),
  "spell:summon-dragon": enforced(
    "The Draconic Spirit at the slot's level appears within 60 feet and acts right after the caster with its spell attack modifier and save DC, its Rends half the slot's level (summons.ts); uncommanded, it takes the Dodge action (summon-turns.ts). The caster shares the Resistance picked while it lasts. It disappears at 0 Hit Points or when the Concentration ends."
  ),
  "spell:unseen-servant": enforced(
    "The Invisible servant appears within 60 feet with AC 10, 1 Hit Point and Strength 2 and can't attack (summons.ts). A Bonus Action sends it 15 feet (summon-orders.ts), and it ends more than 60 feet from the caster. Its tasks are the GM's."
  ),
  "feature:wild-companion": enforced(
    "Find Familiar is always prepared and cast as a Magic action with a slot or a use of Wild Shape, with no Material component (resolution/components.ts reads the cast's waiver); the familiar is Fey and leaves when the Druid finishes a Long Rest (character-build.ts, summons.ts)."
  ),
  "feature:dragon-companion": enforced(
    "Summon Dragon is cast with no Material component (resolution/components.ts reads the cast's waiver), free once a Long Rest, and any casting may go without Concentration, lasting 1 minute then (character-build.ts, summons.ts)."
  ),
  "item:bag-of-tricks": enforced(
    "The GM says which bag a found one is (item-records.ts); its pull rolls the d8 on that bag's table, and the creature appears within 20 feet acting right after its user until the next Long Rest or 0 Hit Points (summons.ts). A Bonus Action commands it (summon-orders.ts)."
  ),
  "item:bowl-of-commanding-water-elementals": enforced(
    "Once a dawn, a Water Elemental appears near its user, acts right after it, and leaves after 1 hour, at 0 Hit Points or when a Bonus Action dismisses it (summons.ts, summon-orders.ts). Filling the bowl is the GM's."
  ),
  "item:brazier-of-commanding-fire-elementals": enforced(
    "Once a dawn, a Fire Elemental appears near its user, acts right after it, and leaves after 1 hour, at 0 Hit Points or when a Bonus Action dismisses it (summons.ts, summon-orders.ts)."
  ),
  "item:censer-of-controlling-air-elementals": enforced(
    "Once a dawn, an Air Elemental appears near its user, acts right after it, and leaves after 1 hour, at 0 Hit Points or when a Bonus Action dismisses it (summons.ts, summon-orders.ts)."
  ),
  "item:stone-of-controlling-earth-elementals": enforced(
    "Once a dawn, an Earth Elemental appears within 30 feet, acts right after its user, and leaves after 1 hour, at 0 Hit Points or when a Bonus Action dismisses it (summons.ts, summon-orders.ts)."
  ),
  "item:elemental-gem": enforced(
    "The GM says which gem a found one is (item-records.ts): breaking it uses it up, and its elemental appears beside its user, acts right after it and leaves after 1 hour, at 0 Hit Points or when a Bonus Action dismisses it (summons.ts)."
  ),
  "item:efreeti-bottle": guided(
    "Opened, an Efreeti appears within 30 feet and the server rolls the d10 (summons.ts): on a 1 it attacks its user and leaves after 5 rounds, on 2 to 9 it obeys for 1 hour, on a 10 it stays up to an hour to grant a Wish. The first roll setting every later opening, the 24 hours between openings and the Wish are the GM's."
  ),
  "item:feather-token": guided(
    "The GM says which token a found one is (item-records.ts). The Bird token is used up for a Roc that can't attack and obeys its user until it is dismissed with a Magic action or drops to 0 Hit Points (summons.ts). The Anchor, Fan, Swan Boat, Tree and Whip are the GM's."
  ),
  "item:figurine-of-wondrous-power": guided(
    "The GM says which figurine a found one is (item-records.ts): its creature appears within 60 feet for its time, acts right after its user and defends itself when uncommanded, and a Magic action turns it back (summons.ts); clock-pools.ts holds it for its days. The Silver Raven, the goats' own waits and powers and the Obsidian Steed ignoring orders are the GM's."
  ),
  "item:ring-of-djinni-summoning": enforced(
    "The djinni appears within 120 feet while its wearer keeps Concentration, up to 1 hour, defending itself when uncommanded (summons.ts); clock-pools.ts holds the ring for 24 hours. The ring losing its magic when the djinni dies is the GM's."
  ),
  "item:staff-of-the-python": guided(
    "Thrown within 10 feet, it becomes a Giant Constrictor Snake that acts right after its user, commanded within 60 feet and defending itself otherwise; a Bonus Action turns it back (summons.ts, summon-orders.ts). The hour before it works again, and the staff shattering when the snake dies, are the GM's."
  ),
  "item:staff-of-swarming-insects": enforced(
    "Insect Cloud fills a 30-foot Emanation that is Heavily Obscured for everyone but its holder for 10 minutes (vision/cast-sight.ts). Giant Insect costs 4 charges and brings the insect (summons.ts), and Insect Plague costs 5. A strong wind dispersing the cloud is the GM's."
  ),
  "action:Aboleth/dominate-mind": guided(
    "The DC 16 Wisdom save and Charmed are applied, and a failure puts the target under the aboleth's command and on its side (summons.ts), so its player can't move it or act for it; it repeats the save whenever it takes damage, and the Charm ends when the aboleth dies (save-stages.ts). That the control reaches only 60 feet, and the save after each day spent a mile away, are the GM's."
  ),
  "action:Treant/animate-trees": enforced(
    "Two trees animate within 60 feet from the Treant stat block with Intelligence and Charisma 1 and no Animate Trees, under the treant's command and on its side, acting right after it (summons.ts). They stop after a day, at 0 Hit Points, when the treant dies or more than 120 feet from it. Which trees stand where is the GM's."
  ),
  // Moves, jumps, teleports and leaving the plane (granted-moves.ts, jumping.ts, off-plane.ts, time-stop.ts).
  "spell:misty-step": enforced(
    "granted-moves.ts gives the caster a 30-foot teleport for the turn, which movement-rules.ts takes at once to an unoccupied space it can see and refuses beyond its range."
  ),
  "spell:dimension-door": guided(
    "granted-moves.ts gives the caster a 500-foot teleport for the turn to any space, seen or not; arriving where a creature it didn't perceive stands fails and deals it 4d6 Force damage. Taking a willing creature along is the GM's."
  ),
  "spell:jump": enforced(
    "Each target can leap up to 30 feet for 10 feet of movement once on each of its turns for 1 minute (jumping.ts)."
  ),
  "spell:levitate": guided(
    "A failed save lifts the target 20 feet (falling.ts); while levitating it moves only as if climbing (altitude.ts), and it floats gently down when the spell ends. A willing target's save, and moving it up or down on the caster's turn, are the GM's, who sets its height."
  ),
  "spell:banishment": guided(
    "A failed save Incapacitates the target and takes it off the map while the caster concentrates (off-plane.ts); it can't be targeted, and it returns to the space it left or the nearest unoccupied one. An extraplanar creature that stays gone after the full minute is the GM's."
  ),
  "spell:etherealness": guided(
    "The caster leaves the map for the Border Ethereal until it ends the spell (off-plane.ts), out of reach of the creatures on the plane, and returns to the space it left or the nearest unoccupied one. Moving while ethereal, the Force damage of being shunted and the creatures an upcast takes along are the GM's."
  ),
  "spell:blink": guided(
    "The server rolls the d6 as the caster's turn ends; on a 4 or more the caster leaves the map until the start of its next turn (off-plane.ts) and returns to the space it left or the nearest unoccupied one. Picking another space within 10 feet is the GM's."
  ),
  "spell:maze": enforced(
    "The target leaves the map while the caster concentrates (off-plane.ts) and returns to the space it left or the nearest unoccupied one. It may take an action for a DC 20 Intelligence (Investigation) check, which ends the spell on a success (resolution/builtins.ts)."
  ),
  "spell:imprisonment": guided(
    "A failed save takes the target off the map until the GM ends the spell (off-plane.ts). The form of the prison, the 24 hours of immunity on a success and the ending trigger are the GM's."
  ),
  "spell:time-stop": guided(
    "time-stop.ts rolls 1d4 + 1 and gives the caster that many turns in a row; an action of its that targets another creature, or a move more than 1,000 feet from where it cast the spell, ends it. An effect it created that later reaches another creature is the GM's to end it on."
  ),
  "item:boots-of-striding-and-springing": guided(
    "Its wearer's Speed is at least 30 feet and armor's Strength requirement takes none of it (speed.ts), and the once-a-turn leap of 30 feet for 10 feet of movement is applied (jumping.ts). Carried weight is the GM's."
  ),
  "item:boots-of-levitation": guided(
    "The action levitates the wearer with no save for the spell's 10 minutes: it rises 20 feet, moves only as if climbing, and floats down when the levitation ends (falling.ts). Concentration on it is the wearer's to end sooner on the sheet."
  ),
  "item:wings-of-flying": enforced(
    "The action gives a Fly Speed of 60 feet for an hour, or until the wearer ends it on the sheet; a creature in the air when it ends falls (falling.ts). clock-pools.ts keeps the wings from being used again until 1d12 + 1 hours of game time have passed from their use (the hour they last, then the wait)."
  ),
  "item:broom-of-flying": guided(
    "The action gives the rider a Fly Speed of 50 feet with hover until it ends it on the sheet. The slower 30 feet while it carries over 200 pounds is the GM's."
  ),
  "item:cape-of-the-mountebank": guided(
    "The cast of Dimension Door, once a dawn, teleports the wearer on the map (granted-moves.ts). The smoke cloud is the GM's."
  ),
  "action:Giant Hyena/rampage-1-day": enforced(
    "It is offered only right after the hyena damages a creature that was already Bloodied (bloodied-hits.ts). Taken move first, the use is spent and a move of half its Speed granted (granted-moves.ts), and then it makes its Bite."
  ),
  "action:Gnoll Warrior/rampage-1-day": enforced(
    "It is offered only right after the gnoll damages a creature that was already Bloodied (bloodied-hits.ts). Taken move first, the use is spent and a move of half its Speed granted (granted-moves.ts), and then it makes its Rend."
  ),
  "action:Roc/swoop-recharge-5-6": guided(
    "The recharge is spent and a flight of half its Fly Speed granted that provokes no Opportunity Attacks (granted-moves.ts). Dropping the grappled creature is the GM's, who makes it fall (actor.fall)."
  ),
  "action:Tarrasque/onslaught": enforced(
    "Its Claw and its Tail are each a choice printed inside it: taken move first, the legendary use is spent and a move of half its Speed granted (granted-moves.ts), and then it makes that attack."
  ),
  "action:Tarrasque/world-shaking-movement": enforced(
    "Taken move first, the legendary use is spent and a move of its Speed granted (granted-moves.ts); then each creature in the 60-foot Emanation loses Concentration, and the Medium or smaller ones fall Prone (resolution/inflicts.ts)."
  ),
  "action:Lich/deathly-teleport": enforced(
    "The legendary use is spent and a 60-foot teleport granted (granted-moves.ts), and each creature in the 10-foot Emanation placed on the space it leaves takes 2d10 Necrotic damage."
  ),
  "action:Hydra/multiattack": enforced(
    "effective-actions.ts makes the Multiattack one Bite per living head, which death-traits.ts counts as heads die and grow back (Multiple Heads)."
  ),
  "action:Sea Hag/death-glare": enforced(
    "Only a Frightened creature the hag can see within 30 feet can be targeted (resolution/action-targets.ts). On a failed save one with 20 Hit Points or fewer drops to 0, and any other takes 3d8 Psychic damage (fatal-saves.ts)."
  ),
  "action:Solar/slaying-bow": enforced(
    "On a failed DC 21 Dexterity save a creature with 100 Hit Points or fewer dies outright, a character with no death saves, and Death Ward turns it aside; any other takes the Piercing and Radiant damage (fatal-saves.ts)."
  ),
  "action:Wraith/create-specter": enforced(
    "resolution/revival.ts takes a Humanoid corpse within 10 feet dead no longer than 1 minute, and refuses an eighth specter. Its spirit rises as a Specter under the wraith's command and on its side in the corpse's space, acting right after the wraith (summons.ts), and the corpse leaves the fight."
  ),
  "action:Behir/swallow": enforced(
    "A failed save swallows a creature the behir grapples (swallow.ts): the grapple ends, and the swallowed creature has the printed conditions and Total Cover from everything outside the behir (resolution/validate.ts), takes the acid as printed and moves with it. It holds one at a time. 30 damage from inside in one turn makes it save at DC 14 as that turn ends or let them all out Prone where they stand, and its death lets them climb out."
  ),
  "action:Kraken/swallow": enforced(
    "A failed save swallows a creature the kraken grapples (swallow.ts): the grapple ends, and the swallowed creature has the printed conditions and Total Cover from everything outside the kraken (resolution/validate.ts), takes the acid as printed and moves with it. It holds four at a time. A Huge or larger creature that fails takes the Piercing damage alone. 50 damage from inside in one turn makes it save at DC 25 as that turn ends or let them all out Prone where they stand, and its death lets them climb out."
  ),
  "action:Purple Worm/swallow": enforced(
    "A failed save swallows a creature the purple worm grapples (swallow.ts): the grapple ends, and the swallowed creature has the printed conditions and Total Cover from everything outside the purple worm (resolution/validate.ts), takes the acid as printed and moves with it. It holds three at a time. 30 damage from inside in one turn makes it save at DC 21 as that turn ends or let them all out Prone where they stand, and its death lets them climb out."
  ),
  "action:Remorhaz/swallow": enforced(
    "A failed save swallows a creature the remorhaz grapples (swallow.ts): the grapple ends, and the swallowed creature has the printed conditions and Total Cover from everything outside the remorhaz (resolution/validate.ts), takes the acid as printed and moves with it. It holds two at a time. 30 damage from inside in one turn makes it save at DC 15 as that turn ends or let them all out Prone where they stand, and its death lets them climb out."
  ),
  "action:Tarrasque/swallow": enforced(
    "A failed save swallows a creature the tarrasque grapples (swallow.ts): the grapple ends, and the swallowed creature has the printed conditions and Total Cover from everything outside the tarrasque (resolution/validate.ts), takes the acid as printed and moves with it. It holds six at a time. A swallowed creature can't teleport. 60 damage from inside in one turn makes it save at DC 20 as that turn ends or let them all out Prone where they stand, and its death lets them climb out."
  ),
  "action:Giant Toad/swallow": enforced(
    "The action swallows a Medium or smaller creature the toad grapples, with no save (swallow.ts): the grapple ends, it is Blinded and Restrained with Total Cover from outside the toad, takes 3d6 Acid as each of the toad's turns ends and moves with it. The toad holds one at a time, can't Bite meanwhile, and its death lets it climb out."
  ),
  "action:Giant Frog/swallow": enforced(
    "The action swallows a Small or smaller creature the frog grapples, with no save (swallow.ts): the grapple ends, it is Blinded and Restrained with Total Cover from outside the frog, and the frog can't Bite meanwhile. As the frog's next turn ends it takes 2d4 Acid and, alive, is disgorged Prone; the frog's death lets it climb out."
  ),
  "action:Shambling Mound/engulf": guided(
    "A failed save Grapples, Blinds and Restrains a Medium or smaller creature within 5 feet, with the Lightning at the start of its turns; the mound carries it at no extra cost (movement-rules.ts) and holds one at a time (swallow.ts). Moving its token into the mound's space is the GM's."
  ),
  "action:Roper/reel": enforced(
    "Each creature the roper grapples is pulled up to 30 feet straight toward it, stopping beside it (resolution/swallowing.ts, forced-movement.ts)."
  ),
  "action:Ettercap/reel": enforced(
    "Only a creature within 30 feet Restrained by the ettercap's own Web Strand is pulled, up to 25 feet straight toward it (resolution/action-targets.ts, forced-movement.ts)."
  ),
  "action:Gibbering Mouther/bite": enforced(
    "The hit's damage, and Prone on a Medium or smaller target, are applied. A creature it drops to 0 Hit Points dies outright with nothing left of its body (hit-points.ts)."
  ),
  "action:Mummy Lord/whirlwind-of-sand": guided(
    "The Reaction gives a 60-foot teleport (granted-moves.ts). The +2 AC against the triggering attack and the creatures it blinds are the GM's."
  ),
  "action:Balor/teleport": enforced(
    "A 60-foot teleport is granted to the balor, or to the one demon within 10 feet it names instead (resolution/movement-grants.ts, resolution/action-targets.ts). Whether that demon is willing is its player's or the GM's."
  ),
  "action:Phase Spider/ethereal-jaunt": guided(
    "The spider leaves the map for the Ethereal Plane, out of reach of the creatures on the plane, and the next Ethereal Jaunt brings it back to the space it left or the nearest unoccupied one (off-plane.ts). Moving while ethereal, to come back elsewhere, is the GM's."
  ),
  "action:Nightmare/ethereal-stride": guided(
    "The nightmare and up to three creatures within 5 feet leave the map for the Ethereal Plane, and the next Ethereal Stride brings them back to the spaces they left (off-plane.ts). Moving while ethereal, and whether a creature taken along is willing, are the GM's."
  ),
  "action:Dryad/tree-stride": guided(
    "A teleport of up to 65 feet is granted (granted-moves.ts). Whether a Large tree stands at each end is the GM's, since trees aren't on the map."
  ),
  "action:Centaur Trooper/trampling-charge-recharge-5-6": enforced(
    "Taken move first, it grants a move of its Speed that provokes no Opportunity Attacks and goes straight through the spaces of Medium or smaller creatures (granted-moves.ts, movement-rules.ts). The Strength save, damage and Prone then reach only the creatures whose spaces it entered (resolution/action-targets.ts)."
  ),
  "action:Gelatinous Cube/engulf": guided(
    "Taken move first, it grants a move of its Speed that provokes no Opportunity Attacks and goes straight through the spaces of Large or smaller creatures (movement-rules.ts); the save reaches only the creatures it entered. A failure Restrains the creature inside the cube, where it can't speak, holds its breath, has Total Cover from outside and moves with the cube (swallow.ts); the cube holds one Large or four smaller creatures, and the acid comes at the start of its turns. The Athletics escape and the pull from outside, with the puller's acid, are actions, and a creature that walks into the cube makes the save with Disadvantage (space-entry.ts). Moving a creature out of the cube on a success, or failing it when there is no room, is the GM's."
  ),
  "action:Weretiger/prowl-tiger-or-hybrid-form-only": guided(
    "It works only in the tiger and hybrid forms (transform/rules.ts), and a move of its Speed that provokes no Opportunity Attacks is granted (granted-moves.ts). The Hide at the end of it is the GM's."
  ),
  // Cantrips with nothing to roll: the cast is the server's, what it does is the table's.
  "spell:light": castOnly("The light and the object it shines from are the GM's."),
  "spell:mage-hand": enforced(
    "The hand appears as a token at a point within 30 feet (summons.ts); a Magic action moves it up to 30 feet (summon-orders.ts), and it vanishes more than 30 feet from the caster or when the spell is cast again. Aimed at a door on the map within 30 feet, it opens or shuts an unlocked one (resolution/cast-walls.ts), and a door held shut stays shut. What else it handles is the GM's."
  ),
  "spell:mending": castOnly("The repair is the GM's."),
  "spell:message": castOnly("The whisper and its reply are the table's."),
  "spell:prestidigitation": castOnly("Its minor tricks are the GM's."),
  "spell:shillelagh": enforced(
    "The cast binds to the Club or Quarterstaff the caster picks (resolution/grant-extras.ts): its attack and damage rolls use the better of Strength and the spellcasting ability, its die becomes a d8 (d10 at level 5, d12 at 11, 2d6 at 17), and a hit deals Force or its own type (item-actions.ts). Casting it again moves it, and it ends once the weapon leaves the pack (bound-weapons.ts)."
  ),
  "spell:thaumaturgy": enforced(
    "The cast keeps the wonder picked for a minute (resolution/grant-extras.ts), and Booming Voice gives Advantage on Intimidation checks (ability-checks.ts). Aimed at a door on the map within 30 feet, Invisible Hand flings an unlocked door open or slams it shut (resolution/cast-walls.ts). What the other wonders look and sound like is the GM's."
  ),
  "spell:true-strike": castOnly(
    "The weapon attack with the spellcasting ability, and its Radiant damage, are the GM's."
  ),
  "spell:spare-the-dying": enforced(
    "The cast makes a creature at 0 Hit Points Stable with no check (resolution/stabilize.ts), within 15 feet, 30 at level 5, 60 at level 11 and 120 at level 17 (resolution/spell-targets.ts)."
  ),
  "item:tinderbox": enforced(
    "item-light.ts lights a Candle, Lamp, Lantern or Torch in hand only when its bearer holds a Tinderbox or another flame, spending its Bonus Action in a fight. Lighting any other fire is the GM's."
  ),
  "item:healers-kit": enforced(
    "stabilize.ts spends one of the kit's ten uses to make a creature at 0 Hit Points Stable with no check, and spending the tenth takes the kit. The Gear tab shows the uses left in it."
  ),
  "item:chain": guided(
    "Its action binds a creature within 5 feet that is Grappled, Incapacitated or Restrained: the creature is Restrained until a DC 18 Dexterity (Acrobatics) check, its action, frees it. The DC 13 Strength (Athletics) check to bind it and bursting the Chain are the GM's."
  ),
  "item:rope": enforced(
    "Its action binds a creature within 5 feet that is Grappled, Incapacitated or Restrained: the creature is Restrained until a DC 15 Dexterity (Acrobatics) check, its action, frees it. Bursting the Rope is the GM's."
  ),
  "item:manacles": guided(
    "Its action binds a Small or Medium creature within 5 feet that is Grappled, Incapacitated or Restrained: it has Disadvantage on attack rolls until a DC 20 Dexterity (Sleight of Hand) check, its action, frees it. The DC 13 check to bind it, the Restrained condition while they are fixed in place, and bursting them are the GM's."
  ),
  "item:arcane-focus-staff": enforced(
    "It swings as a Quarterstaff: 1d6 Bludgeoning, Versatile (1d8), the Topple mastery."
  ),
  "item:druidic-focus-wooden-staff": enforced(
    "It swings as a Quarterstaff: 1d6 Bludgeoning, Versatile (1d8), the Topple mastery."
  ),
  ...Object.fromEntries(
    [
      "burglars-pack",
      "diplomats-pack",
      "dungeoneers-pack",
      "entertainers-pack",
      "explorers-pack",
      "priests-pack",
      "scholars-pack"
    ].map((id) => [
      `item:${id}`,
      enforced(
        "A character who comes by it at the build (character-build.ts) or on the sheet (inventory.ts) gets what it holds, each in its own stack."
      )
    ])
  ),
  ...Object.fromEntries(
    [
      "alchemists-supplies",
      "brewers-supplies",
      "calligraphers-supplies",
      "carpenters-tools",
      "cartographers-tools",
      "cobblers-tools",
      "cooks-utensils",
      "glassblowers-tools",
      "jewelers-tools",
      "leatherworkers-tools",
      "masons-tools",
      "painters-supplies",
      "potters-tools",
      "smiths-tools",
      "tinkers-tools",
      "weavers-tools",
      "woodcarvers-tools",
      "disguise-kit",
      "forgery-kit",
      "herbalism-kit",
      "navigators-tools",
      "poisoners-kit",
      "thieves-tools",
      "gaming-set-dice",
      "gaming-set-playing-cards",
      "gaming-set-dragonchess",
      "gaming-set-three-dragon-ante",
      "instrument-bagpipes",
      "instrument-drum",
      "instrument-dulcimer",
      "instrument-flute",
      "instrument-horn",
      "instrument-lute",
      "instrument-lyre",
      "instrument-pan-flute",
      "instrument-shawm",
      "instrument-viol"
    ].map((id) => [`item:${id}`, toolUse])
  ),
  "item:rations": enforced(
    "survival.ts, while the GM tracks food and water: a character eats a Ration from its inventory on its own (actor.nourish) or as the game day ends, a pound of food each, as far as its need goes."
  ),
  "item:waterskin": enforced(
    "survival.ts, while the GM tracks food and water: a character drinks from its Waterskin (actor.nourish) or as the game day ends, as far as its need goes; each holds 4 pints, and the GM fills it at a source."
  ),
  "item:perfume": enforced(
    "Applying it, in a fight or out of one, uses up the vial and gives its bearer the Perfume effect for an hour. ability-checks.ts then gives Advantage on a Persuasion check against an Indifferent Humanoid within 5 feet on the map, in Influence or a check the GM calls naming it."
  ),
  "item:bedroll": reference(
    "Its help against extreme cold and the Long Rest in light armor come from rules outside the SRD, so nothing applies them."
  ),
  "item:blanket": reference("Its help against extreme cold comes from rules outside the SRD, so nothing applies it."),
  "item:book": enforced(
    'While it is equipped, the sheet offers "consulting an accurate Book about its topic" beside the checks (check-situations.ts), and an Intelligence (Arcana, History, Nature or Religion) check that names it gains +5 (ability-checks.ts). Whether the Book is accurate and on topic is the GM\'s.'
  ),
  "item:map": enforced(
    'While it is equipped, the sheet offers "finding the way in the place an accurate Map shows" beside the checks (check-situations.ts), and a Wisdom (Survival) check that names it gains +5 (ability-checks.ts).'
  ),
  "item:costume": enforced(
    'While it is worn (equipped), the sheet offers "impersonating whom the Costume represents" beside the checks (check-situations.ts), and a check that names it has Advantage (ability-checks.ts).'
  ),
  "item:crowbar": enforced(
    'While it is equipped, the sheet offers "prying with the Crowbar" beside the checks (check-situations.ts), and a Strength check that names it has Advantage (ability-checks.ts). Whether the Crowbar can pry there is the GM\'s.'
  ),
  "item:magnifying-glass": enforced(
    'While it is equipped, the sheet offers "appraising or inspecting a highly detailed item" beside the checks (check-situations.ts), and a check that names it has Advantage (ability-checks.ts). Lighting a fire with it is the GM\'s.'
  ),
  "item:pole": enforced(
    'While it is equipped, the sheet offers "vaulting with the Pole on a High or Long Jump" beside the checks (check-situations.ts), and a Strength (Athletics) check that names it has Advantage (ability-checks.ts). Touching something 10 feet away is the GM\'s.'
  ),
  "feature:spellcasting": enforced(
    "character-build.ts gives the class its slots, cantrips and prepared spells, and each spell is a cast action at the class's spell save DC and attack bonus. resolution/economy.ts spends the slot, and rests.ts restores slots on a Long Rest. level-up-picks.ts lets a player's level up replace only the cantrips and spells the class's level allows."
  ),
  "feature:divine-intervention": enforced(
    "divine-intervention.ts gives the Cleric a cast of every Cleric spell of level 5 or lower that isn't cast with a Reaction, at the Cleric's numbers, and the sheet lists them under the feature's row to pick. The cast goes through the cast pipeline at once, whatever its casting time, with no spell slot and no Material components, and spends the feature's one use until a Long Rest."
  ),
  "feature:greater-divine-intervention": enforced(
    "Wish joins Divine Intervention's casts (divine-intervention.ts). Cast that way, the server rolls 2d4 and Divine Intervention stays spent through that many Long Rests (rests.ts). What the Wish does is as the spell's own row says."
  ),
  "feature:pact-magic": enforced(
    "character-build.ts gives the Warlock its Pact Magic slots at the level its table prints, and resolution/economy.ts spends them. rests.ts restores them on a Short or Long Rest."
  ),
  "feature:evasion": enforced(
    "saving-throws.ts takes no damage on a successful Dexterity save for half damage and half on a failure, while the creature isn't Incapacitated."
  ),
  "feature:cunning-action": enforced(
    "builtin-actions.ts offers Dash, Disengage and Hide as Bonus Actions, and each resolves as its action does."
  ),
  "feature:martial-arts": enforced(
    "builtin-actions.ts offers an Unarmed Strike as a Bonus Action, and resolution/attack.ts rolls Unarmed Strikes and Monk weapons with the Martial Arts die and the better of Strength and Dexterity."
  ),
  "feature:aura-of-protection": enforced(
    "saving-throws.ts adds the Paladin's Charisma modifier, at least 1, to its own saves and its allies' within 10 feet, while it isn't Incapacitated. A creature in two auras gets the better one."
  ),
  "feature:aura-expansion": enforced("saving-throws.ts widens Aura of Protection to 30 feet."),
  "feature:jack-of-all-trades": enforced(
    "ability-checks.ts adds half the Proficiency Bonus, rounded down, to a skill check the Bard isn't proficient in."
  ),
  "feature:reliable-talent": enforced(
    "ability-checks.ts treats a d20 of 9 or lower as a 10 on a check with a skill or tool the Rogue is proficient in."
  ),
  "feature:heroic-warrior": enforced(
    "turn-boundaries.ts gives the Champion Heroic Inspiration at the start of its turn in a fight when it has none."
  ),
  "feature:human-resourceful": enforced("rests.ts gives a Human Heroic Inspiration when it finishes a Long Rest."),
  "feature:persistent-rage": enforced(
    "When the Barbarian rolls Initiative, initiative-hooks.ts opens its window and the Persistent Rage action restores every expended use of Rage, once per Long Rest (resolution/rage.ts). A Rage under it lasts 10 minutes, and only Unconscious ends it early (effects.ts)."
  ),
  "feature:action-surge": enforced(
    "resolution/economy.ts gives one more action on the Fighter's own turn, once a turn, and refuses it for the Magic action."
  ),
  "feature:heightened-focus": guided(
    "Flurry of Blows makes three strikes from Monk level 10 (Monk's Focus carries it). The Temporary Hit Points from Patient Defense and the creature carried by Step of the Wind are the GM's."
  ),
  "feature:two-weapon-fighting": enforced(
    "equipment-derivation.ts adds the ability modifier to the damage of the Light property's extra attack."
  ),
  "feature:dragonborn-breath-weapon": enforced(
    "The ancestry's own Breath Weapon row carries the save, the area and the damage, and resolution/economy.ts takes it in place of an attack."
  ),
  "feature:dragonborn-damage-resistance": enforced(
    "The ancestry's own Damage Resistance row grants the Resistance, which hit-points.ts applies."
  ),

  // Features and feats whose riders or picks apply part of what they do, and leave a part to the table.
  "feature:abjure-foes": guided(
    "The Wisdom save against the Paladin's spell save DC, its Frightened and the Channel Divinity use are applied, on up to the Charisma modifier's number of creatures it can see within 60 feet (resolution/action-targets.ts). resolution/economy.ts holds the frightened creature to one of an action or a Bonus Action on its turn, and movement-rules.ts its move after acting."
  ),
  "feature:aura-of-courage": enforced(
    "paladin-auras.ts makes the Paladin and its allies in its Aura of Protection immune to Frightened while it isn't Incapacitated, and an ally already Frightened has no Disadvantage from it there (resolution/attack.ts, check-rolls.ts)."
  ),
  "feature:aura-of-devotion": enforced(
    "paladin-auras.ts makes the Paladin and its allies in its Aura of Protection immune to Charmed while it isn't Incapacitated, and an ally already Charmed may target its charmer while there (resolution/economy.ts)."
  ),
  "feature:holy-nimbus": enforced(
    "The Bonus Action puts Holy Nimbus on the Paladin for 10 minutes. turn-boundaries.ts deals its Radiant damage to an enemy that starts its turn in the aura, and saving-throws.ts gives the Paladin Advantage on saves a Fiend or an Undead forces. Its 30 feet of sunlight is carried with the Paladin's token (vision/senses.ts), which Sunlight Sensitivity reads. conversions.ts restores the use with a level 5 slot."
  ),
  "feature:smite-of-protection": enforced(
    "resolution/hit-options.ts marks the Paladin when Divine Smite rides a hit, and until its next turn the creatures in its aura have Half Cover against attacks and on Dexterity saves (resolution/validate.ts, resolution/pending.ts)."
  ),
  "feature:orc-relentless-endurance": enforced(
    "hit-points.ts holds an Orc reduced to 0 Hit Points, but not killed outright, at 1 Hit Point instead, once a Long Rest. It is taken the first time it can be."
  ),
  "feature:goliath-large-form": enforced(
    "The Bonus Action makes the Goliath Large for 10 minutes, with +10 feet of Speed and Advantage on Strength checks, and its token takes the bigger space (transform/forms.ts). resolution/grant.ts refuses it while a creature stands in that space."
  ),
  "feature:goliath-powerful-build": enforced(
    "The escape from a grapple rolls with Advantage (resolution/builtins.ts), and carrying.ts counts the character one size larger for its carrying capacity."
  ),
  "feature:goliath-giant-ancestry": enforced(
    "Fire's Burn, Frost's Chill and Hill's Tumble ride a hit that deals damage (resolution/hit-options.ts), Storm's Thunder is offered as a Reaction, and Stone's Endurance as a Reaction to damage from a hit or a failed save, taking 1d12 plus the Constitution modifier off it before it lands (damage-window.ts). Cloud's Jaunt gives a 30-foot teleport taken on the map at once to an unoccupied space the Goliath can see (granted-moves.ts)."
  ),

  // Answers to a roll after it is seen (roll-answers.ts), and reactions to damage about to land (damage-window.ts).
  "feature:bardic-inspiration": guided(
    "The Bonus Action gives another creature the Bard's die, a d6 growing to a d12, one die at a time, and roll-answers.ts offers it when that creature fails an attack roll, a save, a check or a death save: the die is added and spent. A creature beyond 60 feet is refused, and an unused die ends after an hour. Whether the creature can see or hear the Bard is the GM's."
  ),
  "feature:cutting-words": enforced(
    "roll-answers.ts asks the Bard by a reaction prompt when a creature it can see within 60 feet hits with an attack roll, succeeds on a check or rolls damage. Using it spends a Bardic Inspiration use and the Reaction and takes the die off the roll, which can turn the hit into a miss or lower the damage before it lands (damage-window.ts)."
  ),
  "feature:peerless-skill": enforced(
    "roll-answers.ts offers it on the Bard's failed attack roll or check: the Bardic Inspiration die is added, and the use is kept when the roll still fails."
  ),
  "feature:countercharm": enforced(
    "roll-answers.ts asks the Bard by a reaction prompt when it or a creature within 30 feet fails a save against an effect that would make it Charmed or Frightened. The save waits, and using the Reaction rerolls it with Advantage."
  ),
  "feature:indomitable": enforced(
    "roll-answers.ts offers it on the Fighter's failed save: the save is rerolled with the Fighter level added, and the new roll stands."
  ),
  "feature:tactical-mind": enforced(
    "roll-answers.ts offers it on the Fighter's failed check: a Second Wind use adds 1d10 to the check, and the use is kept when the check still fails."
  ),
  "feature:stroke-of-luck": enforced(
    "roll-answers.ts offers it on the Rogue's failed D20 Test: the d20 becomes a 20, which makes an attack roll a Critical Hit, and the use returns on a Short or Long Rest."
  ),
  "feature:dark-ones-own-luck": enforced(
    "roll-answers.ts offers it on the Warlock's check or save once the roll is seen: 1d10 is added, and a use is spent."
  ),
  "feature:halfling-luck": enforced(
    "roll-answers.ts offers a reroll when the d20 of the Halfling's attack roll, check, save or death save shows a 1, and the new roll stands."
  ),
  "feature:deflect-attacks": guided(
    "A hit whose damage includes Bludgeoning, Piercing or Slashing opens a reaction prompt (damage-window.ts), and using it takes 1d10 plus the Dexterity modifier and Monk level off the damage before it lands. Redirecting the attack's force for a Focus Point after reducing it to 0 is the GM's."
  ),
  "feature:deflect-energy": enforced(
    "character-build.ts lets Deflect Attacks meet a hit of any damage type from Monk level 13 (damage-window.ts)."
  ),
  "feature:superior-hunters-defense": enforced(
    "damage-window.ts offers it when the Ranger is about to take damage from a hit or a failed save. Using it gives Resistance to the damage's largest type, that damage included, until the end of the current turn."
  ),
  "action:Stone Giant/deflect-missile": guided(
    "A ranged hit with Bludgeoning, Piercing or Slashing damage opens the giant's reaction prompt (damage-window.ts), and using it takes 1d10 + 6 off the damage, recharging on a 5 or 6. Redirecting the force at another creature when the damage reaches 0 is the GM's."
  ),
  "action:Rust Monster/reflexive-antennae": guided(
    "damage-reactions.ts offers it when a creature within 5 feet damages the rust monster, and using it resolves Antennae against that creature, opening its Dexterity save. It is offered on any damage, not only a hit's, so the GM declines it for a spell."
  ),
  "action:Sphinx of Wonder/burst-of-ingenuity": enforced(
    "roll-answers.ts offers it on the sphinx's own check or save and asks it by a prompt about another creature's within 30 feet. Using it adds 2 to the roll, twice a day."
  ),
  "feature:savage-attacker": enforced(
    "resolution/hit-options.ts offers it on a weapon hit once a turn. Chosen, resolution/damage.ts rolls the weapon's damage dice twice and uses the higher roll, the one an attacker always picks of the two."
  ),
  "feature:divine-order": enforced(
    "Protector's training and Thaumaturge's extra cantrip are applied, and Thaumaturge adds the Wisdom modifier, at least +1, to Arcana and Religion checks (ability-checks.ts)."
  ),
  "feature:eldritch-invocations": guided(
    "Agonizing Blast's damage, Eldritch Spear's range on a spell attack, Repelling Blast's push (resolution/masteries.ts), Eldritch Mind's Advantage and the free casts are applied, and level-up-picks.ts lets a level up replace one invocation. Eldritch Smite's Pact Magic slot dice and Prone, and Lifedrinker's damage and Hit Point Die, ride a pact weapon's hit (resolution/hit-options.ts). Devil's Sight and Witch Sight are senses dynamic vision reads (vision/senses.ts), and One with Shadows' Invisibility is refused in Bright Light (resolution/validate.ts). Pact of the Chain casts Find Familiar as a Magic action and adds its special forms (character-build.ts, summons.ts); forgoing an attack so the familiar attacks with its Reaction is the GM's. Lessons of the First Ones, Gaze of Two Minds, Gift of the Protectors and Investment of the Chain Master are the GM's."
  ),
  "feature:elemental-fury": enforced(
    "Primal Strike's extra damage, of the type the Druid picks, rides a weapon attack or a Beast form's attack in Wild Shape once a turn (resolution/hit-riders.ts). Potent Spellcasting adds the Druid's Wisdom modifier to the damage of Poison Spray, Produce Flame and Starry Wisp."
  ),
  "feature:wild-shape": enforced(
    "The Druid picks its known forms on the sheet, as many as its level allows and within its Challenge Rating and Fly Speed limits, and replaces one after a Long Rest (transform/known-forms.ts). The Bonus Action takes one for hours equal to half its Druid level: the Beast's statistics with the Druid's Hit Points, mind, type, class features (their defences included), feats and proficiencies (the higher printed modifiers used), Temporary Hit Points equal to its Druid level, no spells, Concentration kept and gear melded or worn as it picks (transform/compose.ts). It ends as a Bonus Action, on another use, on the Incapacitated condition or at 0 Hit Points (transform/rules.ts)."
  ),
  "feature:beast-spells": enforced(
    "transform/rules.ts lets a Druid 18 cast spells in a Wild Shape form, except one whose Material component has a cost or is consumed."
  ),
  "feature:lands-aid": guided(
    "The save and its Necrotic damage against the Druid's spell save DC are applied, and a use of Wild Shape is spent. Healing the creature it picks is the GM's."
  ),
  "feature:mindless-rage": enforced(
    "Immunity to Charmed and Frightened while raging is applied (equipment-derivation.ts), and either condition ends as the Rage starts (resolution/grant.ts)."
  ),
  "feature:primal-knowledge": enforced(
    "The extra skill is applied. While raging, Acrobatics, Intimidation, Perception, Stealth and Survival checks are made as Strength checks when that is the better roll (ability-checks.ts)."
  ),
  "feature:primal-order": enforced(
    "Magician's extra cantrip and its Wisdom modifier, at least +1, on Arcana and Nature checks (ability-checks.ts), and Warden's training, are applied."
  ),
  "feature:stunning-strike": enforced(
    "It rides a hit with a Monk weapon or an Unarmed Strike (resolution/hit-options.ts), never tapped alone: a target that fails its Constitution save against the Monk's DC is Stunned until the start of the Monk's next turn, once a turn for a Focus Point. On a success resolution/pending.ts halves its Speed until then (speed.ts), and the next attack roll against it before then has Advantage and spends it (resolution/attack.ts)."
  ),
  "feature:brutal-strike": enforced(
    "After Reckless Attack, the tap forgoes the Advantage of the Barbarian's next Strength attack this turn (resolution/attack.ts), and its hit carries 1d10 of the weapon's type and one effect (resolution/hit-options.ts): Forceful Blow's 15-foot push and a move of half its Speed that must end nearer the target and provokes no Opportunity Attacks (granted-moves.ts), or Hamstring Blow's 15 feet less Speed, one at a time on a creature."
  ),
  "feature:improved-brutal-strike": enforced(
    "Staggering Blow (Disadvantage on the next save and no Opportunity Attacks) and Sundering Blow (+5 to the next attack roll another creature makes against the target) join Brutal Strike's effects, and from Barbarian 17 a hit carries 2d10 and two effects (resolution/hit-options.ts, resolution/attack.ts)."
  ),
  "feature:open-hand-technique": enforced(
    "A Flurry of Blows hit carries Addle, Push or Topple (resolution/hit-options.ts): no Opportunity Attacks until the target's next turn, a Strength save against a 15-foot push, or a Dexterity save against Prone."
  ),
  "feature:quivering-palm": enforced(
    "An Unarmed Strike's hit can spend 4 Focus Points to set the vibrations on its target, one creature at a time (resolution/hit-rider-outcomes.ts). The ending action targets only that creature: a Constitution save for 10d12 Force, half on a success. The days they last are the GM's."
  ),
  "feature:cunning-strike": enforced(
    "Sneak Attack's hit can trade dice for Poison (with a Poisoner's Kit), Trip or Withdraw, with saves against 8 + Dexterity + Proficiency Bonus (resolution/hit-options.ts). Withdraw's move of half the Rogue's Speed provokes no Opportunity Attacks (granted-moves.ts)."
  ),
  "feature:improved-cunning-strike": enforced(
    "A Sneak Attack hit carries two Cunning Strike effects (resolution/hit-options.ts)."
  ),
  "feature:devious-strikes": enforced(
    "Daze (one of moving, an action or a Bonus Action, resolution/economy.ts), Knock Out (Unconscious that ends on damage, with repeat saves) and Obscure (Blinded) join Cunning Strike's effects. A Dazed creature's move after acting is the GM's."
  ),
  "feature:supreme-sneak": guided(
    "Stealth Attack joins Cunning Strike's effects, and the attack leaves the Rogue's Invisible from the Hide action on (resolution/release.ts). Whether it ends the turn behind Three-Quarters or Total Cover is the GM's, said with the hit."
  ),
  "feature:hurl-through-hell": guided(
    "It rides an attack roll's hit once a Long Rest: the Charisma save, 8d10 Psychic unless the target is a Fiend, and Incapacitated off the map with nothing able to target it until the end of the Warlock's next turn, when it returns to the space it left or the nearest unoccupied one (off-plane.ts). conversions.ts restores the use with a Pact Magic slot."
  ),
  "feature:lay-on-hands": enforced(
    "The Bonus Action spends the points the Paladin picks to heal one creature it touches, within 5 feet (resolution/action-targets.ts), or 5 points to end Poisoned."
  ),
  "feature:superior-hunters-prey": guided(
    "The tap deals the mark's 1d6 Force (1d10 from Foe Slayer) to one other creature the Ranger can see, once a turn. That the marked creature took the Ranger's damage this turn, and the 30 feet from it, are the GM's."
  ),
  "feature:words-of-creation": enforced(
    "Power Word Heal and Power Word Kill are always prepared, and either may take a second creature within 10 feet of the first (resolution/action-targets.ts)."
  ),
  "feature:use-magic-device": enforced(
    "The fourth attuned item is applied (inventory.ts), and resolution/charges.ts rolls the d6 when an item's charges are spent, giving them back on a 6. Reading any Spell Scroll is the GM's."
  ),
  "feature:grappler": guided(
    "The ability score increase is applied, and attack rolls against a creature it grapples have Advantage (resolution/attack.ts). Punch and Grab and Fast Wrestler are the GM's."
  ),
  "feature:boon-of-combat-prowess": enforced(
    "The ability score increase is applied, and roll-answers.ts offers Peerless Aim on a missed attack roll: the attack hits, and the boon waits for the start of the creature's next turn."
  ),
  "feature:boon-of-dimensional-travel": enforced(
    "The ability score increase is applied, and once each Attack or Magic action is taken (after its last attack or ray) resolution/movement-grants.ts gives a 30-foot teleport for the turn, which movement-rules.ts takes at once to an unoccupied space the creature can see."
  ),
  "feature:tactical-shift": enforced(
    "Second Wind gives the Fighter a move of half its Speed for the turn that provokes no Opportunity Attacks (resolution/movement-grants.ts), charged to its own grant (movement-rules.ts)."
  ),
  "feature:instinctive-pounce": enforced(
    "The Bonus Action that starts a Rage gives the Barbarian a move of half its Speed for the turn (resolution/movement-grants.ts), charged to its own grant (movement-rules.ts)."
  ),
  "feature:boon-of-fate": enforced(
    "The ability score increase is applied. roll-answers.ts offers Improve Fate on the holder's own D20 Test, and asks by a prompt about another creature's within 60 feet: 2d4 is added or taken off, and the use returns when Initiative is rolled or on a rest."
  ),
  "feature:boon-of-irresistible-offense": guided(
    "The ability score increase is applied, and its Bludgeoning, Piercing and Slashing damage ignores Resistance (hit-points.ts). The extra damage on a 20 is the GM's."
  ),
  "feature:boon-of-spell-recall": enforced(
    "The ability score increase is applied, and resolution/spell-recall.ts rolls a d4 for a spell cast with a level 1 to 4 slot, keeping the slot when it matches the level."
  ),
  "feature:boon-of-the-night-spirit": enforced(
    "The ability score increase is applied. With dynamic vision on, Merge with Shadows makes the creature Invisible as a Bonus Action only in Dim Light or Darkness (resolution/validate.ts), until it next takes an action, a Bonus Action or a Reaction (resolution/release.ts), and hit-points.ts gives it Resistance to all damage but Psychic and Radiant there."
  ),
  "feature:boon-of-truesight": enforced(
    "The ability score increase is applied, and Truesight 60 feet is a sense dynamic vision and attack rolls read (vision/senses.ts)."
  ),
  "feature:halfling-naturally-stealthy": enforced(
    "With dynamic vision on, resolution/validate.ts lets a Halfling Hide behind a creature at least one size larger than it (vision/rules.ts)."
  ),

  // Manuals and tomes: the GM marks the 48 hours of study done, and the score rises for good.
  "item:manual-of-bodily-health": studied("Constitution"),
  "item:manual-of-gainful-exercise": studied("Strength"),
  "item:manual-of-quickness-of-action": studied("Dexterity"),
  "item:tome-of-clear-thought": studied("Intelligence"),
  "item:tome-of-leadership-and-influence": studied("Charisma"),
  "item:tome-of-understanding": studied("Wisdom"),

  // Features that shape a spell as it is cast (resolution/metamagic.ts), checked and paid for by the economy.
  "feature:metamagic": enforced(
    "A cast carries one Metamagic option the Sorcerer knows, paid in Sorcery Points and applied by the server (resolution/metamagic.ts, resolution/economy.ts). Seeking Spell is offered when a spell attack misses (roll-answers.ts), and Empowered Spell on a look at the spell's damage, where the Sorcerer picks up to the Charisma modifier of the spell's dice to reroll and the confirm deals them (resolution/held-damage.ts). The server refuses an option the spell can't take. Careful Spell covers the save the cast itself calls for (resolution/pending.ts)."
  ),
  "feature:sculpt-spells": enforced(
    "An Evoker's Evocation spell protects up to 1 plus the spell's level creatures the Wizard can see: they succeed on its save with no roll and take no damage (resolution/pending.ts). Saves its area calls for later are rolled as usual."
  ),
  "feature:sorcery-incarnate": enforced(
    "While Innate Sorcery is active, a cast may carry two Metamagic options (resolution/metamagic.ts), and with no use of Innate Sorcery left conversions.ts spends 2 Sorcery Points for one."
  ),
  "feature:arcane-apotheosis": enforced(
    "While Innate Sorcery is active, the first Metamagic option on each of the Sorcerer's turns in a fight costs no Sorcery Points (resolution/metamagic.ts)."
  ),

  // Magic items whose riders apply part of what they do, and leave a property the table would expect applied.
  "item:armor-of-invulnerability": guided(
    "Resistance to Bludgeoning, Piercing and Slashing damage is applied. The once-a-day Immunity to them is the GM's."
  ),
  "item:berserker-axe": guided(
    "The +1 to attack and damage rolls and the curse's lock on Attunement are applied. berserker-axe.ts asks the DC 15 Wisdom save when another creature damages the bearer, and ends the berserk on a turn that starts with no creature within 60 feet. Its attacks on the nearest creature, and the extra Hit Points, are the GM's."
  ),
  "item:bracers-of-archery": enforced(
    "Proficiency with the Longbow and Shortbow, and +2 to damage rolls made with either (a magic one bound to it included), are applied (riders.ts)."
  ),
  "item:brooch-of-shielding": guided("Resistance to Force damage is applied. Immunity to Magic Missile is the GM's."),
  "item:cloak-of-arachnida": enforced(
    "Resistance to Poison damage and a Climb Speed equal to its wearer's Speed are applied. The webs of a Web spell can't hold the wearer (spell-zones.ts), and its Web cast is DC 13 over a 40-foot Cube once a Long Rest. Climbing upside down on ceilings is the GM's to allow."
  ),
  "item:caltrops": enforced(
    "Spreading them from the pack places a 5-foot square that rolls nothing as it lands (resolution/concentration.ts). spell-zones.ts asks a creature that enters it for the DC 15 Dexterity save, once a turn: 1 Piercing damage and a Speed of 0 until the start of its next turn on a failure. A move that enters it waits there on the save, and a failure ends the move (zone-stops.ts, held-moves.ts). The square stays until the GM ends it, which is gathering them up."
  ),
  "item:ball-bearings": enforced(
    "Spilling them from the pack places a 10-foot square that rolls nothing as it lands (resolution/concentration.ts). spell-zones.ts asks a creature that enters it for the DC 10 Dexterity save, once a turn, and a failure leaves it Prone. A move that enters it waits there on the save, and a failure ends the move (zone-stops.ts, held-moves.ts). The square stays until the GM ends it, which is gathering them up."
  ),
  "item:hunting-trap": guided(
    "Setting it places a 5-foot square (resolution/concentration.ts). The first creature that enters it makes the DC 13 Dexterity save, with 1d4 Piercing damage and a Speed of 0 until the start of its next turn on a failure, and the trap springs and leaves the map (spell-zones.ts). A move that enters it waits there on the save, and a failure ends the move (zone-stops.ts, held-moves.ts). The chain that holds the creature after that, and the Strength (Athletics) check to break free, are the GM's."
  ),
  "item:cloak-of-the-bat": guided(
    "Advantage on Dexterity (Stealth) checks is applied. The Fly Speed in darkness and the Polymorph cast are the GM's."
  ),
  "item:dagger-of-venom": enforced(
    "The +1 to attack and damage rolls is applied. Coating the blade is a Bonus Action once a day, and the dagger's next hit spends it on a DC 15 Constitution save against 2d10 Poison and Poisoned for 1 minute (resolution/on-hit.ts)."
  ),
  "item:defender": guided(
    "The +3 to attack and damage rolls is applied, and its wielder moves 1, 2 or 3 of it to AC as a form on the sheet (inventory.ts setItemForm). Picking it with the first attack of a turn, and holding it to the next, are the wielder's."
  ),
  "item:demon-armor": guided(
    "The +1 AC and the curse's lock on Attunement are applied. The clawed Unarmed Strikes and the Disadvantage against demons are the GM's."
  ),
  "item:dragon-scale-mail": guided(
    "The +1 AC and the Resistance to the type the GM picks are applied, with Advantage on a save a Dragon forces (riders.ts), its breath's and any other. Sensing dragons is the GM's."
  ),
  "item:dwarven-plate": guided("The +2 AC is applied. The Reaction against forced movement is the GM's."),
  "item:dwarven-thrower": enforced(
    "The +3 to attack and damage rolls is applied, it is thrown 20/60 (inventory.ts weapon changes), and a ranged hit deals 1d8 Force more, 2d8 against a Giant. Only a Dwarf or a creature attuned to a Belt of Dwarvenkind attunes to it (attunement.ts); it flies back to its thrower's hand."
  ),
  "item:giant-slayer": enforced(
    "The +1 to attack and damage rolls and the extra 2d6 against Giants are applied, and a hit on a Giant opens its DC 15 Strength save against Prone (resolution/on-hit.ts)."
  ),
  "item:hammer-of-thunderbolts": guided(
    "The +1 to attack and damage rolls is applied. Its thrown thunderclap and its powers against Giants are the GM's."
  ),
  "item:helm-of-telepathy": guided(
    "Its Detect Thoughts and Suggestion casts are cast actions. The telepathy itself is the GM's."
  ),
  "item:holy-avenger": enforced(
    "The +3 to attack and damage rolls and the extra 2d10 Radiant against Fiends and Undead are applied, and its 10-foot Emanation (30 feet for a level 17 Paladin) gives its wielder and its allies Advantage on saves against magic (saving-throws.ts magicSaveAuraClaims). Only a Paladin attunes to it (attunement.ts)."
  ),
  "item:iron-bands": guided(
    "The throw's attack roll is applied. Restraining the target on a hit, and the check to break free, are the GM's."
  ),
  "item:iron-flask": guided("The command's save is applied. Trapping the creature in the flask is the GM's."),
  "item:luck-blade": guided(
    "The +1 to attack and damage rolls and saving throws is applied, and roll-answers.ts offers its Luck reroll on a failed D20 Test once a day while the wielder isn't Incapacitated. Its Wish casts on 1d3 charges rolled when it is added, which never come back; its once a day limit, and what a Wish does, are the GM's."
  ),
  "item:gloves-of-missile-snaring": enforced(
    "A hit by a weapon from range opens a reaction prompt (damage-window.ts), and using it takes 1d10 plus the wearer's Dexterity modifier off the damage. Whether a hand is free, and catching the missile, are the GM's."
  ),
  "item:mace-of-disruption": enforced(
    "The extra 2d6 Radiant against Fiends and Undead and the weapon's light are applied. A Fiend or an Undead the hit leaves at 25 Hit Points or fewer makes the DC 15 Wisdom save (resolution/kill.ts): a failure destroys it, and a success leaves it Frightened until the end of the wielder's next turn."
  ),
  "item:mace-of-smiting": enforced(
    "The +1 to attack and damage rolls, +3 against Constructs, and the 7 Bludgeoning on a rolled 20 (14 against a Construct) are applied. A Construct that rolled 20 leaves at 25 Hit Points or fewer is destroyed (resolution/kill.ts)."
  ),
  "item:nine-lives-stealer": guided(
    "The +2 to attack and damage rolls is applied. On a rolled 20 against a creature with fewer than 100 Hit Points, other than a Construct or an Undead, the target makes the DC 15 Constitution save, and a failure slays it (resolution/kill.ts). The 1d8 + 1 charges, one spent per slaying, are the GM's to count."
  ),
  "item:pipes-of-haunting": guided(
    "The save against Frightened, with its repeat at the end of each turn, is applied. The immunity after a success is the GM's."
  ),
  "item:quarterstaff-of-the-acrobat": enforced(
    "The +2 to attack and damage rolls and Advantage on Dexterity (Acrobatics) checks are applied, it is thrown 30/120, and Attack Deflection is offered once a rest when a hit would land (resolution/pending.ts). A Bonus Action makes it a rod or a pole (inventory.ts setItemForm), where it neither swings nor deflects."
  ),
  "item:ring-of-shooting-stars": guided(
    "Its at-will cantrips and the one-charge Shooting Stars are applied. Faerie Fire, the Lightning Spheres and the larger Shooting Stars are the GM's."
  ),
  "item:robe-of-scintillating-colors": guided(
    "The save against Stunned is applied. The light, the Disadvantage on attacks against the wearer and ending the stun are the GM's."
  ),
  "item:robe-of-stars": guided(
    "The +1 to saving throws is applied, and its six stars each cast a level 5 Magic Missile, 1d6 coming back at dusk or a Long Rest. The trip to the Astral Plane is the GM's."
  ),
  "item:rod-of-alertness": guided(
    "Advantage on Initiative and Wisdom (Perception) checks, and its detection casts, are applied. The Protective Aura's benefit to allies is the GM's."
  ),
  "item:rope-of-entanglement": guided(
    "The save against Restrained is applied, and the rope that holds the target is an object with AC 20 and 20 Hit Points that an attack can break, which frees it (objects.ts). The check to escape the rope, its release and its regrowth are the GM's."
  ),
  "item:scarab-of-protection": enforced(
    "The +1 AC and Advantage on saves against spells are applied, and Preservation turns a failed save against a Necromancy spell or an Undead into a success for a Reaction and one of its 12 charges, which never come back; the last crumbles it (roll-answers.ts, resolution/charges.ts)."
  ),
  "item:scimitar-of-speed": enforced(
    "The +2 to attack and damage rolls is applied, and it offers an attack as a Bonus Action beside its own (equipment-derivation.ts)."
  ),
  "item:spellguard-shield": enforced(
    "Spell attack rolls against its holder have Disadvantage (resolution/attack.ts), and its holder has Advantage on saves against spells and other magical effects (riders.ts)."
  ),
  "item:staff-of-charming": guided(
    "Its one-charge casts are cast actions, and roll-answers.ts offers to turn a failed save against an Enchantment spell aimed only at the holder into a success once a day. Turning the spell back on its caster is the GM's."
  ),
  "item:staff-of-fire": enforced(
    "Resistance to Fire damage is applied, and Burning Hands, Fireball and Wall of Fire spend their printed charges (item-actions.ts); a 1 on the last charge's d20 destroys it (resolution/charges.ts)."
  ),
  "item:staff-of-frost": enforced(
    "Resistance to Cold damage is applied, and Fog Cloud, Cone of Cold, Ice Storm and Wall of Ice spend their printed charges (item-actions.ts); a 1 on the last charge's d20 destroys it (resolution/charges.ts)."
  ),
  "item:staff-of-power": guided(
    "It swings as a +2 Quarterstaff, the +2 to AC, saving throws and spell attack rolls is applied, and its spells spend their printed charges; a 20 on the last charge's d20 gives 1d8 + 2 back (resolution/charges.ts). Retributive Strike, and a 1 on that d20, are the GM's."
  ),
  "item:staff-of-the-magi": guided(
    "It swings as a +2 Quarterstaff, the +2 to spell attack rolls is applied, and its spells spend their printed charges from 50; a 20 on the last charge's d20 gives 1d12 + 1 back (resolution/charges.ts). Advantage on saves against spells, Spell Absorption and Retributive Strike are the GM's."
  ),
  "item:staff-of-the-woodlands": enforced(
    "It swings as a +2 Quarterstaff, the +2 to spell attack rolls is applied, its spells spend their printed charges and Tree Form's use is counted. A 1 on the last charge's d20 leaves a plain Quarterstaff (resolution/charges.ts)."
  ),
  "item:staff-of-thunder-and-lightning": enforced(
    "It swings as a +2 Quarterstaff. Lightning and Thunder ride a melee hit, Thunder and Lightning does both as a Bonus Action (resolution/hit-options.ts), and Lightning Strike and Thunderclap are actions, each once a day."
  ),
  "item:staff-of-striking": enforced(
    "It swings as a +3 Quarterstaff, and a melee hit can spend 1, 2 or 3 of its 10 charges for 1d6 Force each (resolution/hit-options.ts)."
  ),
  "item:staff-of-withering": enforced(
    "It swings as a Quarterstaff, and a hit can spend a charge for 2d10 Necrotic and a DC 15 Constitution save against Disadvantage on Strength and Constitution checks and saves (resolution/hit-options.ts). The hour it lasts is the GM's."
  ),
  "item:rod-of-lordly-might": guided(
    "It swings as a +3 Mace; Drain Life and Paralyze ride a melee hit and Terrify is an action, each once a day. Its buttons are forms its holder picks for a Bonus Action (inventory.ts setItemForm): a flaming Longsword or Shortsword with 2d6 Fire and its light, a +3 Battleaxe or Spear, a pole or a battering ram (+10 to break through). Drain Life's healing, the pole's length and the north it finds are the GM's."
  ),
  "item:sun-blade": enforced(
    "It swings as a +2 Finesse Longsword that deals Radiant damage, with 1d8 Radiant more against an Undead, and its blade sheds its sunlight. A Bonus Action puts the blade away to the hilt or brings it back (inventory.ts setItemForm). The radius its Magic action adjusts is the GM's."
  ),
  "item:sword-of-sharpness": enforced(
    "A rolled 20 against a creature adds 14 Slashing damage and a level of Exhaustion (resolution/damage.ts, resolution/on-hit.ts), and its damage dice against an object are maximized (object-strikes.ts)."
  ),
  "item:talisman-of-pure-good": guided(
    "The +2 to spell attack rolls is applied. The 8d6 Radiant it deals a Fiend or an Undead that touches it, and Pure Rebuke's fissure on its charges, are the GM's."
  ),
  "item:talisman-of-ultimate-evil": guided(
    "The +2 to spell attack rolls is applied. The 8d6 Necrotic it deals a creature other than a Fiend or an Undead that touches it, and Ultimate End's fissure on its charges, are the GM's."
  ),
  "item:sword-of-wounding": enforced(
    "The extra Necrotic damage is applied, and a hit opens a DC 15 Constitution save whose failure stops the target regaining Hit Points until it succeeds on the save it repeats at the end of each of its turns (resolution/on-hit.ts)."
  ),
  "item:vorpal-sword": guided(
    "The +3 to attack and damage rolls is applied. On a rolled 20 it cuts off the target's head (resolution/kill.ts): the creature dies, and only a revival that restores lost parts brings it back. A creature with no head, Immunity to Slashing damage, a neck too big (larger than Large) or Legendary Resistance to spend takes 30 Slashing damage more instead, and a hydra loses one head. Ignoring Resistance to Slashing damage, and a creature that lives without its head, are the GM's."
  ),
  "item:periapt-of-wound-closure": enforced(
    "death-saves.ts counts an attuned wearer's death save of 9 or lower as a 10, and rests.ts and resolution/hit-point-die.ts double what each Hit Point Die it rolls to heal restores."
  ),
  "item:wand-of-fireballs": enforced(
    "Fireball at DC 15 on its charges, each charge past the first raising its level by 1 up to 3 (item-actions.ts); a 1 on the last charge's d20 destroys it (resolution/charges.ts)."
  ),
  "item:wand-of-lightning-bolts": enforced(
    "Lightning Bolt at DC 15 on its charges, each charge past the first raising its level by 1 up to 3 (item-actions.ts); a 1 on the last charge's d20 destroys it (resolution/charges.ts)."
  ),
  "item:wand-of-the-war-mage-1": enforced(
    "The +1 to spell attack rolls is applied, and a spell attack roll sets the target's Half Cover aside (resolution/attack.ts)."
  ),
  "item:wand-of-the-war-mage-2": enforced(
    "The +2 to spell attack rolls is applied, and a spell attack roll sets the target's Half Cover aside (resolution/attack.ts)."
  ),
  "item:wand-of-the-war-mage-3": enforced(
    "The +3 to spell attack rolls is applied, and a spell attack roll sets the target's Half Cover aside (resolution/attack.ts)."
  ),
  "item:sword-of-life-stealing": guided(
    "A rolled 20 is said with the hit (resolution/on-hit.ts). Its 15 Necrotic damage to a creature that is neither a Construct nor an Undead, and the Temporary Hit Points it gives, are the GM's."
  ),
  "item:potion-of-poison": guided(
    "Drinking it deals its 4d6 Poison damage to the drinker. The DC 13 Constitution save against an hour of Poisoned, and its disguise, are the GM's: the GM names the row."
  ),
  "item:boots-of-speed": guided(
    "A Bonus Action doubles its wearer's Speed (speed.ts) and gives Opportunity Attacks against it Disadvantage, for 10 minutes once a Long Rest. The minutes left when it ends early are the GM's to count."
  ),
  "item:thunderous-greatclub": guided(
    "Its wearer's Strength is at least 20 (live-abilities.ts), a hit deals 1d8 Thunder more, Clap of Thunder's 30-foot Cone asks for the DC 15 Strength save against Prone, and Earthquake's once-a-day DC 20 Dexterity save against Prone is applied. Earthquake's Concentration save, its fissure and the damage to objects are the GM's."
  ),
  "item:oathbow": guided(
    "Naming a sworn enemy marks it for 7 days, once a day, and the bow's ranged attacks against it have Advantage, set Half and Three-Quarters Cover aside and deal 3d6 Piercing more. Ignoring long range's Disadvantage, and the Disadvantage with other weapons while it lives, are the GM's."
  ),
  "item:energy-bow": guided(
    "It binds to its Longbow or Shortbow with +1 to attack and damage rolls, and its arrows deal Force damage with no ammunition to spend (inventory.ts weapon changes). The arrows' light, Arrow of Restraint, Arrow of Transport and the Energy Ladder are the GM's."
  ),
  "item:ioun-stone": guided(
    "The GM says which stone a found one is (item-records.ts), the bearer learns it on attuning, and two stones of different kinds attune as two items. Agility, Fortitude, Insight, Intellect, Leadership and Strength raise their score live (live-abilities.ts); Awareness and Protection are applied. Absorption, Greater Absorption, Mastery, Regeneration, Reserve and Sustenance are the GM's."
  ),
  "item:mace-of-terror": guided(
    "Its 3 charges come back 1d3 at dawn, and each opens the DC 15 Wisdom save against Frightened for a minute on the creatures its wielder picks within 30 feet, repeated at the end of each turn. That a Frightened creature flees and only Dashes is the GM's."
  ),
  "item:dust-of-sneezing-and-choking": guided(
    "Thrown, it opens the DC 15 Constitution save against Incapacitated on its thrower and every creature in its 30-foot Emanation but Constructs, Elementals, Oozes, Plants and Undead, repeated at the end of each turn, and is used up. Suffocating is the GM's."
  ),
  "item:potion-of-vitality": guided(
    "Drinking it ends the drinker's Exhaustion and the Poisoned condition. The next 24 hours of Hit Point Dice at their most are the GM's."
  ),
  "item:ring-of-elemental-command": guided(
    "Elemental Bane's Advantage on attacks against Elementals and their Disadvantage against its wearer, and Elemental Compulsion's DC 18 save against Charmed, are applied. The GM says which plane a found ring is (item-records.ts): its Resistance, Immunity or speed, and its spells at DC 18 on 5 charges with their printed costs. The languages, breathing water and moving through earth are the GM's."
  ),
  "item:weapon-of-warning": guided(
    "Advantage on Initiative for its wielder is applied. The same for allies within 30 feet, and waking them, are the GM's."
  ),

  // Spells whose data applies the cast's main numbers and leaves a rider the table would expect the server to apply.
  "spell:befuddlement": enforced(
    "A failed save deals the Psychic damage and bars the target from casting spells and the Magic action (resolution/economy.ts). The save every 30 days, and Greater Restoration, Heal or Wish ending it, are the GM's."
  ),
  "spell:bestow-curse": enforced(
    "A failed save leaves the curse the caster picks for the slot's duration (resolution/pending.ts, resolution/concentration.ts): Disadvantage on one ability's checks and saves, Disadvantage on its attack rolls against the caster (resolution/attack.ts), or an extra 1d8 Necrotic when the caster's attack hits it (resolution/damage.ts). Remove Curse or Dispel Magic ends it. The forced Dodge's save at the start of each turn is the GM's to ask."
  ),
  "spell:blur": enforced(
    "Attack rolls against the caster have Disadvantage while it lasts, except from an attacker whose Blindsight or Truesight reaches it (resolution/attack.ts)."
  ),
  "spell:chromatic-orb": guided(
    "The attack and the chosen damage type are applied, and when two of the d8s match the server says the orb leaps (resolution/orb-leap.ts). Aiming each leap is the caster's to make as another attack."
  ),
  "spell:confusion": guided(
    "A failed save bars the target's Bonus Actions and Reactions, with the save repeated at the end of each of its turns (save-stages.ts), and random-outcomes.ts rolls its d10 at the start of each of its turns and takes for that turn what the roll forbids. The Sphere grows by 5 feet for each slot level above 4 (spell-zone-state.ts). The wandering move and the random attack are said to the table."
  ),
  "spell:phantasmal-force": guided(
    "A failed save leaves the illusion on the target for the spell's duration, and End an Effect lets it study the illusion with an Intelligence (Investigation) check to end it (ending-actions.ts). The illusion, and the 2d8 Psychic damage it deals on the caster's turns, are the GM's."
  ),
  "spell:prismatic-spray": guided(
    "resolution/prismatic.ts rolls the d8 for each creature in the Cone, two rays on an 8, and the 12d6 once. Red to Blue ask the Dexterity save against their damage, half on a success. Indigo Restrains on a failure, with the Constitution saves counted until three successes end it or three failures Petrify it (save-stages.ts). Violet Blinds on a failure until the start of the caster's next turn; its Wisdom save then, and the trip to another plane, are the GM's."
  ),
  "spell:goodberry": enforced(
    "resolution/provisions.ts puts ten berries in the caster's inventory, gone when the spell's 24 hours end (effects.ts). Eating one (actor.nourish) restores 1 Hit Point, takes the eater's Bonus Action on its turn in a fight, and counts as a day's food while the GM tracks food and water (survival.ts)."
  ),
  "spell:create-food-and-water": guided(
    "The cast says what appears, and the characters eat and drink from it with the GM's meal and fill (actor.nourish, survival.ts). Where the food and water lie, and the food spoiling after 24 hours, are the GM's."
  ),
  "spell:sanctuary": enforced(
    "resolution/ward.ts asks the Wisdom save of a creature that targets the warded creature with an attack roll or a damaging spell; a failure spends nothing and turns it away from the warded creature for the rest of its turn, so it picks another target. Areas aren't stopped, and the spell ends when the warded creature makes an attack roll, casts a spell or deals damage (resolution/attack.ts)."
  ),
  "spell:water-breathing": enforced(
    "The cast gives each target the water-breathing effect for 24 hours, which ends any breath it holds and spares it from holding one (breath.ts)."
  ),
  "spell:compulsion": guided(
    "A failed save imposes Charmed. The move it forces each turn, and the save after it, are the GM's."
  ),
  "spell:conjure-celestial": guided(
    "The Healing Light on the cast is applied, and Bright Light fills the Cylinder for dynamic vision (vision/cast-sight.ts). Searing Light, and moving the Cylinder, are the GM's."
  ),
  "spell:conjure-elemental": enforced(
    "spell-zones.ts asks for the spirit's Dexterity save when an enemy enters its space or starts its turn within 5 feet of it, while it has no creature Restrained: 8d8 damage of its element and Restrained until the spell ends on a failure. The Restrained creature repeats the save at the start of each of its turns, taking 4d8 of the element on a failure and going free on a success (save-stages.ts)."
  ),
  "spell:contact-other-plane": enforced(
    "The caster makes the DC 15 Intelligence save (resolution/pending.ts); a failure deals 6d6 Psychic damage and leaves it Incapacitated until it finishes a Long Rest (rests.ts). The entity's answers, and a Greater Restoration ending the condition, are the GM's."
  ),
  "spell:contagion": enforced(
    "The save's 11d8 Necrotic damage and Poisoned are applied, with Disadvantage on saves with the ability the caster picks (resolution/pending.ts), and the repeat saves are counted until three successes end it or three failures leave it Poisoned for 7 days (save-stages.ts)."
  ),
  "spell:delayed-blast-fireball": guided(
    "The bead waits at its point, in a fight or out of one, and spell-zones.ts explodes it when the spell ends, Concentration broken included: the Dexterity save and 12d6 Fire damage, plus 1d6 for each of the caster's turns that ended while it waited. A creature that touches or throws the bead is the GM's to run."
  ),
  "spell:dispel-magic": enforced(
    "resolution/dispel.ts ends each spell on the target creature of the slot's level or lower, and for each higher one rolls the caster's spellcasting ability check against DC 10 plus its level. The GM can aim it at a spell's area on the map instead. A spell on an object the app doesn't track is the GM's."
  ),
  "spell:death-ward": enforced(
    "hit-points.ts leaves the target at 1 Hit Point the first time it would drop to 0, and ends the spell. An effect that would kill it outright without dealing damage (Power Word Kill, Divine Word, a Slaying Bow) ends the spell instead (hit-points.ts, fatal-saves.ts)."
  ),
  // Death and coming back (death.ts, resolution/revival.ts, resolution/kill.ts, fatal-saves.ts, risen.ts).
  "spell:revivify": enforced(
    "resolution/revival.ts refuses a target that isn't dead, died more than a minute of game time ago (death.ts keeps the time of death: a fight's rounds, then the game clock), or lost its body or its head. The cast returns it with 1 Hit Point and spends the diamond (resolution/components.ts). Death by old age is the GM's to rule."
  ),
  "spell:raise-dead": enforced(
    "resolution/revival.ts refuses a target dead more than 10 days of game time, less any time under Gentle Repose, one Undead when it died, and one whose body or head is gone. It returns with 1 Hit Point and no longer Poisoned, and takes a -4 penalty to D20 Tests that eases by 1 with each Long Rest (death.ts)."
  ),
  "spell:resurrection": enforced(
    "resolution/revival.ts refuses a target dead more than a century, one Undead when it died, and one whose body is gone; a lost head is restored. It returns with all its Hit Points, no longer Poisoned, with a -4 penalty to D20 Tests that eases by 1 with each Long Rest (death.ts). For a creature dead 365 days or longer the caster can't cast spells and has Disadvantage on D20 Tests until a Long Rest. Death by old age is the GM's to rule."
  ),
  "spell:true-resurrection": enforced(
    "resolution/revival.ts refuses a target dead more than 200 years, and brings back one whose body is gone (Disintegrate) in a new body. It returns with all its Hit Points, its poison, curses and Contagion ended. Where a new body appears, and the stat block of an Undead returned to life, are the GM's."
  ),
  "spell:reincarnate": guided(
    "resolution/revival.ts refuses a target dead more than 10 days and returns it with all its Hit Points in a new body, rolling the d10 for its species (a 1 rolls again) and noting it on the creature. Rebuilding the sheet with the new species, and the soul's consent, are the GM's."
  ),
  "spell:gentle-repose": enforced(
    "resolution/revival.ts takes only a corpse, and the game time it spends under the spell's 10 days doesn't count against a revival's limit (death.ts). Keeping it from becoming Undead is the GM's."
  ),
  "spell:disintegrate": enforced(
    "The save and its Force damage are applied, and a target it drops to 0 Hit Points dies with nothing left of its body (hit-points.ts): only True Resurrection or Wish brings it back (resolution/revival.ts). Aimed at a door, a wall that is an object or a wall of force on the map, it destroys it (spell-walls.ts): Wall of Force and Forcecage whole, ending the spell, and a larger wall in a 10-foot gap. Aimed at a creature in a sphere of force, it destroys the sphere and harms nothing inside (enclosures.ts). The gear it leaves is the GM's."
  ),
  "spell:power-word-kill": enforced(
    "resolution/kill.ts kills a target with 100 Hit Points or fewer outright, a character with no death saves, and deals 12d12 Psychic damage to any other. Death Ward turns the death aside."
  ),
  "spell:finger-of-death": enforced(
    "The save and its Necrotic damage are applied. A Humanoid it kills rises as a Zombie at the start of the caster's next turn (risen.ts), under the caster's command and on its side, in the corpse's space and acting right after the caster (summons.ts): a player's caster runs it."
  ),
  "spell:divine-word": enforced(
    "A failed Charisma save acts by the target's Hit Points (fatal-saves.ts): 20 or fewer dies, 30 or fewer is Blinded, Deafened and Stunned for 1 hour, 40 or fewer Blinded and Deafened for 10 minutes, and 50 or fewer Deafened for 1 minute. A Celestial, an Elemental, a Fey or a Fiend that fails leaves the map for 24 hours (off-plane.ts)."
  ),
  "spell:dissonant-whispers": enforced(
    "The save and its Psychic damage are applied. On a failure the target spends its Reaction, when it can take one, on a move of its Speed that must end farther from the caster (granted-moves.ts), provoking as any move does; the route is the mover's."
  ),
  "spell:dominate-beast": guided(
    "Only a Beast can be the target. A failed save imposes Charmed for the spell's duration, longer from a higher slot (resolution/concentration.ts), with Advantage on the save while its side is fighting the caster's, and a repeat save each time the target takes damage (save-stages.ts). It puts the target under the caster's command and on its side while it lasts (summons.ts): the caster's player acts for it on its turns."
  ),
  "spell:dominate-monster": guided(
    "Any creature can be the target. A failed save imposes Charmed for the spell's duration, longer from a level 9 slot (resolution/concentration.ts), with Advantage on the save while its side is fighting the caster's, and a repeat save each time the target takes damage (save-stages.ts). It puts the target under the caster's command and on its side while it lasts (summons.ts): the caster's player acts for it on its turns."
  ),
  "spell:dominate-person": guided(
    "Only a Humanoid can be the target. A failed save imposes Charmed for the spell's duration, longer from a higher slot (resolution/concentration.ts), with Advantage on the save while its side is fighting the caster's, and a repeat save each time the target takes damage (save-stages.ts). It puts the target under the caster's command and on its side while it lasts (summons.ts): the caster's player acts for it on its turns."
  ),
  "spell:earthquake": guided(
    "The cast places the 100-foot circle, and its Dexterity save leaves a creature Prone with its Concentration broken on a failure. spell-zones.ts repeats the save for each creature on the ground in the circle at the end of each of the caster's turns, sparing one in the air, as the cast does, and zone-ground.ts makes the circle Difficult Terrain. The fissures, and the 50 Bludgeoning damage to structures, which the GM deals to the walls and doors that are objects with object.damage (objects.ts), are the GM's."
  ),
  "spell:fear": guided(
    "A failed save imposes Frightened and drops what the creature holds (effects.ts), and a creature that ends its turn out of the caster's sight repeats the save (save-stages.ts, with dynamic vision on). The Dash away on each of its turns is the GM's."
  ),
  "spell:faithful-hound": guided(
    "The hound stays at its point in a fight or out of one, and spell-zones.ts makes it bite at the start of each of the caster's turns in a fight: the enemy nearest it within 5 feet makes the Dexterity save against 4d8 Force damage. Moving the hound and its warning bark are the GM's, and so is its sight of Invisible creatures."
  ),
  "spell:flesh-to-stone": enforced(
    "A failed save imposes Restrained, and the repeat saves are counted: three successes end it, three failures Petrify it (save-stages.ts). A success leaves Speed 0 until the start of the caster's next turn, and a Construct succeeds without a roll."
  ),
  "spell:freedom-of-movement": guided(
    "speed.ts gives the target a Swim Speed equal to its Speed, terrain.ts charges it nothing extra for Difficult Terrain, and the target can't have the Paralyzed or Restrained condition (effects.ts), whatever its source. Keeping its Speed from being reduced and slipping free of restraints are the GM's."
  ),
  "spell:gust-of-wind": enforced(
    "The cast's save pushes a creature that fails 15 feet away from the caster, and the Line disperses the fog and clouds it overlaps (vision/cast-sight.ts). spell-zones.ts repeats the save for a creature ending its turn in the Line, zone-ground.ts charges 2 feet for every foot a creature in it moves closer to the caster, and the Bonus Action points the Line another way from the caster (zone-moves.ts). Putting out flames is the table's."
  ),
  "spell:hideous-laughter": enforced(
    "A failed save imposes Prone and Incapacitated, repeated at the end of each of the target's turns and each time it takes damage, with Advantage then (save-stages.ts). It can't stand up while it laughs (actor-conditions.ts)."
  ),
  "spell:irresistible-dance": enforced(
    "A failed save Charms the target, holds its Speed at 0, gives it Disadvantage on Dexterity saves and attack rolls and attackers Advantage against it, and offers it an action to collect itself with a Wisdom save at the spell save DC (builtin-actions.ts). A success holds its Speed at 0 until the end of its next turn."
  ),
  "spell:major-image": guided(
    "resolution/concentration.ts holds the caster's Concentration on it, and from a level 4 slot it lasts until dispelled with none. The illusion itself is the GM's to run."
  ),
  "spell:mass-heal": enforced(
    "resolution/heal.ts divides the 700 Hit Points evenly among the creatures the caster picks, none past its maximum, and ends Blinded, Deafened and Poisoned on each. A different split is the caster's to make by hand."
  ),
  "spell:phantasmal-killer": enforced(
    "The save and its 4d10 Psychic damage are applied, and a failure leaves Disadvantage on the target's ability checks and attack rolls, with the save repeated at the end of each of its turns until it succeeds and the 4d10 again on each failed repeat (save-stages.ts)."
  ),
  "spell:power-word-heal": enforced(
    "resolution/heal.ts restores all the target's Hit Points and ends Charmed, Frightened, Paralyzed, Poisoned and Stunned, for one creature (resolution/spell-targets.ts). Standing up from Prone with its Reaction is the creature's choice."
  ),
  "spell:heal": enforced(
    "resolution/heal.ts restores 70 Hit Points, 10 more for each slot level above 6, and ends Blinded, Deafened and Poisoned, for one creature (resolution/spell-targets.ts)."
  ),
  "spell:counterspell": enforced(
    "resolution/counter.ts holds a cast with components while each creature that sees its caster within 60 feet and has Counterspell, a slot and its Reaction answers: a Spell Scroll's (a cast from another item needs no components), a spell readied with the Ready action as it is cast, and a long casting as it begins. counter-answers.ts rolls the caster's Constitution save against the reactor's DC: a failure ends the spell with no effect and leaves its slot unspent, and a success lets it go ahead. The caster's own allies aren't asked."
  ),
  "spell:mass-cure-wounds": enforced(
    "resolution/heal.ts restores 5d8 plus the modifier to up to six creatures the caster picks, and resolution/spell-targets.ts keeps them within one 30-foot Sphere centered within 60 feet."
  ),
  "spell:hold-person": enforced(
    "A failed save imposes Paralyzed, repeated at the end of each of the target's turns. resolution/spell-targets.ts takes one Humanoid, one more for each slot level above 2."
  ),
  "spell:mass-suggestion": enforced(
    "A failed save imposes Charmed on up to twelve creatures (resolution/spell-targets.ts). What the suggestion makes them do is the GM's."
  ),
  "spell:power-word-stun": enforced(
    "A target with 150 Hit Points or fewer is Stunned and repeats the save at the end of each of its turns; a tougher one's Speed is 0 until the start of the caster's next turn (resolution/pending.ts)."
  ),
  "spell:prayer-of-healing": enforced(
    "The 2d8 Hit Points are applied, each target gains a Short Rest's benefits, and a creature it healed is refused until it finishes a Long Rest (resolution/prayer-of-healing.ts)."
  ),
  "spell:prismatic-wall": guided(
    "The save against Blinded for a creature near the wall is applied, and the wall on its placed Line blocks sight and sheds its Bright and Dim Light for dynamic vision (vision/cast-sight.ts). Each layer's save and effect, and breaking the layers, are the GM's."
  ),
  "spell:protection-from-poison": enforced(
    "The cast ends Poisoned and leaves Resistance to Poison damage and Advantage on saves to avoid or end Poisoned, for an hour counted on the game clock (game-time.ts)."
  ),
  "spell:remove-curse": enforced(
    "resolution/dispel.ts ends every effect marked a curse on the target (Hex, Bestow Curse, Geas), and breaks its Attunement to a cursed item so the item can be removed; the item's own curse stays. A curse the app doesn't track is the GM's."
  ),
  "spell:regenerate": enforced(
    "The 4d8 + 15 Hit Points are applied to one creature, which regains 1 Hit Point at the start of each of its turns for the hour (turn-boundaries.ts). Regrowing severed parts is the GM's."
  ),
  "spell:sleep": enforced(
    "A failed save imposes Incapacitated until the end of the target's next turn, then the second save leaves it Unconscious on a failure (save-stages.ts). Damage ends either stage, and so does a creature within 5 feet taking the Shake Awake action (resolution/builtins.ts). An elf or a creature immune to Exhaustion succeeds without a roll."
  ),
  "spell:alter-self": enforced(
    "The form picked is kept for the hour (resolution/grant-extras.ts): Aquatic Adaptation's Swim Speed (speed.ts), or a natural weapon that makes the Unarmed Strike 1d6 of its type with the spellcasting ability (resolution/builtins.ts). Changing the form is a new cast; Change Appearance and breathing water are the GM's."
  ),
  "spell:beacon-of-hope": enforced(
    "Each target has Advantage on Wisdom saves and Death Saving Throws (saving-throws.ts) and regains the most any healing can give it (resolution/heal.ts) while the caster concentrates."
  ),
  "spell:calm-emotions": enforced(
    "A Humanoid that fails the Charisma save takes the effect picked for it (resolution/pending.ts): immunity to Charmed and Frightened, one it has held off and given back when the spell ends (suppressed-conditions.ts); or Indifferent, whose attitude is the GM's to play."
  ),
  "spell:command": enforced(
    "A failed save leaves the command picked until the end of the target's next turn (resolution/pending.ts): Flee allows only the Dash (resolution/economy.ts), Grovel makes it Prone and holds it still with no actions, Halt holds it still with no actions, and Drop takes its actions. Moving it for Approach and Flee, and what it drops, are the GM's."
  ),
  "spell:dispel-evil-and-good": guided(
    "Celestials, Elementals, Fey, Fiends and Undead have Disadvantage on attack rolls against the caster (resolution/attack.ts). Break Enchantment and Dismissal are the GM's to run, and they end the spell."
  ),
  "spell:dragons-breath": enforced(
    "The touched creature gains an action to exhale the 15-foot Cone at the cast's level, save DC and the damage type picked when it was cast, while the caster concentrates (granted-actions.ts); the caster's own sheet doesn't offer it."
  ),
  "spell:enthrall": enforced(
    "A failed Wisdom save gives -10 to the target's Perception checks while the caster concentrates (ability-checks.ts). Its Passive Perception, and the creatures that succeed automatically because they are fighting the caster's side, are the GM's."
  ),
  "spell:expeditious-retreat": enforced(
    "The cast takes the Dash action at once, and the caster may take it again as a Bonus Action while the spell lasts (builtin-actions.ts)."
  ),
  "spell:eyebite": enforced(
    "A failed save leaves the effect picked (resolution/pending.ts): Asleep (Unconscious, waking on damage or a Shake Awake), Panicked (Frightened, its turns spent on the Dash) or Sickened (Poisoned). Targeting another creature on later turns, and a Panicked creature's route away, are the GM's."
  ),
  "spell:fire-shield": enforced(
    "The shield picked gives Resistance to Cold (warm) or Fire (chill), and a creature within 5 feet that hits the caster with a melee attack roll takes 2d8 Fire or Cold (resolution/struck.ts). Its light is carried with the caster's token (vision/cast-sight.ts)."
  ),
  "spell:glibness": enforced(
    "A Charisma check's d20 counts as at least 15 for the hour (ability-checks.ts). How magic reads the caster's truthfulness is the GM's."
  ),
  "spell:guidance": enforced(
    "The touched creature adds 1d4 to its checks with the skill picked at the cast while the caster concentrates (ability-checks.ts)."
  ),
  "spell:heroes-feast": enforced(
    "Up to twelve creatures gain Resistance to Poison damage, Immunity to Frightened and Poisoned, and 2d10 rolled for each to its Hit Point maximum and current Hit Points for 24 hours of game time (resolution/grant.ts). The hour the feast takes is the GM's to time."
  ),
  "spell:magic-weapon": enforced(
    "The caster's nonmagical weapon picked gains +1 to its attack and damage rolls, +2 from a level 3 slot and +3 from level 6 (equipment-derivation.ts), for the hour; casting it again moves it. A weapon another creature carries is the GM's."
  ),
  "spell:mind-blank": enforced(
    "The target is immune to Psychic damage (hit-points.ts) and the Charmed condition (effects.ts). What it hides from divination is the GM's."
  ),
  "spell:mind-spike": enforced(
    "The save and its Psychic damage are applied, and a failure outlines the target to the caster: Invisible gives it nothing against the caster's attacks or the caster's against it (resolution/attack.ts). Knowing where it is, and hiding, are the GM's."
  ),
  "spell:protection-from-evil-and-good": enforced(
    "Aberrations, Celestials, Elementals, Fey, Fiends and Undead have Disadvantage on attack rolls against the target and can't make it Charmed or Frightened (effects.ts). Possession, and Advantage on a new save against such a creature's effect, are the GM's."
  ),
  "spell:ray-of-enfeeblement": enforced(
    "A failed Constitution save gives Disadvantage on Strength attack rolls, checks and saves and takes 1d8 off each damage roll, never below 1, repeating the save at the end of each turn; a success gives Disadvantage on its next attack roll before the caster's next turn (resolution/pending.ts)."
  ),
  "spell:resistance": enforced(
    "The touched creature takes 1d4 off damage of the type picked, once a turn, while the caster concentrates (hit-points.ts)."
  ),
  "spell:sequester": enforced(
    "The target is Invisible and Unconscious until the spell ends, which taking damage does (effects.ts). The end condition the caster sets, and hiding from divination, are the GM's."
  ),
  "spell:warding-bond": guided(
    "The target has +1 to AC and saving throws and Resistance to all damage for the hour. The caster's share of its damage, and the spell ending at 60 feet apart, are the GM's."
  ),
  "feature:dark-ones-blessing": enforced(
    "When the Warlock drops an enemy to 0 Hit Points, or anyone does within 10 feet of it on the map, it gains Temporary Hit Points equal to its Charisma modifier plus its Warlock level, at least 1, keeping the higher (dark-ones-blessing.ts)."
  ),
  "feature:empowered-strikes": enforced(
    "A Monk 6's Unarmed Strike deals Force or its normal type, its choice (builtin-actions.ts)."
  ),
  "feature:foe-slayer": enforced("A Ranger 20's Hunter's Mark deals 1d10 (resolution/grant.ts)."),
  "feature:sacred-weapon": enforced(
    "A use of Channel Divinity binds the held Melee weapon picked for 10 minutes: its attack rolls add the Charisma modifier, at least +1, and its hits deal Radiant or its own type (equipment-derivation.ts). Its 20 feet of Bright Light and 20 of Dim are carried with the Paladin's token (vision/senses.ts)."
  ),
  "feature:studied-attacks": enforced(
    "A Fighter that misses a creature has Advantage on its next attack roll against it before the end of its next turn, which that roll spends (resolution/studied.ts)."
  ),
  "feature:survivor": enforced(
    "A Champion 18 rolls death saves with Advantage (saving-throws.ts) and regains 5 plus its Constitution modifier at the start of each turn while Bloodied and above 0 (turn-boundaries.ts). An 18 or 19 on a death save counting as a 20 is the GM's."
  ),
  "spell:sleet-storm": guided(
    "spell-zones.ts asks for the Dexterity save when a creature enters the Cylinder or starts its turn there, and a failure leaves it Prone and ends its Concentration. A move that enters it waits there on the save, and a failure ends the move (zone-stops.ts, held-moves.ts). zone-ground.ts makes the Cylinder Difficult Terrain of ice, and it is Heavily Obscured for dynamic vision (vision/cast-sight.ts). Dousing the flames in it is the GM's."
  ),
  "spell:alarm": enforced(
    "The warded area lasts 8 hours, in a fight or out of one, on the game clock (spell-zones.ts, game-time.ts). When an enemy of the caster enters it, the GM is told who in a line only the GM sees. The GM wards a door or a window by hand, and passes on the bell or the ping."
  ),
  "spell:antilife-shell": enforced(
    "zone-barriers.ts holds every creature but Constructs and Undead out of the 10-foot Emanation. A walk goes round its edge, and strict rules refuse a move or a melee attack across it (resolution/validate.ts). A Ranged attack, a Reach weapon and a spell go through. The caster's move that forces the edge across such a creature ends the spell."
  ),
  "spell:aura-of-life": enforced(
    "zone-auras.ts gives the caster and its allies Resistance to Necrotic damage while they stand in the 30-foot Emanation, and keeps their Hit Point maximums from dropping there (hit-points.ts, rest-triggers.ts). spell-zones.ts gives an ally at 0 Hit Points that starts its turn there 1 Hit Point."
  ),
  "spell:black-tentacles": enforced(
    "spell-zones.ts asks for the Strength save on the cast and when a creature enters the square or ends its turn there, once a turn: 3d6 Bludgeoning damage and Restrained, escaped with a Strength (Athletics) check against the spell save DC. A move that enters it waits there on the save, and a failure ends the move (zone-stops.ts, held-moves.ts). zone-ground.ts makes the square Difficult Terrain."
  ),
  "spell:blade-barrier": enforced(
    "spell-zones.ts asks for the Dexterity save against 6d10 Force damage on the cast and when a creature enters the wall or ends its turn there, once a turn. zone-ground.ts makes the wall's space Difficult Terrain, and zone-walls.ts gives a creature on its far side Three-Quarters Cover against attacks and Dexterity saves across it. Its ring form is the GM's."
  ),
  "spell:call-lightning": guided(
    "The cast and each later Magic action strike a 5-foot Sphere with the Dexterity save against 3d10 Lightning damage, at the cast's slot level. Keeping the bolts under the cloud, and the extra 1d10 in a storm, are the GM's."
  ),
  "spell:cloudkill": enforced(
    "spell-zones.ts asks for the Constitution save against 5d8 Poison damage on the cast and when a creature enters the Sphere or ends its turn there, once a turn. At the start of each of the caster's turns it moves the Sphere 10 feet straight away from the caster, and a creature the Sphere moves onto makes the save. The Sphere is Heavily Obscured for dynamic vision (vision/cast-sight.ts)."
  ),
  "spell:conjure-minor-elementals": guided(
    "zone-ground.ts makes the ground in the 15-foot Emanation Difficult Terrain for the caster's enemies, and each of the caster's hits on a creature within 15 feet deals an extra 2d8 of the type picked at the cast (resolution/damage.ts). Picking the type for each attack instead, and the extra 1d8 a slot level, are the GM's."
  ),
  "spell:entangle": enforced(
    "The cast's Strength save leaves a creature in the square Restrained, escaped with a Strength (Athletics) check against the spell save DC. zone-ground.ts makes the square Difficult Terrain for the duration. Leaving the caster out of its own square is the GM's."
  ),
  "spell:fire-storm": enforced(
    "The cast places up to ten 10-foot Cubes, each touching another and within 150 feet of the caster (multi-templates.ts), and each creature under any of them makes the Dexterity save once against 7d10 Fire damage, half on a success. Setting flammable objects alight is the GM's."
  ),
  "spell:meteor-swarm": enforced(
    "The cast places up to four 40-foot-radius Spheres at different points within range (multi-templates.ts), and a creature in more than one makes the Dexterity save once, against 20d6 Fire and 20d6 Bludgeoning damage, half on a success. Setting objects alight is the GM's."
  ),
  "spell:flaming-sphere": enforced(
    "spell-zones.ts asks for the Dexterity save against 2d6 Fire damage when a creature ends its turn within 5 feet of the sphere. The Bonus Action moves the sphere up to 30 feet (zone-moves.ts), and a creature it rams makes the save. It sheds its light for dynamic vision (vision/cast-sight.ts)."
  ),
  "spell:fog-cloud": enforced(
    "The Sphere is Heavily Obscured for dynamic vision (vision/cast-sight.ts), and its radius grows 20 feet for each slot level above 1 (spell-zone-state.ts). Gust of Wind disperses it."
  ),
  "spell:forbiddance": enforced(
    "The warded area, up to a 200-foot square, lasts a day on the game clock (spell-zones.ts, game-time.ts). An Aberration, Celestial, Elemental, Fey, Fiend or Undead that enters it for the first time on a turn or ends its turn there takes 5d10 Radiant or Necrotic damage, chosen at the cast. Strict rules refuse a teleport into it (zone-barriers.ts). The password that spares a creature is the GM's."
  ),
  "spell:globe-of-invulnerability": enforced(
    "The 10-foot Emanation stays where its caster stood (spell-zones.ts). zone-barriers.ts keeps a spell of level 5 or lower cast from outside from affecting the creatures within, one level higher for each slot level above 6."
  ),
  "spell:glyph-of-warding": guided(
    "The explosive rune lasts until it goes off, in a fight or out of one, drawn for the GM and the caster's player alone. The first creature that steps onto it sets it off: each creature in the 20-foot Sphere makes the Dexterity save against 5d8 damage of the type chosen at the cast, and the spell ends (spell-zones.ts). Other triggers, noticing the glyph and the spell glyph are the GM's."
  ),
  "spell:grease": enforced(
    "spell-zones.ts asks for the Dexterity save when a creature enters the square or ends its turn there, and a failure leaves it Prone. A move that enters it waits there on the save, and a failure ends the move (zone-stops.ts, held-moves.ts). zone-ground.ts makes the square Difficult Terrain."
  ),
  "spell:holy-aura": enforced(
    "While the caster and its allies stand in the 30-foot Emanation, zone-auras.ts gives them Advantage on saving throws and Disadvantage to attack rolls against them. A Fiend or an Undead that hits one with a melee attack makes the Constitution save or is Blinded until the end of its next turn (resolution/struck.ts)."
  ),
  "spell:ice-storm": enforced(
    "The cast's Dexterity save deals the Bludgeoning and Cold damage, half on a success. zone-ground.ts makes the Cylinder Difficult Terrain of ice until the end of the caster's next turn."
  ),
  "spell:incendiary-cloud": guided(
    "spell-zones.ts asks for the Dexterity save against 10d8 Fire damage on the cast and when a creature enters the cloud or ends its turn there, once a turn. At the start of each of the caster's turns it moves the cloud 10 feet straight away from the caster, and a creature the cloud moves onto makes the save. The cloud is Heavily Obscured for dynamic vision (vision/cast-sight.ts). Choosing another direction is the GM's, who drags the area."
  ),
  "spell:insect-plague": enforced(
    "spell-zones.ts asks for the Constitution save against 4d10 Piercing damage on the cast and when a creature enters the Sphere or ends its turn there, once a turn. zone-ground.ts makes the Sphere Difficult Terrain, and it is Lightly Obscured for dynamic vision (vision/cast-sight.ts)."
  ),
  "spell:magic-circle": guided(
    "zone-barriers.ts keeps Celestials, Elementals, Fey, Fiends and Undead from walking into the Cylinder, and strict rules refuse their move across its edge. Their Disadvantage on attacks into it, their teleport save and the inverted circle are the GM's."
  ),
  "spell:moonbeam": enforced(
    "spell-zones.ts asks for the Constitution save against 2d10 Radiant damage on the cast and when a creature enters the Cylinder or ends its turn there, once a turn. On the caster's later turns a Magic action moves the Cylinder up to 60 feet (zone-moves.ts), and a creature it moves onto makes the save. Its Dim Light is placed for dynamic vision (vision/cast-sight.ts). A shape-shifted creature that fails returns to its true form and can't shape-shift while the spell lasts (transform/rules.ts); the GM ends that sooner when it leaves the Cylinder."
  ),
  "spell:pass-without-trace": enforced(
    "zone-auras.ts gives the caster and its allies +10 to Dexterity (Stealth) checks while they stand in the 30-foot Emanation. Leaving no tracks is the GM's to narrate."
  ),
  "spell:plant-growth": guided(
    "Overgrowth makes a creature spend 4 feet of movement for every foot it moves in the Sphere (zone-ground.ts), until the GM ends the area. Leaving parts of the Sphere out, and the 8-hour Enrichment, are the GM's."
  ),
  "spell:silence": enforced(
    "zone-auras.ts makes a creature Deafened and Immune to Thunder damage while it stands in the Sphere, and silence.ts refuses a spell with a Verbal component cast from inside it (resolution/components.ts)."
  ),
  "spell:spike-growth": enforced(
    "spell-zones.ts deals 2d4 Piercing damage for every 5 feet a creature travels into or within the Sphere, and zone-ground.ts makes the Sphere Difficult Terrain. Whether a creature saw the danger before it moved in is the GM's."
  ),
  "spell:wall-of-thorns": enforced(
    "spell-zones.ts asks for the Dexterity save against 7d8 Slashing damage when a creature enters the wall or ends its turn there, once a turn, after the cast's 7d8 Piercing. zone-ground.ts makes a creature spend 4 feet of movement for every foot it moves through the wall, and the wall blocks sight for dynamic vision (vision/cast-sight.ts). Its circle form is the GM's."
  ),
  "spell:web": enforced(
    "spell-zones.ts asks for the Dexterity save the first time a creature enters the webs on a turn or starts its turn there, and a failure leaves it Restrained, escaped with a Strength (Athletics) check against the spell save DC. A move that enters it waits there on the save, and a failure ends the move (zone-stops.ts, held-moves.ts). zone-ground.ts makes the webs Difficult Terrain, and they are Lightly Obscured for dynamic vision (vision/cast-sight.ts). Burning the webs away is the GM's, who ends the area."
  ),
  "action:Octopus/ink-cloud": guided(
    "The Reaction fills its 5-foot Cube with ink, Heavily Obscured for 1 minute (vision/cast-sight.ts), and gives a swim of its Swim Speed (granted-moves.ts). Offering it when a creature ends its turn beside the octopus underwater is the GM's."
  ),
  "action:Giant Octopus/ink-cloud": guided(
    "The Reaction fills its 10-foot Cube with ink, Heavily Obscured for 1 minute (vision/cast-sight.ts), and gives a swim of its Swim Speed (granted-moves.ts). Offering it when the octopus takes damage underwater is the GM's."
  ),
  "spell:sorcerous-burst": guided(
    "The attack and the chosen damage type are applied. Rolling another d8 on each 8 is the GM's."
  ),
  "spell:spirit-guardians": enforced(
    "spell-zones.ts asks for the save when a creature enters the Emanation or ends its turn there, and charges an affected creature double for each step it moves inside (terrain.ts). The creatures the caster designates are its allies."
  ),
  "spell:storm-of-vengeance": guided(
    "The first turn's save, Thunder damage and Deafened condition are applied. The storm's turns 2 to 10 are the GM's."
  ),
  "spell:tsunami": guided(
    "The wall's first save and damage are applied. Its movement and the damage on later turns are the GM's."
  ),
  "spell:wall-of-ice": enforced(
    "The save and its Cold damage for creatures in the wall's space are applied, and they are moved out of it. The wall rises on its placed Line as 10-foot sections that stop movement and leave sight through (spell-walls.ts), each an object with AC 12 and 30 Hit Points, Immunity to Cold damage and Vulnerability to Fire damage that is gone at 0 Hit Points (objects.ts). It goes when the Concentration ends. The frigid air a broken section leaves, and the dome and sphere forms, are the GM's."
  ),
  "spell:weird": enforced(
    "The save, its Psychic damage and Frightened are applied, with the repeat save at the end of each turn and 5d10 Psychic damage on each failed repeat (save-stages.ts)."
  ),
  "spell:wind-wall": enforced(
    "The save and its Bludgeoning damage are applied. While the caster concentrates, zone-walls.ts makes an arrow, a bolt or a thrown weapon miss a target across the wall, and zone-barriers.ts bars a Small or smaller creature in the air from crossing it. A giant's Rock and spells go through. Its hold on gases is the GM's."
  ),

  // Shape-shifting and size (transform/): each form is an effect, and its stat block or printed form is what the
  // creature reads while it lasts.
  "spell:polymorph": enforced(
    "A failed Wisdom save turns the target into a Beast of its Challenge Rating or lower that the caster picks (transform/options.ts): the Beast's statistics with the target's own Hit Points and creature type, Temporary Hit Points equal to the Beast's Hit Points, no speech or spells, and gear melded. It ends with Concentration, when those Temporary Hit Points run out, or at death (transform/rules.ts)."
  ),
  "spell:true-polymorph": guided(
    "Creature into Creature is applied: an unwilling target saves, a willing one doesn't, and it takes a stat block of its Challenge Rating or lower with Temporary Hit Points equal to its Hit Points, no speech or spells. Object into Creature, Creature into Object and the transformation made permanent after an hour of Concentration are the GM's."
  ),
  "spell:shapechange": enforced(
    "The caster takes a form of its level or Challenge Rating or lower, not a Construct or an Undead, keeping its mind, proficiencies and Spellcasting, with Temporary Hit Points from the first form. A Magic action takes a new form while the spell lasts, and the caster picks whether its gear is worn or melds."
  ),
  "spell:animal-shapes": enforced(
    "Each willing target takes a Large or smaller Beast of Challenge Rating 4 or lower, picked for each, keeping its mind and creature type, with Temporary Hit Points from its first form and its gear melded. A Magic action on a later turn gives new forms, and each target can end its own as a Bonus Action."
  ),
  "spell:enlargereduce": guided(
    "A willing target takes the effect with no save, an unwilling one on a failed Constitution save. Enlarge makes it one size larger with Advantage on Strength checks and saves and 1d4 more weapon damage; Reduce one size smaller with Disadvantage on Strength checks and saves. The token takes the new size (transform/forms.ts). Reduce's 1d4 less on weapon and Unarmed Strike damage leaves at least 1 (resolution/damage.ts)."
  ),
  "spell:gaseous-form": enforced(
    "The willing target becomes a misty cloud: its only speed is a Fly Speed of 10 feet that hovers, it can share a creature's space, has Resistance to Bludgeoning, Piercing and Slashing damage, Immunity to Prone and Advantage on Strength, Dexterity and Constitution saves, and it can't attack, speak or cast spells. A Magic action or 0 Hit Points ends it. Narrow openings and liquids are the GM's."
  ),
  "spell:wind-walk": guided(
    "Each willing target becomes a cloud with a Fly Speed of 300 feet that hovers, Immunity to Prone and Resistance to Bludgeoning, Piercing and Slashing damage; it can only Dash or take the Magic action that ends the form, which leaves it Stunned for 1 minute. Turning back into a cloud while the spell lasts, and the descent when it ends, are the GM's."
  ),
  "spell:magic-jar": castOnly(
    "The container, the possession of a host and the return to the body are the GM's: control of one creature passing to another is not modeled."
  ),
  "item:potion-of-growth": enforced(
    "Drinking it makes the drinker one size larger for 10 minutes, with Advantage on Strength checks and saves and 1d4 more damage with weapons and Unarmed Strikes. The token takes the new size (transform/forms.ts)."
  ),
  "item:potion-of-diminution": guided(
    "Drinking it makes the drinker one size smaller for 1d4 hours, rolled by the server, with Disadvantage on Strength checks and saves. The 1d4 less damage is the GM's."
  ),
  "item:potion-of-gaseous-form": enforced(
    "Drinking it gives Gaseous Form's misty cloud for 1 hour with no Concentration, ended early as a Bonus Action or at 0 Hit Points."
  ),
  "action:Doppelganger/shape-shift": enforced(printedForms("a Medium or Small Humanoid, its size changing on the map")),
  "action:Night Hag/shape-shift": enforced(printedForms("a Small or Medium Humanoid, its size changing on the map")),
  "action:Oni/shape-shift": enforced(
    printedForms("a Small or Medium Humanoid or a Large Giant, its size changing on the map")
  ),
  "action:Imp/shape-shift": enforced(printedForms("a rat, a raven or a spider, each with its own speeds")),
  "action:Quasit/shape-shift": enforced(printedForms("a bat, a centipede or a toad, each with its own speeds")),
  "action:Succubus/shape-shift": enforced(printedForms("a Medium or Small Humanoid with no Fly Speed")),
  "action:Mimic/shape-shift": guided(
    `${printedForms("a Medium or Small object")} Its Adhesive in object form is the GM's.`
  ),
  "action:Vampire/shape-shift": guided(
    "transform/assume.ts takes the Tiny bat (no speech) or the Medium mist (no actions or speech, Resistance to all damage, and it can share a space), each with its speeds, and returns to the vampire form. It is refused in sunlight with dynamic vision on, and its Multiattack and Grave Strike work only in the vampire form. Running water, and the sunlight's own damage getting through the mist's Resistance, are the GM's."
  ),
  "action:Werebear/shape-shift": enforced(printedForms("the Large hybrid or the Large bear")),
  "action:Wereboar/shape-shift": enforced(printedForms("the Medium hybrid or the Small boar")),
  "action:Wererat/shape-shift": enforced(printedForms("the Medium hybrid or the Small rat")),
  "action:Weretiger/shape-shift": enforced(printedForms("the Large hybrid or the Large tiger")),
  "action:Werewolf/shape-shift": enforced(printedForms("the Large hybrid or the Medium wolf")),
  "action:Werebear/bite": lycanthropeBite("Werebear"),
  "action:Wereboar/gore": lycanthropeBite("Wereboar"),
  "action:Wererat/bite": lycanthropeBite("Wererat"),
  "action:Weretiger/bite": lycanthropeBite("Weretiger"),
  "action:Werewolf/bite": lycanthropeBite("Werewolf"),
  // Resources, rests, conversions and charges.
  "feature:relentless-rage": enforced(
    "hit-points.ts rolls the Constitution save when a raging Barbarian drops to 0 Hit Points and isn't killed outright: DC 10, 5 more for each use since its last rest (rests.ts clears the count). A success leaves it at twice its Barbarian level."
  ),
  "feature:intimidating-presence": enforced(
    "The Bonus Action's Wisdom save against Frightened is applied, and conversions.ts restores its use for one use of Rage (actor.convert)."
  ),
  "feature:font-of-magic": enforced(
    "conversions.ts turns a spell slot into Sorcery Points equal to its level, and Sorcery Points into a slot at the SRD costs (2, 3, 5, 6 or 7 for levels 1 to 5, each at its Sorcerer level) as a Bonus Action. A created slot is gone after a Long Rest, which sets the slots to their maximum."
  ),
  "feature:sorcerous-restoration": enforced(
    "In the step a Short Rest opens, conversions.ts restores Sorcery Points up to half the Sorcerer level, once per Long Rest."
  ),
  "feature:dragon-wings": enforced(
    "The Bonus Action gives a Fly Speed of 60 feet, once per Long Rest, and conversions.ts restores the use for 3 Sorcery Points."
  ),
  "feature:font-of-inspiration": enforced(
    "Bardic Inspiration comes back on a Short Rest, and conversions.ts spends a spell slot for one use of it."
  ),
  "feature:superior-inspiration": enforced(
    "When the Bard rolls Initiative with fewer than two uses of Bardic Inspiration left, initiative-hooks.ts brings it up to two."
  ),
  "feature:wild-resurgence": enforced(
    "conversions.ts spends a spell slot for a use of Wild Shape once a turn, and a use of Wild Shape for a level 1 slot once per Long Rest."
  ),
  "feature:archdruid": enforced(
    "When the Druid rolls Initiative with no use of Wild Shape left, initiative-hooks.ts restores one. conversions.ts turns uses of Wild Shape into one spell slot, two levels a use, once per Long Rest (Nature Magician). Its slow aging is narrative."
  ),
  "feature:natural-recovery": enforced(
    "One level 1+ spell the Druid has prepared from its Circle Spells is cast with no slot, once per Long Rest: each land spell's free casting spends the one counter (character-build.ts). In the step a Short Rest opens, conversions.ts recovers spent slots of combined level up to half the Druid level (round up), none of level 6 or higher, once per Long Rest."
  ),
  "feature:arcane-recovery": enforced(
    "In the step a Short Rest opens, conversions.ts recovers slots of combined level up to half the Wizard level, none of level 6 or higher, once per Long Rest."
  ),
  "feature:memorize-spell": enforced(
    "Finishing a Short Rest opens a prepare step with one change (rests.ts): one prepared spell swapped for another from the spellbook."
  ),
  "feature:magical-cunning": enforced(
    "Outside a fight, conversions.ts restores expended Pact Magic slots up to half the maximum, once per Long Rest."
  ),
  "feature:eldritch-master": enforced("Magical Cunning restores every expended Pact Magic slot (conversions.ts)."),
  "feature:contact-patron": enforced(
    "Contact Other Plane is always prepared and cast once per Long Rest with no slot, and that cast succeeds on its own Intelligence save with no roll (resolution/pending.ts). What the patron answers is the GM's."
  ),
  "feature:restoring-touch": guided(
    "From Paladin 14, Lay on Hands spends 5 points to end one of Blinded, Charmed, Deafened, Frightened, Paralyzed or Stunned on a creature it touches (resolution/heal.ts). Ending several in one Bonus Action takes one use each here."
  ),
  "feature:uncanny-metabolism": enforced(
    "When the Monk rolls Initiative, initiative-hooks.ts offers it: all Focus Points back and Hit Points equal to its Monk level plus a Martial Arts die, once per Long Rest (conversions.ts)."
  ),
  "feature:perfect-focus": enforced(
    "When the Monk rolls Initiative with 3 Focus Points or fewer, initiative-hooks.ts brings them up to 4."
  ),
  "feature:weapon-mastery": enforced(
    "equipment-derivation.ts applies the mastery property of each picked weapon kind. A Barbarian picks melee weapons and a Rogue the weapons it is proficient with. In the step a Long Rest opens, actor.rechoose swaps picks and rebuilds the sheet (ledger-rechoice.ts): one for a Barbarian or Fighter, any for a Paladin, Ranger or Rogue."
  ),
  "feature:hunters-prey": guided(
    "The option is picked at build and swapped after a Short or Long Rest (ledger-rechoice.ts). Colossus Slayer's extra 1d8 on a weapon hit against a creature missing any Hit Points is applied once a turn (resolution/damage.ts). Horde Breaker's attack is the GM's."
  ),
  "feature:defensive-tactics": enforced(
    "Escape the Horde gives Opportunity Attacks against the Ranger Disadvantage, and Multiattack Defense marks a creature that hit it (resolution/struck.ts). The option is swapped after a Short or Long Rest (ledger-rechoice.ts)."
  ),
  "feature:relentless-hunter": enforced(
    "hit-points.ts opens no Concentration save from damage when the only spell the Ranger concentrates on is Hunter's Mark."
  ),
  "feature:improved-elemental-fury": enforced(
    "Primal Strike deals 2d8. Improved Potent Spellcasting adds 300 feet to a Druid cantrip of 10 feet or more (effective-actions.ts, resolution/spell-targets.ts)."
  ),
  "feature:potent-cantrip": enforced(
    "resolution/damage.ts deals half an Evoker's cantrip damage on a missed attack roll, and resolution/pending.ts halves it on a successful save, with no other effect."
  ),
  "feature:empowered-evocation": guided(
    "The Intelligence modifier is added to a Wizard Evocation spell's damage (resolution/damage.ts). A spell of several rolls (Scorching Ray's rays) gets it on each, which the GM trims to one."
  ),
  "feature:elemental-affinity": guided(
    "Resistance to the chosen type is applied, and the Charisma modifier is added to a spell's damage of that type, never a weapon's (resolution/damage.ts). A spell of several rolls gets it on each, which the GM trims to one."
  ),
  "feature:overchannel": enforced(
    "The cast offers Overchannel beside Metamagic (resolution/metamagic.ts): it deals a Wizard spell's maximum damage with a level 1 to 5 slot, and from the second use before a Long Rest the Evoker takes 2d12 Necrotic a slot level, 1d12 more each time, past its defences (resolution/overchannel.ts)."
  ),
  "feature:signature-spells": enforced(
    "Two level 3 spells from the spellbook (spellbook.ts checks the pick as a build or a level up makes it) are always prepared, and each is cast once at level 3 with no slot, back on a Short or Long Rest, on its own counter (character-build.ts)."
  ),
  "feature:high-elf-cantrip": enforced(
    "The High Elf knows Prestidigitation, a pick the build fills when the ledger names none (character-build.ts), or the Wizard cantrip it swapped in during the step a Long Rest opens (ledger-rechoice.ts)."
  ),
  "feature:evocation-savant": enforced(
    "Two Evocation spells of level 2 or lower go into the spellbook at Wizard 3 (character-build.ts), and one more Evocation spell goes in free each time a new level of spell slots opens, beside the two a Wizard level gives (spell-choices.ts)."
  ),
  "feature:spell-mastery": enforced(
    "The level 1 and level 2 picks, spells from the spellbook with a casting time of an action (character-offers.ts filters the casting time, spellbook.ts checks the book), are always prepared and cast at will at their own level with no slot (character-build.ts); one is swapped for another of the same level from the book in the step a Long Rest opens (ledger-rechoice.ts)."
  ),
  "spell:mirror-image": enforced(
    "The caster has three duplicates for a minute. Each hit on it rolls a d6 a duplicate, and on a 3 or higher the hit lands on a duplicate, which is destroyed, ending the spell with the last; an attacker Blinded or with Blindsight or Truesight is unaffected (resolution/mirror-image.ts)."
  ),
  "spell:augury": guided(
    "Each cast after the first before a Long Rest rolls the d100 against a 25 percent chance of no answer for each earlier cast (resolution/divinations.ts). The omen is the GM's."
  ),
  "spell:commune": guided(
    "Each cast after the first before a Long Rest rolls the d100 against a 25 percent chance of no answer for each earlier cast (resolution/divinations.ts). The deity's answers are the GM's."
  ),
  "spell:divination": guided(
    "Each cast after the first before a Long Rest rolls the d100 against a 25 percent chance of no answer for each earlier cast (resolution/divinations.ts). The truthful reply is the GM's."
  ),
  "item:pearl-of-power": enforced(
    "Its Magic action restores one expended slot of level 3 or lower, once per Long Rest (conversions.ts)."
  ),
  "item:horn-of-valhalla": enforced(
    "Each metal is its own action: 2 to 5 Berserkers appear within 60 feet for 1 hour, immune to Charmed and Frightened (summons.ts). They obey a user whose sheet has the metal's training and attack one whose sheet lacks it. clock-pools.ts keeps it from being blown again until 7 days have passed on the game clock."
  ),
  "item:necklace-of-fireballs": enforced(
    "inventory.ts rolls its 1d6 + 3 beads when it is added, and each bead casts a level 3 Fireball at DC 15 and never comes back. Hurling several beads at once is the GM's."
  ),
  "item:chime-of-opening": enforced(
    "Each strike casts Knock on its 10 charges, which never come back, and the last one cracks it (resolution/charges.ts)."
  ),
  "item:ring-of-three-wishes": guided(
    "Its three Wish casts are counted and never come back (resolution/charges.ts). What a Wish does is the GM's."
  ),
  "item:gem-of-brightness": enforced(
    "Its light is lit and put out on the row, and its beam (1 charge) and flare (5 charges) open the DC 15 Constitution save against Blinded on its 50 charges, which never come back."
  ),
  "item:rod-of-resurrection": enforced(
    "Its casts spend their printed charges, and it regains 1 charge at dawn or at a Long Rest (item-charges.ts)."
  ),

  // Walls, doors and objects on the map (spell-walls.ts, doors.ts, objects.ts, enclosures.ts, zone-walls.ts).
  "spell:wall-of-force": enforced(
    "The cast raises the wall on its placed Line as walls that stop movement and leave sight through (spell-walls.ts). A creature in its space is moved out of it, the caster's allies to the caster's side and the rest to the far side. Nothing damages it, Disintegrate destroys it whole and ends the spell, and it goes when the Concentration ends. Its hemisphere and globe forms are the GM's to draw."
  ),
  "spell:wall-of-stone": enforced(
    "The cast raises the wall on its placed Line as 10-foot stone panels that stop movement and sight, each an object with AC 15 and 180 Hit Points that is gone at 0 Hit Points (spell-walls.ts, objects.ts). A creature in its space is moved out of it. The wall stays for good once the caster holds Concentration for the full 10 minutes, and goes if the Concentration ends sooner. Its other shapes, and the save of a creature it would shut in, are the GM's."
  ),
  "spell:forcecage": enforced(
    "The cast raises the 20-foot cage on its placed Cube as bars that stop movement and leave sight, attacks and spells through (spell-walls.ts), and moves a creature standing in the bars out of them. A creature that teleports out first makes a Charisma save against the caster's spell save DC, which the server rolls, and a failure keeps it in and wastes the teleport (forcecage.ts). Disintegrate destroys the cage, and it goes when the spell ends. The solid 10-foot box and its reach into the Ethereal Plane are the GM's."
  ),
  "spell:wall-of-fire": enforced(
    "spell-zones.ts deals 5d8 Fire damage to a creature that enters the wall for the first time on a turn or ends its turn in it, after the cast's Dexterity save, and the wall blocks sight for dynamic vision (vision/cast-sight.ts). The burning side's damage within 10 feet and the ring form are the GM's."
  ),
  "spell:knock": enforced(
    "Aimed at a door on the map that the caster sees within 60 feet, it takes away one of what holds it shut, a lock, a stuck or barred state or a spike, and holds an Arcane Lock off for 10 minutes (doors.ts). A door Stone Shape sealed stays shut. The knock heard 300 feet away is the table's."
  ),
  "spell:arcane-lock": enforced(
    "Aimed at a door on the map the caster touches, it locks the door against everyone but the caster and the creatures named as the cast's targets (doors.ts). Thieves' Tools can't pick it, a Strength check can't force it, and Knock holds it off for 10 minutes. The password and the higher DC to break it are the GM's."
  ),
  "spell:passwall": guided(
    "Aimed at a wall on the map within 30 feet that the caster sees, it cuts a 5-foot passage that sight and movement pass through for the hour (spell-walls.ts). Moving the creatures still in the passage when it closes is the GM's."
  ),
  "spell:stone-shape": guided(
    "Aimed at a door on the map the caster touches, it seals the door shut so that no check opens it; aimed at a wall, it cuts a lasting 5-foot passage through it (spell-walls.ts, doors.ts). The other shapes it makes are the GM's."
  ),
  "spell:elementalism": guided(
    "Beckon Air aimed at a door on the map within 30 feet slams it shut (resolution/cast-walls.ts). The other options are the GM's."
  ),
  "spell:resilient-sphere": enforced(
    "A failed Dexterity save shuts the target in the sphere while the caster concentrates (enclosures.ts). An attack or spell on it from outside, or from it on anything outside, meets Total Cover's refusal, and an area leaves it out. Disintegrate aimed at it destroys the sphere, harms nothing inside and ends the spell. Rolling the sphere along, and a willing target, are the GM's."
  ),
  "spell:tiny-hut": guided(
    "The dome stays where it was cast (zone-barriers.ts): only the creatures inside it at the cast pass through it, and a spell of level 3 or lower cast from outside can't reach inside. Its light, its one-way sight and its end when the caster leaves are the GM's."
  ),
  "item:bead-of-force": enforced(
    "Throwing a bead uses it up: each creature in the 10-foot-radius Sphere makes the DC 15 Dexterity save or takes 5d4 Force damage, and one that fails is shut in the sphere for a minute, which no attack or effect passes (enclosures.ts). Pushing out the creatures that saved, and rolling the sphere, are the GM's."
  ),
  "item:net": enforced(
    "Thrown in place of an attack at a Large or smaller creature the thrower sees within 15 feet, a failed Dexterity save leaves it Restrained, escaped with a DC 10 Strength (Athletics) check. The Net is an object with AC 10 and 5 Hit Points, immune to Bludgeoning damage, and an attack that breaks it frees the creature (objects.ts)."
  ),
  "item:thieves-tools": guided(
    "door.use's pick rolls a Dexterity (Sleight of Hand) check with the tools against a lock on a door of the map, DC 15 unless the GM sets another, and unlocks it on a success (doors.ts). It takes the Utilize action in a fight. Disarming a trap is the GM's."
  ),
  "item:carpenters-tools": guided(
    "door.use pries a door on the map open, or seals a closed one, with a DC 20 Strength check with the tools (doors.ts). A sealed door is forced open at DC 20. Crafting is the GM's."
  ),
  "item:smiths-tools": guided(
    "door.use pries a door on the map open with a DC 20 Strength check with the tools (doors.ts). Crafting is the GM's."
  ),
  "item:lock": enforced(
    "A door on the map can be locked (the GM's door editor): it stays shut against everyone but the creatures holding its key, and Thieves' Tools pick it with a DC 15 Dexterity (Sleight of Hand) check (doors.ts)."
  ),
  "item:portable-ram": enforced(
    "Forcing a door with door.use adds 4 to the Strength (Athletics) check while the creature carries the ram, and another creature beside the door helping gives Advantage (doors.ts)."
  ),
  "item:iron-spikes": enforced(
    "door.use's jam hammers one spike of the bundle into a closed door on the map, which then forces open only with a DC 15 Strength (Athletics) check (doors.ts)."
  ),
  "action:Giant Spider/web": enforced(
    "The DC 13 Dexterity save leaves a target Restrained, held by a web that is an object with AC 10, 5 Hit Points and Vulnerability to Fire damage. An attack that breaks it frees the target (objects.ts)."
  ),
  "action:Ettercap/web-strand": enforced(
    "The DC 12 Dexterity save leaves a target Restrained, held by a strand that is an object with AC 10, 5 Hit Points, Vulnerability to Fire damage and Immunity to Bludgeoning damage. An attack that breaks it frees the target (objects.ts)."
  )
};

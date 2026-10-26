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
    "resolution/attack.ts: its attack rolls have Disadvantage and attack rolls against it have Advantage. ability-checks.ts fails its Perception check to find a creature unless its Blindsight reaches it, and any check the GM marks as needing sight (check-rolls.ts, a call for a roll). It can't target a creature a spell or action needs it to see unless its Blindsight reaches it (resolution/spell-targets.ts, action-targets.ts, vision/rules.ts). movement-rules.ts: it makes an Opportunity Attack only against a mover in its Blindsight, and with dynamic vision on vision/sight.ts lets it see only within Blindsight."
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
    "resolution/attack.ts: Advantage on its attack rolls and Disadvantage on attack rolls against it, unless the other creature sees it (Blindsight, Truesight or See Invisibility within range, or the map with dynamic vision on) or Faerie Fire outlines it. A spell or action that needs a target its user sees can't pick it unless its user sees it the same way (resolution/spell-targets.ts, action-targets.ts). encounter.ts: Advantage on Initiative. movement-rules.ts: it provokes an Opportunity Attack only from a creature whose Blindsight or Truesight reaches it."
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
    "movement-rules.ts charges an extra foot per foot while it crawls, and actor-conditions.ts charges half its Speed to stand up and lets a creature drop Prone only on its own turn and not at Speed 0. resolution/attack.ts: Disadvantage on its attack rolls, and attack rolls against it have Advantage within 5 feet and Disadvantage beyond."
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
    "A door or wall on the map, and what holds a creature (a Net, a web, a rope), can be an object with an Armor Class, Hit Points and a damage threshold (objects.ts); the GM's door editor sets them from the substance and size tables. object.attack rolls a creature's attack against it (object-strikes.ts), an action that targets a creature or object (Acid, Alchemist's Fire, Oil) can be aimed at it, and a spell whose area harms objects (Shatter, Meteor Swarm) deals its damage to each one under the area; the object fails the save and takes all of it (resolution/object-targets.ts). object.damage deals the GM's damage. Poison and Psychic damage do nothing, and at 0 Hit Points a wall or door is gone and a held creature is freed. Objects the map doesn't hold (furniture, chests) and an object left burning are the GM's."
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
    "carrying.ts weighs a character's or stat block's rows and coins (fifty to the pound), what its containers hold counted as each weighs it (containers.ts), against its Strength times its size's figure, one size up with Powerful Build or Beast of Burden. speed.ts holds its Speed to 5 feet while it carries more, up to twice that, and to 0 beyond it; the Gear tab shows the load. Dragging, lifting or pushing something it doesn't carry is the GM's."
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
    "With dynamic vision on, cover.ts works out Half, Three-Quarters and Total Cover from the walls between the attacker, or a placed area's point of origin (resolution/pending.ts), and each target, and Half Cover from a creature in the way; a spell's wall gives the cover its text names against an attack or a picked target (Blade Barrier's Three-Quarters, zone-walls.ts), and the GM can mark more. The server adds 2 or 5 to AC and Dexterity saves, and resolution/validate.ts refuses any picked target behind Total Cover, each of a spell's several targets included, or across a sphere of force (enclosures.ts). Cover from what the map doesn't hold (furniture, a low wall drawn as a full one) is the GM's mark."
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
    "The GM paints difficult terrain on the map (terrain.ts), and movement-rules.ts charges double through it, through an enemy's space and, with dynamic vision on, through an opening sized for a creature one size smaller, which a narrower gap bars (footprintStepPassage in rules-5e): a Small or Medium creature squeezes through a gap half a square to three quarters of one wide. The map's drag preview charges the same path (movePreview.ts). Freedom of Movement ignores it."
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
  "heroic-inspiration": enforced(
    "held-rolls.ts spends it to reroll the d20 of an attack, a check, a save (a pending one or a loose one from the sheet) or a death save while the roll is shown, initiative-reroll.ts an initiative die before the character's first turn, and resolution/held-damage.ts one die of an action's damage or healing looked at before it counts, a hit's extras (Sneak Attack, a smite) included. rests.ts rerolls the lowest die of a Hit Point Dice spend. Only the GM gives it by hand. rests.ts gives it to a Human on a Long Rest, and turn-boundaries.ts to a Champion at the start of its turn. A character who gains a second one passes it to a player character without it or lets it go (heroic-inspiration.ts). The damage dice of a reaction's strike are the GM's to reroll."
  ),
  hide: enforced(
    "resolution/builtins.ts rolls a DC 15 Dexterity (Stealth) check and makes the creature Invisible on a success, until it makes an attack roll or casts a spell with a Verbal component (resolution/release.ts), or an enemy's Search meets its total; a throw that asks for a save (a Net, a flask) keeps it hidden. With dynamic vision on, resolution/validate.ts asks that it be Heavily Obscured or behind Three-Quarters or Total Cover and out of every enemy's sight (vision/rules.ts). A sound louder than a whisper is the GM's call."
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
  "improvised-weapons": enforced(
    "builtin-actions.ts and resolution/builtins.ts give every creature an improvised swing and throw: 1d4 plus Strength of a damage type the attacker picks, with no Proficiency Bonus, thrown 20/60. A carried weapon swings or flies as an improvised weapon too (item-actions.ts), and one thrown leaves the hand to be picked up (ammunition.ts). Treating a table leg as a Club is the GM's."
  ),
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
    "With dynamic vision on, vision/sight.ts knows Lightly Obscured points (Dim Light, a painted light fog or foliage area), and ability-checks.ts gives a Perception check to find a creature there Disadvantage: a check naming it, and the Search action, whose one roll is read against each hidden creature with the lower of two d20s where that creature is Lightly Obscured (resolution/builtins.ts). A Passive Perception compared with a Hide total is 5 less."
  ),
  line: areaShape("a Line has a fixed width, and the point it starts from isn't in it."),
  "long-jump": enforced(
    "jumping.ts lets a jump cover up to the Strength score with 10 feet moved this turn before it, half from a standing start, a foot of movement for each foot, and rolls the DC 10 Dexterity (Acrobatics) check on a landing in Difficult Terrain. Clearing a low obstacle is the GM's."
  ),
  "long-rest": enforced(
    "rests.ts needs 1 Hit Point and 16 hours since the last one. It restores Hit Points, Hit Point Dice, spell slots and uses, removes a level of Exhaustion and ends what lasts until a Long Rest. The party's Long Rest stays open from the game clock's time until the GM finishes it, which moves the clock 8 hours and counts down every effect (long-rest.ts, game-time.ts). Rolling Initiative, taking damage or casting a spell above a cantrip interrupts a member's rest, and the GM interrupts one for an hour of walking or exertion (rest-interruptions.ts): after an hour of rest it gets a Short Rest's benefits and may spend Hit Point Dice, and resuming adds an hour per interruption. A Long Rest the GM grants one character at once has no span to interrupt."
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
    "Doors and walls on the map, and the nets, webs and ropes that hold creatures, can carry an object's Armor Class and Hit Points (objects.ts). An object takes damage from attacks (object.attack), and it fails every saving throw: an action aimed at it, or the area of a spell that harms objects, deals it the whole of its damage (resolution/object-targets.ts)."
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
    "resolution/builtins.ts rolls the chosen Wisdom check. With dynamic vision on, a Perception search finds each hidden creature in its line of sight whose Hide total it meets and ends its hiding, read with Disadvantage against one Lightly Obscured to the searcher and Advantage against one its Hunter's Mark marks. The GM sets the DC of an Insight, Medicine or Survival search and says what the creature finds, and with dynamic vision off who the searcher can see is the GM's."
  ),
  "shape-shifting": enforced(
    "transform/assume.ts takes a form as an effect on the creature: a stat block's statistics replace its own, with what the effect says it keeps (transform/compose.ts), or one of its printed forms changes its size and speeds. Its Hit Points stay its own, conditions and effects carry over, and the token takes the form's size (transform/forms.ts). It reverts when the effect ends or it dies (transform/rules.ts)."
  ),
  "short-rest": enforced(
    "rests.ts needs 1 Hit Point, lets Hit Point Dice be spent, gives back what a Short Rest restores and ends what lasts until one. The party's Short Rest moves the game clock an hour when the GM finishes it. rest-interruptions.ts ends it for anyone who rolls Initiative, takes damage or casts a spell above a cantrip."
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
    "resolution/spell-targets.ts holds a spell to the number of targets it names (more with a higher slot), the ones the caster can see (vision/rules.ts, with dynamic vision on or off), its range, and for creatures of the caster's choice in an area, to those inside it; resolution/validate.ts refuses one behind Total Cover. A target of a type the spell can't affect is unaffected and the slot is spent, and its player isn't told the type (resolution/type-gates.ts)."
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
    "Within its range vision/sight.ts lets a creature see Invisible creatures and into normal and magical Darkness, and attack rolls read it, by the distance between the tokens with dynamic vision off. It succeeds with no roll on its saves against a visual illusion (Phantasmal Force, Phantasmal Killer, Hypnotic Pattern) cast within its range (resolution/pending.ts). True forms and the Ethereal Plane are the GM's."
  ),
  "unarmed-strike": enforced(
    "resolution/builtins.ts rolls the strike for 1 plus Strength Bludgeoning damage, or the grapple or shove save against 8 plus Strength plus the Proficiency Bonus; a failed save against the Shove's push moves the target 5 feet away."
  ),
  unconscious: condition("unconscious"),
  "unoccupied-space": enforced("movement-rules.ts ends a move only in a space no other creature fills."),
  utilize: guided(
    "In a fight the Utilize action takes the user's action on its own turn, and outside one it takes nothing. A Shield donned or doffed (held-items.ts), a door worked on (doors.ts) and a tool's or gear's Utilize use from the sheet (tool-uses.ts) take it, and a use needs the item in the pack. One object interaction a turn is free: drawing a weapon, opening a door or taking a thing out of a container, and a second takes the Utilize action (object-interactions.ts). What the object does is the GM's."
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
/** What every tool's Utilize uses do on the sheet. */
const TOOL_USES =
  "The sheet rolls its check with the ability it names and offers its Utilize uses at their printed DCs; a use rolled in a fight takes the Utilize action and needs the tool in the pack (tool-uses.ts).";
/** A tool with a Craft line: its uses, and crafting.ts making what the line lists. */
const toolCraft = guided(
  `${TOOL_USES} crafting.ts makes what its Craft line lists in downtime, for half the price in raw materials and a day of 8 hours per 10 GP, helpers with the proficiency dividing the days. What a check finds is the GM's.`
);
/** A tool with no Craft line: its uses, and what the check finds or makes. */
const toolCheck = (what: string) => guided(`${TOOL_USES} What the check finds or makes (${what}) is the GM's.`);
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
  "Aberrant Ground": enforced(
    "zone-ground.ts makes the ground within 10 feet of the mouther Difficult Terrain for every other creature, and it moves with the mouther; the move preview shows it round a mouther the mover can see (zone-preview.ts)."
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
  "Beast of Burden": enforced(
    "carrying.ts counts the creature one size larger for its carrying capacity, and weighs what its inventory holds against it."
  ),
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
  "Corrosive Form": enforced(
    "resolution/struck.ts deals the black pudding's 1d8 Acid damage to a creature that hits it with a melee attack (the gray ooze's printing deals none), and gives a nonmagical weapon that damages it a cumulative -1 to attack rolls, destroyed at -5 (row-penalties.ts; Mending removes it, resolution/mend.ts). Nonmagical ammunition that hits and damages it is destroyed, so none of it is found after the fight (resolution/ammunition.ts). Eating through wood or metal is the GM's."
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
  "Draconic Origin": enforced(
    "The GM picks the damage type once for each half-dragon from its row tools (statblock-picks.ts, PickControl). Its Dragon's Breath and its Claw's 2d6 deal that type every time, and an unpicked one asks for the pick first."
  ),
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
  "Incorporeal Movement": enforced(
    "terrain.ts passes it through walls and creatures as Difficult Terrain, and a wall a spell raised (Wall of Force) still stops it. A creature whose space a wall, a closed door or a window crosses as its turn ends is inside an object and takes 1d10 Force damage, rolled by the server (wall-passage.ts)."
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
  "Spell Storing": enforced(
    "stored-casts.ts stores a spell of the printed level or lower that the creature commanding it casts on it from within 5 feet, losing any spell stored before; the spell has no other effect. The guardian's sheet then casts it once at the caster's spell save DC, attack bonus and modifier, with no components."
  ),
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
  Training: enforced(
    "The GM picks the skill for each creature from its row tools (statblock-picks.ts). ability-checks.ts adds its Proficiency Bonus to checks with that skill and rolls them with Advantage."
  ),
  Transparent: reference("Noticing the cube is the GM's call, with the DC the trait prints."),
  "Treasure Sense": senses,
  "Troll Spawn": reference("What becomes of a severed limb is the GM's to run."),
  Tunneler: enforced(
    "A burrowing move passes it through the map's walls at double cost, as through solid rock (terrain.ts, wall-passage.ts), and a wall a spell raised still stops it. Where it burrowed through a wall, a lasting 10-foot gap is left that sight and movement pass (wall-passage.ts)."
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
  "spell:geas": enforced(
    "A failed Wisdom save leaves the target Charmed for the spell's duration at its slot (resolution/pending.ts). When it acts directly counter to the command, the GM deals it the 5d10 Psychic damage, which a player can't take, at most once a day of game time (lasting-spells.ts, use-pools.ts). Remove Curse ends it, and Greater Restoration ends it as that spell's own row says. Whether the creature defies or understands the command is the GM's."
  ),
  "spell:detect-thoughts": guided(
    "The cast holds Concentration and opens no save; its player is shown the minds (Intelligence 4 or more) within 30 feet, not through a wall (vision/detect.ts). On a later turn a Magic action probes the target's mind: it makes the Wisdom save, and a success ends the spell; on a failure it may take an action for an Intelligence (Arcana) check against the spell save DC, which ends the spell (lasting-spells.ts, ending-actions.ts, spell-endings.ts). What the caster reads in a mind is the GM's."
  ),
  "spell:ensnaring-strike": enforced(
    "The hit's target makes the Strength save, with Advantage if Large or larger, or is Restrained while the caster concentrates, taking 1d6 Piercing, 1d6 more a slot level, at the start of each of its turns (resolution/pending.ts, turn-boundaries.ts). It, or a creature within reach of it with End an Effect, breaks free with a Strength (Athletics) check against the spell save DC (ending-actions.ts)."
  ),
  "spell:contingency": enforced(
    "The cast takes 10 minutes and needs the 1,500 GP statuette (resolution/components.ts). The next spell of level 5 or lower with a casting time of an action that can target its caster, cast within the minute, is held for the 10 days at its slot and its caster's numbers, both slots spent (stored-casts.ts); casting Contingency again replaces it. When the trigger happens its sheet releases it on the caster alone with no action, which ends Contingency, and the release is refused once the statuette isn't carried. Judging whether the described trigger has happened is the caster's player's or the GM's."
  ),
  "item:ring-of-spell-storing": enforced(
    "Held out (no action), the ring takes the next spell of level 1 through 5 cast at its wearer or by it within a minute, at its caster's slot level, spell save DC, attack bonus and modifier, if the levels it holds stay at 5 or fewer; a spell that doesn't fit is lost. The attuned wearer casts each held spell from its sheet at those numbers, freeing its space (stored-casts.ts). The GM sets what a found ring holds on its row; a player sees the held spells once attuned (projections.ts)."
  ),
  "spell:dream": guided(
    "The caster, as the messenger, is Incapacitated with Speed 0 in its trance for the 8 hours, and ending that effect ends the spell (resolution/grant.ts). A terrifying messenger's message has the target make the Wisdom save, in a fight or out of one; a failure denies it the benefit of its next Long Rest and deals 3d6 Psychic damage as it wakes (lasting-spells.ts, rest-triggers.ts). A willing creature touched as the messenger in the caster's place, the dream itself and the conversation are the table's, and the target is often off the map."
  ),
  "spell:heat-metal": enforced(
    "The cast and each later Bonus Action deal 2d8 Fire, 1d8 more a slot level above 2, to the creature holding or wearing the heated object, which then makes the Constitution save to keep hold (resolution/pending.ts). The object is the metal weapon it holds, else the metal armor it wears: a failure drops a held weapon, still carried (effects.ts), and one that can't drop its armor has Disadvantage on attack rolls and ability checks until the start of the caster's next turn, as a creature that keeps hold does. An unattended metal object, and who else touches it, are the GM's."
  ),
  "spell:teleport": guided(
    "The caster picks how familiar the destination is as it casts, and the server rolls the d100 on the Teleportation Outcome table (resolution/teleport-outcome.ts): a Mishap deals 3d10 Force damage to the caster and each creature it takes and rolls again, Off Target rolls the 2d12 miles and the d8 direction, and Similar Area and On Target are told to the table. Where the destination is, the travellers leaving the map and the scene they arrive in are the GM's."
  ),
  "spell:identify": guided(
    "The cast or its Ritual takes a minute and needs a 100 GP pearl (resolution/components.ts). Cast on an item its caster carries, it marks the copy identified (resolution/identify.ts), so its player's sheet shows the kind and the type the GM set without attuning (projections.ts), and no sheet write can set or clear the mark (inventory.ts). A creature's ongoing spells, and objects off the sheet, are the GM's to tell."
  ),
  "spell:wish": guided(
    "The cast picks its use (resolution/wish.ts). Instant Health restores the caster and the creatures it picks to all their Hit Points; Resistance gives up to ten creatures it picks lasting Resistance to the type chosen; Spell Immunity marks up to ten for 8 hours. Any use but duplicating a spell stresses the caster: each spell it casts until a Long Rest deals it 1d10 per spell level that nothing reduces, the 2d4 days of Strength 3 are marked, and the server rolls the 33 percent chance, after which a Wish cast is refused (resolution/economy.ts). Which spell a Wish duplicates and its cast, the conditions Instant Health ends, the spell Spell Immunity names, the Strength score itself, Sudden Learning's feat, Roll Redo, Object Creation and Reshape Reality are the GM's."
  ),
  "spell:arcane-hand": enforced(
    "The hand appears within 120 feet with AC 20 and the caster's Hit Point maximum, and the spell ends when it drops to 0 (summons.ts). The cast and each later Bonus Action move it up to 60 feet and cause one effect, the cast's at no further cost (lasting-spells.ts): Clenched Fist's attack (5d8 Force, 2d8 more a slot level above 5) and the saves reach from the hand (summon-strikes.ts); Forceful Hand pushes a Huge or smaller creature that fails its Strength save 5 feet plus five times the spellcasting modifier, the hand following (saving-throws.ts); Grasping Hand grapples a Huge or smaller creature that fails its Dexterity save, escaped against the spell save DC, and only that creature can be crushed (4d6 plus the modifier, 2d6 more a slot level above 5); Interposing Hand gives the caster Half Cover from or through its space, which is Difficult Terrain for the caster's enemies (cover.ts, zone-ground.ts)."
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
  "spell:floating-disk": guided(
    "The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. The disk is a marker within 30 feet that stays put while its caster is within 20 feet and follows to stay within 20 feet as it moves away, ending more than 100 feet apart (summons.ts). What it carries, its 500-pound limit and an elevation change of 10 feet it can't cross are the GM's: its load isn't a container."
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
    "Opened the first time, an Efreeti appears within 30 feet and the server rolls the d10, which settles the bottle (summons.ts): on a 1 it attacks its user and leaves after 5 rounds, on a 10 it stays up to an hour to grant a Wish, and either way the bottle's magic is gone; on 2 to 9 it obeys for 1 hour and the bottle holds a servant from then on, which comes twice more, each opening 24 hours after it returns (clock-pools.ts), and then the bottle is spent. What the Wish does is the GM's."
  ),
  "item:feather-token": guided(
    "The GM says which token a found one is (item-records.ts). The Bird token is used up for a Roc that can't attack and obeys its user until it is dismissed with a Magic action or drops to 0 Hit Points (summons.ts). The Anchor, Fan, Swan Boat, Tree and Whip are the GM's."
  ),
  "item:figurine-of-wondrous-power": guided(
    "The GM says which figurine a found one is (item-records.ts): its creature appears within 60 feet for its time, acts right after its user and defends itself when uncommanded, and a Magic action turns it back (summons.ts). Its days of waiting start when it reverts (clock-pools.ts), each Golden Lion and each Ivory Goat on its own; the Goat of Traveling spends an hour or part of one each time from its 24 and waits only once they are spent. The Goat of Terror can't attack, the Onyx Dog has Blindsight 60 feet, the Silver Raven offers Animal Messenger, and the Obsidian Steed's d10 shows 1 one time in ten, leaving it under no one's command. The Goat of Terror's horns and fear, the steed refusing to revert and its ride to Hades are the GM's."
  ),
  "item:ring-of-djinni-summoning": enforced(
    "The djinni appears within 120 feet while its wearer keeps Concentration, up to 1 hour, defending itself when uncommanded (summons.ts); clock-pools.ts holds the ring for 24 hours from when it departs, and the ring loses its magic if the djinni dies (item-spent.ts)."
  ),
  "item:staff-of-the-python": enforced(
    "Thrown within 10 feet, it becomes a Giant Constrictor Snake that acts right after its user, commanded within 60 feet and defending itself otherwise; a Bonus Action turns it back (summons.ts, summon-orders.ts), and the staff then waits an hour (clock-pools.ts). The snake dying shatters the staff (item-spent.ts)."
  ),
  "item:staff-of-swarming-insects": enforced(
    "Insect Cloud fills a 30-foot Emanation that is Heavily Obscured for everyone but its holder for 10 minutes (vision/cast-sight.ts). Giant Insect costs 4 charges and brings the insect (summons.ts), and Insect Plague costs 5. A strong wind dispersing the cloud is the GM's."
  ),
  "action:Aboleth/dominate-mind": enforced(
    "The DC 16 Wisdom save and Charmed are applied, and a failure puts the target under the aboleth's command and on its side (summons.ts) while it is within 60 feet of the aboleth, its player acting for it beyond that; it repeats the save whenever it takes damage, and the domination ends when the aboleth dies or either is on another plane (save-stages.ts, off-plane.ts). The telepathic talk and the save after each day spent a mile away are the GM's."
  ),
  "action:Treant/animate-trees": enforced(
    "Two trees animate within 60 feet from the Treant stat block with Intelligence and Charisma 1 and no Animate Trees, under the treant's command and on its side, acting right after it (summons.ts). They stop after a day, at 0 Hit Points, when the treant dies or more than 120 feet from it. Which trees stand where is the GM's."
  ),
  // Moves, jumps, teleports and leaving the plane (granted-moves.ts, jumping.ts, off-plane.ts, time-stop.ts).
  "spell:misty-step": enforced(
    "granted-moves.ts gives the caster a 30-foot teleport for the turn, which movement-rules.ts takes at once to an unoccupied space it can see and refuses beyond its range."
  ),
  "spell:dimension-door": enforced(
    "granted-moves.ts gives the caster a 500-foot teleport for the turn to any space, seen or not, and one willing creature within 5 feet named at the cast goes too, arriving in an unoccupied space within 5 feet of the caster's (teleport-company.ts). Arriving where a creature stands, or with no space for the passenger, fails for both and deals each 4d6 Force damage. A destination off this map is the GM's to place."
  ),
  "spell:jump": enforced(
    "Each target can leap up to 30 feet for 10 feet of movement once on each of its turns for 1 minute (jumping.ts)."
  ),
  "spell:levitate": enforced(
    "A creature on the caster's side rises 20 feet with no save, and any other creature only on a failed Constitution save (falling.ts); while levitating it moves only as if climbing (altitude.ts), and it floats gently down when the spell ends. On the caster's turn a Magic action raises or lowers it 20 feet, kept within 60 feet of the caster, and a caster levitating itself rises or sinks as part of its move with no action (resolution/later-steps.ts). A smaller change of height is set with the GM's height control, and a levitated object has no token, so it is the GM's."
  ),
  "spell:banishment": enforced(
    "A failed Charisma save Incapacitates the target and takes it off the map while the caster concentrates (off-plane.ts), one more target a slot level; it returns to the space it left or the nearest unoccupied one, and an Aberration, Celestial, Elemental, Fey or Fiend still gone when the full minute is up leaves the fight instead. Where on its plane it lands is the GM's."
  ),
  "spell:etherealness": enforced(
    "The caster, and two more willing creatures within 10 feet for each slot level above 7, step onto the Border Ethereal for up to 8 hours until the caster ends it: their tokens stay on the map, unseen but by Truesight or See Invisibility, out of reach of the creatures on the plane both ways, moving in any direction through walls and creatures, each foot up or down costing an extra foot (ethereal.ts, movement-rules.ts). Each returns where its token stands, shunted to the nearest unoccupied space with 2 Force damage a foot from a filled one (off-plane.ts). What it perceives of the plane it left is description."
  ),
  "spell:blink": enforced(
    "The server rolls the d6 as the caster's turn ends; on a 4 or more the caster steps onto the Border Ethereal until the start of its next turn, its token kept on the map, unseen but by Truesight or See Invisibility and out of reach (ethereal.ts). It returns where it stood, the nearest unoccupied space from a filled one, and may then teleport to an unoccupied space it sees within 10 feet (off-plane.ts, granted-moves.ts). What it perceives of the plane it left is description."
  ),
  "spell:maze": enforced(
    "The target leaves the map while the caster concentrates (off-plane.ts) and returns to the space it left or the nearest unoccupied one. It may take an action for a DC 20 Intelligence (Investigation) check, which ends the spell on a success (resolution/builtins.ts)."
  ),
  "spell:imprisonment": guided(
    "A failed save takes the target off the map until the GM ends the spell (off-plane.ts). The form of the prison, the 24 hours of immunity on a success and the ending trigger are the GM's."
  ),
  "spell:time-stop": enforced(
    "time-stop.ts rolls 1d4 + 1 and gives the caster that many turns in a row; an action of its that targets another creature, or a move more than 1,000 feet from where it cast the spell, ends it. A spell area the caster made during it that later acts on another creature ends it too (spell-zones.ts), a burst included."
  ),
  "item:boots-of-striding-and-springing": guided(
    "Its wearer's Speed is at least 30 feet and armor's Strength requirement takes none of it (speed.ts), and the once-a-turn leap of 30 feet for 10 feet of movement is applied (jumping.ts). Carried weight is the GM's."
  ),
  "item:boots-of-levitation": enforced(
    "The action levitates the wearer with no save for up to 10 minutes on its Concentration (effects.ts), which damage, another Concentration spell or Incapacitation ends: it rises 20 feet, moves only as if climbing, and floats down when the levitation ends (falling.ts)."
  ),
  "item:wings-of-flying": enforced(
    "The action gives a Fly Speed of 60 feet for an hour, or until the wearer ends it on the sheet; a creature in the air when it ends falls (falling.ts). clock-pools.ts keeps the wings from being used again until 1d12 + 1 hours of game time have passed from their use (the hour they last, then the wait)."
  ),
  "item:broom-of-flying": enforced(
    "The action gives the rider a Fly Speed of 50 feet with hover, which ends when it lands (falling.ts) or when it gets off on the sheet. Its slower 30 feet while it carries over 200 pounds needs the rider's body weight, which no sheet records, and sending it alone to a place within a mile is story."
  ),
  "item:cape-of-the-mountebank": enforced(
    "Its Dimension Door, once a dawn, teleports the wearer on the map with a willing creature beside it (granted-moves.ts, teleport-company.ts) and leaves the space it left Lightly Obscured until the end of its next turn (vision areas)."
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
  "action:Mummy Lord/whirlwind-of-sand": enforced(
    "resolution/pending.ts offers it on every hit, and one answer raises the mummy's AC by 2 against that attack, which may then miss, and grants its 60-foot teleport (reactions.ts, granted-moves.ts). Landing Blinds each enemy the mummy sees within 5 feet of its destination until the end of the mummy's next turn (granted-moves.ts); its allies are left out as the creatures it wouldn't choose."
  ),
  "action:Balor/teleport": enforced(
    "A 60-foot teleport is granted to the balor, or to the one demon within 10 feet it names instead (resolution/movement-grants.ts, resolution/action-targets.ts). Whether that demon is willing is its player's or the GM's."
  ),
  "action:Phase Spider/ethereal-jaunt": enforced(
    "The spider steps onto the Border Ethereal as a Bonus Action: its token stays on the map, unseen but by Truesight or See Invisibility, out of reach of the creatures on the plane, moving through walls and creatures (ethereal.ts); the next Ethereal Jaunt brings it back where its token stands, the nearest unoccupied space from a filled one (off-plane.ts)."
  ),
  "action:Nightmare/ethereal-stride": enforced(
    "The nightmare and up to three willing creatures within 5 feet (its side) step onto the Border Ethereal: their tokens stay on the map, unseen but by Truesight or See Invisibility, out of reach of the creatures on the plane, moving through walls and creatures (ethereal.ts). The next Ethereal Stride brings them back where their tokens stand, the nearest unoccupied space from a filled one (off-plane.ts)."
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
  "spell:light": enforced(
    "The object touched, held by the caster or a creature on its side, sheds Bright Light 20 feet and Dim Light 20 feet more for the hour, and moves with its holder; casting it again ends the earlier light (vision/cast-sight.ts). An enemy's object is refused (resolution/spell-targets.ts). An object no one holds, and covering the light, are the table's."
  ),
  "spell:continual-flame": enforced(
    "The object touched, held by the caster or a creature on its side, sheds Bright Light 20 feet and Dim Light 20 feet more until dispelled, and moves with its holder (vision/cast-sight.ts); an enemy's object is refused (resolution/spell-targets.ts). It consumes 50 GP of ruby dust (resolution/components.ts). An object no one holds, and covering the flame, are the table's."
  ),
  "spell:animal-messenger": guided(
    "Only a Tiny Beast the caster can see within 30 feet is affected: a larger creature is refused, and a creature of another type is unaffected though the slot is spent (resolution/spell-targets.ts, resolution/type-gates.ts). One whose Challenge Rating isn't 0 succeeds on the Charisma save with no roll (resolution/pending.ts). The message, the journey and its longer duration from a higher slot are the GM's."
  ),
  "spell:awaken": enforced(
    "Only a Beast or a Plant with an Intelligence of 3 or less is affected, and any other creature isn't, though the cast is spent (resolution/type-gates.ts). The cast takes its 8 hours and consumes the agate (resolution/components.ts). The target's Intelligence becomes 10 for good, and it is Charmed by the caster for 30 days or until the caster or an ally damages it (resolution/inflicts.ts). Its language, a natural plant's statistics and its attitude after are the GM's."
  ),
  "spell:seeming": guided(
    "Each creature the caster picks that it can see within 30 feet takes the disguise: one on the caster's side with no save, any other only on a failed Charisma save (resolution/pending.ts). The disguises and their 8 hours are the GM's."
  ),
  "spell:nondetection": enforced(
    "The caster or a creature on its side that it touches can't be the target of a Divination spell for 8 hours, nor be caught in one's area or sensed by one (resolution/spell-wards.ts). It consumes 25 GP of diamond dust (resolution/components.ts). Hiding a place or an object, and scrying sensors, are the GM's."
  ),
  "spell:arcanists-magic-aura": enforced(
    "Mask gives the caster or a creature on its side the creature type the caster picks for 24 hours, which spells and other magical effects read wherever they check a type (statblock-facts.ts creatureTypeOf); a skill check and a stat block's own traits read the true one. False Aura on an object, and making it last, are the GM's."
  ),
  "spell:mage-hand": enforced(
    "The hand appears as a token at a point within 30 feet (summons.ts); a Magic action moves it up to 30 feet (summon-orders.ts), and it vanishes more than 30 feet from the caster or when the spell is cast again. Aimed at a door on the map within 30 feet, it opens or shuts an unlocked one (resolution/cast-walls.ts), and a door held shut stays shut. What else it handles is the GM's."
  ),
  "spell:mending": castOnly("The repair is the GM's."),
  "spell:message": castOnly("The whisper and its reply are the table's."),
  "spell:prestidigitation": guided(
    "The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. Fire Play lights or puts out a flame within 10 feet: a light the GM set on the map, or the burning light a targeted creature carries (resolution/cast-lights.ts). The sensory effects, cleaning, marks, flavours and trinkets are the GM's, with up to three lasting at once."
  ),
  "spell:shillelagh": enforced(
    "The cast binds to the Club or Quarterstaff the caster picks (resolution/grant-extras.ts): its attack and damage rolls use the better of Strength and the spellcasting ability, its die becomes a d8 (d10 at level 5, d12 at 11, 2d6 at 17), and a hit deals Force or its own type (item-actions.ts). Casting it again moves it, and it ends once the weapon leaves the pack (bound-weapons.ts)."
  ),
  "spell:thaumaturgy": enforced(
    "The cast keeps the wonder picked for a minute (resolution/grant-extras.ts), and Booming Voice gives Advantage on Intimidation checks (ability-checks.ts). Aimed at a door on the map within 30 feet, Invisible Hand flings an unlocked door open or slams it shut (resolution/cast-walls.ts). What the other wonders look and sound like is the GM's."
  ),
  "spell:true-strike": enforced(
    "The cast binds a carried weapon the caster is proficient with and leaves its Magic action open for one attack with that weapon, which uses the spellcasting ability for the attack and damage rolls, deals Radiant or the weapon's own type as the caster picks, and adds 1d6 Radiant at level 5, 2d6 at 11 and 3d6 at 17; the binding ends with that attack (resolution/grant-extras.ts, resolution/true-strike.ts)."
  ),
  "spell:spare-the-dying": enforced(
    "The cast makes a creature at 0 Hit Points Stable with no check (resolution/stabilize.ts), within 15 feet, 30 at level 5, 60 at level 11 and 120 at level 17 (resolution/spell-targets.ts)."
  ),
  "item:tinderbox": enforced(
    "item-light.ts lights a Candle, Lamp, Lantern or Torch in hand only when its bearer holds a Tinderbox or another flame, spending its Bonus Action in a fight, and its Bonus Action lights oil spilled within 5 feet (zone-kindling.ts). Lighting any other fire, which takes a minute, is the GM's."
  ),
  "item:oil": enforced(
    "Thrown in place of an attack at a creature or object within 20 feet: a creature makes the Dexterity save or is covered in oil, and Fire damage it takes in the next minute is 5 more (hazards.ts); a door or a wall on the map that is an object is covered with no save, and so takes 5 more from Fire (resolution/object-targets.ts, objects.ts). Poured as the Utilize action over a 5-foot square within 5 feet, it lies unlit until Fire damage or a fire's area reaches it, a burning creature stands in it, or a Tinderbox lights it; then it deals 5 Fire damage to a creature that enters it or ends its turn there, once a turn, and burns out at the end of the turn 2 rounds later (zone-kindling.ts, zone-fire.ts). Its 6 hours as fuel in a Lamp or Lantern burn down on the game clock (item-light.ts)."
  ),
  "item:healers-kit": enforced(
    "stabilize.ts spends one of the kit's ten uses to make a creature at 0 Hit Points Stable with no check, and spending the tenth takes the kit. The Gear tab shows the uses left in it."
  ),
  "item:chain": enforced(
    "Its action binds a creature within 5 feet that is Grappled, Incapacitated or Restrained after a DC 13 Strength (Athletics) check (resolution/check-first.ts): the creature is Restrained until a DC 18 Dexterity (Acrobatics) check frees it, or a DC 20 Strength (Athletics) check bursts the Chain, either one its action (resolution/endings.ts)."
  ),
  "item:rope": enforced(
    "Its action binds a creature within 5 feet that is Grappled, Incapacitated or Restrained: the creature is Restrained until a DC 15 Dexterity (Acrobatics) check frees it or a DC 20 Strength (Athletics) check bursts the Rope, either one its action (resolution/endings.ts). Its Utilize use ties a knot with a DC 10 Dexterity (Sleight of Hand) check (tool-uses.ts)."
  ),
  "item:manacles": enforced(
    "Its action binds a Small or Medium creature within 5 feet that is Grappled, Incapacitated or Restrained after a DC 13 Dexterity (Sleight of Hand) check (resolution/check-first.ts): it has Disadvantage on attack rolls, and is Restrained too when the binder fixes the chain in place. A DC 20 Dexterity (Sleight of Hand) check frees it, a DC 25 Strength (Athletics) check bursts them, and another creature with Thieves' Tools picks their lock with a DC 15 Dexterity (Sleight of Hand) check, each one an action (resolution/endings.ts)."
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
      "cartographers-tools",
      "cooks-utensils",
      "glassblowers-tools",
      "jewelers-tools",
      "leatherworkers-tools",
      "masons-tools",
      "painters-supplies",
      "potters-tools",
      "tinkers-tools",
      "weavers-tools",
      "woodcarvers-tools",
      "disguise-kit",
      "poisoners-kit"
    ].map((id) => [`item:${id}`, toolCraft])
  ),
  ...Object.fromEntries(
    ["gaming-set-dice", "gaming-set-playing-cards", "gaming-set-dragonchess", "gaming-set-three-dragon-ante"].map(
      (id) => [`item:${id}`, toolCheck("who cheats and who wins the game")]
    )
  ),
  ...Object.fromEntries(
    [
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
    ].map((id) => [`item:${id}`, toolCheck("how the tune or song lands")])
  ),
  "item:forgery-kit": toolCheck("how convincing the forgery is"),
  "item:navigators-tools": toolCheck("the course plotted and the position found"),
  "item:calligraphers-supplies": guided(
    `${TOOL_USES} crafting.ts makes Ink in downtime, and scribes a Spell Scroll of a spell the scribe has prepared on each day of work, at the Spell Scroll Costs table's days and gold, with the scribe's spell save DC and attack bonus. What a check finds is the GM's.`
  ),
  "item:herbalism-kit": guided(
    `${TOOL_USES} crafting.ts makes what its Craft line lists in downtime, and brews a Potion of Healing for 25 GP and a day of work. What a check finds is the GM's.`
  ),
  "item:cobblers-tools": guided(
    `${TOOL_USES} A success at modifying footwear gives its wearer Advantage on its next Dexterity (Acrobatics) check (help-assist.ts). crafting.ts makes a Climber's Kit in downtime. Hiding a compartment in a boot heel is the GM's.`
  ),
  "item:grappling-hook": guided(
    "Its Utilize use rolls a DC 13 Dexterity (Acrobatics) check to catch the hook, taking the action in a fight (tool-uses.ts). Whether something within 50 feet can hold it is the GM's."
  ),
  "item:bead-of-nourishment": enforced(
    "It is a day's food: while the GM tracks food and water, a character eats one from its pack (actor.nourish), and survival.ts eats the beads it carries as the game day ends, after its Rations."
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
    "builtin-actions.ts offers an Unarmed Strike as a Bonus Action, resolution/attack.ts rolls Unarmed Strikes and Monk weapons with the Martial Arts die and the better of Strength and Dexterity, and the Unarmed Strike's Grapple and Shove use the better of them for their DC (resolution/builtins.ts)."
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
  "feature:heightened-focus": enforced(
    "Flurry of Blows makes three strikes from Monk level 10 (Monk's Focus carries it), and the paid Patient Defense gives Temporary Hit Points of two Martial Arts dice (character-build.ts). After Step of the Wind's Dash, the Monk's own turn offers to carry a willing ally within 5 feet, Large or smaller: the Monk's moves on the map take it along as a drag does, which provokes no Opportunity Attacks, until the turn ends (movement-rules.ts)."
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
  "feature:elf-trance": enforced(
    "Magic can't put an elf to sleep: it succeeds without rolling against the Sleep spell and a brass dragon's Sleep Breath (resolution/pending.ts), and a magical sleep it fails into (Eyebite's Asleep) never lands (effects.ts). Its own Long Rest runs out 4 hours of its effects, and the party's Long Rest moves the clock 4 hours when every member holds Trance (rests.ts). Not needing sleep has no rule to read: the clock tracks no sleep."
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
  "feature:bardic-inspiration": enforced(
    "The Bonus Action gives another creature within 60 feet that can see or hear the Bard (resolution/action-targets.ts) the Bard's die, a d6 growing to a d12, one die at a time, for an hour of game time; roll-answers.ts offers it when that creature fails an attack roll, a save, a check or a death save, and the die is added and spent."
  ),
  "feature:uncanny-dodge": enforced(
    "When an attacker the Rogue can see hits it with an attack roll, damage-window.ts offers its Reaction to halve the attack's damage before it lands."
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
  "feature:deflect-attacks": enforced(
    "A hit whose damage includes Bludgeoning, Piercing or Slashing opens a reaction prompt (damage-window.ts), and using it takes 1d10 plus the Dexterity modifier and Monk level off the damage before it lands. The prompt lists the creatures the force may be redirected at (within 5 feet after a melee hit; seen within 60 feet and not behind Total Cover after a ranged one); one picked with the answer takes a Dexterity save against two Martial Arts dice plus the Dexterity modifier when the roll brings the damage to 0, for a Focus Point (deflect-redirect.ts)."
  ),
  "feature:deflect-energy": enforced(
    "character-build.ts lets Deflect Attacks meet a hit of any damage type from Monk level 13 (damage-window.ts)."
  ),
  "feature:superior-hunters-defense": enforced(
    "damage-window.ts offers it when the Ranger is about to take damage from a hit or a failed save. Using it gives Resistance to the damage's largest type, that damage included, until the end of the current turn."
  ),
  "action:Stone Giant/deflect-missile": enforced(
    "A ranged hit with Bludgeoning, Piercing or Slashing damage opens the giant's reaction prompt (damage-window.ts), and using it takes 1d10 + 6 off the damage, recharging on a 5 or 6. When nothing is left, the same answer turns its DC 17 Dexterity save, 11 (1d10 + 6) Force damage on a failure, on the creature the GM picks among those the giant sees within 60 feet, the attacker unless another is picked (reactions.ts)."
  ),
  "action:Rust Monster/reflexive-antennae": enforced(
    "triggered-reactions.ts offers it when an attack roll from a creature within 5 feet hits the rust monster, and using it resolves Antennae against that creature (reactions.ts)."
  ),
  // Stat-block actions whose printed riders, target rules and drop-to-0 clauses the readers carry (build-bundle.ts,
  // save-outcomes.ts), each a row the data pass would read as plain damage.
  "action:Half-Dragon/claw": enforced(
    "The hit's Slashing damage and 2d6 of the type picked for its Draconic Origin are applied (statblock-picks.ts); a half-dragon with no pick yet asks the GM for one first."
  ),
  "action:Giant Ape/boulder-toss": enforced(
    "The save's Bludgeoning damage is applied, half on a success, and a failure knocks a Large or smaller creature Prone (resolution/pending.ts); a bigger one takes the damage alone."
  ),
  "action:Gladiator/shield-bash": enforced(
    "The save's Bludgeoning damage is applied, and a failure knocks a Medium or smaller creature Prone (resolution/pending.ts); a bigger one takes the damage alone."
  ),
  "action:Ghoul/claw": enforced(
    "The hit's Slashing damage is applied, and its Constitution save opens only on a creature that is neither an Undead nor an elf (resolution/pending.ts), a failure leaving it Paralyzed until the end of its next turn."
  ),
  "action:Steam Mephit/steam-breath": guided(
    "The save's Fire damage is applied, half on a success, and a failure takes 10 feet off the target's Speed until the end of the mephit's next turn (saving-throws.ts). Underwater, hit-points.ts still gives the Fire damage Resistance, which the breath ignores; the GM gives that half back."
  ),
  "action:Adult Brass Dragon/scorching-sands": enforced(
    "The save's Fire damage is applied, and a failure halves the target's Speed until the end of its next turn (saving-throws.ts). The dragon takes it once until its next turn starts (resolution/economy.ts)."
  ),
  "action:Adult Black Dragon/cloud-of-insects": enforced(
    "The save's Poison damage is applied, and a failure gives the target Disadvantage on saves to keep Concentration until the end of its next turn (saving-throws.ts). The dragon takes it once until its next turn starts (resolution/economy.ts)."
  ),
  "action:Dretch/fetid-cloud-1-day": enforced(
    "Each creature in the Emanation saves, and a failure leaves it Poisoned until the end of its next turn, taking an action or a Bonus Action on its turn and no Reactions while it lasts (saving-throws.ts, resolution/economy.ts)."
  ),
  "action:Swarm of Ravens/cacophony": enforced(
    "A failure leaves the target Deafened until the start of the swarm's next turn, with Disadvantage on ability checks and attack rolls while it lasts (saving-throws.ts)."
  ),
  "action:Ghost/horrific-visage": enforced(
    "The Cone's save reaches only a creature that sees the ghost and isn't an Undead (resolution/pending.ts, resolution/type-gates.ts). A failure deals the Psychic damage and Frightens it until the start of the ghost's next turn, and a success makes it immune for the fight."
  ),
  "action:Lich/disrupt-life": enforced(
    "The Emanation's save leaves out every Undead (resolution/type-gates.ts), and the Necrotic damage lands, half on a success. The lich takes it once until its next turn starts (resolution/economy.ts)."
  ),
  "action:Planetar/holy-burst": enforced(
    "The Sphere's save reaches only the planetar's enemies (commands/actions.ts), and the Radiant damage lands, half on a success."
  ),
  "action:Rakshasa/baleful-command": enforced(
    "The Emanation's save reaches only the rakshasa's enemies (commands/actions.ts). A failure deals the Psychic damage and leaves the target Frightened and Incapacitated until the start of the rakshasa's next turn."
  ),
  "action:Sphinx of Lore/mind-rending-roar": enforced(
    "The Emanation's save reaches only the sphinx's enemies (commands/actions.ts). A failure deals the Psychic damage and Incapacitates the target until the start of the sphinx's next turn."
  ),
  "action:Aboleth/consume-memories": enforced(
    "It targets one creature within 30 feet that is Charmed or Grappled by the aboleth (resolution/action-targets.ts), and the Psychic damage lands, half on a success. Gaining a Humanoid's memories is the story's."
  ),
  "action:Doppelganger/unsettling-visage": enforced(
    "The Emanation's save reaches only a creature that sees the doppelganger (resolution/pending.ts). A failure Frightens it, repeating the save at the end of each of its turns, and it succeeds on its own after 1 minute."
  ),
  "action:Kraken/toxic-ink": enforced(
    "resolution/economy.ts refuses it in a fight the GM hasn't marked as underwater. A failure leaves each creature in the Emanation Blinded and Poisoned until the end of the kraken's next turn, and the kraken gets its move (granted-moves.ts)."
  ),
  "action:Seahorse/bubble-dash": enforced(
    "resolution/economy.ts refuses it in a fight the GM hasn't marked as underwater; underwater it grants a swim of its Swim Speed that provokes no Opportunity Attacks (granted-moves.ts)."
  ),
  "action:Giant Seahorse/bubble-dash": enforced(
    "resolution/economy.ts refuses it in a fight the GM hasn't marked as underwater; underwater it grants a swim of half its Swim Speed that provokes no Opportunity Attacks (granted-moves.ts)."
  ),
  "action:Homunculus/bite": enforced(
    "The hit's damage is applied and its Constitution save opens. A failure leaves the target Poisoned until the end of the homunculus's next turn; a failure by 5 or more Poisons it for 1 minute, and Unconscious with it until it takes damage (save-margins.ts)."
  ),
  "action:Pseudodragon/sting": enforced(
    "A failure deals the Poison damage and Poisons the target for 1 hour. A failure by 5 or more also leaves it Unconscious while Poisoned, until it takes damage or a creature within 5 feet takes an action to wake it (save-margins.ts)."
  ),
  "action:Chain Devil/unnerving-gaze": enforced(
    "triggered-reactions.ts offers it when a creature that sees the devil, and that the devil sees, starts its turn within 30 feet of it; creatures of the devil's own side open no prompt. Using it opens the DC 15 Wisdom save: a failure Frightens the creature until that turn ends, and a success makes it immune to this devil's gaze for the fight (saving-throws.ts)."
  ),
  "action:Nalfeshnee/nalfeshnee-pursuit": enforced(
    "triggered-reactions.ts offers it when a creature the nalfeshnee sees ends a move within 120 feet of it (commands/map.ts, or a held move once it goes on). Using it grants its Teleport, which a destination within 10 feet of that creature takes (granted-moves.ts, movement-rules.ts); one farther is the GM's own move."
  ),
  "action:Black Pudding/black-pudding-split": enforced(
    "triggered-reactions.ts offers it when the pudding, Large or Medium with 10 or more Hit Points, becomes Bloodied or is dealt Lightning or Slashing damage. Using it puts two puddings of its stat block in its place, each one size smaller with half its Hit Points (round down) as current and maximum, on its Initiative count (split.ts)."
  ),
  "action:Ochre Jelly/split": enforced(
    "triggered-reactions.ts offers it when the jelly, Large or Medium with 10 or more Hit Points, becomes Bloodied or is dealt Lightning or Slashing damage. Using it puts two jellies of its stat block in its place, each one size smaller with half its Hit Points (round down) as current and maximum, on its Initiative count (split.ts)."
  ),
  "action:Black Pudding/dissolving-pseudopod": enforced(
    "The attack and its 4d6 + 3 Acid damage are applied, and a hit gives the nonmagical body armor the target wears a cumulative -1 to the AC it offers, destroying it at AC 10 (resolution/on-hit.ts, row-penalties.ts). Mending removes the penalty (resolution/mend.ts)."
  ),
  "action:Gray Ooze/pseudopod": enforced(
    "The attack and its 2d8 + 1 Acid damage are applied, and a hit gives the nonmagical body armor the target wears a cumulative -1 to the AC it offers, destroying it at AC 10 (resolution/on-hit.ts, row-penalties.ts). Mending removes the penalty (resolution/mend.ts)."
  ),
  "action:Rust Monster/antennae": enforced(
    "The Dexterity save is rolled against the creature (saving-throws.ts). A failure gives the nonmagical metal armor or weapon the GM names, else its worn armor or its weapon in hand, a cumulative -1 to the AC it offers or to its attack rolls, armor destroyed at AC 10 and a weapon at -5 (row-penalties.ts). A magic item is refused, and Mending removes the penalty (resolution/mend.ts)."
  ),
  "action:Shadow/draining-swipe": guided(
    "The hit's Necrotic damage is applied, and the target's Strength drops by 1d4, cumulatively until ended, read by every rule (resolution/score-drain.ts, live-abilities.ts); a target taken to 0 Strength dies. A Shadow rising from a Humanoid it slays 1d4 hours later is the GM's."
  ),
  "action:Phase Spider/bite": enforced(
    "The attack and its 1d10 + 3 Piercing plus 2d8 Poison damage are applied. A target the damage drops to 0 Hit Points is Stable instead of dying, Poisoned and Paralyzed for 1 hour, and regains 1 Hit Point after 1d4 hours unless healed first (stable-at-zero.ts)."
  ),
  "action:Vampire Familiar/umbral-dagger": enforced(
    "The attack and its 1d4 + 3 Piercing plus 3d4 Necrotic damage are applied. A target the attack drops to 0 Hit Points is Stable instead of dying, Poisoned and Paralyzed for 1 hour, and regains 1 Hit Point after 1d4 hours unless healed first (stable-at-zero.ts)."
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
    "Agonizing Blast adds Charisma to the damage of the cantrip picked for it (effective-actions.ts), Eldritch Spear its range and Repelling Blast its push (resolution/masteries.ts), each repeatable on another cantrip. Eldritch Mind's Advantage and the free casts are applied, an \"on yourself\" cast targets only the Warlock and Fiendish Vigor's die is at its highest; level-up-picks.ts lets a level up replace one invocation. Pact of the Blade's Bonus Action conjures or bonds the weapon picked, with proficiency, Charisma, the three damage types and its use as a focus, and Thirsting and Devouring Blade add attacks with it (pact-weapon.ts); Eldritch Smite and Lifedrinker ride its hits (resolution/hit-options.ts). Pact of the Tome's book holds three cantrips and two Rituals from any list, prepared and a Spellcasting Focus while it is carried, conjured anew with its picks re-made at the end of a rest; Gift of the Protectors' page holds the names written on it and drops one to 1 Hit Point once a Long Rest (book-of-shadows.ts). Gift of the Depths gives its Swim Speed and water breathing, Lessons of the First Ones its Origin feat, Devil's Sight and Witch Sight are senses dynamic vision reads, and One with Shadows' Invisibility is refused in Bright Light (resolution/validate.ts). Pact of the Chain casts Find Familiar as a Magic action with its special forms (summons.ts). Forgoing an attack for the familiar's, Investment of the Chain Master and Gaze of Two Minds are the GM's."
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
  "feature:lands-aid": enforced(
    "A use of Wild Shape is spent, and the Sphere centres within 60 feet of the Druid (commands/actions.ts for a placed area, resolution/action-targets.ts for picked creatures). Its creatures save against the spell save DC for the Necrotic damage, and the one creature picked in the area regains its own 2d6 Hit Points, 3d6 at Druid 10 and 4d6 at 14 (resolution/area-heal.ts). A placed area catches every creature under it, so leaving one out of the save is the GM's."
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
  "feature:self-restoration": enforced(
    "As the Monk's turn ends, self-restoration.ts ends one of its Charmed, Frightened or Poisoned conditions (the first in that order when it has several), with an effect that imposes nothing else, and going without food and drink gives it no Exhaustion (survival.ts)."
  ),
  "feature:quivering-palm": enforced(
    "An Unarmed Strike's hit can spend 4 Focus Points to set the vibrations on its target, one creature at a time (resolution/hit-rider-outcomes.ts). The vibrations last the Monk's level in days on the game clock (character-build.ts), and the Monk's player ends them harmlessly from the creature's row (effect.end lets a character's player end what it is the source of). The ending action targets only that creature: a Constitution save for 10d12 Force, half on a success."
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
  "feature:fast-hands": enforced(
    "As a Bonus Action the Thief takes the Utilize action for a tool's or gear's use on the sheet (tool-uses.ts) or at a door (doors.ts), a magic item's Magic action (fast-hands.ts), or a Dexterity (Sleight of Hand) check with Thieves' Tools or to pick a pocket. The server spends the Thief's Bonus Action for it."
  ),
  "feature:alert": enforced(
    "Initiative rolls add the Proficiency Bonus. Right after Initiative is rolled, before either has acted and neither Incapacitated, the holder's player offers to swap scores with an allied character, and the swap is made when that character's player takes it; the GM swaps any two at once (encounter.ts)."
  ),
  "feature:thiefs-reflexes": enforced(
    "In the first round of a fight a Thief 17 takes a second turn, with a fresh action, Bonus Action and movement, when the order passes its Initiative minus 10 (encounter.ts, second-turns.ts)."
  ),
  "feature:supreme-sneak": enforced(
    "Stealth Attack joins Cunning Strike's effects for 1d6: the attack keeps the Hide action's Invisible (resolution/release.ts), which ends at the end of the Rogue's turn unless it has Three-Quarters or Total Cover from every enemy on the map, measured from the walls and creatures or marked by the GM (supreme-sneak.ts, cover.ts). With dynamic vision off the cover is the GM's, said with the hit."
  ),
  "feature:hurl-through-hell": guided(
    "It rides an attack roll's hit once a Long Rest: the Charisma save, 8d10 Psychic unless the target is a Fiend, and Incapacitated off the map with nothing able to target it until the end of the Warlock's next turn, when it returns to the space it left or the nearest unoccupied one (off-plane.ts). conversions.ts restores the use with a Pact Magic slot."
  ),
  "feature:lay-on-hands": enforced(
    "The Bonus Action spends the points the Paladin picks to heal one creature it touches, within 5 feet (resolution/action-targets.ts), or 5 points to end Poisoned."
  ),
  "feature:superior-hunters-prey": enforced(
    "Once a turn, after the Ranger's damage lands on the creature its Hunter's Mark marks, the mark's 1d6 Force (1d10 from Foe Slayer) goes to another creature the Ranger can see within 30 feet of the marked one (resolution/action-targets.ts, resolution/dealings.ts)."
  ),
  "feature:words-of-creation": enforced(
    "Power Word Heal and Power Word Kill are always prepared, and either may take a second creature within 10 feet of the first (resolution/action-targets.ts)."
  ),
  "feature:use-magic-device": enforced(
    "The fourth attuned item is applied (inventory.ts), and resolution/charges.ts rolls the d6 when an item's charges are spent, giving them back on a 6. Reading any Spell Scroll is the GM's."
  ),
  "feature:grappler": enforced(
    "The ability score increase is applied, attack rolls against a creature it grapples have Advantage (resolution/attack.ts), an Unarmed Strike hit in the Attack action both damages and grapples once a turn (Punch and Grab, resolution/hit-options.ts), and dragging a grappled creature its size or smaller costs no extra movement (Fast Wrestler, movement-rules.ts)."
  ),
  "feature:improved-blessed-strikes": enforced(
    "Divine Strike deals 2d8 from Cleric 14 (its damage by level), or a Cleric cantrip that deals damage gives the Cleric or a creature it picks within 60 feet Temporary Hit Points equal to twice its Wisdom modifier, kept if higher, once a cast (resolution/vitality.ts)."
  ),
  "feature:sear-undead": enforced(
    "From Cleric 5 Turn Undead's failed save deals d8s of Radiant damage equal to the Wisdom modifier, at least one (character-build.ts, resolution/pending.ts), and the turning goes on."
  ),
  "feature:tactical-master": enforced(
    "A Fighter 9's attack with a weapon whose mastery it can use may take Push, Sap or Slow in place of that mastery, picked on the attack's preview (resolution/masteries.ts)."
  ),
  "feature:fleet-step": enforced(
    "Right after another Bonus Action, an Open Hand Monk 11 takes Step of the Wind with no Bonus Action of its own (resolution/turn-windows.ts, resolution/economy.ts)."
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
  "feature:boon-of-irresistible-offense": enforced(
    "The ability score increase is applied, Bludgeoning, Piercing and Slashing damage ignores Resistance (hit-points.ts), and a rolled 20 on an attack roll adds damage equal to the increased score, of the attack's type (resolution/damage.ts)."
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
  "feature:halfling-nimbleness": enforced(
    "A Halfling moves through the space of a creature larger than it as Difficult Terrain, and can't end its move there (movement-rules.ts, spacePassage in rules-5e); the map's drag preview charges the same path."
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
  "item:armor-of-invulnerability": enforced(
    "Resistance to Bludgeoning, Piercing and Slashing damage is applied, and Metal Shell's Magic action gives Immunity to them for 10 minutes once a dawn, ending if the armor comes off (inventory.ts)."
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
  "item:acid": enforced(
    "Thrown in place of an attack at a creature or object the thrower sees within 20 feet: a creature makes the Dexterity save (DC 8 plus the thrower's Dexterity modifier and Proficiency Bonus) or takes 2d6 Acid damage, and a door or a wall on the map that is an object fails it and takes the damage (resolution/object-targets.ts, objects.ts)."
  ),
  "item:alchemists-fire": enforced(
    "Thrown in place of an attack at a creature or object the thrower sees within 20 feet: a creature makes the Dexterity save or takes 1d4 Fire damage and starts burning, 1d4 Fire damage at the start of each of its turns until it puts the fire out (hazards.ts). A door or a wall on the map that is an object fails the save and takes the 1d4 Fire (resolution/object-targets.ts); an object has no turns, so its burning after that is the GM's."
  ),
  "item:caltrops": enforced(
    "Spreading them from the pack places a 5-foot square that rolls nothing as it lands (resolution/concentration.ts). spell-zones.ts asks a creature that enters it for the DC 15 Dexterity save, once a turn: 1 Piercing damage and a Speed of 0 until the start of its next turn on a failure. A move that enters it waits there on the save, and a failure ends the move (zone-stops.ts, held-moves.ts). The square stays until the GM ends it, which is gathering them up."
  ),
  "item:ball-bearings": enforced(
    "Spilling them from the pack places a 10-foot square that rolls nothing as it lands (resolution/concentration.ts). spell-zones.ts asks a creature that enters it for the DC 10 Dexterity save, once a turn, and a failure leaves it Prone. A move that enters it waits there on the save, and a failure ends the move (zone-stops.ts, held-moves.ts). The square stays until the GM ends it, which is gathering them up."
  ),
  "item:hunting-trap": enforced(
    "Setting it places a 5-foot square (resolution/concentration.ts). The first creature that enters it makes the DC 13 Dexterity save, with 1d4 Piercing damage and a Speed of 0 on a failure, and the trap springs and leaves the map (spell-zones.ts). A move that enters it waits there on the save, and a failure ends the move (zone-stops.ts, held-moves.ts). The trap holds the creature until it or a creature beside it breaks free with a DC 13 Strength (Athletics) check as its action, and each failure deals the trapped creature 1 Piercing damage (resolution/endings.ts)."
  ),
  "item:cloak-of-the-bat": guided(
    "Advantage on Dexterity (Stealth) checks is applied. The Fly Speed in darkness and the Polymorph cast are the GM's."
  ),
  "item:dagger-of-venom": enforced(
    "The +1 to attack and damage rolls is applied. Coating the blade is a Bonus Action once a day, and the dagger's next hit spends it on a DC 15 Constitution save against 2d10 Poison and Poisoned for 1 minute (resolution/on-hit.ts)."
  ),
  "item:defender": enforced(
    "The +3 to attack and damage rolls is applied, and its wielder moves 1, 2 or 3 of it to AC as a form on the sheet before its first attack of a turn, held until its next turn starts and giving AC only while it holds the weapon (inventory.ts setItemForm, turn-boundaries.ts)."
  ),
  "item:ring-of-free-action": guided(
    "Difficult Terrain costs its wearer no extra movement (movement-rules.ts). That magic can't reduce its Speeds or give it the Paralyzed or Restrained condition is the GM's to apply, since the engine doesn't yet tell a magical source from another."
  ),
  "item:horseshoes-of-a-zephyr": guided(
    "The creature wearing all four ignores Difficult Terrain (movement-rules.ts). Floating over water or lava is the GM's until the map holds water and lava areas; its tracks and its 12 hours of travel a day are overland travel the app doesn't run."
  ),
  "item:demon-armor": guided(
    "The +1 AC and the curse's lock on Attunement are applied. The clawed Unarmed Strikes and the Disadvantage against demons are the GM's."
  ),
  "item:dragon-scale-mail": enforced(
    "The +1 AC and the Resistance to the type the GM picks are applied, with Advantage on saves against a Dragon's breath weapon (saving-throws.ts). Its Magic action to sense the nearest dragon is counted once a dawn; the distance and direction it tells are the GM's."
  ),
  "item:javelin-of-lightning": enforced(
    "It may deal Lightning damage on a hit, and once a dawn it becomes a bolt: a 5-foot Line from its thrower that ends at a target within 120 feet (annotations.ts), DC 13 Dexterity save for 4d6 Lightning, half on a success."
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
  "item:iron-bands": enforced(
    "The throw's attack roll is applied, and a hit Restrains the target until its user's Bonus Action command releases it (resolution/endings.ts releaseItemEffects). A DC 20 Strength (Athletics) check, its action, breaks the bands and destroys them, and a failure keeps that creature from trying again for 24 hours (resolution/endings.ts)."
  ),
  "item:iron-flask": guided(
    "Its Magic action's DC 17 Wisdom save against a Celestial, Elemental, Fey or Fiend it sees within 60 feet traps a failing one off the map in the flask, one at a time (resolution/held-creatures.ts, off-plane.ts); the release action brings it back beside its user, obeying the user for 1 hour (summons.ts). A creature trapped before saving with Advantage, a found flask holding a creature and what a released one does after the hour are the GM's."
  ),
  "item:luck-blade": guided(
    "The +1 to attack and damage rolls and saving throws is applied, and roll-answers.ts offers its Luck reroll on a failed D20 Test once a day while the wielder isn't Incapacitated. Its Wish casts on 1d3 charges rolled when it is added, which never come back, and once a dawn (resolution/economy.ts). What a Wish does is the GM's."
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
  "item:nine-lives-stealer": enforced(
    "The +2 to attack and damage rolls is applied. On a rolled 20 against a creature with fewer than 100 Hit Points, other than a Construct or an Undead, the target makes the DC 15 Constitution save, and a failure slays it (resolution/kill.ts). Each slaying spends one of the 1d8 + 1 charges rolled when the sword is added, which never come back, and with none left it slays no more."
  ),
  "item:helm-of-brilliance": guided(
    "inventory.ts counts each kind of gem when the helm is added (1d10 diamonds, 2d10 rubies, 3d10 fire opals, 4d10 opals), which never come back, and each of its spells at DC 18 spends one gem of its kind: Daylight an opal, Fireball a fire opal, Prismatic Spray a diamond, Wall of Fire a ruby. Diamond Light against Undead, Fire Opal Flames, Ruby Resistance while a ruby is left, the helm losing its magic once every gem is gone, and the d20 when Fire from a spell lands are the GM's."
  ),
  "item:pipes-of-haunting": enforced(
    "Its 3 charges come back 1d3 at dawn; each opens the DC 15 Wisdom save against Frightened for a minute on the creatures its user picks within 30 feet, repeated at the end of each turn, and a creature that succeeds is immune to the pipes for the rest of the fight (resolution/pending.ts)."
  ),
  "item:quarterstaff-of-the-acrobat": enforced(
    "The +2 to attack and damage rolls and Advantage on Dexterity (Acrobatics) checks are applied, it is thrown 30/120, and Attack Deflection is offered once a rest when a hit would land (resolution/pending.ts). A Bonus Action makes it a rod or a pole (inventory.ts setItemForm), where it neither swings nor deflects."
  ),
  "item:ring-of-shooting-stars": guided(
    "Its at-will cantrips, and on its 6 charges Faerie Fire, Shooting Stars of 1 to 3 Cubes at a charge each (use-cost.ts, multi-templates.ts) and the Lightning Spheres, are applied: up to four areas on the wearer's Concentration for a minute, each discharging once at the first creature within 5 feet of it for the damage its number gives (spell-zone-state.ts, spell-zones.ts). The spheres' Dim Light, and their Bonus Action move within 120 feet, are the GM's, who drags each sphere's area."
  ),
  "item:robe-of-scintillating-colors": enforced(
    "Its 3 charges (1d3 back at dawn) each make the robe shed Bright Light 30 feet and Dim Light 30 more until the end of the wearer's next turn, give Disadvantage to attackers that see it, and Stun until then a creature within 30 feet that sees it and fails the DC 15 Wisdom save (resolution/pending.ts, vision/rules.ts)."
  ),
  "item:robe-of-stars": enforced(
    "The +1 to saving throws is applied, its six stars each cast a level 5 Magic Missile with 1d6 coming back at dusk or a Long Rest, and its Magic action takes the wearer off the map to the Astral Plane until the action again brings it back to its last space or the nearest unoccupied one (off-plane.ts). What it finds on the Astral Plane is story."
  ),
  "item:rod-of-alertness": enforced(
    "Advantage on Initiative and Wisdom (Perception) checks, and its detection casts, are applied. The Protective Aura once a dawn plants the rod's light where its user stands for 10 minutes, and while in its 60 feet of Bright Light the user and its allies have +1 to AC and saves and See Invisibility there (zone-auras.ts). Pulling the rod out is the GM's, who ends its area."
  ),
  "item:rope-of-entanglement": enforced(
    "The save against Restrained is applied, with the DC 15 Strength (Athletics) or Dexterity (Acrobatics) check to escape (ending-actions.ts), and its user's Bonus Action command releases the target (resolution/endings.ts). The rope that holds it is an object with AC 20 and 20 Hit Points, immune to Poison and Psychic damage, that an attack can break, which frees it, and it regains 1 Hit Point every 5 minutes (objects.ts, effects.ts)."
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
    "It swings as a +2 Quarterstaff, the +2 to AC, saving throws and spell attack rolls is applied, and its spells spend their printed charges; the last charge's d20 gives 1d8 + 2 back on a 20 and leaves only a +2 Quarterstaff on a 1 (resolution/charges.ts). Retributive Strike is the GM's."
  ),
  "item:staff-of-the-magi": guided(
    "It swings as a +2 Quarterstaff, the +2 to spell attack rolls is applied, and its spells spend their printed charges from 50; a 20 on the last charge's d20 gives 1d12 + 1 back (resolution/charges.ts). Advantage on saves against spells, Spell Absorption and Retributive Strike are the GM's."
  ),
  "item:staff-of-the-woodlands": enforced(
    "It swings as a +2 Quarterstaff, the +2 to spell attack rolls is applied, its spells spend their printed charges and Tree Form's use is counted. A 1 on the last charge's d20 leaves a plain Quarterstaff (resolution/charges.ts)."
  ),
  "item:staff-of-thunder-and-lightning": enforced(
    "It swings as a +2 Quarterstaff. Lightning and Thunder ride a melee hit, Thunder and Lightning does both as a Bonus Action (resolution/hit-options.ts), and Lightning Strike's 120-foot Line and Thunderclap's 60-foot Emanation are actions (area-targeting.ts), each once a day."
  ),
  "item:staff-of-striking": enforced(
    "It swings as a +3 Quarterstaff, a melee hit can spend 1, 2 or 3 of its 10 charges for 1d6 Force each (resolution/hit-options.ts), and a 1 on the last charge's d20 leaves a plain Quarterstaff (resolution/charges.ts)."
  ),
  "item:staff-of-withering": enforced(
    "It swings as a Quarterstaff, and a hit can spend a charge for 2d10 Necrotic and a DC 15 Constitution save against an hour of Disadvantage on Strength and Constitution checks and saves (resolution/hit-options.ts), counted on the game clock after a fight (game-time.ts)."
  ),
  "item:rod-of-lordly-might": enforced(
    "It swings as a +3 Mace; Drain Life (healing its wielder half the Necrotic damage a failed save deals) and Paralyze ride a melee hit and Terrify is an action, each once a day. Its buttons are forms its holder picks for a Bonus Action (inventory.ts setItemForm): a flaming Longsword or Shortsword with 2d6 Fire and its light, a +3 Battleaxe or Spear, a pole or a battering ram (+10 to break through). The pole's length and anchoring, magnetic north and the depth or height it tells are story."
  ),
  "item:sun-blade": enforced(
    "It swings as a +2 Finesse Longsword that deals Radiant damage, with 1d8 Radiant more against an Undead, and its blade sheds sunlight whose Bright and Dim radii a Magic action sets 5 feet wider or narrower between 10 and 30 feet (resolution/cast-lights.ts, vision/senses.ts). A Bonus Action puts the blade away to the hilt or brings it back (inventory.ts setItemForm)."
  ),
  "item:sword-of-sharpness": enforced(
    "A rolled 20 against a creature adds 14 Slashing damage and a level of Exhaustion (resolution/damage.ts, resolution/on-hit.ts), and its damage dice against an object are maximized (object-strikes.ts)."
  ),
  "item:talisman-of-pure-good": guided(
    "It is a Holy Symbol for its bearer's spells (resolution/components.ts) with +2 to spell attack rolls, and Pure Rebuke spends one of its 7 charges, which never come back; the last destroys it (item-spent.ts). The rebuke's DC 20 Dexterity save, with Disadvantage for a Fiend or an Undead, a failure destroying the target and a success dealing 4d6 Psychic, and the 8d6 Radiant it deals a Fiend or an Undead that touches it, are the GM's."
  ),
  "item:talisman-of-ultimate-evil": guided(
    "It is a Holy Symbol for its bearer's spells (resolution/components.ts) with +2 to spell attack rolls, and Ultimate End spends one of its 6 charges, which never come back; the last destroys it (item-spent.ts). The DC 20 Dexterity save, with Disadvantage for a Celestial, a failure destroying the target and a success dealing 4d6 Psychic, and the 8d6 Necrotic it deals any other creature that touches it, are the GM's."
  ),
  "item:sword-of-wounding": enforced(
    "The extra Necrotic damage is applied, and a hit opens a DC 15 Constitution save whose failure stops the target regaining Hit Points for 1 hour or until it succeeds on the save it repeats at the end of each of its turns (resolution/on-hit.ts); the hour runs on the game clock after a fight (game-time.ts)."
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
  "item:boots-of-speed": enforced(
    "A Bonus Action doubles its wearer's Speed (speed.ts) and gives Opportunity Attacks against it Disadvantage. Its 10 minutes a Long Rest are 100 rounds: a click lasts all that is left, and ending it early gives the rest back (use-cost.ts, effects.ts)."
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
    "A failed save leaves the curse the caster picks for the slot's duration (resolution/pending.ts, resolution/concentration.ts): Disadvantage on one ability's checks and saves, Disadvantage on its attack rolls against the caster (resolution/attack.ts), a Wisdom save at the start of each of its turns in a fight whose failure leaves it only the Dodge action that turn (save-stages.ts, resolution/economy.ts), or an extra 1d8 Necrotic when the caster's attack hits it (resolution/damage.ts). Remove Curse or Dispel Magic ends it."
  ),
  "spell:blur": enforced(
    "Attack rolls against the caster have Disadvantage while it lasts, except from an attacker whose Blindsight or Truesight reaches it (resolution/attack.ts)."
  ),
  "spell:chromatic-orb": enforced(
    "The attack and the chosen damage type are applied, 1d8 more a slot level above 1, and it needs a 50 GP diamond (resolution/components.ts). When two of a hit's d8s match, the cast's action stays open for one more orb: cast again at no cost, it attacks a creature within 30 feet of the last target that this casting hasn't struck, with the same damage type and a new damage roll, up to the slot's level in leaps, one for a level 1 slot (resolution/orb-leap.ts)."
  ),
  "spell:confusion": guided(
    "A failed save bars the target's Bonus Actions and Reactions, with the save repeated at the end of each of its turns (save-stages.ts), and random-outcomes.ts rolls its d10 at the start of each of its turns and takes for that turn what the roll forbids. The Sphere grows by 5 feet for each slot level above 4 (spell-zone-state.ts). The wandering move and the random attack are said to the table."
  ),
  "spell:phantasmal-force": enforced(
    "A failed Intelligence save leaves the illusion on the target for the spell's duration, and a creature with Truesight succeeds. On each of the caster's turns its sheet offers the phantasm's 2d8 Psychic damage against that creature once, and against no other (lasting-spells.ts, resolution/economy.ts). The target's Study, an Intelligence (Investigation) check against the spell save DC, ends it (ending-actions.ts). What the phantasm is, and whether the target stands in it or within 5 feet of it, are the GM's."
  ),
  "spell:prismatic-spray": enforced(
    "resolution/prismatic.ts rolls the d8 for each creature in the Cone, two rays on an 8, and the 12d6 once. Red to Blue ask the Dexterity save against their damage, half on a success. Indigo Restrains on a failure, with the Constitution saves counted until three successes end it or three failures Petrify it (save-stages.ts). Violet Blinds on a failure, and at the start of the caster's next turn the creature makes the Wisdom save: a success ends the Blinded condition, a failure ends it and takes the creature off the map to another plane (save-stages.ts, off-plane.ts). Which plane, and bringing it back, are the GM's."
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
  "spell:conjure-celestial": enforced(
    "The cast picks the lights: Healing Light on the caster's side and Searing Light on the rest, or one of them for all. spell-zones.ts shines it on each creature in the Cylinder on the cast and as a creature enters it or ends its turn there, once a turn: 4d12 plus the spellcasting modifier healed, or the Dexterity save against 6d12 Radiant damage, each 1d12 more a slot level above 7. When the caster moves on its turn the Cylinder can move 30 feet too, bathing the creatures it moves onto (zone-moves.ts), and Bright Light fills it for dynamic vision (vision/cast-sight.ts)."
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
  "spell:delayed-blast-fireball": enforced(
    "The bead waits at its point, in a fight or out of one, and spell-zones.ts explodes it when the spell ends, Concentration broken included: the Dexterity save and 12d6 Fire damage, 1d6 more a slot level, plus 1d6 for each of the caster's turns that ended while it waited. A creature within 5 feet can Touch the Bead (zone-touch.ts): its Dexterity save sets it off on a failure, and on a success it throws the bead up to 40 feet at a creature, where it explodes. Flammable objects that catch are the GM's."
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
  "spell:reincarnate": enforced(
    "resolution/revival.ts refuses a target dead more than 10 days and returns it with all its Hit Points in a new body, rolling the d10 for its species (a 1 rolls again). A character built here is then rebuilt from its ledger as that species (reincarnation.ts): the old species' traits and picks go, its classes, background and scores stay, and the new species' picks take their first legal options, which the narration names and the GM can change in the Level flow. A creature with no build ledger keeps the note for the GM. The soul's consent is the table's."
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
  "spell:dominate-beast": enforced(
    "Only a Beast can be the target. A failed save imposes Charmed for the spell's duration, longer from a higher slot (resolution/concentration.ts), with Advantage on the save while its side is fighting the caster's, and a repeat save each time the target takes damage (save-stages.ts). It puts the target under the caster's command and on its side while it lasts (summons.ts): the caster's player acts for it on its turns, and its Reaction is offered only while the caster has one, spending both (commanded-reactions.ts). What the orders say, and how it carries them out when left alone, are the table's."
  ),
  "spell:dominate-monster": enforced(
    "Any creature can be the target. A failed save imposes Charmed for the spell's duration, longer from a level 9 slot (resolution/concentration.ts), with Advantage on the save while its side is fighting the caster's, and a repeat save each time the target takes damage (save-stages.ts). It puts the target under the caster's command and on its side while it lasts (summons.ts): the caster's player acts for it on its turns, and its Reaction is offered only while the caster has one, spending both (commanded-reactions.ts). What the orders say, and how it acts when left alone, are the table's."
  ),
  "spell:dominate-person": enforced(
    "Only a Humanoid can be the target. A failed save imposes Charmed for the spell's duration, longer from a higher slot (resolution/concentration.ts), with Advantage on the save while its side is fighting the caster's, and a repeat save each time the target takes damage (save-stages.ts). It puts the target under the caster's command and on its side while it lasts (summons.ts): the caster's player acts for it on its turns, and its Reaction is offered only while the caster has one, spending both (commanded-reactions.ts). What the orders say, and how it acts when left alone, are the table's."
  ),
  "spell:earthquake": guided(
    "The cast places the 100-foot circle, and its Dexterity save leaves a creature Prone with its Concentration broken on a failure. spell-zones.ts repeats the save for each creature on the ground in the circle at the end of each of the caster's turns, sparing one in the air, as the cast does, and zone-ground.ts makes the circle Difficult Terrain. The fissures, and the 50 Bludgeoning damage to structures, which the GM deals to the walls and doors that are objects with object.damage (objects.ts), are the GM's."
  ),
  "spell:fear": guided(
    "A failed save imposes Frightened and drops what the creature holds (effects.ts), and a creature that ends its turn out of the caster's sight repeats the save (save-stages.ts, with dynamic vision on). The Dash away on each of its turns is the GM's."
  ),
  "spell:faithful-hound": enforced(
    "The hound stays at its point in a fight or out of one, and spell-zones.ts makes it bite at the start of each of the caster's turns in a fight: the enemy nearest it within 5 feet makes the Dexterity save against 4d8 Force damage. It barks for the caster when a Small or larger creature comes within 30 feet of it without the password, the caster's later Magic action moves it 30 feet (zone-moves.ts), and the spell ends when the caster is more than 300 feet from it. The password, and its sight of Invisible creatures, are the GM's."
  ),
  "spell:flesh-to-stone": enforced(
    "A failed save imposes Restrained, and the repeat saves are counted: three successes end it, three failures Petrify it (save-stages.ts). A success leaves Speed 0 until the start of the caster's next turn, and a Construct succeeds without a roll."
  ),
  "spell:freedom-of-movement": guided(
    "speed.ts gives the target a Swim Speed equal to its Speed, terrain.ts charges it nothing extra for Difficult Terrain, and the target can't have the Paralyzed or Restrained condition (effects.ts), whatever its source. Keeping its Speed from being reduced and slipping free of restraints are the GM's."
  ),
  "spell:gust-of-wind": enforced(
    "The cast's save pushes a creature that fails 15 feet away from the caster, and the Line disperses the fog and clouds it overlaps (vision/cast-sight.ts). spell-zones.ts repeats the save for a creature ending its turn in the Line, zone-ground.ts charges 2 feet for every foot a creature in it moves closer to the caster, and the Bonus Action points the Line another way from the caster (zone-moves.ts). It puts out a burning creature's fire and the open flames carried in the Line, and gives a lantern its 50 percent chance (zone-outcomes.ts, item-light.ts)."
  ),
  "spell:hideous-laughter": enforced(
    "A failed save imposes Prone and Incapacitated, repeated at the end of each of the target's turns and each time it takes damage, with Advantage then (save-stages.ts). It can't stand up while it laughs (actor-conditions.ts)."
  ),
  "spell:irresistible-dance": enforced(
    "A failed save Charms the target, holds its Speed at 0, gives it Disadvantage on Dexterity saves and attack rolls and attackers Advantage against it, and offers it an action to collect itself with a Wisdom save at the spell save DC (builtin-actions.ts). A success holds its Speed at 0 until the end of its next turn."
  ),
  "spell:major-image": guided(
    "resolution/concentration.ts holds the caster's Concentration on it, and from a level 4 slot it lasts until dispelled with none. Its 20-foot Cube stays on the map, and the caster's Magic action moves it anywhere within range while the caster is (zone-moves.ts). The illusion itself is the GM's to run."
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
    "The target is immune to Psychic damage (hit-points.ts) and the Charmed condition (effects.ts), and a Divination spell can't target it, catch it in its area or sense it (resolution/spell-wards.ts). Other ways to read its emotions or thoughts, and scrying sensors, are the GM's."
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
  "spell:warding-bond": enforced(
    "The target has +1 to AC and saving throws and Resistance to all damage for the hour, and each time it takes damage the caster takes the same amount (hit-points.ts). The bond ends when the caster drops to 0 Hit Points or the two are more than 60 feet apart on the map, and a new Warding Bond cast on either creature ends the old one (warding-bond.ts)."
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
    "A Champion 18 rolls death saves with Advantage, an 18 or 19 counting as a 20 (death-saves.ts), and regains 5 plus its Constitution modifier at the start of each turn while Bloodied and above 0 (turn-boundaries.ts)."
  ),
  "spell:sleet-storm": enforced(
    "spell-zones.ts asks for the Dexterity save when a creature enters the Cylinder or starts its turn there, and a failure leaves it Prone and ends its Concentration. A move that enters it waits there on the save, and a failure ends the move (zone-stops.ts, held-moves.ts). zone-ground.ts makes the Cylinder Difficult Terrain of ice, and it is Heavily Obscured for dynamic vision (vision/cast-sight.ts). It douses a burning creature in it and the open flames carried there (zone-outcomes.ts, item-light.ts)."
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
    "spell-zones.ts asks for the Dexterity save against 6d10 Force damage on the cast and when a creature enters the wall or ends its turn there, once a turn. zone-ground.ts makes the wall's space Difficult Terrain, and zone-walls.ts gives a creature on its far side Three-Quarters Cover against attacks and Dexterity saves across it. The cast picks a straight wall or a ring up to 60 feet across, which acts only on its edge (zone-shapes.ts)."
  ),
  "spell:antipathysympathy": enforced(
    "The cast picks antipathy or sympathy and a creature type. spell-zones.ts holds the 120 feet round the target creature, moving with it, and a creature of that type that comes within it makes the Wisdom save: Frightened of the target, or Charmed by it. It saves again when it ends a turn more than 120 feet from the target, and Sympathy's also when the target damages it (save-stages.ts); a success ends it and leaves it immune for the fight. Its moves away from or toward the target, a story kind matched to stat blocks, and an object target off the map are the GM's."
  ),
  "spell:conjure-animals": enforced(
    "The pack holds the 10 feet round its point (spell-zones.ts): an enemy of the caster's that the pack moves within 10 feet of, or that comes within 10 feet of it or ends its turn there, makes the Dexterity save against 3d10 Slashing damage, once a turn, at the cast's slot level. Its caster has Advantage on Strength saves within 5 feet of it (zone-auras.ts), and when the caster moves on its turn the pack can move 30 feet to an unoccupied space (zone-moves.ts)."
  ),
  "spell:symbol": enforced(
    "The cast picks the glyph, which waits hidden at its point, drawn for the GM and its caster (spell-zones.ts). A creature that comes onto it sets it off: it glows for 10 minutes, and each creature in its 60-foot Sphere, or entering it or ending its turn there once a turn, makes the glyph's save (Death's 10d10 Necrotic, Discord, Fear, Pain, Sleep or Stunning). Noticing the glyph with a search, and a frightened creature's move away, are the GM's."
  ),
  "spell:speak-with-plants": guided(
    "The cast picks what the plants do with the ground of its 30-foot Emanation, which stays where it was cast: the plants clear the painted Difficult Terrain to ordinary ground, or overgrow it into Difficult Terrain (zone-ground.ts). Talking with the plants is the GM's."
  ),
  "spell:silent-image": guided(
    "resolution/concentration.ts holds the caster's Concentration on it, and its 15-foot Cube stays on the map: the caster's Magic action moves it anywhere within range (zone-moves.ts). The illusion itself is the GM's to run."
  ),
  "spell:create-or-destroy-water": enforced(
    "The cast picks Create Water or Destroy Water over its 30-foot Cube, 5 feet bigger a slot level. Rain puts out the fire on a creature in it and the open flames carried there (zone-outcomes.ts, item-light.ts), and Destroy Water ends the fog in the Cube (vision/cast-sight.ts). Water in a container is the GM's."
  ),
  "item:sphere-of-annihilation": enforced(
    "Set the Sphere puts it on the map, where a creature whose space it enters, or that enters its space, makes the DC 19 Dexterity save or takes 8d10 Force damage, obliterated at 0 Hit Points (spell-zones.ts, hit-points.ts). Control the Sphere rolls the DC 25 Intelligence (Arcana) check from within 60 feet, holding it until the start of the creature's next turn or drawing it 10 feet closer, and Move the Sphere moves it toward a creature 5 feet a point of Intelligence (zone-sphere.ts). Its meetings with portals are the GM's."
  ),
  "item:talisman-of-the-sphere": enforced(
    "Attuned, it gives Control the Sphere's Intelligence (Arcana) check Advantage, and its holder that starts its turn in control of a Sphere of Annihilation can take a Magic action to move it 10 feet plus 10 a point of Intelligence (zone-sphere.ts)."
  ),
  "action:Djinni/create-whirlwind": guided(
    "The whirlwind is an area on the djinni's Concentration (resolution/concentration.ts): the creatures it appears on, and each that walks into it or that it is dragged onto, make the Strength save once a turn, and the djinni is spared (spell-zones.ts). A failure Restrains with 6d6 Thunder damage at the start of each of the target's turns and a repeat save at its ends, and a dragged whirlwind carries the creatures it holds. Moving it up to 20 feet at the start of the djinni's turns is the GM's drag."
  ),
  "spell:call-lightning": enforced(
    "The cloud is a 60-foot Cylinder over its caster's point that stays (spell-zones.ts). The cast and each later Magic action strike a 5-foot Sphere centred under it (zone-later.ts) with the Dexterity save against 3d10 Lightning damage, at the cast's slot level, and 1d10 more when the cast picked a storm overhead. Whether it is outdoors is the GM's."
  ),
  "spell:cloudkill": enforced(
    "spell-zones.ts asks for the Constitution save against 5d8 Poison damage on the cast and when a creature enters the Sphere or ends its turn there, once a turn. At the start of each of the caster's turns it moves the Sphere 10 feet straight away from the caster, and a creature the Sphere moves onto makes the save. The Sphere is Heavily Obscured for dynamic vision (vision/cast-sight.ts)."
  ),
  "spell:conjure-minor-elementals": enforced(
    "zone-ground.ts makes the ground in the 15-foot Emanation Difficult Terrain for the caster's enemies, and each of the caster's hits on a creature within 15 feet deals an extra 2d8, 1d8 more a slot level above 4 (item-actions.ts), of the type picked at the cast unless the attack's preview picks another of Acid, Cold, Fire or Lightning (resolution/damage.ts, resolution/hit-options.ts)."
  ),
  "spell:entangle": enforced(
    "The cast's Strength save leaves a creature in the square Restrained, escaped with a Strength (Athletics) check against the spell save DC. zone-ground.ts makes the square Difficult Terrain for the duration. Leaving the caster out of its own square is the GM's."
  ),
  "spell:fire-storm": enforced(
    "The cast places up to ten 10-foot Cubes, each touching another and within 150 feet of the caster (multi-templates.ts), and each creature under any of them makes the Dexterity save once against 7d10 Fire damage, half on a success. Setting flammable objects alight is the GM's."
  ),
  "spell:meteor-swarm": enforced(
    "The cast places up to four 40-foot-radius Spheres at different points within range (multi-templates.ts), and a creature in more than one makes the Dexterity save once, against 20d6 Fire and 20d6 Bludgeoning damage, half on a success. A door or a wall on the map that is an object under the Spheres takes the whole of it, once (resolution/object-targets.ts). Setting objects alight is the GM's."
  ),
  "spell:shatter": enforced(
    "The cast's Constitution save against 3d8 Thunder damage, half on a success, is asked of each creature in the 10-foot-radius Sphere, a Construct making it with Disadvantage (saving-throws.ts). A door or a wall on the map that is an object under the Sphere takes the whole of the damage (resolution/object-targets.ts)."
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
    "The glyph lasts until it goes off, in a fight or out of one, drawn for the GM and the caster's player alone. As an explosive rune, the first creature that steps onto it sets it off: each creature in the 20-foot Sphere makes the Dexterity save against 5d8 damage of the type chosen at the cast, 1d8 more a slot level above 3, and the spell ends (spell-zones.ts). A spell of the glyph's level or lower that its caster casts within the minute is stored in it instead, and when the glyph is set off it takes effect at its caster's numbers on that creature, or on the creatures within its area around that creature (stored-casts.ts, stored-cast-release.ts). Refining the trigger (creature kinds, passwords, an opened book) and noticing the glyph with a Wisdom (Perception) check are the GM's."
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
  "spell:incendiary-cloud": enforced(
    "spell-zones.ts asks for the Dexterity save against 10d8 Fire damage on the cast and when a creature enters the cloud or ends its turn there, once a turn. At the start of each of the caster's turns the caster steers it 10 feet in a direction away from itself (zone-moves.ts), or as that turn ends it drifts straight away, and a creature the cloud moves onto makes the save. The cloud is Heavily Obscured for dynamic vision (vision/cast-sight.ts), and a strong wind disperses it (zone-outcomes.ts)."
  ),
  "spell:insect-plague": enforced(
    "spell-zones.ts asks for the Constitution save against 4d10 Piercing damage on the cast and when a creature enters the Sphere or ends its turn there, once a turn. zone-ground.ts makes the Sphere Difficult Terrain, and it is Lightly Obscured for dynamic vision (vision/cast-sight.ts)."
  ),
  "spell:magic-circle": enforced(
    "The cast picks the types it wards among Celestials, Elementals, Fey, Fiends and Undead (all of them when none is named) and whether it faces out or is reversed. Facing out, zone-barriers.ts keeps a creature of those types from walking into the Cylinder and makes one that teleports in succeed on a Charisma save against the cast's DC first, a failure wasting the teleport; reversed, the same holds it in. The creatures it protects, inside the Cylinder or, reversed, outside it, hold its ward while there (zone-auras.ts): those types attack them with Disadvantage and can't give them the Charmed or Frightened condition. Possession, which the app doesn't model, is the GM's."
  ),
  "spell:private-sanctum": guided(
    "The cast places the Cube, 100 feet a side and 100 more for each slot level above 4, and picks any of its properties (spell-zones.ts): a dark and foggy edge that sight, Darkvision included, can't pass either way (resolution/zone-casts.ts, vision/areas.ts); no teleporting into or out of it (zone-barriers.ts); and no Divination spell targeting, or catching in its area, a creature inside (zone-auras.ts, resolution/spell-wards.ts). It lasts 24 hours on the game clock. A Cube smaller than the spell's size is the GM's to redraw, and sound across the edge, Divination sensors, planar travel and the year of castings that makes it permanent are the GM's."
  ),
  "spell:antimagic-field": guided(
    "The 10-foot Emanation goes with its caster while it concentrates, and every creature in it, the caster too, holds the field (zone-auras.ts): it can't cast a spell or take the Magic action (resolution/economy.ts); no spell can target it, catch it in an area or a lasting area, or reach it with a later effect (resolution/spell-wards.ts); its magic items give nothing, a magic weapon swinging as its base and a magic item's action refused, and a magic item swung or used from outside works on it as a plain one (equipment-derivation.ts, resolution/validate.ts); an ongoing spell's modifiers, Armor Class bonus and conditions on it are suppressed while their time still runs; and a creature a spell summoned winks out of the map until its space is outside the field (off-plane.ts). No one teleports into or out of it (zone-barriers.ts), and Dispel Magic aimed at it does nothing (resolution/dispel.ts). Lights, fog and Darkness a spell placed over the field still shine and obscure inside it, and spells cast by an Artifact or a deity, portals and planar travel are the GM's."
  ),
  "spell:hallow": guided(
    "The cast places the 60-foot-radius area round the touched point until dispelled and picks the types its ward names among Aberrations, Celestials, Elementals, Fey, Fiends and Undead (all of them when none is named). zone-barriers.ts keeps a creature of those types from walking in, and a creature inside can't be charmed or frightened by one, a Charmed or Frightened condition it already has from one being held off while it is inside (zone-auras.ts). The cast picks its extra effect: Courage (every other creature inside immune to Frightened), Darkness (dark inside, which normal light and lower spells' light don't brighten), Daylight (Bright Light), Extradimensional Interference (the warded types can't teleport in or out), Fear (a warded creature inside is Frightened), Resistance (every other creature inside resists the type picked), Silence (Deafened inside) or Vulnerability (a warded creature inside is vulnerable to the type picked). The extra effect's creatures follow the ward's types, so naming other types for it is the GM's, as are Peaceful Rest, Tongues, possession and a lower spell's magical Darkness inside its Daylight. A Hallow placed over ground already under one fails (resolution/zone-casts.ts)."
  ),
  "spell:moonbeam": enforced(
    "spell-zones.ts asks for the Constitution save against 2d10 Radiant damage on the cast and when a creature enters the Cylinder or ends its turn there, once a turn. On the caster's later turns a Magic action moves the Cylinder up to 60 feet (zone-moves.ts), and a creature it moves onto makes the save. Its Dim Light is placed for dynamic vision (vision/cast-sight.ts). A shape-shifted creature that fails returns to its true form and can't shape-shift until it leaves the Cylinder or the spell ends (transform/rules.ts, zone-auras.ts)."
  ),
  "spell:pass-without-trace": enforced(
    "zone-auras.ts gives the caster and its allies +10 to Dexterity (Stealth) checks while they stand in the 30-foot Emanation. Leaving no tracks is the GM's to narrate."
  ),
  "spell:plant-growth": guided(
    "Overgrowth makes a creature spend 4 feet of movement for every foot it moves in the Sphere (zone-ground.ts), until the GM ends the area, and the caster leaves squares of it out as it casts (zone-later.ts). The 8-hour Enrichment is the GM's."
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
    "spell-zones.ts asks for the Dexterity save the first time a creature enters the webs on a turn or starts its turn there, and a failure leaves it Restrained, escaped with a Strength (Athletics) check against the spell save DC. A move that enters it waits there on the save, and a failure ends the move (zone-stops.ts, held-moves.ts). zone-ground.ts makes the webs Difficult Terrain, and they are Lightly Obscured for dynamic vision (vision/cast-sight.ts). Fire burns them (zone-fire.ts): a 5-foot square that Fire damage, a fire's area or a burning creature reaches burns for a round, dealing 2d4 Fire damage to a creature that starts its turn there, and is then gone, and the spell ends with the last of the webs."
  ),
  "action:Octopus/ink-cloud": enforced(
    "triggered-reactions.ts offers it in an underwater fight when a creature ends its turn within 5 feet of the octopus. Using it fills a 5-foot Cube around the octopus with ink, Heavily Obscured for 1 minute (vision/cast-sight.ts), and gives a swim of its Swim Speed (granted-moves.ts). A strong current dispersing the ink is the GM's."
  ),
  "action:Giant Octopus/ink-cloud": enforced(
    "triggered-reactions.ts offers it when the octopus takes damage in an underwater fight. Using it fills a 10-foot Cube around the octopus with ink, Heavily Obscured for 1 minute (vision/cast-sight.ts), and gives a swim of its Swim Speed (granted-moves.ts). A strong current dispersing the ink is the GM's."
  ),
  "spell:sorcerous-burst": enforced(
    "The attack and the chosen damage type are applied, with the cantrip's dice at the caster's level, and each 8 rolled on its d8s adds another d8, the added dice exploding too, up to the caster's spellcasting ability modifier in added dice (resolution/damage.ts)."
  ),
  "spell:spirit-guardians": enforced(
    "spell-zones.ts asks for the save when a creature enters the Emanation or ends its turn there, and charges an affected creature double for each step it moves inside (terrain.ts). The creatures the caster designates are its allies."
  ),
  "spell:storm-of-vengeance": enforced(
    "The first turn's save, Thunder damage and Deafened condition are applied, and spell-zones.ts runs turns 2 to 10 at the start of each of the caster's later turns under the cloud: the acid rain, the six bolts the caster calls with a Magic action (zone-later.ts), the hail, and the freezing rain that makes the ground Difficult Terrain, Heavily Obscures it, stops ranged weapon attacks and puts out open flames. Whether it is outdoors is the GM's."
  ),
  "spell:tsunami": enforced(
    "The wall's first save and damage are applied. At the start of each of the caster's later turns zone-waves.ts moves it 50 feet away from the caster with the creatures in it, each Huge or smaller creature in it or that it moves onto making the save once a round, and at the end of that turn it loses 50 feet of height and 1d10 of its damage, ending at none. A creature in it can't move unless it first succeeds on a Strength (Athletics) check against the spell save DC. A fall from the wall's top is the GM's."
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
    "Creature into Creature is applied (transform/): an unwilling target saves, a willing one doesn't, and it takes a stat block of its Challenge Rating or lower with Temporary Hit Points equal to its Hit Points, no speech or spells. Held for the full hour of Concentration, the form lasts until dispelled (effects.ts). Object into Creature and Creature into Object are the GM's: neither an object nor an object form is a game piece yet."
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
  "spell:wind-walk": enforced(
    "Each willing target becomes a cloud with a Fly Speed of 300 feet that hovers, Immunity to Prone and Resistance to Bludgeoning, Piercing and Slashing damage; it can only Dash or take the Magic action that ends the form, which leaves it Stunned for 1 minute. While the spell lasts each target keeps a Magic action that makes it a cloud again, Stunned for the minute of the change (resolution/shape-shift.ts, granted-actions.ts). A cloud whose form ends in the air drifts down safely, and one more than 600 feet up falls the rest (altitude.ts, falling.ts)."
  ),
  "spell:magic-jar": guided(
    "The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. The caster's catatonic body, the possession of a Humanoid (its Charisma save, the host's physical statistics over the caster's, the host's soul held in the container) and the returns and deaths that follow are the GM's: possession over a composed form and command has no vocabulary yet."
  ),
  "item:potion-of-growth": enforced(
    "Drinking it makes the drinker one size larger for 10 minutes, with Advantage on Strength checks and saves and 1d4 more damage with weapons and Unarmed Strikes. The token takes the new size (transform/forms.ts)."
  ),
  "item:potion-of-diminution": enforced(
    "Drinking it makes the drinker one size smaller for 1d4 hours, rolled by the server, with Disadvantage on Strength checks and saves and 1d4 less damage with weapons and Unarmed Strikes, never below 1 (resolution/damage.ts)."
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
  "feature:restoring-touch": enforced(
    "From Paladin 14 a use of Lay on Hands on a creature it touches also ends any of Blinded, Charmed, Deafened, Frightened, Paralyzed and Stunned the Paladin picks in the target picker, 5 points of the pool each, beside the Hit Points it restores (resolution/heal.ts)."
  ),
  "feature:preserve-life": enforced(
    "A use of Channel Divinity divides up to five times the Cleric level in Hit Points among Bloodied creatures within 30 feet, as the Cleric splits them in the target picker or else evenly, none above half its Hit Point maximum (resolution/heal.ts)."
  ),
  "feature:hunters-lore": enforced(
    "While a Hunter's Mark of the Ranger's lasts on a creature, its player's target list shows that creature's damage Immunities, Resistances and Vulnerabilities and its condition Immunities, which no other player receives (hunters-lore.ts, projections.ts)."
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
  "feature:hunters-prey": enforced(
    "The option is picked at build and swapped after a Short or Long Rest (ledger-rechoice.ts). Colossus Slayer's extra 1d8 on a weapon hit against a creature missing any Hit Points is applied once a turn (resolution/damage.ts). Horde Breaker opens one more attack with the same weapon once a turn, against a creature within 5 feet of the first target that it hasn't attacked this turn (resolution/extra-attacks.ts, resolution/economy.ts)."
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
  "feature:empowered-evocation": enforced(
    "The Intelligence modifier is added to one damage roll of a Wizard Evocation spell, the first a cast makes (resolution/damage.ts): Scorching Ray's first ray, not the others."
  ),
  "feature:elemental-affinity": enforced(
    "Resistance to the chosen type is applied, and the Charisma modifier is added to one damage roll of a spell that deals that type, the first a cast makes, never a weapon's (resolution/damage.ts)."
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
    "inventory.ts rolls its 1d6 + 3 beads when it is added, and each bead casts a level 3 Fireball at DC 15 and never comes back; up to five hurled at once add 1d6 each, to 12d6 (item-actions.ts)."
  ),
  "item:chime-of-opening": enforced(
    "Each strike casts Knock on its 10 charges, which never come back, and the last one cracks it (resolution/charges.ts)."
  ),
  "item:ring-of-three-wishes": guided(
    "Its three Wish casts are counted and never come back, and the ring is nonmagical after the last (resolution/charges.ts, item-spent.ts). What a Wish does is the GM's."
  ),
  "item:gem-of-brightness": enforced(
    "Its light is lit and put out on the row, and its beam (1 charge) and flare (5 charges) open the DC 15 Constitution save against Blinded on its 50 charges, which never come back; with none left it is a plain jewel that no longer lights (item-spent.ts)."
  ),
  "item:rod-of-resurrection": enforced(
    "Its casts spend their printed charges, and it regains 1 charge at dawn or at a Long Rest (item-charges.ts)."
  ),
  "item:cube-of-force": guided(
    "Mage Armor, Shield (a Reaction when its holder is hit), Tiny Hut, Private Sanctum, Resilient Sphere and Wall of Force are casts at DC 17 on its 10 charges at their printed costs, 1d6 back at dawn (item-actions.ts). It takes the state of Tiny Hut and Private Sanctum."
  ),
  "item:potion-of-water-breathing": enforced(
    "Drinking it lets the drinker breathe underwater for 24 hours of game time (breath.ts)."
  ),
  "item:ring-of-spell-turning": guided(
    "Its wearer has Advantage on saves against spells, and a successful save against a spell of level 7 or lower leaves the spell no effect on it: no half damage, nothing a success would leave (saving-throws.ts). Deflecting a spell that targeted only the wearer back at its caster is the GM's."
  ),
  "item:candle-of-invocation": guided(
    "Lit, it sheds Dim Light 30 feet for its 4 hours (item-light.ts), and while it burns its attuned bearer has Advantage on attack rolls, saves, checks and Initiative. It casts Gate once, which destroys it. Whether an alignment matches the candle's, the others in its light, slot-free level 1 spells for a Cleric or Druid, Gate only at the first lighting, and the minutes a snuffed candle keeps are the GM's."
  ),
  "item:crystal-ball-of-mind-reading": guided(
    "It casts Scrying at DC 17, and Detect Thoughts at DC 17 only through that Scrying: it takes no Concentration of its own and ends with the Scrying (resolution/concentration.ts). Which creatures stand within 30 feet of the sensor is the GM's."
  ),
  "item:crystal-ball-of-telepathy": guided(
    "It casts Scrying at DC 17, and Suggestion at DC 17 once a dawn only through that Scrying: it takes no Concentration of its own and ends with the Scrying (resolution/concentration.ts). Speaking telepathically with creatures near the sensor, and which of them it can reach, are the GM's."
  ),
  "item:potion-of-mind-reading": guided(
    "Drunk, it is used up and its drinker bears Detect Thoughts for 10 minutes with no Concentration. The thoughts it reads, and the DC 13 save a creature makes against a deeper probe, are the GM's."
  ),
  "item:amulet-of-the-planes": guided(
    "Its Plane Shift is cast only after a DC 15 Intelligence (Arcana) check, which the server rolls in a fight and outside one; a failure spends the action and casts nothing (cast-check.ts). Where a failure sends its wearer and those within 15 feet, on the d100 table, is the GM's."
  ),
  "item:ring-of-the-ram": enforced(
    "Each of its three actions spends 1 to 3 of its 3 charges (1d3 back at dawn) on a ranged spell attack at its printed +7 against a creature within 60 feet, dealing 2d10 Force and pushing it 5 feet for each charge. Aimed at a door on the map it sees within 60 feet, the same charges make a Strength check at +5 a charge against the highest DC of what holds the door shut (10 more under an Arcane Lock), and a success breaks it open; Sovereign Glue and Stone Shape's seal don't give (resolution/door-work.ts, doors.ts). The DC to break any other object, which the SRD doesn't print, is the GM's."
  ),
  "item:immovable-rod": guided(
    "Its Utilize action fixes the rod against a closed door on the map within reach, which it holds shut: the rod leaves its bearer's hands, a DC 30 Strength (Athletics) check forcing the door moves it back to whoever fixed it, and a creature beside the door can push its button with a Utilize action and take it (resolution/door-work.ts, doors.ts). The rod fixed anywhere else, as a ladder rung, a bar or a weight holding 8,000 pounds, is open-ended use the GM rules on."
  ),
  "item:sovereign-glue": guided(
    "Its 1d6 + 1 ounces are rolled when it is added and counted. A Utilize action spends an ounce to glue a closed door on the map within reach shut; a minute later the glue has set, and then no check, tool, Knock or Ring of the Ram opens it until Universal Solvent dissolves it (resolution/door-work.ts, doors.ts). Bonding any other two objects, and Oil of Etherealness or Wish breaking the bond, are the GM's."
  ),
  "item:universal-solvent": guided(
    "Its 1d6 + 1 ounces are rolled when it is added and counted. A Utilize action spends an ounce on a door on the map within reach and dissolves the Sovereign Glue that holds it (resolution/door-work.ts, doors.ts). Dissolving any other adhesive is the GM's."
  ),
  "item:wand-of-secrets": enforced(
    "Its Magic action spends 1 of its 3 charges (1d3 back at dawn): if a secret door on the map or a hidden trap or glyph lies within 60 feet of its holder, the table hears which way the wand points at the nearest, and the GM what it is and how far (resolution/door-work.ts)."
  ),
  "item:dragon-orb": guided(
    "Peering into it is a DC 15 Charisma save its user makes: a success gives control of the orb, and a failure leaves the user Charmed by it while attuned, and a player can't end that attunement (attunement.ts); the GM ending the attunement ends either. Only a user who controls it casts its spells, at their printed charges from 7 (1d4 + 3 back at dawn): Cure Wounds at level 9 for 4, Daylight for 1, Death Ward for 2, Detect Magic for none, Scrying at DC 18 for 3; and Call Dragons waits an hour of game time (clock-pools.ts). The Suggestion it casts on a charmed user and its AC 20 are the GM's."
  ),
  "item:carpet-of-flying": enforced(
    "The GM says which of the four sizes a carpet is, and a Magic action makes it hover and fly with its user at that size's Fly Speed until it lands (falling.ts). Its weight limits and half speed, and steering it from 30 feet away, need what the sheet doesn't record."
  ),
  "item:horn-of-blasting": enforced(
    "Its blast fills a 30-foot Cone with a DC 15 Constitution save: 5d8 Thunder and Deafened for 1 minute on a failure, half on a success. Each use rolls the d100 for its 20 percent chance to explode, dealing 10d6 Force to its user and destroying it (resolution/charges.ts, item-breaks.ts). The glass and crystal objects it shatters are story."
  ),
  "item:bag-of-beans": guided(
    "inventory.ts rolls its 3d4 beans when it is added, which never come back, and the bag is a plain one once they are gone. Dumped beans explode in a 10-foot Sphere, DC 15 Dexterity for 5d4 Force, half on a success. What a planted bean grows, on its d100 table, is the GM's."
  ),
  "item:oil-of-slipperiness": enforced(
    "Applied, it is used up and its creature has Freedom of Movement's effect for 8 hours: a Swim Speed equal to its Speed, and no Paralyzed or Restrained. Poured, it is used up and casts Grease on its 10-foot square, which lasts 8 hours (item-actions.ts `castLastsMinutes`, resolution/concentration.ts)."
  ),
  "item:well-of-many-worlds": guided(
    "Opening a portal starts its wait of 1d8 hours of game time before the next (clock-pools.ts). Where a portal leads, and what passes through, are the GM's."
  ),
  "item:wand-of-paralysis": enforced(
    "Its ray (1 of 7 charges, 1d6 + 1 back at dawn) opens a DC 15 Constitution save against Paralyzed for 1 minute on one creature it sees within 60 feet, repeated at each turn's end, and a 1 on the last charge's d20 destroys it (resolution/charges.ts). Only a spellcaster attunes to it."
  ),
  "item:wand-of-polymorph": enforced(
    "Polymorph at DC 15 on 7 charges, 1d6 + 1 back at dawn, a 1 on the last charge's d20 destroying it (resolution/charges.ts); only a spellcaster attunes to it."
  ),
  "item:wand-of-fear": guided(
    "Command (Flee or Grovel only, 1 charge) and Fear in a 60-foot Cone (3 charges) at DC 15 on 7 charges, 1d6 + 1 back at dawn, a 1 on the last charge's d20 destroying it (item-actions.ts, resolution/charges.ts). It takes Fear's state."
  ),

  // Walls, doors and objects on the map (spell-walls.ts, doors.ts, objects.ts, enclosures.ts, zone-walls.ts).
  "spell:wall-of-force": enforced(
    "The cast raises the wall on its placed Line as walls that stop movement and leave sight through (spell-walls.ts). A creature in its space is moved out of it, the caster's allies to the caster's side and the rest to the far side. Nothing damages it, Disintegrate destroys it whole and ends the spell, and it goes when the Concentration ends. Picked as a dome or globe, it is raised round the 10-foot circle the cast places, holding in or out the creatures it rings (resolution/cast-walls.ts). Its angle off the ground and its reach into the Ethereal Plane are the GM's."
  ),
  "spell:wall-of-stone": enforced(
    "The cast raises the wall on its placed Line as 10-foot stone panels that stop movement and sight, each an object with AC 15, 180 Hit Points and Immunity to Poison and Psychic damage that is gone at 0 Hit Points (spell-walls.ts, objects.ts); picked as the thin form, it raises 20-foot panels of 90 Hit Points along a Line twice as long. A creature in its space is moved out of it. The wall stays for good once the caster holds Concentration for the full 10 minutes, and goes if the Concentration ends sooner. Its bridges, ramps and battlements, the panels that fall with a broken one, and the save of a creature it would shut in against the map's other walls are the GM's."
  ),
  "spell:forcecage": enforced(
    "The cast raises the 20-foot cage on its placed Cube as bars that stop movement and leave sight, attacks and spells through (spell-walls.ts), and moves a creature standing in the bars out of them. A creature that teleports out first makes a Charisma save against the caster's spell save DC, which the server rolls, and a failure keeps it in and wastes the teleport (forcecage.ts). Disintegrate destroys the cage, and it goes when the spell ends. The solid 10-foot box and its reach into the Ethereal Plane are the GM's."
  ),
  "spell:wall-of-fire": enforced(
    "spell-zones.ts deals 5d8 Fire damage to a creature that enters the wall for the first time on a turn or ends its turn in it, after the cast's Dexterity save, and the wall blocks sight for dynamic vision (vision/cast-sight.ts). The cast picks a straight wall or a ring and its burning side, and a creature that ends its turn within 10 feet of that side takes the damage too (zone-shapes.ts)."
  ),
  "spell:knock": enforced(
    "Aimed at a door on the map that the caster sees within 60 feet, it takes away one of what holds it shut, a lock, a stuck or barred state or a spike, and holds an Arcane Lock off for 10 minutes (doors.ts). A door Stone Shape sealed stays shut. The knock heard 300 feet away is the table's."
  ),
  "spell:arcane-lock": enforced(
    "Aimed at a door on the map the caster touches, it locks the door against everyone but the caster and the creatures named as the cast's targets (doors.ts). Thieves' Tools can't pick it, a Strength check can't force it, and Knock holds it off for 10 minutes. The password and the higher DC to break it are the GM's."
  ),
  "spell:passwall": enforced(
    "Aimed at a wall on the map within 30 feet that the caster sees, it cuts a 5-foot passage that sight and movement pass through for the hour (spell-walls.ts). When it closes, a creature still in the passage is moved out to the nearest unoccupied space on the side it was cut from. Whether a surface is wood, plaster or stone is the GM's, since the map's walls carry no material."
  ),
  "spell:stone-shape": guided(
    "Aimed at a door on the map the caster touches, it seals the door shut so that no check opens it; aimed at a wall, it cuts a lasting 5-foot passage through it (spell-walls.ts, doors.ts). The other shapes it makes are the GM's."
  ),
  "spell:elementalism": guided(
    "Beckon Air aimed at a door on the map within 30 feet slams it shut (resolution/cast-walls.ts), and Beckon Fire lights a flame the GM set on the map, or the light a targeted creature carries, within 30 feet (resolution/cast-lights.ts). Beckon Earth, Beckon Water, Sculpt Element and the smoke's scent are harmless descriptions."
  ),
  "spell:resilient-sphere": enforced(
    "A failed Dexterity save shuts the target in the sphere while the caster concentrates (enclosures.ts). An attack or spell on it from outside, or from it on anything outside, meets Total Cover's refusal, and an area leaves it out. Disintegrate aimed at it destroys the sphere, harms nothing inside and ends the spell. Rolling the sphere along, and a willing target, are the GM's."
  ),
  "spell:tiny-hut": enforced(
    "The dome stays where it was cast (zone-barriers.ts): only the creatures inside it at the cast pass through it, and a spell of level 3 or lower cast from outside can't reach inside. The cast fails while a creature's space lies partly in the dome. Those outside can't see in while those inside see out (resolution/zone-casts.ts, vision/sight.ts), the cast commands Dim Light or Darkness inside, and the spell ends when its caster leaves the dome (zone-auras.ts). Commanding the light again after the cast, the dome's colour and the weather inside are the GM's."
  ),
  "item:bead-of-force": enforced(
    "Throwing a bead uses it up: each creature in the 10-foot-radius Sphere makes the DC 15 Dexterity save or takes 5d4 Force damage, and one that fails is shut in the sphere for a minute, which no attack or effect passes (enclosures.ts). Pushing out the creatures that saved, and rolling the sphere, are the GM's."
  ),
  "item:holy-water": enforced(
    "Thrown in place of an attack at a creature the thrower sees within 20 feet: on a failed Dexterity save a Fiend or an Undead takes 2d8 Radiant damage, and any other creature nothing, though the flask is used (resolution/type-gates.ts)."
  ),
  "item:amulet-of-proof-against-detection-and-location": enforced(
    "While it is worn and attuned, a Divination spell can't target its wearer, catch it in its area or sense it (resolution/spell-wards.ts), unless the wearer allows it, which it does for a spell cast by its own side. Being seen through a scrying sensor is the GM's, as the sensor is."
  ),
  "item:ring-of-mind-shielding": enforced(
    "While it is worn and attuned, Detect Thoughts can't target its wearer, Zone of Truth doesn't hold it, and no magical sense that tells a creature's type finds it, Detect Evil and Good and Divine Sense included (resolution/spell-wards.ts, vision/detect.ts). Telepathy, the imperceptible ring and the soul it can hold are the GM's."
  ),
  "item:trident-of-fish-command": guided(
    "A charge casts Dominate Beast at DC 15 on a creature with a Swim Speed (resolution/action-targets.ts), which affects only a Beast (resolution/type-gates.ts); it has 3 charges and regains 1d3 at dawn, and the cast takes the spell's state. What the Beast does under it is the GM's."
  ),
  "item:net": enforced(
    "Thrown in place of an attack at a Large or smaller creature the thrower sees within 15 feet, a failed Dexterity save leaves it Restrained, escaped with a DC 10 Strength (Athletics) check by it or by a creature within 5 feet of it, as that creature's action (resolution/endings.ts). The Net is an object with AC 10 and 5 Hit Points, immune to Bludgeoning, Poison and Psychic damage, and an attack that breaks it frees the creature (objects.ts)."
  ),
  "item:thieves-tools": guided(
    "door.use's pick rolls a Dexterity (Sleight of Hand) check with the tools against a lock on a door of the map, DC 15 unless the GM sets another, and unlocks it on a success (doors.ts). Its Utilize uses roll from the sheet at their DCs (tool-uses.ts), and every use takes the Utilize action in a fight. Picking Manacles' lock is an action of the creature holding the tools beside the bound one (resolution/endings.ts). Disarming a trap is the GM's, rolled as the sheet's check."
  ),
  "item:carpenters-tools": guided(
    "door.use pries a door on the map open, or seals a closed one, with a DC 20 Strength check with the tools, taking the Utilize action in a fight (doors.ts). A sealed door is forced open at DC 20. Its sheet use takes the Utilize action too (tool-uses.ts), and crafting.ts makes what its Craft line lists in downtime. Prying a container open is the GM's, rolled as the sheet's check: no container has a lid to pry."
  ),
  "item:smiths-tools": guided(
    "door.use pries a door on the map open with a DC 20 Strength check with the tools, taking the Utilize action in a fight (doors.ts). Its sheet use takes the Utilize action too (tool-uses.ts), and crafting.ts makes what its Craft line lists in downtime, the melee weapons and the armor its bands name among them. Prying a container open is the GM's, rolled as the sheet's check: no container has a lid to pry."
  ),
  "item:lock": enforced(
    "A door on the map can be locked (the GM's door editor): it stays shut against everyone but the creatures holding its key, and Thieves' Tools pick it with a DC 15 Dexterity (Sleight of Hand) check (doors.ts)."
  ),
  "item:bag-of-holding": enforced(
    "It holds 500 pounds in the Gear tab and weighs 5 pounds whatever it holds (containers.ts, carrying.ts). Retrieving a thing from it takes the Utilize action in a fight. A GM write that overloads it, or puts it inside another extradimensional space, destroys it and spills what it held, and a player is refused instead (containers.ts). Where its contents scatter is the GM's."
  ),
  "item:handy-haversack": enforced(
    "Its central pouch holds 500 pounds and each side pouch 200, picked in the Gear tab; it weighs 5 pounds whatever it holds (containers.ts, carrying.ts). Retrieving a thing from it takes a Bonus Action, or the Utilize action. Overloading it, or putting it in another extradimensional space, destroys it as a Bag of Holding."
  ),
  "item:efficient-quiver": enforced(
    "Its compartments hold 60 pieces of ammunition, 18 javelins or similar, and 6 long objects such as bows or staffs, picked in the Gear tab; it weighs 2 pounds whatever it holds, and ammunition is fired from it (containers.ts, ammunition.ts)."
  ),
  "item:portable-hole": guided(
    "As a container it weighs nothing whatever it holds, and putting it in another extradimensional space destroys both (containers.ts). Folding it shut holds the creatures in the open hole off the map until each forces its way out with an action and a DC 10 Strength (Athletics) check, coming back beside it (off-plane.ts). The open hole on the map and its air are the GM's."
  ),
  "item:oil-of-sharpness": enforced(
    "Applying it outside a fight makes one carried Slashing or Piercing weapon, or up to 20 pieces of ammunition, a +3 Weapon or +3 Ammunition (resolution/rebind.ts), and the vial is spent."
  ),
  "item:ammunition-of-slaying": enforced(
    "The GM picks the creature type it slays. A hit on a creature of that type makes it take the DC 17 Constitution save for 6d10 Force damage, half on a success, and spends the piece's magic; a hit on another creature keeps it (resolution/ammunition.ts)."
  ),
  "item:backpack": enforced(
    "It holds 30 pounds of gear in the Gear tab, weighed with its bearer's load (containers.ts, carrying.ts). Taking a thing out in a fight is the turn's free object interaction, and a second takes the Utilize action (object-interactions.ts)."
  ),
  "item:basket": enforced(
    "It holds 40 pounds of gear in the Gear tab, weighed with its bearer's load (containers.ts, carrying.ts). Taking a thing out in a fight is the turn's free object interaction, and a second takes the Utilize action (object-interactions.ts)."
  ),
  "item:pouch": enforced(
    "It holds 6 pounds of gear in the Gear tab, weighed with its bearer's load, and ammunition in it can be fired (containers.ts, ammunition.ts). Taking a thing out in a fight is the turn's free object interaction, and a second takes the Utilize action (object-interactions.ts)."
  ),
  "item:sack": enforced(
    "It holds 30 pounds of gear in the Gear tab, weighed with its bearer's load (containers.ts, carrying.ts). Taking a thing out in a fight is the turn's free object interaction, and a second takes the Utilize action (object-interactions.ts)."
  ),
  "item:quiver": enforced(
    "It holds 20 Arrows in the Gear tab, which can be fired from it (containers.ts, ammunition.ts)."
  ),
  "item:crossbow-bolt-case": enforced(
    "It holds 20 Bolts in the Gear tab, which can be fired from it (containers.ts, ammunition.ts)."
  ),
  "item:climbers-kit": enforced(
    "Its action anchors its user where it stands, and from then on the user can't move more than 25 feet from that point (movement-rules.ts) or fall more than 25 feet below it (falling.ts); a Bonus Action undoes the anchor."
  ),
  "item:torch": enforced(
    "A lit Torch swings as a Simple Melee weapon for 1 Fire damage (equipment-derivation.ts), and its light is item-light.ts's."
  ),
  "item:basic-poison": enforced(
    "Its Bonus Action coats one carried weapon, or three pieces of one stack of ammunition, that the user picks (resolution/grant-extras.ts): for 1 minute a Piercing or Slashing hit with that weapon or ammunition alone deals the extra 1d4 Poison damage, which spends the coat."
  ),
  "item:saddle-exotic": enforced(
    "A mount that flies or swims needs one to be ridden: mounts.ts refuses a rider without it."
  ),
  "item:saddle-military": enforced(
    "Its rider has Advantage on the Dexterity save to stay mounted when the mount is moved against its will or knocked Prone (mounts.ts)."
  ),
  "item:saddle-riding": reference("Riding needs no saddle the app checks: one in the mount's inventory reads as tack."),
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
  ),
  "action:Ghost/etherealness": enforced(
    "Casts Etherealness with no components (monster-spells.ts): the ghost's token stays on the map on the Border Ethereal, seen from the Material Plane as its text says but out of reach of the creatures there, moving in any direction through walls and creatures, and back where its token stands when it ends the spell, shunted with 2 Force damage a foot from a filled space (ethereal.ts, off-plane.ts). Which planes border which is story."
  ),
  "action:Incubus/spellcasting": enforced(
    "Casts its listed spells at the stat block's numbers (monster-spells.ts); Etherealness keeps it on the Border Ethereal on the map (ethereal.ts), and Dream, Disguise Self and Hypnotic Pattern apply as their own rows say, the incubus being Dream's messenger."
  ),
  "action:Night Hag/spellcasting": guided(
    "Casts its listed spells at the stat block's numbers (monster-spells.ts); Etherealness keeps it on the Border Ethereal on the map (ethereal.ts). Plane Shift's journey off the scene to another plane is the GM's."
  ),
  "item:oil-of-etherealness": guided(
    "Applying it covers one Medium or smaller creature within reach and is used up: the creature steps onto the Border Ethereal for 1 hour, as the Etherealness spell (ethereal.ts, off-plane.ts). The 10 minutes the application takes are the GM's to pass on the game clock."
  ),
  "item:plate-armor-of-etherealness": enforced(
    "Its Magic action, once a dawn (a Long Rest), puts the wearer on the Border Ethereal as the Etherealness spell for up to 8 hours (ethereal.ts); repeating the command word ends it with no new use, and taking the armor off ends it (inventory.ts)."
  ),
  "spell:meld-into-stone": guided(
    "The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. The caster merges with the stone for 8 hours: off the map, unseen and untouchable from outside and blind to it, casting only on itself, its Wisdom (Perception) checks to hear outside at Disadvantage, and back where it entered (off-plane.ts). Stepping out with 5 feet of movement is the GM's ending of the effect until an effect can be ended with movement; whether the stone is damaged enough to expel it (6d6 or 50 Force and Prone) is the GM's call, the stone not being on the map."
  ),
  "spell:rope-trick": enforced(
    "The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. Up to eight willing Medium or smaller creatures beside the rope, named at the cast, climb into its space for the hour: off the map, where nothing passes in or out (off-plane.ts), and they drop out where each left when it ends. Where the rope hangs, and a creature climbing in later, are the GM's."
  ),
  "spell:transport-via-plants": guided(
    "The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. The two plants, which ones qualify, and the creatures stepping from one to the other for 5 feet of movement are the GM's: plants aren't map pieces, and a teleport offered to any creature beside a marker has no vocabulary yet."
  ),
  "spell:tree-stride": enforced(
    "The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. Once on each of the caster's turns while it concentrates it may teleport up to 500 feet, seen or not, from one tree to another for 10 feet of movement (granted-moves.ts, movement-rules.ts). Where the trees stand and which share a kind are the GM's: trees aren't map pieces."
  ),
  "spell:simulacrum": guided(
    "The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. The copy of a Beast or Humanoid (a Construct with half its Hit Point maximum under the caster's command), its repair at 100 GP a Hit Point during a Long Rest and its end at 0 Hit Points or on a new casting are the GM's: a summon copied from a creature on the roster has no vocabulary yet."
  ),
  "spell:clairvoyance": enforced(
    "The cast takes its 10 minutes and needs a 100 GP focus (resolution/components.ts). On this map the Invisible sensor is a marker that stays put and that its caster's player sees through while it lasts (summons.ts, vision/audience.ts), seen by Truesight or See Invisibility, and a creature a Divination ward guards (Nondetection) isn't seen through it. A sensor elsewhere, choosing hearing in place of sight and what it hears are the GM's."
  ),
  "spell:druidcraft": guided(
    "The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. Fire Play lights or snuffs a flame within 30 feet: a light the GM set on the map, tapped while aiming, or the burning light a targeted creature carries (resolution/cast-lights.ts). Weather Sensor, Bloom and the Sensory Effect are harmless descriptions."
  ),
  "spell:darkness": enforced(
    "Magical Darkness fills a 15-foot Sphere at a point, or cast on a creature an Emanation round the object it carries that moves with it, which Darkvision can't see through and nonmagical light can't brighten, and it dispels spell light of level 2 or lower it overlaps (vision/cast-sight.ts). An object covered by a bowl or helm is the table's to say."
  ),
  "item:frost-brand": enforced(
    "The extra 1d6 Cold on a hit and Resistance to Fire while held are applied, and drawing it can put out the nonmagical flames within 30 feet, the GM's lights on the map and the burning lights creatures carry, once an hour of game time (resolution/cast-lights.ts). Its light in freezing cold depends on weather the app doesn't track."
  ),
  "spell:detect-magic": enforced(
    "The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. For the duration the caster senses magic within 30 feet, blocked by walls (vision/detect.ts); its later Magic action shows its player a faint aura on each creature in sight bearing a magic item or a spell's effect, with those spells' schools. Magic in scenery that isn't a game piece (a warded wall, a hidden glyph) is the GM's to describe."
  ),
  "spell:detect-poison-and-disease": enforced(
    "The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. For the duration its player is shown, within 30 feet and not through a wall, each creature carrying a poison, each poisonous or venomous creature and each with a magical contagion, with the kind (vision/detect.ts). Poisons in scenery and food that aren't game pieces are the GM's."
  ),
  "item:wand-of-enemy-detection": enforced(
    "Its 7 charges (1d6 + 1 back at dawn, a 1 on the last one's d20 destroying it) each show its holder's player, for a minute, the direction of the nearest Hostile creature within 60 feet, hidden or not, but not its distance (vision/detect.ts); it ends when the wand is put away."
  ),
  "item:bag-of-devouring": guided(
    "The 50 percent pull of a creature that reaches in, the creature inside escaping with a DC 15 Strength (Athletics) check or being pulled out with DC 20, and its devouring at the start of its turn are the GM's until random outcomes and a death at a turn's start are vocabulary; what it eats and what it spits to another plane are story."
  ),
  "item:mirror-of-life-trapping": guided(
    "The hung mirror as an object, the DC 15 Charisma save of a creature that sees its reflection within 30 feet, the twelve cells off the map, freeing a named creature and its shattering are the GM's: a sight-gated area save from an object on a wall has no vocabulary yet. Talking with a trapped creature is story."
  ),
  "item:rod-of-security": guided(
    "Its Magic action takes its user and up to 20 willing creatures it sees off the map to its demiplane, and the action again brings every visitor back to the space it left or the nearest unoccupied one; it then waits 240 hours of game time (off-plane.ts, clock-pools.ts). The hourly healing as a spent Hit Point Die, the days the visitors may stay and more than 20 visitors are the GM's; the demiplane is story."
  ),
  "item:dimensional-shackles": enforced(
    "Its Utilize action places them on an Incapacitated creature of Large size or smaller within reach: it can't teleport or leave the plane by its own means (ethereal.ts, movement-rules.ts). The action again on it removes them, and its DC 30 Strength (Athletics) check breaks them (builtin-actions.ts). That the check comes once in 30 days, a creature its user names removing them, and the broken shackles' loss are the GM's."
  ),
  "item:hat-of-disguise": guided(
    "Its Disguise Self cast leaves the disguise on its wearer, which ends when the hat is taken off (inventory.ts). How the disguise looks and who sees through it are the GM's."
  ),
  "spell:disguise-self": guided(
    "The cast spends its action and checks its components (resolution/economy.ts, resolution/components.ts), and the table is told. The disguise is an effect on the caster for the hour. How it looks, and who sees through it with a Study action, are the GM's."
  )
};

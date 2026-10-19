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
const reference = (note: string): CuratedCoverage => ({ state: "reference", note });

export const CONDITION_COVERAGE: Readonly<Record<string, CuratedCoverage>> = {
  blinded: enforced(
    "resolution/attack.ts: its attack rolls have Disadvantage and attack rolls against it have Advantage. ability-checks.ts fails its Perception check to find a creature unless its Blindsight reaches it. movement-rules.ts: it makes an Opportunity Attack only against a mover in its Blindsight, and with dynamic vision on vision/sight.ts lets it see only within Blindsight. The GM rules on other checks that need sight."
  ),
  charmed: guided(
    "resolution/economy.ts: a creature Charmed by a spell or an action can't attack its charmer or target it with a save or damage. A Charmed chip the GM sets names no charmer, so nothing is refused. The charmer's Advantage on social checks is the GM's."
  ),
  deafened: guided(
    "actor-conditions.ts tracks it on the creature. The GM rules on checks that need hearing; nothing else in the condition changes a roll."
  ),
  exhaustion: enforced(
    "condition-rules.ts takes 2 per level from every D20 Test, and speed.ts takes 5 feet per level from Speed. effects.ts kills the creature at level 6, and rests.ts removes a level on each Long Rest."
  ),
  frightened: enforced(
    "resolution/attack.ts, ability-checks.ts and encounter.ts give it Disadvantage on attack rolls, ability checks and Initiative while the source of its fear is within line of sight (vision/rules.ts; always with dynamic vision off, or when the GM set the condition by hand). movement-rules.ts refuses a willing move that takes it closer to the source."
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
    "effects.ts adds Prone, and it counts as Incapacitated with Speed 0. saving-throws.ts fails its Strength and Dexterity saves. resolution/attack.ts gives attack rolls against it Advantage and makes a hit from within 5 feet a Critical Hit. Dropping what it holds is the GM's."
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
  attitude: reference("Attitudes aren't tracked. The GM decides how a monster responds to Influence."),
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
  "breaking-objects": reference("Objects have no AC or Hit Points in the app."),
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
    "A cantrip is cast with no slot, and its damage grows at the character levels its row prints (cantripTierAt in the content package)."
  ),
  "carrying-capacity": reference("Weight carried isn't checked against Strength."),
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
    "resolution/concentration.ts ends the first Concentration spell when a second starts. hit-points.ts asks for a Constitution save against DC 10 or half the damage, up to 30, and effects.ts ends it when the caster is Incapacitated or dies."
  ),
  condition: enforced(
    "effects.ts applies every condition through applyCondition, which honours immunities, and ends it when its duration or its save says."
  ),
  cone: areaShape("its width at any point equals that point's distance from the origin."),
  cover: enforced(
    "With dynamic vision on, cover.ts works out Half, Three-Quarters and Total Cover from the walls between the attacker or the effect's origin and the target, and Half Cover from a creature in the way; the GM can mark more. The server adds 2 or 5 to AC and Dexterity saves, and resolution/validate.ts refuses an attack against Total Cover."
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
    "inventory.ts hides a cursed item's curse until it is attuned, and its bearer can't end the Attunement. Other curses, and the magic that ends them, are the GM's to track."
  ),
  cylinder: areaShape("a Cylinder is drawn as a circle of its radius, and its height is the GM's."),
  "d20-test": enforced(
    "Ability checks, attack rolls and saving throws all roll on the server, and riders that name D20 Tests reach each of them."
  ),
  damage: enforced("hit-points.ts takes damage off Temporary Hit Points first and then Hit Points."),
  "damage-roll": enforced("The server rolls damage dice and adds the modifiers the action carries."),
  "damage-threshold": reference("Nothing in the app has a damage threshold."),
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
  dehydration: reference("Water isn't tracked."),
  "difficult-terrain": enforced(
    "The GM paints difficult terrain on the map (terrain.ts), and movement-rules.ts charges double through it and through an enemy's space."
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
  "experience-points": reference(
    "The bestiary prints each monster's XP. Characters' XP isn't tracked, and the GM levels a character up in the builder."
  ),
  expertise: enforced(
    "ability-checks.ts doubles the Proficiency Bonus on a check with a skill the sheet has Expertise in."
  ),
  falling: reference("Falls and their damage are the GM's to apply."),
  flying: guided(
    "movement-rules.ts lets a creature with a Fly Speed fly a move. Whether it falls when Incapacitated, Prone or at Fly Speed 0 is the GM's."
  ),
  "fly-speed": enforced("speed.ts gives a creature with a Fly Speed its own budget for flying."),
  friendly: reference("Attitudes aren't tracked; the GM applies the Advantage on Influence."),
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
    "resolution/attack.ts gives the next attack roll by an ally against the distracted enemy Advantage. Helping with an ability check is the GM's to apply."
  ),
  "heroic-inspiration": enforced(
    "held-rolls.ts spends it to reroll the d20 of an attack, a check or a save. rests.ts gives it to a Human on a Long Rest, and turn-boundaries.ts to a Champion at the start of its turn."
  ),
  hide: enforced(
    "resolution/builtins.ts rolls a DC 15 Dexterity (Stealth) check and makes the creature Invisible on a success, until it attacks, casts a spell with a Verbal component or an enemy's Search meets its total. With dynamic vision on, resolution/validate.ts asks that it be Heavily Obscured or behind Three-Quarters or Total Cover and out of every enemy's sight (vision/rules.ts). A sound louder than a whisper is the GM's call."
  ),
  "high-jump": reference("Jumps aren't measured."),
  "hit-point-dice": enforced(
    "rests.ts spends them on a Short Rest, each healing its roll plus the Constitution modifier, and restores them all on a Long Rest."
  ),
  "hit-points": enforced(
    "hit-points.ts keeps Hit Points between 0 and the maximum, and a creature at 0 falls Unconscious or dies."
  ),
  hostile: reference("Attitudes aren't tracked; the GM applies the Disadvantage on Influence."),
  hover: guided("speed.ts records whether a creature hovers. Falling while flying is the GM's to apply."),
  illusions: reference("Illusions are the GM's to run."),
  immunity: enforced(
    "hit-points.ts ignores damage of an immune type, and effects.ts refuses a condition the creature is immune to."
  ),
  "improvised-weapons": reference("An improvised attack is the GM's to set up."),
  incapacitated: condition("incapacitated"),
  indifferent: reference("Attitudes aren't tracked."),
  influence: guided(
    "resolution/builtins.ts rolls the chosen Charisma or Wisdom check against 15 or the monster's Intelligence, whichever is higher. The GM decides what the monster does."
  ),
  initiative: enforced(
    "encounter.ts rolls Initiative as a Dexterity check with its Advantage and Disadvantage, and orders the turns."
  ),
  invisible: condition("invisible"),
  jumping: reference("Jumps aren't measured."),
  "knocking-out-a-creature": enforced(
    "hit-points.ts leaves a creature dropped by a melee attack chosen to knock out at 1 Hit Point and Unconscious, until it regains Hit Points or stabilize.ts gives it first aid."
  ),
  "lightly-obscured": enforced(
    "With dynamic vision on, vision/sight.ts knows Lightly Obscured points (Dim Light, a painted light fog or foliage area), and ability-checks.ts gives a Perception check to find a creature there Disadvantage. Passive Perception against it is the GM's."
  ),
  line: areaShape("a Line has a fixed width, and the point it starts from isn't in it."),
  "long-jump": reference("Jumps aren't measured."),
  "long-rest": enforced(
    "rests.ts needs 1 Hit Point and 16 hours since the last one. It restores Hit Points, Hit Point Dice, spell slots and uses, and removes a level of Exhaustion."
  ),
  magic: enforced(
    "resolution/economy.ts spends the action when a spell or an item's action is used. A casting time longer than an action is a reminder to the GM (resolution/validate.ts)."
  ),
  "magical-effect": enforced(
    "resolution/pending.ts marks a save against a spell or a magic item as magical, which Magic Resistance reads."
  ),
  malnutrition: reference("Food isn't tracked."),
  monster: reference("A definition; there is nothing to apply."),
  "nonplayer-character": reference("A definition; there is nothing to apply."),
  object: reference("Objects have no game statistics in the app."),
  "occupied-space": enforced(
    "movement-rules.ts refuses a move that ends in another creature's space, unless one of them can share it."
  ),
  "opportunity-attacks": enforced(
    "movement-rules.ts opens a Reaction prompt when a mover leaves an enemy's reach, and reactions.ts resolves it as one melee attack. Disengage, teleporting and forced movement provoke none."
  ),
  paralyzed: condition("paralyzed"),
  "passive-perception": enforced(
    "ability-checks.ts works it out as 10 plus the Wisdom (Perception) bonus, 5 more with Advantage and 5 less with Disadvantage. The GM compares it with what is hidden."
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
    "character-build.ts gives each prepared Ritual spell a cast with no slot. Its 10 extra minutes are a reminder to the GM."
  ),
  "round-down": enforced("The server rounds down wherever a rule divides (halved damage, half Speed, DCs)."),
  save: enforced("Another name for a saving throw; see that row."),
  "saving-throw": enforced(
    "saving-throws.ts opens a save prompt for each target and rolls it on the server, with the proficiency, riders, Advantage and Disadvantage that apply."
  ),
  search: guided(
    "resolution/builtins.ts rolls the chosen Wisdom check. With dynamic vision on, a Perception search finds each hidden creature in its line of sight whose Hide total it meets and ends its hiding. The GM sets any other DC and says what else the creature finds."
  ),
  "shape-shifting": reference("Changing form is the GM's to run; the sheet keeps the creature's own statistics."),
  "short-rest": enforced(
    "rests.ts needs 1 Hit Point, lets Hit Point Dice be spent and gives back what a Short Rest restores. short-rest-interruptions.ts ends it for anyone who rolls Initiative, takes damage or casts a spell above a cantrip."
  ),
  "simultaneous-effects": reference("The order of simultaneous effects is the table's."),
  size: enforced(
    "token-placement.ts sizes each token's space by its size, and size limits (grappling, shoving) are checked on the server."
  ),
  skill: enforced("ability-checks.ts adds the Proficiency Bonus to a check with a skill the sheet is proficient in."),
  speed: enforced(
    "movement-rules.ts charges each move against the creature's Speed for the turn, and each special speed has its own budget."
  ),
  spell: reference("A definition. Each spell's own row under Spells says what the app does with it."),
  "spell-attack": enforced(
    "resolution/attack.ts rolls it with the caster's spell attack bonus, Advantage and Disadvantage included."
  ),
  "spellcasting-focus": reference("Spell components and focuses aren't tracked."),
  sphere: areaShape("a Sphere is a circle of its radius, and the point it starts from is in it."),
  stable: enforced(
    "stabilize.ts stops death saves after three successes, first aid or Spare the Dying. Regaining 1 Hit Point after 1d4 hours is the GM's."
  ),
  "stat-block": reference("A definition. Each monster's actions and traits have their own rows above."),
  study: guided(
    "resolution/builtins.ts rolls the chosen Intelligence check. The GM sets the DC and says what the creature learns."
  ),
  stunned: condition("stunned"),
  suffocation: reference("Breath isn't tracked."),
  surprise: enforced("encounter.ts gives a creature the GM marks as surprised Disadvantage on its Initiative roll."),
  swimming: enforced(
    "movement-rules.ts charges an extra foot per foot of swimming without a Swim Speed. A check in rough water is the GM's."
  ),
  "swim-speed": enforced(
    "speed.ts gives a creature with a Swim Speed its own budget for swimming, with no extra cost."
  ),
  target: reference("A definition; there is nothing to apply."),
  telepathy: reference("Telepathy is the table's to run."),
  teleportation: enforced(
    "movement-rules.ts moves a teleporting creature with no movement spent and no Opportunity Attack. A player's teleport needs the GM's go-ahead."
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
  utilize: guided("resolution/economy.ts spends the action. What the object does is the GM's."),
  vulnerability: enforced("hit-points.ts doubles damage of a type the creature is vulnerable to, once per instance."),
  weapon: reference("A definition. Each weapon's own row under Weapons says what the app does with it."),
  "weapon-attack": enforced(
    "resolution/attack.ts rolls it with the weapon's ability, proficiency, properties and mastery."
  )
};

/** A trait that brings a creature back to life somewhere else, which happens off the table. */
const revives = reference("Its return after death happens off the table; the GM runs it.");
/** A trait about breathing, which the app doesn't track. */
const breath = reference("Breathing isn't tracked.");
/** A trait that lights the map around its creature. */
const sheds = enforced("vision/senses.ts gives the creature its printed Bright and Dim Light, carried with its token.");
/** A trait that hinders a creature standing in sunlight, read from the light where its token stands. */
const sunlightHinders = (rolls: string, files: string) =>
  enforced(
    `${files} give it Disadvantage on ${rolls} while it stands in sunlight (vision/rules.ts). With dynamic vision off, the light is the GM's.`
  );
/** A trait about communicating or sensing, which play doesn't read. */
const senses = reference("Communication and senses like this are the GM's to run.");
/** A trait about squeezing through narrow gaps, which the map doesn't model. */
const squeezes = reference("The map has no walls or gaps, so squeezing through is the GM's to allow.");
/** A trait about jumping, which the app doesn't measure. */
const jumps = reference("Jumps aren't measured.");
/** A trait about changing into another stat block, which the app doesn't do. */
const changesForm = reference("Changing form is the GM's to run; the token keeps this stat block.");
/** A trait the server reads by name for movement (movement-rules.ts). */
const sharesSpace = (who: string) =>
  enforced(
    `movement-rules.ts lets ${who} end a move in another creature's space. Fitting through a narrow gap is the GM's to allow.`
  );
/** A trait that regains Hit Points from damage of one type, which the creature is also immune to. */
const absorbs = (type: string) =>
  reference(
    `hit-points.ts applies the stat block's Immunity to ${type} damage. The Hit Points it regains from that damage are the GM's to add.`
  );

export const MONSTER_TRAIT_COVERAGE: Readonly<Record<string, CuratedCoverage>> = {
  Abduct: enforced("movement-rules.ts charges the bugbear no extra movement to drag a creature it grapples."),
  "Aberrant Ground": reference(
    "The GM can paint the Emanation as difficult terrain (terrain.ts), but the painted terrain doesn't move with the mouther."
  ),
  "Acid Absorption": absorbs("Acid"),
  Adhesive: reference("Sticking to what touches it is the GM's to apply with the Grappled condition."),
  Agile: enforced("movement-rules.ts opens no Opportunity Attack when it moves out of an enemy's reach."),
  "Air Form": sharesSpace("the elemental"),
  Amorphous: squeezes,
  Amphibious: breath,
  "Aura of Authority": enforced(
    "statblock-traits.ts gives the hobgoblin and its allies within 10 feet Advantage on attack rolls and saving throws while it isn't Incapacitated."
  ),
  "Aversion to Fire": reference("The Disadvantage after it takes Fire damage is the GM's to apply."),
  "Barbed Hide": enforced(
    "trait-turns.ts deals 1d10 Piercing damage at the start of the devil's turns to each creature it grapples or that grapples it."
  ),
  "Beast of Burden": reference("Carrying capacity isn't tracked."),
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
  "Blurred Form": reference("The Disadvantage on attack rolls against the mephit is the GM's to apply."),
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
  "Earth Glide": reference(
    "Its Burrow Speed moves it on the map; passing through stone without a trace is the GM's to allow."
  ),
  "Eldritch Restoration": revives,
  "Elemental Restoration": revives,
  Ephemeral: reference("What it can carry is the GM's to rule."),
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
  "Fire Form": guided(
    "movement-rules.ts lets the elemental end a move in a creature's space. The 1d10 Fire damage when it first enters a space on a turn is the GM's to deal."
  ),
  Flyby: enforced("movement-rules.ts opens no Opportunity Attack when it flies out of an enemy's reach."),
  Freeze: reference("The slower Speed after Cold damage is the GM's to apply."),
  Gibbering: guided(
    "trait-turns.ts opens the Wisdom save for each creature that starts its turn within 20 feet. The d8 table on a failure is the GM's to roll."
  ),
  "Greater Magic Resistance": enforced(
    "saving-throws.ts makes the rakshasa succeed on saves against spells and magic items without a roll, and resolution/attack.ts makes spell attack rolls miss it. Hiding from divination is the GM's."
  ),
  "Heat Aura": enforced(
    "trait-turns.ts deals 3d10 Fire damage at the end of the remorhaz's turns to each creature within 5 feet."
  ),
  "Hellish Restoration": revives,
  "Hold Breath": breath,
  "Ice Walk": reference("Ice and snow aren't marked on the map, so the GM waives the cost."),
  Illumination: sheds,
  "Immutable Form": reference("Shape-changing isn't modeled, so there is nothing to refuse."),
  "Incorporeal Movement": reference(
    "Passing through creatures and objects, and the Force damage for ending a turn inside one, are the GM's."
  ),
  "Incubus Form": changesForm,
  Inscrutable: reference("The Disadvantage on Insight checks about it is the GM's to apply."),
  Invisibility: enforced("actor-roster.ts gives the stalker the Invisible condition when it joins the roster."),
  "Iron Scent": senses,
  Jumper: jumps,
  "Legendary Resistance": enforced(
    "saving-throws.ts lets the GM turn a failed save into a success, as many times a day as the stat block prints. A Long Rest restores them; the extra use in the lair is the GM's."
  ),
  "Light Sensitivity": enforced(
    "resolution/attack.ts gives the cloaker Disadvantage on attack rolls while it stands in Bright Light (vision/rules.ts). With dynamic vision off, the light is the GM's."
  ),
  "Lightning Absorption": absorbs("Lightning"),
  "Limited Amphibiousness": breath,
  "Loathsome Limbs": reference("Severed limbs are the GM's to place as Troll Limb stat blocks."),
  "Magic Resistance": enforced(
    "saving-throws.ts gives it Advantage on saves against spells and magic items, saves a spell asks it to repeat included."
  ),
  "Magic Rope": reference("The rope and its statistics are the GM's to run."),
  Mimicry: senses,
  "Misty Escape": reference("Turning to mist at 0 Hit Points is the GM's to run."),
  "Mucus Cloud": reference("The save at the end of the aboleth's turn and its curse are the GM's to run."),
  "Multiple Heads": reference("Heads lost and regrown, and the Hit Points that come with them, are the GM's to track."),
  "Ooze Cube": reference("Entering the cube, and pulling a creature out, are the GM's to run with its Engulf."),
  "Pack Tactics": enforced(
    "resolution/attack.ts gives Advantage when an ally of the attacker that isn't Incapacitated is within 5 feet of the target."
  ),
  "Probing Telepathy": senses,
  "Reactive Heads": reference("The extra Reactions are the GM's to allow."),
  Reactive: reference("The Reaction on every turn is the GM's to allow."),
  "Reflective Carapace": reference("The d6 against spells aimed at it is the GM's to roll."),
  Regeneration: enforced(
    "trait-turns.ts restores the Hit Points at the start of its turns, stopped for a turn by the damage types it names. statblock-traits.ts keeps a troll at 0 Hit Points alive until a turn starts without regenerating."
  ),
  "Running Leap": jumps,
  "Sense Magic": senses,
  "Shark Telepathy": senses,
  "Shielded Mind": senses,
  "Siege Monster": reference("Objects and structures have no Hit Points in the app."),
  "Soul Bag": reference("The bag and its statistics are the GM's to run."),
  "Speak with Beasts and Plants": senses,
  "Spell Storing": reference("Storing and casting the spell is the GM's to run."),
  "Spider Climb": reference("Its Climb Speed moves it on the map; which surfaces it can climb is the GM's call."),
  "Spirit Jar": revives,
  "Standing Leap": jumps,
  Stench: enforced(
    "trait-turns.ts opens the Constitution save for each creature that starts its turn within 5 feet. A failure is Poisoned until the start of its next turn, and a success makes it immune for the fight."
  ),
  "Succubus Form": changesForm,
  "Sunlight Sensitivity": sunlightHinders(
    "attack rolls and ability checks",
    "resolution/attack.ts and ability-checks.ts"
  ),
  "Sunlight Weakness": sunlightHinders("D20 Tests", "resolution/attack.ts, ability-checks.ts and saving-throws.ts"),
  Swarm: guided(
    "movement-rules.ts and terrain.ts let the swarm and other creatures share a space. Refusing it Hit Points and Temporary Hit Points is the GM's."
  ),
  "Telepathic Bond": senses,
  Training: reference("The GM picks the skill and applies its Advantage."),
  Transparent: reference("Noticing the cube is the GM's call, with the DC the trait prints."),
  "Treasure Sense": senses,
  "Troll Spawn": reference("What becomes of a severed limb is the GM's to run."),
  Tunneler: reference("Tunnels aren't drawn on the map; the GM places them."),
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
  "Water Form": sharesSpace("the elemental"),
  "Water Susceptibility": reference("Water on the map isn't tracked, so the Cold damage is the GM's to deal."),
  "Web Walker": reference("Webs aren't marked on the map; the GM waives what they would cost it."),
  Wishes: reference("The djinni's wishes are the GM's to run.")
};

/**
 * Records the data-driven pass gets wrong: those the engine handles in code by id or by name, the base rows of a choice
 * whose chosen row carries the mechanics, and records whose data applies only part of what they do. Keyed `spell:`,
 * `feature:`, `item:` or `action:<monster>/<action id>`.
 */
export const RECORD_OVERRIDES: Readonly<Record<string, CuratedCoverage>> = {
  "spell:spare-the-dying": enforced(
    "stabilize.ts makes a creature at 0 Hit Points within 15 feet Stable with no check, once the caster knows the cantrip."
  ),
  "item:tinderbox": enforced(
    "item-light.ts lights a Candle, Lamp, Lantern or Torch in hand only when its bearer holds a Tinderbox or another flame, spending its Bonus Action in a fight. Lighting any other fire is the GM's."
  ),
  "item:healers-kit": enforced(
    "stabilize.ts spends one use of the kit to make a creature at 0 Hit Points Stable with no check, and the last use takes the kit."
  ),
  "feature:spellcasting": enforced(
    "character-build.ts gives the class its slots, cantrips and prepared spells, and each spell is a cast action at the class's spell save DC and attack bonus. resolution/economy.ts spends the slot, and rests.ts restores slots on a Long Rest."
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
    "Taking the Persistent Rage action restores every expended use of Rage, once per Long Rest (resolution/rage.ts). A Rage under it lasts 10 minutes, and only Unconscious ends it early (effects.ts)."
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
    "The Wisdom save against the Paladin's spell save DC, its Frightened and the Channel Divinity use are applied. The number of targets and the frightened creature's limit of one thing a turn are the GM's."
  ),
  "feature:aura-of-courage": enforced(
    "paladin-auras.ts makes the Paladin and its allies in its Aura of Protection immune to Frightened while it isn't Incapacitated, and an ally already Frightened has no Disadvantage from it there (resolution/attack.ts, check-rolls.ts)."
  ),
  "feature:aura-of-devotion": enforced(
    "paladin-auras.ts makes the Paladin and its allies in its Aura of Protection immune to Charmed while it isn't Incapacitated, and an ally already Charmed may target its charmer while there (resolution/economy.ts)."
  ),
  "feature:holy-nimbus": enforced(
    "The Bonus Action puts Holy Nimbus on the Paladin for 10 minutes. turn-boundaries.ts deals its Radiant damage to an enemy that starts its turn in the aura, and saving-throws.ts gives the Paladin Advantage on saves a Fiend or an Undead forces. Its 30 feet of sunlight is carried with the Paladin's token (vision/senses.ts), which Sunlight Sensitivity reads. Restoring it with a level 5 slot is the GM's."
  ),
  "feature:smite-of-protection": enforced(
    "resolution/hit-options.ts marks the Paladin when Divine Smite rides a hit, and until its next turn the creatures in its aura have Half Cover against attacks and on Dexterity saves (resolution/validate.ts, resolution/pending.ts)."
  ),
  "feature:orc-relentless-endurance": enforced(
    "hit-points.ts holds an Orc reduced to 0 Hit Points, but not killed outright, at 1 Hit Point instead, once a Long Rest. It is taken the first time it can be."
  ),
  "feature:goliath-large-form": guided(
    "The Bonus Action gives +10 feet of Speed and Advantage on Strength checks for 10 minutes. Becoming Large on the map, and whether the space is big enough, are the GM's."
  ),
  "feature:goliath-powerful-build": enforced(
    "The escape from a grapple rolls with Advantage (resolution/builtins.ts). The app doesn't track carrying capacity, so counting one size larger for it is the GM's."
  ),
  "feature:goliath-giant-ancestry": guided(
    "The chosen ancestry and its uses are recorded, and Storm's Thunder is offered as a Reaction. The other boons' damage, push and teleport are the GM's."
  ),
  "feature:divine-order": guided(
    "Protector's training and Thaumaturge's extra cantrip are applied. Thaumaturge's bonus to Arcana and Religion checks is the GM's."
  ),
  "feature:eldritch-invocations": guided(
    "Agonizing Blast's damage, Eldritch Spear's range on a spell attack, Repelling Blast's push (resolution/masteries.ts), Eldritch Mind's Advantage and the free casts are applied. Devil's Sight and Witch Sight are senses dynamic vision reads (vision/senses.ts), and One with Shadows' Invisibility is refused in Bright Light (resolution/validate.ts). The pact-weapon invocations, Lessons of the First Ones, Gaze of Two Minds, Gift of the Protectors and Investment of the Chain Master are the GM's."
  ),
  "feature:elemental-fury": enforced(
    "Primal Strike's extra damage, of the type the Druid picks, is applied once a turn. Potent Spellcasting adds the Druid's Wisdom modifier to the damage of Poison Spray, Produce Flame and Starry Wisp."
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
  "feature:primal-order": guided(
    "Magician's extra cantrip and Warden's training are applied. The Wisdom bonus to the checks each role names is the GM's."
  ),
  "feature:stunning-strike": enforced(
    "A target that fails its Constitution save against the Monk's DC is Stunned until the start of the Monk's next turn, once a turn for a Focus Point. On a success resolution/pending.ts halves its Speed until then (speed.ts), and the next attack roll against it before then has Advantage and spends it (resolution/attack.ts)."
  ),
  "feature:use-magic-device": guided(
    "The fourth attuned item is applied (inventory.ts). The roll to save a charge, and reading any Spell Scroll, are the GM's."
  ),
  "feature:grappler": guided(
    "The ability score increase is applied. Punch and Grab, Attack Advantage and Fast Wrestler are the GM's."
  ),
  "feature:boon-of-combat-prowess": guided(
    "The ability score increase is applied, and Peerless Aim's use is counted each turn. Turning the miss into a hit is the GM's."
  ),
  "feature:boon-of-dimensional-travel": guided(
    "The ability score increase is applied. The teleport of Blink Steps is the GM's to move."
  ),
  "feature:boon-of-fate": guided(
    "The ability score increase is applied, and Improve Fate's use is counted. Adding the 2d4 to the roll is the GM's."
  ),
  "feature:boon-of-irresistible-offense": guided(
    "The ability score increase is applied. Overcoming Resistance, and the extra damage on a 20, are the GM's."
  ),
  "feature:boon-of-spell-recall": guided(
    "The ability score increase is applied. Casting a spell without spending its slot is the GM's."
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
  "feature:sacred-weapon": guided(
    "A use of Channel Divinity puts Sacred Weapon on the Paladin for 10 minutes, and its 20 feet of Bright Light and 20 of Dim are carried with the Paladin's token (vision/senses.ts). The Charisma bonus to attack rolls with the weapon and its Radiant damage are the GM's."
  ),

  // Magic items whose riders apply part of what they do, and leave a property the table would expect applied.
  "item:armor-of-invulnerability": guided(
    "Resistance to Bludgeoning, Piercing and Slashing damage is applied. The once-a-day Immunity to them is the GM's."
  ),
  "item:berserker-axe": guided(
    "The +1 to attack and damage rolls and the curse's lock on Attunement are applied. The extra Hit Points and the curse's save are the GM's."
  ),
  "item:bracers-of-archery": guided(
    "Proficiency with the Longbow and Shortbow is applied. The +2 damage with them is the GM's."
  ),
  "item:brooch-of-shielding": guided("Resistance to Force damage is applied. Immunity to Magic Missile is the GM's."),
  "item:cloak-of-arachnida": guided(
    "Resistance to Poison damage is applied. Climbing like a spider, and the Web cast, are the GM's."
  ),
  "item:cloak-of-the-bat": guided(
    "Advantage on Dexterity (Stealth) checks is applied. The Fly Speed in darkness and the Polymorph cast are the GM's."
  ),
  "item:dagger-of-venom": guided(
    "The +1 to attack and damage rolls is applied. The poison it can coat its blade with is the GM's."
  ),
  "item:defender": guided("The +3 to attack and damage rolls is applied. Moving the bonus to AC is the GM's."),
  "item:demon-armor": guided(
    "The +1 AC and the curse's lock on Attunement are applied. The clawed Unarmed Strikes and the Disadvantage against demons are the GM's."
  ),
  "item:dragon-scale-mail": guided(
    "The +1 AC and the Resistance to one type are applied. Advantage on saves against a dragon's breath, and sensing dragons, are the GM's."
  ),
  "item:dwarven-plate": guided("The +2 AC is applied. The Reaction against forced movement is the GM's."),
  "item:dwarven-thrower": guided(
    "The +3 to attack and damage rolls is applied. Throwing it, its return and the extra damage against Giants are the GM's."
  ),
  "item:giant-slayer": guided(
    "The +1 to attack and damage rolls and the extra 2d6 against Giants are applied. The Giant's save against Prone is the GM's."
  ),
  "item:hammer-of-thunderbolts": guided(
    "The +1 to attack and damage rolls is applied. Its thrown thunderclap and its powers against Giants are the GM's."
  ),
  "item:helm-of-telepathy": guided(
    "Its Detect Thoughts and Suggestion casts are cast actions. The telepathy itself is the GM's."
  ),
  "item:holy-avenger": guided(
    "The +3 to attack and damage rolls and the extra 2d10 Radiant against Fiends and Undead are applied. The aura's Advantage on saves against spells for its wielder's allies is the GM's."
  ),
  "item:iron-bands": guided(
    "The throw's attack roll is applied. Restraining the target on a hit, and the check to break free, are the GM's."
  ),
  "item:iron-flask": guided("The command's save is applied. Trapping the creature in the flask is the GM's."),
  "item:luck-blade": guided(
    "The +1 to attack and damage rolls and saving throws is applied. Its Luck reroll and its Wish are the GM's."
  ),
  "item:mace-of-disruption": guided(
    "The extra 2d6 Radiant against Fiends and Undead is applied. The save against destruction at 25 Hit Points or fewer, and the Frightened condition a success leaves, are the GM's."
  ),
  "item:mace-of-smiting": guided(
    "The +1 to attack and damage rolls, +3 against Constructs, and the 7 Bludgeoning on a Critical Hit (14 against a Construct) are applied. Destroying a Construct left at 25 Hit Points or fewer is the GM's."
  ),
  "item:nine-lives-stealer": guided(
    "The +2 to attack and damage rolls is applied. Life Stealing on a Critical Hit is the GM's."
  ),
  "item:pipes-of-haunting": guided(
    "The save against Frightened, with its repeat at the end of each turn, is applied. The immunity after a success is the GM's."
  ),
  "item:quarterstaff-of-the-acrobat": guided(
    "The +2 to attack and damage rolls is applied. Its forms, Acrobatic Assist and Attack Deflection are the GM's."
  ),
  "item:ring-of-shooting-stars": guided(
    "Its at-will cantrips and the one-charge Shooting Stars are applied. Faerie Fire, the Lightning Spheres and the larger Shooting Stars are the GM's."
  ),
  "item:robe-of-scintillating-colors": guided(
    "The save against Stunned is applied. The light, the Disadvantage on attacks against the wearer and ending the stun are the GM's."
  ),
  "item:robe-of-stars": guided(
    "The +1 to saving throws is applied. The Magic Missile stars and the trip to the Astral Plane are the GM's."
  ),
  "item:rod-of-alertness": guided(
    "Advantage on Initiative and Wisdom (Perception) checks, and its detection casts, are applied. The Protective Aura's benefit to allies is the GM's."
  ),
  "item:rope-of-entanglement": guided(
    "The save against Restrained is applied. The check to escape the rope is the GM's."
  ),
  "item:scarab-of-protection": guided(
    "The +1 AC is applied. Advantage on saves against spells, and its Preservation, are the GM's."
  ),
  "item:scimitar-of-speed": guided(
    "The +2 to attack and damage rolls is applied. The extra attack as a Bonus Action is the GM's."
  ),
  "item:spellguard-shield": guided(
    "Spell attack rolls against its holder have Disadvantage (resolution/attack.ts). Advantage on saves against spells and other magical effects is the GM's."
  ),
  "item:staff-of-charming": guided(
    "Its one-charge casts are cast actions. Reflecting an enchantment, and resisting one, are the GM's."
  ),
  "item:staff-of-fire": guided(
    "Resistance to Fire damage and its one-charge Burning Hands are applied. Fireball and Wall of Fire, which cost more charges, are the GM's."
  ),
  "item:staff-of-frost": guided(
    "Resistance to Cold damage and its one-charge Fog Cloud are applied. The spells that cost more charges are the GM's."
  ),
  "item:staff-of-power": guided(
    "The +2 to AC, saving throws and spell attack rolls is applied. Its weapon bonus, its spells and its Retributive Strike are the GM's."
  ),
  "item:staff-of-the-magi": guided(
    "Its four casts that cost no charge and the +2 to spell attack rolls are applied. Its weapon bonus, the spells that cost charges, Spell Absorption and Retributive Strike are the GM's."
  ),
  "item:staff-of-the-woodlands": guided(
    "Its one-charge casts are cast actions, Tree Form's use is counted, and the +2 to spell attack rolls is applied. Its weapon bonus and the spells that cost more charges are the GM's."
  ),
  "item:staff-of-thunder-and-lightning": guided(
    "Lightning Strike and Thunderclap are applied, each once a day. Its weapon bonus and the powers on a hit are the GM's."
  ),
  "item:talisman-of-pure-good": guided(
    "The +2 to spell attack rolls is applied. The 8d6 Radiant it deals a Fiend or an Undead that touches it, and Pure Rebuke's fissure on its charges, are the GM's."
  ),
  "item:talisman-of-ultimate-evil": guided(
    "The +2 to spell attack rolls is applied. The 8d6 Necrotic it deals a creature other than a Fiend or an Undead that touches it, and Ultimate End's fissure on its charges, are the GM's."
  ),
  "item:sword-of-wounding": guided(
    "The extra Necrotic damage is applied. The save that stops the target regaining Hit Points is the GM's."
  ),
  "item:vorpal-sword": guided(
    "The +3 to attack and damage rolls is applied. Ignoring Resistance to Slashing damage, and the head it takes on a 20, are the GM's."
  ),
  "item:wand-of-fireballs": guided(
    "Fireball at DC 15 on its charges is applied. Spending more charges for a higher-level Fireball is the GM's."
  ),
  "item:wand-of-lightning-bolts": guided(
    "Lightning Bolt at DC 15 on its charges is applied. Spending more charges for a higher-level Lightning Bolt is the GM's."
  ),
  "item:wand-of-the-war-mage-1": guided(
    "The +1 to spell attack rolls is applied. Ignoring Half Cover on a spell attack is the GM's, who sets the cover."
  ),
  "item:wand-of-the-war-mage-2": guided(
    "The +2 to spell attack rolls is applied. Ignoring Half Cover on a spell attack is the GM's, who sets the cover."
  ),
  "item:wand-of-the-war-mage-3": guided(
    "The +3 to spell attack rolls is applied. Ignoring Half Cover on a spell attack is the GM's, who sets the cover."
  ),
  "item:weapon-of-warning": guided(
    "Advantage on Initiative for its wielder is applied. The same for allies within 30 feet, and waking them, are the GM's."
  ),

  // Spells whose data applies the cast's main numbers and leaves a rider the table would expect the server to apply.
  "spell:befuddlement": enforced(
    "A failed save deals the Psychic damage and bars the target from casting spells and the Magic action (resolution/economy.ts). The save every 30 days, and Greater Restoration, Heal or Wish ending it, are the GM's."
  ),
  "spell:blur": enforced(
    "Attack rolls against the caster have Disadvantage while it lasts, except from an attacker whose Blindsight or Truesight reaches it (resolution/attack.ts)."
  ),
  "spell:chromatic-orb": guided(
    "The attack and the chosen damage type are applied. The leap to another target on matching dice is the GM's."
  ),
  "spell:compulsion": guided(
    "A failed save imposes Charmed. The move it forces each turn, and the save after it, are the GM's."
  ),
  "spell:conjure-celestial": guided(
    "The Healing Light on the cast is applied, and Bright Light fills the Cylinder for dynamic vision (vision/cast-sight.ts). Searing Light, and moving the Cylinder, are the GM's."
  ),
  "spell:conjure-elemental": guided(
    "The spirit's save, its 8d8 damage and Restrained are a later action the GM calls. The repeat save with 4d8 damage at the start of each of the target's turns is the GM's."
  ),
  "spell:contact-other-plane": guided(
    "The DC 15 Intelligence save is opened, and a failure imposes Incapacitated. The 6d6 Psychic damage on a failure, and the entity's answers, are the GM's."
  ),
  "spell:contagion": guided(
    "The save's 11d8 Necrotic damage and Poisoned condition are applied. The Disadvantage on saves with the chosen ability, and the three repeat saves, are the GM's."
  ),
  "spell:delayed-blast-fireball": guided(
    "The explosion's save and 12d6 Fire damage are a later action. The 1d6 added for each turn the bead waits, and a creature touching it, are the GM's."
  ),
  "spell:death-ward": enforced(
    "hit-points.ts leaves the target at 1 Hit Point the first time it would drop to 0, and ends the spell. Negating an effect that would kill it without damage is the GM's."
  ),
  "spell:dissonant-whispers": guided(
    "The save and its Psychic damage are applied. The target's move away with its Reaction is the GM's."
  ),
  "spell:dominate-beast": guided(
    "A failed save imposes Charmed. The repeat save each time the target takes damage, and its orders, are the GM's."
  ),
  "spell:dominate-monster": guided(
    "A failed save imposes Charmed. The repeat save each time the target takes damage, and its orders, are the GM's."
  ),
  "spell:dominate-person": guided(
    "A failed save imposes Charmed. The repeat save each time the target takes damage, and its orders, are the GM's."
  ),
  "spell:earthquake": guided(
    "The cast's Dexterity save and Prone condition are applied. The save at the end of each of the caster's turns, the broken Concentration and the fissures are the GM's."
  ),
  "spell:fear": guided(
    "A failed save imposes Frightened. The Dash away on each of its turns, and the save out of the caster's sight, are the GM's."
  ),
  "spell:flesh-to-stone": guided(
    "A failed save imposes Restrained. The repeat saves toward Petrified, and Speed 0 on a success, are the GM's."
  ),
  "spell:freedom-of-movement": guided(
    "speed.ts gives the target a Swim Speed equal to its Speed. Ignoring Difficult Terrain, the immunity to magical Paralyzed and Restrained, and slipping free of restraints are the GM's."
  ),
  "spell:gust-of-wind": guided(
    "The cast's save pushes a creature that fails 15 feet away from the caster, and the Line disperses the fog and clouds it overlaps (vision/cast-sight.ts). The save at the end of a creature's turn in the Line, the doubled cost of moving toward the caster and turning the Line are the GM's."
  ),
  "spell:hideous-laughter": guided(
    "A failed save imposes Prone and Incapacitated, repeated at the end of each of the target's turns. The save with Advantage each time it takes damage is the GM's."
  ),
  "spell:irresistible-dance": guided(
    "A failed save imposes Charmed. The dance's Disadvantage, the Advantage against the dancer and its save to collect itself are the GM's."
  ),
  "spell:mass-heal": enforced(
    "resolution/heal.ts divides the 700 Hit Points evenly among the creatures the caster picks, none past its maximum, and ends Blinded, Deafened and Poisoned on each. A different split is the caster's to make by hand."
  ),
  "spell:phantasmal-killer": guided(
    "The save and its 4d10 Psychic damage are applied. The Disadvantage it leaves, and the save with damage at the end of each of its turns, are the GM's."
  ),
  "spell:power-word-heal": enforced(
    "resolution/heal.ts restores all the target's Hit Points and ends Charmed, Frightened, Paralyzed, Poisoned and Stunned. Standing up from Prone with its Reaction is the creature's choice."
  ),
  "spell:power-word-stun": enforced(
    "A target with 150 Hit Points or fewer is Stunned and repeats the save at the end of each of its turns; a tougher one's Speed is 0 until the start of the caster's next turn (resolution/pending.ts)."
  ),
  "spell:prayer-of-healing": guided(
    "The 2d8 Hit Points are applied. The Short Rest's benefits, and the limit of once per Long Rest, are the GM's."
  ),
  "spell:prismatic-wall": guided(
    "The save against Blinded for a creature near the wall is applied. Each layer's save and effect are the GM's."
  ),
  "spell:protection-from-poison": enforced(
    "The cast ends Poisoned and leaves Resistance to Poison damage and Advantage on saves to avoid or end Poisoned. The GM ends the effect when the hour is up."
  ),
  "spell:regenerate": guided(
    "The 4d8 + 15 Hit Points are applied. The 1 Hit Point at the start of each of the target's turns is the GM's."
  ),
  "spell:sleep": guided(
    "A failed save imposes Incapacitated until the end of the target's next turn, and damage ends it. The second save, and Unconscious on its failure, are the GM's."
  ),
  "spell:sleet-storm": guided(
    "spell-zones.ts asks for the save against Prone when a creature enters the area or starts its turn there, and the Cylinder is Heavily Obscured for dynamic vision (vision/cast-sight.ts). The broken Concentration on a failure is the GM's."
  ),
  "action:Octopus/ink-cloud": guided(
    "The Reaction fills its 5-foot Cube with ink, Heavily Obscured for 1 minute (vision/cast-sight.ts). Offering it when a creature ends its turn beside the octopus underwater, and its swim away, are the GM's."
  ),
  "action:Giant Octopus/ink-cloud": guided(
    "The Reaction fills its 10-foot Cube with ink, Heavily Obscured for 1 minute (vision/cast-sight.ts). Offering it when the octopus takes damage underwater, and its swim away, are the GM's."
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
  "spell:wall-of-ice": guided(
    "The save and its Cold damage for creatures in the wall's space are applied. The wall itself and its frigid air are the GM's."
  ),
  "spell:weird": guided(
    "The save, its Psychic damage and Frightened are applied, with the repeat save at the end of each turn. The 5d10 Psychic damage on a failed repeat is the GM's."
  ),
  "spell:wind-wall": guided(
    "The save and its Bludgeoning damage are applied. The projectiles the wall turns aside are the GM's."
  )
};

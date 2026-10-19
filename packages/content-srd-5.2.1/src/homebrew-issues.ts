/** One issue at its path, in the shape the homebrew API answers with (`HomebrewValidationIssue`). */
export type HomebrewIssue = { path: (string | number)[]; message: string; recordId: string | null };

/**
 * The publish gate's issues as sentences a GM reads: the schema's own findings turned into plain words, with the
 * field and the part of the record that owns it named, and no schema text, slugs, ids or backticks. The path is kept,
 * so the client places each issue on the step that owns it. The server's gate and the editor's checklist both read
 * these, so a GM meets one sentence for one problem wherever it is shown. The rules are the gate's; only the words change here.
 */

type Path = ReadonlyArray<string | number>;
/** A Zod issue as the gate receives it, loosely: Zod 4 adds keys by code. */
export type SchemaIssue = Readonly<{
  code?: string;
  path: ReadonlyArray<PropertyKey>;
  message: string;
  input?: unknown;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  keys?: readonly string[];
  divisor?: number;
  format?: string;
}>;

/** The words for the fields a GM meets, by key. A key not here is spelled out from its camel case. */
const LABELS: Readonly<Record<string, string>> = {
  name: "name",
  description: "description",
  summary: "summary",
  attribution: "credit",
  level: "level",
  school: "school",
  castingTime: "casting time",
  range: "range",
  duration: "duration",
  components: "components",
  materialText: "material component",
  hitDie: "hit die",
  primaryAbilities: "primary ability",
  savingThrows: "saving throw proficiencies",
  skillChoices: "skill choices",
  choose: "number of picks",
  from: "options",
  fromCatalog: "options",
  fromPicks: "options",
  options: "options",
  choice: "choice",
  choices: "choices",
  spellListId: "spell list",
  spellcasting: "spellcasting",
  classId: "class",
  subclassLevel: "subclass level",
  subclassLabel: "subclass name",
  levelTable: "level table",
  spellSlots: "spell slots",
  pactSlots: "pact slots",
  proficiencyBonus: "Proficiency Bonus",
  features: "features",
  traits: "traits",
  lineages: "lineages",
  speedFeet: "speed",
  darkvisionFeet: "darkvision",
  sizes: "size",
  size: "size",
  creatureType: "creature type",
  abilityOptions: "ability scores",
  abilityScores: "ability scores",
  originFeatId: "origin feat",
  category: "category",
  costGp: "cost",
  weightLb: "weight",
  weapon: "weapon",
  armor: "armor",
  damageDice: "damage dice",
  damageType: "damage type",
  damageTypes: "damage types",
  acBase: "base Armor Class",
  armorClass: "Armor Class",
  hitPoints: "Hit Points",
  formula: "dice",
  damage: "damage",
  attack: "attack",
  save: "saving throw",
  dc: "save DC",
  ability: "ability",
  reachFeet: "reach",
  rangeFeet: "range",
  rangeNormalFeet: "normal range",
  uses: "uses",
  limit: "number of uses",
  per: "when the uses come back",
  recharge: "recharge",
  actions: "actions",
  challengeRating: "challenge rating",
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
  rarity: "rarity",
  attunement: "attunement",
  charges: "charges",
  casts: "spells it casts",
  spellId: "spell",
  prerequisite: "prerequisite",
  feature: "benefit",
  add: "spells",
  remove: "spells it leaves out",
  basedOn: "lists it starts from",
  higherLevel: "At Higher Levels text",
  target: "target",
  shape: "area",
  modifiers: "modifiers",
  effects: "effects",
  grants: "grants",
  when: "condition",
  startingEquipment: "starting equipment",
  items: "items",
  quantity: "quantity",
  goldPieces: "gold",
  label: "label",
  multiclassPrerequisites: "multiclass prerequisites",
  minimums: "minimum scores",
  minimum: "minimum score",
  asiLevels: "Ability Score Improvement levels",
  statPriority: "ability order",
  languages: "languages",
  languageChoices: "language choices",
  toolProficiencies: "tool proficiencies",
  toolChoices: "tool choices",
  skillProficiencies: "skill proficiencies",
  armorProficiencies: "armor training",
  weaponProficiencies: "weapon proficiencies",
  extensions: "stat block details",
  type: "kind",
  legendary: "Legendary Action",
  reaction: "reaction",
  answer: "answer to a roll",
  struck: "what a melee hit costs the attacker",
  usesAction: "action it uses",
  multiattack: "Multiattack",
  count: "number of attacks",
  bonus: "bonus",
  amount: "amount",
  scaling: "growth rule",
  tags: "tags",
  appliesTo: "items it applies to",
  baseIds: "items it applies to",
  slot: "slot",
  cursed: "curse",
  damageTypeChoice: "damage type choices",
  spellScroll: "spell scroll levels",
  vulnerableToOtherChoices: "vulnerability",
  consumedOnUse: "used up on use",
  onHit: "what a hit does",
  ridesHit: "hit it adds to",
  targets: "who it can target",
  spendsNoUses: "spends no uses",
  escapeAthletics: "escape with Athletics",
  naturalTwenty: "rolled 20 only",
  spendsEffectTag: "coat it spends",
  saveDc: "save DC",
  effectsChoose: "number of effects per hit",
  effectRequired: "effect needed",
  forgoesDice: "dice it gives up",
  oncePerTurn: "once per turn",
  ownTurn: "own turn only",
  declaredBeforeRoll: "chosen before the roll",
  classes: "spell lists",
  repeatable: "repeatable",
  prerequisiteLevel: "prerequisite level",
  speeds: "speeds",
  senses: "senses",
  alignment: "alignment",
  experiencePoints: "XP",
  upcastDurations: "durations from higher spell slots",
  concentration: "Concentration",
  minutes: "minutes",
  rest: "rest that ends it",
  baseArmorClass: "base Armor Class",
  armorClassFloor: "lowest Armor Class",
  speedMultiplier: "Speed multiplier",
  dispel: "spells it ends",
  automaticLevel: "highest spell level it ends outright",
  endsCurses: "curses it ends",
  selfSave: "the caster's own saving throw",
  endsOnSourceSideDamage: "end on damage from the source's side",
  persistsWithoutTargets: "lasts with no creature under it",
  holdsOne: "one creature held at a time",
  grows: "damage that grows each turn",
  costly: "priced or consumed materials",
  itemIds: "items",
  matches: "names it matches",
  perTarget: "one for each target",
  coins: "coins",
  waives: "components it goes without",
  targetTypes: "creature types it affects",
  repeatOnce: "one repeated save",
  repeatAtTurnStart: "save repeated as its turn starts",
  repeatOnDamage: "save repeated on damage",
  repeatByAction: "save repeated by an action",
  repeatFailureDamage: "damage of a failed repeat",
  repeatTally: "successes and failures counted",
  secondFailure: "second failure",
  failureExhaustion: "Exhaustion a failure adds",
  advantageIfFighting: "Advantage in a fight with the source",
  immuneOnSuccess: "immunity after a success",
  endsWhenSourceDies: "end when the source dies",
  onlyCreatureTypes: "creature types that save",
  sparesAffected: "creatures already affected left out",
  failureKills: "a failure that kills",
  sourceRegains: "hit points the source regains",
  repeatDamageAgain: "damage again on a failed repeat",
  repeatUnseenSource: "save repeated out of the source's sight",
  endsOutOfSight: "end out of the source's sight",
  autoSuccess: "creatures that succeed without rolling",
  sleepless: "creatures that don't sleep",
  successEffect: "what a success leaves",
  chainFeet: "distance between targets",
  summons: "creatures it summons",
  summonScaling: "how it scales with the spell's level",
  creatures: "creatures",
  monsterId: "stat block",
  perSlot: "more for each higher spell slot",
  minLevel: "lowest spell slot",
  fromCorpse: "corpses it raises",
  commandedWith: "action that commands it",
  commandFeet: "range of a command",
  commandMove: "distance a command moves it",
  leashFeet: "distance it may be from its summoner",
  allegiance: "who commands it",
  creatureTypes: "creature types",
  forms: "forms",
  formActions: "actions only some forms have",
  castsAtOnce: "cast with one action",
  dice: "dice",
  abilityModifier: "ability modifier",
  abilityScore: "ability score",
  leavesOne: "least damage it leaves",
  proficientOnly: "only with a proficiency",
  perSlotLevel: "the slot's level it adds",
  conditionWards: "conditions it wards against",
  suppressesConditions: "conditions it holds off",
  hitPointsEachTurn: "hit points it restores each turn",
  bonusActions: "Bonus Actions it gives",
  grantsLaterAction: "action it gives",
  endAction: "action that ends it",
  bindsWeapon: "weapon it binds to",
  optionsPerTarget: "an option for each target",
  shrinksEachLongRest: "penalty that shrinks each Long Rest",
  shapeShift: "shape-shift",
  printed: "printed forms",
  keeps: "what the creature keeps of its own",
  challengeOf: "whose Challenge Rating limits the form",
  maxChallenge: "highest Challenge Rating",
  noFly: "no Fly Speed",
  onTargets: "a form for each target",
  leaveAs: "action that leaves the form",
  hoursPerTwoLevelsOf: "class whose half level counts its hours",
  gear: "what becomes of its gear",
  endsForm: "returns its user to its true form",
  formOnly: "forms it works in",
  effectOptions: "effects to pick from",
  unwillingOnly: "save for unwilling creatures only",
  failureEndsForm: "a failure ends a shape-shift",
  sizeChange: "size change",
  step: "size step",
  hoursRolled: "hours rolled as it lands",
  areaPerSlot: "area growth for each higher slot",
  movesArea: "how far it moves the spell's area",
  terrain: "ground it changes",
  bars: "creatures its edge holds back",
  noTeleport: "no teleporting in",
  holds: "what a creature in it holds",
  revives: "Hit Points regained at 0",
  drifts: "feet it drifts each turn",
  untilCasterNextTurnEnd: "lasts until the end of the caster's next turn",
  variants: "kinds of the item",
  variantChoice: "who picks its kind",
  replacesRiders: "kind replaces the item's own modifiers",
  suspendsActions: "item's actions set aside in this form",
  weaponChanges: "changes to its weapon",
  damageTypeOptions: "damage types it can deal instead",
  bonusActionAttack: "Bonus Action attack",
  contents: "what it holds",
  magicSaveAura: "aura of Advantage on saves against magic",
  widerAt: "wider aura from a class level",
  addProperties: "properties it adds",
  removeProperties: "properties it removes",
  longRangeFeet: "long range",
  score: "score",
  base: "base Armor Class",
  ignoresArmor: "armor takes no Speed",
  degree: "cover it ignores",
  activation: "action it takes"
};
/** A key whose words depend on what holds it: a weapon's category is its weapon kind, as the editor labels it. */
const NESTED_LABELS: Readonly<Record<string, string>> = { "weapon.category": "weapon kind" };
/** Keys that say nothing alone: their parent names the field. */
const GENERIC = new Set(["value", "maximum", "text", "id", "min", "max", "kind"]);

/** A camel-case key in plain words: `darkvisionFeet` reads "darkvision feet", `classId` reads "class". */
function spelledOut(key: string): string {
  return key
    .replace(/Id$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .toLowerCase()
    .trim();
}

/** The field an issue is about, in words, from the last key of its path that names one. */
export function fieldLabel(path: Path): string {
  const keys = path.filter((key): key is string => typeof key === "string");
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const key = keys[index]!;
    if (GENERIC.has(key) && index > 0) continue;
    const nested = index > 0 ? NESTED_LABELS[`${keys[index - 1]}.${key}`] : undefined;
    return nested ?? LABELS[key] ?? spelledOut(key);
  }
  return "record";
}

/** The deepest named part of the body the path runs through (a feature, an action, an option), not the record. */
function ownerOf(body: unknown, path: Path): string | null {
  let node: unknown = body;
  let owner: string | null = null;
  for (let index = 0; index < path.length; index += 1) {
    if (node === null || typeof node !== "object") break;
    node = (node as Record<string | number, unknown>)[path[index]!];
    // The last step is the field itself, whose own name is the one at fault when it is blank.
    if (index === path.length - 1) break;
    const name = node && typeof node === "object" ? (node as { name?: unknown }).name : undefined;
    if (typeof name === "string" && name.trim() !== "") owner = name.trim();
  }
  return owner;
}

const capitalised = (text: string) => (text ? `${text[0]!.toUpperCase()}${text.slice(1)}` : text);
const theLabel = (label: string) => (/^[A-Z]/.test(label) ? label : `the ${label}`);

/** Plain words for what a schema message says, where the message is one the schemas write. */
const CUSTOM_REWRITES: ReadonlyArray<readonly [RegExp, (owner: string | null, label: string) => string]> = [
  [
    /^Limited uses need/,
    (owner) => `Give ${owner ? `${owner}'s` : "these"} limited uses a number, or a rule for how they grow.`
  ],
  [
    /^A gated grant cannot hand over a spell/,
    () => "A grant with a condition can't give spells. Put the spells in a grant with no condition."
  ],
  [
    /^An extra pick states exactly one of/,
    () => "Give the extra pick a number or a rule for how it grows, and only one of the two."
  ],
  [
    /^minSpellLevel \d+ is above maxSpellLevel/,
    (owner) =>
      `The lowest spell level ${owner ? `for ${owner}'s choice ` : ""}is above the highest, so no spell fits both.`
  ],
  [/^A choice needs an explicit/, (owner) => `Give ${owner ? `${owner}'s choice` : "the choice"} its options.`],
  [
    /^Author `choice` \(one pick\) or `choices`/,
    (owner) => `${owner ?? "This part"} has both one choice and a list of choices. Keep one of the two.`
  ],
  [/^Author `options` alone/, () => "The options already name what can be picked, so remove the separate list."],
  [/^Each kind of the item needs its own id/, () => "Two kinds of the item share one id. Give each its own."],
  [
    /^Who picks the item's kind needs kinds/,
    () => "The item says who picks its kind but has no kinds to pick from. Add its kinds, or remove who picks."
  ],
  [/^Duplicate option id/, (owner) => `Two options ${owner ? `of ${owner} ` : ""}share one id. Give each its own.`],
  [/^Level table row \d+ must be level/, () => "The level table must list levels 1 to 20 in order."],
  [
    /grants unknown feature/,
    () =>
      "A level in the level table grants a feature this class doesn't have. Remove it from that level, or add the feature."
  ],
  [/^Duplicate feature id/, () => "Two features share one id. Give each its own."],
  [/^A "choose N" list needs/, (_owner, label) => `Give the ${label} their options, or set the number of picks to 0.`],
  [
    /^A cursed item must require attunement/,
    () => "A cursed item must require attunement, because attunement is what springs the curse and what reveals it."
  ],
  [
    /^A chosen damage type replaces one granted resistance/,
    () =>
      "A damage type the GM chooses replaces one resistance the item grants, so grant exactly one, from the choices."
  ],
  [
    /^A Spell Scroll crumbles once it is read/,
    () => "A Spell Scroll crumbles once it is read, so mark it as used up on use."
  ],
  [
    /^Vulnerability to the other choices needs/,
    () => "Vulnerability to the other choices needs a cursed item whose resistance the GM chooses."
  ],
  [
    /^An item can't change hit points per level or the attunement limit/,
    () =>
      "An item can't change Hit Points per level or the attunement limit. Use a bonus to Armor Class, saving throws, ability checks or the spell save DC."
  ],
  [
    /^`while-character-is` needs at least one class or species/,
    () => "A condition on who the character is needs at least one class or species."
  ],
  [
    /^Two ".+" triggers on one rider/,
    () => "One rider has the same condition twice. List the values in one condition."
  ],
  [
    /^An effect cannot carry/,
    () =>
      "An effect can't carry that modifier, since it is written onto the sheet and would outlast the effect. Put it on a feature, a feat or an item."
  ],
  [/^A scroll's lowest level is above its highest/, () => "The scroll's lowest spell level is above its highest."]
];

/** Default Zod 4 messages, which only a schema writes. A message a schema states itself is kept, in plainer words. */
const DEFAULT_MESSAGE = /^(Invalid|Too (small|big)|Unrecognized key|Expected |Required$|Number must|String must)/i;

/** A message with no slugs, ids, backticks or schema words left in it. */
function plainWords(message: string): string {
  return message
    .replace(/`([^`]*)`/g, (_match, code: string) => spelledOut(code))
    .replace(/"hb-[a-z0-9-]+"/g, "a homebrew record")
    .replace(/"([a-z0-9]+(?:-[a-z0-9]+)+)"/g, (_match, slug: string) => slug.replace(/-/g, " "));
}

/** One schema finding as a sentence, at its own path. */
export function plainSchemaIssue(issue: SchemaIssue, body: unknown, recordId: string | null): HomebrewIssue {
  const path = issue.path.map((key) => (typeof key === "number" ? key : String(key)));
  const label = fieldLabel(path);
  const owner = ownerOf(body, path);
  const forOwner = owner ? ` for ${owner}` : "";
  const ofOwner = owner ? ` of ${owner}` : "";
  const last = path[path.length - 1];
  const inDamage = last === "formula" && path.includes("damage");
  const blank = issue.input === undefined || issue.input === null || issue.input === "";
  let message: string;
  if (inDamage && (blank || issue.code === "too_small"))
    message = `Fill in the dice${forOwner}, or remove that damage row.`;
  else if (inDamage) message = `Use dice such as 1d8 + 3, or a number, for the damage${ofOwner}.`;
  else {
    const rewrite = CUSTOM_REWRITES.find(([pattern]) => pattern.test(issue.message));
    if (rewrite) message = rewrite[1](owner, label);
    else if (!DEFAULT_MESSAGE.test(issue.message) && issue.code !== "invalid_type")
      // A schema's own sentence, such as the dice hint, already says how to fix it.
      message = plainWords(issue.message);
    else message = byCode(issue, label, forOwner, ofOwner);
  }
  return { path, message: message.slice(0, 500), recordId };
}

/** A sentence for a Zod finding from its code: what is wrong with the field, and how to fix it. */
function byCode(issue: SchemaIssue, label: string, forOwner: string, ofOwner: string): string {
  const field = theLabel(label);
  switch (issue.code) {
    case "invalid_type":
      return issue.input === undefined || issue.input === null
        ? `Fill in ${field}${forOwner}.`
        : `${capitalised(field)}${ofOwner} isn't in a form this field takes. Fill it in again.`;
    case "too_small":
      if (issue.origin === "string")
        return Number(issue.minimum) <= 1
          ? `Fill in ${field}${forOwner}.`
          : `Make ${field}${ofOwner} at least ${issue.minimum} characters long.`;
      if (issue.origin === "array" || issue.origin === "set")
        return Number(issue.minimum) <= 1
          ? `Add at least one entry to ${field}${forOwner}.`
          : `Add at least ${issue.minimum} entries to ${field}${forOwner}.`;
      return `Make ${field}${ofOwner} ${issue.minimum} or more.`;
    case "too_big":
      if (issue.origin === "string") return `Keep ${field}${ofOwner} to ${issue.maximum} characters or fewer.`;
      if (issue.origin === "array" || issue.origin === "set")
        return `Keep ${field}${ofOwner} to ${issue.maximum} entries or fewer.`;
      return `Make ${field}${ofOwner} ${issue.maximum} or less.`;
    case "invalid_value":
    case "invalid_enum_value":
      return `Pick ${field}${forOwner} from the list.`;
    case "invalid_format":
      return `${capitalised(field)}${ofOwner} can use only lowercase letters, digits and hyphens.`;
    case "unrecognized_keys": {
      const keys = (issue.keys ?? []).map((key) => LABELS[key] ?? spelledOut(key));
      return keys.length === 1
        ? `Remove the ${keys[0]} field${ofOwner}. This kind of record has no such field.`
        : `Remove the fields ${keys.join(", ")}${ofOwner}. This kind of record has none of them.`;
    }
    case "not_multiple_of":
      return `Make ${field}${ofOwner} a multiple of ${issue.divisor}.`;
    default:
      return `Check ${field}${forOwner}. It isn't filled in a way this record takes.`;
  }
}

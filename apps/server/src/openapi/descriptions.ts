// Prose several Codex writes share.
const CODEX_COMMAND_ID =
  "Optional idempotency key, unique to ONE request: resend the same id to retry that request safely and the stored outcome is replayed verbatim with `x-idempotent-replay: true`. Reusing an id for a DIFFERENT request is a 400 rather than a replay - answering the earlier response would silently skip the later write.";
const JOURNAL_SESSION_ID =
  "File this entry under a session BY ID. Omitted on a create auto-files it under the ACTIVE session; explicit `null` files it under none; an id naming no session is a 404. `sessionNumber` is NOT accepted on any write - the number is a display value the server resolves from the linked record, so a body carrying one is a 400 with the key named in `details.issues`.";
const CODEX_TAGS =
  "Up to 24 tags, each 1-40 characters, trimmed and lowercased server-side. Replaced wholesale when present.";
const QUEST_STATUS =
  "In LIFECYCLE order. `not-started` and `active` are the OPEN states - a quest the party can still do - and `completed`, `failed` and `canceled` are three different ways of being finished with one. `canceled` is not a synonym for `failed`: a lead the party never took up did not fail. A quest created without a status is `not-started`.";

// Prose the Codex record shapes share.
const IN_WORLD_LABEL = "Display form of the in-world date, derived from the calendar.";
const CALENDAR_INSTANT = "Sortable absolute day index derived from the calendar.";
const IN_WORLD_DATE = "The raw in-world date; the source of truth the other two are derived from.";
const GM_ONLY = "GM-only; absent from a player projection.";
const GM_ONLY_CHRONICLE = "GM-only; not declared on `CodexChronicleRecordPlayer`.";
const GM_REV =
  "GM-only optimistic-concurrency counter; absent from a player projection. Pass it back as `expectedRev` to reject a stale edit.";
const REVEALED_SUBSET = "Filtered to the revealed subset.";

// Prose the content catalogs share.
const CHOICE_CATALOG =
  'An open catalog slug supplying the options instead of (or beside) `from` - the same grammar a feature\'s `fromCatalog` uses, resolved by the same function on both sides. Species language choices use "standard-languages"; null when `from` names the options outright';
const ATTRIBUTION =
  "The bundle's canonical CC BY 4.0 statement - ADR-0015 requires it on any surface that displays this content";
const CASTER_PROGRESSION = "How this class's levels count toward the shared multiclass caster level";
const PREPARES = "known = a fixed spells-known list; prepared = re-chosen on a long rest";
const FOCUS = "Spellcasting focus slug (arcane-focus, holy-symbol); null = none";
const SPELL_LIST = "The spell list this class draws from - an open slug matched against each spell's `classes` tags";
const STARTING_EQUIPMENT =
  "Starting-equipment bundles with their items and the \"or take N gp\" alternative; the chosen option's id is recorded in the character's choice ledger";

// Prose the table reads share.
const DEFENCE_TYPE = 'A damage type, e.g. "fire"';
const DEFENCE_SOURCE = "The feature, item or effect that grants it; null for the stat block itself";
const MAP_FOLDER = "The map library folder this map is filed under; null when it is unfiled.";

/** Prose for the generated components, keyed by component and then by path: "" is the component itself, "a.b" a
 *  nested property and "a[]" an array's items. A path that no longer exists fails the document build. */
export const DESCRIPTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  ApiErrorEnvelope: {
    "error.details":
      "Facts about the error. On a refused game command or read, `reason` is a stable code for why, finer than `code` and safe to branch on (the message may be reworded): not_joined, validation_failed, forbidden, not_found, stale_revision, needs_confirm, refused, history_review, scene_room_full or internal_error; a rules-mode block's reason is the blocking rule's id (`details.blocked.rule`)."
  },
  IntegrationCredentialIssued: {
    token: "Shown exactly once; the server stores only a salted hash and cannot redisplay it."
  },
  RotateIntegrationCredentialRequest: {
    expiresAt: "Omit to keep the current expiration; null clears it."
  },
  GameMutationAccepted: {
    "": "Commands append extras: rollId/hiddenFromRoller (dice), actorId (adds/imports), annotationId, resolution (action.resolve), outcome (save.answer), type (tunnel).",
    duplicate:
      "True when this commandId was already processed; the stored outcome's revision is returned and nothing re-executed."
  },
  GameSnapshot: {
    game: "GmView (full state + presence + turnHistory) or PlayerView (visibility-filtered actors with banded monster HP, filtered rolls/annotations/saves) - exactly what the same principal receives over Socket.IO."
  },
  GameLogEntry: {
    kind: "damage, heal, save, action, condition, reaction, turn, encounter, scene, history, roll - additive over time"
  },
  GameCommandEnvelope: {
    type: "A cataloged command type, e.g. encounter.start or actor.apply-damage",
    payload: "The command's Socket.IO payload shape, minus commandId/expectedRevision (carried at the envelope level)"
  },
  EncounterArchiveSummary: {
    playerVisible: "Has the GM shared this record with players? False until shared"
  },
  EncounterArchiveLaunch: {
    sceneId: "The new live scene holding the restored moment",
    actorIds: "The cloned combatants, so a client can offer to remove them with the replay scene"
  },
  EncounterArchiveDocument: {
    document:
      "archiveSchemaVersion 3 (additive over 1 and 2): { archiveSchemaVersion, startedAt, endedAt, turnCount, turns[{index,kind,label,revision,at,state}], log[], journal[{seq,commandId,type,actorId,principal,payload,revision,at}], finalState, postEncounterState, rolls[], definitions[{id,source,definition}], attribution }"
  },
  PlayerSessionIssued: {
    token: "Bearer token for player-limited calls; long-lived, not individually revocable (LAN trust)."
  },
  HomebrewValidationIssue: {
    path: 'Field path into the authored record, e.g. ["levelTable", 3, "spellSlots"] - the offending field, machine-addressable, so a form editor can point at it instead of parsing prose',
    recordId:
      "Which record in a pack the issue belongs to; null for a single-record publish. Present-but-null, so a consumer never branches on key presence"
  },
  HomebrewValidity: {
    "": "Whether a record may be published, and why not. Carried on every single-record read so the GM's library can say \"3 drafts can't publish yet\" without a round-trip per record."
  },
  HomebrewRecord: {
    "": "The AUTHORED CONTENT ONLY - never row state. `state`, `visibleToPlayers`, and `deletedAt` live on HomebrewRecordDocument and never here, which is what stops an imported pack from inheriting the exporting table's visibility policy. One branch per `HomebrewContentType`, discriminated by the body's own `type`. A field with a server-side default is optional on the wire, and an optional field is absent rather than null."
  },
  HomebrewClassRecord: {
    "": "A character class. The heaviest of the nine: a full 20-row printed table plus every feature it can grant. Duplicating an SRD class (`POST /content/{id}/duplicate` with `wizard`) is what makes that tractable to author.",
    id: "The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write - a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas",
    source:
      'Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same',
    summary: "Short blurb for the wizard's pick card",
    description: "Long prose. Always the display source of truth; the structured riders only add mechanics on top",
    attribution:
      "Credit line when the text came from somewhere else; SRD records inherit the bundle-wide CC BY notice instead",
    hitDie: "The multiclass hit-dice pool keys on this",
    statPriority:
      "All six abilities, best first - the random generator's core input as DATA, so a homebrew class supplies its own without touching @vtt/rules-5e",
    multiclassProficiencies:
      "Proficiencies gained when the class is taken as a MULTICLASS - narrower than the level-1 set",
    subclassLabel: 'What this class calls its subclass ("Martial Archetype")',
    levelTable:
      "Exactly 20 rows, row N at level N. Each row's `features` must resolve against this record's own `features[]` - the server refuses the record otherwise, which is why re-minting an id on import never rewrites intra-record ids"
  },
  HomebrewSubclassRecord: {
    "": "A subclass. Third-caster subclasses (Eldritch Knight, Arcane Trickster) declare their own `spellcasting` and overlay extra table rows on the parent class's.",
    id: "The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write - a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas",
    source:
      'Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same',
    summary: "Short blurb for the wizard's pick card",
    description: "Long prose. Always the display source of truth; the structured riders only add mechanics on top",
    attribution:
      "Credit line when the text came from somewhere else; SRD records inherit the bundle-wide CC BY notice instead",
    classId:
      "The class this subclass belongs to. Re-minting a class id on pack import rewrites this - it is one of the seven derived-id fields",
    subclassLevel: "The class level this subclass is taken at; omitted inherits the parent class's"
  },
  HomebrewSpeciesRecord: {
    "": "A playable species. NOTE the deliberate absence of required ability bonuses: SRD 5.2.1 puts ability increases on the BACKGROUND. `abilityBonuses` exists anyway as optional data so a 2014-style or homebrew species can still carry them, and the builder applies whatever a record declares instead of assuming an edition.",
    id: "The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write - a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas",
    source:
      'Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same',
    summary: "Short blurb for the wizard's pick card",
    description: "Long prose. Always the display source of truth; the structured riders only add mechanics on top",
    attribution:
      "Credit line when the text came from somewhere else; SRD records inherit the bundle-wide CC BY notice instead",
    sizes: "A list because several 2024 species let the player pick Small or Medium",
    abilityBonusChoice: '"Choose N abilities to raise by M" - the 2014 variant-human pattern',
    lineages: "Lineages / subraces, each adding its own traits on top"
  },
  HomebrewBackgroundRecord: {
    "": "A background. In SRD 5.2.1 this is where ability increases and the origin feat live, so it is the record a homebrew origin is authored on.",
    id: "The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write - a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas",
    source:
      'Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same',
    summary: "Short blurb for the wizard's pick card",
    description: "Long prose. Always the display source of truth; the structured riders only add mechanics on top",
    attribution:
      "Credit line when the text came from somewhere else; SRD records inherit the bundle-wide CC BY notice instead",
    abilityOptions:
      "SRD 5.2.1 ability increases: which abilities, and the legal distributions as data (+2/+1 or +1/+1/+1) so a homebrew background can print its own",
    originFeatId:
      "The origin feat this background grants, keyed into the feat catalog - one of the seven derived-id fields a pack import rewrites"
  },
  HomebrewFeatRecord: {
    "": "A feat: catalog metadata plus ONE HomebrewFeature carrying all the mechanics. Nothing about a feat is special-cased - it is literally the same feature record a class or species uses, which is why the smallest of the nine still exercises the whole rider vocabulary.",
    id: "The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write - a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas",
    source:
      'Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same',
    summary: "Short blurb for the wizard's pick card",
    description: "Long prose. Always the display source of truth; the structured riders only add mechanics on top",
    attribution:
      "Credit line when the text came from somewhere else; SRD records inherit the bundle-wide CC BY notice instead",
    category:
      "Open slug: origin, general, fighting-style, epic-boon, or anything homebrew adds. Feeds the `<category>-feats` catalog slug a feature choice can point at",
    prerequisite: "The SERVER decides whether a prerequisite is met - never the client",
    "prerequisite.requires":
      'Proficiency or feature slugs the character must already have ("fighting-style"); "spellcasting" means a class or subclass Spellcasting feature',
    "prerequisite.abilityScoreMode":
      'Whether every ability minimum must be met ("all") or any one of them ("any": Grappler\'s "Strength or Dexterity 13+")',
    "prerequisite.text": "Anything not modeled above, printed for the player to judge (ADR-0008 prose fallback)"
  },
  HomebrewSpellRecord: {
    "": "A spell. `classes` carries the spell-list ids this spell belongs to - it is how a homebrew spell joins a list, paired with the class record's `spellcasting.spellListId`.",
    id: "The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write - a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas",
    source:
      'Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same',
    attribution:
      "Credit line when the text came from somewhere else; SRD records inherit the bundle-wide CC BY notice instead",
    level: "0 is a cantrip",
    reactionCondition: "What triggers the reaction, for a spell cast as one; null otherwise",
    "damage.roll": 'Base damage/healing roll ("8d6"), or null when the spell rolls nothing',
    save: "The save the spell forces; null when it forces none",
    shape: "The area of effect; null for a single-target spell",
    classes:
      'Spell-list ids this spell belongs to ("wizard", a homebrew list slug). A HomebrewSpellListRecord can also pull a spell in without touching this',
    castingOptions: "Per-slot-level upcast scaling; the sheet applies the row matching the chosen cast level"
  },
  HomebrewEquipmentRecord: {
    "": 'Any item: weapon, armor, shield, gear, tool, pack, focus, consumable, magic item, or a homebrew kind nobody has invented yet. It has no `summary` or `attribution`, and an undeclared key is refused. `slot` is now the mechanical hook (`category` stays the open display slug), so a homebrew `category: "relic"` with `slot: "armor"` does derive AC. Every rider below lives on the CATALOG record and never on the carried inventory row: an owner is handed their whole inventory verbatim in their projection, so a rider mirrored onto that row would reach the player the instant they picked the item up - which is what makes hiding a cursed item\'s mechanics structural rather than a deletion someone has to remember.',
    id: "The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write - a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas",
    source:
      'Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same',
    category:
      'Open slug, never a closed enum - "relic", "vehicle", "trinket" need no schema change. Display and grouping; `slot` is what the engine switches on',
    description:
      "Raised from 2000 to 4000 on 2026-08-11 to match both `EquipmentReferenceSchema` and `InventoryItemSchema.description`, the row this string is copied onto by add-from-catalog. Widening a maxLength accepts everything the old bound did, so no caller that validated before stops validating",
    weapon: "Populated for weapons only",
    armor: "Populated for armor and shields only",
    slot: "WHERE it is worn or held - the mechanical hook, and the one closed enum here. Absent = fall back to `category` for the three the engine already knows (weapon, armor, shield)",
    appliesTo:
      "Makes the item a TEMPLATE (the SRD's \"Weapon, +1 (Any Simple or Martial)\"). `label` is the printed wording the chooser shows; `baseIds` the RESOLVED weapon/armor ids the player may pick from - publish refuses an id the merged catalog cannot resolve, a non-weapon/armor category, and fixed stats alongside a template. The picked base's stats are copied onto the inventory row by the SERVER at set-inventory; the row records the pick as `baseId`.",
    rarity:
      'Display and filtering only ("uncommon", "legendary"). An OPEN slug: rarity is identity, not a mechanical hook',
    attunement: "Attunement requirement and its advisory class/species restriction",
    cursed:
      "A cursed item cannot be voluntarily removed once attuned, and its magic half is withheld from the player until attunement. It MUST require attunement - a curse you can drop by taking the hat off is not a curse, and requiring attunement gives the hiding rule one well-defined boundary: hidden until attuned, fully visible after, because by then the player has learned it and hiding further would only make their own sheet lie to them",
    casts: "Spells the item can cast (Amulet of Message, Wand of Fireballs)",
    grantsFeatIds:
      "Feats the item grants while active. Depth 1, no transitive expansion, and the grant edge is one-directional - nothing ever grants an item back - so a cycle cannot be drawn rather than merely being checked for",
    tags: "Open grouping slugs for the sheet (spellcasting, fighting-style, channel-divinity)",
    actions: "Rollable actions this adds to the sheet (Second Wind, Channel Divinity, Breath Weapon)",
    effects:
      "Effects it can grant, in the same vocabulary the live rules engine already resolves (Rage, Bardic Inspiration)",
    uses: "Limited uses recovered on a rest",
    grants: "Flat proficiency/language/spell grants",
    modifiers: "Typed numeric riders"
  },
  ItemSpellCast: {
    "": 'A spell an item can cast. Needs no new machinery: an item cast is one more synthesised action whose limited uses collapse into the same live uses namespace a feature\'s do, and rests already re-arm it. "Once per day" is `uses: {"limit": 1, "per": "long-rest"}` - there is deliberately no "day" in the `per` vocabulary, because this app already treats a long rest as the day.',
    atLevel: "Cast at this slot level; absent = the spell's own level",
    ability: "Which ability powers it; absent = the wielder's own spellcasting ability",
    saveDc: 'A flat printed DC ("save DC 15"), overriding any derivation',
    uses: "Charges. Share one pool across several casts with `uses.pool`",
    consumesSpellSlot: "Whether casting it also spends one of the bearer's own spell slots"
  },
  ItemAttunement: {
    "": 'Attunement. `restrictedTo` matches class ids or a species id and is ADVISORY - shown on the sheet ("Requires attunement by a cleric"), never a block: it is an open slug set, blocking on a fuzzy match would be wrong, and a GM handing a player a restricted item on purpose is a normal table event rather than an error to refuse.',
    restrictedTo: "Class or species ids the item is meant for. Advisory only"
  },
  HomebrewMonsterRecord: {
    "": "A creature stat block: an ActorDefinition, the same shape `actor.import-definition` and the bundled bestiary use. Note `source` here is bundle PROVENANCE (`{name, version, externalId}`), deliberately NOT the srd/homebrew discriminator the other eight carry: that name was already taken, and a sibling key meaning the same thing twice is worse than deriving homebrew-ness from the row (which is what the merge does). The row's id becomes `source.externalId`.",
    id: "The row's id. NOT part of ActorDefinitionSchema - the server stamps it into the stored body so the merged bestiary can resolve the record back to its row",
    schemaVersion: "ADR-0007 integer schema version; discoverable at /system/version",
    source: "Bundle provenance, not the content discriminator",
    "hitPoints.formula":
      'One die term plus at most one flat modifier ("1d8 + 3"). Anything richer stays prose (ADR-0008)',
    token: "The battlemap PIECE - disposition and grid footprint. Nothing to do with credentials",
    extensions:
      'Free-form passthrough an importer may carry. One bag is read: publishing needs `extensions["open5e.srd-2024"]` to hold a numeric `challengeRating` (0.125 for CR 1/8) and a non-empty `type` ("dragon"), because the bestiary lists, sorts and searches by them. Example: `{"open5e.srd-2024": {"challengeRating": 5, "type": "giant"}}`. Everything else is carried and never read',
    conditionImmunities: "Reference-level for now: displayed, not yet enforced on actor.set-condition",
    legendary:
      "SRD 2024 legendary resources: actions spent on other creatures' turns, and Legendary Resistance uses that re-arm on a long rest",
    character:
      "The CHARACTER half of an ActorDefinition (class/level/species/background/feats and the choice-provenance ledger). A monster leaves it absent: the character builder writes it, never a homebrew author",
    proficiencies: "Save/skill proficiency selections; the character half, see `character`",
    spellcasting:
      "A spellcasting creature's ability, slot maxima, and known/prepared list; the character half, see `character`",
    startingInventory: "Immutable starting loadout; the character half, see `character`",
    startingCurrency: "Immutable starting coins; the character half, see `character`"
  },
  HomebrewSpellListRecord: {
    "": 'A spell list as a membership OVERLAY, never an edit to the generated spell bundle: `basedOn` expands existing lists, `add` layers ids on top, and `remove` always wins. That is what keeps "the Wizard list plus my three spells" ONE row instead of 221. A list resolving to ZERO spells is a hard character-creation rejection downstream, so publish-time validation refuses an empty one.',
    id: "The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write - a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas",
    source:
      'Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same',
    summary: "Short blurb for the wizard's pick card",
    description: "Long prose. Always the display source of truth; the structured riders only add mechanics on top",
    attribution:
      "Credit line when the text came from somewhere else; SRD records inherit the bundle-wide CC BY notice instead",
    basedOn: "Start from these existing list ids - SRD (`wizard`) or another overlay. Empty starts blank",
    add: "Spell ids added on top of the `basedOn` expansion. SRD spell ids are perfectly legal here",
    remove: "Spell ids removed last, after everything else"
  },
  ChoiceList: {
    "": 'A "choose N from this list" proficiency grant (class skills, background tools, species languages). Needs a non-empty `from` or a `fromCatalog` whenever `choose` is above zero - a budget with no source can never be satisfied and the wizard could not be finished.',
    fromCatalog: 'An open catalog slug resolved at pick time ("standard-languages", "tools", "skills")'
  },
  StartingEquipmentOption: {
    "": 'A named starting-equipment bundle ("A: chain mail and a martial weapon", "C: 155 gp"). The chosen option\'s id is what lands in the character\'s choice ledger, so the items must be RESOLVABLE - a label alone can be displayed but never turned into inventory.'
  },
  ClassLevelRow: {
    "": "ONE row of a class's 20-level table. `features` lists the ids granted at that level, resolved against the owning record's own `features[]`. The optional columns carry whatever the printed table carries - omit a column this class does not have rather than sending zeroes.",
    spellSlots: "Nine counts, index 0 = 1st-level slots. Omitted on a non-caster row",
    pactSlots: "Warlock Pact Magic: one uniform slot level with its own count",
    preparedFormula:
      'The prepared-spell rule as data ("<ability> modifier + <class> level") so a homebrew class prints its own wording',
    classResources:
      "Named per-level resources (Rage 3, Ki 5, Sneak Attack 3d6, Second Wind 3). A PRINTED COLUMN, not a namespace: the live pool the engine spends is `actor.actionUses[uses.pool ?? action.id]`, and an id here reaches it only by matching a `uses.pool` on the same class. Mark a column that is genuinely only ink with `display: true`",
    "classResources[].amount": "A count, or a dice string",
    "classResources[].display": "This column is ink only - no live pool answers to this id, and none is expected to"
  },
  Spellcasting: {
    "": "Spellcasting a class - or a third-caster subclass - grants.",
    prepares: "known = a fixed spells-known list; prepared = re-chosen on a long rest",
    focus: "Spellcasting focus slug (arcane-focus, holy-symbol, druidic-focus); null = none",
    multiclassProgression: "How this class's levels count toward the shared multiclass caster level",
    spellListId:
      "The spell list this class draws from - an open slug, so a HomebrewSpellListRecord works. One of the seven derived-id fields a pack import rewrites (it also implies the `<listId>-spells` catalog slug)"
  },
  MulticlassPrerequisite: {
    "": 'Ability minimums for taking this class as a multiclass; `mode: "any"` covers "STR 13 or DEX 13". Display data - the server re-validates.'
  },
  SpellSave: {
    "": "The save a spell forces: the ability the target rolls and what the save does. The caster supplies the DC.",
    successDamage: 'The damage a successful save takes: "half" (Fireball) or "none" (Sacred Flame)',
    failureConditions:
      "Every condition a failed save imposes (Turn Undead: Frightened and Incapacitated); empty for none. Exhaustion is not offered: it stacks by level"
  },
  SpellShape: {
    "": "A spell's area of effect."
  },
  EquipmentWeapon: {
    longRangeFeet: "Attacks past `rangeFeet` up to this roll at disadvantage",
    mastery:
      "The SRD weapon-mastery property, if this weapon has one. Optional: a homebrew weapon may have none, and a mastery does nothing until a character unlocks THIS weapon through Weapon Mastery.",
    properties:
      "The weapon's property slugs. The engine reads three of them off the character's inventory row: `finesse` makes the swing take the better of Strength and Dexterity, `thrown` keeps a ranged weapon on a melee reach, and `reach` makes it 10 feet instead of 5; the rest narrow a `weapon-property-is` rider. Open slugs, unlike `mastery`, so a homebrew property is expressible - but only the nine SRD ones have readers, and an unknown slug is inert rather than an error. Omit to record nothing; an empty array says the weapon has none."
  },
  EquipmentArmor: {
    "": "Body armor carries its full base AC (11-18); a shield carries its +2 bonus."
  },
  Feature: {
    "": "THE shared feature record: a class feature, a subclass feature, a species trait, a background feature, and a feat's mechanics are all this one shape. `description` is always the display source of truth, and every rider is optional - a prose-only feature is perfectly valid and is how most text starts life. This is the AUTHORING counterpart of `ContentFeature`, which publishes the same feature with its riders stripped.",
    level:
      "Class/subclass level this feature is gained at; on a species or lineage trait, the character level it arrives at (Draconic Flight at 5). Omitted for records held from level 1 (most traits, feats)",
    choice:
      "A pick this feature asks the player to make; every one writes a row in the character's choice-provenance ledger, which is what makes level-up and respec possible",
    choices:
      "SEVERAL picks, when one record promises more than one - Magic Initiate's \"two cantrips ... and one level 1 spell\", Deft Explorer's Expertise plus two languages. Mutually exclusive with `choice`, which stays the way almost every record is authored",
    extraPicks:
      'Budgets this raises rather than outcomes it grants: "you know one extra cantrip from the Cleric spell list", "one additional skill from your class\'s list". The printed level row and every grant are SUMMED, so two features each granting +1 yield +2',
    replaces:
      'Picks this lets the character RE-MAKE later - "whenever you finish a Long Rest, choose one type of land". Not a budget increase: it edits an answer. A level-up clause rewrites the choices ledger; a rest clause is runtime state on the actor, cleared by the matching rest',
    tags: "Open grouping slugs for the sheet (spellcasting, fighting-style, channel-divinity)",
    actions: "Rollable actions this adds to the sheet (Second Wind, Channel Divinity, Breath Weapon)",
    effects:
      "Effects it can grant, in the same vocabulary the live rules engine already resolves (Rage, Bardic Inspiration)",
    uses: "Limited uses recovered on a rest",
    grants: "Flat proficiency/language/spell grants",
    modifiers: "Typed numeric riders",
    replacesFeatureId: "This feature REPLACES an earlier one of the same id lineage (Indomitable at 9/13/17)",
    extraSpellLists:
      "Spell lists the class's OWN prepared and cantrip picks may also draw on, the spells counting as that class's (Magical Secrets: the Bard's picks may come from the Cleric, Druid and Wizard lists). Widens an existing budget; it adds no picks"
  },
  FeatureChoice: {
    "": "A pick a feature asks for, in three increasing richnesses: `fromCatalog` (an open catalog slug resolved at pick time), `from` (explicit ids whose mechanics live elsewhere or nowhere), or `options` (the ids WITH their mechanics inline, for options that exist only here - Divine Order's two sacred roles, Giant Ancestry's six boons). `options` and `from` are mutually exclusive: after parsing, `from` always holds the canonical id list, derived from `options` when they were authored.",
    kind: "Open slug the wizard renders generically: fighting-style, skill, expertise, subclass, asi, feat, spell, cantrip, language, tool, or anything homebrew invents",
    from: 'Explicit option ids. Must name at least one - an empty list is an authoring mistake, not "no options offered". Omit the field entirely when `fromCatalog` or `options` supplies the list',
    fromCatalog: "An open catalog slug resolved at pick time (skills, feats, wizard-spells)",
    maxSpellLevel: "Ceiling on a spell pick's level (Magic Initiate: 0, cantrips only)",
    minSpellLevel:
      'Floor on a spell pick\'s level, the sibling of maxSpellLevel. Mystic Arcanum reads "one level 6 Warlock spell", not "6 or lower"; both bounds at 6 make the pick exact',
    fromPicks:
      'THE OPTIONS ARE THE CHARACTER\'S OWN EARLIER ANSWERS - "choose one of your known Warlock cantrips that deals damage". `offer` names the budget holding them, in the same key namespace extraPicks uses; `where` is a CLOSED predicate slug, never an expression. Resolves to a non-empty list or DEFERS, exactly as an unresolvable fromCatalog does.',
    maximum:
      "Ceiling an ability-score pick from THIS choice may raise a score to; omitted = the SRD's 20. The sibling of the `ability-score` rider's own `maximum`, and separate because the mechanisms differ: a rider raises a NAMED ability, a choice lets the player pick which - and the epic boons (\"increase one ability score by 1, to a maximum of 30\") do the second",
    repeatable: "The same option may be picked more than once (Expertise across levels)",
    options: "Options carrying their own mechanics. Mutually exclusive with `from`"
  },
  FeatureOption: {
    "": 'ONE pickable option that carries its OWN mechanics - structurally a HomebrewFeature minus `replacesFeatureId`, with identical rider fields and identical meanings. That is the point: a chosen option is interpreted by the very same code path that interprets a class feature, so "Divine Order: Protector" carries its Martial-weapon and Heavy-armor training itself instead of being a bare id string nothing downstream can read.',
    requires:
      'This option is legal only when an EARLIER answer says so - "the option you chose for Blessed Strikes grows more powerful". `offer` is the same offer-key namespace `extraPicks` uses. When gating leaves exactly as many legal options as the capacity, the survivors are ADOPTED and no pick is rendered: the answer is a consequence, not a choice.',
    level:
      'The class level this option may first be chosen at - an invocation\'s "Prerequisite: Level 5+ Warlock". A build below it is not offered the option',
    choice: "A SECOND-ORDER pick this option owes once chosen, from a list of its own",
    choices:
      "SEVERAL second-order picks (Pact of the Tome asks for three cantrips AND two rituals). Mutually exclusive with `choice`",
    extraPicks:
      'Budgets this raises rather than outcomes it grants: "you know one extra cantrip from the Cleric spell list", "one additional skill from your class\'s list". The printed level row and every grant are SUMMED, so two features each granting +1 yield +2',
    replaces:
      'Picks this lets the character RE-MAKE later - "whenever you finish a Long Rest, choose one type of land". Not a budget increase: it edits an answer. A level-up clause rewrites the choices ledger; a rest clause is runtime state on the actor, cleared by the matching rest',
    tags: "Open grouping slugs for the sheet (spellcasting, fighting-style, channel-divinity)",
    actions: "Rollable actions this adds to the sheet (Second Wind, Channel Divinity, Breath Weapon)",
    effects:
      "Effects it can grant, in the same vocabulary the live rules engine already resolves (Rage, Bardic Inspiration)",
    uses: "Limited uses recovered on a rest",
    grants: "Flat proficiency/language/spell grants",
    modifiers: "Typed numeric riders"
  },
  ReplaceableChoice: {
    "": 'ONE "you can replace…" clause. `offer` is the same offer-key namespace `extraPicks` uses, and a key naming no pick this build has is a loud build rejection. `when: "level-up"` is a build-time permission over the choices ledger (the replaced row is deleted, never tombstoned); `"short-rest"` / `"long-rest"` are runtime state on the actor, set by actor.rechoose and cleared by the matching rest - a short-rest clause is satisfied by a long rest too.',
    amount: "How many of that offer's answers may be swapped at once"
  },
  ExtraPick: {
    "": "ONE budget a feature or a chosen option RAISES. `offer` is the offer key the wizard and the server already share verbatim - `class-cantrips`, `class-spells`, `class-skills`, `class-tools`, `background-skills`, `background-tools`, `background-languages`, `species-languages`, or `feature:<featureId>` - not a new namespace and not a closed enum. A key naming no budget the build actually has is a LOUD rejection at creation, never a silent zero: an authored grant that quietly adds nothing is the failure this vocabulary exists to end.",
    offer: "The offer key whose capacity this raises",
    amount:
      'How many extra picks, as a flat number. Additive across every source that names the same budget. Exactly one of `amount` and `scaling` is authored - a defaulted amount beside a scaling rule would be indistinguishable from an authored one, and "the flat amount was silently ignored" is the failure this vocabulary exists to end',
    scaling:
      "How many extra picks, read off the class table's own printed column instead of a constant. The budget then follows the column at every level"
  },
  ExtraPickScaling: {
    "": "A pick budget that FOLLOWS A PRINTED COLUMN - the same fourth way `HomebrewFeatureUses` scales a feature's uses, applied to capacity. `class-resource-growth` yields how far the named `classResources` column has grown above its first printed value at this character's level, so the feature's own `choose` plus the growth is the printed total: Eldritch Invocations runs 1 -> 10 and Weapon Mastery 3 -> 6 (Fighter) and 2 -> 4 (Barbarian). Repeat grants cannot express these - the column steps at levels where the SRD prints no feature heading to carry a grant at all.",
    id: "The `classResources.id` of the printed column (eldritch-invocations, weapon-mastery)"
  },
  FeatureOptionChoice: {
    "": "THE TERMINAL of the feature/choice/option cycle. Identical to HomebrewFeatureChoice except that it HAS NO `options` KEY AT ALL, so the recursion is bounded by the schema rather than by a promise in prose: an option's own pick may name ids or a catalog slug, and can never open a third level.",
    kind: "Open slug the wizard renders generically: fighting-style, skill, expertise, subclass, asi, feat, spell, cantrip, language, tool, or anything homebrew invents",
    from: 'Explicit option ids. Must name at least one - an empty list is an authoring mistake, not "no options offered". Omit the field entirely when `fromCatalog` or `options` supplies the list',
    fromCatalog: "An open catalog slug resolved at pick time (skills, feats, wizard-spells)",
    maxSpellLevel: "Ceiling on a spell pick's level (Magic Initiate: 0, cantrips only)",
    minSpellLevel:
      'Floor on a spell pick\'s level, the sibling of maxSpellLevel. Mystic Arcanum reads "one level 6 Warlock spell", not "6 or lower"; both bounds at 6 make the pick exact',
    fromPicks:
      'THE OPTIONS ARE THE CHARACTER\'S OWN EARLIER ANSWERS - "choose one of your known Warlock cantrips that deals damage". `offer` names the budget holding them, in the same key namespace extraPicks uses; `where` is a CLOSED predicate slug, never an expression. Resolves to a non-empty list or DEFERS, exactly as an unresolvable fromCatalog does.',
    maximum:
      "Ceiling an ability-score pick from THIS choice may raise a score to; omitted = the SRD's 20. The sibling of the `ability-score` rider's own `maximum`, and separate because the mechanisms differ: a rider raises a NAMED ability, a choice lets the player pick which - and the epic boons (\"increase one ability score by 1, to a maximum of 30\") do the second",
    repeatable: "The same option may be picked more than once (Expertise across levels)"
  },
  FeatureAction: {
    "": "A rollable action a feature adds to the sheet (Second Wind, Channel Divinity, Breath Weapon). Identical to HomebrewStatblockAction except for `attack`/`save`: a class feature cannot know the character's ability scores, so it names the ability and the builder DERIVES the number, where a stat block prints it.",
    description: "Always the display source of truth; every rider below only adds mechanics on top",
    "damage[].formula":
      'One die term plus at most one flat modifier ("1d8 + 3"), or a fixed amount that uses no roll ("1", a Blowgun), which a crit leaves as it is. Anything richer stays prose (ADR-0008)',
    multiattack: "Compound action: resolving a component consumes the shared action slot once and tracks the rest",
    onHit: "Conditions applied to the target as one source-linked effect",
    targetRules: "Targeting restrictions the engine enforces",
    grants: "Resolving this action grants an effect to the actor itself (Rage, Reckless Attack)",
    requiresEffectTag: 'The action requires an active self effect carrying this tag (Frenzy requires "raging")',
    uses: "Limited uses; unlike a feature's, an action's may recharge on a d6",
    reaction:
      'A declared reaction the engine offers as a pending prompt when its trigger happens: half-damage (Uncanny Dodge), ac-bonus (Parry, Shield), strike-back (Hellish Rebuke) or melee-attack (Retaliation). Only meaningful on activation "reaction"',
    legendary:
      'SRD Legendary Action: taken on OTHER creatures\' turns, spending `cost` from the per-round pool. Pairs with activation "other"',
    replacesAttack:
      'Taken in place of ONE attack of the Attack action (Breath Weapon): it opens the Attack action, leaving the rest of its attacks for weapon swings, or spends one attack the action has left. Pairs with activation "action"',
    spellSlot:
      "Resolving this action ALSO spends one of the bearer's own spell slots of this level - the mechanical half of an item cast authored with `consumesSpellSlot`. Checked and spent by the same economy pass that owns limited uses, so a preview never spends one and an empty pool refuses in the same voice as an empty charge",
    spellId:
      'WHICH spell this action is a casting of. Identity only - every number the action rolls is already on the action itself - so it changes no arithmetic. It exists because the `spell-id-is` rider filter needs something to match: "when you cast Eldritch Blast" cannot be said with `spell-school-is` or `spell-level-is`, which name categories. Absent = not a spell, and every `spell-id-is` gate fails closed',
    damageByLevel:
      "Damage that grows with level, replacing `damage` at the highest matching level (Sneak Attack, Divine Smite)",
    healingByLevel:
      "Healing that grows with level, replacing `healing.formula` at the highest matching level (Divine Spark's heal, Wholeness of Body's Martial Arts die)",
    adds: 'Read off the character when it is built and added to the first damage part and to the healing: `classLevel` times its level ("1d10 plus your Fighter level", "five times your Cleric level") and `abilityModifier` ("add your Wisdom modifier")',
    grantScaling:
      "The granted effect's `damage-bonus` amounts become the named printed class column at the character's level (Rage Damage), and the action's text says the number",
    "damageByLevel[].formula":
      'One die term plus at most one flat modifier ("1d8 + 3"). Anything richer stays prose (ADR-0008)'
  },
  Action: {
    "": 'A stat block\'s action, in the exact `ActionSchema` vocabulary the live rules engine already resolves. Every mechanics field is optional: absent means "prose only", and the engine falls back to reference behavior.',
    conditionalDamage:
      "Damage a hit adds or swaps in under a printed condition: `advantage` (the attack roll had Advantage), `self-bloodied`, `target-bloodied`, `target-grappled-by-self`, applied by the engine; and `charge` (moved N feet straight toward the target first), which the engine cannot see, offered on the hit's preview for the attacker to confirm. `instead` replaces the first damage part; `plus` adds to the hit",
    reminder:
      "What the engine leaves to the GM, shown on the GM's result when the action resolves: damage on later turns, or a branch it cannot choose (a failure that turns on the target's Hit Points)",
    description: "Always the display source of truth; every rider below only adds mechanics on top",
    "damage[].formula":
      'One die term plus at most one flat modifier ("1d8 + 3"), or a fixed amount that uses no roll ("1", a Blowgun), which a crit leaves as it is. Anything richer stays prose (ADR-0008)',
    multiattack: "Compound action: resolving a component consumes the shared action slot once and tracks the rest",
    onHit: "Conditions applied to the target as one source-linked effect",
    targetRules: "Targeting restrictions the engine enforces",
    grants: "Resolving this action grants an effect to the actor itself (Rage, Reckless Attack)",
    requiresEffectTag: 'The action requires an active self effect carrying this tag (Frenzy requires "raging")',
    uses: "Limited uses; unlike a feature's, an action's may recharge on a d6",
    reaction:
      'A declared reaction the engine offers as a pending prompt when its trigger happens: half-damage (Uncanny Dodge), ac-bonus (Parry, Shield), strike-back (Hellish Rebuke) or melee-attack (Retaliation). Only meaningful on activation "reaction"',
    legendary:
      'SRD Legendary Action: taken on OTHER creatures\' turns, spending `cost` from the per-round pool. Pairs with activation "other"',
    replacesAttack:
      'Taken in place of ONE attack of the Attack action (Breath Weapon): it opens the Attack action, leaving the rest of its attacks for weapon swings, or spends one attack the action has left. Pairs with activation "action"',
    spellSlot:
      "Resolving this action ALSO spends one of the bearer's own spell slots of this level - the mechanical half of an item cast authored with `consumesSpellSlot`. Checked and spent by the same economy pass that owns limited uses, so a preview never spends one and an empty pool refuses in the same voice as an empty charge",
    spellId:
      'WHICH spell this action is a casting of. Identity only - every number the action rolls is already on the action itself - so it changes no arithmetic. It exists because the `spell-id-is` rider filter needs something to match: "when you cast Eldritch Blast" cannot be said with `spell-school-is` or `spell-level-is`, which name categories. Absent = not a spell, and every `spell-id-is` gate fails closed',
    attack: "A printed to-hit bonus - the stat block knows its own numbers",
    "attack.rangeNormalFeet":
      'Normal range for a two-range weapon ("80/320" -> 80); attacks beyond it up to rangeFeet roll at disadvantage',
    save: "A printed save DC, and what the save does",
    "save.spellcasting":
      "The DC is the bearer's spell save DC (a spell, or a feature that uses it), so a `spell-save-dc` rider raises it. Absent: a printed DC no rider touches, such as a breath weapon's",
    "save.successDamage": 'The damage a successful save takes: "half" (Fireball) or "none" (Sacred Flame)',
    "save.failureConditions":
      "Every condition a failed save imposes (Turn Undead: Frightened and Incapacitated); empty for none. Exhaustion is not offered: it stacks by level"
  },
  FeatureAttack: {
    "": 'An attack a FEATURE grants. Same vocabulary as a stat block\'s attack except the to-hit bonus is DERIVED: the feature names the ability (or "spellcasting") and the builder resolves the number.'
  },
  FeatureSave: {
    "": "A save a feature forces. `ability` is what the TARGET rolls; `dc` is how the number is derived; the outcome fields are a stat block's.",
    dc: "Three forms, all of them data rather than a formula language (ADR-0008): the character's own spell save DC, a printed constant, or the SRD's \"DC 8 plus your <ability> modifier and Proficiency Bonus\" wording as three bounded fields.",
    successDamage: 'The damage a successful save takes: "half" (Fireball) or "none" (Sacred Flame)',
    failureConditions:
      "Every condition a failed save imposes (Turn Undead: Frightened and Incapacitated); empty for none. Exhaustion is not offered: it stacks by level"
  },
  FeatureSaveDcDerived: {
    "": "A DERIVED save DC: `base` plus the CASTER's ability modifier, plus proficiency bonus. Every SRD 5.2.1 printing uses base 8 with proficiency, which is why both default.",
    base: "The printed constant the modifiers are added to",
    ability: "Whose modifier is added - the CASTER's ability, not the one the target rolls"
  },
  FeatureUses: {
    "": 'Uses a feature gets back on a rest, as DATA rather than a formula language. Either `limit` or `scaling` must be present. The `per` vocabulary is deliberately NARROWER than an action\'s: there is no "recharge", because a recharge roll belongs to a stat block, not a character feature.',
    limit: "A flat count",
    scaling: "The four ways 5e actually scales a feature's uses.",
    pool: "Shares ONE counter across every feature carrying the same pool id"
  },
  FeatureUsesScalingProficiencyBonus: {
    "": "Uses equal to the character's proficiency bonus."
  },
  FeatureUsesScalingAbilityModifier: {
    "": "Uses equal to an ability modifier, floored at `minimum`."
  },
  FeatureUsesScalingClassResource: {
    "": 'Read the count straight off THIS class table\'s printed column, by `classResources.id`. The one the other three cannot say: Rage, Bardic Inspiration and Channel Divinity step on a schedule that is neither the proficiency bonus nor an ability modifier, and re-typing the printed column into a `by-level` table beside the column it duplicates is the second copy that drifts. A resource whose printed amount is a DICE STRING (Sneak Attack "3d6") is damage, not a count of uses, and resolves to no uses at all.'
  },
  FeatureUsesScalingByLevel: {
    "": "A printed per-level column."
  },
  FeatureGrants: {
    "": "Flat things a feature simply hands the character. All open slugs, so a homebrew language, tool, or armor group needs no schema change.",
    spells:
      "Spells the feature always has ready (domain spells, racial spells). `alwaysPrepared` spells do not count against a prepared list. `id` is one of the seven derived-id fields a pack import rewrites. This is the ONE list `when` cannot gate - see `when` below",
    when: 'The condition the TEN LIST FIELDS above apply under - every one except `spells`, which cannot be gated: a granted spell is baked into the sheet\'s spell list, its prepared count and its cantrip action when the character is BUILT, so nothing would re-read the gate. A block carrying both `when` and `spells` is refused, naming the spells that would have been lost. Omitted = unconditional, which is what every record written before this field meant. Only the two trigger kinds a derivation can answer are allowed - static gates (attuned, while-armored, while-unarmored, while-shield, while-character-is, while-proficient-with) and dynamic gates (while-effect-tag, while-hp-at-or-below, while-condition). A moment or a filter is refused: a grant is collected before any roll starts, so a gate it cannot evaluate would silently mean "always"'
  },
  Modifier: {
    "": "THE rider vocabulary: what a feature, a feat, a chosen option, a magic ITEM and a live EFFECT contribute to the rules engine, one union for every carrier and read by one evaluator against one context, so a bonus means the same thing wherever it is authored. Bounded and grown additively; anything not modeled stays prose (ADR-0008). Every amount is a SIGNED integer, so a curse is this vocabulary with a negative number rather than a second one, and every branch carries the `when`/`scope` gate. Carriers refuse what they cannot honour: an ITEM refuses `hit-points-per-level` and `ability-score` (both bake into the sheet and cannot be un-granted when the item comes off), and an EFFECT refuses every number stored on the sheet or the actor (`ability-score`, `hit-points-per-level`, `armor-class`, `initiative`, `unarmored-defense`, `darkvision`, `sense`, `spell-slot`), which an effect that ends could never give back."
  },
  ModifierAbilityScore: {
    "": "Raise (or lower) one ability score, optionally past the usual cap. REFUSED on an item: an ability score cascades into AC, saves, skills, spell DC, hit points and initiative, and every one of those reads the baked `abilityScores`, so layering one score means layering the whole sheet.",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierHitPointsPerLevel: {
    "": "Extra hit points at every level (Tough, Dwarven Toughness). REFUSED on an item: it changes `hp.maximum`, which live `hp.current` is tracked against, so unequipping could strand current above maximum - there is no correct silent answer.",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierSpeed: {
    "": "Change walking speed in feet, signed (Longstrider +10, the `slow` mastery -10). On a feature it is baked into the sheet's speed when the character is built, unless gated (Unarmored Movement's `while-unarmored`), when it is read with the live loadout; on an item or an effect it is summed live into the movement budget, so the feet come back when the item comes off or the effect ends.",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierArmorClass: {
    "": 'A flat AC rider. `whileArmored` is the ONE bounded condition the SRD\'s printed bonuses need (the Defense fighting style reads "While you\'re wearing Light, Medium, or Heavy armor"); it is a boolean, not a condition language, and defaults to the unconditional bonus every earlier record meant. `when: [{"type": "while-armored"}]` now says the same thing in the general vocabulary - the boolean STAYS because shipped bundles author it, and a collector normalises it into that trigger.',
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierInitiative: {
    "": "Change the initiative bonus.",
    proficiencyBonus:
      "Also add the bearer's Proficiency Bonus (Alert's Initiative Proficiency). Counted once however many riders say so",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierExtraAttack: {
    "": "Additional attacks on the Attack action.",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierUnarmoredDefense: {
    "": "AC = 10 + DEX + this ability while wearing no armor (Barbarian, Monk, and any homebrew that wants it).",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierDarkvision: {
    "": "Grant or extend darkvision.",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierSaveBonus: {
    "": 'A flat bonus to saving throws. Narrow it with `when: [{"type": "ability-is", "abilities": ["dex"]}]` (a Cloak of Protection is the unnarrowed form).',
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierCheckBonus: {
    "": "A flat bonus to ability and skill checks. Gloves of Thievery (+5 Sleight of Hand) is this plus a `skill-is` filter.",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierDamageBonus: {
    "": 'A flat bonus to damage rolls - the other half of a "+1 weapon" (`attack-bonus` is the to-hit half). Standing, it folds into the swing\'s printed damage formula; gated on a moment ("+7 on a critical hit", Rage\'s "+2 on a melee damage roll") it lands as its own labelled line at resolution, and only the damage roll\'s moments (`on-hit`, `on-critical-hit`, `on-damage-roll`) are accepted. Weapon-scoped by default on an item with a weapon block, so two magic weapons never stack.',
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierSpellSaveDc: {
    "": "Change the bearer's spell save DC. `classId` targets one caster on a multiclass sheet; absent = every caster the bearer has.",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierSpellAttackBonus: {
    "": "Change the bearer's spell attack bonus. A Wand of the War Mage is exactly this and nothing else.",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierSpellSlot: {
    "": "An extra spell slot of one level, layered over the single-sourced slot maxima so the seed, the long rest and the spend-clamp cannot disagree.",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierResourceBonus: {
    "": "One more use of a limited resource. `poolId` is the LIVE uses key (a `uses.pool` or an action id) - the namespace that is actually spent and re-armed - deliberately NOT the class level table's display-only `classResources`, where a rider would parse, store, project, and change nothing.",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierCriticalRange: {
    "": "Score a critical hit on this natural roll or higher (19 for a keen weapon).",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierCriticalBonusDice: {
    "": "Extra UNTYPED weapon dice on a critical hit (Savage Attacks). A typed crit-only 1d6 fire is `extra-damage` gated with `on-critical-hit` instead.",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierDamageReduction: {
    "": "Flat reduction of incoming damage, taken off the hit once before resistance and vulnerability (SRD Order of Application), from the largest part it covers first.",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierSense: {
    "": "The missing sibling of `darkvision`: any named sense in feet. Display-level, like `darkvision`, until a senses model exists.",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierAttackBonus: {
    "": "A flat bonus to the bearer's attack rolls. THE missing channel: the resolver's to-hit was the action's printed bonus plus exhaustion and nothing else could reach it.",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierExtraDamage: {
    "": 'Extra TYPED damage, in one of the 13 SRD damage types. An attack\'s `criticalBonusDice` is a bare count applied to the first damage part, so it cannot carry a type. TWO independent ways to say how much, and a rider may use either or both: `formula` is dice ("an extra 1d6 fire"), and `abilityModifier` adds the BEARER\'s modifier in that ability as a flat number resolved at the roll ("add your Charisma modifier to the damage") - a printed wording that no authored constant can express, because the amount depends on the character. Agonizing Blast is `abilityModifier: "cha"` plus a `spell-id-is` gate. A rider with NEITHER is refused at publish rather than stored to silently add nothing, and so is one gated on a moment the damage roll never collects (only `on-hit`, `on-critical-hit` and `on-damage-roll` are). `doubleOnCritical` defaults true because a Critical Hit rolls the attack\'s other damage dice twice too (SRD 5.2.1 "Critical Hits": "If the attack involves other damage dice, such as from the Rogue\'s Sneak Attack feature, you also roll those dice twice"); set it false only where a rule says otherwise. An ability modifier is never doubled at all.',
    formula: 'One die term plus at most one flat modifier ("1d8 + 3"). Anything richer stays prose (ADR-0008)',
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierRollMode: {
    "": 'Advantage or disadvantage on a NAMED roll: one branch with a `mode` field rather than two per roll kind. It feeds the same aggregation that already implements 5e cancellation (any advantage plus any disadvantage is normal) and labels each source on the roll card, so a curse is `mode: "disadvantage"` and needs no separate machinery. `concentration` is the Constitution save that keeps a spell going; `incoming-attack` is attacks made against the bearer (Dodge).',
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierDamageResistance: {
    "": "Resistance to the listed damage types (Rage). Read standing, before any roll, so a moment gate is refused at publish; gate it on a state (`while-effect-tag`) instead.",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ModifierDamageVulnerability: {
    "": "Vulnerability to the listed damage types - double damage, and the mirror of `damage-resistance`. Resistance and vulnerability to the SAME type both apply in order: halved (round down), then doubled (SRD 5.2.1 Order of Application), so 15 becomes 14.",
    when: "AND-list of at most four triggers gating this rider, with at most ONE moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow",
    scope:
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
  },
  ActionOnHit: {
    "": "On-hit riders: conditions applied to the target as ONE source-linked effect (a crocodile's Bite applies Grappled + Restrained with escape DC 15).",
    maxTargetSize: "The rider only applies to targets of at most this size"
  },
  ActionUses: {
    "": 'Limited uses for an ACTION. Unlike a feature\'s, this vocabulary includes "recharge" - a start-of-turn d6 at or above `recharge` (and any rest) restores it. `recharge` must be present when `per` is "recharge" and absent otherwise; the server enforces the biconditional.',
    pool: "Shares one counter across actions carrying the same pool id (Sneak Attack once per turn regardless of weapon)",
    recharge: 'The d6 threshold, e.g. 5 for "Recharge 5-6"'
  },
  EffectGrant: {
    "": "An effect a feature or action grants, in the SAME vocabulary the live rules engine already resolves on an actor - reused rather than re-invented, so a homebrew Rage behaves exactly like the bundled one.",
    duration: "How long the effect lasts.",
    modifiers:
      "What the effect does while it lasts, gates included, in the shared rider vocabulary. Refused here: every modifier the sheet or the actor stores (ability-score, hit-points-per-level, armor-class, initiative, unarmored-defense, darkvision, sense, spell-slot), which an effect that ends could not give back.",
    endsWithTag:
      "The granted effect ends when the actor loses every other effect with this tag (Frenzy's marker ends with the Rage)",
    target: "Who receives it: the acting creature, or the action's single chosen target (Help)",
    voidWhileIncapacitated: "Benefits lapse while the bearer is incapacitated (Dodge)"
  },
  EffectDurationRounds: {
    "": "A fixed number of rounds."
  },
  EffectDurationUntilSourceNextTurn: {
    "": "Until the granting creature's next turn begins."
  },
  EffectDurationEncounter: {
    "": "Until the encounter ends."
  },
  EffectDurationManual: {
    "": "Until the GM clears it."
  },
  EffectOnEnd: {
    "": "What happens when the effect ends - Frenzy leaves one level of Exhaustion behind."
  },
  RiderTrigger: {
    "": "WHEN a rider applies. Twenty-eight named triggers in four KINDS, and the kind decides the evaluation layer so a GM never picks one: a `static-gate` is resolvable from the sheet alone and bakes into a standing number; a `dynamic-gate` reads live actor state and becomes a labelled note re-checked per roll; a `moment` fires at the named roll or event; a `filter` narrows whatever moment it accompanies. Every trigger has a reader in the engine. This is DATA, not an expression language - every member is a closed object with bounded parameters, and there is no OR, no NOT, no nesting and no arithmetic (ADR-0008). A `when` list may carry at most one moment: a rider fires at one moment, not two."
  },
  RiderTriggerAttuned: {
    "": "STATIC GATE. The bearer is attuned. Redundant (and harmless) when the item's own `attunement.required` is already true."
  },
  RiderTriggerWhileArmored: {
    "": "STATIC GATE. The bearer is wearing armor. Omitting `weights` is exactly what `armor-class.whileArmored: true` has always meant."
  },
  RiderTriggerWhileUnarmored: {
    "": "STATIC GATE. The bearer is wearing no armor; `allowShield` decides whether a shield still counts as unarmored (Barbarian yes, Monk no)."
  },
  RiderTriggerWhileShield: {
    "": 'STATIC GATE. The bearer is wielding a shield - or, with `wielding: false`, is NOT, which is how the Dueling-style "only while not holding a shield" is said without a NOT operator.'
  },
  RiderTriggerWhileCharacterIs: {
    "": 'STATIC GATE. The bearer is one of these classes or species. TWO lists in ONE trigger so "Paladin or Cleric" is a single entry rather than an OR; at least one id must be named.'
  },
  RiderTriggerWhileProficientWith: {
    "": "STATIC GATE. The bearer is proficient with any of the named weapons, armor, tools, or skills."
  },
  RiderTriggerWhileEffectTag: {
    "": "DYNAMIC GATE. The bearer has an active effect carrying any of these tags - the single-tag `requiresEffectTag` precedent, widened to a list."
  },
  RiderTriggerWhileHpAtOrBelow: {
    "": "DYNAMIC GATE. The bearer is at or below this percentage of maximum hit points (a bloodied threshold)."
  },
  RiderTriggerWhileCondition: {
    "": "DYNAMIC GATE. The bearer has (or, with `present: false`, lacks) any of these conditions."
  },
  RiderTriggerAttackKindIs: {
    "": "FILTER. Narrows a moment to these attack kinds. melee, ranged and thrown come from the attack's reach, range and distance; `spell` is an attack that casts a spell (its action names a `spellId`); `reaction` and `opportunity` require the resolver to ANNOUNCE the trigger."
  },
  RiderTriggerWeaponPropertyIs: {
    "": "FILTER. Narrows to weapons carrying any of these property slugs (finesse, heavy, two-handed)."
  },
  RiderTriggerDamageTypeIs: {
    "": "FILTER. Narrows to these damage types, from the 13 SRD types."
  },
  RiderTriggerAbilityIs: {
    "": 'FILTER. Narrows a save or check moment to these abilities - what turns a bare `save-bonus` into "+1 to Dexterity saves".'
  },
  RiderTriggerSkillIs: {
    "": "FILTER. Narrows a check moment to these skills (Gloves of Thievery: sleight-of-hand)."
  },
  RiderTriggerSpellSchoolIs: {
    "": "FILTER. Narrows a moment to actions casting a spell of these schools (the action's `spellId`, looked up in the catalog)."
  },
  RiderTriggerSpellLevelIs: {
    "": "FILTER. Narrows a moment to actions casting a spell of these levels (the spell's own level; 0 is a cantrip)."
  },
  RiderTriggerSpellIdIs: {
    "": "FILTER. Narrows a spell moment to these SPECIFIC spells. `spell-school-is` and `spell-level-is` name categories; a printed \"when you cast Eldritch Blast\" names one record, and no combination of school and level picks out one cantrip. Matches an action's `spellId` - the spell the action IS - so it fires on the cast actions an item's `casts` entries synthesise and on any feature action naming its spell. An action with no `spellId` never matches."
  },
  RiderTriggerVersusCreatureType: {
    "": "FILTER. Narrows to targets of these creature types, read from the target's stat block. A character records no creature type, so it never matches one."
  },
  RiderTriggerVersusSize: {
    "": "FILTER. Narrows to targets of these sizes."
  },
  RiderTriggerVersusCondition: {
    "": "FILTER. Narrows to targets currently under any of these conditions."
  },
  HomebrewRecordDocument: {
    "": "One stored row: the authored body plus the three orthogonal row-state fields. `state` is set only by /publish and /unpublish, `visibleToPlayers` only by /visibility, `deletedAt` only by DELETE and /restore. A player sees a record only when it is published AND visible AND not deleted - and even then only through the merged CONTENT_PATHS catalogs, never through this component.",
    visibleToPlayers: "Publishing does not reveal: this is the separate, deliberate second step",
    deletedAt: "Soft delete; a deleted row leaves every merged catalog at once and is restorable",
    pendingChanges:
      "A published record has edits that are not live yet. `record` and `validity` describe the pending body; the catalogs still serve the live one until /publish"
  },
  HomebrewRecordSummary: {
    "": "The flat, deliberately NON-polymorphic list row: a name and a badge. Carries `valid` alone - the issue list costs a GET - so listing a 300-record library never ships a 20-row level table.",
    source: 'Always "homebrew" on this surface; the field exists so a summary and a merged-catalog row read the same',
    usageCount: "How many characters took this record; 0 is the common case"
  },
  HomebrewUsage: {
    kind: "How the record is used - open slug (character-choice, class, species, ...), never a closed enum"
  },
  HomebrewContentList: {
    nextCursor: "Opaque keyset cursor - never construct or parse one. null means this was the last page",
    total: "Rows matching the filter, ignoring limit/cursor"
  },
  HomebrewUsages: {
    safeToDelete:
      "False when removing this record would break a published one (`dependents.ifRemoved`). Characters never count: a built character carries a flattened, self-contained ActorDefinition, so the usage list is context, not a blocker",
    dependents:
      "Published records that publish now and would not: `ifRemoved` once this one is removed or unpublished, `ifUpdated` once its pending edits go live. A warning to show before the action, never a refusal"
  },
  HomebrewDependent: {
    "": "A published record another record's removal or edit would break: enough to name it and open it."
  },
  HomebrewPack: {
    "": "The GM-to-GM interchange format (ADR-0007 schemaId + integer schemaVersion). One FLAT record array rather than a by-type object: the body already carries `type`, so a by-type map would duplicate the discriminator for nothing. No checksum field by design.",
    records: "Authored bodies only - no state, visibility, deletion, or revision"
  },
  HomebrewPackImport: {
    "": "The import plan or its result - byte-for-byte the same report either way, which is what makes `dryRun` trustworthy.",
    "reminted[].reason":
      "Why the id changed. srd-collision: outside `hb-`, the bundle's namespace, ALWAYS re-minted. homebrew-collision: an existing row or an earlier record in the pack holds it; follows onIdCollision. foreign-shape: an `hb-` id this table would not mint for that type, ALWAYS re-minted"
  },
  HomebrewCreateRequest: {
    "": "The authored body only. Row state is never client-supplied: a new record is always a draft, invisible to players."
  },
  HomebrewUpdateRequest: {
    "": "Replaces the whole authored body and touches no row state.",
    expectedRev: "Optimistic concurrency: reject with 409 (and `error.currentRevision`) if the row moved on."
  },
  HomebrewDuplicateRequest: {
    name: "Name for the copy; omitted derives one server-side."
  },
  HomebrewStateChangeRequest: {
    expectedRev: "Optimistic concurrency: reject with 409 (and `error.currentRevision`) if the row moved on."
  },
  HomebrewVisibilityRequest: {
    expectedRev: "Optimistic concurrency: reject with 409 (and `error.currentRevision`) if the row moved on."
  },
  HomebrewPackImportRequest: {
    onIdCollision:
      "How to resolve a collision with an EXISTING HOMEBREW id; an SRD collision is always re-minted regardless.",
    dryRun: "Run the whole collision + rewrite + re-validate pass and return the identical report without writing."
  },
  CodexDowntimeInput: {
    "": "The downtime facts themselves. `applied` is deliberately not an input: confirming the clock move is a separate, explicit act, and accepting it here would let one POST both record the week off and move the campaign clock.",
    who: "Who spent the time. May be empty: downtime is often party-wide with nobody in particular to name.",
    activity:
      "What they did. May be empty, for the same reason as `who` - the record's prose carries it when the fields do not.",
    days: "The time cost in in-world days. Ten years is already well past the point where a GM would set a date instead of counting days.",
    characterPageId:
      "Which character PAGE this downtime belongs to, so the tracker totals a person rather than a spelling of their name. Optional; `who` remains the free-text fallback for anyone with no page, and both may coexist. An id naming no page is a **404**. The page's TYPE is deliberately NOT enforced - a GM may track downtime for an NPC or a hireling - which is the opposite of the standing rule, because standing is *about* a faction while downtime is about someone the GM happens to have a record for."
  },
  CodexMilestoneInput: {
    "": 'The milestone facts themselves. Exactly two - the spec says "milestone / level history … no XP arithmetic", so there is no XP total, no threshold and no next level.',
    level: "The level the party REACHED. 1-20, the repo's existing character-level bound.",
    reason:
      'Why, in one line. Optional and may be empty: "we hit 5" with the why in the record\'s own prose is a legitimate body, and a minimum here would reject a state the composer can reach. Defaults to an empty string.'
  },
  CodexQuestObjective: {
    "": "One tickable step of a quest. Deliberately exactly two keys - a shape richer than `{ text, done }` (assignees, due dates, sub-objectives) is unapproved scope. The text is PLAYER-FACING: it lives beside `playerBody`, never beside `gmBody`, so a GM-only detail belongs in the quest's GM body and never in an objective.",
    text: "What the party has to do, in one line. Deliberately NOT `minLength: 1`: the checklist's real flow is add-a-row-then-type-into-it and the editor autosaves the whole draft, so a minimum would reject the first save after \"Add item\" — and dropping the blank row server-side would renumber the list under the GM's cursor. A blank objective is a legitimate transient state, not a malformed one. The server accepts it; this says so rather than publishing a rule it does not enforce."
  },
  CodexPageCreateRequest: {
    inWorldDate: "The in-world date that places an `event` page on the chronicle. Omit for undated.",
    commandId: CODEX_COMMAND_ID
  },
  CodexPageUpdateRequest: {
    inWorldDate: "The in-world date. Omitted leaves the stored date alone; `null` clears it.",
    expectedRev: "Optimistic concurrency: reject with 409 if the page moved on.",
    commandId: CODEX_COMMAND_ID
  },
  CodexRevealRequest: {
    commandId: CODEX_COMMAND_ID
  },
  CodexConnectionCreateRequest: {
    label:
      'Optional. An unlabelled connection is a legitimate "these two are related" - the same thing a `[[wiki link]]` already expresses - so forcing a word would make the declared half of one concept stricter than the derived half.',
    commandId: CODEX_COMMAND_ID
  },
  CodexConnectionUpdateRequest: {
    commandId: CODEX_COMMAND_ID
  },
  CodexFolderPathRequest: {
    commandId: CODEX_COMMAND_ID
  },
  CodexFolderMoveRequest: {
    to: "Empty string moves the folder to the top level.",
    commandId: CODEX_COMMAND_ID
  },
  CodexMapCreateRequest: {
    commandId: CODEX_COMMAND_ID
  },
  CodexMapUpdateRequest: {
    commandId: CODEX_COMMAND_ID
  },
  CodexMapParentRequest: {
    commandId: CODEX_COMMAND_ID
  },
  CodexMarkerCreateRequest: {
    commandId: CODEX_COMMAND_ID
  },
  CodexMarkerUpdateRequest: {
    commandId: CODEX_COMMAND_ID
  },
  CodexMarkerMoveRequest: {
    commandId: CODEX_COMMAND_ID
  },
  CodexMarkerPartyRequest: {
    "": "One boolean and nothing else: the pin's position, label, links and reveal state are all set through the routes that already own them, because the party marker is an ordinary marker with a flag.",
    isParty:
      "`true` makes this the party's pin and clears the flag from whichever pin held it before, anywhere in the atlas. `false` clears it from THIS pin only and never disturbs a different party pin.",
    commandId: CODEX_COMMAND_ID
  },
  CodexJournalCreateRequest: {
    sessionId: JOURNAL_SESSION_ID,
    commandId: CODEX_COMMAND_ID
  },
  CodexJournalUpdateRequest: {
    "": "Edits a journal entry; an omitted field is left alone. Identical to `CodexJournalCreateRequest` plus ONE narrow payload group.",
    sessionId: JOURNAL_SESSION_ID,
    downtime:
      "Edits a DOWNTIME record's own facts. **400 when the entry is not a downtime record** - a caller sending downtime details to a milestone has misunderstood something, and hearing so beats being quietly overruled. This is the adoption path the tracker needs: it is what lets a GM link the free-text rows that already exist to real character pages, so downtime recorded before character links existed can link too. `days` is deliberately NOT a member and sending it is a 400: it is what `apply-downtime` moved the campaign clock by, so editing it afterwards would leave the clock disagreeing with the record that justified it. A typo in `days` is a delete-and-recreate. `applied` is likewise absent - confirming the clock move is its own explicit act.",
    "downtime.characterPageId":
      "An id naming no page is a 404; `null` clears the link and leaves `who` as the display fallback.",
    commandId: CODEX_COMMAND_ID
  },
  CodexDeadlineCreateRequest: {
    "": "Everything `CodexJournalCreateRequest` accepts, with ONE difference: `inWorldDate` is REQUIRED and may not be null. A deadline IS a thing that will happen at a time, and `fired` is derived from that date alone, so an undated one could never fire - it would be a note wearing a deadline's label. There is no `kind` to send (the route says it) and no reveal rule of its own: `revealedToPlayers` behaves exactly as it does on an ordinary entry.",
    playerText:
      "The deadline itself, in the party's words - a deadline IS its text, which is why it stores no separate 'what'.",
    sessionId: JOURNAL_SESSION_ID,
    inWorldDate:
      "WHEN it happens - the date the campaign clock has to reach for this to fire. Required, and never null.",
    commandId: CODEX_COMMAND_ID
  },
  CodexDowntimeCreateRequest: {
    "": "Everything `CodexJournalCreateRequest` accepts, plus the required `downtime` facts. Omitting `inWorldDate` - OR sending it as null - dates the record at the GM's current campaign date, the rule an auto-logged battle already follows, so downtime lands where it happened rather than at the bottom of the timeline. This differs deliberately from every other journal route, where a null clears the date: downtime that happened at no point in time is not downtime.",
    sessionId: JOURNAL_SESSION_ID,
    commandId: CODEX_COMMAND_ID
  },
  CodexMilestoneCreateRequest: {
    "": "Everything `CodexJournalCreateRequest` accepts, plus the required `milestone` facts - `CodexDowntimeCreateRequest`'s shape verbatim, because it is the same kind of thing: a structured payload riding beside a record that is prose. Omitting `inWorldDate` dates the record at the GM's current campaign date, so a level-up lands where it happened. Undated is legitimate here where it is not for a deadline: a deadline with no date can never fire, but \"the party reached 5\" is a thing that happened.",
    sessionId: JOURNAL_SESSION_ID,
    commandId: CODEX_COMMAND_ID
  },
  CodexSessionCreateRequest: {
    "": "Every field is optional: an empty body opens a blank `planned` session for the GM to prep into.",
    sessionNumber: "Must not already be in use by another session.",
    tags: CODEX_TAGS,
    sceneIds: "Prepared scenes staged for this session. Capped at the table's scene cap.",
    commandId: CODEX_COMMAND_ID
  },
  CodexSessionUpdateRequest: {
    "": 'An omitted field is left alone - the console PATCHes a whole draft on every autosave, so "absent means clear" would wipe the half of the record the editing surface does not carry. `revealed` is deliberately NOT here: reveal is its own route because it is not an edit (it moves neither `rev` nor `updatedAt`), exactly as on a page.',
    sessionNumber: "Must not already be in use by another session; `null` clears it.",
    tags: CODEX_TAGS,
    sceneIds: "Prepared scenes staged for this session; replaces the stored list.",
    expectedRev: "Optimistic concurrency: reject with 409 if the session moved on.",
    commandId: CODEX_COMMAND_ID
  },
  CodexQuestCreateRequest: {
    "": "Only `title` is required - a lead can be named the moment it appears at the table and filled in later.",
    status: QUEST_STATUS,
    tags: CODEX_TAGS,
    commandId: CODEX_COMMAND_ID
  },
  CodexQuestUpdateRequest: {
    "": 'An omitted field is left alone - the console PATCHes a whole draft on every autosave, so "absent means clear" would wipe the half of the record the editing surface does not carry. `objectives` and `entityIds` are REPLACED wholesale when present, and objectives are stored in exactly the order given. `revealed` is deliberately NOT here: reveal is its own route because it is not an edit (it moves neither `rev` nor `updatedAt`), exactly as on a page.',
    status: QUEST_STATUS,
    tags: CODEX_TAGS,
    expectedRev: "Optimistic concurrency: reject with 409 if the quest moved on.",
    commandId: CODEX_COMMAND_ID
  },
  CodexStandingSetRequest: {
    "": "Sets the RESULTING standing; the server works out the delta and writes it to the chronicle record in the same transaction. There is no separate create: `faction_page_id` is unique, so the first set for a faction creates its row.",
    value:
      "The new standing, SIGNED. Rejected outside -100..100 here (the client's control cannot produce a 150, so one is a malformed caller) and clamped to the same range by the store, which is the router-rejects / store-enforces arrangement every bounded field in this surface uses.",
    reason:
      "Why it moved, in one line - it lands on the `standing` chronicle record. Optional and may be empty: adjusting a standing mid-session should not be blocked on typing a sentence, and the change is recorded either way. Defaults to an empty string.",
    commandId: CODEX_COMMAND_ID
  },
  CodexCalendarRequest: {
    eras: "Optional so a caller written before eras existed is not met with a 400. It is replaced like every other field on this route: omitting it CLEARS the stored eras.",
    commandId: CODEX_COMMAND_ID
  },
  CodexSettingsRequest: {
    revisionHistory:
      'The two SETTABLE revision-history knobs, and the difference between them is load-bearing: `enabled: false` writes NO new revisions at all, while `windowMinutes: 0` writes one for EVERY save. `0` is therefore not "off" - it is the behaviour every codex had before this setting existed - and the two are separate fields so nothing has to guess which a zero meant. Neither setting ever DELETES a revision: switching history off stops new checkpoints and nothing else, and the existing history stays listable and restorable, because disabling a feature must not destroy the GM\'s only undo. Deleting is a separate, explicit act (`DELETE /codex/page-revisions`).',
    "revisionHistory.enabled":
      "Whether a page save may write a new revision at all. Default `true` - every existing codex upgrades with history on, exactly as it was.",
    "revisionHistory.windowMinutes":
      'Coalescing window. A save whose page already has a checkpoint younger than this writes no new one, so at most this much authoring can be lost. Measured against WHEN THE CHECKPOINTED CONTENT WAS AUTHORED, not when its row was written, which is what makes the guarantee hold across an idle gap as well as during continuous work. `0` keeps every save; the 10080 ceiling is one week of minutes, past which the window stops coalescing a work session and starts meaning "keep almost nothing" - which `enabled: false` already says more honestly. The owner\'s default is 90.',
    "": "Every codex-wide setting a caller may SET. Identical to `CodexSettings` except that the server-computed usage figures are absent - not ignored, absent: sending `versionCount` or `versionBytes` is a 400, because they are facts about a table the caller cannot see. Both groups are REQUIRED: this replaces the settings wholesale, so an omitted group would silently reset a setting the caller never mentioned.",
    commandId: CODEX_COMMAND_ID
  },
  CodexRevisionsDeleteRequest: {
    "": "Which revisions to delete, by age. Required rather than defaulted: the destructive route must not have a meaning when the body is silent.",
    olderThanDays:
      "Delete every revision authored more than this many days ago. **`0` deletes them all** - arithmetic, not a magic value, since nothing is younger than zero days old. A negative or fractional value is a 400 rather than a clamp, because this destroys data. The 36500 ceiling (100 years) is a guard, not a policy: a larger value pushes the cutoff date out of the representable range, which would turn a silly request into a 500."
  },
  CodexImportRequest: {
    codex: "The export's `codex` bundle, verbatim.",
    bundleVersion:
      'Optional. Absent = a pre-versioning v1 bundle. Anything but 1 is refused: "This backup was made by a newer version of the app. Update, then restore."',
    exportedAt: "Accepted and IGNORED, so a saved export file can be POSTed without editing.",
    commandId: CODEX_COMMAND_ID
  },
  CodexAutosaveSettings: {
    "": "Whether the Codex's editors save your work as you type, and how often. The server stores a PREFERENCE and nothing else - there is no server-side draft, so the behaviour (and the explicit Save plus unsaved-changes warning when it is off) is the editor's. Storing it here is what makes the setting follow the GM from a phone to a laptop.",
    enabled:
      "Default `true`. `false` does not slow autosave down, it stops it: the editors then require an explicit Save and warn about unsaved changes.",
    intervalSeconds:
      'How long the editors wait after you stop typing before saving. SECONDS, and the unit is the same everywhere - wire, column, and store - so nothing converts at a boundary. Default `1`, which is what the shipping editors already did (an 800 ms debounce) expressed on this scale, so an upgraded codex saves exactly as often as it used to. `0` is not in range: a zero-second autosave is a save per keystroke, which is not a cadence anyone means - a GM who wants none says `enabled: false`. The 600 ceiling is ten minutes, past which the setting stops meaning "save while I work".'
  },
  CodexPageSummary: {
    fields: "Player-facing typed entity fields (free-form key/value).",
    inWorldLabel: IN_WORLD_LABEL,
    calendarInstant: CALENDAR_INSTANT,
    inWorldDate: IN_WORLD_DATE
  },
  CodexPage: {
    gmFields: "GM-only fields; never present in a player projection.",
    playerBody: "Player-facing markdown body.",
    gmBody: "GM-only markdown body; stripped from a player projection.",
    inWorldLabel: IN_WORLD_LABEL,
    calendarInstant: CALENDAR_INSTANT,
    inWorldDate: IN_WORLD_DATE
  },
  CodexPageSummaryPlayer: {
    "": "A page summary as a PLAYER receives it. A strict subset of the GM summary: no `fields`, no dating trio, no `rev`, no `revealedToPlayers`, no `createdAt`."
  },
  CodexPagePlayer: {
    "": "A page as a PLAYER receives it: the player body (renamed `body` - the layer prefix only means something when there are two layers), the player-facing `fields`, and no `gmBody`, `gmFields`, `rev`, `revealedToPlayers` or `createdAt`. An unrevealed page is never projected at all - it 404s.",
    fields: "The player-facing typed entity fields. `gmFields` has no player form.",
    body: "The page's `playerBody`."
  },
  CodexConnection: {
    "": "One edge in the codex graph, GM view. ONE shape for both origins: a connection the GM declared and a connection derived from `[[wiki link]]` text differ by an `origin` attribute, not by being two systems with two panels and two edge kinds.",
    id: "Null exactly when `origin` is `mention`: a derived edge has no row of its own, so it is deleted by editing the text that produced it.",
    fromKind: "Which record the connection comes FROM. Session, quest and journal bodies join the graph.",
    toPageId:
      "Connections v1 are edges INTO pages. `[[map:...]]`/`[[marker:...]]` targets still parse and persist but get no graph exposure.",
    label: 'The out-label ("ally of", "located in"). Null for an unlabelled connection.',
    layer:
      "Which layer the connection lives on. A `mention` inherits the body it was written in; a `declared` one is chosen at create (default `player`).",
    createdAt: "Null for a mention row."
  },
  CodexConnectionPlayer: {
    "": "A connection as a PLAYER receives it. No `id` (a player never addresses one), no `layer` (every connection they receive is on the player layer, so the key could only be a constant), no `createdAt`."
  },
  CodexPageConnection: {
    "": "One row of a page's Connections panel: the OTHER endpoint resolved, plus which way the edge points. Folds in what used to be two separate views (backlinks and typed relationships).",
    otherTitle:
      'A page title, "Session 4", a quest title, or a bounded excerpt of a journal entry\'s player text - the reveal-audit naming rule.',
    otherEntityType: "Pages only; null for every other kind.",
    otherRevealed:
      "GM-only; not declared on `CodexPageConnectionPlayer` (a player only ever receives connections to records they can see).",
    section: "The heading the mention sits under; null for a declared connection."
  },
  CodexPageConnectionPlayer: {
    "": "A page's Connections panel as a PLAYER receives it: revealed others only, so `otherRevealed` would be a constant, and no `id` or `layer`."
  },
  CodexMap: {
    parentMapId: "Parent map in the atlas tree; for a player, nulled when the parent is not itself revealed."
  },
  CodexMapPlayer: {
    "": "An atlas map as a PLAYER receives it. `parentMapId` survives only when the parent is itself revealed - otherwise a revealed child would leak the id of a still-secret ancestor.",
    parentMapId: "Nulled when the parent map is not itself revealed."
  },
  CodexMarker: {
    pageIds: "Linked pages; for a player, filtered to the revealed subset.",
    subMapId: "Drill-down sub-map; nulled for a player when that map is not revealed.",
    sceneIds: "Linked prepared scenes; GM-only, stripped from a player projection.",
    isParty:
      "Is this the party's pin? At most one marker in the whole atlas carries it. PLAYER-FACING - the party pin is for the players, and it is the ONE such key on the player marker projection - but it grants no visibility of its own: a hidden party pin, or one on a hidden map, is exactly as hidden as any other pin, because `isParty` is not part of any reveal predicate anywhere."
  },
  CodexMarkerPlayer: {
    "": "A pin as a PLAYER receives it: no `sceneIds`, no `actorId`, no `revealedToPlayers`, no timestamps, and page/sub-map links only when those targets are themselves revealed. `isParty` IS here - the party pin is for the players - but it grants no visibility: a hidden party pin, or one on a hidden map, is exactly as hidden as any other.",
    pageIds: REVEALED_SUBSET,
    subMapId: "Nulled when that map is not revealed."
  },
  CodexDowntimePayload: {
    "": "What a downtime record stores beyond its prose - who spent how many days doing what, and whether the GM has confirmed the clock move it proposes. The GM's shape. Deliberately NOT here: an `outcome`, which is prose, and this record already has two prose layers with the reveal split between them (`playerText`/`gmText`) - a third prose channel inside a JSON blob would sit outside that split.",
    who: "Who spent the time. Free text - a character, the whole party, an NPC.",
    activity: "What they did with it.",
    days: "The time cost in in-world days - what the clock moves by when the GM confirms.",
    applied:
      "GM workflow state: has the clock move been confirmed? NEVER present in a player projection - it is a fact about the GM's prep, not about the party's week off.",
    characterPageId:
      "the character page this downtime belongs to, or null. Always present, including on records written before the field existed - the stored-payload reader supplies the null, so no consumer branches on key presence. A plain id with no foreign key: the record outlives the page, and deleting the page nulls this while `who` survives as the display fallback."
  },
  CodexMilestonePayload: {
    "": "What a MILESTONE record carries beyond its prose - the level the party reached, and why. Identical for both audiences: a party knows its own level, and a revealed milestone with its two facts removed would be a dated row that says nothing. There is no GM-only half here at all; a milestone needing one writes it in the record's `gmText`, like every other journal row. No XP: progression is milestone-based by design and this record carries no arithmetic.",
    level:
      "The level REACHED, not a step. A delta would make the party's current level a sum over the whole timeline that a single deleted record silently changes.",
    reason:
      'Why, in one line ("cleared the crypt"). May be empty - the record\'s own prose carries it when this does not.'
  },
  CodexStandingPayload: {
    "": "What a STANDING record carries - which faction, how much it MOVED, and why. The GM's shape. `delta` and not the resulting value, deliberately: the `codex_standing` table says where things stand and this says what happened, so a deleted record cannot leave a history that no longer adds up to the table.",
    factionPageId:
      "The faction page this record is about. A plain id with no foreign key behind it: deleting a faction page removes its standing ROW but must leave its history standing, so a reader resolves this defensively - a missing page is a name it cannot show, not an error.",
    delta: 'How far the standing moved, signed. `-15` reads "fell fifteen".',
    reason: "Why, in one line. May be empty."
  },
  CodexQuestHistoryPayload: {
    "": "a quest CHANGED STATE. The quest record says where a quest stands; this says what happened - exactly as a `standing` record does beside the standing table. Written automatically, in the same transaction as the quest write, when a quest is CREATED (its initial status - a quest entering the log is an event, whether or not the party has begun it) and whenever a PATCH changes its status. Editing a quest's prose writes nothing. There is no cached title: readers resolve `questId` against the live quest, so a renamed quest reads correctly and a deleted one is a name they cannot show rather than an error - the history outlives the quest.",
    status:
      'The status REACHED, not a delta - the fact a GM states and the one a reader wants. A `failed` -> `active` transition records `active`; a reader words it as "reopened".'
  },
  CodexDowntimePlayerPayload: {
    "": "A revealed downtime record as a PLAYER sees it: the campaign facts, and `applied` allow-listed away.",
    characterPageId:
      "carried ONLY when that character page is itself revealed, else null - the `factionPageId` rule on a standing payload verbatim. Unlike a standing record the ROW is not hidden when the link is nulled: a downtime row stands on its own player-visible content (`who`, `activity`, `days`, and usually prose), so a nulled link leaves a row that still means something."
  },
  CodexStandingPlayerPayload: {
    "": "A revealed standing record as a PLAYER sees it. `delta` and `reason` travel WHOLE: the delta is the entire point of a record the GM chose to publish (\"the Harpers fell fifteen\"), and a published record with its number stripped would say that something changed with someone. `factionPageId` is the one field that is conditional - it is nulled unless that page is itself revealed, the same filter a quest's `entityIds` and a map's `parentMapId` pass, so a published record can never advertise a faction the party has never met. A record whose faction page is NOT revealed is not projected to a player at all - it is hidden whole, exactly as the standing TABLE row is: a standing record carries no prose of its own (the store writes an empty player text), so a row with the id stripped would still tell the party that an unnamed faction moved and why.",
    factionPageId: "The faction page, or NULL when that page is not revealed to players."
  },
  CodexQuestHistoryPlayerPayload: {
    "": 'A quest-history record as a PLAYER sees it. The whole ROW is hidden unless the quest itself is revealed - a quest record carries empty player text, so it cannot stand on its own prose, and a row reading "Quest - completed" for a quest the party has never heard of would announce both its existence and its ending. When it does travel, `status` is the record\'s only content and the reader can already read it on the quest itself.',
    questId:
      "Nulled unless that quest is revealed - a second line of defence behind the whole-row gate, the same arrangement a standing payload's `factionPageId` uses.",
    status: QUEST_STATUS
  },
  CodexJournalEntry: {
    gmText: "GM-only note; stripped from a player projection.",
    kind: "What the row IS. `deadline`, `downtime`, `milestone` and `standing` are the structured kinds. Visibility NEVER depends on this: every kind is gated by `revealedToPlayers` alone.",
    sessionId:
      "the session this entry belongs to, BY IDENTITY. Null when it is filed under no session. This is what a WRITE sets; `sessionNumber` beside it is what a reader displays.",
    sessionNumber:
      "The linked session's number, resolved LIVE from that record - so renumbering a session updates every one of its entries with no journal write. Server-owned display data: a write body that carries it is a 400. It survives its session in exactly one case: deleting a REVEALED numbered session stamps its number back onto its entries as a bare label, because the players were already reading it.",
    calendarInstant: CALENDAR_INSTANT,
    payload:
      'Kind-specific structured data, discriminated by `kind`: the downtime payload, the milestone payload, the standing payload, and null for the other three kinds. GM-only - the player journal projection carries no payload at all (a revealed record\'s facts are read on the chronicle). A DEADLINE deliberately has none: its text is the "what" and its `inWorldDate` is the "when".'
  },
  CodexJournalEntryPlayer: {
    "": "A journal entry as a PLAYER receives it - the mini-timeline row on a page or a pin. The player text (renamed `text`), and no `gmText`, `revealedToPlayers`, attachments, `sourceEncounterId`, `payload`, `sortKey`, dating internals or `updatedAt`. A downtime's facts and a deadline's fired state are read on the CHRONICLE, which carries them; a player-facing field the player Codex does not read is a field with no reason to travel.",
    text: "The entry's `playerText`.",
    kind: "Visibility NEVER depends on this: every kind is gated by `revealedToPlayers` alone.",
    sessionId:
      "The session this entry belongs to, so a player can navigate from an entry to its recap. Present ONLY when that session is revealed - in which case the player can already list and open it, so this adds no information. Nulled TOGETHER with `sessionNumber` when the session is hidden: either half of the link would announce that a session they have not been shown exists.",
    sessionNumber:
      "Nulled together with `sessionId` when the linked session has not been revealed - a session's very existence is GM information. A bare label with no link survives only where the number was already player-visible."
  },
  CodexChronicleRecord: {
    "": "One row on the ONE chronicle as the **GM** receives it, in the single row shape every timeline record uses. `kind` says what it is and therefore what opening it means: `entry`/`combat`/`deadline`/`downtime` carry a journal-entry id, `event` carries a PAGE id. Every key is present on every kind (null where it does not apply), so no reader branches on key presence. The player's row is the separate `CodexChronicleRecordPlayer`; the two are joined by `CodexChronicleRecordProjected`.",
    kind: "What the row IS, read by icon AND word - never by colour alone. A discriminator for DISPLAY only: it never decides visibility, which is `revealedToPlayers` and nothing else.",
    id: "The record's own id - a journal entry's for `entry`/`combat`, a page's for `event`.",
    title: "An event page's title; null for a journal entry, which has no name.",
    text: "The player-facing layer: a journal entry's full text, or a bounded excerpt of an event page's player body.",
    gmText:
      "GM-only: an entry's GM note, or an excerpt of an event page's GM body. Not declared at all on `CodexChronicleRecordPlayer`.",
    revealedToPlayers:
      "GM-only field; not declared on `CodexChronicleRecordPlayer` (a player only ever receives revealed records).",
    sessionId: "the session this row belongs to, by identity. Null for an `event` page and for an unfiled entry.",
    sessionNumber: "The linked session's number, resolved live from that record.",
    inWorldLabel: "The in-world date as text - what the row is grouped under in the by-date lens.",
    calendarInstant: CALENDAR_INSTANT,
    inWorldDate: "The raw in-world date the GM typed; the instant and the label are derived from it.",
    attachPageId: GM_ONLY_CHRONICLE,
    attachMarkerId: GM_ONLY_CHRONICLE,
    sourceEncounterId: "GM-only replay linkage (K2); not declared on `CodexChronicleRecordPlayer`.",
    fired:
      "Has the campaign clock reached this deadline's own date? DERIVED on every read from `inWorldDate` against the clock, never stored - so rewinding the clock correctly un-fires a deadline. `false` for every kind that is not a dated deadline. Measured against WHOSE clock is a viewer-safety decision: the GM's row uses the GM's clock, a player's row uses the PUBLISHED date, so this boolean can never tell the party that a date they have not been shown has already gone by.",
    payload:
      "The kind's structured facts, discriminated by `kind`; null for the kinds that carry none. Allow-listed per kind, never a spread of the stored blob: the GM receives the full downtime payload including `applied`, a milestone's `{ level, reason }`, and a standing change's `delta`/`reason`.",
    proposedDate:
      "GM-only (not declared on `CodexChronicleRecordPlayer`): for an unapplied downtime, the date `apply-downtime` would move the clock to. Null once applied, and for every other kind. A clock move the GM has not confirmed - and may never confirm - is prep.",
    updatedAt: GM_ONLY_CHRONICLE
  },
  CodexChronicleRecordPlayer: {
    "": "One chronicle row as a PLAYER receives it. Absent by construction: `gmText`, `revealedToPlayers`, `attachPageId`, `attachMarkerId`, `sourceEncounterId`, `proposedDate` and `updatedAt`. `fired` is measured against the PUBLISHED date, never the GM's clock, so it can never tell the party that a date they have not been shown has gone by.",
    sessionId: "Present only when the linked session is revealed; nulled together with `sessionNumber` otherwise.",
    inWorldDate:
      "the row's raw in-world date, so a calendar view can place it on a day without re-parsing prose. Information-equivalent to `inWorldLabel` beside it, which already spells out weekday, day, month and year - the structured parts add no bits and remove a client parse. Not the campaign's \"now\": the GM's clock is `CodexCalendarPlayer.currentDate`, which is the PUBLISHED date.",
    calendarInstant:
      "the sortable day index for `inWorldDate` against the calendar the player already holds - a pure function of two things they have, computed once on the server. It is here so the client never re-derives it: the two derivations disagreed on a day that overflows its month, and one authority for one number is the fix. Null exactly when `inWorldDate` is.",
    fired: "Derived against the PUBLISHED date.",
    payload:
      "The player half of the kind's structured facts: downtime without `applied`, a milestone's `{ level, reason }` unchanged, a standing change with `factionPageId` nulled unless that faction page is revealed."
  },
  CodexSession: {
    "": "One play session: the GM's prep for an evening at the table, and the recap of it afterwards. Two layers in one record, like a page's `playerBody`/`gmBody` - `recapBody` is the player-facing half and `prepBody` is the GM's. A player projection is deliberately narrow: a revealed session reduces to EXACTLY `id`, `sessionNumber`, `realDate`, and `recap` (the recap body, renamed the way a page's `playerBody` becomes `body` and a journal entry's `playerText` becomes `text`). Everything else here is GM-only. `sessionNumber` is the join to the journal: entries carry the same number, which is what the journal's by-session lens groups on - so it is unique across sessions, and a number already in use is refused rather than silently making a group ambiguous.",
    sessionNumber:
      '"Session 12" - the session\'s DISPLAY number. Unique across sessions; null until the GM assigns one. Journal entries link to the session by ID and resolve this live, so renumbering a session relabels every one of its entries with no journal write.',
    realDate:
      "The real-world date the group played, as the GM typed it. Free text, not a calendar instant - a session sits on the real calendar, never the world's, which is why sessions are their own route and not rows on `/codex/timeline`.",
    attendees: "Who was at the table. GM-only; absent from a player projection.",
    sceneIds:
      "the prepared scenes staged for this session, so the GM can put any of them live in one tap at the table. GM-ONLY, ALWAYS - stricter than the session's own reveal, because a revealed session publishes its RECAP and tonight's planned fights are spoilers even then.",
    prepBody:
      "GM-only prep notes for the session (markdown). NEVER present in a player projection, revealed or not - revealing a session publishes its recap, never its prep.",
    recapBody: "The player-facing recap (markdown). Reaches a revealed session's player projection as `recap`.",
    revealedToPlayers:
      "GM-only field; absent from a player projection (a player only ever receives revealed sessions).",
    status: GM_ONLY,
    tags: "the codex-wide tag vocabulary, so sessions filter and cross-link like every other record. Single-layer - there is no GM-only tag - and player-facing on a revealed session.",
    rev: GM_REV,
    createdAt: GM_ONLY,
    updatedAt:
      "GM-only; absent from a player projection. Moves on an edit, but NOT on a reveal or an activate - neither is an edit."
  },
  CodexSessionPlayer: {
    "": "A session as a PLAYER receives it - the tightest projection in the Codex, and every omission is a decision. `prepBody` is the GM's plan for the evening and has no player form; `attendees` is real-world personal data; `status` is the GM's own scheduling state; `rev` is the editor's conflict token. `recapBody` arrives renamed `recap`, because with only one layer left the prefix means nothing.",
    recap: "The session's `recapBody`.",
    tags: "tags are SINGLE-LAYER in this codex - there is no GM-only tag - and every other record kind already ships its tags to players. A revealed session's tags are its player-facing categorization, and they are already in the player search index by the same rule."
  },
  CodexQuest: {
    "": "One quest: a thread the party is pulling on, and whether it is still open. Two layers in one record, like a page's `playerBody`/`gmBody` - `playerBody` is what the table may read and `gmBody` is the GM's own half (who is really behind it, what happens if they fail). A player projection of a REVEALED quest is exactly `id`, `title`, `status`, `body` (the player body, renamed the way a page's `playerBody` becomes `body`), `objectives`, and `entityIds`; everything else here is GM-only. `status` is the one field that is player-facing here but GM-only on a session: \"what is still open\" is the whole point of the feature, and a revealed quest whose state the player cannot see is useless. Objectives are the Codex's first ORDERED mutable list - the array is stored and returned exactly as given, never sorted, deduped, or keyed by position across a write.",
    title: "The quest's name - the line that appears on the dashboard's open-quests card.",
    status:
      "Player-facing (unlike a session's `status`). Queryable server-side: the dashboard counts the OPEN ones - `not-started` and `active`.",
    playerBody: "The player-facing description (markdown). Reaches a revealed quest's player projection as `body`.",
    gmBody:
      "GM-only notes (markdown). NEVER present in a player projection, revealed or not - revealing a quest publishes its player body, never its GM body. It is also kept out of the player search index, because a HIT on a GM-only phrase leaks the phrase even when the body itself is never returned.",
    objectives: "The ordered checklist. Player-facing in full - order is content, not incidental.",
    entityIds:
      "Codex pages this quest involves (the NPC who gave it, the location it points at). Player-facing, but filtered to the revealed subset - the same rule a marker's `pageIds` follows, so a quest can never name a page the player cannot open.",
    revealedToPlayers: "GM-only field; absent from a player projection (a player only ever receives revealed quests).",
    tags: "the codex-wide tag vocabulary, so quests filter and cross-link like every other record. Single-layer, and player-facing on a revealed quest.",
    rev: GM_REV,
    createdAt: GM_ONLY,
    updatedAt:
      "GM-only; absent from a player projection. Moves on an edit, but NOT on a reveal - a reveal is not an edit."
  },
  CodexQuestPlayer: {
    "": 'A quest as a PLAYER receives it. `status` is KEPT - this is the one place a quest differs from a session, because "what is still open" is the entire point of the feature. `gmBody` and `rev` never travel, and `entityIds` is filtered to the revealed subset so a quest can never name a page the player cannot open.',
    status: QUEST_STATUS,
    body: "The quest's `playerBody`.",
    entityIds: REVEALED_SUBSET,
    tags: "the `CodexSessionPlayer.tags` rule verbatim - tags are single-layer, and the quest's own reveal flag remains the whole predicate."
  },
  CodexStanding: {
    "": "Where the party stands with ONE faction, GM view. Four facts, and what is absent is the point: no HISTORY (every change writes a `kind='standing'` chronicle record instead, so the timeline is the one history in this codex rather than a second one), no `rev` (a standing is a number set in one action - there is no draft to go stale), and no cached faction TITLE (the live page is the one name, so a rename cannot leave a stale copy behind). A player projection of a revealed standing is exactly `factionPageId` and `value`, and only when the faction page is revealed too.",
    factionPageId:
      "The faction page. UNIQUE across standings - one row per faction - which is why every standing route is addressed by this id rather than by `id`.",
    value:
      "SIGNED: -100 hostile, 0 neutral, +100 allied. Signed because a faction can be actively against the party, which an unsigned favour scale cannot say. The WORD a reader shows beside the bar is a presentation of this number and is deliberately not stored.",
    revealedToPlayers:
      "GM-only field; absent from a player projection (a player only ever receives revealed standings).",
    createdAt: GM_ONLY,
    updatedAt:
      'GM-only; absent from a player projection. "When did this move" is a question the chronicle answers, with the reason attached.'
  },
  CodexStandingPlayer: {
    "": 'A standing as a PLAYER receives it: two keys. The row\'s own `id` is noise (a player never addresses a standing, and `factionPageId` is unique), and "when did this last move" is a question the chronicle answers with the reason attached. A standing reaches a player only when the standing AND its faction page are both revealed.',
    value:
      "Signed -100..100. It travels unchanged: a revealed standing whose number the player cannot see would say nothing."
  },
  CodexCalendarEra: {
    "": "A named era, running from `startYear` until the next era begins (`5f`). A date's era is DERIVED - the last era whose `startYear` the date's year has reached - and is never stored on the date, so adding one re-labels existing records without rewriting any of them. Sorted ascending by `startYear` on the way in."
  },
  CodexCalendar: {
    "": "The world's calendar as the **GM** receives it. The campaign has two clocks: the GM's, which they run ahead while prepping, and the PUBLISHED one the party sees. The player's calendar is the separate `CodexCalendarPlayer`, where `currentDate` is sourced from the published date and `publishedDate` is not declared at all; the two are joined by `CodexCalendarProjected`.",
    eras: "The world's named eras, ascending by `startYear`. Empty on every calendar written before eras existed, which is exactly today's rendering: `yearName` stays the trailing suffix. Where an era applies it LEADS the year instead (\"Third Age 1492\").",
    currentDate:
      "The GM's own clock - where the campaign is now. Null until a date is set. Never reaches a player by any path.",
    publishedDate:
      "What the party currently sees as 'now'. Equal to `currentDate` until the GM runs ahead while prepping, and moved only by `POST /codex/calendar/publish`. Not declared on `CodexCalendarPlayer`, where `currentDate` already IS this value."
  },
  CodexCalendarPlayer: {
    "": 'The world calendar as a PLAYER receives it. `currentDate` keeps its name and its meaning ("where the campaign is now, as far as this reader is concerned") and only its SOURCE changes: it is read from the published date, and the GM\'s clock is not reachable from this payload at all. `publishedDate` is deliberately not echoed - for a player `currentDate` already IS it, so a second key could only duplicate it or lie.',
    eras: "Projected, never filtered: an era is STRUCTURE on the same footing as `months` and `weekdays`, which a player has always received. It carries no clock - `currentDate` is still the published date and the only one on this object.",
    currentDate: "The PUBLISHED date. Null until the GM publishes one."
  },
  CodexSearchHit: {
    "": "One row of the single suite-wide result list. Uniform across record types - every key is present on every kind, null where it does not apply, so a consumer never branches on key presence. Deliberately narrow: enough to render a row and open the record, and nothing more. A player's hit list is gated by exactly the reveal predicate that kind's LIST endpoint applies (a marker additionally requires ITS MAP to be revealed), and a journal `title` is excerpted from the player text alone.",
    kind: "Which record matched; decides where the client navigates.",
    title:
      "Page title, map name, marker label, or quest title; for a journal entry, a bounded one-line excerpt of its text; for a SESSION, `Session {n}`, else a recap excerpt, else `Untitled session` - never an empty string.",
    tags: "Always present, so no consumer branches on key presence.",
    entityType: "The page's entity type; null for every other kind.",
    mapId:
      "The map a marker sits on; null for every other kind. Never names an unrevealed map, because a player only ever receives a marker hit when that map is revealed."
  },
  CodexSearchData: {
    hits: "The one ranked result list, all record kinds.",
    truncated:
      'The result list was CUT at the cap - narrow the query. The Codex is unpaginated by design at LAN scale, which is honest only while a caller can tell a complete list from a clipped one; this is that difference. Measured by asking the index for one row past the cap, so it can distinguish "exactly 50 matches" from "50 and more". For a player it reports whether the SEARCH was cut, before their own reveal gates removed anything - so it stays true rather than becoming a count of what they may see.'
  },
  CodexRevisionHistorySettings: {
    "": "How much page version history the codex keeps, and what keeping it costs. The two knobs are exactly `CodexRevisionHistoryInput`'s; the two usage figures are server-computed and READ-ONLY, and they are a superset here rather than a second object because a settings screen wants the cost beside the control that changes it.",
    enabled: "Whether a page save may write a new revision at all.",
    windowMinutes: "Coalescing window in minutes; `0` keeps every save. See `CodexRevisionHistoryInput.windowMinutes`.",
    versionCount:
      "How many revision rows exist, across the WHOLE codex rather than one page - the same set `DELETE /codex/page-revisions` operates on. Read-only: it is a fact about the table, so it is never accepted on a write.",
    versionBytes:
      "Roughly how much TEXT that history holds: the summed length of the content columns a revision duplicates from its page (both bodies, both field maps, the title and the tags). Deliberately APPROXIMATE and deliberately not disk usage or the export's serialized size - it exists to be compared against itself before and after a trim, and a figure precise enough to invite comparison against the sqlite file's size would be a figure that disagrees with it. Render it as \"about 8.0 MB of text\". Read-only, like `versionCount`."
  },
  CodexSettings: {
    "": "Every codex-WIDE setting as a READER sees it, nested by area, including the read-only usage figures. The nesting by area is what gives a later codex-wide setting a home without inventing fields for it today: `codex_meta` is the codex's singleton settings row, and this is that row as a caller sees it."
  },
  CodexCalendarMove: {
    "": "A record the party can see that the proposed calendar would move.",
    kind: "A dated page, or a journal entry.",
    id: "The record's id.",
    title: "The page's title, or the start of the journal entry's player text, else its kind.",
    before: "The date as players read it under the current calendar.",
    after: "The date as they would read it under the proposed one.",
    unpasses: "A deadline players have seen pass that would read as approaching again."
  },
  CodexRevealAuditRow: {
    "": "One record the party can currently see.",
    kind: "Which reveal surface this row belongs to - and therefore which existing reveal route un-reveals it. The `date` row is the published campaign date, hidden by `POST /codex/calendar/unpublish` and shown by `POST /codex/calendar/publish`.",
    id: "The record's OWN id, which is exactly the id that kind's existing reveal route takes. For a `standing` row this is the FACTION PAGE id, because `POST /codex/standing/{factionPageId}/reveal` is addressed that way. The `date` row's is the fixed `published-date`, since the calendar routes take none.",
    title:
      "One line naming the record, taken from the record's own PLAYER projection - the published date as the calendar writes it, a page title, a map name, a marker label, a bounded excerpt of a journal entry's player text, \"Session 4\", a quest title, a faction name. Empty string when the record has no name (an unlabelled pin).",
    journalKind:
      'WHICH kind of journal record this is - the same seven-value vocabulary `CodexJournalEntry.kind` uses. Set on every `kind: "journal"` row and `null` on all seven other kinds, present either way so no consumer branches on key presence. Render it as a badge beside `title`, never by parsing `title`: the title is the record\'s own prose whenever it has any, and only names the kind when the record is silent.'
  },
  CodexRevealAuditSection: {
    "": 'One reveal surface\'s report. ALWAYS present, empty ones included with `revealed: 0` and `rows: []` - "nothing is revealed here" and "this did not load" must not look the same.',
    revealed:
      "How many records of this kind the party can CURRENTLY SEE - which is not always the same as how many carry a reveal flag. A marker flagged revealed on a hidden map is not counted, because the player-facing marker read does not return it either.",
    total: 'How many exist at all, so "3 of 40" reads as deliberate rather than as an empty screen.'
  },
  CodexRevealAudit: {
    "": "Everything the party can currently see across every reveal surface in the Codex. A READ-ONLY AGGREGATION of the existing player projections - it restates no visibility rule and writes nothing, which is why it agrees with the player-facing endpoints exactly rather than approximately.",
    sections: "All eight surfaces, in a fixed order, always all present.",
    revealed: "Total records the party can see, across every surface.",
    total: "Total records that exist, across every surface."
  },
  CodexImportCounts: {
    "": "What the database actually holds after the restore - its own row counts, not what the bundle claimed.",
    connections:
      "DECLARED connections. Mention edges are derived from body text and are rebuilt by the restore, so counting them would double-count the rebuild's own output."
  },
  ContentConditionsData: {
    attribution: ATTRIBUTION
  },
  ContentGlossaryData: {
    "glossary[].tag":
      'The family the SRD names in brackets after the term ("Condition", "Action", "Hazard"); null when none',
    attribution: ATTRIBUTION
  },
  ContentSkillsData: {
    "skills[].ability": "The ability this skill's check uses; null only for a record that has not declared one yet",
    attribution: ATTRIBUTION
  },
  ContentLanguagesData: {
    "languages[].table":
      'Which SRD table the language is printed in - "standard" (widespread) or "rare" (secret or planar). An open slug: a homebrew table needs no schema change. The base "Common plus two languages" budget draws from `standard`; Druidic and Thieves\' Cant are `rare` and arrive from a class feature',
    attribution: ATTRIBUTION
  },
  ContentSpellsData: {
    "spells[].level": "0 is a cantrip",
    "spells[].attackRoll":
      'Whether casting it rolls an attack. One of the three closed `fromPicks` predicates - "a cantrip that requires an attack roll" (Repelling Blast)',
    "spells[].rangeFeet":
      'Range in FEET when the printed range IS a distance, else null (Self and Touch are not ranges of zero). Read by the `ranged` predicate - "a cantrip with a range of 10+ feet" (Eldritch Spear)',
    "spells[].componentsText": '"V, S, M (a pinch of soot)", or "None"',
    "spells[].classes":
      "Spell-list ids this spell belongs to (\"wizard\", a homebrew list slug) - the builder filters a class's spell step on these, paired with the class record's spellcasting.spellListId",
    "spells[].damageRoll": 'Base damage/healing roll ("8d6"), or null when the spell rolls nothing',
    "spells[].castingOptions":
      "Per-slot-level upcast scaling; the sheet applies the row matching the chosen cast level",
    "spells[].cantripScaling":
      "A cantrip's character-level scaling (Fire Bolt's 2d10 at 5, Eldritch Blast's 2 beams), lowest level first; the row in force is the highest at or below the caster's level. Empty for a leveled spell",
    attribution: ATTRIBUTION
  },
  ContentEquipmentData: {
    "equipment[].category":
      "Open slug: weapon, armor, shield, ammunition, adventuring-gear, tool, equipment-pack, consumable, focus, wondrous, or any homebrew kind. Not a closed set - derive groupings from the data.",
    "equipment[].weapon": "Populated for weapons only",
    "equipment[].weapon.mastery":
      "The SRD weapon-mastery property this weapon has. Browse-only: it is NOT copied onto an inventory row, and it does nothing until a character unlocks THIS weapon through Weapon Mastery. Absent on gear and on homebrew weapons that declare none.",
    "equipment[].weapon.properties":
      "The SRD weapon table's Properties column (finesse, light, thrown, versatile, reach, heavy, two-handed, loading, ammunition). Unlike `mastery` these ARE copied onto an inventory row and the engine reads them there - finesse decides whether the swing uses Dexterity, reach decides 10 feet versus 5. An empty array means the weapon genuinely has none.",
    "equipment[].armor": "Populated for armor and shields only",
    "equipment[].appliesTo":
      'The eligibility column for a TEMPLATE magic item - the printed type-line qualifier ("Any Simple or Martial") plus the base ids it RESOLVED to at build/authoring time. Null everywhere except weapon/armor templates. A template row derives nothing until the player\'s pick binds it to one of `baseIds`, validated and copied server-side at set-inventory.'
  },
  ContentFeature: {
    "": "The browse-and-pick projection of a bundle FeatureRecord. Prose is the display source of truth; a feature's structured riders (granted actions, effects, modifiers, limited uses) stay server-side - the server applies them when it builds the character, so the wizard never becomes a second rules engine.",
    level: "The class/subclass level the feature lands at; null when it is not level-gated (species traits, feats)",
    tags: "Open grouping slugs for the sheet (spellcasting, fighting-style, channel-divinity)",
    choices:
      "Every pick this feature asks for, in authored order; each writes a row in the character's choice-provenance ledger. One record may owe more than one, with different kinds and ceilings: Magic Initiate owes two cantrips and one level-1 spell. Empty when the feature grants without asking.",
    grantedAtLevels:
      "Every level at which the owning class's table grants this feature - the authoritative repeat count. A feature granted at 4, 8, 12 and 16 asks its choice FOUR times and the server's capacity is choose x grants, so a client that ignores this offers too few picks and the build is rejected at creation. Empty when no class level table grants the feature (species traits, feats, subclass features).",
    extraPicks:
      "Budgets this feature RAISES rather than picks it asks for. Travels although riders do not, because it is an input to picking: a wizard that ignores it caps the player at the printed level row and the extra pick the text promised is unselectable."
  },
  ContentFeatureChoice: {
    "": "One pick a feature asks for. Options arrive either as plain ids in `from`, as an open catalog slug in `fromCatalog`, or as inline `options` carrying their own name and any second-order pick.",
    from: "Explicit option ids; empty when fromCatalog names an open list instead",
    fromCatalog: "An open catalog slug resolved at pick time (skills, feats, wizard-spells)",
    maxSpellLevel:
      "Ceiling on a spell pick's level (Evocation Savant: 2; Magic Initiate: 0, i.e. cantrips only). null when the pick has no ceiling \u2014 a picker that ignores it offers spells the server then rejects",
    minSpellLevel:
      'Floor on a spell pick\'s level (Mystic Arcanum: 6, so the level-6 arcanum is EXACTLY a level-6 spell rather than "6 or lower"). null when the pick has no floor',
    fromPicks:
      'The options are the character\'s OWN earlier answers rather than a catalog - "choose one of your known Warlock cantrips that deals damage". null for every ordinary pick.',
    "fromPicks.offer": 'The budget whose answers are the option list ("class-cantrips", "feature:<id>")',
    "fromPicks.where": "Closed predicate narrowing those answers; null means all of them",
    options:
      "Inline options with their authored names and any nested pick; empty when the options are plain ids or come from a catalog"
  },
  ContentFeatureOption: {
    "": "One inline option of a feature's pick. Carries its authored name (an id alone would force the client to titleize) and any SECOND-ORDER pick it owes - Cleric Divine Order's Thaumaturge grants an extra cantrip, so choosing it opens another choice. Riders stay server-side.",
    requires:
      'The earlier answer that makes this option legal, or null when it is always offerable. "The option you chose for Blessed Strikes grows more powerful": the later feature\'s options are gated on a pick already in the ledger. When gating leaves exactly as many legal options as the capacity, the answer is a CONSEQUENCE rather than a choice and neither side renders a pick for it.',
    "requires.offer": 'The offer key holding the earlier answer ("feature:blessed-strikes", or a named budget)',
    choices:
      "Every nested pick this option owes, in authored order. Bounded at one level: a nested pick never carries its own options.",
    extraPicks:
      "Budgets this option RAISES once chosen - Divine Order's Thaumaturge adds one to the Cleric cantrip budget."
  },
  ContentExtraPick: {
    "": "ONE pick budget a feature or a chosen option raises. `offer` is the offer key the wizard and the server share verbatim (class-cantrips, class-spells, class-skills, class-tools, background-skills, background-tools, background-languages, species-languages, or feature:<featureId>); the printed level row and every grant naming it are SUMMED, so two features each granting +1 yield +2.",
    offer: "The offer key whose capacity this raises",
    amount: "How many extra picks, as a flat number; null when `scaling` states it instead",
    scaling:
      "The budget follows a printed class-table column instead of a constant - Eldritch Invocations 1 -> 10, Weapon Mastery 3 -> 6. Resolved against the same level table on both sides. Null for a flat grant."
  },
  ContentClassesData: {
    "classes[].hitDie": "The multiclass hit-dice pool keys on this",
    "classes[].statPriority":
      "All six abilities, best first - the random generator's core input, as data rather than a hardcoded table",
    "classes[].skillChoiceCount": "How many entries of skillChoices the character picks at level 1",
    "classes[].armorProficiencies": "Granted armor training, as open slugs (light, medium, heavy, shields)",
    "classes[].weaponProficiencies": "Granted weapon training - a group (simple, martial) or a single weapon id",
    "classes[].toolChoices": '"Choose N tools" where the class offers one; null otherwise',
    "classes[].toolChoices.fromCatalog": CHOICE_CATALOG,
    "classes[].multiclassProficiencies":
      "Proficiencies gained when this class is taken as a MULTICLASS (narrower than the level-1 set); null when the record declares none",
    "classes[].multiclassProficiencies.skillChoices.fromCatalog": CHOICE_CATALOG,
    "classes[].multiclassPrerequisites":
      'Ability minimums for multiclassing INTO this class; mode "any" covers "STR 13 or DEX 13". null = always allowed. Display data - the server re-validates',
    "classes[].subclassLabel": 'What this class calls its subclass ("Martial Archetype")',
    "classes[].asiLevels": "Levels granting an Ability Score Improvement, or a feat instead",
    "classes[].spellcastingAbility":
      "Ability slug for this class's spellcasting; null for a non-caster. Per class, so Paladin CHA + Wizard INT is expressible",
    "classes[].spellcastingProgression": CASTER_PROGRESSION,
    "classes[].spellcasting":
      "The full spellcasting header (ability, known/prepared, ritual, focus, progression, spell-list id); null for a non-caster. The flat spellcastingAbility/spellcastingProgression mirror it for existing readers",
    "classes[].spellcasting.prepares": PREPARES,
    "classes[].spellcasting.focus": FOCUS,
    "classes[].spellcasting.progression": CASTER_PROGRESSION,
    "classes[].spellcasting.spellListId": SPELL_LIST,
    "classes[].levelTable":
      "The class's full 20-row printed progression: slot columns, cantrips/spells known, the prepared-spell formula, and the named resources that grow with level (Second Wind 2 to 4, Rage 3, Sneak Attack 3d6)",
    "classes[].levelTable[].spellSlots": "Nine counts, index 0 = 1st-level slots; null for a non-caster row",
    "classes[].levelTable[].pactSlots": "Warlock Pact Magic: one uniform slot level with its own count",
    "classes[].levelTable[].preparedFormula":
      'The SRD prepared-spell rule as data ("<ability> modifier + <class> level") so homebrew can print its own wording',
    "classes[].levelTable[].classResources[].amount": 'A count, or a dice string ("3d6" for Sneak Attack)',
    "classes[].startingEquipmentOptions": STARTING_EQUIPMENT
  },
  ContentSubclassesData: {
    "subclasses[].subclassLevel":
      "The class level this subclass is taken at; null inherits the parent class's subclassLevel",
    "subclasses[].spellcastingAbility": "Set by third-caster subclasses (Eldritch Knight, Arcane Trickster)",
    "subclasses[].spellcasting":
      "A third-caster subclass's full spellcasting header, same shape as a class's; null otherwise",
    "subclasses[].spellcasting.prepares": PREPARES,
    "subclasses[].spellcasting.focus": FOCUS,
    "subclasses[].spellcasting.progression": CASTER_PROGRESSION,
    "subclasses[].spellcasting.spellListId": SPELL_LIST
  },
  ContentSpeciesData: {
    "species[].sizes": "A list because several 2024 species let the player pick Small or Medium",
    "species[].abilityBonuses":
      "Fixed ability increases, as data. Empty for every SRD 5.2.1 species (increases live on the background); a 2014-style or homebrew record populates it and the builder applies whatever is declared",
    "species[].abilityBonusChoice":
      '"Choose N abilities to raise by M" (the 2014 variant-human pattern); null when the species has none',
    "species[].languageChoices": '"Choose N languages" where the species offers one; null otherwise',
    "species[].languageChoices.fromCatalog": CHOICE_CATALOG,
    "species[].lineages": "Lineages/subraces; each one's traits are also folded into features",
    "species[].features":
      "Species traits plus every lineage's traits. NOTE: SRD 5.2.1 puts ability increases on the BACKGROUND, not the species"
  },
  ContentBackgroundsData: {
    "backgrounds[].abilityOptions":
      "SRD 5.2.1 ability increases: which abilities, and the legal distributions (+2/+1 or +1/+1/+1) as data",
    "backgrounds[].originFeatId": "The origin feat this background grants, keyed into the feat catalog",
    "backgrounds[].skillChoices":
      '"Choose N skills" where the background offers one; null otherwise (fixed grants stay in skillProficiencies)',
    "backgrounds[].skillChoices.fromCatalog": CHOICE_CATALOG,
    "backgrounds[].toolChoices": '"Choose N tools" where the background offers one; null otherwise',
    "backgrounds[].toolChoices.fromCatalog": CHOICE_CATALOG,
    "backgrounds[].languageChoices": '"Choose N languages" where the background offers one; null otherwise',
    "backgrounds[].languageChoices.fromCatalog": CHOICE_CATALOG,
    "backgrounds[].startingEquipmentOptions": STARTING_EQUIPMENT
  },
  ContentFeatsData: {
    "feats[].category": "Open slug (origin / general / fighting-style / epic-boon)",
    "feats[].prerequisiteRequires": "Proficiency or feature slugs the character must already have",
    "feats[].prerequisiteText":
      "Anything not modeled above, printed for the player. The SERVER decides whether a prerequisite is met - never the client",
    "feats[].feature": "A feat IS a feature plus catalog metadata - hence one record, not a list"
  },
  ContentNamesData: {
    "names[].pools": "Ordered by the data, never by a hardcoded client list",
    "names[].pools[].label": 'What this pool is ("Masculine", "Family", "Clan")'
  },
  ActorAvailableActionsData: {
    derived:
      "DISPLAY ONLY, and the sheet's single source for every number beside a roll button. Derived from the actor's LIVE loadout with the same functions the resolver uses, so a chip cannot disagree with the roll it starts - a circlet's granted expertise and an amulet's save bonus are already inside these numbers. Present on every response; a client should still tolerate its absence so it can talk to an older server. It rides this REQUEST rather than the broadcast game-state projection on purpose: this endpoint already authorizes its caller for one named actor, so the block is never even computed for an actor the caller may not see.",
    "derived.armorClass": "Live AC, already reconciled against worn armour and item riders",
    "derived.initiative": "Live initiative bonus including item riders",
    "derived.abilities[].check": "Ability-check bonus INCLUDING item check-bonus riders",
    "derived.abilities[].checkWithProficiency":
      "The same check plus proficiency, for a GM-called check against no named skill",
    "derived.abilities[].save": "The save the server will actually roll, minus only per-save cover",
    "derived.abilities[].saveFromItems": "The equipment share of `save`, so a sheet can say where the bonus came from",
    "derived.skills[].tier": "The EFFECTIVE tier: the sheet's base tier raised by any item grant",
    "derived.skills[].bonus": "Null only when the skill names no ability, the one case a sheet cannot roll it",
    "derived.skills[].sources": 'Item names that raised the tier, e.g. ["Circlet of Shadows"]',
    "derived.defences":
      "The damage defences in force outside any one hit, as the damage pipeline applies them: the stat block's, chosen features', items' and effects'. Petrified and underwater resistance are added per hit and are not listed.",
    "derived.defences.resistances[].type": DEFENCE_TYPE,
    "derived.defences.resistances[].source": DEFENCE_SOURCE,
    "derived.defences.immunities[].type": DEFENCE_TYPE,
    "derived.defences.immunities[].source": DEFENCE_SOURCE,
    "derived.defences.vulnerabilities[].type": DEFENCE_TYPE,
    "derived.defences.vulnerabilities[].source": DEFENCE_SOURCE,
    "derived.spellSaveDcBonus":
      "What standing spell-save-dc riders (an item, a feat) add to the bearer's spell save DC, and so to every action that uses it. A printed DC is not raised.",
    "actions[].available": "Whether strict mode would allow resolving this action right now",
    "actions[].violations[].rule":
      "Machine-readable rule id, e.g. economy.action-used, feature.requires-effect, condition.incapacitated",
    "actions[].usesRemaining": "Limited-use spending left; null when the action has no use limit",
    "actions[].componentsRemaining": "Rolls left in the open compound-action instance; null when no instance applies",
    "actions[].builtin":
      "True for the SRD generic actions (Dodge, Dash, Help, Unarmed Strike, ...) every combatant can take",
    "actions[].description":
      "DISPLAY ONLY. Every field from here down is read off the actor's EFFECTIVE action list, so it already carries the standing riders of what is equipped and attuned - which is what lets a client render an item-derived action (an amulet's cast, a +1 sword's swing) that is absent from the stat block entirely. None of it is what gets rolled: resolution takes `id` and recomputes through the same function, so a preview cannot disagree with the roll.",
    "actions[].attackBonus": "To-hit including item riders; null when the action has no attack roll",
    "actions[].rangeNormalFeet": "Normal range band; shots beyond it up to rangeFeet roll at disadvantage",
    "actions[].saveDc": "Save DC including item riders",
    "actions[].usesLimit": "Total limited uses including any item that raised the pool; null when unlimited",
    "actions[].usesPool": "Shared pool key; actions naming one pool spend one counter"
  },
  BuilderOffersData: {
    "offers[].key": "Stable key the draft's answers are filed under",
    "offers[].unresolvable": "Why nothing can be picked here yet; such an offer may be left open",
    "offers[].unavailable": "Option id -> why this build cannot usefully take it (already held, or no proficiency)",
    picks: "The answers the build still accepts, by offer key",
    subclassId: "The subclass offer's answer",
    choices: "The ledger rows these answers make: a create's `choices`"
  },
  MapAssetMetadata: {
    folder: MAP_FOLDER
  },
  MapCatalogEntry: {
    folder: MAP_FOLDER
  }
};

/**
 * Every content SHAPE this package declares, with no way to read a bundle off disk.
 *
 * ## Why this file is separate from `index.ts`
 *
 * `index.ts` opens with `createRequire(import.meta.url)` and `require("../bundles/…")`, which makes
 * the whole module node-only: importing ANY export from it into a Vite browser build drags the
 * loader in and the build fails. That was fine while the only consumer was the server, and it
 * stopped being fine the moment the homebrew editor needed to answer "would this publish?" the same
 * way the server answers it.
 *
 * The old answer was `publishBlockedReason` — a hand-maintained CLIENT list of what a record needs,
 * kept in step with nine server schemas by memory. It drifted in both directions and both directions
 * hurt: stricter than the server, and Publish was disabled on a record the store would have taken
 * (duplicate an SRD Longsword, get told to write a description the schema declares nullable);
 * LOOSER than the server, and the button was enabled on a body the store refused, so the GM got a
 * 409 carrying the word "Required" with no subject — which is exactly how "homebrew items cannot be
 * published" was reported.
 *
 * Splitting the schemas out means the client runs THE SERVER'S OWN SCHEMA rather than a description
 * of it. Drift is not policed, it is structurally impossible. This is not the client becoming a
 * second rules engine (CLAUDE.md rule 2): a rules engine decides outcomes, and this decides nothing
 * — it runs one shared parser and the server still runs it again, authoritatively, on publish.
 *
 * ## The rule for anything added here
 *
 * **Shapes, constants and pure functions only.** Nothing in this module — or in anything it imports
 * — may touch `node:`, the filesystem, or a bundle. `index.ts` re-exports all of it, so no server
 * import site changes and there is only ever one definition of each schema.
 */

import { z } from "zod";
import { AbilitySchema, ActorDefinitionSchema, ItemSlotSchema } from "@vtt/schemas";
import {
  BackgroundReferenceSchema, ClassReferenceSchema, ContentIdSchema, ContentSourceSchema,
  FeatReferenceSchema, FeatureUsesSchema, ITEM_REFUSED_MODIFIER_MESSAGE, ITEM_REFUSED_MODIFIER_TYPES,
  SpeciesReferenceSchema, SpellListReferenceSchema, SubclassReferenceSchema, featureRiders
} from "./character-content.js";

/** Character-builder content shapes (classes, subclasses, species, backgrounds, feats, names, spell lists). */
export * from "./character-content.js";
/** Spell-list membership as an overlay over the generated spell bundle - applied at the content merge point. */
export * from "./spell-lists.js";
/** The canonical SRD enumerated vocabularies (damage types, conditions, schools, creature types). */
export * from "./enums.js";

/**
 * ONE SOURCE DISCRIMINATOR, on every reference record in this package (`character-content.ts`
 * principle 2). `ContentSourceSchema` defaults to `"srd"`, so every committed bundle row parses
 * unchanged and comes out tagged `"srd"` - zero data migration, and no bundle is rewritten
 * (`build-bundle.ts` validates but writes the RAW ETL records, never the parsed output).
 *
 * Declaring the field is what makes it real: these schemas are plain `z.object`, whose Zod default
 * is STRIP, so writing `source: "homebrew"` into a record whose schema does not declare it vanishes
 * silently - no error, no field. The record schemas below are the authoritative list of what a
 * homebrew author may write.
 *
 * MONSTERS ARE DELIBERATELY ABSENT. `ActorDefinitionSchema.source` (`@vtt/schemas`) already exists
 * as a PROVENANCE object `{name, version, externalId?}` - the name is taken, and a sibling
 * `contentSource` key would be a second thing meaning the same thing. Homebrew-ness for a monster is
 * derived where the merge happens (the server knows which definitions came from the homebrew slice),
 * which needs no `ActorDefinition` change and so no ADR-0008 JSON-Schema mirror change either.
 */
export const ConditionReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(60),
  source: ContentSourceSchema,
  description: z.string().min(1).max(4000)
});
export type ConditionReference = z.infer<typeof ConditionReferenceSchema>;

const AbilityShortSchema = z.enum(["str", "dex", "con", "int", "wis", "cha"]);

export const SpellReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  source: ContentSourceSchema,
  /**
   * Credit line for a homebrew spell whose text came from somewhere else. SRD rows leave it unset
   * and inherit the bundle-wide CC BY notice; a surface that hardcodes "SRD 5.2.1, CC BY 4.0" on
   * every card makes a false claim about a homebrew one.
   */
  attribution: z.string().max(400).optional(),
  level: z.number().int().min(0).max(9),
  school: z.string().min(1).max(40),
  castingTime: z.string().min(1).max(80),
  reactionCondition: z.string().max(400).nullable(),
  range: z.object({ distance: z.number().nullable(), unit: z.string().nullable(), text: z.string().nullable() }),
  components: z.object({ verbal: z.boolean(), somatic: z.boolean(), material: z.boolean(), materialText: z.string().nullable(), materialConsumed: z.boolean() }),
  duration: z.string().min(1).max(120),
  concentration: z.boolean(),
  ritual: z.boolean(),
  attackRoll: z.boolean(),
  damage: z.object({ roll: z.string().nullable(), types: z.array(z.string()) }),
  save: AbilityShortSchema.nullable(),
  target: z.object({ type: z.string().nullable(), count: z.number().int().nullable() }),
  shape: z.object({ type: z.string(), size: z.number().nullable(), unit: z.string().nullable() }).nullable(),
  classes: z.array(z.string()),
  description: z.string().min(1).max(20000),
  higherLevel: z.string().max(4000).nullable(),
  castingOptions: z.array(z.object({ type: z.string(), damageRoll: z.string().nullable(), targetCount: z.number().int().nullable(), description: z.string().nullable() }))
});
export type SpellReference = z.infer<typeof SpellReferenceSchema>;

export const WeaponReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  source: ContentSourceSchema,
  category: z.enum(["simple", "martial"]),
  improvised: z.boolean(),
  damage: z.object({ dice: z.string().min(1).max(20), type: z.string().min(1).max(40) }),
  rangeFeet: z.number().int().positive().nullable(),
  longRangeFeet: z.number().int().positive().nullable(),
  /**
   * The weapon table's MASTERY column - every SRD weapon has exactly one, and there are exactly
   * eight in the whole system. Closed rather than an open slug on purpose: a mastery is not a label,
   * it is a named behaviour the engine implements, so an unknown one would parse and then do nothing
   * - the "built but unwired" failure this repo keeps finding. A typo fails the bundle load instead.
   *
   * OPTIONAL, and deliberately so: all 38 SRD rows carry one and a test pins that, but a GM's
   * homebrew weapon may legitimately have none, and a schema that forced a choice would make them
   * pick a behaviour at random. Usable only by a character who has unlocked it for that weapon
   * (Weapon Mastery); the gate lives with the reader, not here.
   */
  mastery: z.enum(["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"]).optional(),
  /**
   * The weapon table's PROPERTIES column ("finesse", "light", "thrown", ...). OPEN slugs, unlike
   * `mastery` above, and the asymmetry is the point: a mastery is a named behaviour the engine
   * implements, so an unknown one would be inert; a property is read by whoever cares about it
   * (`weaponAction` consults `thrown` and `reach`) and a homebrew weapon that declares "serrated"
   * is expressible without a schema change. This matches `ItemWeaponSchema.properties`
   * (`packages/schemas`), which the catalog copies onto an inventory row.
   *
   * ABSENT means not recorded; an EMPTY ARRAY means "this weapon has no properties" - a Mace really
   * has none. All 38 SRD rows carry the column and `bundle.test.ts` pins that, because the ETL
   * transcribes it (open5e links no properties to weapons) and a silent drop is exactly how
   * `mastery` spent a release doing nothing.
   */
  properties: z.array(z.string().regex(/^[a-z0-9-]+$/).max(40)).max(12).optional()
});
export type WeaponReference = z.infer<typeof WeaponReferenceSchema>;
/** The eight SRD mastery properties, for a consumer that needs to enumerate or validate them. */
export const WEAPON_MASTERY_IDS = z.enum(["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"]).options;
export type WeaponMasteryId = WeaponReference["mastery"];

export const WeaponPropertyReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(60),
  source: ContentSourceSchema,
  kind: z.enum(["property", "mastery"]),
  description: z.string().min(1).max(4000)
});
export type WeaponPropertyReference = z.infer<typeof WeaponPropertyReferenceSchema>;

export const ArmorReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  source: ContentSourceSchema,
  /** Body armor carries its full base AC (11-18); the shield row carries its +2 bonus. */
  acBase: z.number().int().min(2).max(25),
  addDexModifier: z.boolean(),
  dexModifierCap: z.number().int().nullable(),
  stealthDisadvantage: z.boolean(),
  strengthRequired: z.number().int().nullable()
});
export type ArmorReference = z.infer<typeof ArmorReferenceSchema>;

/**
 * A spell an item can cast ("cast Message once per day while attuned"). Needs no new machinery: the
 * builder already collapses a `FeatureUses` into the live `actionUses` namespace, and rests already
 * re-arm it - an item cast is one more synthesised action keyed by `uses.pool` or its action id.
 *
 * "Once per day" is `uses: {limit: 1, per: "long-rest"}`. `FeatureUsesSchema.per` has no `"day"` and
 * should not gain one: this app already treats a long rest as the day (legendary resistances say so
 * in as many words). That belongs in the authoring help text, not in a ninth enum value.
 */
export const ItemSpellCastSchema = z.object({
  spellId: ContentIdSchema,
  /** Cast at this slot level; absent = the spell's own level. */
  atLevel: z.number().int().min(0).max(9).optional(),
  /** Which ability powers it; absent = the wielder's own spellcasting ability. */
  ability: AbilitySchema.optional(),
  /** A flat printed DC ("save DC 15"), overriding any derivation. */
  saveDc: z.number().int().min(1).max(40).optional(),
  /** Charges. Share one pool across several casts with `uses.pool`. */
  uses: FeatureUsesSchema.optional(),
  /** Whether casting it also spends one of the bearer's own spell slots. */
  consumesSpellSlot: z.boolean().default(false)
}).strict();
export type ItemSpellCast = z.infer<typeof ItemSpellCastSchema>;

/**
 * Attunement. `restrictedTo` matches class ids or a species id and is ADVISORY - shown on the sheet
 * ("Requires attunement by a cleric"), never a block. It is an open slug set, blocking on a fuzzy
 * match would be wrong, and a GM handing a player a restricted item on purpose is a normal table
 * event, not an error to refuse.
 */
export const ItemAttunementSchema = z.object({
  required: z.boolean().default(false),
  restrictedTo: z.array(ContentIdSchema).max(8).default([])
}).strict();
export type ItemAttunement = z.infer<typeof ItemAttunementSchema>;

/**
 * Unified equipment catalog entry - the framework the browse-&-add flow and the homebrew update
 * build on. `loadEquipment` maps weapons and armor in from their own bundles; the
 * `equipment.v1.json` bundle carries adventuring gear, tools, packs, focuses, ammunition, and
 * consumables. The `weapon`/`armor` sub-objects are present only for those categories.
 *
 * THIS RECORD KEEPS `.strict()`, alone among the content schemas, ON PURPOSE. The two failure modes
 * are opposite and both real: a strict schema THROWS on an undeclared key, a plain one LOSES it
 * without a trace. For a hand-authored homebrew item, throwing is the useful half - it is the only
 * thing in the system that catches `weight` for `weightLb`. The fix for a field you want is to
 * DECLARE it here, never to drop the strictness - which is exactly what the magic-item block below
 * does: `isMagic`, `slot` and `modifiers` were REJECTED by this schema until they were declared.
 *
 * THE SAME GOES FOR THE REQUIRED-BUT-NULLABLE KEYS INSIDE `weapon` AND `armor`, and it is worth
 * saying why they survived the publish repair. `nullable` is not `optional`: all five weapon keys
 * and all five armor keys must be PRESENT, and `rangeFeet: null` is the semantically correct body
 * for a melee weapon rather than a workaround for one. Every SRD row carries exactly that shape
 * (`loadEquipment` maps it in), so relaxing these to `.optional()` to make a half-filled editor
 * body parse would weaken the SRD bundle's own load validation to paper over an authoring-side
 * gap. The fix belonged where the gap was: the editor now seeds the whole container the first time
 * any field in it is touched (`apps/client/src/homebrew/defaults.ts`), and the publish checklist
 * runs THIS schema, so the answer the GM reads is this schema's answer.
 *
 * The riders live HERE, on the catalog record, and never on the carried `InventoryItem` row. The
 * owner is handed their whole inventory verbatim in their projection, so a rider mirrored onto that
 * row would reach the player the instant they picked the item up - which is what makes hiding a
 * cursed item's mechanics structural rather than a `delete` someone has to remember.
 */
/**
 * The weapon stats a unified equipment row carries, NAMED rather than inlined - and the name is
 * load-bearing, not style. `EquipmentReferenceSchema` is the largest object in this package, and
 * inlining one more property here pushed `z.infer` past TypeScript's expansion budget: the compiler
 * silently truncated a DIFFERENT inferred type two packages away, and the spell shape
 * `packages/domain`'s `catalog-choice.ts` reads lost its attack-roll and range fields. (`SpellReference`
 * itself carries `attackRoll` and a nested `range` object; `rangeFeet` is the domain summary's own
 * flattening of it - the earlier wording here named the wrong one of the two.) A named schema gives
 * the inference one alias to reuse instead of re-expanding the shape at every use.
 *
 * `test/bundle.test.ts` now holds a compile-time guard for this, because the failure mode is a type
 * that quietly narrows and no runtime assertion can see it.
 */
const EquipmentWeaponStatsSchema = z.object({
  category: z.enum(["simple", "martial"]),
  damageDice: z.string().max(20),
  damageType: z.string().max(40),
  rangeFeet: z.number().int().positive().nullable(),
  longRangeFeet: z.number().int().positive().nullable(),
  /** OPTIONAL here, unlike the weapon table: gear and homebrew rows map through this same shape and have no mastery. */
  mastery: z.enum(["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"]).optional(),
  /**
   * The weapon's property slugs, carried through from `WeaponReferenceSchema.properties` so the
   * catalog->inventory copy in `character-build.ts` can put them on the row `weaponPropertiesOf`
   * reads. Unlike `mastery` - which is browse-only and resolves against the catalog by item id -
   * properties are read off the INVENTORY row, so stopping this shape here would leave
   * `weaponPropertiesOf` returning `[]` for every weapon a builder ever handed out.
   */
  properties: z.array(z.string().regex(/^[a-z0-9-]+$/).max(40)).max(12).optional()
});

export const EquipmentReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  source: ContentSourceSchema,
  /**
   * What KIND of thing this is, as an open slug - never a closed enum (`character-content.ts`
   * principle 3). Homebrew declares "relic", "vehicle", "trinket" with no schema change, and the
   * live-play side (`InventoryItemSchema.category`) has always been an open slug, so this makes the
   * catalog consistent with the actor rather than the reverse.
   *
   * The four values the ENGINE reads are "weapon", "armor", "shield" and everything-else: AC
   * derivation, what starts equipped, and the `weapons` catalog slug all compare against those
   * literals. A homebrew category is therefore inert by design until an explicit mechanical `slot`
   * field lands - it displays and stacks, it does not derive AC or an attack.
   */
  category: z.string().regex(/^[a-z0-9-]+$/).max(40),
  costGp: z.number().nonnegative().max(1_000_000).nullable(),
  weightLb: z.number().nonnegative().max(1000).nullable(),
  /**
   * 4000, RAISED FROM 2000 on 2026-08-11, and the number is not arbitrary — it is the cap on
   * `InventoryItemSchema.description` (`packages/schemas/src/index.ts`), which is where
   * add-from-catalog COPIES this string. A catalog cap below its own downstream's was the tighter
   * of the two for no stated reason, and it cost real content: 12 of the SRD's 268 magic items ran
   * past 2000 and had to be cut mid-entry, taking `Ring of Elemental Command`'s spell table and its
   * save DC, `Rod of Lordly Might`'s three DC-17 effects, and `Staff of the Magi`'s retributive
   * strike with them. Matching the two caps leaves only the 2 genuine outliers cut.
   */
  description: z.string().max(4000).nullable(),
  weapon: EquipmentWeaponStatsSchema.nullable().optional(),
  armor: z.object({ acBase: z.number().int().min(2).max(25), addDexModifier: z.boolean(), dexModifierCap: z.number().int().nullable(), stealthDisadvantage: z.boolean(), strengthRequired: z.number().int().nullable() }).nullable().optional(),

  // ---- the magic-item vocabulary ---------------------------------------------------------------
  // Declaring these is what makes them real. This schema is `.strict()`, so until now `isMagic`,
  // `slot` and `modifiers` were REJECTED outright rather than quietly dropped; the fix for a field
  // you want has always been to declare it here.

  /** WHERE it is worn or held. Absent = fall back to `category` for the three the engine already knows. */
  slot: ItemSlotSchema.optional(),
  /** Display and filtering only ("uncommon", "legendary"). An OPEN slug - rarity is identity, not a mechanical hook. */
  rarity: ContentIdSchema.optional(),
  isMagic: z.boolean().default(false),
  attunement: ItemAttunementSchema.optional(),
  /**
   * A cursed item cannot be voluntarily removed once attuned, and its magic half is withheld from
   * the player until attunement. HIDDEN UNTIL ATTUNEMENT, AND NOTHING MORE: from the moment of
   * attunement the player sees everything, including the derived numbers, because they have already
   * learned it - hiding further would only make their own sheet lie to them.
   */
  cursed: z.boolean().default(false),
  /** Spells the item can cast (Amulet of Message, Wand of Fireballs). */
  casts: z.array(ItemSpellCastSchema).max(8).default([]),
  /**
   * Feats the item grants while active. Depth 1, no transitive expansion, and the grant edge is
   * one-directional - no feature, feat, or option ever gains a `grants.items` - so a cycle cannot be
   * drawn rather than merely being checked for.
   */
  grantsFeatIds: z.array(ContentIdSchema).max(4).default([]),

  /**
   * The SAME rider block a feature, a feat, and a chosen option carry: `tags`, `actions`, `effects`,
   * `uses` (an item's charges), `grants`, `modifiers`. Spread, not restated - which is what makes
   * "a feat carries the same buffs and debuffs an item does" true by construction.
   */
  ...featureRiders
}).strict().superRefine((item, context) => {
  // A curse you can drop by taking the hat off is not a curse. Requiring attunement also gives the
  // hiding rule ONE well-defined boundary instead of two: hidden until attuned, visible after.
  if (item.cursed && item.attunement?.required !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom, path: ["cursed"],
      message: "A cursed item must require attunement - attunement is both what springs the curse and what reveals it."
    });
  }
  // The one refusal, enforced HERE rather than in a publish-time validator, because the carrier is
  // what makes it a refusal: the identical rider on a feat is fine and must stay parseable.
  item.modifiers.forEach((modifier, index) => {
    if (ITEM_REFUSED_MODIFIER_TYPES.includes(modifier.type)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["modifiers", index, "type"], message: ITEM_REFUSED_MODIFIER_MESSAGE });
    }
  });
});
export type EquipmentReference = z.infer<typeof EquipmentReferenceSchema>;

export const RuleReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  source: ContentSourceSchema,
  ruleset: z.string().min(1).max(80),
  order: z.number().int(),
  description: z.string().min(1).max(40000)
});
export type RuleReference = z.infer<typeof RuleReferenceSchema>;

export const ContentAttributionSchema = z.object({
  license: z.literal("CC-BY-4.0"),
  attribution: z.string().min(1),
  source: z.object({
    name: z.string(), author: z.string(), publisher: z.string(), permalink: z.string(),
    vendoredFrom: z.string(), retrieved: z.string()
  }),
  /**
   * Further CC BY 4.0 transcriptions the bundles draw on beyond `source`. Additive-optional so an
   * older attribution.json still validates (ADR-0007). These are SECONDARY: the CC BY attribution
   * owed to a consumer is `attribution` above - Wizards of the Coast for SRD 5.2.1 itself - and
   * these rows only record where a transcription of that text was obtained.
   */
  additionalSources: z.array(z.object({
    name: z.string(), vendoredFrom: z.string(), commit: z.string(),
    retrieved: z.string(), covers: z.string()
  })).default([])
});
export type ContentAttribution = z.infer<typeof ContentAttributionSchema>;

/**
 * A skill: reference text plus the ability its check uses. `ability` is optional-with-fallback while
 * the bundle column is being authored: a record without one falls back to the well-known SRD mapping
 * below, and a record that CARRIES one (bundle data, homebrew) always wins - so a homebrew skill is
 * one bundle row, never a code edit (the `SKILL_ABILITY` client hardcode is the anti-pattern).
 */
export const SkillReferenceSchema = ConditionReferenceSchema.extend({ ability: AbilityShortSchema.optional() });
export type SkillReference = z.infer<typeof SkillReferenceSchema>;

/**
 * A LANGUAGE, as data rather than prose.
 *
 * The SRD's Standard and Rare language tables lived only inside a paragraph of `rules.v1.json`, and
 * the consequence was not cosmetic: `languageChoices` on a species or background had no list to draw
 * from, so **"Common plus two languages" - which Character Creation owes every character - was never
 * offered to anybody**, and Deft Explorer's and Thieves' Cant's language picks had nothing to raise.
 *
 * `table` is the SRD's own split and it is what a choice narrows on: the base budget draws from
 * `standard`, while `druidic` and `thieves-cant` are `rare` and arrive as grants from a class
 * feature. It is an OPEN slug, not an enum, so a homebrew "planar" table needs no schema edit.
 */
export const LanguageReferenceSchema = ConditionReferenceSchema.extend({
  /** Which SRD table the language is printed in - "standard" (widespread) or "rare" (secret/planar). */
  table: z.string().regex(/^[a-z0-9-]+$/).max(40).default("standard")
});
export type LanguageReference = z.infer<typeof LanguageReferenceSchema>;

/** The printed SRD 5.2.1 skill->ability table, used ONLY when a bundle row omits its own `ability`. */
export const SRD_SKILL_ABILITY: Readonly<Record<string, z.infer<typeof AbilityShortSchema>>> = Object.freeze({
  athletics: "str",
  acrobatics: "dex", "sleight-of-hand": "dex", stealth: "dex",
  arcana: "int", history: "int", investigation: "int", nature: "int", religion: "int",
  "animal-handling": "wis", insight: "wis", medicine: "wis", perception: "wis", survival: "wis",
  deception: "cha", intimidation: "cha", performance: "cha", persuasion: "cha"
});

/**
 * The nine authorable homebrew types.
 *
 * Spelled here rather than imported from `@vtt/api-contract` so this module stays a leaf: the
 * server's `HomebrewContentType` is asserted against this map with `satisfies`, so the two cannot
 * diverge without failing to compile.
 */
export type HomebrewBodyType =
  | "class" | "subclass" | "species" | "background" | "feat"
  | "spell" | "equipment" | "monster" | "spell-list";

/**
 * **The one map of type -> body schema, shared by every gate that has an opinion about a homebrew
 * body.** Three consumers, one definition: the publish validator's tier 1
 * (`apps/server/src/homebrew-validate.ts`), the store's read-back parse
 * (`apps/server/src/homebrew-store.ts`, ADR-0016 "one shape, never a fork"), and the editor's
 * publish checklist (`apps/client/src/homebrew/validate.ts`).
 *
 * The third consumer is the reason this map moved out of the server. The checklist used to be a
 * hand-written subset of what these schemas require, so it green-lit bodies the server refused —
 * the whole of the "homebrew items cannot be published" report. Sharing the map makes the client's
 * answer and the server's answer the same computation rather than two descriptions of one rule.
 */
export const HOMEBREW_BODY_SCHEMAS = {
  class: ClassReferenceSchema,
  subclass: SubclassReferenceSchema,
  species: SpeciesReferenceSchema,
  background: BackgroundReferenceSchema,
  feat: FeatReferenceSchema,
  spell: SpellReferenceSchema,
  equipment: EquipmentReferenceSchema,
  monster: ActorDefinitionSchema,
  "spell-list": SpellListReferenceSchema
} as const satisfies Record<HomebrewBodyType, { safeParse: (value: unknown) => { success: boolean } }>;

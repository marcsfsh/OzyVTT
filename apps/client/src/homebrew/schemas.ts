/**
 * The nine field schemas. **Data, not forms.**
 *
 * Kept in one file rather than nine, deliberately: they are nine descriptions of the
 * same vocabulary, and the value of having them side by side — spotting that two types
 * spell the same idea differently — outweighs one import per type. Nothing here draws
 * anything; `FieldRenderer` does, in one place.
 *
 * Where a field is authored, stored, and read by nothing yet, it carries a `note`. That
 * is the cheapest honesty in the whole feature: a GM who authors a mechanic that never
 * fires has no other way to find out.
 */

import { RARITY_IDS } from "@vtt/content-srd-5.2.1/schemas";
import { newId } from "../lib/ids";
import { SUB_OBJECT_DEFAULTS } from "./defaults";
import { getAt } from "./paths";
import { basicsSection, damagePartsField, diceValidate, humanise, inContainer, opt, type Draft, type FieldDef, type HomebrewSchema, type SchemaContext, type SectionDef } from "./schema";
import type { HomebrewType } from "./types";

const ABILITIES = [
  opt("str", "Strength"), opt("dex", "Dexterity"), opt("con", "Constitution"),
  opt("int", "Intelligence"), opt("wis", "Wisdom"), opt("cha", "Charisma")
];

const SIZES = [opt("tiny", "Tiny"), opt("small", "Small"), opt("medium", "Medium"), opt("large", "Large"), opt("huge", "Huge"), opt("gargantuan", "Gargantuan")];

const LEVEL_CHIPS = Array.from({ length: 20 }, (_, index) => opt(String(index + 1), String(index + 1)));

/** The 20 level chips store NUMBERS, not the strings a chip's value is. */
const numberChips = (key: string, label: string, help?: string): FieldDef => ({
  key,
  label,
  kind: "multiselect",
  wide: true,
  help,
  options: LEVEL_CHIPS,
  read: (scope) => (Array.isArray((scope as Draft)[key]) ? ((scope as Draft)[key] as number[]).map(String) : []),
  write: (next, scope) => ({ ...scope, [key]: (next as string[]).map(Number).sort((a, b) => a - b) })
});

/* ------------------------------------------------------------- spellcasting ----- */

const CASTER_OPTIONS = [
  opt("none", "None"),
  opt("full", "Full caster"),
  opt("half", "Half caster"),
  opt("third", "Third caster"),
  opt("pact", "Pact magic")
];

const isCaster = (scope: Draft) => !!scope.spellcasting;

/**
 * ONE pick drives all nine slot columns and the pact pool. "None" is the ABSENCE of the
 * spellcasting block, not a `"none"` value — the schema has nowhere to put one — so the
 * control reads and writes the shape rather than a stored field.
 *
 * `pactSlots` and `spellSlots` are never two independent fields: authoring both is not a
 * schema error but pact silently wins, which is the worst kind of wrong.
 */
const spellcastingGroup = (ownerWord: string): FieldDef => ({
  key: "spellcasting",
  label: "Spellcasting",
  kind: "group",
  // Stated ONCE beneath the group, never once per member field.
  help: "Full casters get slots from level 1, half-casters from 2, third-casters from 3. Pact magic is the warlock's short-rest pool.",
  rows: [
    {
      key: "spellcasting.multiclassProgression",
      label: "Progression",
      kind: "select",
      options: CASTER_OPTIONS,
      read: (scope) => (scope.spellcasting ? ((scope.spellcasting as Draft).multiclassProgression ?? "full") : "none"),
      write: (next, scope) => {
        if (next === "none" || next === "") {
          const copy = { ...scope };
          delete copy.spellcasting;
          return copy;
        }
        const current = (scope.spellcasting as Draft | undefined) ?? {};
        return {
          ...scope,
          spellcasting: { ability: "int", prepares: "prepared", ritual: false, focus: null, ...current, multiclassProgression: next }
        };
      }
    },
    { key: "spellcasting.ability", label: "Spellcasting ability", kind: "select", options: ABILITIES, visibleWhen: isCaster },
    { key: "spellcasting.prepares", label: "Spells are", kind: "select", options: [opt("known", "Known"), opt("prepared", "Prepared")], visibleWhen: isCaster },
    { key: "spellcasting.ritual", label: "Can cast rituals", kind: "switch", visibleWhen: isCaster },
    { key: "spellcasting.focus", label: "Spellcasting focus", placeholder: "arcane-focus", visibleWhen: isCaster },
    {
      key: "spellcasting.spellListId",
      label: "Spell list",
      kind: "select",
      required: true,
      visibleWhen: isCaster,
      // Never free text: a slug that resolves to no list silently produces an empty
      // spell list, and a character built on it is rejected at Create.
      options: (ctx) => ctx.spellLists,
      help: `Which list this ${ownerWord} draws spells from.`
    }
  ]
});

/* -------------------------------------------------------------- shared bits ----- */

const choiceGroup = (key: string, label: string, options: (ctx: SchemaContext) => readonly { value: string; label: string }[], help?: string): FieldDef => ({
  key,
  label,
  kind: "group",
  help,
  rows: [
    { key: `${key}.choose`, label: "How many", kind: "stepper", min: 0, max: 6 },
    { key: `${key}.from`, label: "From", kind: "multiselect", wide: true, options }
  ]
});

const startingEquipment = (): FieldDef => ({
  key: "startingEquipment",
  label: "Starting equipment",
  kind: "rows",
  help: "Each row is one bundle the player can pick.",
  addLabel: "Add a bundle",
  emptyText: "No starting equipment yet.",
  rowKey: (row, index) => String((row as { id?: string }).id ?? index),
  newRow: () => ({ id: newId(), label: "", items: [], goldPieces: 0 }),
  rowLabel: (row) => String((row as { label?: string }).label || "Unnamed bundle"),
  rows: [
    { key: "label", label: "Label", placeholder: "A greatsword and a dungeoneer's pack" },
    { key: "goldPieces", label: "Gold instead", kind: "number", min: 0, max: 10000, unit: "gp" },
    {
      key: "items",
      label: "Items",
      kind: "rows",
      addLabel: "Add an item",
      emptyText: "No items yet.",
      rowKey: (row, index) => String((row as { id?: string }).id ?? index),
      newRow: () => ({ id: "", name: "", quantity: 1 }),
      rowLabel: (row) => String((row as { name?: string }).name || "Unnamed item"),
      rows: [
        { key: "name", label: "Name" },
        { key: "id", label: "Catalog id", placeholder: "longsword" },
        { key: "quantity", label: "How many", kind: "number", min: 1, max: 99 }
      ]
    }
  ]
});

/**
 * Proficiency slugs are OPEN sets — `character-build.ts` folds whatever a class declares — so these
 * stay free-tag inputs and the suggestions are the well-known members rather than a closed list.
 * Tools widen from the equipment catalog, which is where the table's real tool names live (the SRD
 * bundle's `tool` category, plus any the GM has authored), so a class can be given "smiths-tools"
 * by picking it rather than by spelling it.
 */
const proficiencyFields = (): readonly FieldDef[] => [
  { key: "armorProficiencies", label: "Armour training", kind: "tags", suggestions: ["light-armor", "medium-armor", "heavy-armor", "shields"] },
  { key: "weaponProficiencies", label: "Weapon training", kind: "tags", suggestions: (ctx) => ["simple-weapons", "martial-weapons", ...ctx.equipment.filter((entry) => entry.keywords === "weapon").map((entry) => entry.id)] },
  { key: "toolProficiencies", label: "Tool proficiencies", kind: "tags", suggestions: (ctx) => ctx.equipment.filter((entry) => entry.keywords === "tool").map((entry) => entry.id) }
];

/** `key` is the record's own: every type stores a LIST under `features` (or `traits`)
    except a feat, which is one `FeatureRecord` under a singular `feature`. The renderer
    is the same either way — `FeatureEditor`'s `single` mode reads the object. */
const featuresField = (label: string, key = "features", blurbless = false): FieldDef => ({
  key,
  label,
  kind: "custom",
  custom: "features",
  wide: true,
  help: blurbless ? undefined : "What the record actually does."
});

/* -------------------------------------------------------------------- class ----- */

const CLASS_SCHEMA: HomebrewSchema = {
  type: "class",
  sections: [
    basicsSection("class"),
    {
      id: "progression",
      title: "Progression",
      fields: [
        { key: "hitDie", label: "Hit die", kind: "select", required: true, options: [opt("d4"), opt("d6"), opt("d8"), opt("d10"), opt("d12")] },
        { key: "primaryAbilities", label: "Primary ability", kind: "multiselect", required: true, max: 2, options: ABILITIES },
        { key: "savingThrows", label: "Saving throw proficiencies", kind: "multiselect", required: true, max: 6, options: ABILITIES },
        { key: "subclassLevel", label: "Subclass unlocks at", kind: "stepper", min: 1, max: 20 },
        { key: "subclassLabel", label: "Subclass called", placeholder: "Martial Archetype" },
        numberChips("asiLevels", "Ability score improvements at", "Seeded with 4, 8, 12, 16 and 19 — every SRD class's ladder."),
        spellcastingGroup("class")
      ]
    },
    {
      id: "proficiencies",
      title: "Proficiencies",
      fields: [
        ...proficiencyFields(),
        choiceGroup("skillChoices", "Skill choices", (ctx) => ctx.skills, "Which skills a new character of this class may choose from."),
        choiceGroup("toolChoices", "Tool choices", () => [])
      ]
    },
    { id: "equipment", title: "Starting equipment", fields: [startingEquipment()] },
    { id: "features", title: "Features", fields: [featuresField("Class features")] },
    {
      id: "level-table",
      title: "Level table",
      fields: [{ key: "levelTable", label: "Level table", kind: "custom", custom: "levelTable", wide: true }]
    },
    {
      id: "advanced",
      title: "Advanced",
      advanced: true,
      fields: [
        {
          key: "statPriority",
          label: "Ability priority",
          kind: "rows",
          note: "Only used by the random character generator, which isn't built yet.",
          addLabel: "Add an ability",
          emptyText: "No priority set.",
          maxRows: 6,
          maxRowsReason: "All six abilities are already listed.",
          rowKey: (row, index) => `${String(row)}-${index}`,
          newRow: () => "str",
          rowLabel: (row) => ABILITIES.find((entry) => entry.value === row)?.label ?? String(row),
          // The row IS the ability id, not an object, so the row's "field" is the row.
          rows: [{ key: "", label: "Ability", kind: "select", options: ABILITIES, read: (scope) => scope, write: (next) => next as Draft }]
        },
        {
          key: "multiclassPrerequisites",
          label: "Multiclass minimums",
          kind: "rows",
          addLabel: "Add a minimum",
          emptyText: "No multiclass minimums.",
          rowKey: (row, index) => `${(row as { ability?: string }).ability ?? ""}-${index}`,
          newRow: () => ({ ability: "str", minimum: 13 }),
          rowLabel: (row) => `${ABILITIES.find((entry) => entry.value === (row as { ability?: string }).ability)?.label ?? "Ability"} ${(row as { minimum?: number }).minimum ?? ""}`,
          rows: [
            { key: "ability", label: "Ability", kind: "select", options: ABILITIES },
            { key: "minimum", label: "At least", kind: "number", min: 1, max: 20 }
          ]
        },
        {
          key: "multiclassProficiencies",
          label: "Multiclass proficiencies",
          kind: "group",
          rows: [
            { key: "multiclassProficiencies.armor", label: "Armour", kind: "tags" },
            { key: "multiclassProficiencies.weapons", label: "Weapons", kind: "tags" },
            { key: "multiclassProficiencies.tools", label: "Tools", kind: "tags" }
          ]
        }
      ]
    }
  ]
};

/* ----------------------------------------------------------------- subclass ----- */

const SUBCLASS_SCHEMA: HomebrewSchema = {
  type: "subclass",
  sections: [
    basicsSection("subclass"),
    {
      id: "belongs-to",
      title: "Belongs to",
      // A subclass that grants its own slots is dead data everywhere: the rules engine
      // reads the CLASS's level table. Said once, here, rather than offering a level
      // table field that would never be read.
      blurb: "A subclass can't grant its own spell slots — the rules engine reads the class's level table. It can still grant always-prepared spells through a feature.",
      fields: [
        { key: "classId", label: "Class", kind: "select", required: true, options: (ctx) => ctx.classes },
        { key: "subclassLevel", label: "Unlocks at level", kind: "stepper", min: 1, max: 20, help: "Leave at the class's own level unless this subclass unlocks earlier." },
        spellcastingGroup("subclass")
      ]
    },
    { id: "features", title: "Features", fields: [featuresField("Subclass features")] }
  ]
};

/* ------------------------------------------------------------------ species ----- */

const SPECIES_SCHEMA: HomebrewSchema = {
  type: "species",
  sections: [
    basicsSection("species"),
    {
      id: "body",
      title: "Body",
      fields: [
        { key: "sizes", label: "Size", kind: "multiselect", required: true, options: SIZES },
        { key: "speedFeet", label: "Walking speed", kind: "number", required: true, min: 0, max: 120, unit: "ft" },
        { key: "darkvisionFeet", label: "Darkvision", kind: "number", min: 0, max: 240, unit: "ft", note: "Display only — the rules engine doesn't grant darkvision yet." },
        { key: "creatureType", label: "Creature type", placeholder: "humanoid", suggestions: (ctx) => ctx.creatureTypes }
      ]
    },
    {
      id: "abilities",
      title: "Ability bonuses",
      fields: [
        {
          key: "abilityBonuses",
          label: "Ability bonuses",
          kind: "rows",
          addLabel: "Add a bonus",
          emptyText: "No ability bonuses.",
          note: "Not offered in the character builder yet.",
          rowKey: (row, index) => `${(row as { ability?: string }).ability ?? ""}-${index}`,
          newRow: () => ({ ability: "str", amount: 1 }),
          rowLabel: (row) => {
            const bonus = row as { ability?: string; amount?: number };
            const name = ABILITIES.find((entry) => entry.value === bonus.ability)?.label ?? "Ability";
            return `${name} ${(bonus.amount ?? 0) >= 0 ? "+" : ""}${bonus.amount ?? 0}`;
          },
          rows: [
            { key: "ability", label: "Ability", kind: "select", options: ABILITIES },
            { key: "amount", label: "Amount", kind: "number", min: -2, max: 3, allowNegative: true }
          ]
        }
      ]
    },
    {
      id: "languages",
      title: "Languages",
      fields: [{ key: "languages", label: "Languages", kind: "tags", suggestions: ["common", "elvish", "dwarvish", "draconic"] }]
    },
    { id: "traits", title: "Traits", fields: [featuresField("Species traits", "traits")] },
    {
      id: "lineages",
      title: "Lineages",
      // Stated ONCE, at the section, not per lineage.
      blurb: "A lineage trait can grant things, but it can't ask the player a question yet — put any choice on a species trait instead.",
      fields: [
        {
          key: "lineages",
          label: "Lineages",
          kind: "rows",
          addLabel: "Add a lineage",
          emptyText: "No lineages yet.",
          rowKey: (row, index) => String((row as { id?: string }).id ?? index),
          newRow: () => ({ id: newId(), name: "", description: "", traits: [] }),
          rowLabel: (row) => String((row as { name?: string }).name || "Unnamed lineage"),
          rows: [
            { key: "name", label: "Name" },
            { key: "description", label: "Description", kind: "textarea", wide: true }
          ]
        }
      ]
    }
  ]
};

/* --------------------------------------------------------------- background ----- */

const BACKGROUND_SCHEMA: HomebrewSchema = {
  type: "background",
  sections: [
    basicsSection("background"),
    {
      id: "origin",
      title: "Origin",
      fields: [
        { key: "originFeatId", label: "Origin feat", kind: "select", required: true, options: (ctx) => ctx.feats },
        {
          key: "abilityOptions",
          label: "Ability score increases",
          kind: "group",
          rows: [
            { key: "abilityOptions.from", label: "From", kind: "multiselect", wide: true, options: ABILITIES },
            {
              key: "abilityOptions.spreads",
              label: "Spreads",
              kind: "rows",
              note: "Not offered in the character builder yet.",
              addLabel: "Add a spread",
              emptyText: "No spreads yet.",
              rowKey: (row, index) => String(index),
              newRow: () => ({ amounts: [2, 1] }),
              rows: [{ key: "label", label: "Label", placeholder: "+2 / +1" }]
            }
          ]
        }
      ]
    },
    {
      id: "proficiencies",
      title: "Proficiencies",
      fields: [
        { key: "skillProficiencies", label: "Skills", kind: "multiselect", wide: true, options: (ctx) => ctx.skills },
        { key: "toolProficiencies", label: "Tools", kind: "tags" }
      ]
    },
    { id: "equipment", title: "Starting equipment", fields: [startingEquipment()] },
    { id: "features", title: "Features", fields: [featuresField("Background features")] }
  ]
};

/* --------------------------------------------------------------------- feat ----- */

const FEAT_SCHEMA: HomebrewSchema = {
  type: "feat",
  sections: [
    basicsSection("feat"),
    {
      id: "category",
      title: "Category",
      // The single most consequential field on a feat, and invisible without a readout —
      // which is why it is stated here, once, rather than guessed at.
      blurb: "A feat is only offered where something asks for its category. Origin feats come from backgrounds; general feats from ability score improvements.",
      fields: [
        // An open slug in `FeatReferenceSchema`, so a closed select meant a category the table
        // has never used before was unauthorable from the form that exists to author new things.
        { key: "category", label: "Category", required: true, placeholder: "general", suggestions: (ctx) => ctx.featCategories.map((option) => option.value) },
        { key: "repeatable", label: "Can be chosen more than once", kind: "switch" },
        {
          key: "prerequisite",
          label: "Prerequisites",
          kind: "group",
          rows: [
            { key: "prerequisite.level", label: "Minimum level", kind: "number", min: 1, max: 20 },
            { key: "prerequisite.ability", label: "Ability", kind: "select", options: ABILITIES },
            { key: "prerequisite.minimum", label: "At least", kind: "number", min: 1, max: 20 }
          ]
        }
      ]
    },
    { id: "feature", title: "The feat itself", fields: [featuresField("What it does", "feature")] }
  ]
};

/* -------------------------------------------------------------------- spell ----- */

const SPELL_SCHEMA: HomebrewSchema = {
  type: "spell",
  sections: [
    // No `summary`: `SpellReferenceSchema` has no such field, so it would be authored,
    // stored and read by nothing.
    basicsSection("spell", { description: true, attribution: true }),
    {
      id: "casting",
      title: "Casting",
      fields: [
        { key: "level", label: "Spell level", kind: "stepper", min: 0, max: 9, help: "0 is a cantrip." },
        { key: "school", label: "School", required: true, placeholder: "evocation", suggestions: (ctx) => ctx.schools },
        { key: "castingTime", label: "Casting time", required: true, placeholder: "1 action" },
        {
          key: "reactionCondition",
          label: "Reaction trigger",
          visibleWhen: (draft) => String(draft.castingTime ?? "").toLowerCase().includes("reaction"),
          placeholder: "which you take when you are hit by an attack"
        },
        {
          key: "range",
          label: "Range",
          kind: "group",
          rows: [
            { key: "range.distance", label: "Distance", kind: "number", min: 0, max: 5280, emptyValue: "null" },
            { key: "range.unit", label: "Unit", kind: "select", emptyValue: "null", options: [opt("feet", "Feet"), opt("miles", "Miles"), opt("self", "Self"), opt("touch", "Touch")] },
            { key: "range.text", label: "Or say it in words", placeholder: "Self (30-foot cone)" }
          ]
        },
        {
          key: "components",
          label: "Components",
          kind: "group",
          rows: [
            { key: "components.verbal", label: "Verbal", kind: "switch" },
            { key: "components.somatic", label: "Somatic", kind: "switch" },
            { key: "components.material", label: "Material", kind: "switch" },
            { key: "components.materialText", label: "Materials", visibleWhen: (draft) => (draft.components as Draft | undefined)?.material === true },
            { key: "components.materialConsumed", label: "Consumed by the spell", kind: "switch", visibleWhen: (draft) => (draft.components as Draft | undefined)?.material === true }
          ]
        },
        { key: "duration", label: "Duration", required: true, placeholder: "Instantaneous" },
        { key: "concentration", label: "Needs concentration", kind: "switch" },
        { key: "ritual", label: "Can be cast as a ritual", kind: "switch" }
      ]
    },
    {
      id: "effect",
      title: "Effect",
      fields: [
        { key: "attackRoll", label: "Needs an attack roll", kind: "switch" },
        { key: "save", label: "Saving throw", kind: "select", emptyValue: "null", options: [...ABILITIES] },
        {
          key: "damage",
          label: "Damage",
          kind: "group",
          rows: [
            { key: "damage.roll", label: "Formula", placeholder: "8d6", validate: diceValidate },
            // `3d`, site 1 of 9. A spell may deal two types at once (Ice Knife), so this is a list —
            // and `pick` reads on a list exactly as it does on a single value.
            { key: "damage.types", label: "Types", kind: "tags", pick: true, suggestions: (ctx) => ctx.damageTypes }
          ]
        },
        {
          key: "target",
          label: "Target",
          kind: "group",
          rows: [
            { key: "target.type", label: "Targets", kind: "select", emptyValue: "null", options: [opt("creature", "Creatures"), opt("object", "Objects"), opt("point", "A point"), opt("area", "An area"), opt("self", "Yourself")] },
            { key: "target.count", label: "How many", kind: "number", min: 1, max: 20, emptyValue: "null" }
          ]
        },
        {
          key: "shape",
          label: "Area",
          kind: "group",
          visibleWhen: (draft) => (draft.target as Draft | undefined)?.type === "area",
          // `shape.sizeFeet` was written here for a column called `size`. `SpellReferenceSchema` is
          // not `.strict()`, so the typo was STRIPPED in silence and the two real keys came back
          // "Required" — an area spell could be authored and never published. Same class of defect
          // as the item sub-objects, same repair: the right key names, and a whole container on
          // first touch.
          rows: inContainer("shape", SUB_OBJECT_DEFAULTS.spell!.shape, [
            { key: "shape.type", label: "Shape", kind: "select", options: [opt("sphere", "Sphere"), opt("cube", "Cube"), opt("cone", "Cone"), opt("line", "Line"), opt("cylinder", "Cylinder")] },
            { key: "shape.size", label: "Size", kind: "number", min: 0, max: 1000, unit: "ft", emptyValue: "null" },
            { key: "shape.unit", label: "Measured in", suggestions: ["feet", "miles"], emptyValue: "null" }
          ])
        },
        { key: "higherLevel", label: "At higher levels", kind: "textarea", wide: true }
      ]
    },
    {
      id: "lists",
      title: "Spell lists",
      blurb: "Naming a list here puts this spell on it — you don't also have to edit the list.",
      fields: [{ key: "classes", label: "On these lists", kind: "multiselect", wide: true, options: (ctx) => ctx.spellLists }]
    }
  ]
};

/* --------------------------------------------------------------- spell list ----- */

const SPELL_LIST_SCHEMA: HomebrewSchema = {
  type: "spell-list",
  sections: [
    basicsSection("spell list"),
    {
      id: "contents",
      title: "Contents",
      // The division of labour, stated once.
      blurb: "Homebrew spells can just name this list in their own Spell lists field. Use this to pull in SRD spells too.",
      fields: [
        { key: "basedOn", label: "Start from these lists", kind: "multiselect", wide: true, options: (ctx) => ctx.spellLists },
        { key: "contents", label: "Spells", kind: "custom", custom: "spellListContents", wide: true }
      ]
    }
  ]
};

/* ---------------------------------------------------------------- equipment ----- */

/**
 * `EquipmentReferenceSchema` is the ONE `.strict()` content schema, so every key offered
 * here has to exist there: strict does not ignore an undeclared field, it rejects the
 * whole record. `summary` and `attribution` are absent for exactly that reason.
 *
 * ## The Magic section
 *
 * An item and a feature carry the SAME riders — the server spells that vocabulary once
 * (`featureRiders`) and so does `RiderEditor`, which both mount. What an item adds on top
 * is five fields the vocabulary has no home for: where it is worn (`slot`), whether it is
 * magical at all, whether it needs attunement, what spell it casts, and which feat it
 * hands over. Everything else — modifiers, charges, actions, effects, grants — is the
 * shared sub-form with `scope: "item"` and a `labels` relabel, and there is no second
 * component. See the table at the top of `RiderEditor.tsx`.
 *
 * **Nothing below writes a key until the GM turns "This item is magical" on**, which is
 * what keeps an ordinary longsword saving cleanly whatever state the item vocabulary is
 * in on the server: turning it off deletes the whole magic half rather than leaving
 * `isMagic: false` behind for `.strict()` to reject.
 */

/** The mechanical hook, and the one closed enum in the file. `category` stays the OPEN
    identity slug ("relic", "trinket"); `slot` is what the engine exhaustively switches
    on, which is what makes an open category safe rather than inert. */
const SLOTS = [
  opt("weapon", "A weapon", "Held"),
  opt("shield", "A shield", "Held"),
  opt("held", "Held — a wand, orb, rod or staff", "Held"),
  opt("armor", "Body armour", "Worn"),
  opt("head", "On the head — a circlet or helm", "Worn"),
  opt("neck", "Around the neck — an amulet", "Worn"),
  opt("shoulders", "Over the shoulders — a cloak", "Worn"),
  opt("hands", "On the hands — gloves", "Worn"),
  opt("ring", "A ring", "Worn"),
  opt("belt", "At the belt", "Worn"),
  opt("feet", "On the feet — boots", "Worn"),
  opt("wondrous", "Wondrous — attunable, worn nowhere", "Everything else"),
  opt("consumable", "Used up — a potion or scroll", "Everything else"),
  opt("ammunition", "Ammunition", "Everything else"),
  opt("none", "Just carried", "Everything else")
];

/** Turning magic off must take the whole magic half with it. Left behind, `isMagic: false`
    plus an orphan rider is a record `.strict()` rejects and a GM cannot see to fix. */
const MAGIC_KEYS = ["isMagic", "rarity", "attunement", "cursed", "casts", "grantsFeatIds", "modifiers", "grants", "uses", "actions", "effects", "tags"];

const EQUIPMENT_SCHEMA: HomebrewSchema = {
  type: "equipment",
  sections: [
    {
      ...basicsSection("item", { description: true }),
      fields: [
        ...basicsSection("item", { description: true }).fields,
        {
          key: "category",
          label: "Category",
          required: true,
          suggestions: (ctx) => ctx.equipmentCategories.map((option) => option.value),
          // An OPEN slug, never a closed enum: homebrew declares "relic" or "trinket"
          // with no schema change. `slot` beside it is what drives the mechanics, so a
          // category is now free to be nothing but a browse facet.
          help: "Your own word for it — “relic”, “trinket”. What it DOES is the field beside this one."
        },
        {
          key: "slot",
          label: "Worn or held as",
          kind: "select",
          options: SLOTS,
          help: "This is what makes it derive armour class or an attack. Leave it unset and the category is used instead."
        },
        { key: "costGp", label: "Cost", kind: "number", min: 0, max: 1000000, unit: "gp", allowDecimal: true, emptyValue: "null" },
        { key: "weightLb", label: "Weight", kind: "number", min: 0, max: 1000, unit: "lb", allowDecimal: true, emptyValue: "null" }
      ]
    },
    {
      id: "magic",
      title: "Magic",
      fields: [
        {
          key: "isMagic",
          label: "This item is magical",
          kind: "switch",
          help: "Everything below is off until this is on.",
          write: (next, draft) => {
            if (next === true) return { ...draft, isMagic: true };
            const cleared: Record<string, unknown> = { ...draft };
            for (const key of MAGIC_KEYS) delete cleared[key];
            return cleared;
          }
        },
        // An OPEN slug in the schema, so a CLOSED select was the inverse of the usual bug: the six
        // printed rarities and no way to write "unique". Complete list plus other, like every other
        // open-slug field in the editor.
        //
        // `pick` is the second half of that repair and the client's own `3a`. Offering the list was
        // never the problem — READING it was: `kind: "text"` + `suggestions` is an `<input list>`,
        // which has no visible affordance on any browser and renders as NOTHING on iOS Safari, so a
        // complete vocabulary shipped as a bare box. Still text, still open, still takes "unique";
        // the list is simply on screen now. See `FieldDef.pick`.
        { key: "rarity", label: "Rarity", pick: true, suggestions: RARITY_IDS, placeholder: "uncommon", emptyValue: "omit", visibleWhen: (draft) => draft.isMagic === true },
        {
          key: "attunement.required",
          label: "Requires attunement",
          kind: "switch",
          help: "A character can attune to three items at once.",
          visibleWhen: (draft) => draft.isMagic === true
        },
        {
          key: "attunement.restrictedTo",
          label: "Only by",
          kind: "tags",
          placeholder: "cleric",
          help: "A class or species. It's shown on the sheet, never enforced — handing a player a restricted item on purpose is a normal table event.",
          visibleWhen: (draft) => draft.isMagic === true && getAt(draft, "attunement.required") === true
        },
        {
          key: "cursed",
          label: "Cursed",
          kind: "switch",
          // Stated where it is decided, not in a manual: this is the whole of what the
          // flag does, and the attunement precondition is why it is only offered here.
          help: "Players can't unattune, unequip or drop it — only you can. Its magic stays hidden from them until they attune.",
          visibleWhen: (draft) => draft.isMagic === true && getAt(draft, "attunement.required") === true
        },
        {
          key: "casts",
          label: "Spells it casts",
          kind: "rows",
          wide: true,
          visibleWhen: (draft) => draft.isMagic === true,
          addLabel: "Add a spell",
          emptyText: "It casts nothing.",
          maxRows: 8,
          maxRowsReason: "Eight spells is as many as one item carries.",
          rowKey: (row, index) => String((row as { rowId?: string }).rowId ?? index),
          newRow: () => ({ rowId: newId(), spellId: "", consumesSpellSlot: false }),
          rowLabel: (row) => {
            const cast = row as Record<string, unknown>;
            const limit = getAt(cast, "uses.limit");
            const name = typeof cast.spellId === "string" && cast.spellId ? humanise(cast.spellId) : "No spell chosen";
            return typeof limit === "number" ? `${name} — ${limit} a ${String(getAt(cast, "uses.per") ?? "long-rest").replace(/-/g, " ")}` : name;
          },
          rows: [
            { key: "spellId", label: "Spell", kind: "select", searchable: true, catalog: "spells", placeholder: "Choose a spell" },
            { key: "atLevel", label: "Cast at level", kind: "stepper", min: 0, max: 9, help: "Leave at the spell's own level for a scroll." },
            { key: "ability", label: "Uses", kind: "select", options: ABILITIES, help: "Leave empty to use the wielder's own." },
            { key: "saveDc", label: "Save DC", kind: "number", min: 1, max: 40, help: "The item's own DC, not the character's." },
            {
              key: "uses.limit",
              label: "Times",
              kind: "number",
              min: 1,
              max: 20,
              // `per` is required on the stored shape, so a count with no recovery is an
              // unpublishable record. Seeded here, still editable in the field below.
              write: (next, row) => {
                const uses = { ...(row.uses as Record<string, unknown> | undefined) };
                if (next === null || next === undefined) return { ...row, uses: undefined };
                uses.limit = next;
                uses.per ??= "long-rest";
                return { ...row, uses };
              }
            },
            { key: "uses.per", label: "Comes back", kind: "select", options: [opt("encounter", "Every encounter"), opt("short-rest", "On a short rest"), opt("long-rest", "On a long rest")], help: "A long rest is this table's day, so “once per day” is “on a long rest”." },
            { key: "uses.pool", label: "Shared pool", placeholder: "wand-charges", help: "Spells sharing a pool share one set of charges." },
            { key: "consumesSpellSlot", label: "Spends the caster's own slot", kind: "switch" }
          ]
        },
        {
          key: "grantsFeatIds",
          label: "Feats it grants",
          kind: "multiselect",
          wide: true,
          max: 4,
          maxRowsReason: "Four feats is as many as one item grants.",
          options: (ctx) => ctx.feats,
          help: "The feat's own modifiers come with it, and they come back off when the item does.",
          visibleWhen: (draft) => draft.isMagic === true
        },
        { key: "riders", label: "What it does", kind: "custom", custom: "riders", wide: true, visibleWhen: (draft) => draft.isMagic === true }
      ]
    },
    {
      id: "weapon",
      title: "Weapon",
      // The RANGE fields say what leaving them empty means, because that is the sentence the old
      // failure never got to say: a mace has no range, its two range keys are null, and the record
      // publishes. The GM used to be told "Fill in range." and then "Fill in long range." — one at
      // a time, on a melee weapon, with no way to comply.
      blurb: "Fill these in only for a weapon. The category has to be “weapon” too, or nothing here is read.",
      fields: inContainer("weapon", SUB_OBJECT_DEFAULTS.equipment!.weapon, [
        { key: "weapon.category", label: "Weapon kind", kind: "select", options: [opt("simple", "Simple"), opt("martial", "Martial")] },
        { key: "weapon.damageDice", label: "Damage", placeholder: "1d8", validate: diceValidate },
        // `3d`, site 2 of 9 — and the one the client's own mace goes through.
        { key: "weapon.damageType", label: "Damage type", pick: true, placeholder: "slashing", suggestions: (ctx) => ctx.damageTypes },
        { key: "weapon.rangeFeet", label: "Range", kind: "number", min: 1, max: 1000, unit: "ft", emptyValue: "null", help: "Leave both empty for a melee weapon." },
        { key: "weapon.longRangeFeet", label: "Long range", kind: "number", min: 1, max: 5000, unit: "ft", emptyValue: "null" }
      ])
    },
    {
      id: "armor",
      title: "Armour",
      blurb: "Fill these in only for armour or a shield.",
      fields: inContainer("armor", SUB_OBJECT_DEFAULTS.equipment!.armor, [
        { key: "armor.acBase", label: "Base armour class", kind: "number", min: 2, max: 25 },
        { key: "armor.addDexModifier", label: "Adds Dexterity", kind: "switch" },
        { key: "armor.dexModifierCap", label: "Dexterity cap", kind: "number", min: 0, max: 10, emptyValue: "null" },
        { key: "armor.strengthRequired", label: "Strength minimum", kind: "number", min: 0, max: 20, emptyValue: "null" },
        { key: "armor.stealthDisadvantage", label: "Disadvantage on Stealth", kind: "switch" }
      ])
    }
  ]
};

/* ------------------------------------------------------------------ monster ----- */

/**
 * A homebrew creature IS an `ActorDefinition` — the same stat block the bestiary and the
 * table already resolve — not a bespoke content record. So the fields here are that
 * schema's, exactly: `abilityScores` (not `abilities`), a single `speedFeet` (not a
 * speeds group), and no top-level `type` / `alignment` / `challengeRating`.
 *
 * Challenge rating and creature type live in the `open5e.srd-2024` extension bag, which
 * is where `content-library.ts` reads them from. That key contains a dot, so it cannot be
 * a dot path — hence the `read`/`write` pair. `schemaId`, `schemaVersion` and `source`
 * are forced by `defaults.ts` and never shown: they are the system's problem.
 */
const STATBLOCK_EXT = "open5e.srd-2024";
const extensionField = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  ...extra,
  read: (scope) => ((scope.extensions as Record<string, Record<string, unknown>> | undefined)?.[STATBLOCK_EXT] ?? {})[key],
  write: (next, scope) => {
    const extensions = { ...((scope.extensions as Record<string, unknown>) ?? {}) };
    extensions[STATBLOCK_EXT] = { ...((extensions[STATBLOCK_EXT] as Record<string, unknown>) ?? {}), [key]: next };
    return { ...scope, extensions };
  }
});

const MONSTER_SCHEMA: HomebrewSchema = {
  type: "monster",
  sections: [
    {
      ...basicsSection("creature", { summary: true }),
      id: "identity",
      title: "Identity",
      fields: [
        ...basicsSection("creature", { summary: true }).fields,
        { key: "size", label: "Size", kind: "select", required: true, options: SIZES },
        extensionField("type", "Creature type", { placeholder: "humanoid", suggestions: (ctx) => ctx.creatureTypes }),
        extensionField("challengeRating", "Challenge rating", { kind: "number", required: true, min: 0, max: 30, allowDecimal: true }),
        { key: "speedFeet", label: "Speed", kind: "number", required: true, min: 0, max: 200, unit: "ft" }
      ]
    },
    {
      id: "defences",
      title: "Defences",
      fields: [
        { key: "armorClass", label: "Armour class", kind: "number", required: true, min: 1, max: 40 },
        { key: "hitPoints.maximum", label: "Hit points", kind: "number", required: true, min: 1, max: 1000 },
        { key: "hitPoints.formula", label: "Hit dice", placeholder: "19d12 + 133", validate: diceValidate, help: "Like 19d12 + 133. Without it, short rests give this monster no hit dice." },
        { key: "proficiencyBonus", label: "Proficiency bonus", kind: "number", min: 0, max: 12 },
        { key: "initiativeBonus", label: "Initiative bonus", kind: "number", min: -20, max: 30, allowNegative: true },
        // `3d`, sites 3–5 of 9. Typing "Fire" or "flame" into any of these used to store a value the
        // typed-defence pass never matches — silently, at play time, on the one field a monster's
        // whole defensive identity hangs on.
        { key: "damageResistances", label: "Damage resistances", kind: "tags", pick: true, suggestions: (ctx) => ctx.damageTypes },
        { key: "damageImmunities", label: "Damage immunities", kind: "tags", pick: true, suggestions: (ctx) => ctx.damageTypes },
        { key: "damageVulnerabilities", label: "Damage vulnerabilities", kind: "tags", pick: true, suggestions: (ctx) => ctx.damageTypes },
        // NOT `pick` — deliberately, and it is the one visible seam this unit leaves. `3d` is the
        // damage-type vocabulary; conditions are their own row with their own both-paths test, and
        // turning the flag on here would ship a control this unit does not prove. One line, whenever
        // that unit runs.
        { key: "conditionImmunities", label: "Condition immunities", kind: "tags", suggestions: (ctx) => ctx.conditions }
      ]
    },
    {
      id: "abilities",
      title: "Ability scores",
      fields: ABILITIES.map((ability) => ({
        key: `abilityScores.${ability.value}`,
        label: ability.label,
        kind: "number" as const,
        required: true,
        min: 1,
        max: 30
      }))
    },
    {
      id: "actions",
      title: "Actions",
      // Reuses the SAME rider vocabulary a feature's actions use, because it is the same
      // `ActionSchema`. The monster-only keys (multiattack, onHit, targetRules, reaction,
      // legendary) are not offered yet — a form that produced them without a composer
      // constrained to sibling action ids would author references that resolve to nothing.
      fields: [{ key: "riders", label: "Actions", kind: "custom", custom: "riders", wide: true }]
    },
    {
      id: "token",
      title: "On the table",
      advanced: true,
      fields: [
        { key: "token.disposition", label: "Disposition", kind: "select", options: [opt("hostile", "Hostile"), opt("neutral", "Neutral"), opt("friendly", "Friendly")] },
        { key: "token.footprint.width", label: "Token width", kind: "stepper", min: 1, max: 4, unit: "squares" },
        { key: "token.footprint.height", label: "Token height", kind: "stepper", min: 1, max: 4, unit: "squares" },
        { key: "legendary.actionsPerRound", label: "Legendary actions per round", kind: "number", min: 1, max: 5 },
        { key: "legendary.resistancesPerDay", label: "Legendary resistances per day", kind: "number", min: 1, max: 6 }
      ]
    }
  ]
};

export const SCHEMAS: Readonly<Record<HomebrewType, HomebrewSchema>> = {
  class: CLASS_SCHEMA,
  subclass: SUBCLASS_SCHEMA,
  species: SPECIES_SCHEMA,
  background: BACKGROUND_SCHEMA,
  feat: FEAT_SCHEMA,
  spell: SPELL_SCHEMA,
  "spell-list": SPELL_LIST_SCHEMA,
  equipment: EQUIPMENT_SCHEMA,
  monster: MONSTER_SCHEMA
};

/** Section titles, for `publishBlockedReason`'s `{Section}` jump control. */
export function sectionTitle(type: HomebrewType, sectionId: string): string | null {
  return SCHEMAS[type]?.sections.find((section: SectionDef) => section.id === sectionId)?.title ?? null;
}

/**
 * Which field owns a validity issue's `path`, so a server message can be rewritten into
 * the one copy template instead of surfacing as a bare "Required".
 *
 * Matches the longest dotted prefix, so `["range","distance"]` finds `range.distance`
 * when the schema has it and falls back to the `range` group when it does not.
 */
export function fieldAt(
  type: HomebrewType,
  path: ReadonlyArray<string | number>
): Readonly<{ label: string; sectionId: string; sectionTitle: string }> | null {
  const schema = SCHEMAS[type];
  if (!schema) return null;
  const dotted = path.filter((segment) => typeof segment === "string").join(".");
  if (!dotted) return null;

  let best: Readonly<{ label: string; sectionId: string; sectionTitle: string }> | null = null;
  let bestLength = 0;
  for (const section of schema.sections) {
    const walk = (fields: readonly FieldDef[]) => {
      for (const field of fields) {
        if (field.key && (dotted === field.key || dotted.startsWith(`${field.key}.`)) && field.key.length > bestLength) {
          bestLength = field.key.length;
          best = { label: field.label.toLowerCase(), sectionId: section.id, sectionTitle: section.title };
        }
        if (field.rows && field.kind === "group") walk(field.rows);
      }
    };
    walk(section.fields);
  }
  return best;
}

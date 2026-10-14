/**
 * A feature editor (name, grant levels, choices, riders), used by class, subclass, species,
 * background and feat.
 *
 * "Granted at levels" writes `feature.level` and every `levelTable[].features[]` row in one edit.
 * The server computes a choice's capacity as `choose × grants` (rows naming the feature), so the
 * two halves are never authored separately. One selected level writes `level: N`; several omit
 * `level` and rely on the rows.
 *
 * A class feature is always granted at one level or more: new features are minted at
 * `DEFAULT_GRANT_LEVEL` with their row written in the same edit, and the last selected chip cannot
 * be cleared. A choice-bearing feature granted nowhere would make the character uncreatable.
 *
 * A subclass has no level table, so its chips are single-select (`feature.level` only).
 *
 * Controls are declared as `FieldDef`s (`featureFields()`) so the authoring harness can drive them.
 * Three stay bespoke because a `FieldDef` cannot express them; see `featureFields()`.
 */

import { useId, useMemo, useState } from "react";
import { featurePicks, NAMED_PICK_BUDGET_KEYS } from "@vtt/content-srd-5.2.1/schemas";
import { Button, Chip, Field, FieldGrid, RowEditor, SegmentedControl, Select } from "@vtt/ui";
import { newId } from "../lib/ids";
import { FieldRenderer } from "./FieldRenderer";
import { RiderEditor, riderSummary, slugValidate, type RiderKind } from "./RiderEditor";
import { LEVELS, blankFeature } from "./defaults";
import { getAt, setAt } from "./paths";
import { namesOwnRecord } from "./schema";
import type { Draft, FieldDef, SchemaContext } from "./schema";

type Feature = Readonly<{
  id: string;
  name?: string;
  level?: number;
  description?: string;
  choice?: Readonly<Record<string, unknown>>;
}> &
  Draft;

/** Reserved choice kinds, offered as suggestions: `FeatureChoiceSchema.kind` is an open slug. */
const CHOICE_KINDS = [
  "feat", "fighting-style", "asi-or-feat", "subclass", "lineage", "spell", "cantrip",
  "skill", "tool", "language", "skill-or-tool", "expertise", "ability-score", "weapon-mastery"
];

/** How a choice states its list. Held in React state, not the draft; see `featureFields`. */
type SourceMode = "catalog" | "list" | "options" | "picks";

type CatalogFamily = "" | "subclasses" | "feats" | "spells" | "lineages" | "skills" | "weapons";

const FAMILY_OPTIONS: ReadonlyArray<{ value: CatalogFamily; label: string }> = [
  { value: "", label: "Not set" },
  { value: "subclasses", label: "A class's subclasses" },
  { value: "feats", label: "Feats of a category" },
  { value: "spells", label: "Spells on a list" },
  { value: "lineages", label: "A species' lineages" },
  { value: "skills", label: "Every skill" },
  { value: "weapons", label: "Every weapon" }
];

const parseCatalog = (slug: string): { family: CatalogFamily; which: string } => {
  if (slug === "skills") return { family: "skills", which: "" };
  if (slug === "weapons") return { family: "weapons", which: "" };
  for (const family of ["subclasses", "feats", "spells", "lineages"] as const) {
    const suffix = `-${family}`;
    if (slug.endsWith(suffix)) return { family, which: slug.slice(0, -suffix.length) };
  }
  return { family: "", which: "" };
};

const composeCatalog = (family: CatalogFamily, which: string): string | undefined => {
  if (family === "skills" || family === "weapons") return family;
  if (!family || !which) return undefined;
  return `${which}-${family}`;
};

/** Where a new class feature lands: level 1, predictable and one tap from any other level. */
const DEFAULT_GRANT_LEVEL = 1;

/* -------------------------------------------------------- the field schema ------ */

/** The seed for a new choice, shared by every write that mints one so they produce one shape. */
const NEW_CHOICE: Readonly<Record<string, unknown>> = { kind: "feat", choose: 1, repeatable: false };

/** `FeatureChoiceSchema.kind` is a `ContentIdSchema` slug: lowercase, other runs become one hyphen. */
const asChoiceSlug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9-]+/g, "-");

/** One choice block — one pick the feature asks for, however the record spells it. */
type ChoiceBlock = Readonly<Record<string, unknown>>;

/** Every pick this feature asks for, via the server's own `featurePicks` accessor. */
const choiceBlocksOf = (feature: Draft): readonly ChoiceBlock[] =>
  featurePicks(feature as { choice?: ChoiceBlock; choices?: ChoiceBlock[] });

/** Writes the choice list with its spelling derived from the count: `choice` for one pick,
    `choices` for several. `FeatureRecordSchema` refuses a record carrying both. */
function writeChoiceBlocks(feature: Draft, blocks: readonly ChoiceBlock[]): Draft {
  const next: Record<string, unknown> = { ...feature };
  delete next.choice;
  delete next.choices;
  if (blocks.length === 1) next.choice = blocks[0];
  else if (blocks.length > 1) next.choices = [...blocks];
  return next;
}

/** Merges changes into one block, seeding the list if empty so the shape matches what the switch mints. */
function writeChoiceAt(feature: Draft, index: number, changes: Readonly<Record<string, unknown>>): Draft {
  const held = choiceBlocksOf(feature);
  const blocks: ChoiceBlock[] = held.length === 0 ? [{ ...NEW_CHOICE }] : [...held];
  const merged: Record<string, unknown> = { ...(blocks[index] ?? { ...NEW_CHOICE }) };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  blocks[index] = merged;
  return writeChoiceBlocks(feature, blocks);
}

/** Whether the feature asks a choice, under either spelling. */
const asksAChoice = (feature: Draft) => choiceBlocksOf(feature).length > 0;

/** Validates a pick budget key (`PickBudgetKeySchema`), which allows a `feature:<id>` form. */
const offerValidate = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "" || /^[a-z0-9-]+(:[a-z0-9-]+)?$/.test(text)) return null;
  return "Write it as an offer key — lowercase-with-dashes, or feature:<a-feature-id>.";
};

/**
 * `fromPicks`: the options are the character's own earlier answers (e.g. "one of your known Warlock
 * cantrips that deals damage"). `offer` names the budget; `where` is a closed predicate (ADR-0008).
 * The reader tests `fromPicks` before `from`/`fromCatalog`/`options` and silently ignores the others,
 * so every write here deletes them, and their writes clear `fromPicks` in return.
 */
const writeFromPicks = (block: Draft, leaf: "offer" | "where", next: unknown): Draft => {
  const held = block.fromPicks && typeof block.fromPicks === "object" && !Array.isArray(block.fromPicks)
    ? (block.fromPicks as Record<string, unknown>)
    : {};
  const text = typeof next === "string" ? next.trim() : "";
  const merged: Record<string, unknown> = { ...held };
  if (text) merged[leaf] = text;
  else delete merged[leaf];
  const out: Record<string, unknown> = { ...block };
  delete out.from;
  delete out.fromCatalog;
  delete out.options;
  if (Object.keys(merged).length === 0) delete out.fromPicks;
  else out.fromPicks = merged;
  return out;
};

/** Drop `fromPicks` when another source is written (the reverse of `writeFromPicks`). */
const withoutPicks = (block: Draft, changes: Readonly<Record<string, unknown>>): Draft => {
  const out: Record<string, unknown> = { ...block, ...changes };
  delete out.fromPicks;
  return out;
};

/** Every feature this record declares, whichever key its type stores them under. */
const featuresOf = (draft: Draft): readonly Draft[] => [
  ...(Array.isArray(draft.features) ? (draft.features as Draft[]) : []),
  ...(Array.isArray(draft.traits) ? (draft.traits as Draft[]) : []),
  ...(draft.feature && typeof draft.feature === "object" && !Array.isArray(draft.feature) ? [draft.feature as Draft] : [])
];

/** Every feature id this record declares — the targets a `feature:<id>` offer may name. */
const featureIdsOf = (draft: Draft): readonly string[] =>
  featuresOf(draft).map((feature) => String((feature as { id?: unknown })?.id ?? "")).filter(Boolean);

/** Every answer any pick on this record could hold: the id half of a `requires` clause. SRD gates
    name a sibling feature's option, so the record already declares the ids. */
const optionIdsOf = (draft: Draft): readonly string[] => {
  const ids = new Set<string>();
  for (const feature of featuresOf(draft)) {
    for (const block of choiceBlocksOf(feature)) {
      for (const option of Array.isArray(block.options) ? (block.options as Draft[]) : []) {
        const id = String((option as { id?: unknown })?.id ?? "");
        if (id) ids.add(id);
      }
      for (const id of Array.isArray(block.from) ? (block.from as unknown[]) : []) {
        if (typeof id === "string" && id) ids.add(id);
      }
    }
  }
  return [...ids];
};

/**
 * `requires` on an inline option: the option is legal only when an earlier answer matches (e.g.
 * Improved Blessed Strikes). When gating leaves exactly as many options as the capacity, they are
 * adopted without showing a pick. Both boxes stay open: `offer` shares the `extraPicks`/`replaces`
 * namespace, and `id` may name an option not authored yet.
 */
function requiresField(): FieldDef {
  const write = (leaf: "offer" | "id") => (next: unknown, option: Draft): Draft => {
    const held = option.requires && typeof option.requires === "object" && !Array.isArray(option.requires)
      ? (option.requires as Record<string, unknown>)
      : {};
    const text = typeof next === "string" ? next.trim() : "";
    const merged: Record<string, unknown> = { ...held };
    if (text) merged[leaf] = text;
    else delete merged[leaf];
    const out: Record<string, unknown> = { ...option };
    // An emptied pair removes the clause; a leftover `{}` would fail publish.
    if (Object.keys(merged).length === 0) delete out.requires;
    else out.requires = merged;
    return out;
  };
  return {
    key: "requires",
    label: "Only when an earlier pick chose",
    kind: "group",
    help: "Leave both empty to offer this option to everyone. When the gates leave exactly as many options as the choice takes, the player is asked nothing and the survivor is simply granted.",
    rows: [
      {
        key: "requires.offer",
        label: "Which pick",
        pick: true,
        placeholder: "feature:my-feature",
        help: "A named budget, or feature:<id> for one of this record's own features.",
        suggestions: (_ctx, draft) => [...NAMED_PICK_BUDGET_KEYS, ...featureIdsOf(draft).map((id) => `feature:${id}`)],
        validate: offerValidate,
        write: write("offer")
      },
      {
        key: "requires.id",
        label: "Which answer",
        pick: true,
        placeholder: "divine-strike",
        help: "The option they must have chosen there.",
        suggestions: (_ctx, draft) => optionIdsOf(draft),
        validate: slugValidate,
        write: write("id")
      }
    ]
  };
}

/** Display name for a feature id; an unnamed feature shows its id. */
const featureLabelOf = (draft: Draft, id: string): string => {
  const named = featuresOf(draft).find((feature) => (feature as { id?: unknown }).id === id);
  return String((named as { name?: unknown } | undefined)?.name || id);
};

/**
 * `extraPicks`: raises a pick budget instead of granting an outcome (e.g.
 * `{offer: "class-cantrips", amount: 1}`). The offer box is open text suggesting the named budgets
 * (`NAMED_PICK_BUDGET_KEYS`) plus `feature:<id>` for each feature on the record. `amount` and
 * `scaling` are mutually exclusive, swapped by the mode select. The column id is seeded empty, since
 * a guessed id would silently point at another class's column. Mounted on features and inline options.
 */
function extraPicksField(): FieldDef {
  return {
    key: "extraPicks",
    label: "Extra picks",
    kind: "rows",
    wide: true,
    help: "Budgets this raises — an extra cantrip, one more skill. The player still makes the pick.",
    addLabel: "Add an extra pick",
    emptyText: "Raises no budgets.",
    maxRows: 4,
    maxRowsReason: "Four extra picks is as many as one feature may grant.",
    rowKey: (row, index) => String((row as { rowId?: string }).rowId ?? index),
    newRow: () => ({ rowId: newId(), offer: "", amount: 1 }),
    rowLabel: (row) => {
      const grant = row as { offer?: unknown; amount?: unknown; scaling?: { id?: unknown } };
      const offer = String(grant.offer || "no pick named");
      return grant.scaling ? `${offer} — grows with ${String(grant.scaling.id || "a column")}` : `${offer} +${Number(grant.amount ?? 1)}`;
    },
    rows: [
      {
        key: "offer",
        label: "Which pick",
        pick: true,
        placeholder: "class-cantrips",
        help: "A named budget, or feature:<id> for one of this record's own features.",
        suggestions: (_ctx, draft) => [...NAMED_PICK_BUDGET_KEYS, ...featureIdsOf(draft).map((id) => `feature:${id}`)],
        validate: offerValidate
      },
      {
        key: "mode",
        label: "The extra is",
        kind: "select",
        // `mode` is derived from the shape; the stored discriminator is `scaling.type`.
        options: [
          { value: "flat", label: "A flat number" },
          { value: "column-growth", label: "As a class-table column grows" }
        ],
        read: (row) => ((row as { scaling?: unknown }).scaling ? "column-growth" : "flat"),
        write: (next, row) => {
          const out: Record<string, unknown> = { ...row };
          if (next === "column-growth") {
            delete out.amount;
            out.scaling = { type: "class-resource-growth", id: "" };
          } else {
            delete out.scaling;
            out.amount ??= 1;
          }
          return out;
        }
      },
      {
        key: "amount",
        label: "How many more",
        kind: "number",
        min: 1,
        max: 5,
        visibleWhen: (row) => !(row as { scaling?: unknown }).scaling
      },
      {
        key: "scaling.id",
        label: "Which column",
        placeholder: "eldritch-invocations",
        help: "The class-table column it grows with. The grant adds how far the column has grown past its first printed value.",
        validate: slugValidate,
        visibleWhen: (row) => Boolean((row as { scaling?: unknown }).scaling)
      }
    ]
  };
}

/** `replaces`: a pick budget whose answer may be re-made later (on level-up, or after a short or
    long rest via `actor.rechoose`). Same open offer box as `extraPicks`, since the server validates
    both against one namespace. */
function replacesField(): FieldDef {
  return {
    key: "replaces",
    label: "Picks it re-opens",
    kind: "rows",
    wide: true,
    help: "Answers the player may take back later — a land type on a long rest, a damage type on a short one.",
    addLabel: "Add a re-openable pick",
    emptyText: "Re-opens nothing.",
    maxRows: 4,
    maxRowsReason: "Four re-openable picks is as many as one feature may declare.",
    rowKey: (row, index) => String((row as { rowId?: string }).rowId ?? index),
    // `offer` is seeded empty: a guessed budget would silently target another pick.
    newRow: () => ({ rowId: newId(), offer: "", when: "long-rest", amount: 1 }),
    rowLabel: (row) => {
      const clause = row as { offer?: unknown; when?: unknown; amount?: unknown };
      const amount = Number(clause.amount ?? 1);
      const each = amount > 1 ? `${amount} at a time` : "one";
      return `${String(clause.offer || "no pick named")} — ${each}, ${WHEN_LABELS[String(clause.when ?? "")] ?? "when?"}`;
    },
    rows: [
      {
        key: "offer",
        label: "Which pick",
        pick: true,
        placeholder: "feature:my-feature",
        help: "A named budget, or feature:<id> for one of this record's own features — usually this one.",
        suggestions: (_ctx, draft) => [...NAMED_PICK_BUDGET_KEYS, ...featureIdsOf(draft).map((id) => `feature:${id}`)],
        validate: offerValidate
      },
      {
        key: "when",
        label: "Re-made",
        kind: "select",
        options: [
          { value: "level-up", label: "At level-up" },
          { value: "short-rest", label: "On a short rest" },
          { value: "long-rest", label: "On a long rest" }
        ]
      },
      { key: "amount", label: "How many at once", kind: "number", min: 1, max: 5 }
    ]
  };
}

const WHEN_LABELS: Readonly<Record<string, string>> = {
  "level-up": "at level-up",
  "short-rest": "on a short rest",
  "long-rest": "on a long rest"
};

/** `replacesFeatureId`: this feature supersedes an earlier one (Extra Attack (2)), so the sheet shows
    one line. Class only: `grantedClassFeatures` reads it from the class level table, and on subclass
    features it is inert. */
const replacesFeatureIdField = (): FieldDef => ({
  key: "replacesFeatureId",
  label: "Supersedes",
  kind: "select",
  help: "An earlier feature this one takes the place of. The class stops granting it once this arrives.",
  // Only a class has a level table, and only a class's own features are read for this.
  visibleWhen: (_feature, draft) => Array.isArray(draft.levelTable),
  options: (_ctx, draft) => [
    { value: "", label: "Nothing — this is a feature of its own" },
    ...featureIdsOf(draft).map((id) => ({ value: id, label: featureLabelOf(draft, id) }))
  ],
  // `options` receives the record, not the row, so self-reference is caught here instead.
  validate: (value, feature) => (value && value === feature.id ? "A feature cannot supersede itself — pick the earlier one it replaces." : null)
});

/** The spell window applies to these kinds, or to any block already holding a bound (kind is open). */
const showsSpellWindow = (block: Draft): boolean =>
  block.kind === "spell" || block.kind === "cantrip"
  || block.maxSpellLevel !== undefined || block.minSpellLevel !== undefined;

/** The controls of one choice block, keys relative to the block. */
function choiceBlockFields(): readonly FieldDef[] {
  return [
    {
      key: "kind",
      label: "What kind of choice",
      help: "Type your own if none of these fit.",
      // Open slug with the reserved kinds as visible suggestions; homebrew may invent a kind.
      pick: true,
      suggestions: CHOICE_KINDS,
      write: (next, block) => ({ ...block, kind: asChoiceSlug(String(next ?? "")) })
    },
    { key: "choose", label: "How many they pick", kind: "stepper", min: 1, max: 10 },
    /** Spell window: a ceiling, a floor, or both. A ceiling alone means "or lower", so a single-level
        pick (an arcanum) sets both. Bounds compare against a catalog option's spell level; a
        hand-typed `from` list has none (it counts as 0). */
    {
      key: "maxSpellLevel",
      label: "Highest spell level",
      kind: "number",
      min: 0,
      max: 9,
      help: "0 is cantrips only. Compared against the catalog's own spell levels — a list typed by hand has none.",
      visibleWhen: showsSpellWindow
    },
    {
      key: "minSpellLevel",
      label: "Lowest spell level",
      kind: "number",
      min: 0,
      max: 9,
      help: "Set both to the same number for “exactly a level 6 spell”.",
      visibleWhen: showsSpellWindow
    },
    /** Maximum score an ability-score pick from this block may reach (epic boons). Distinct from the
        `ability-score` modifier's `maximum`, which raises a named ability. `character-build.ts` clamps
        at `offer.maximum ?? 20`. */
    {
      key: "maximum",
      label: "Raises a score to at most",
      kind: "number",
      min: 1,
      max: 30,
      help: "Leave empty to keep the usual 20. The epic boons print 30.",
      visibleWhen: (block) => block.kind === "ability-score" || block.maximum !== undefined
    },
    {
      /* Comma-separated slugs; `read` joins and `write` splits into the stored array. */
      key: "from",
      label: "Which options",
      help: "Type slugs, separated by commas.",
      placeholder: "athletics, perception",
      read: (block) => {
        const from = block.from;
        return (Array.isArray(from) ? from : []).map(String).join(", ");
      },
      write: (next, block) => withoutPicks(block, {
        from: String(next ?? "")
          .split(",")
          .map((entry) => asChoiceSlug(entry.trim()))
          .filter(Boolean)
      })
    },
    {
      /** `fromPicks` as one group, since budget and predicate form one clause. See `writeFromPicks`. */
      key: "fromPicks",
      label: "Which earlier pick",
      kind: "group",
      help: "The player picks from answers they already gave. Nothing eligible chosen yet defers the pick rather than showing an empty list.",
      visibleWhen: (block) => Boolean(block.fromPicks),
      rows: [
        {
          key: "fromPicks.offer",
          label: "Answers to",
          pick: true,
          placeholder: "class-cantrips",
          // Same open namespace as `extraPicks` and `replaces`.
          help: "A named budget, or feature:<id> for one of this record's own features.",
          suggestions: (_ctx, draft) => [...NAMED_PICK_BUDGET_KEYS, ...featureIdsOf(draft).map((id) => `feature:${id}`)],
          validate: offerValidate,
          write: (next, block) => writeFromPicks(block, "offer", next)
        },
        {
          key: "fromPicks.where",
          label: "Narrowed to",
          kind: "select",
          // Closed: a three-value schema enum the resolver reads by name.
          options: [
            { value: "deals-damage", label: "Ones that deal damage" },
            { value: "attack-roll", label: "Ones that need an attack roll" },
            { value: "ranged", label: "Ones with a range of 10 ft or more" }
          ],
          help: "Leave unset to offer every answer to that pick. All three read the spell catalog, so they narrow spell picks only.",
          write: (next, block) => writeFromPicks(block, "where", next)
        }
      ]
    },
    {
      /** Inline options. The `RowEditor` is rendered by hand because an option mounts `RiderEditor`,
          and the renderer's `rows` branch gives a custom field the record, not the row. The row's
          shape (`newRow`, `rowKey`, `rowLabel`, controls) still lives here. */
      key: "options",
      label: "Options",
      kind: "rows",
      wide: true,
      addLabel: "Add an option",
      emptyText: "No options yet.",
      rowKey: (row) => String((row as { id?: unknown }).id ?? ""),
      newRow: () => ({ id: newId(), name: "", description: "" }),
      rowLabel: (row) => String((row as { name?: unknown }).name || "Unnamed option"),
      write: (next, block) => withoutPicks(block, { options: next }),
      rows: [
        { key: "name", label: "Name" },
        { key: "description", label: "Description", kind: "textarea", wide: true },
        // Whether this option is offered at all; see `requiresField`.
        requiresField(),
        // A chosen option is read as a feature (`optionAsFeature`), so it can raise budgets too.
        extraPicksField()
      ]
    },
    {
      key: "repeatable",
      label: "The same option can be chosen more than once",
      kind: "switch",
      write: (next, block) => ({ ...block, repeatable: next === true })
    }
  ];
}

/** A block field aliased at feature scope over the first block (`choice.kind`, `choice.choose`, …),
    the natural address for a one-pick feature; reads and writes use the same block helpers. Group
    children are re-aliased too because `fieldsWithin` flattens groups; `rows` children are not. */
const firstBlockField = (field: FieldDef): FieldDef => ({
  ...field,
  key: `choice.${field.key}`,
  ...(field.kind === "group" && field.rows ? { rows: field.rows.map(firstBlockField) } : {}),
  visibleWhen: asksAChoice,
  read: (feature) => {
    const block = (choiceBlocksOf(feature)[0] ?? {}) as Draft;
    return field.read ? field.read(block) : getAt(block, field.key);
  },
  write: (next, feature) => {
    const blocks = choiceBlocksOf(feature);
    const first = (blocks[0] ?? { ...NEW_CHOICE }) as Draft;
    const written = (field.write ? field.write(next, first) : setAt(first, field.key, next)) as ChoiceBlock;
    return writeChoiceBlocks(feature, [written, ...blocks.slice(1)]);
  }
});

/**
 * One feature's controls as data, keys relative to the feature. `featuresField` in `schemas.ts`
 * mounts this as its custom field's rows so the harness can address them; every write is the
 * panel's own write.
 *
 * Not declared here, because a `FieldDef` cannot express them: the level chips (two draft paths in
 * one edit), the options-source control (a UI mode in React state that writes four keys), and the
 * catalog which/family pair (two controls over one `fromCatalog` slug, the half-made pair held in
 * state). `fromCatalog` is therefore unreachable from `applyField`; tests drive `from` instead.
 */
export function featureFields(): readonly FieldDef[] {
  const blockFields = choiceBlockFields();
  return [
    { key: "name", label: "Name" },
    { key: "description", label: "Description", kind: "textarea", wide: true },
    {
      /* The switch is the choice itself: on seeds it, off removes both spellings. */
      key: "choice",
      label: "This feature asks the player to choose",
      kind: "switch",
      read: asksAChoice,
      write: (on, feature) => writeChoiceBlocks(feature, on === true ? [{ ...NEW_CHOICE }] : [])
    },
    ...blockFields.map(firstBlockField),
    {
      /** The choice list (several picks per feature, e.g. Magic Initiate). `read` accepts either
          spelling and `write` re-spells canonically. Rendered by hand in `renderFeature`. */
      key: "choices",
      label: "Choices",
      kind: "rows",
      wide: true,
      addLabel: "Add another choice",
      emptyText: "No choices yet.",
      maxRows: 4,
      maxRowsReason: "Four picks is as many as one feature may ask for.",
      visibleWhen: asksAChoice,
      read: (feature) => choiceBlocksOf(feature),
      write: (next, feature) => writeChoiceBlocks(feature, Array.isArray(next) ? (next as ChoiceBlock[]) : []),
      rowKey: (_row, index) => String(index),
      newRow: () => ({ ...NEW_CHOICE }),
      rowLabel: (row, index) => `Choice ${index + 1} — ${String((row as { kind?: unknown }).kind ?? "")}`,
      rows: blockFields
    },
    extraPicksField(),
    replacesField(),
    replacesFeatureIdField()
  ];
}

/** Built once; `featuresField` mounts the same objects the component renders. */
const FIELDS = featureFields();

const fieldFor = (key: string): FieldDef => {
  const field = FIELDS.find((entry) => entry.key === key);
  if (!field) throw new Error(`FeatureEditor has no field "${key}".`);
  return field;
};

/** One of a choice block's controls, from the `choices` field's declared rows. */
const blockFieldFor = (key: string): FieldDef => {
  const field = (fieldFor("choices").rows ?? []).find((entry) => entry.key === key);
  if (!field) throw new Error(`The choice block has no field "${key}".`);
  return field;
};

export function FeatureEditor({
  draft,
  onDraft,
  ctx,
  featuresKey = "features",
  /** Class and subclass place features at a level; other carriers grant them once. */
  levelAware = false,
  /** A feat is one feature under a singular `feature` key, so the body renders without list chrome. */
  single = false,
  singular = "feature",
  riders,
  idPrefix
}: Readonly<{
  draft: Draft;
  onDraft: (next: Draft) => void;
  ctx: SchemaContext;
  featuresKey?: string;
  levelAware?: boolean;
  single?: boolean;
  singular?: string;
  riders?: readonly RiderKind[];
  idPrefix: string;
}>) {
  const autoId = useId();
  /** Which options source the GM is working in, per feature. Derived from the data on first read,
      then held: composing a catalog slug takes two picks, and the slug is empty in between, so a
      purely derived mode would snap back mid-selection. */
  const [sourceMode, setSourceMode] = useState<Readonly<Record<string, SourceMode>>>({});
  /** Same reason for the catalog family: held until the `<which>-<family>` pair is complete. */
  const [familyMode, setFamilyMode] = useState<Readonly<Record<string, CatalogFamily>>>({});
  const features = useMemo(() => {
    const held = draft[featuresKey];
    // `single` reads the stored object as a one-row list so every write path is shared.
    if (single) return held && typeof held === "object" && !Array.isArray(held) ? [held as Feature] : [];
    return Array.isArray(held) ? (held as Feature[]) : [];
  }, [draft, featuresKey, single]);
  const levelTable = useMemo(
    () => (Array.isArray(draft.levelTable) ? (draft.levelTable as Array<Record<string, unknown>>) : []),
    [draft.levelTable]
  );
  /** Whether grants live in `levelTable[].features[]`. For a class that is all the server counts
      (`feature.level` alone grants nothing). A subclass is level-aware but has no table, so the
      floor and multi-select do not apply to it. */
  const tableBacked = levelAware && levelTable.length > 0;

  /** Where this feature is actually granted, read from what the server reads: the level rows for a
      class (not `feature.level`), or `feature.level` when there is no table. */
  const grantedLevels = (feature: Feature): readonly number[] => {
    if (!tableBacked) return typeof feature.level === "number" ? [feature.level] : [];
    const levels: number[] = [];
    levelTable.forEach((row, index) => {
      const ids = Array.isArray(row.features) ? (row.features as string[]) : [];
      if (ids.includes(feature.id)) levels.push(index + 1);
    });
    return levels;
  };

  const writeFeatures = (next: readonly Feature[]) =>
    onDraft(setAt(draft, featuresKey, single ? next[0] : next));

  /** Writes both halves in one edit: one draft identity, one autosave. */
  const setGrantedLevels = (index: number, levels: readonly number[]) => {
    const feature = features[index];
    const sorted = [...new Set(levels)].sort((a, b) => a - b);

    const nextFeature: Record<string, unknown> = { ...feature };
    // `.optional()`, not `.nullable()`: omit the key rather than sending null.
    if (sorted.length === 1) nextFeature.level = sorted[0];
    else delete nextFeature.level;

    const nextFeatures = features.map((entry, i) => (i === index ? (nextFeature as Feature) : entry));

    let next = setAt(draft, featuresKey, nextFeatures);
    if (tableBacked) {
      const nextTable = levelTable.map((row, rowIndex) => {
        const ids = Array.isArray(row.features) ? (row.features as string[]) : [];
        const wanted = sorted.includes(rowIndex + 1);
        const has = ids.includes(feature.id);
        if (wanted === has) return row;
        return { ...row, features: wanted ? [...ids, feature.id] : ids.filter((id) => id !== feature.id) };
      });
      next = setAt(next, "levelTable", nextTable);
    }
    onDraft(next);
  };

  /** Reconciles features and level table in one edit. A removed feature leaves every row that named
      it (or publish fails the id check); an added one joins its level's row in the same write, so no
      autosaved intermediate draft grants it nowhere. */
  const syncTable = (nextFeatures: readonly Feature[], removed: readonly Feature[], added: readonly Feature[]) => {
    let next = setAt(draft, featuresKey, single ? nextFeatures[0] : nextFeatures);
    if (tableBacked) {
      const goneIds = new Set(removed.map((feature) => feature.id));
      const joining = new Map<number, string[]>();
      for (const feature of added) {
        if (typeof feature.level !== "number") continue;
        joining.set(feature.level, [...(joining.get(feature.level) ?? []), feature.id]);
      }
      next = setAt(
        next,
        "levelTable",
        levelTable.map((row, rowIndex) => {
          const ids = Array.isArray(row.features) ? (row.features as string[]) : [];
          const kept = goneIds.size > 0 ? ids.filter((id) => !goneIds.has(id)) : ids;
          const join = (joining.get(rowIndex + 1) ?? []).filter((id) => !kept.includes(id));
          if (kept.length === ids.length && join.length === 0) return row;
          return { ...row, features: [...kept, ...join] };
        })
      );
    }
    onDraft(next);
  };

  const patch = (index: number, changes: Readonly<Record<string, unknown>>) => {
    writeFeatures(
      features.map((feature, i) => {
        if (i !== index) return feature;
        const merged: Record<string, unknown> = { ...feature };
        for (const [key, value] of Object.entries(changes)) {
          if (value === undefined) delete merged[key];
          else merged[key] = value;
        }
        return merged as Feature;
      })
    );
  };

  /** One feature's whole body, shared by the list and by `single`. */
  const renderFeature = (feature: Feature, index: number) => {
    const levels = grantedLevels(feature);
    const grants = levelAware ? Math.max(levels.length, 1) : 1;
    const blocks = choiceBlocksOf(feature);
    const choicesField = fieldFor("choices");
    const blockCap = choicesField.maxRows ?? 4;

  /** Replace one feature wholesale; every choice write funnels through this. */
    const putFeature = (next: Draft) =>
      writeFeatures(features.map((entry, i) => (i === index ? (next as Feature) : entry)));

    /** One declared control rendered against this feature, using the field's own write. */
    const control = (key: string) => (
      <FieldRenderer
        field={fieldFor(key)}
        value={feature}
        onValue={putFeature}
        draft={draft}
        onDraft={onDraft}
        ctx={ctx}
        idPrefix={`${idPrefix}-feature-${index}`}
      />
    );

    /** One choice block's panel. Every block gets the same controls, so a second block is as capable
        as the first. The declared shape lives on the `choices` field's rows; this renders them plus
        the three bespoke controls (see `featureFields`). */
    const renderChoiceBlock = (blockIndex: number) => {
      const block = (blocks[blockIndex] ?? {}) as Record<string, unknown>;
      /** UI-mode state is per block, keyed by index since blocks carry no id. */
      const stateKey = `${feature.id}:${blockIndex}`;
      const choose = typeof block.choose === "number" ? block.choose : 1;
      const repeatable = block.repeatable === true;
      const catalogSlug = typeof block.fromCatalog === "string" ? block.fromCatalog : "";
      const parsed = parseCatalog(catalogSlug);
      const family = familyMode[stateKey] ?? parsed.family;
      // Same precedence as `featurePickOffer`: `fromPicks` first.
      const derivedSource: SourceMode = block.fromPicks
        ? "picks"
        : Array.isArray(block.options)
          ? "options"
          : catalogSlug
            ? "catalog"
            : "list";
      const source = sourceMode[stateKey] ?? derivedSource;
      const optionsField = blockFieldFor("options");
      const optionRows = Array.isArray(block.options) ? (block.options as Array<Record<string, unknown>>) : [];

      const setChoice = (changes: Readonly<Record<string, unknown>>) =>
        putFeature(writeChoiceAt(feature, blockIndex, changes));

      // A slug naming this record; only the server can answer it while it is a draft. See `namesOwnRecord`.
      const selfCatalog = !!catalogSlug && namesOwnRecord(catalogSlug, ctx.recordId);
      const catalogResult = catalogSlug && !selfCatalog ? ctx.resolveCatalog(catalogSlug) : null;

      /** One of the block's declared controls, rendered against the block. */
      const blockControl = (key: string) => (
        <FieldRenderer
          field={blockFieldFor(key)}
          value={block}
          onValue={(next) =>
            putFeature(writeChoiceBlocks(feature, blocks.map((held, i) => (i === blockIndex ? (next as Record<string, unknown>) : held))))}
          draft={draft}
          onDraft={onDraft}
          ctx={ctx}
          idPrefix={`${idPrefix}-feature-${index}-choice-${blockIndex}`}
        />
      );

      return (
        <div className="hb-choice" key={blockIndex}>
          {blocks.length > 1 && (
            <div className="hb-choice-head">
              <span className="nh-field-label">Choice {blockIndex + 1}</span>
              <Button size="sm" onClick={() => putFeature(writeChoiceBlocks(feature, blocks.filter((_, i) => i !== blockIndex)))}>
                Remove choice {blockIndex + 1}
              </Button>
            </div>
          )}

          <FieldGrid>
            {blockControl("kind")}
            {blockControl("choose")}
          </FieldGrid>

          <div className="hb-field">
            <span className="nh-field-label">Where the options come from</span>
            <SegmentedControl
              ariaLabel={blocks.length > 1 ? `Where choice ${blockIndex + 1}'s options come from` : "Where the options come from"}
              size="sm"
              value={source}
              options={[
                { value: "catalog", label: "A catalog" },
                { value: "list", label: "A list I choose" },
                { value: "options", label: "Options I write" },
                { value: "picks", label: "Their earlier picks" }
              ]}
              /* Each source clears the other three in the same edit, since the reader silently drops
                 all but one. The offer is seeded empty so it cannot point at the wrong budget. */
              onChange={(next) => {
                setSourceMode((prev) => ({ ...prev, [stateKey]: next as SourceMode }));
                if (next === "catalog") setChoice({ options: undefined, from: undefined, fromPicks: undefined, fromCatalog: "skills" });
                else if (next === "list") setChoice({ options: undefined, fromCatalog: undefined, fromPicks: undefined, from: [] });
                else if (next === "picks") setChoice({ options: undefined, from: undefined, fromCatalog: undefined, fromPicks: { offer: "" } });
                else setChoice({ fromCatalog: undefined, from: undefined, fromPicks: undefined, options: [] });
              }}
            />
          </div>

          {source === "catalog" && (
            <>
              <FieldGrid>
                <Field label="Which catalog">
                  <Select
                    value={family}
                    onChange={(event) => {
                      const next = event.target.value as CatalogFamily;
                      setFamilyMode((prev) => ({ ...prev, [stateKey]: next }));
                      setChoice({ fromCatalog: composeCatalog(next, parsed.which) });
                    }}
                  >
                    {FAMILY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {(family === "subclasses" || family === "feats" || family === "spells" || family === "lineages") && (
                  <Field label="Of which">
                    <Select
                      value={parsed.which}
                      onChange={(event) => setChoice({ fromCatalog: composeCatalog(family, event.target.value) })}
                    >
                      <option value="">Not set</option>
                      {(family === "subclasses"
                        ? ctx.classes
                        : family === "feats"
                          ? ctx.featCategories
                          : family === "spells"
                            ? ctx.spellLists
                            : ctx.species
                      ).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </FieldGrid>
              {/* Resolved through the same function the server validates with. A slug naming this
                  record cannot resolve against the merged catalog, so it gets a neutral explanation
                  instead of an error. */}
              <p className={(!catalogSlug || (catalogResult && "error" in catalogResult)) && !selfCatalog ? "hb-blocked" : "nh-field-help"}>
                {selfCatalog
                  ? "Players pick from the records that name this one. They only have to exist in your library — they don't have to be published."
                  : !catalogSlug
                    ? family
                      ? "Pick which one, and this will say how many options players get."
                      : "This matches no catalog — the choice would be skipped."
                    : catalogResult && "error" in catalogResult
                      ? `This matches no catalog — the choice would be skipped. (${catalogResult.error})`
                      : `Players will pick from ${catalogResult?.count ?? 0} ${catalogResult?.count === 1 ? "option" : "options"}.`}
              </p>
            </>
          )}

          {source === "list" && blockControl("from")}

          {source === "picks" && blockControl("fromPicks")}

          {/* Rendered by hand because an option row mounts `RiderEditor`; the shape comes from the field. */}
          {source === "options" && (
            <RowEditor
              rows={optionRows}
              onChange={(next) => setChoice({ options: next })}
              rowKey={(option) => optionsField.rowKey!(option, 0)}
              onAdd={() => optionsField.newRow!() as Record<string, unknown>}
              addLabel={optionsField.addLabel!}
              emptyText={optionsField.emptyText}
              collapsible
              ariaLabel={optionsField.label}
              rowLabel={(option, optionIndex) => optionsField.rowLabel!(option, optionIndex)}
              renderRow={(option, optionIndex) => {
                /** Replace the row, never merge: both callers hand over a whole option, and a merge
                    would restore keys a write deleted (e.g. clearing `requires`). */
                const setOption = (next: Readonly<Record<string, unknown>>) =>
                  setChoice({ options: optionRows.map((entry, i) => (i === optionIndex ? next : entry)) });
                return (
                  <>
                    <FieldGrid>
                      {(optionsField.rows ?? []).map((rowField, rowFieldIndex) => (
                        <FieldRenderer
                          key={`${rowField.key}-${rowFieldIndex}`}
                          field={rowField}
                          value={option}
                          onValue={(next) => setOption(next as Record<string, unknown>)}
                          draft={draft}
                          onDraft={onDraft}
                          ctx={ctx}
                          idPrefix={`${idPrefix}-feature-${index}-choice-${blockIndex}-option-${optionIndex}`}
                        />
                      ))}
                    </FieldGrid>
                    {/* Depth capped at 1: an option carries riders but never its own options. */}
                    <RiderEditor
                      value={option}
                      onChange={(next) => setOption(next)}
                      scope="feature"
                      ctx={ctx}
                      idPrefix={`${idPrefix}-choice-${blockIndex}-option-${optionIndex}`}
                    />
                  </>
                );
              }}
            />
          )}

          {/* Bounds on what an answer may be, read against the source's list. */}
          <FieldGrid>
            {blockControl("maxSpellLevel")}
            {blockControl("minSpellLevel")}
            {blockControl("maximum")}
          </FieldGrid>

          {blockControl("repeatable")}

          {/* Live `choose × grants` readout. */}
          <p className="hb-picks">
            {levelAware && grants > 1
              ? `Granted at ${grants} levels × choose ${choose} = `
              : `Choose ${choose} = `}
            <strong>
              {grants * choose} {grants * choose === 1 ? "pick" : "picks"}
            </strong>
            {repeatable ? ". The same option may be taken again." : grants * choose > 1 ? ", each a different option." : "."}
          </p>
        </div>
      );
    };

    return (
      <div className="hb-feature">
        <FieldGrid>
          {control("name")}
          {control("description")}
        </FieldGrid>

        {levelAware && (
          <div className="hb-field">
            <span className="nh-field-label" id={`${autoId}-levels-${feature.id}`}>
              {tableBacked ? "Granted at levels" : "Granted at level"}
            </span>
            <div
              className="hb-chips hb-levels"
              role="group"
              aria-labelledby={`${autoId}-levels-${feature.id}`}
              aria-describedby={`${autoId}-levelhelp-${feature.id}`}
            >
              {LEVELS.map((level) => {
                const on = levels.includes(level);
                // The floor: a table-backed feature's only pressed chip is disabled, with the reason
                // beneath. Selecting a second level unlocks both.
                const locked = tableBacked && on && levels.length === 1;
                return (
                  <Chip
                    key={level}
                    pressed={on}
                    disabled={locked}
                    aria-label={`Level ${level}`}
                    onClick={() =>
                      setGrantedLevels(
                        index,
                        on ? levels.filter((entry) => entry !== level) : tableBacked ? [...levels, level] : [level]
                      )
                    }
                  >
                    {level}
                  </Chip>
                );
              })}
            </div>
            <p className="nh-field-help" id={`${autoId}-levelhelp-${feature.id}`}>
              {!tableBacked
                ? levels.length === 0
                  ? "Granted the moment this subclass is taken. Pick a level to hold it back until then."
                  : `Granted at level ${levels[0]}. Tap it again to grant it with the subclass instead.`
                : levels.length === 0
                  ? "On no level row, so the class never grants it — pick at least one level."
                  : levels.length === 1
                    ? `On the level table at level ${levels[0]}. A class feature is always granted at a level, so add another before clearing this one.`
                    : `On the level table at levels ${levels.join(", ")}.`}
            </p>
          </div>
        )}

        {/* Supersession sits beside the levels; renders on a class only. */}
        {control("replacesFeatureId")}

        {control("choice")}

        {blocks.length > 0 && (
          <>
            {blocks.map((_, blockIndex) => renderChoiceBlock(blockIndex))}
            {/* At capacity the Add button stays, annotated (the `choices` field holds the cap). */}
            <div className="hb-choice-add">
              <Button
                size="sm"
                disabled={blocks.length >= blockCap}
                aria-describedby={blocks.length >= blockCap ? `${autoId}-choicecap-${feature.id}` : undefined}
                onClick={() => putFeature(writeChoiceBlocks(feature, [...blocks, choicesField.newRow!() as ChoiceBlock]))}
              >
                {choicesField.addLabel}
              </Button>
              {blocks.length >= blockCap && (
                <p className="nh-field-help" id={`${autoId}-choicecap-${feature.id}`}>{choicesField.maxRowsReason}</p>
              )}
            </div>
          </>
        )}

        {control("extraPicks")}
        {control("replaces")}

        <RiderEditor
          value={feature}
          onChange={(next) => writeFeatures(features.map((entry, i) => (i === index ? (next as Feature) : entry)))}
          enabled={riders}
          scope="feature"
          ctx={ctx}
          idPrefix={`${idPrefix}-feature-${index}`}
        />
      </div>
    );
  };

  // A feat is its one feature: no Add, no Remove, no list.
  if (single) {
    return <div className="hb-field">{features[0] ? renderFeature(features[0], 0) : null}</div>;
  }

  return (
    <div className="hb-field">
      <RowEditor
        rows={features}
        onChange={(next) => {
          // Both directions in one edit (see `syncTable`); a reorder takes the plain write.
          const heldIds = new Set(features.map((feature) => feature.id));
          const keptIds = new Set(next.map((feature) => feature.id));
          const removed = features.filter((feature) => !keptIds.has(feature.id));
          const added = next.filter((feature) => !heldIds.has(feature.id));
          if (removed.length > 0 || added.length > 0) syncTable(next, removed, added);
          else writeFeatures(next);
        }}
        rowKey={(feature) => feature.id}
        onAdd={() =>
          ({
            ...blankFeature(),
            // Already on the table: `syncTable` writes the matching level-row entry in the same edit.
            ...(tableBacked ? { level: DEFAULT_GRANT_LEVEL } : {})
          }) as Feature
        }
        addLabel={`Add a ${singular}`}
        emptyText={`No ${singular === "feature" ? "features" : `${singular}s`} yet.`}
        collapsible
        ariaLabel={`${singular} list`}
        rowLabel={(feature) => {
          const levels = grantedLevels(feature);
          const bits = [feature.name || `Unnamed ${singular}`];
          if (levelAware && levels.length === 1) bits.push(`level ${levels[0]}`);
          else if (levelAware && levels.length > 1) bits.push(`${levels.length} levels`);
          const asked = choiceBlocksOf(feature).length;
          if (asked === 1) bits.push("asks a choice");
          else if (asked > 1) bits.push(`asks ${asked} choices`);
          const summary = riderSummary(feature);
          if (summary) bits.push(summary);
          return bits.join(" · ");
        }}
        renderRow={renderFeature}
      />
    </div>
  );
}

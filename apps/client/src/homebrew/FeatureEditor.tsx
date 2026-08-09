/**
 * A feature: what it is, when it is granted, what it asks the player, and what it does.
 * Used inline by class, subclass, species, background and feat.
 *
 * ## "Granted at levels" — one control writing both halves
 *
 * The single most consequential thing in this file. A class feature's repeat count lives
 * in TWO places: `feature.level` (the printed level) and every `levelTable[].features[]`
 * entry that names it. The server computes a choice's capacity as **`choose × grants`**,
 * where `grants` is the number of level rows naming the feature — while a client that
 * counts `choose × 1` produces builds the server rejects at Create, with no way for the
 * GM to see why.
 *
 * So the two halves are never authored separately. **One 20-chip control writes both:**
 * exactly one level selected writes `level: N`; two or more omits `level` (the schema
 * says `.optional()`, so omitted — never `null`) and relies on the rows. Every selected
 * level's row gets the feature id, every deselected level's row loses it, in one edit.
 * They cannot disagree, so the bug is not merely unlikely — it is unauthorable.
 *
 * The derived readout beneath says the arithmetic out loud, in words, because
 * `choose × grants` is exactly the thing a GM cannot infer from two separate controls:
 *
 *   > Granted at 5 levels × choose 1 = **5 picks**, each a different option.
 *
 * ## The floor: a class feature is granted at at least one level. Always.
 *
 * The control above only holds the two halves together *while it runs*. A feature that
 * was never in either half slipped past it: `onAdd` used to mint a feature with no level
 * and no row, and nothing made the GM answer before publish. Turn on "asks the player to
 * choose" and that feature reaches the wire with `grantedAtLevels: []` — the wizard
 * OFFERS the pick (`build-payload.ts:191`) and blocks Create until it is answered, while
 * the server counts the capacity as `choose × 0` and never builds a matching offer. The
 * character is uncreatable, and the sentence the GM sees names an id, not a fix.
 *
 * So the empty state has no reachable path, in both directions:
 *
 *   1. **A new feature arrives already on the table** — `onAdd` mints it at
 *      `DEFAULT_GRANT_LEVEL` and `syncTable` writes the row in the SAME edit. There is
 *      no moment, not even one render, in which it exists granted nowhere.
 *   2. **The last level cannot be cleared** — the sole pressed chip is disabled with its
 *      reason stated beneath, the way `RowEditor` annotates its Add button at capacity.
 *      Adding a second level unlocks both again, so "move it" is always two taps.
 *
 * `publishBlockedReason` still refuses an ungranted choice-bearing feature, for the one
 * path this file does not own: a record that arrived from an import or an SRD copy
 * already in that shape.
 *
 * ## A subclass has no level table, so its chips pick ONE level
 *
 * `levelAware` covers class AND subclass, but only a class carries `levelTable`. A
 * subclass feature's grant is its own `feature.level` (the server reads
 * `feature.level ?? subclassLevel`), and `setGrantedLevels` can only express one of
 * those — two selected levels omit `level` and write no rows, so tapping a second chip
 * used to silently deselect BOTH. Where there is no table, the chips are single-select.
 *
 * ## Why a feature's controls are `FieldDef`s and not JSX (R1)
 *
 * This file used to be 651 lines of hand-written JSX with **zero** `FieldDef`s, and that
 * was not a style problem. `fieldsOf` in `authoring-harness.ts` walks the form schema;
 * `FeatureEditor` is mounted as a `custom` field, so it had no fields to walk and every
 * control in here was **invisible to `applyField` in both directions**. A both-paths test
 * could not drive a feature's name, let alone its choice panel — the fourth part of the
 * phase's own rule ("a test through BOTH paths") was structurally unavailable for the
 * whole pick family. `featureFields()` below is what puts it on the surface: the fields
 * are declared once, rendered through the ONE renderer, and mounted as the row shape of
 * the `custom: "features"` field so the harness can address them.
 *
 * **Three controls stay bespoke, each because it writes something a `FieldDef` cannot:**
 * the level chips (two draft keys in one edit — the invariant this file opens with),
 * "Where the options come from" and the "Which catalog"/"Of which" pair (both driven by a
 * UI mode held in React state, which no `read` can recover from the draft). The reasons
 * are written out beside `featureFields()`, where the consequences are.
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

/** The reserved choice kinds. Offered as suggestions on a free-text field, never as a
    closed `<select>`: `FeatureChoiceSchema.kind` is an OPEN slug on purpose, so homebrew
    can invent one, and a closed list here would quietly make that impossible. */
const CHOICE_KINDS = [
  "feat", "fighting-style", "asi-or-feat", "subclass", "lineage", "spell", "cantrip",
  "skill", "tool", "language", "skill-or-tool", "expertise", "ability-score", "weapon-mastery"
];

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

/**
 * Where a brand-new class feature lands.
 *
 * Level 1 rather than "the first empty row" or "the last level you used": every class
 * grants something at 1, it is the same answer every time, and the chip row says so the
 * instant the feature appears. A guessed level would be one the GM has to notice and
 * undo; a predictable one is a single tap from anywhere else.
 */
const DEFAULT_GRANT_LEVEL = 1;

/* -------------------------------------------------------- the field schema ------ */

/** The choice a feature is seeded with the moment the switch goes on — spelled once,
    because every seeding write (the switch, a choice key landing on a bare feature, the
    "Add another choice" button's `newRow`) has to agree or they mint different shapes. */
const NEW_CHOICE: Readonly<Record<string, unknown>> = { kind: "feat", choose: 1, repeatable: false };

/** The slug this panel has always taken: lowercase, and every run of anything else
    becomes one hyphen. `FeatureChoiceSchema.kind` is `ContentIdSchema`, so a value that
    skips this is unpublishable at a gate that names a regex. */
const asChoiceSlug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9-]+/g, "-");

/** One choice block — one pick the feature asks for, however the record spells it. */
type ChoiceBlock = Readonly<Record<string, unknown>>;

/** EVERY pick this feature asks for, read through `featurePicks` — the server's own
    accessor, imported rather than mirrored, so the panel and `character-build.ts` cannot
    disagree about which spelling holds the list. */
const choiceBlocksOf = (feature: Draft): readonly ChoiceBlock[] =>
  featurePicks(feature as { choice?: ChoiceBlock; choices?: ChoiceBlock[] });

/**
 * **How `choice` (singular) and `choices` (plural) relate — U12's ruling, taken from the
 * reader rather than from taste.**
 *
 * `featurePicks` reads the pair as ONE list with two spellings: `choices` wins when it is
 * non-empty, `choice` otherwise, and `FeatureRecordSchema`'s `oneChoiceForm` refinement
 * REFUSES a record carrying both ("Author `choice` (one pick) or `choices` (several) —
 * never both."). So the two keys are not two features of the form — they are one list
 * whose spelling is a function of its length, and the SRD authors exactly that: every
 * one-pick record uses `choice`, all three plural records (the Magic Initiates) use
 * `choices`, and none uses both or a one-element `choices`.
 *
 * The form therefore never asks the GM to pick a spelling. Every write lands here, and
 * the canonical spelling is derived from the count — which is what makes the refused
 * both-keys shape UNAUTHORABLE rather than merely caught at publish, the same standard
 * the level chips and the recharge pair are held to.
 */
function writeChoiceBlocks(feature: Draft, blocks: readonly ChoiceBlock[]): Draft {
  const next: Record<string, unknown> = { ...feature };
  delete next.choice;
  delete next.choices;
  if (blocks.length === 1) next.choice = blocks[0];
  else if (blocks.length > 1) next.choices = [...blocks];
  return next;
}

/**
 * Merge changes into ONE block, seeding the list when there is none — so
 * `applyField(type, feature, "choice.choose", 2)` on a bare feature still produces the
 * same `{kind, choose, repeatable}` the switch mints, and not a half-built shape no form
 * can make.
 */
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

/** Does this feature ask a question at all? Every control below the switch depends on it,
    and it reads the BLOCKS, not the singular key — a plural record asks too. */
const asksAChoice = (feature: Draft) => choiceBlocksOf(feature).length > 0;

/** The offer key's own shape, caught while typing — `PickBudgetKeySchema` is
    `/^[a-z0-9-]+(:[a-z0-9-]+)?$/`, one colon wider than a plain slug, so `slugValidate`
    would refuse the `feature:<id>` form the key exists to allow. */
const offerValidate = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "" || /^[a-z0-9-]+(:[a-z0-9-]+)?$/.test(text)) return null;
  return "Write it as an offer key — lowercase-with-dashes, or feature:<a-feature-id>.";
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

/** What to CALL one of those ids in a picker. A feature the GM has not named yet still has
    to be pickable, so the id stands in rather than an empty row. */
const featureLabelOf = (draft: Draft, id: string): string => {
  const named = featuresOf(draft).find((feature) => (feature as { id?: unknown }).id === id);
  return String((named as { name?: unknown } | undefined)?.name || id);
};

/**
 * EXTRA PICKS — the rider by which a feature (or a chosen option) RAISES a pick budget
 * instead of granting an outcome. "You know one extra cantrip from the Cleric spell
 * list" is `{offer: "class-cantrips", amount: 1}`; the server folds every grant into the
 * budget by ADDITION and refuses a key naming no budget the build has, loudly.
 *
 * **The offer box is an open text with suggestions, never a closed select** — the same
 * ruling as the choice kind box, and for the same reason twice over: the eight named
 * budgets are a closed list but `feature:<id>` is an open form over the record's own
 * features, so a closed control could not say the very case that started this area
 * (Eldritch Invocations raises its own feature's pick). The suggestions are the eight
 * canonical keys (`NAMED_PICK_BUDGET_KEYS`, the list the server's rejection sentence
 * names) plus `feature:<id>` for every feature the record declares.
 *
 * **`amount` and `scaling` are exactly one, and the pair is held by the mode select** the
 * way `usesField` holds `limit`/`scaling`: picking "As a class-table column grows" swaps
 * the flat amount for `{type: "class-resource-growth", id}` and back, deleting the other
 * half, so the schema's "exactly one" refinement cannot be reached from the form. The
 * column id is seeded EMPTY — a guessed "rage" would silently point a homebrew grant at
 * the Barbarian's column — and the publish checklist names it until the GM fills it.
 *
 * One factory, two mounts: a feature's own list, and an inline option's (Divine Order's
 * Thaumaturge is option-level — 2 of the SRD's 8 authors are).
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
        placeholder: "class-cantrips",
        help: "A named budget, or feature:<id> for one of this record's own features.",
        suggestions: (_ctx, draft) => [...NAMED_PICK_BUDGET_KEYS, ...featureIdsOf(draft).map((id) => `feature:${id}`)],
        validate: offerValidate
      },
      {
        key: "mode",
        label: "The extra is",
        kind: "select",
        // `mode` is NOT stored — read back out of the shape, the same derivation the
        // "Uses are" select rides. The two literals below are this control's own; the
        // stored discriminator is `scaling.type`, seeded by the write.
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

/**
 * PICKS THIS FEATURE RE-OPENS — `replaces`, the only rider whose answer is re-made after
 * the character is built.
 *
 * "Whenever you finish a Long Rest, choose one type of land"; "choose one damage type
 * whenever you finish a Short or Long Rest." The clause names a pick budget the character
 * already answered and says WHEN that answer may be taken back, and the two halves live in
 * different places: `level-up` is a build-time permission over the choices ledger, while
 * `short-rest`/`long-rest` become runtime state on the actor — written by `actor.rechoose`,
 * cleared by the matching rest, read at damage time. It is wired end to end through a
 * command, actor state, rest clearing and a gated projection, and until this field there
 * was no control for it anywhere.
 *
 * **The offer box is the same open text with suggestions `extraPicks` uses**, and it has to
 * be: the server validates a `replaces` clause against the SAME namespace an `extraPicks`
 * grant is validated against (`character-build.ts` reuses `namesARealBudget` for both and
 * says so), so a closed select here would be a second, narrower list beside one shared
 * check. Both SRD authors name the feature's own pick — `feature:circle-of-the-land-spells`,
 * `feature:fiendish-resilience` — which is exactly the open half of that namespace.
 */
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
    // `when` is seeded, `offer` is not: a guessed budget would silently point the clause at
    // someone else's pick, the same ruling `extraPicks`' column id is seeded empty under.
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

/**
 * SUPERSEDES — `replacesFeatureId`, the feature that takes an earlier one's place.
 *
 * Extra Attack (2) replaces Extra Attack; Indomitable 9/13/17 replaces its own predecessor.
 * `grantedClassFeatures` drops the named feature from the granted set once the replacement
 * is granted, so the sheet prints one line rather than two contradicting ones.
 *
 * **Offered on a CLASS only, and that is a measurement rather than a shortcut** — the same
 * call U7 made about `class-resource` on an item. The reader is `grantedClassFeatures`,
 * which walks a CLASS's own level table and nothing else: `subclassFeatures` is a plain
 * filter with no supersession step, so a subclass feature carrying the key is inert. The
 * SRD proves it rather than assumes it — Champion's `superior-critical` authors
 * `replacesFeatureId: "improved-critical"` and a level-15 Champion holds both records, which
 * `class-mechanics/fighter.ts` writes down at the record itself. Showing the control on the
 * other four carriers would be an editor-only row on all four.
 */
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
  // The list cannot exclude the feature being edited (`options` is handed the RECORD, never
  // the row), and naming itself would make the class delete the very feature that arrived.
  // So the illegal answer is named while it is made, the way every other `validate` is.
  validate: (value, feature) => (value && value === feature.id ? "A feature cannot supersede itself — pick the earlier one it replaces." : null)
});

/**
 * The controls of ONE choice block, keys relative to the block — the shape every block
 * in the list shares, spelled once. `renderFeature` renders every block through these,
 * and `fieldsWithin(type, [features…, "choices"])` addresses them at the block's own
 * row scope.
 */
function choiceBlockFields(): readonly FieldDef[] {
  return [
    {
      key: "kind",
      label: "What kind of choice",
      help: "Type your own if none of these fit.",
      // An OPEN slug with the reserved list as suggestions, never a closed `<select>`:
      // homebrew is allowed to invent a kind and a closed control would make it
      // impossible. Deliberately NOT `pick` — see the note in `featureFields`' docblock.
      suggestions: CHOICE_KINDS,
      write: (next, block) => ({ ...block, kind: asChoiceSlug(String(next ?? "")) })
    },
    { key: "choose", label: "How many they pick", kind: "stepper", min: 1, max: 10 },
    {
      /* Slugs separated by commas, in one box, because a `from` list is written by hand
         against no catalog — there is nothing to suggest. `read` joins and `write`
         splits, so the stored value is the array the schema wants and the displayed one
         is the sentence a GM typed. */
      key: "from",
      label: "Which options",
      help: "Type slugs, separated by commas.",
      placeholder: "athletics, perception",
      read: (block) => {
        const from = block.from;
        return (Array.isArray(from) ? from : []).map(String).join(", ");
      },
      write: (next, block) => ({
        ...block,
        from: String(next ?? "")
          .split(",")
          .map((entry) => asChoiceSlug(entry.trim()))
          .filter(Boolean)
      })
    },
    {
      /**
       * Inline options — the third source, and the one `RowEditor` around it is written by
       * hand while the FIELD is the source of the row's shape.
       *
       * The reason is worth writing down, because U16 mounts the choice panel on an option
       * row and meets it again: an option carries `RiderEditor`, and `FieldRenderer`'s
       * `rows` branch hands a row-scoped `custom` field the whole RECORD and the record's
       * setter — never its row — so it structurally cannot mount one. Everything the row
       * IS still lives here (`newRow`, `rowKey`, `rowLabel`, the controls); the component
       * reads them rather than restating them, so the field and the form cannot drift.
       */
      key: "options",
      label: "Options",
      kind: "rows",
      wide: true,
      addLabel: "Add an option",
      emptyText: "No options yet.",
      rowKey: (row) => String((row as { id?: unknown }).id ?? ""),
      newRow: () => ({ id: newId(), name: "", description: "" }),
      rowLabel: (row) => String((row as { name?: unknown }).name || "Unnamed option"),
      write: (next, block) => ({ ...block, options: next }),
      rows: [
        { key: "name", label: "Name" },
        { key: "description", label: "Description", kind: "textarea", wide: true },
        // An OPTION raises budgets too — Divine Order's Thaumaturge is the SRD's own
        // case — and the reader treats a chosen option as a feature (`optionAsFeature`),
        // so the control is the same factory at the option's own row scope.
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

/**
 * A block field re-addressed at FEATURE scope, over the FIRST block — `choice.kind`,
 * `choice.choose`, `choice.from`, `choice.options`, `choice.repeatable`, the keys this
 * panel has carried since R1.
 *
 * Kept after U12 rather than retired, for two reasons: they are how a one-pick feature —
 * the overwhelming case — is naturally addressed (`choice.kind` reads as the record
 * spells it), and retiring them would strand every existing test on the panel. They are
 * ALIASES, not a second surface: read and write both go through the same block helpers
 * the rendered per-block controls use, so the two cannot drift.
 */
const firstBlockField = (field: FieldDef): FieldDef => ({
  ...field,
  key: `choice.${field.key}`,
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
 * **One feature's controls, as data — the declarative surface this file used to be off.**
 *
 * Keys are relative to ONE feature, which is what a row's keys always are, and that is
 * exactly how they are mounted: `featuresField` in `schemas.ts` declares this list as the
 * `rows` of its `custom: "features"` field, so `fieldsOf` walks it flat and
 * `fieldsWithin(type, ["features"])` — or `["feature"]` on a feat — addresses one feature
 * at its own scope. Nothing about the render changes; `FieldRenderer`'s `custom` branch
 * never reads `rows`.
 *
 * Every write here is the write the panel makes. That is what makes the harness's
 * guarantee true rather than decorative: a test drives the same function the GM's finger
 * does — the `choice.*` aliases and the per-block controls share `writeChoiceBlocks`, so
 * there is one write path however a block is addressed.
 *
 * **What is NOT here, and why each one is a ruling rather than an omission:**
 *
 *  - **the level chips** — `feature.level` AND `levelTable[].features[]` in one edit; see
 *    the top of this file. `CustomField` exists for exactly this shape.
 *  - **"Where the options come from"** — a `SegmentedControl` over a UI MODE held in React
 *    state, whose change writes THREE draft keys at once (`options`/`from`/`fromCatalog`).
 *    There is no stored value for a `FieldDef` to read. Per block since U12, keyed
 *    `<feature id>:<block index>`.
 *  - **"Which catalog" + "Of which"** — two controls over ONE key, the block's
 *    `fromCatalog`. A slug is `<which>-<family>`, so picking the family before the which
 *    composes to NOTHING, and the half-made pair is held in state precisely because the
 *    draft has nowhere to put it. A `FieldDef` for either half could not round-trip,
 *    which is the one thing a control on this surface must do. **Consequence for the
 *    units behind this refactor: `fromCatalog` stays unreachable from `applyField` at
 *    every block, so a test that needs a catalog-sourced choice drives `from` instead.**
 */
export function featureFields(): readonly FieldDef[] {
  const blockFields = choiceBlockFields();
  return [
    { key: "name", label: "Name" },
    { key: "description", label: "Description", kind: "textarea", wide: true },
    {
      /* The switch is the CHOICE ITSELF: on mints the seed, off removes the question —
         BOTH spellings of it, since a plural feature asks too. Stored as a shape rather
         than a flag, which is why it needs the `read`/`write` pair: neither key has an
         "off" value to hold. */
      key: "choice",
      label: "This feature asks the player to choose",
      kind: "switch",
      read: asksAChoice,
      write: (on, feature) => writeChoiceBlocks(feature, on === true ? [{ ...NEW_CHOICE }] : [])
    },
    ...blockFields.map(firstBlockField),
    {
      /**
       * THE LIST ITSELF — U12. One feature may ask several picks (Magic Initiate's two
       * cantrips AND its level-1 spell), and this is the `rows` field that addresses
       * them: `read` derives the blocks from whichever spelling the record holds, and
       * `write` re-spells canonically (see `writeChoiceBlocks`). Rendered by hand in
       * `renderFeature` — a block mounts the bespoke source machinery, which
       * `FieldRenderer`'s rows branch structurally cannot — while everything a block IS
       * lives here, the same split `choice.options` already lives with.
       */
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

/** Built once: the list is a constant of this module, and `featuresField` mounts the same
    call, so the fields a test finds are literally the objects the component renders. */
const FIELDS = featureFields();

const fieldFor = (key: string): FieldDef => {
  const field = FIELDS.find((entry) => entry.key === key);
  if (!field) throw new Error(`FeatureEditor has no field "${key}".`);
  return field;
};

/** One of a choice block's own controls, off the `choices` field's declared rows — the
    same objects `fieldsWithin(type, [features…, "choices"])` hands a test. */
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
  /** Class and subclass place their features at a level; a species trait, a background
      feature and a feat are granted once and have no level to place. */
  levelAware = false,
  /** A feat is exactly ONE feature and `FeatReferenceSchema` stores it under a singular
      `feature` key, so there is no list to add to or reorder — the body renders bare. */
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
  /**
   * Which of the three option sources the GM is *working in*, per feature.
   *
   * Derived from the data on first read, then held: composing a catalog slug takes two
   * picks ("Feats" then "general"), and after the first the slug is momentarily empty —
   * so a purely data-derived source flipped the control back to "A list I choose" and
   * took the half-finished panel away mid-selection. This is a UI mode, not draft data;
   * there is nothing to invalidate and nothing to store.
   */
  const [sourceMode, setSourceMode] = useState<Readonly<Record<string, "catalog" | "list" | "options">>>({});
  /** Same reason, one level down: a catalog slug is `<which>-<family>`, so picking the
      family before the `which` composes to nothing and the family select would snap back
      to "Not set" under the GM's finger. Held here until the pair is complete. */
  const [familyMode, setFamilyMode] = useState<Readonly<Record<string, CatalogFamily>>>({});
  const features = useMemo(() => {
    const held = draft[featuresKey];
    // `single` reads the one stored object as a one-row list, so every write path below
    // (patch, setChoice, the rider editor) is the same code for both shapes.
    if (single) return held && typeof held === "object" && !Array.isArray(held) ? [held as Feature] : [];
    return Array.isArray(held) ? (held as Feature[]) : [];
  }, [draft, featuresKey, single]);
  const levelTable = useMemo(
    () => (Array.isArray(draft.levelTable) ? (draft.levelTable as Array<Record<string, unknown>>) : []),
    [draft.levelTable]
  );
  /**
   * Does this record's grant live in `levelTable[].features[]`? Only a class's does, and
   * for a class it is the ONLY thing the server counts (`character-build.ts:329-334`
   * walks the rows; `feature.level` on its own grants nothing). A subclass is level-aware
   * but table-less, so its `feature.level` stands alone and both the floor and the
   * multi-select below are wrong for it.
   */
  const tableBacked = levelAware && levelTable.length > 0;

  /**
   * Where this feature is actually granted — read from whichever half the SERVER reads.
   *
   * For a class that is the level rows and only the level rows. This used to union the
   * rows with `feature.level`, which read a record authored elsewhere generously — and
   * therefore wrongly: an imported class whose feature carries `level: 5` but sits on no
   * row showed chip 5 pressed and "On the level table at level 5" while the class granted
   * it nothing, directly contradicting the publish blocker naming that same feature. The
   * rows are the truth, so an ungranted feature now reads as ungranted and one tap fixes
   * both halves at once.
   *
   * Where there is no table, `feature.level` is the whole answer.
   */
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

  /** THE one control's write. Both halves, one edit, one draft identity, one autosave. */
  const setGrantedLevels = (index: number, levels: readonly number[]) => {
    const feature = features[index];
    const sorted = [...new Set(levels)].sort((a, b) => a - b);

    const nextFeature: Record<string, unknown> = { ...feature };
    // `.optional()`, not `.nullable()` — omit the key rather than sending null.
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

  /**
   * The list changed shape: features and level table reconciled in ONE edit.
   *
   * A REMOVED feature must leave every row that named it, or the class fails its own
   * "every levelTable feature id exists" check at publish. An ADDED one must join the row
   * for its own printed level in the same write — two writes would autosave an
   * intermediate draft in which the feature is granted nowhere, which is precisely the
   * shape the server counts as zero picks.
   */
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

  /** One feature's whole body. Shared verbatim by the row list and by `single`, so a feat
      is the same editor as a class feature minus the list chrome it has no use for. */
  const renderFeature = (feature: Feature, index: number) => {
    const levels = grantedLevels(feature);
    const grants = levelAware ? Math.max(levels.length, 1) : 1;
    const blocks = choiceBlocksOf(feature);
    const choicesField = fieldFor("choices");
    const blockCap = choicesField.maxRows ?? 4;

    /** Replace ONE feature wholesale — every choice write below funnels through this. */
    const putFeature = (next: Draft) =>
      writeFeatures(features.map((entry, i) => (i === index ? (next as Feature) : entry)));

    /** One declared control, rendered against THIS feature as its container. The write is
        the field's own, so what a test drives and what a finger drives are one function. */
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

    /**
     * ONE choice block's whole panel. Every block gets the same controls — the kind box,
     * the stepper, the three-way source machinery, repeatable, the picks readout — so the
     * second block a GM adds is as rich as the first (Magic Initiate's level-1 spell
     * reads from a catalog exactly as its cantrips do). The declared shape lives on the
     * `choices` field's rows; this renders them, plus the three bespoke controls whose
     * rulings are written beside `featureFields`.
     */
    const renderChoiceBlock = (blockIndex: number) => {
      const block = (blocks[blockIndex] ?? {}) as Record<string, unknown>;
      /** UI-mode state is per block. Index-keyed: blocks carry no id, and the half-made
          catalog pair the state exists to hold is always the block under the finger. */
      const stateKey = `${feature.id}:${blockIndex}`;
      const choose = typeof block.choose === "number" ? block.choose : 1;
      const repeatable = block.repeatable === true;
      const catalogSlug = typeof block.fromCatalog === "string" ? block.fromCatalog : "";
      const parsed = parseCatalog(catalogSlug);
      const family = familyMode[stateKey] ?? parsed.family;
      const derivedSource: "catalog" | "list" | "options" = Array.isArray(block.options)
        ? "options"
        : catalogSlug
          ? "catalog"
          : "list";
      const source = sourceMode[stateKey] ?? derivedSource;
      const optionsField = blockFieldFor("options");
      const optionRows = Array.isArray(block.options) ? (block.options as Array<Record<string, unknown>>) : [];

      const setChoice = (changes: Readonly<Record<string, unknown>>) =>
        putFeature(writeChoiceAt(feature, blockIndex, changes));

      // A slug naming THIS record. The merged catalog cannot answer it while the record is
      // a draft; the server answers it from authorship. See `namesOwnRecord`.
      const selfCatalog = !!catalogSlug && namesOwnRecord(catalogSlug, ctx.recordId);
      const catalogResult = catalogSlug && !selfCatalog ? ctx.resolveCatalog(catalogSlug) : null;

      /** One of the block's own declared controls, rendered against the BLOCK. */
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
                { value: "options", label: "Options I write" }
              ]}
              onChange={(next) => {
                setSourceMode((prev) => ({ ...prev, [stateKey]: next as "catalog" | "list" | "options" }));
                if (next === "catalog") setChoice({ options: undefined, from: undefined, fromCatalog: "skills" });
                else if (next === "list") setChoice({ options: undefined, fromCatalog: undefined, from: [] });
                else setChoice({ fromCatalog: undefined, from: undefined, options: [] });
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
              {/* Live, and resolved through the SAME function the server validates
                  with, so the count the GM reads is the count the game offers — EXCEPT
                  for a slug naming this very record (`<own id>-subclasses`,
                  `<own id>-lineages`). Those resolve against the merged catalog, which
                  by construction cannot hold the draft being edited, so the shared
                  resolver throws and the readout said "matches no catalog" on a class
                  the GM had just duplicated and not touched. The server answers that
                  pair from authorship instead, so the honest thing to say here is what
                  the rule is, in the neutral register — not a caution about a break
                  that is not one. */}
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

          {/* The FIELD says what an option row is; this says how it is drawn, because a
              row that mounts `RiderEditor` cannot go through `FieldRenderer`'s rows
              branch — see the field's own note. Every value below comes from the field. */}
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
                const setOption = (changes: Readonly<Record<string, unknown>>) =>
                  setChoice({ options: optionRows.map((entry, i) => (i === optionIndex ? { ...entry, ...changes } : entry)) });
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
                    {/* Depth capped at 1: an option carries riders but never its
                        own "Options I write", which is what the schema allows. */}
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

          {blockControl("repeatable")}

          {/* The readout that makes `choose × grants` legible. Derived, stated
              once, in words, updating live. Never a stored duplicate. */}
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
                // The floor. A class feature the level table never names is granted
                // nothing, so the sole pressed chip is disabled with its reason
                // beneath — the same call `RowEditor` makes for Add at capacity: a
                // control that vanishes teaches nothing, a disabled one with its
                // reason does, and one that takes the tap and refuses is worse than
                // either. Tap a second level and both unlock.
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

        {/* Beside the levels, because it is the other half of the same question: WHEN does
            the class grant this, and what does granting it take off the sheet. Renders on a
            class only — see the field's own note. */}
        {control("replacesFeatureId")}

        {control("choice")}

        {blocks.length > 0 && (
          <>
            {blocks.map((_, blockIndex) => renderChoiceBlock(blockIndex))}
            {/* Annotate at capacity, never hide the Add button — the same readiness rule
                `RowEditor` follows. The cap is the field's own (`FeatureRecordSchema`'s
                `choices` takes at most four), spelled once on the `choices` field. */}
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

  // A feat IS its one feature: no Add, no Remove, no collapsed summary of a list of one.
  if (single) {
    return <div className="hb-field">{features[0] ? renderFeature(features[0], 0) : null}</div>;
  }

  return (
    <div className="hb-field">
      <RowEditor
        rows={features}
        onChange={(next) => {
          // Both directions in one edit — see `syncTable`. Reordering touches neither set
          // and takes the plain write.
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
            // Already on the table, before the row ever renders. `syncTable` writes the
            // matching `levelTable[0].features[]` entry in the same edit, so the two halves
            // are never apart — not even for one render.
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

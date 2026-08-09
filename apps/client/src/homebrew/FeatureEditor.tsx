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
 * **The level chips stay bespoke**, deliberately: one control writing `feature.level` AND
 * `levelTable[].features[]` in one edit is what `CustomField` exists for, and forcing it
 * into a `FieldDef` would break the invariant this file opens with.
 */

import { useId, useMemo, useState } from "react";
import { Chip, Field, FieldGrid, Input, RowEditor, SegmentedControl, Select, Stepper, Switch, Textarea } from "@vtt/ui";
import { newId } from "../lib/ids";
import { FieldRenderer } from "./FieldRenderer";
import { RiderEditor, riderSummary, type RiderKind } from "./RiderEditor";
import { LEVELS, blankFeature } from "./defaults";
import { setAt } from "./paths";
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
 * Every write here is the write the panel already made, lifted out of an event handler
 * and into the field. That is what makes the harness's guarantee true rather than
 * decorative: a test drives the same function the GM's finger does.
 */
export function featureFields(): readonly FieldDef[] {
  return [
    { key: "name", label: "Name" },
    { key: "description", label: "Description", kind: "textarea", wide: true }
  ];
}

/** Built once: the list is a constant of this module, and `featuresField` mounts the same
    call, so the fields a test finds are literally the objects the component renders. */
const FIELDS = featureFields();

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
    const choice = feature.choice as Record<string, unknown> | undefined;
    const choose = typeof choice?.choose === "number" ? choice.choose : 1;
    const grants = levelAware ? Math.max(levels.length, 1) : 1;
    const repeatable = choice?.repeatable === true;
    const catalogSlug = typeof choice?.fromCatalog === "string" ? choice.fromCatalog : "";
    const parsed = parseCatalog(catalogSlug);
    const family = familyMode[feature.id] ?? parsed.family;
    const derivedSource: "catalog" | "list" | "options" = Array.isArray(choice?.options)
      ? "options"
      : catalogSlug
        ? "catalog"
        : "list";
    const source = sourceMode[feature.id] ?? derivedSource;

    const setChoice = (changes: Readonly<Record<string, unknown>> | undefined) => {
      if (changes === undefined) {
        patch(index, { choice: undefined });
        return;
      }
      const merged: Record<string, unknown> = { ...(choice ?? { kind: "feat", choose: 1, repeatable: false }) };
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) delete merged[key];
        else merged[key] = value;
      }
      patch(index, { choice: merged });
    };

    // A slug naming THIS record. The merged catalog cannot answer it while the record is
    // a draft; the server answers it from authorship. See `namesOwnRecord`.
    const selfCatalog = !!catalogSlug && namesOwnRecord(catalogSlug, ctx.recordId);
    const catalogResult = catalogSlug && !selfCatalog ? ctx.resolveCatalog(catalogSlug) : null;

    /** One declared control, rendered against THIS feature as its container. The write is
        the field's own, so what a test drives and what a finger drives are one function. */
    const control = (key: string) => {
      const field = FIELDS.find((entry) => entry.key === key);
      if (!field) throw new Error(`FeatureEditor has no field "${key}".`);
      return (
        <FieldRenderer
          field={field}
          value={feature}
          onValue={(next) => writeFeatures(features.map((entry, i) => (i === index ? (next as Feature) : entry)))}
          draft={draft}
          onDraft={onDraft}
          ctx={ctx}
          idPrefix={`${idPrefix}-feature-${index}`}
        />
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

        <div className="hb-field">
          <Switch
            checked={!!choice}
            label="This feature asks the player to choose"
            onChange={(on) => setChoice(on ? { kind: "feat", choose: 1, repeatable: false } : undefined)}
          />
        </div>

        {choice && (
          <div className="hb-choice">
            <FieldGrid>
              <Field label="What kind of choice" htmlFor={`${autoId}-kind-${feature.id}`} help="Type your own if none of these fit.">
                <Input
                  id={`${autoId}-kind-${feature.id}`}
                  list={`${autoId}-kinds`}
                  value={String(choice.kind ?? "")}
                  onChange={(event) => setChoice({ kind: event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-") })}
                />
                <datalist id={`${autoId}-kinds`}>
                  {CHOICE_KINDS.map((kind) => (
                    <option key={kind} value={kind} />
                  ))}
                </datalist>
              </Field>

              <div className="hb-field">
                <Stepper
                  value={choose}
                  min={1}
                  max={10}
                  label="How many they pick"
                  onChange={(next) => setChoice({ choose: next })}
                />
              </div>
            </FieldGrid>

            <div className="hb-field">
              <span className="nh-field-label">Where the options come from</span>
              <SegmentedControl
                ariaLabel="Where the options come from"
                size="sm"
                value={source}
                options={[
                  { value: "catalog", label: "A catalog" },
                  { value: "list", label: "A list I choose" },
                  { value: "options", label: "Options I write" }
                ]}
                onChange={(next) => {
                  setSourceMode((prev) => ({ ...prev, [feature.id]: next as "catalog" | "list" | "options" }));
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
                        setFamilyMode((prev) => ({ ...prev, [feature.id]: next }));
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

            {source === "list" && (
              <Field label="Which options" help="Type slugs, separated by commas.">
                <Input
                  value={(Array.isArray(choice.from) ? (choice.from as string[]) : []).join(", ")}
                  placeholder="athletics, perception"
                  onChange={(event) =>
                    setChoice({
                      from: event.target.value
                        .split(",")
                        .map((entry) => entry.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-"))
                        .filter(Boolean)
                    })
                  }
                />
              </Field>
            )}

            {source === "options" && (
              <RowEditor
                rows={Array.isArray(choice.options) ? (choice.options as Array<Record<string, unknown>>) : []}
                onChange={(next) => setChoice({ options: next })}
                rowKey={(option) => String(option.id)}
                onAdd={() => ({ id: newId(), name: "", description: "" })}
                addLabel="Add an option"
                emptyText="No options yet."
                collapsible
                ariaLabel="Options"
                rowLabel={(option) => String(option.name || "Unnamed option")}
                renderRow={(option, optionIndex) => {
                  const setOption = (changes: Readonly<Record<string, unknown>>) =>
                    setChoice({
                      options: (choice.options as Array<Record<string, unknown>>).map((entry, i) =>
                        i === optionIndex ? { ...entry, ...changes } : entry
                      )
                    });
                  return (
                    <>
                      <FieldGrid>
                        <Field label="Name">
                          <Input value={String(option.name ?? "")} onChange={(event) => setOption({ name: event.target.value })} />
                        </Field>
                        <Field label="Description" className="nh-fieldgrid-wide">
                          <Textarea rows={3} value={String(option.description ?? "")} onChange={(event) => setOption({ description: event.target.value })} />
                        </Field>
                      </FieldGrid>
                      {/* Depth capped at 1: an option carries riders but never its
                          own "Options I write", which is what the schema allows. */}
                      <RiderEditor
                        value={option}
                        onChange={(next) => setOption(next)}
                        scope="feature"
                        ctx={ctx}
                        idPrefix={`${idPrefix}-option-${optionIndex}`}
                      />
                    </>
                  );
                }}
              />
            )}

            <div className="hb-field">
              <Switch
                checked={repeatable}
                label="The same option can be chosen more than once"
                onChange={(on) => setChoice({ repeatable: on })}
              />
            </div>

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
        )}

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
          if (feature.choice) bits.push("asks a choice");
          const summary = riderSummary(feature);
          if (summary) bits.push(summary);
          return bits.join(" · ");
        }}
        renderRow={renderFeature}
      />
    </div>
  );
}

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
 */

import { useId, useMemo, useState } from "react";
import { Chip, Field, FieldGrid, Input, RowEditor, SegmentedControl, Select, Stepper, Switch, Textarea } from "@vtt/ui";
import { newId } from "../lib/ids";
import { RiderEditor, riderSummary, type RiderKind } from "./RiderEditor";
import { LEVELS } from "./defaults";
import { setAt } from "./paths";
import type { Draft, SchemaContext } from "./schema";

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

export function FeatureEditor({
  draft,
  onDraft,
  ctx,
  featuresKey = "features",
  /** Class and subclass carry a level table; a species trait, a background feature and a
      feat are granted once and have no level to place. */
  levelAware = false,
  singular = "feature",
  riders,
  idPrefix
}: Readonly<{
  draft: Draft;
  onDraft: (next: Draft) => void;
  ctx: SchemaContext;
  featuresKey?: string;
  levelAware?: boolean;
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
  const features = useMemo(
    () => (Array.isArray(draft[featuresKey]) ? (draft[featuresKey] as Feature[]) : []),
    [draft, featuresKey]
  );
  const levelTable = useMemo(
    () => (Array.isArray(draft.levelTable) ? (draft.levelTable as Array<Record<string, unknown>>) : []),
    [draft.levelTable]
  );

  /** Every level whose row names this feature, unioned with its own printed level, so a
      record authored elsewhere (an SRD duplicate, an imported pack) reads correctly. */
  const grantedLevels = (feature: Feature): readonly number[] => {
    const levels = new Set<number>();
    levelTable.forEach((row, index) => {
      const ids = Array.isArray(row.features) ? (row.features as string[]) : [];
      if (ids.includes(feature.id)) levels.add(index + 1);
    });
    if (typeof feature.level === "number") levels.add(feature.level);
    return [...levels].sort((a, b) => a - b);
  };

  const writeFeatures = (next: readonly Feature[]) => onDraft(setAt(draft, featuresKey, next));

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
    if (levelAware && levelTable.length > 0) {
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

  const removeFromTable = (removed: readonly Feature[], kept: readonly Feature[]) => {
    let next = setAt(draft, featuresKey, kept);
    if (levelAware && levelTable.length > 0) {
      const goneIds = new Set(removed.map((feature) => feature.id));
      next = setAt(
        next,
        "levelTable",
        levelTable.map((row) => {
          const ids = Array.isArray(row.features) ? (row.features as string[]) : [];
          const filtered = ids.filter((id) => !goneIds.has(id));
          return filtered.length === ids.length ? row : { ...row, features: filtered };
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

  return (
    <div className="hb-field">
      <RowEditor
        rows={features}
        onChange={(next) => {
          // A removed feature must also leave every level row that named it, or the
          // class fails its own "every levelTable feature id exists" check at publish.
          const keptIds = new Set(next.map((feature) => feature.id));
          const removed = features.filter((feature) => !keptIds.has(feature.id));
          if (removed.length > 0) removeFromTable(removed, next);
          else writeFeatures(next);
        }}
        rowKey={(feature) => feature.id}
        onAdd={() => ({ id: newId(), name: "", description: "", tags: [], actions: [], effects: [], modifiers: [] }) as Feature}
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
        renderRow={(feature, index) => {
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

          const catalogResult = catalogSlug ? ctx.resolveCatalog(catalogSlug) : null;

          return (
            <div className="hb-feature">
              <FieldGrid>
                <Field label="Name" htmlFor={`${autoId}-name-${feature.id}`}>
                  <Input
                    id={`${autoId}-name-${feature.id}`}
                    value={feature.name ?? ""}
                    onChange={(event) => patch(index, { name: event.target.value })}
                  />
                </Field>
                <Field label="Description" htmlFor={`${autoId}-desc-${feature.id}`} className="nh-fieldgrid-wide">
                  <Textarea
                    id={`${autoId}-desc-${feature.id}`}
                    rows={4}
                    value={feature.description ?? ""}
                    onChange={(event) => patch(index, { description: event.target.value })}
                  />
                </Field>
              </FieldGrid>

              {levelAware && (
                <div className="hb-field">
                  <span className="nh-field-label" id={`${autoId}-levels-${feature.id}`}>
                    Granted at levels
                  </span>
                  <div className="hb-chips hb-levels" role="group" aria-labelledby={`${autoId}-levels-${feature.id}`}>
                    {LEVELS.map((level) => {
                      const on = levels.includes(level);
                      return (
                        <Chip
                          key={level}
                          pressed={on}
                          aria-label={`Level ${level}`}
                          onClick={() =>
                            setGrantedLevels(index, on ? levels.filter((entry) => entry !== level) : [...levels, level])
                          }
                        >
                          {level}
                        </Chip>
                      );
                    })}
                  </div>
                  <p className="nh-field-help">
                    {levels.length === 0
                      ? "Not on the level table yet — pick the levels this is granted at."
                      : `On the level table at ${levels.length === 1 ? `level ${levels[0]}` : `levels ${levels.join(", ")}`}.`}
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
                          with, so the count the GM reads is the count the game offers. */}
                      <p className={!catalogSlug || (catalogResult && "error" in catalogResult) ? "hb-blocked" : "nh-field-help"}>
                        {!catalogSlug
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
                      label="The same option can be taken more than once"
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
        }}
      />
    </div>
  );
}

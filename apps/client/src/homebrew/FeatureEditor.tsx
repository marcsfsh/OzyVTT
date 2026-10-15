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
import { Button, Chip, Field, FieldGrid, RowEditor, SegmentedControl, Select } from "@vtt/ui";
import { FieldRenderer } from "./FieldRenderer";
import { RiderEditor, riderSummary } from "./RiderEditor";
import { type RiderKind } from "./riders/vocabulary";
import { blankFeature, LEVELS } from "./defaults";
import { setAt } from "./paths";
import { type Draft, namesOwnRecord, type SchemaContext } from "./schema";
import {
  blockFieldFor,
  type CatalogFamily,
  type ChoiceBlock,
  choiceBlocksOf,
  composeCatalog,
  DEFAULT_GRANT_LEVEL,
  FAMILY_OPTIONS,
  type Feature,
  fieldFor,
  parseCatalog,
  type SourceMode,
  writeChoiceAt,
  writeChoiceBlocks
} from "./feature-fields";

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

  const writeFeatures = (next: readonly Feature[]) => onDraft(setAt(draft, featuresKey, single ? next[0] : next));

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
            putFeature(
              writeChoiceBlocks(
                feature,
                blocks.map((held, i) => (i === blockIndex ? (next as Record<string, unknown>) : held))
              )
            )
          }
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
              <Button
                size="sm"
                onClick={() =>
                  putFeature(
                    writeChoiceBlocks(
                      feature,
                      blocks.filter((_, i) => i !== blockIndex)
                    )
                  )
                }
              >
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
              ariaLabel={
                blocks.length > 1 ? `Where choice ${blockIndex + 1}'s options come from` : "Where the options come from"
              }
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
                if (next === "catalog")
                  setChoice({ options: undefined, from: undefined, fromPicks: undefined, fromCatalog: "skills" });
                else if (next === "list")
                  setChoice({ options: undefined, fromCatalog: undefined, fromPicks: undefined, from: [] });
                else if (next === "picks")
                  setChoice({ options: undefined, from: undefined, fromCatalog: undefined, fromPicks: { offer: "" } });
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
              <p
                className={
                  (!catalogSlug || (catalogResult && "error" in catalogResult)) && !selfCatalog
                    ? "hb-blocked"
                    : "nh-field-help"
                }
              >
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
            {levelAware && grants > 1 ? `Granted at ${grants} levels × choose ${choose} = ` : `Choose ${choose} = `}
            <strong>
              {grants * choose} {grants * choose === 1 ? "pick" : "picks"}
            </strong>
            {repeatable
              ? ". The same option may be taken again."
              : grants * choose > 1
                ? ", each a different option."
                : "."}
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
                onClick={() =>
                  putFeature(writeChoiceBlocks(feature, [...blocks, choicesField.newRow!() as ChoiceBlock]))
                }
              >
                {choicesField.addLabel}
              </Button>
              {blocks.length >= blockCap && (
                <p className="nh-field-help" id={`${autoId}-choicecap-${feature.id}`}>
                  {choicesField.maxRowsReason}
                </p>
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

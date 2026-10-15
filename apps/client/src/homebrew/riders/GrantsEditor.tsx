import { useMemo } from "react";
import { Chip, Field, FieldGrid, RowEditor, Select, TagInput } from "@vtt/ui";
import { newId } from "../../lib/ids";
import { CatalogPicker } from "../CatalogPicker";
import { type Draft, type SchemaContext, suggestionLabel } from "../schema";
import { ABILITIES, type RiderScope } from "../vocabulary";

/** `FeatureGrantsSchema`'s parallel arrays (skills, expertise, tools, …, spells) presented as one
    `[What][Which…]` list; the storage shape stays the server's. */
const GRANT_KINDS: ReadonlyArray<{ key: string; label: string; help?: string }> = [
  { key: "skills", label: "Skills" },
  { key: "expertise", label: "Expertise", help: "Expertise needs proficiency in the same skill from somewhere." },
  { key: "tools", label: "Tools" },
  { key: "languages", label: "Languages" },
  { key: "armor", label: "Armour" },
  { key: "weapons", label: "Weapons" },
  { key: "saves", label: "Saving throws" },
  { key: "damageResistances", label: "Damage resistances" },
  { key: "damageImmunities", label: "Damage immunities" },
  { key: "conditionImmunities", label: "Condition immunities" },
  { key: "spells", label: "Spells", help: "Always ready, and they don't count against what the character can prepare." }
];

export type GrantRow = Readonly<{ rowId: string; kind: string; values: readonly string[] }>;

/**
 * The grants editor's own read and write, exported so tests drive the control's real path:
 * `GrantsEditor` has no `FieldDef`s, so `authoring-harness.ts` exempts `grants`.
 *
 * `spells` rows hold spell ids; the body stores `{id, alwaysPrepared}`. `level` and `ability` are
 * not written: the builder resolves the level from the spell record and the ability falls back to
 * the caster's own.
 */
export function grantRowsOf(grants: Record<string, unknown>): readonly GrantRow[] {
  return GRANT_KINDS.filter((kind) => Array.isArray(grants[kind.key])).map((kind) => ({
    rowId: kind.key,
    kind: kind.key,
    values:
      kind.key === "spells"
        ? (grants.spells as ReadonlyArray<{ id?: string }>).map((spell) => String(spell?.id ?? ""))
        : ((grants[kind.key] as string[]) ?? [])
  }));
}

/**
 * Rows back into the bag, carrying through untouched every key this editor has no row for. The
 * rebuild emits only `GRANT_KINDS` keys, so without the carry an edit would delete the rest; today
 * that is `grants.when`, and dropping it would turn a conditional immunity (e.g. while raging) into
 * a permanent one. `grant-gate-preservation.mirror.test.ts` pins the partition against
 * `FeatureGrantsFieldsSchema.shape`. A carried key keeps the block alive with zero rows, so the gate
 * is never dropped.
 */
export function grantsFromRows(
  rows: readonly GrantRow[],
  previous: Record<string, unknown>
): Record<string, unknown> | undefined {
  const bag: Record<string, unknown> = {};
  for (const row of rows) {
    if (!row.kind) continue;
    bag[row.kind] = row.kind === "spells" ? row.values.map((id) => ({ id, alwaysPrepared: true })) : row.values;
  }
  for (const [key, carried] of Object.entries(previous)) {
    if (!GRANT_KINDS.some((kind) => kind.key === key)) bag[key] = carried;
  }
  return Object.keys(bag).length > 0 ? bag : undefined;
}

/** The canonical vocabulary each open-slug grant kind suggests. Skills and saves are closed chip sets. */
const grantSuggestions = (kind: string, ctx: SchemaContext): readonly string[] => {
  if (kind === "damageResistances" || kind === "damageImmunities") return ctx.damageTypes;
  if (kind === "conditionImmunities") return ctx.conditions;
  if (kind === "weapons") return WEAPON_GRANT_SUGGESTIONS;
  if (kind === "armor") return ARMOR_GRANT_SUGGESTIONS;
  return [];
};

/** Common armour proficiency slugs; open sets, so suggestions only. */
const ARMOR_GRANT_SUGGESTIONS: readonly string[] = ["light-armor", "medium-armor", "heavy-armor", "shields"];
const WEAPON_GRANT_SUGGESTIONS: readonly string[] = ["simple-weapons", "martial-weapons"];

const GRANT_PLACEHOLDERS: Readonly<Record<string, string>> = {
  armor: "light-armor",
  weapons: "simple-weapons",
  tools: "thieves-tools",
  languages: "elvish",
  damageResistances: "fire",
  damageImmunities: "poison",
  conditionImmunities: "charmed"
};

export function GrantsEditor({
  value,
  onChange,
  ctx,
  scope
}: Readonly<{ value: Draft; onChange: (next: Draft) => void; ctx: SchemaContext; scope: RiderScope }>) {
  const stored = value.grants;
  // Memoised on the stored bag, so the rows are rebuilt only when the grants themselves change.
  const grants = useMemo(() => (stored ?? {}) as Record<string, unknown>, [stored]);
  const rows = useMemo<readonly GrantRow[]>(() => grantRowsOf(grants), [grants]);

  // Pass the current bag so keys without rows (e.g. `grants.when`) are preserved.
  const write = (next: readonly GrantRow[]) => onChange({ ...value, grants: grantsFromRows(next, grants) });

  /** No `spells` kind on an item: the item body parses `grants.spells`, but `takeGrants` never reads
      it for equipped items. */
  const kinds = GRANT_KINDS.filter((kind) => kind.key !== "spells" || scope !== "item");
  const unused = kinds.filter((kind) => !rows.some((row) => row.kind === kind.key));

  return (
    <div className="hb-field">
      <span className="nh-field-label">Grants</span>
      <p className="nh-field-help">
        Proficiencies and languages this hands out for free.
        {/* Only an item's grants have a different lifecycle (removed when it comes off). */}
        {scope === "item" ? " They come back off the sheet when the item comes off." : ""}
      </p>
      <RowEditor
        rows={rows}
        onChange={write}
        rowKey={(row) => row.rowId}
        onAdd={() => ({ rowId: newId(), kind: unused[0]?.key ?? "", values: [] })}
        addLabel="Grant something"
        emptyText="Nothing granted yet."
        max={kinds.length}
        maxReachedReason="Every kind of grant is already on the list."
        reorderable={false}
        ariaLabel="Grants"
        rowLabel={(row) => {
          const label = GRANT_KINDS.find((kind) => kind.key === row.kind)?.label ?? "Grant";
          // A collapsed spells row shows names, not ids.
          const shown =
            row.kind === "spells"
              ? row.values.map((id) => ctx.spells.find((entry) => entry.id === id)?.name ?? id)
              : row.values;
          return shown.length > 0 ? `${label}: ${shown.join(", ")}` : label;
        }}
        renderRow={(row, index) => {
          const meta = GRANT_KINDS.find((kind) => kind.key === row.kind);
          const options =
            row.kind === "saves" ? ABILITIES : row.kind === "skills" || row.kind === "expertise" ? ctx.skills : null;
          const replace = (patch: Partial<GrantRow>) =>
            write(rows.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
          // A body carrying a kind this scope doesn't offer (e.g. an imported item's spell grant)
          // still shows its own row.
          const kindOptions = kinds.some((kind) => kind.key === row.kind)
            ? kinds
            : [...kinds, ...GRANT_KINDS.filter((kind) => kind.key === row.kind)];
          return (
            <FieldGrid>
              <Field label="What">
                <Select value={row.kind} onChange={(event) => replace({ kind: event.target.value, values: [] })}>
                  {kindOptions.map((kind) => (
                    <option
                      key={kind.key}
                      value={kind.key}
                      disabled={kind.key !== row.kind && rows.some((entry) => entry.kind === kind.key)}
                    >
                      {kind.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Which" help={meta?.help} className="nh-fieldgrid-wide">
                {row.kind === "spells" ? (
                  /* A spell id can't be typed reliably, so this uses the searchable `CatalogPicker`
                     plus removable chips. The picker appends and resets; the chips are the value. */
                  <div className="hb-chips" role="group" aria-label="Which spells">
                    {row.values.map((id) => {
                      const name = ctx.spells.find((entry) => entry.id === id)?.name ?? id;
                      return (
                        <Chip
                          key={id}
                          onRemove={() => replace({ values: row.values.filter((entry) => entry !== id) })}
                          removeLabel={`Remove ${name}`}
                        >
                          {name}
                        </Chip>
                      );
                    })}
                    <CatalogPicker
                      entries={ctx.spells.filter((entry) => !row.values.includes(entry.id))}
                      value={null}
                      onChange={(next) => {
                        if (next) replace({ values: [...row.values, next] });
                      }}
                      emptyLabel="Add a spell"
                      title="Spells this grants"
                      searchPlaceholder="Search spells…"
                      ariaLabel="Which spells"
                    />
                  </div>
                ) : options ? (
                  <div className="hb-chips" role="group" aria-label={`Which ${meta?.label.toLowerCase() ?? "grants"}`}>
                    {options.map((option) => {
                      const on = row.values.includes(option.value);
                      return (
                        <Chip
                          key={option.value}
                          pressed={on}
                          onClick={() =>
                            replace({
                              values: on
                                ? row.values.filter((entry) => entry !== option.value)
                                : [...row.values, option.value]
                            })
                          }
                        >
                          {option.label}
                        </Chip>
                      );
                    })}
                  </div>
                ) : (
                  /* Free entry with canonical suggestions; `slugify` normalises input. */
                  <TagInput
                    ariaLabel={`Which ${meta?.label.toLowerCase() ?? "grants"}`}
                    values={row.values}
                    onChange={(values) => replace({ values })}
                    suggestions={grantSuggestions(row.kind, ctx)}
                    /* Set for the control rather than per kind; `TagInput` falls back to a plain input
                       for kinds with no list (tools, languages). */
                    pick
                    optionLabel={suggestionLabel}
                    placeholder={GRANT_PLACEHOLDERS[row.kind] ?? "light-armor"}
                  />
                )}
              </Field>
            </FieldGrid>
          );
        }}
      />
    </div>
  );
}

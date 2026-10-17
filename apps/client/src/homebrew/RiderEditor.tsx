/**
 * The rider sub-form, shared by features, items and stat blocks, because the server defines one
 * rider vocabulary (`featureRiders`). Carriers differ only through `scope`, `enabled` and `labels`:
 * an item never asks a choice, its `uses` read as "Charges", and its riders (including `grants`)
 * apply only while equipped (and attuned, if required). Item contributions are recomputed from the
 * inventory on every write, which is what removes them on unequip.
 *
 * The word "trigger" never appears on screen: gating conditions show as three `<optgroup>`s
 * labelled with the phrase each completes (Only while…, Only when…, Only for…).
 */

import { useMemo } from "react";
import { FieldGrid } from "@vtt/ui";
import { FieldRenderer } from "./FieldRenderer";
import { type Draft, type FieldDef, type SchemaContext } from "./schema";
import { GrantsEditor } from "./riders/GrantsEditor";
import { type RiderKind, type RiderScope } from "./vocabulary";
import { actionsField, tagsField, usesField } from "./riders/actions";
import { effectsField } from "./riders/effects";
import { modifiersField } from "./riders/modifiers";
import { whenField } from "./riders/triggers";

export const ALL_RIDERS: readonly RiderKind[] = ["modifiers", "grants", "uses", "tags", "actions", "effects"];

/**
 * The rider field definitions, flattened, for `vocabularies.test.ts` and `authoring-harness.ts`.
 * Scoped like the carrier: a stat block mounts only `tags` and `actions`, since
 * `ActorDefinitionSchema` has no record-level `modifiers`, `uses` or `effects`.
 *
 * `grants` is absent: `GrantsEditor` is bespoke JSX with no `FieldDef`s, so it stays on the
 * harness's exemption list and tests drive `grantRowsOf`/`grantsFromRows` instead.
 */
export function riderFieldsForTest(scope: RiderScope): readonly FieldDef[] {
  // What `RecordDetail` enables on a monster, in render order.
  if (scope === "statblock") return [tagsField("Tags"), actionsField(scope)];
  return [
    whenField(),
    modifiersField("What it does", scope),
    usesField(scope === "item" ? "Charges" : "Limited uses", scope),
    tagsField("Tags"),
    actionsField(scope),
    effectsField(scope)
  ];
}

export const RIDER_FIELDS_FOR_TEST: readonly FieldDef[] = riderFieldsForTest("item");

/** Items get every rider except `choice`, since an item never asks a question at character
    creation. Item grants are layered over the sheet and removed on unequip. */
export const ITEM_RIDERS: readonly RiderKind[] = ["modifiers", "grants", "uses", "actions", "effects", "tags"];

export function RiderEditor({
  value,
  onChange,
  enabled = ALL_RIDERS,
  scope,
  labels,
  ctx,
  idPrefix
}: Readonly<{
  value: Draft;
  onChange: (next: Draft) => void;
  enabled?: readonly RiderKind[];
  scope: RiderScope;
  labels?: Partial<Record<RiderKind, string>>;
  ctx: SchemaContext;
  idPrefix: string;
}>) {
  const label = (kind: RiderKind, fallback: string) => labels?.[kind] ?? fallback;

  const fields = useMemo<readonly FieldDef[]>(() => {
    const list: FieldDef[] = [];
    if (enabled.includes("modifiers")) list.push(modifiersField(label("modifiers", "Modifiers"), scope));
    if (enabled.includes("uses"))
      list.push(usesField(label("uses", scope === "item" ? "Charges" : "Limited uses"), scope));
    if (enabled.includes("tags")) list.push(tagsField(label("tags", "Tags")));
    if (enabled.includes("actions")) list.push(actionsField(scope));
    if (enabled.includes("effects")) list.push(effectsField(scope));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scope, labels]);

  return (
    <div className="hb-riders">
      {/* The mental model in one sentence, per carrier. */}
      <p className="hb-riders-when">
        {scope === "item"
          ? (value.attunement as { required?: boolean } | undefined)?.required === true
            ? "These apply while the item is equipped and attuned."
            : "These apply while the item is equipped."
          : scope === "statblock"
            ? "These belong to the stat block and always apply."
            : "These apply as soon as the feature is granted."}
      </p>

      {/* Display-only preview of what the sheet will show for this item's attack. */}
      {scope === "item" && attackReadout(value) && <p className="hb-riders-readout tabular">{attackReadout(value)}</p>}

      <FieldGrid>
        {enabled.includes("modifiers") && (
          <FieldRenderer
            field={fields[0]}
            value={value}
            onValue={onChange}
            draft={value}
            onDraft={onChange}
            ctx={ctx}
            idPrefix={idPrefix}
          />
        )}
        {enabled.includes("grants") && <GrantsEditor value={value} onChange={onChange} ctx={ctx} scope={scope} />}
        {fields
          .filter((field) => field.key !== "modifiers")
          .map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              value={value}
              onValue={onChange}
              draft={value}
              onDraft={onChange}
              ctx={ctx}
              idPrefix={idPrefix}
            />
          ))}
      </FieldGrid>
    </div>
  );
}

/** "+1 to hit · 1d8 slashing + 1d4 lightning": the weapon's damage plus every rider that adds to a
    swing. Returns `""` when there is nothing to say. */
export function attackReadout(value: Draft): string {
  const modifiers = (Array.isArray(value.modifiers) ? value.modifiers : []) as Array<Record<string, unknown>>;
  const weapon = value.weapon as Record<string, unknown> | null | undefined;

  const toHit = modifiers
    .filter((modifier) => modifier.type === "attack-bonus" && typeof modifier.amount === "number")
    .reduce((total, modifier) => total + (modifier.amount as number), 0);

  const damage: string[] = [];
  if (weapon && typeof weapon.damageDice === "string" && weapon.damageDice.trim() !== "") {
    damage.push(`${weapon.damageDice.trim()}${weapon.damageType ? ` ${String(weapon.damageType).trim()}` : ""}`);
  }
  for (const modifier of modifiers) {
    if (modifier.type !== "extra-damage" || typeof modifier.formula !== "string" || modifier.formula.trim() === "")
      continue;
    damage.push(`${modifier.formula.trim()}${modifier.damageType ? ` ${String(modifier.damageType).trim()}` : ""}`);
  }

  const parts: string[] = [];
  if (toHit !== 0) parts.push(`${toHit > 0 ? "+" : ""}${toHit} to hit`);
  if (damage.length > 0) parts.push(damage.join(" + "));
  return parts.join(" · ");
}

/** A one-line summary of what a record's riders do, for a collapsed row. */
export function riderSummary(value: Draft): string {
  const parts: string[] = [];
  const modifiers = Array.isArray(value.modifiers) ? value.modifiers.length : 0;
  const actions = Array.isArray(value.actions) ? value.actions.length : 0;
  const effects = Array.isArray(value.effects) ? value.effects.length : 0;
  const grants =
    value.grants && typeof value.grants === "object"
      ? Object.values(value.grants as object).filter((entry) => Array.isArray(entry) && entry.length > 0).length
      : 0;
  if (modifiers) parts.push(`${modifiers} ${modifiers === 1 ? "modifier" : "modifiers"}`);
  if (grants) parts.push(`${grants} ${grants === 1 ? "grant" : "grants"}`);
  if (actions) parts.push(`${actions} ${actions === 1 ? "action" : "actions"}`);
  if (effects) parts.push(effects === 1 ? "an effect" : `${effects} effects`);
  if (value.uses) parts.push("limited uses");
  return parts.join(" · ");
}

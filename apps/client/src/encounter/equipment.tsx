import { useEffect, useMemo, useState } from "react";
import type { ContentEquipmentSummary } from "@vtt/domain";
import { Input, Modal } from "@vtt/ui";
import { read } from "../lib/command";
import { registerContentCache } from "../content/invalidate";
import { titleCase } from "./format";

/**
 * One shared, session-cached fetch of the equipment catalog, so every sheet browses the same list.
 * Transient misses are not cached (retried on the next open). The attribution line is kept for
 * any surface showing the gear.
 */
let catalogCache: readonly ContentEquipmentSummary[] | null = null;
let attributionCache: string | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<(catalog: readonly ContentEquipmentSummary[]) => void>();
function requestEquipmentReference(force = false) {
  if (catalogCache && !force) return;
  inFlight ??= read("content:equipment", {}).then((result) => {
    inFlight = null;
    if (result.ok && result.equipment && result.equipment.length > 0) {
      catalogCache = result.equipment;
      attributionCache = result.attribution ?? null;
      for (const listener of listeners) listener(catalogCache);
    }
  });
}

// A homebrew item can be published mid-session; a cold cache does nothing (see `content/invalidate.ts`).
registerContentCache(() => {
  if (catalogCache) requestEquipmentReference(true);
});

export function useEquipmentReference(): Readonly<{
  catalog: readonly ContentEquipmentSummary[];
  attribution: string | null;
}> {
  const [catalog, setCatalog] = useState<readonly ContentEquipmentSummary[]>(catalogCache ?? []);
  useEffect(() => {
    // Subscribe even with a warm cache, so a later invalidation still reaches this consumer.
    if (catalogCache) setCatalog(catalogCache);
    listeners.add(setCatalog);
    requestEquipmentReference();
    return () => {
      listeners.delete(setCatalog);
    };
  }, []);
  return { catalog, attribution: attributionCache };
}

/**
 * The catalog's weapon block, narrowed to what an inventory row may carry. `ItemWeaponSchema` is
 * `.strict()` and has no `mastery` (masteries resolve by item id once unlocked), so spreading the
 * browse summary's block makes `character.set-inventory` refuse every SRD weapon. `properties` must
 * be carried: `weaponPropertiesOf` reads it off the inventory row (Finesse, Reach).
 * Exported for `catalog-add.mirror.test.ts`.
 */
export function inventoryWeaponFrom(weapon: NonNullable<ContentEquipmentSummary["weapon"]>) {
  return {
    category: weapon.category,
    damageDice: weapon.damageDice,
    damageType: weapon.damageType,
    rangeFeet: weapon.rangeFeet,
    longRangeFeet: weapon.longRangeFeet,
    ...(weapon.properties ? { properties: [...weapon.properties] } : {})
  };
}

const categoryLabel = (category: string) => category.split("-").map(titleCase).join(" ");

/** The picker's filter groups, each folding one or more catalog categories. */
const FILTERS: ReadonlyArray<{ id: string; label: string; categories: readonly string[] }> = [
  { id: "all", label: "All", categories: [] },
  { id: "weapon", label: "Weapons", categories: ["weapon"] },
  { id: "armor", label: "Armor", categories: ["armor", "shield"] },
  { id: "gear", label: "Gear", categories: ["adventuring-gear"] },
  { id: "tool", label: "Tools", categories: ["tool"] },
  { id: "focus", label: "Focuses", categories: ["focus"] },
  { id: "consumable", label: "Consumables", categories: ["consumable"] },
  { id: "pack", label: "Packs", categories: ["equipment-pack"] },
  { id: "ammunition", label: "Ammo", categories: ["ammunition"] },
  { id: "wondrous", label: "Wondrous", categories: ["wondrous-item"] },
  { id: "ring", label: "Rings", categories: ["ring"] },
  { id: "implement", label: "Wands & Rods", categories: ["wand", "staff", "rod"] }
];

/** "2 gp" / "1 sp" / "5 cp": the smallest whole coin, so sub-gp costs read naturally. */
function formatCost(costGp: number | null): string | null {
  if (costGp === null || costGp === 0) return null;
  if (costGp >= 1) return `${costGp} gp`;
  const sp = costGp * 10;
  if (Number.isInteger(sp)) return `${sp} sp`;
  return `${Math.round(costGp * 100)} cp`;
}

/** The one-line detail under each catalog row: what it is plus the numbers that matter for that kind. */
function metaLine(item: ContentEquipmentSummary): string {
  const parts: string[] = [categoryLabel(item.category)];
  if (item.weapon) {
    parts.push(`${item.weapon.damageDice} ${item.weapon.damageType}`);
    if (item.weapon.rangeFeet)
      parts.push(
        `range ${item.weapon.rangeFeet}${item.weapon.longRangeFeet ? `/${item.weapon.longRangeFeet}` : ""} ft`
      );
  }
  if (item.armor)
    parts.push(
      item.category === "shield"
        ? `+${item.armor.acBase} AC`
        : `AC ${item.armor.acBase}${item.armor.addDexModifier ? " + Dex" : ""}`
    );
  const cost = formatCost(item.costGp);
  if (cost) parts.push(cost);
  if (item.weightLb) parts.push(`${item.weightLb} lb`);
  return parts.join(" · ");
}

/**
 * The eligible-base list for a template magic item ("Weapon (Any Simple or Martial)"), shared by the
 * picker's chooser step and the sheet's bind prompt. Each row shows the base's own numbers. Bases the
 * catalog cannot resolve (e.g. a deleted homebrew base) are omitted; the server would refuse them.
 */
export function BaseOptionList({
  template,
  catalog,
  busy,
  query,
  onPick
}: Readonly<{
  template: ContentEquipmentSummary;
  catalog: readonly ContentEquipmentSummary[];
  busy: boolean;
  query: string;
  onPick: (baseId: string) => void;
}>) {
  const needle = query.trim().toLowerCase();
  const bases = (template.appliesTo?.baseIds ?? [])
    .map((id) => catalog.find((entry) => entry.id === id))
    .filter((base): base is ContentEquipmentSummary => base !== undefined)
    .filter((base) => !needle || base.name.toLowerCase().includes(needle));
  if (bases.length === 0)
    return (
      <p className="sheet-picker-empty">
        {needle ? "No base matches that search." : "None of this item's bases are in the catalog."}
      </p>
    );
  return (
    <ul className="sheet-picker-list scroll-y">
      {bases.map((base) => (
        <li key={base.id}>
          <div className="sheet-picker-item">
            <span className="sheet-picker-name">{base.name}</span>
            <span className="sheet-picker-meta">{metaLine(base)}</span>
          </div>
          <button
            type="button"
            className="sheet-picker-add tap-target"
            disabled={busy}
            aria-label={`Make it a ${base.name}`}
            onClick={() => onPick(base.id)}
          >
            Pick
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The sheet's chooser for an older template row that has no base picked: same list, own modal. */
export function BindItemModal({
  template,
  busy,
  onPick,
  onClose
}: Readonly<{
  template: ContentEquipmentSummary;
  busy: boolean;
  onPick: (baseId: string) => void;
  onClose: () => void;
}>) {
  const { catalog } = useEquipmentReference();
  const [query, setQuery] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      accent="cyan"
      title={`${template.name} — what is it?`}
      ariaLabel={`Choose which ${template.category} ${template.name} is`}
    >
      <p className="sheet-picker-empty">
        {template.name} applies to {template.appliesTo?.label ?? "a base"}. Pick which one it is - its numbers come from
        that choice.
      </p>
      <div className="sheet-picker-controls">
        <Input
          type="search"
          className="sheet-picker-search"
          value={query}
          maxLength={60}
          placeholder="Search…"
          aria-label="Search bases"
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
      </div>
      <BaseOptionList template={template} catalog={catalog} busy={busy} query={query} onPick={onPick} />
    </Modal>
  );
}

/**
 * Browse-and-add picker for the sheet's Inventory. Presentational: it calls `onAdd` with the chosen
 * entry and the sheet owns the mutation (so it can grow an existing stack). Owner + GM only (the
 * sheet gates it).
 *
 * A template item with a real choice inserts one step: the same window lists the eligible bases and
 * the add completes with the pick. A single-base template never asks (the server auto-binds), and
 * re-adding an owned template grows the stack, keeping its pick.
 */
export function EquipmentPicker({
  ownedCounts,
  busy,
  onAdd,
  onClose
}: Readonly<{
  ownedCounts: ReadonlyMap<string, number>;
  busy: boolean;
  onAdd: (item: ContentEquipmentSummary, baseId?: string) => void;
  onClose: () => void;
}>) {
  const { catalog, attribution } = useEquipmentReference();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [choosing, setChoosing] = useState<ContentEquipmentSummary | null>(null);
  const active = FILTERS.find((entry) => entry.id === filter) ?? FILTERS[0];
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.filter((item) => {
      if (active.categories.length > 0 && !active.categories.includes(item.category)) return false;
      if (needle && !item.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [catalog, query, active]);

  const startAdd = (item: ContentEquipmentSummary) => {
    const owned = (ownedCounts.get(item.id) ?? 0) > 0;
    // Only for a real choice on a new row: an owned template already has its pick (rows are keyed by
    // item id), and re-adding just grows the stack.
    if (!owned && item.appliesTo && item.appliesTo.baseIds.length > 1) {
      setQuery("");
      setChoosing(item);
      return;
    }
    onAdd(item);
  };

  if (choosing) {
    return (
      <Modal
        open
        onClose={onClose}
        size="lg"
        accent="cyan"
        title={`${choosing.name} — what is it?`}
        ariaLabel={`Choose which ${choosing.category} ${choosing.name} is`}
      >
        <p className="sheet-picker-empty">
          {choosing.name} applies to {choosing.appliesTo?.label}. Pick which one it is - its dice, reach and properties
          come from that choice.
        </p>
        <div className="sheet-picker-controls">
          <Input
            type="search"
            className="sheet-picker-search"
            value={query}
            maxLength={60}
            placeholder="Search…"
            aria-label="Search bases"
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
          <button
            type="button"
            className="sheet-picker-chip"
            onClick={() => {
              setQuery("");
              setChoosing(null);
            }}
          >
            Back to the list
          </button>
        </div>
        <BaseOptionList
          template={choosing}
          catalog={catalog}
          busy={busy}
          query={query}
          onPick={(baseId) => {
            onAdd(choosing, baseId);
            setQuery("");
            setChoosing(null);
          }}
        />
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      accent="cyan"
      title="Add equipment"
      ariaLabel="Browse the SRD equipment catalog"
    >
      <div className="sheet-picker-controls">
        <Input
          type="search"
          className="sheet-picker-search"
          value={query}
          maxLength={60}
          placeholder="Search equipment…"
          aria-label="Search equipment"
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
        <div className="sheet-picker-filters" role="group" aria-label="Filter by category">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`sheet-picker-chip${entry.id === filter ? " is-active" : ""}`}
              aria-pressed={entry.id === filter}
              onClick={() => setFilter(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      {catalog.length === 0 ? (
        <p className="sheet-picker-empty">Loading the catalog…</p>
      ) : results.length === 0 ? (
        <p className="sheet-picker-empty">No equipment matches that search.</p>
      ) : (
        <ul className="sheet-picker-list scroll-y">
          {results.map((item) => {
            const owned = ownedCounts.get(item.id) ?? 0;
            return (
              <li key={item.id}>
                {/* The description's first sentence is the SRD type line, the only place a magic item's rarity
                and attunement requirement appear (magic rows carry no cost or weight for `metaLine`).
                Clamped to one line. */}
                <div className="sheet-picker-item">
                  <span className="sheet-picker-name">
                    {item.name}
                    {owned > 0 && (
                      <span className="sheet-picker-owned" aria-label={`${owned} in pack`}>
                        ×{owned}
                      </span>
                    )}
                  </span>
                  <span className="sheet-picker-meta">{metaLine(item)}</span>
                  {item.description && <span className="sheet-picker-desc">{item.description}</span>}
                </div>
                {/* `.tap-target` reaches the 44px floor through a centred `::after` (the material uses `::before`),
                so the row's rhythm does not change. */}
                <button
                  type="button"
                  className="sheet-picker-add tap-target"
                  disabled={busy}
                  aria-label={`Add ${item.name}`}
                  onClick={() => startAdd(item)}
                >
                  Add
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {attribution && <p className="sheet-picker-attribution">{attribution}</p>}
    </Modal>
  );
}

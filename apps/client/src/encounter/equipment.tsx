import { useEffect, useMemo, useState } from "react";
import type { ContentEquipmentSummary } from "@vtt/domain";
import { Input, Modal } from "@vtt/ui";
import { socket } from "../socket";
import { registerContentCache } from "../content/invalidate";

/**
 * One shared fetch of the SRD equipment catalog (the framework the browse-and-add picker and the
 * future homebrew update build on), cached for the session so every sheet browses the same list.
 * Transient misses are not cached - a retry runs on the next open - mirroring the spell/condition
 * reference fetches. The attribution line rides along so any surface showing the gear can display it.
 */
let catalogCache: readonly ContentEquipmentSummary[] | null = null;
let attributionCache: string | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<(catalog: readonly ContentEquipmentSummary[]) => void>();
function requestEquipmentReference(force = false) {
  if (catalogCache && !force) return;
  inFlight ??= new Promise((resolve) => {
    socket.emit("content:equipment", {}, (result) => {
      inFlight = null;
      if (result.ok && result.equipment && result.equipment.length > 0) {
        catalogCache = result.equipment;
        attributionCache = result.attribution ?? null;
        for (const listener of listeners) listener(catalogCache);
      }
      resolve();
    });
  });
}

// A homebrew item can be published mid-session, so this catalog is not fixed for the
// session any more. Nothing happens for a cold cache. See `content/invalidate.ts`.
registerContentCache(() => { if (catalogCache) requestEquipmentReference(true); });

export function useEquipmentReference(): Readonly<{ catalog: readonly ContentEquipmentSummary[]; attribution: string | null }> {
  const [catalog, setCatalog] = useState<readonly ContentEquipmentSummary[]>(catalogCache ?? []);
  useEffect(() => {
    // Subscribe unconditionally: a consumer mounting with a warm cache still has to hear
    // about the swap when a publish invalidates it.
    if (catalogCache) setCatalog(catalogCache);
    listeners.add(setCatalog);
    requestEquipmentReference();
    return () => { listeners.delete(setCatalog); };
  }, []);
  return { catalog, attribution: attributionCache };
}

/**
 * THE CATALOG'S WEAPON BLOCK, NARROWED TO WHAT AN INVENTORY ROW MAY CARRY.
 *
 * These are two different shapes and the difference is load-bearing. The browse summary is the
 * catalog record's own block, so it carries `mastery`; `ItemWeaponSchema` (`@vtt/schemas`) is
 * `.strict()` and has no such key, because a mastery is gated on the bearer having UNLOCKED that
 * weapon and resolves against the catalog by item id rather than travelling on the row. Spreading
 * the summary's block wholesale therefore made `character.set-inventory` refuse every SRD weapon
 * with *"Unrecognized key(s) in object: 'mastery'"* - the browse-and-add picker could not add a
 * sword.
 *
 * `properties` goes the other way and must be carried: `weaponPropertiesOf` reads it off the
 * INVENTORY row, and it is what makes a Rapier swing off Dexterity and a Glaive threaten at 10 feet.
 *
 * Exported so `catalog-add.mirror.test.ts` can drive the real SRD catalog through it and the
 * server's own schema, which is the seam where those two shapes have to agree.
 */
export function inventoryWeaponFrom(weapon: NonNullable<ContentEquipmentSummary["weapon"]>) {
  return {
    category: weapon.category, damageDice: weapon.damageDice, damageType: weapon.damageType,
    rangeFeet: weapon.rangeFeet, longRangeFeet: weapon.longRangeFeet,
    ...(weapon.properties ? { properties: [...weapon.properties] } : {})
  };
}

const titleCase = (value: string) => value.length ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
const categoryLabel = (category: string) => category.split("-").map(titleCase).join(" ");

/**
 * The filter groups the picker offers, each folding one or more catalog categories.
 *
 * The last three arrived with the SRD's 268 magic items. Without them `wondrous-item`, `ring`,
 * `wand`, `staff` and `rod` were reachable only from "All" - a 400-row list on a phone - because
 * every existing chip names a category the mundane bundle already had.
 */
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

/** "2 gp" / "1 sp" / "5 cp" - render the smallest whole coin so sub-gp costs read naturally. */
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
    if (item.weapon.rangeFeet) parts.push(`range ${item.weapon.rangeFeet}${item.weapon.longRangeFeet ? `/${item.weapon.longRangeFeet}` : ""} ft`);
  }
  if (item.armor) parts.push(item.category === "shield" ? `+${item.armor.acBase} AC` : `AC ${item.armor.acBase}${item.armor.addDexModifier ? " + Dex" : ""}`);
  const cost = formatCost(item.costGp);
  if (cost) parts.push(cost);
  if (item.weightLb) parts.push(`${item.weightLb} lb`);
  return parts.join(" · ");
}

/**
 * C9: the eligible-base list for a TEMPLATE magic item ("Weapon (Any Simple or Martial)"), shared by
 * the picker's chooser step and the sheet's bind-a-legacy-row prompt so the two can never drift.
 * Each row shows the base's own numbers - the pick is a real decision (a greatsword and a dagger are
 * different weapons) and the player should not need a rulebook open to make it. Bases the catalog
 * cannot resolve (a homebrew base since deleted) are omitted rather than offered: the server would
 * refuse the bind anyway, and offering a dead option is worse than a shorter list.
 */
export function BaseOptionList({ template, catalog, busy, query, onPick }: Readonly<{
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
  if (bases.length === 0) return <p className="sheet-picker-empty">{needle ? "No base matches that search." : "None of this item's bases are in the catalog."}</p>;
  return <ul className="sheet-picker-list scroll-y">
    {bases.map((base) => <li key={base.id}>
      <div className="sheet-picker-item">
        <span className="sheet-picker-name">{base.name}</span>
        <span className="sheet-picker-meta">{metaLine(base)}</span>
      </div>
      <button type="button" className="sheet-picker-add tap-target" disabled={busy} aria-label={`Make it a ${base.name}`} onClick={() => onPick(base.id)}>Pick</button>
    </li>)}
  </ul>;
}

/** The sheet's one-off chooser for a pre-C9 row that predates the pick: same list, its own modal. */
export function BindItemModal({ template, busy, onPick, onClose }: Readonly<{
  template: ContentEquipmentSummary;
  busy: boolean;
  onPick: (baseId: string) => void;
  onClose: () => void;
}>) {
  const { catalog } = useEquipmentReference();
  const [query, setQuery] = useState("");
  return <Modal open onClose={onClose} size="lg" accent="cyan" title={`${template.name} — what is it?`} ariaLabel={`Choose which ${template.category} ${template.name} is`}>
    <p className="sheet-picker-empty">{template.name} applies to {template.appliesTo?.label ?? "a base"}. Pick which one it is - its numbers come from that choice.</p>
    <div className="sheet-picker-controls">
      <Input type="search" className="sheet-picker-search" value={query} maxLength={60} placeholder="Search…" aria-label="Search bases" onChange={(event) => setQuery(event.target.value)} autoFocus />
    </div>
    <BaseOptionList template={template} catalog={catalog} busy={busy} query={query} onPick={onPick} />
  </Modal>;
}

/**
 * Browse-and-add-from-catalog picker for the sheet's Inventory. Presentational: it surfaces the SRD
 * catalog (searchable, category-filtered) and calls `onAdd` with the chosen entry; the sheet owns the
 * mutation so it can increment an existing stack instead of replacing it. Owner + GM only (the sheet
 * gates it), and the Modal renders full-screen on mobile.
 *
 * C9: a TEMPLATE item with a real choice ("Weapon, +1 - Any Simple or Martial") inserts ONE step:
 * the same window swaps to the eligible-base list and the add completes with the pick. A single-base
 * template (Dwarven Thrower is always a warhammer) never asks - the server auto-binds - and a
 * re-add of an owned template increments the stack keeping its existing pick, chooser skipped.
 */
export function EquipmentPicker({ ownedCounts, busy, onAdd, onClose }: Readonly<{
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
    // The chooser opens only when there is a real choice to make AND the row is new - an owned
    // template already made its pick (rows are keyed by item id, so a second differently-based
    // copy cannot exist anyway) and re-adding just grows the stack.
    if (!owned && item.appliesTo && item.appliesTo.baseIds.length > 1) {
      setQuery("");
      setChoosing(item);
      return;
    }
    onAdd(item);
  };

  if (choosing) {
    return <Modal open onClose={onClose} size="lg" accent="cyan" title={`${choosing.name} — what is it?`} ariaLabel={`Choose which ${choosing.category} ${choosing.name} is`}>
      <p className="sheet-picker-empty">{choosing.name} applies to {choosing.appliesTo?.label}. Pick which one it is - its dice, reach and properties come from that choice.</p>
      <div className="sheet-picker-controls">
        <Input type="search" className="sheet-picker-search" value={query} maxLength={60} placeholder="Search…" aria-label="Search bases" onChange={(event) => setQuery(event.target.value)} autoFocus />
        <button type="button" className="sheet-picker-chip" onClick={() => { setQuery(""); setChoosing(null); }}>Back to the list</button>
      </div>
      <BaseOptionList template={choosing} catalog={catalog} busy={busy} query={query} onPick={(baseId) => { onAdd(choosing, baseId); setQuery(""); setChoosing(null); }} />
    </Modal>;
  }

  return <Modal open onClose={onClose} size="lg" accent="cyan" title="Add equipment" ariaLabel="Browse the SRD equipment catalog">
    <div className="sheet-picker-controls">
      <input type="search" className="sheet-picker-search" value={query} maxLength={60} placeholder="Search equipment…" aria-label="Search equipment" onChange={(event) => setQuery(event.target.value)} autoFocus />
      <div className="sheet-picker-filters" role="group" aria-label="Filter by category">
        {FILTERS.map((entry) => <button key={entry.id} type="button" className={`sheet-picker-chip${entry.id === filter ? " is-active" : ""}`} aria-pressed={entry.id === filter} onClick={() => setFilter(entry.id)}>{entry.label}</button>)}
      </div>
    </div>
    {catalog.length === 0 ? <p className="sheet-picker-empty">Loading the catalog…</p>
      : results.length === 0 ? <p className="sheet-picker-empty">No equipment matches that search.</p>
      : <ul className="sheet-picker-list scroll-y">
        {results.map((item) => {
          const owned = ownedCounts.get(item.id) ?? 0;
          return <li key={item.id}>
            {/* The description's own first sentence is the SRD's printed type line, so a magic item
                shows its rarity and attunement requirement here. It has to be this field: a magic
                row carries no cost and no weight, so `metaLine` alone would read "Wondrous Item"
                for all 127 of them. Clamped to one line - the entry itself runs to 2000 characters
                and this is a 400-row list read mostly on a phone. */}
            <div className="sheet-picker-item">
              <span className="sheet-picker-name">{item.name}{owned > 0 && <span className="sheet-picker-owned" aria-label={`${owned} in pack`}>×{owned}</span>}</span>
              <span className="sheet-picker-meta">{metaLine(item)}</span>
              {item.description && <span className="sheet-picker-desc">{item.description}</span>}
            </div>
            {/* Route 2 (`.tap-target`): the button paints 45x27 and reaches the 44px floor through a
                centred `::after`, so the row's rhythm does not change. `::before` is the material's
                here, `::after` was free. It matters more than it looks: this control did nothing at
                all until the browse-and-add payload was fixed, so its touch ergonomics had never
                once been exercised - a 27px-tall target on the phone the sheet is mostly read on. */}
            <button type="button" className="sheet-picker-add tap-target" disabled={busy} aria-label={`Add ${item.name}`} onClick={() => startAdd(item)}>Add</button>
          </li>;
        })}
      </ul>}
    {attribution && <p className="sheet-picker-attribution">{attribution}</p>}
  </Modal>;
}

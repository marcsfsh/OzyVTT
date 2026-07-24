import { useEffect, useMemo, useState } from "react";
import type { ContentEquipmentSummary } from "@vtt/domain";
import { Modal } from "@vtt/ui";
import { socket } from "../socket";

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
function requestEquipmentReference() {
  if (catalogCache) return;
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

export function useEquipmentReference(): Readonly<{ catalog: readonly ContentEquipmentSummary[]; attribution: string | null }> {
  const [catalog, setCatalog] = useState<readonly ContentEquipmentSummary[]>(catalogCache ?? []);
  useEffect(() => {
    if (catalogCache) { setCatalog(catalogCache); return; }
    listeners.add(setCatalog);
    requestEquipmentReference();
    return () => { listeners.delete(setCatalog); };
  }, []);
  return { catalog, attribution: attributionCache };
}

const titleCase = (value: string) => value.length ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
const categoryLabel = (category: string) => category.split("-").map(titleCase).join(" ");

/** The filter groups the picker offers, each folding one or more catalog categories. */
const FILTERS: ReadonlyArray<{ id: string; label: string; categories: readonly string[] }> = [
  { id: "all", label: "All", categories: [] },
  { id: "weapon", label: "Weapons", categories: ["weapon"] },
  { id: "armor", label: "Armor", categories: ["armor", "shield"] },
  { id: "gear", label: "Gear", categories: ["adventuring-gear"] },
  { id: "tool", label: "Tools", categories: ["tool"] },
  { id: "focus", label: "Focuses", categories: ["focus"] },
  { id: "consumable", label: "Consumables", categories: ["consumable"] },
  { id: "pack", label: "Packs", categories: ["equipment-pack"] },
  { id: "ammunition", label: "Ammo", categories: ["ammunition"] }
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
 * Browse-and-add-from-catalog picker for the sheet's Inventory. Presentational: it surfaces the SRD
 * catalog (searchable, category-filtered) and calls `onAdd` with the chosen entry; the sheet owns the
 * mutation so it can increment an existing stack instead of replacing it. Owner + GM only (the sheet
 * gates it), and the Modal renders full-screen on mobile.
 */
export function EquipmentPicker({ ownedCounts, busy, onAdd, onClose }: Readonly<{
  ownedCounts: ReadonlyMap<string, number>;
  busy: boolean;
  onAdd: (item: ContentEquipmentSummary) => void;
  onClose: () => void;
}>) {
  const { catalog, attribution } = useEquipmentReference();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const active = FILTERS.find((entry) => entry.id === filter) ?? FILTERS[0];
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.filter((item) => {
      if (active.categories.length > 0 && !active.categories.includes(item.category)) return false;
      if (needle && !item.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [catalog, query, active]);

  return <Modal open onClose={onClose} size="lg" accent="cyan" title="Add equipment" ariaLabel="Browse the SRD equipment catalog">
    <div className="sheet-picker-controls">
      <input type="search" className="sheet-picker-search" value={query} maxLength={60} placeholder="Search equipment…" aria-label="Search equipment" onChange={(event) => setQuery(event.target.value)} autoFocus />
      <div className="sheet-picker-filters" role="group" aria-label="Filter by category">
        {FILTERS.map((entry) => <button key={entry.id} type="button" className={`sheet-picker-chip${entry.id === filter ? " is-active" : ""}`} aria-pressed={entry.id === filter} onClick={() => setFilter(entry.id)}>{entry.label}</button>)}
      </div>
    </div>
    {catalog.length === 0 ? <p className="sheet-picker-empty">Loading the catalog…</p>
      : results.length === 0 ? <p className="sheet-picker-empty">No equipment matches that search.</p>
      : <ul className="sheet-picker-list">
        {results.map((item) => {
          const owned = ownedCounts.get(item.id) ?? 0;
          return <li key={item.id}>
            <div className="sheet-picker-item">
              <span className="sheet-picker-name">{item.name}{owned > 0 && <span className="sheet-picker-owned" aria-label={`${owned} in pack`}>×{owned}</span>}</span>
              <span className="sheet-picker-meta">{metaLine(item)}</span>
            </div>
            <button type="button" className="sheet-picker-add" disabled={busy} aria-label={`Add ${item.name}`} onClick={() => onAdd(item)}>Add</button>
          </li>;
        })}
      </ul>}
    {attribution && <p className="sheet-picker-attribution">{attribution}</p>}
  </Modal>;
}

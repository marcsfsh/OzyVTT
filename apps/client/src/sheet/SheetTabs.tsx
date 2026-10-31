import { Tabs } from "@vtt/ui";

export type SheetTabId = "main" | "actions" | "spells" | "gear" | "features" | "notes" | "gm";

const TAB_META: Readonly<Record<SheetTabId, { label: string }>> = {
  main: { label: "Main" },
  actions: { label: "Actions" },
  spells: { label: "Spells" },
  gear: { label: "Gear" },
  features: { label: "Features" },
  notes: { label: "Notes" },
  gm: { label: "GM" }
};

export const tabLabel = (id: SheetTabId) => TAB_META[id].label;

/**
 * The one row of tabs a sheet shows where it is (ADR-0047). A laptop keeps the checks in columns of their own, so its
 * box opens on Actions; a phone and the Table panel open on Main, which holds those columns. The panel drops Actions in
 * a fight, where its Turn tab runs them. Spells appear only for a character with spells, and the GM's tab comes last.
 */
export function sheetTabs({
  layout,
  role,
  hasSpells,
  hidePlay
}: Readonly<{ layout: "narrow" | "wide" | "panel"; role: "gm" | "player"; hasSpells: boolean; hidePlay: boolean }>) {
  const ids: SheetTabId[] = ["main", "actions", "spells", "gear", "features", "notes", "gm"];
  return ids
    .filter((id) => !(id === "main" && layout === "wide"))
    .filter((id) => !(id === "actions" && hidePlay))
    .filter((id) => !(id === "spells" && !hasSpells))
    .filter((id) => !(id === "gm" && role !== "gm"));
}

/**
 * A tab remembered before the Ledger: Play and Checks are gone, so a phone reads either as Main and a laptop as
 * Actions. Rewrites the stored value once, so the remembered tab still opens where its contents went.
 */
export function migrateRememberedTab(key: string, layout: "narrow" | "wide" | "panel") {
  try {
    const stored = localStorage.getItem(key);
    if (stored === "play" || stored === "checks") localStorage.setItem(key, layout === "wide" ? "actions" : "main");
  } catch {
    /* private mode: nothing is remembered to move */
  }
}

/** Ties a tab to its panel, as the `Tabs` primitive does. */
export const tabIds = (idBase: string, id: SheetTabId) => ({
  tab: `${idBase}-tab-${id}`,
  panel: `${idBase}-panel-${id}`
});

/** The box's tabs on a laptop, and the strip pinned under the compact band on a phone and in the Table panel. */
export function SheetTabStrip({
  tabs,
  active,
  onChange,
  idBase,
  strip = false
}: Readonly<{
  tabs: readonly SheetTabId[];
  active: SheetTabId;
  onChange: (id: SheetTabId) => void;
  idBase: string;
  strip?: boolean;
}>) {
  return (
    <Tabs
      className={strip ? "cs-strip" : "cs-tabs"}
      ariaLabel="Sheet"
      idBase={idBase}
      activeId={active}
      onChange={(id) => onChange(id as SheetTabId)}
      tabs={tabs.map((id) => ({ id, label: TAB_META[id].label, ...(id === "gm" ? { className: "is-gm" } : {}) }))}
    />
  );
}

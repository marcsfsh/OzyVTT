import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { IconBag, IconBolt, IconDie, IconEye, IconPage, IconSparkle, IconStar, Tabs } from "@vtt/ui";

export type SheetTabId = "play" | "checks" | "spells" | "gear" | "features" | "notes" | "gm";

const TAB_META: Readonly<Record<SheetTabId, { label: string; icon: ReactNode }>> = {
  play: { label: "Play", icon: <IconBolt /> },
  checks: { label: "Checks", icon: <IconDie /> },
  spells: { label: "Spells", icon: <IconSparkle /> },
  gear: { label: "Gear", icon: <IconBag /> },
  features: { label: "Features", icon: <IconStar /> },
  notes: { label: "Notes", icon: <IconPage /> },
  gm: { label: "GM", icon: <IconEye /> }
};

export const tabLabel = (id: SheetTabId) => TAB_META[id].label;

/**
 * The tabs a sheet shows where it is. A phone's bottom bar has all six (the GM's swaps Notes for its GM tab); a
 * laptop keeps the checks in a column of their own; the table's panel drops Play in a fight, where its Turn tab
 * already shows it. Spells appear only for a character with spells.
 */
export function sheetTabs({
  layout,
  role,
  hasSpells,
  hidePlay
}: Readonly<{ layout: "narrow" | "wide" | "panel"; role: "gm" | "player"; hasSpells: boolean; hidePlay: boolean }>) {
  const ids: SheetTabId[] = ["play", "checks", "spells", "gear", "features", "notes"];
  return ids
    .filter((id) => !(id === "spells" && !hasSpells))
    .filter((id) => !(id === "checks" && layout === "wide"))
    .filter((id) => !(id === "play" && hidePlay))
    .map((id) => (id === "notes" && layout === "narrow" && role === "gm" ? "gm" : id));
}

/** Ties a tab to its panel, as the `Tabs` primitive does. */
export const tabIds = (idBase: string, id: SheetTabId) => ({
  tab: `${idBase}-tab-${id}`,
  panel: `${idBase}-panel-${id}`
});

/** The phone's tab bar under the thumb: an icon over each label, the chosen one raised with a cyan edge. */
export function SheetTabBar({
  tabs,
  active,
  onChange,
  idBase
}: Readonly<{ tabs: readonly SheetTabId[]; active: SheetTabId; onChange: (id: SheetTabId) => void; idBase: string }>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const to =
      event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + step + tabs.length) % tabs.length;
    if (!step && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    onChange(tabs[to]);
    refs.current[to]?.focus();
  };
  return (
    <div className="cs-tabbar" role="tablist" aria-label="Sheet">
      {tabs.map((id, index) => {
        const on = id === active;
        const ids = tabIds(idBase, id);
        return (
          <button
            key={id}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={ids.tab}
            aria-controls={ids.panel}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            className={`cs-tabbar-tab interactive${on ? " is-on" : ""}${id === "gm" ? " is-gm" : ""}`}
            onClick={() => onChange(id)}
            onKeyDown={(event) => move(event, index)}
          >
            <span className="cs-tabbar-icon" aria-hidden="true">
              {TAB_META[id].icon}
            </span>
            {TAB_META[id].label}
          </button>
        );
      })}
    </div>
  );
}

/** A laptop's tabs over the middle column, and the table panel's strip, which looks unlike the panel's own tabs. */
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
      tabs={tabs.map((id) => ({ id, label: TAB_META[id].label }))}
    />
  );
}

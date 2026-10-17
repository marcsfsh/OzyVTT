import { useEffect, useId, useState, type ReactNode } from "react";
import { Tabs } from "@vtt/ui";
import { FooterSlotContext } from "./footerSlot";
import "./table-panel.css";

export type PanelTab = Readonly<{
  id: string;
  label: ReactNode;
  content: ReactNode;
  /** The tab's content scrolls as one region; false when it brings its own regions (the GM's order and console). */
  scrolls?: boolean;
}>;

/**
 * The panel beside the map (under it on a phone): what must be answered first, then one tablist whose panels hold
 * the turn, the order, the sheet, the dice and the log, then a footer with the view's one primary button. Only the
 * chosen panel's content is mounted, so a long fight's log and sheets cost nothing while hidden.
 */
export function TablePanel({
  label,
  top,
  tabs,
  active,
  onActive,
  footer,
  phone = false
}: Readonly<{
  label: string;
  /** Needs you for the GM, the prompt slot for a player: above the tabs, never inside a scrolled list. */
  top?: ReactNode;
  tabs: readonly PanelTab[];
  active: string;
  onActive: (id: string) => void;
  footer?: ReactNode;
  /** On a phone the footer is the bar under the thumb, and a target picker's Cancel and Roll move into it. */
  phone?: boolean;
}>) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const idBase = `table-panel-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  return (
    <section className="table-panel" aria-label={label}>
      <FooterSlotContext.Provider value={phone ? slot : null}>
        {top}
        <Tabs
          className="table-panel-tabs"
          ariaLabel={label}
          idBase={idBase}
          activeId={current.id}
          onChange={onActive}
          tabs={tabs.map((tab) => ({ id: tab.id, label: tab.label }))}
        />
        {tabs.map((tab) => {
          const shown = tab.id === current.id;
          return (
            <div
              key={tab.id}
              className={`table-panel-body${tab.scrolls === false ? "" : " scroll-y"}`}
              role="tabpanel"
              id={`${idBase}-panel-${tab.id}`}
              aria-labelledby={`${idBase}-tab-${tab.id}`}
              hidden={!shown}
              tabIndex={tab.scrolls === false ? undefined : 0}
            >
              {shown ? tab.content : null}
            </div>
          );
        })}
      </FooterSlotContext.Provider>
      {(footer || phone) && (
        <div className="table-panel-foot">
          {phone && <div className="table-panel-foot-slot" ref={setSlot} />}
          {footer && <div className="table-panel-foot-main">{footer}</div>}
        </div>
      )}
    </section>
  );
}

/**
 * The chosen tab, remembered per device under `key` while it is one of `ids`. `fallback` is chosen whenever `reset`
 * changes (a fight starting or ending changes what the table is about) and when nothing usable is remembered.
 */
export function useRememberedTab(key: string, ids: readonly string[], fallback: string, reset: unknown) {
  const read = () => {
    try {
      const stored = localStorage.getItem(key);
      return stored && ids.includes(stored) ? stored : fallback;
    } catch {
      return fallback;
    }
  };
  const [active, setActive] = useState(read);
  const [resetSeen, setResetSeen] = useState(reset);
  if (resetSeen !== reset) {
    setResetSeen(reset);
    setActive(fallback);
  }
  useEffect(() => {
    try {
      localStorage.setItem(key, active);
    } catch {
      /* private mode: the table still works, it just won't remember the tab */
    }
  }, [key, active]);
  return [ids.includes(active) ? active : fallback, setActive] as const;
}

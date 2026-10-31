import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { PanelTab } from "./TablePanel";

/**
 * What the phone table hands its panel for the Switch (table spec 2.4, ADR-0050): the map, which becomes the Map view,
 * and the turn order's cards, which sit under the Switch in every view. Empty on a laptop.
 */
export const PhoneSwitch = createContext<Readonly<{ map: ReactNode; ladder: ReactNode }> | null>(null);

/** The Switch's Map view on a phone, or nothing on a laptop. It stays mounted, so the map never reloads. */
export function useMapView(phone: boolean): PanelTab | null {
  const parts = useContext(PhoneSwitch);
  if (!phone || !parts) return null;
  return { id: "map", label: "Map", content: parts.map, scrolls: false, keep: true };
}

/** The turn order's cards under the Switch, on a phone. */
export function useSwitchLadder(phone: boolean): ReactNode {
  const parts = useContext(PhoneSwitch);
  return phone && parts ? parts.ladder : null;
}

/**
 * The Switch's moments: choosing a target turns to Map, and it turns back to the view it left when the choice is
 * over; `turnTo` (an owed prompt, the player's turn starting) turns to the given view when it becomes true.
 */
export function useSwitchMoments({
  enabled,
  tab,
  setTab,
  choosing,
  turnTo
}: Readonly<{
  enabled: boolean;
  tab: string;
  setTab: (id: string) => void;
  choosing: boolean;
  turnTo?: Readonly<{ when: boolean; view: string }>;
}>) {
  const left = useRef<string | null>(null);
  const tabNow = useRef(tab);
  tabNow.current = tab;
  useEffect(() => {
    if (!enabled) return;
    if (choosing) {
      if (tabNow.current !== "map") {
        left.current = tabNow.current;
        setTab("map");
      }
    } else if (left.current !== null) {
      const back = left.current;
      left.current = null;
      if (tabNow.current === "map") setTab(back);
    }
  }, [enabled, choosing, setTab]);
  const when = turnTo?.when ?? false;
  const view = turnTo?.view ?? "";
  useEffect(() => {
    if (enabled && when && view) setTab(view);
  }, [enabled, when, view, setTab]);
}

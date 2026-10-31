import { createContext } from "react";

/**
 * Where the laptop dock holds the map's tools (table spec 2.1). The map owns its tools (they drive its own state), so
 * it renders them here through a portal; with no dock (a phone, the encounter page in Prep) they stay beside the map.
 */
export const DockToolsTarget = createContext<HTMLElement | null>(null);

import { createContext, useContext } from "react";

/**
 * Whether what is on screen is the table as it stands: online, with a snapshot since the connection last came back.
 * A control that changes the game reads it and, while it is false, stays disabled with `STALE_REASON`.
 */
export const TableCurrent = createContext(true);
export const useTableCurrent = () => useContext(TableCurrent);
export const STALE_REASON = "Reconnecting. Wait before making changes.";

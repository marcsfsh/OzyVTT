import { useCallback } from "react";
import { formatWorldDate, type GmCodexCalendar } from "@vtt/domain";
import { calendarApi } from "../codex/api";
import { useCodexQuery } from "../codex/useCodexQuery";

/** The game clock's hour of the day: "14:00". */
export const hourLabel = (clockHours: number) => `${String(clockHours % 24).padStart(2, "0")}:00`;

/**
 * The table's one clock as the GM reads it. The Codex calendar keeps the day and the game clock keeps the hour; the
 * server moves the Codex date whenever game time crosses midnight. `date` is null until the GM sets a date.
 */
export function gameDate(
  calendar: GmCodexCalendar | null | undefined,
  clockHours: number
): Readonly<{ date: string | null; hour: string }> {
  return {
    date: calendar?.currentDate ? formatWorldDate(calendar, calendar.currentDate) : null,
    hour: hourLabel(clockHours)
  };
}

/** The GM's Codex calendar, read while `open` and again whenever the Codex changes. */
export function useGmCalendar(token: string | null, open: boolean) {
  const load = useCallback(() => calendarApi.get(token!), [token]);
  return useCodexQuery(token && open ? load : null, { failure: "Couldn't read the calendar." });
}

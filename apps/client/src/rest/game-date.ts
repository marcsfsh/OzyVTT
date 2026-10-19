import { useCallback } from "react";
import { clockTimeLabel, formatWorldDate, type GmCodexCalendar } from "@vtt/domain";
import { calendarApi } from "../codex/api";
import { useCodexQuery } from "../codex/useCodexQuery";

/** The game clock's time of day: "14:30". */
export const hourLabel = (clockHours: number, clockMinutes = 0) => clockTimeLabel(clockHours, clockMinutes);

/**
 * The table's one clock as the GM reads it. The Codex calendar keeps the day and the game clock keeps the hour; the
 * server moves the Codex date whenever game time crosses midnight. `date` is null until the GM sets a date.
 */
export function gameDate(
  calendar: GmCodexCalendar | null | undefined,
  clockHours: number,
  clockMinutes = 0
): Readonly<{ date: string | null; hour: string }> {
  return {
    date: calendar?.currentDate ? formatWorldDate(calendar, calendar.currentDate) : null,
    hour: hourLabel(clockHours, clockMinutes)
  };
}

/** The GM's Codex calendar, read while `open` and again whenever the Codex changes. */
export function useGmCalendar(token: string | null, open: boolean) {
  const load = useCallback(() => calendarApi.get(token!), [token]);
  return useCodexQuery(token && open ? load : null, { failure: "Couldn't read the calendar." });
}

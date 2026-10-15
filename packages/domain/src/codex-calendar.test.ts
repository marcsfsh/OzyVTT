import { describe, expect, it } from "vitest";
import {
  calendarDaysPerYear,
  calendarYearOf,
  clampToCalendar,
  dateToInstant,
  eraForYear,
  formatWorldDate,
  formatWorldYear,
  instantToDate,
  weekdayIndex,
  weekdayOf,
  type CodexCalendar
} from "./codex-calendar.js";

const CALENDAR: CodexCalendar = {
  yearName: "DR",
  eras: [
    { name: "Age of Ruin", startYear: 1000 },
    { name: "Third Age", startYear: 1400 }
  ],
  months: [
    { name: "Hammer", days: 30 },
    { name: "Alturiak", days: 28 }
  ],
  weekdays: ["Sul", "Mol", "Zor"]
};

describe("codex calendar arithmetic", () => {
  it("round-trips a date through its instant, negative years included", () => {
    expect(calendarDaysPerYear(CALENDAR)).toBe(58);
    for (const date of [
      { year: 1492, month: 1, day: 28 },
      { year: 0, month: 0, day: 1 },
      { year: -3, month: 1, day: 5 }
    ]) {
      expect(instantToDate(CALENDAR, dateToInstant(CALENDAR, date))).toEqual(date);
    }
    expect(dateToInstant(CALENDAR, { year: 1, month: 0, day: 1 })).toBe(58);
    expect(calendarYearOf(CALENDAR, -1)).toBe(-1);
  });

  it("clamps a date into its month, so a day past the end sorts and reads as the last day", () => {
    expect(clampToCalendar(CALENDAR, { year: 1492.7, month: 9, day: 40 })).toEqual({ year: 1492, month: 1, day: 28 });
    expect(dateToInstant(CALENDAR, { year: 1492, month: 0, day: 45 })).toBe(
      dateToInstant(CALENDAR, { year: 1492, month: 0, day: 30 })
    );
    expect(formatWorldDate(CALENDAR, { year: 1492, month: 0, day: 0 })).toBe("Hammer 1, Third Age 1492 DR");
  });

  it("stays finite on a calendar with no days at all", () => {
    const empty: CodexCalendar = { yearName: "", months: [{ name: "Void", days: 0 }], weekdays: [] };
    expect(dateToInstant(empty, { year: 3, month: 0, day: 1 })).toBe(3);
    expect(instantToDate(empty, 3)).toEqual({ year: 3, month: 0, day: 1 });
    expect(calendarYearOf(empty, 3)).toBe(3);
  });

  it("names the era a year has reached and none before the first", () => {
    expect(eraForYear(CALENDAR, 1399)?.name).toBe("Age of Ruin");
    expect(eraForYear(CALENDAR, 999)).toBeNull();
    expect(formatWorldYear(CALENDAR, 1491)).toBe("Third Age 1491 DR");
    expect(formatWorldYear({ ...CALENDAR, eras: [], yearName: "" }, 12)).toBe("12");
  });

  it("reads a weekday for every date, before year zero too, and none without weekdays", () => {
    expect(weekdayOf(CALENDAR, { year: 0, month: 0, day: 1 })).toBe("Sul");
    expect(weekdayOf(CALENDAR, { year: 0, month: 0, day: 2 })).toBe("Mol");
    // Instant -1 is the day before Sul, so it wraps to the last weekday rather than indexing at -1.
    expect(weekdayOf(CALENDAR, instantToDate(CALENDAR, -1))).toBe("Zor");
    expect(weekdayOf({ ...CALENDAR, weekdays: [] }, { year: 0, month: 0, day: 1 })).toBeNull();
    expect(weekdayIndex(CALENDAR, instantToDate(CALENDAR, -1))).toBe(CALENDAR.weekdays.length - 1);
  });
});

import { describe, expect, it } from "vitest";
import { formatDay, formatWhen } from "./formatWhen";

// One way to write a date and its time (theme rule 20).

const now = new Date(2026, 9, 31, 21, 0);

describe("formatWhen", () => {
  it("says Today and Yesterday with the time", () => {
    expect(formatWhen(new Date(2026, 9, 31, 20, 41), now)).toBe("Today, 8:41 PM");
    expect(formatWhen(new Date(2026, 9, 30, 9, 2), now)).toBe("Yesterday, 9:02 AM");
  });

  it("writes this year's days without the year", () => {
    expect(formatWhen(new Date(2026, 9, 2, 19, 40), now)).toBe("Oct 2, 7:40 PM");
    expect(formatDay(new Date(2026, 10, 8), now)).toBe("Nov 8");
  });

  it("adds the year only when it isn't this one", () => {
    expect(formatWhen(new Date(2025, 9, 30, 19, 40), now)).toBe("Oct 30, 2025, 7:40 PM");
  });

  it("says None for a date it cannot read", () => {
    expect(formatWhen("not a date", now)).toBe("None");
  });
});

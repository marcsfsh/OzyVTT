import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CodexCalendar, CodexCalendarMove } from "@vtt/domain";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const check = vi.fn<(token: string, calendar: CodexCalendar) => Promise<readonly CodexCalendarMove[]>>();
const set = vi.fn((_token: string, calendar: CodexCalendar) => Promise.resolve(calendar));

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    calendarApi: {
      ...actual.calendarApi,
      check: (token: string, calendar: CodexCalendar) => check(token, calendar),
      set: (token: string, calendar: CodexCalendar) => set(token, calendar)
    }
  };
});

import { CalendarEditor } from "./CalendarEditor";

const CALENDAR: CodexCalendar = {
  yearName: "DR",
  eras: [],
  months: [
    { name: "Hammer", days: 30 },
    { name: "Alturiak", days: 30 }
  ],
  weekdays: [],
  currentDate: { year: 1492, month: 1, day: 2 }
};

const mount = () => {
  const onSaved = vi.fn();
  render(<CalendarEditor gmToken="gm" calendar={CALENDAR} onSaved={onSaved} onClose={() => {}} />);
  return onSaved;
};

describe("saving a calendar that moves dates players can see", () => {
  it("lists what would move and saves only once the GM confirms", async () => {
    check.mockResolvedValueOnce([
      {
        kind: "journal",
        id: "j1",
        title: "The duke's tax falls due.",
        before: "Hammer 25, 1492 DR",
        after: "Hammer 25, 1492 DR",
        unpasses: true
      }
    ]);
    const onSaved = mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save calendar" }));

    expect(await screen.findByText("This moves dates players can see")).toBeTruthy();
    expect(screen.getByText(/reads as approaching again/)).toBeTruthy();
    expect(set).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("saves straight through when nothing players see would move", async () => {
    set.mockClear();
    check.mockResolvedValueOnce([]);
    const onSaved = mount();
    await userEvent.setup().click(screen.getByRole("button", { name: "Save calendar" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(screen.queryByText("This moves dates players can see")).toBeNull();
  });
});

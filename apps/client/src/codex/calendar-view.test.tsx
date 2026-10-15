import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The Calendar section. Records are placed by the server's `calendarInstant`, never by client date maths,
 * so fixtures give an instant and a raw date that disagree. The month is an address (`?y=`/`?m=`).
 */

const publish = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, calendarApi: { ...actual.calendarApi, publish: (...a: unknown[]) => publish(...a) } };
});

import { CalendarView, PlayerCalendarView } from "./CalendarView";
import type { CodexChronicleRecord, GmCodexCalendar } from "@vtt/domain";

/** Two 10-day months and a 5-day week, so every cell is countable. */
const CALENDAR: GmCodexCalendar = {
  yearName: "DR",
  eras: [],
  months: [
    { name: "Hammer", days: 10 },
    { name: "Alturiak", days: 10 }
  ],
  weekdays: ["Sul", "Mol", "Zor", "Ches", "Tar"],
  currentDate: { year: 1491, month: 0, day: 4 },
  publishedDate: { year: 1491, month: 0, day: 2 }
};
/** Hammer 1 of 1491 = 1491 x 20 = 29820, so day N of Hammer is 29819 + N. */
const HAMMER = (day: number) => 29819 + day;

const record = (over: Partial<CodexChronicleRecord>): CodexChronicleRecord =>
  ({
    id: "j1",
    kind: "entry",
    title: null,
    text: "",
    playerText: "",
    gmText: "",
    tags: [],
    revealedToPlayers: true,
    sessionId: null,
    sessionNumber: null,
    realDate: null,
    inWorldDate: null,
    inWorldLabel: null,
    calendarInstant: null,
    proposedDate: null,
    attachPageId: null,
    attachMarkerId: null,
    archiveId: null,
    createdAt: "2026-07-31T00:00:00.000Z",
    ...over
  }) as CodexChronicleRecord;

const renderCalendar = (over: Partial<React.ComponentProps<typeof CalendarView>> = {}) => {
  const props = {
    gmToken: "gm",
    calendar: CALENDAR,
    records: [] as readonly CodexChronicleRecord[],
    loading: false,
    error: null,
    onChanged: vi.fn(),
    year: null,
    month: null,
    onMonthChange: vi.fn(),
    onOpenEntry: vi.fn(),
    onOpenPage: vi.fn(),
    ...over
  };
  return { props, ...render(<CalendarView {...props} />) };
};

describe("The Calendar grid", () => {
  it("lays out the month the GM's clock is in, with the week's own lead blanks", () => {
    renderCalendar();

    const grid = screen.getByRole("grid", { name: "Hammer 1491 DR" });
    expect(
      within(grid)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent)
    ).toEqual(["SulSu", "MolMo", "ZorZo", "ChesCh", "TarTa"]);
    expect(within(grid).getAllByRole("button")).toHaveLength(10);
    // 29820 % 5 === 0, so Hammer 1 is the first weekday: no lead blanks.
    expect(grid.querySelectorAll(".codex-calendar-cell.is-blank")).toHaveLength(0);
  });

  it("marks your date and the players' date as different days", () => {
    renderCalendar();

    // The cell labels name each clock, not only a colour.
    expect(screen.getByRole("button", { name: "Hammer 4, your date" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hammer 2, players' date" })).toBeInTheDocument();
  });

  it("places a record by the SERVER's instant, never by re-deriving its date", async () => {
    const user = userEvent.setup();
    const onOpenEntry = vi.fn();
    /**
     * The raw date says day 31 of a 10-day month (stored verbatim) while the server's instant says Hammer 7.
     * Re-deriving would clamp to Hammer 10.
     */
    renderCalendar({
      records: [
        record({
          id: "j9",
          title: "The feast",
          kind: "deadline",
          inWorldDate: { year: 1491, month: 0, day: 31 },
          calendarInstant: HAMMER(7)
        })
      ],
      onOpenEntry
    });

    expect(screen.getByRole("button", { name: "Hammer 7, 1 record" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Hammer 10, 1 record/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Hammer 7, 1 record" }));
    const day = within(await screen.findByRole("region", { name: "Records on this day" }));
    expect(day.getByRole("heading", { name: "Hammer 7, 1491 DR" })).toBeInTheDocument();
    await user.click(day.getByRole("button", { name: /The feast/ }));
    expect(onOpenEntry).toHaveBeenCalledWith("j9");
  });

  it("says so when a day holds nothing, and closes on a second tap", async () => {
    const user = userEvent.setup();
    renderCalendar();

    await user.click(screen.getByRole("button", { name: "Hammer 5" }));
    expect(await screen.findByText("Nothing happened on this day.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hammer 5" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Records on this day" })).toBeNull());
  });

  it("counts every record on a day, not only the kinds it has room to mark", async () => {
    renderCalendar({
      records: [
        record({ id: "a", kind: "entry", calendarInstant: HAMMER(3) }),
        record({ id: "b", kind: "combat", calendarInstant: HAMMER(3) }),
        record({ id: "c", kind: "event", calendarInstant: HAMMER(3) }),
        record({ id: "d", kind: "downtime", calendarInstant: HAMMER(3) })
      ]
    });

    // Three glyphs fit; the label still counts four.
    const cell = screen.getByRole("button", { name: "Hammer 3, 4 records" });
    expect(within(cell).getByText("+1")).toBeInTheDocument();
  });
});

describe("The month is an address", () => {
  it("renders the month named by ?y= and ?m= rather than the clock's", () => {
    renderCalendar({ year: "1492", month: "1" });
    expect(screen.getByRole("grid", { name: "Alturiak 1492 DR" })).toBeInTheDocument();
  });

  it("steps through the year boundary and reports the move rather than keeping it", async () => {
    const user = userEvent.setup();
    const { props } = renderCalendar({ year: "1491", month: "1" });

    await user.click(screen.getByRole("button", { name: "Next month" }));
    // Two months per year, so after Alturiak 1491 comes Hammer 1492.
    expect(props.onMonthChange).toHaveBeenCalledWith(1492, 0);

    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(props.onMonthChange).toHaveBeenLastCalledWith(1491, 0);
  });

  it("clamps a nonsense month in the address instead of rendering an empty grid", () => {
    renderCalendar({ year: "1491", month: "99" });
    expect(screen.getByRole("grid", { name: "Alturiak 1491 DR" })).toBeInTheDocument();
  });
});

describe("The two clocks", () => {
  it("names them in the glossary's words and marks the GM's as GM-only", () => {
    renderCalendar();
    expect(screen.getByText("Your date")).toBeInTheDocument();
    expect(screen.getByText("Players' date")).toBeInTheDocument();
    // The prep clock is GM-only information.
    expect(screen.getByText("GM only")).toBeInTheDocument();
  });

  /** Always rendered, disabled with a visible reason when there is nothing to publish. */
  it("always offers publishing, and disables it only when the party is already on the GM's date", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    publish.mockResolvedValue(undefined);
    const view = renderCalendar({ onChanged });

    await user.click(screen.getByRole("button", { name: "Publish the date" }));
    await waitFor(() => expect(publish).toHaveBeenCalledWith("gm"));
    expect(onChanged).toHaveBeenCalled();

    view.unmount();
    render(
      <CalendarView
        gmToken="gm"
        calendar={{ ...CALENDAR, publishedDate: CALENDAR.currentDate ?? null }}
        records={[]}
        loading={false}
        error={null}
        onChanged={vi.fn()}
        year={null}
        month={null}
        onMonthChange={vi.fn()}
        onOpenEntry={vi.fn()}
        onOpenPage={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Publish the date" })).toBeDisabled();
    expect(screen.getByText(/The party is on your date/)).toBeInTheDocument();
  });

  /** The reported case: the GM sets a date and the party's does not move until published. */
  it("offers the publish act from the unset state, where the party has no date at all", () => {
    renderCalendar({ calendar: { ...CALENDAR, publishedDate: null } });
    expect(screen.getByText("Not shared yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish the date" })).toBeEnabled();
    expect(screen.getByText(/The party has no date yet/)).toBeInTheDocument();
  });

  /** The GM's clock is a button straight to the date; the players' clock has no editor. */
  it("makes the GM's own clock a door, and gives the players' clock none", async () => {
    const user = userEvent.setup();
    renderCalendar({ calendar: { ...CALENDAR, currentDate: null, publishedDate: null } });

    const door = screen.getByRole("button", { name: "Set your date" });
    await user.click(door);
    expect(await screen.findByRole("dialog", { name: "Your date" })).toBeInTheDocument();

    // The players' clock is only ever a published copy; it must never get an editor.
    expect(screen.queryByRole("button", { name: /Not shared yet/ })).toBeNull();
  });

  it("surfaces a failed publish instead of leaving the GM to guess", async () => {
    const user = userEvent.setup();
    publish.mockRejectedValue(new Error("Couldn't reach the table."));
    renderCalendar();

    await user.click(screen.getByRole("button", { name: "Publish the date" }));
    expect(await screen.findByText("Couldn't reach the table.")).toBeInTheDocument();
  });
});

/** Must agree with the server's `formatWorldYear`, which writes the stored `in_world_label`. */
describe("Eras (5f)", () => {
  const ERAS = [
    { name: "Age of Ruin", startYear: 1000 },
    { name: "Third Age", startYear: 1400 }
  ];

  it("leads the year with the era the year has reached, and keeps the suffix", () => {
    renderCalendar({ calendar: { ...CALENDAR, eras: ERAS }, year: "1491", month: "0" });
    expect(screen.getByRole("heading", { name: "Hammer Third Age 1491 DR" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Your date is Hammer 4, Third Age 1491 DR/ })).toBeInTheDocument();
  });

  it("names the EARLIER era for a year that has not reached the later one", () => {
    renderCalendar({ calendar: { ...CALENDAR, eras: ERAS }, year: "1200", month: "0" });
    expect(screen.getByRole("heading", { name: "Hammer Age of Ruin 1200 DR" })).toBeInTheDocument();
  });

  it("renders exactly as it always has for a year before every era, and for a calendar with none", () => {
    const { unmount } = renderCalendar({ calendar: { ...CALENDAR, eras: ERAS }, year: "900", month: "0" });
    expect(screen.getByRole("heading", { name: "Hammer 900 DR" })).toBeInTheDocument();
    unmount();
    renderCalendar({ year: "1491", month: "0" }); // no `eras` key at all
    expect(screen.getByRole("heading", { name: "Hammer 1491 DR" })).toBeInTheDocument();
  });

  /** Eras are structure, not secrets: both projections carry them. */
  it("gives the player's calendar the same reading of the year", () => {
    render(
      <PlayerCalendarView
        calendar={{
          yearName: "DR",
          eras: ERAS,
          months: CALENDAR.months,
          weekdays: CALENDAR.weekdays,
          currentDate: { year: 1491, month: 0, day: 2 }
        }}
        records={[]}
        year={null}
        month={null}
        onMonthChange={vi.fn()}
        onOpenEntry={vi.fn()}
      />
    );
    expect(screen.getByText("Hammer 2, Third Age 1491 DR")).toBeInTheDocument();
  });
});

describe("Loading, failure and the empty world", () => {
  it("does not call an empty campaign 'no calendar' while the feed is in flight", () => {
    const { container } = renderCalendar({ calendar: null, loading: true });
    expect(container.querySelector(".codex-main-loading")).not.toBeNull();
    expect(screen.queryByText("No calendar yet")).toBeNull();
  });

  it("reports a failed read rather than rendering an empty month", () => {
    renderCalendar({ calendar: null, loading: false, error: "Could not load the campaign dashboard." });
    expect(screen.getByText("Could not load the campaign dashboard.")).toBeInTheDocument();
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("invites a GM with no calendar to make one", () => {
    renderCalendar({ calendar: null, loading: false });
    expect(screen.getByRole("heading", { name: "No calendar yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit calendar" })).toBeInTheDocument();
  });
});

describe("The player's Calendar", () => {
  const PLAYER_CALENDAR = {
    yearName: "DR",
    months: CALENDAR.months,
    weekdays: CALENDAR.weekdays,
    currentDate: { year: 1491, month: 0, day: 2 }
  };

  it("shows ONE clock — the published date — and no way to change the world", () => {
    render(
      <PlayerCalendarView
        calendar={PLAYER_CALENDAR}
        records={[]}
        year={null}
        month={null}
        onMonthChange={vi.fn()}
        onOpenEntry={vi.fn()}
      />
    );

    // A player's `currentDate` is the published date, so there is no "your date".
    expect(screen.queryByText("Your date")).toBeNull();
    expect(screen.queryByText("GM only")).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish the date" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit calendar" })).toBeNull();
  });

  it("places the player's own records on the same grid", async () => {
    const user = userEvent.setup();
    const onOpenEntry = vi.fn();
    render(
      <PlayerCalendarView
        calendar={PLAYER_CALENDAR}
        onOpenEntry={onOpenEntry}
        year={null}
        month={null}
        onMonthChange={vi.fn()}
        records={[{ id: "j2", kind: "entry", title: "We reached Vallaki", text: "", calendarInstant: HAMMER(6) }]}
      />
    );

    await user.click(screen.getByRole("button", { name: /Hammer 6/ }));
    await user.click(await screen.findByRole("button", { name: /We reached Vallaki/ }));
    expect(onOpenEntry).toHaveBeenCalledWith("j2");
  });
});

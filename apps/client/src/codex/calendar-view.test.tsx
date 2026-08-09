import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * D17 — the Calendar as a real section, and the one owed test for it.
 *
 * Three things here are worth a test rather than a comment.
 *
 * **It is a lens, never a second chronology** (invariant 7). Every record is placed by the SERVER's
 * `calendarInstant`; no client date arithmetic touches a record. That is exactly why this view could not
 * ship before the clamp fix — the client's `dateToInstant` clamped only at the bottom, so "day 31 of a
 * 30-day month" landed one day later here than on the server. A test that placed records by re-deriving
 * their dates would re-introduce the very divergence the view was blocked on, so the fixtures below give
 * an instant and a raw date that DISAGREE, and assert the instant wins.
 *
 * **The two clocks are separate, and one of them is GM-only.** "Your date" is the prep clock and carries
 * the violet GM-only tag; "Players' date" is what has been published. Publishing is offered only while
 * they differ, because there is nothing to publish when they agree.
 *
 * **The month is an address.** `?y=`/`?m=` drive the grid, so a month is bookmarkable and the arrows
 * report through `onMonthChange` rather than holding local state.
 */

const publish = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, calendarApi: { ...actual.calendarApi, publish: (...a: unknown[]) => publish(...a) } };
});

import { CalendarView, PlayerCalendarView } from "./CalendarView";
import type { CodexChronicleRecord, GmCodexCalendar } from "./api";

/** Two 10-day months and a 5-day week: small enough that every cell and every lead blank is countable. */
const CALENDAR: GmCodexCalendar = {
  yearName: "DR",
  months: [{ name: "Hammer", days: 10 }, { name: "Alturiak", days: 10 }],
  weekdays: ["Sul", "Mol", "Zor", "Ches", "Tar"],
  currentDate: { year: 1491, month: 0, day: 4 },
  publishedDate: { year: 1491, month: 0, day: 2 }
};
/** Hammer 1 of 1491 = 1491 × 20 = 29820, so day N of Hammer is 29819 + N. */
const HAMMER = (day: number) => 29819 + day;

const record = (over: Partial<CodexChronicleRecord>): CodexChronicleRecord => ({
  id: "j1", kind: "entry", title: null, text: "", playerText: "", gmText: "", tags: [], revealedToPlayers: true,
  sessionId: null, sessionNumber: null, realDate: null, inWorldDate: null, inWorldLabel: null,
  calendarInstant: null, proposedDate: null, attachPageId: null, attachMarkerId: null, archiveId: null,
  createdAt: "2026-07-31T00:00:00.000Z", ...over
} as CodexChronicleRecord);

const renderCalendar = (over: Partial<React.ComponentProps<typeof CalendarView>> = {}) => {
  const props = {
    gmToken: "gm", calendar: CALENDAR, records: [] as readonly CodexChronicleRecord[], loading: false, error: null,
    onChanged: vi.fn(), year: null, month: null, onMonthChange: vi.fn(), onOpenEntry: vi.fn(), onOpenPage: vi.fn(),
    ...over
  };
  return { props, ...render(<CalendarView {...props} />) };
};

describe("The Calendar grid", () => {
  it("lays out the month the GM's clock is in, with the week's own lead blanks", () => {
    renderCalendar();

    const grid = screen.getByRole("grid", { name: "Hammer 1491 DR" });
    // The GM's weekdays, not a real-world week.
    expect(within(grid).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["SulSu", "MolMo", "ZorZo", "ChesCh", "TarTa"]);
    // Ten days, and one cell per day.
    expect(within(grid).getAllByRole("button")).toHaveLength(10);
    // 29820 % 5 === 0, so Hammer 1 is the first weekday and the month needs no lead blanks.
    expect(grid.querySelectorAll(".codex-calendar-cell.is-blank")).toHaveLength(0);
  });

  it("marks your date and the players' date as different days", () => {
    renderCalendar();

    // The two clocks have diverged by two days, and the grid says which is which — by name, in the cell's
    // accessible label, not only by a colour.
    expect(screen.getByRole("button", { name: "Hammer 4, your date" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hammer 2, players' date" })).toBeInTheDocument();
  });

  it("places a record by the SERVER's instant, never by re-deriving its date", async () => {
    const user = userEvent.setup();
    const onOpenEntry = vi.fn();
    /**
     * The raw date says day 31 of a 10-day month — reachable, because `normalizeCalendar` stores an
     * over-long day verbatim — while the server's instant says Hammer 7. A view that re-derived the
     * position would clamp to Hammer 10 and put the record on the wrong day.
     */
    renderCalendar({
      records: [record({ id: "j9", title: "The feast", kind: "deadline", inWorldDate: { year: 1491, month: 0, day: 31 }, calendarInstant: HAMMER(7) })],
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

    // Three glyphs fit; the label still says four, so the cell never under-reports what is on it.
    const cell = screen.getByRole("button", { name: "Hammer 3, 4 records" });
    expect(within(cell).getByText("+1")).toBeInTheDocument();
  });
});

describe("The month is an address (D3/D17)", () => {
  it("renders the month named by ?y= and ?m= rather than the clock's", () => {
    renderCalendar({ year: "1492", month: "1" });
    expect(screen.getByRole("grid", { name: "Alturiak 1492 DR" })).toBeInTheDocument();
  });

  it("steps through the year boundary and reports the move rather than keeping it", async () => {
    const user = userEvent.setup();
    const { props } = renderCalendar({ year: "1491", month: "1" });

    await user.click(screen.getByRole("button", { name: "Next month" }));
    // Two months in this world, so the month after Alturiak 1491 is Hammer 1492.
    expect(props.onMonthChange).toHaveBeenCalledWith(1492, 0);

    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(props.onMonthChange).toHaveBeenLastCalledWith(1491, 0);
  });

  it("clamps a nonsense month in the address instead of rendering an empty grid", () => {
    renderCalendar({ year: "1491", month: "99" });
    expect(screen.getByRole("grid", { name: "Alturiak 1491 DR" })).toBeInTheDocument();
  });
});

describe("The two clocks (D17)", () => {
  it("names them in the glossary's words and marks the GM's as GM-only", () => {
    renderCalendar();
    expect(screen.getByText("Your date")).toBeInTheDocument();
    expect(screen.getByText("Players' date")).toBeInTheDocument();
    // The prep clock is GM information; the tag is the same violet mark every GM-only block carries.
    expect(screen.getByText("GM only")).toBeInTheDocument();
  });

  /**
   * **D6 (2026-08-09) reverses half of this test's premise.** It used to assert that Publish is RENDERED
   * only while the clocks differ. That was the client half of the coupling the client reported: with the
   * server auto-publishing a codex's first date (K7), setting a date made the clocks agree, so the control
   * never appeared — from the unset state there was no visible publish act at all, and two clocks with no
   * visible act between them read as one clock with two readouts.
   *
   * It is now always rendered and DISABLED when there is nothing to publish, which is the same protection
   * against a no-op click and none of the concealment. The reason is on screen beside it, so a disabled
   * control is not a puzzle either.
   */
  it("always offers publishing, and disables it only when the party is already on the GM's date", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    publish.mockResolvedValue(undefined);
    const view = renderCalendar({ onChanged });

    await user.click(screen.getByRole("button", { name: "Publish the date" }));
    await waitFor(() => expect(publish).toHaveBeenCalledWith("gm"));
    expect(onChanged).toHaveBeenCalled();

    view.unmount();
    render(<CalendarView gmToken="gm" calendar={{ ...CALENDAR, publishedDate: CALENDAR.currentDate ?? null }} records={[]} loading={false} error={null}
      onChanged={vi.fn()} year={null} month={null} onMonthChange={vi.fn()} onOpenEntry={vi.fn()} onOpenPage={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Publish the date" })).toBeDisabled();
    expect(screen.getByText(/The party is on your date/)).toBeInTheDocument();
  });

  /**
   * `5f`(i) / D6, the state the client actually reported: a GM sets their date and the party's does NOT
   * move. Under K7 this state was unreachable — the server published the first date itself — so the fix is
   * only observable here now that it is.
   */
  it("offers the publish act from the unset state, where the party has no date at all", () => {
    renderCalendar({ calendar: { ...CALENDAR, publishedDate: null } });
    expect(screen.getByText("Not shared yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish the date" })).toBeEnabled();
    expect(screen.getByText(/The party has no date yet/)).toBeInTheDocument();
  });

  /**
   * `5f`(i). "Not set" was a plain `<strong>`: the only door to the GM's clock was a ghost "Edit calendar"
   * button opening the world's structure, where the date is the FOURTH field. A GM setting tonight's date
   * is not editing the world's months.
   */
  it("makes the GM's own clock a door, and gives the players' clock none", async () => {
    const user = userEvent.setup();
    renderCalendar({ calendar: { ...CALENDAR, currentDate: null, publishedDate: null } });

    const door = screen.getByRole("button", { name: "Set your date" });
    await user.click(door);
    expect(await screen.findByRole("dialog", { name: "Your date" })).toBeInTheDocument();

    // D11-H: the players' clock is a COPY, made by publish and by nothing else. It has no editor and must
    // not grow one — a "set the players' date" control is a control that cannot exist.
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

/**
 * `5f`(iii) — the client half of the era rule, which has to agree with the server's `formatWorldYear`
 * exactly: the server writes `in_world_label` into the database, this view labels the month bar and the
 * composer's preview, and a disagreement between them is the divergence D17 was blocked on once already.
 */
describe("Eras (5f)", () => {
  const ERAS = [{ name: "Age of Ruin", startYear: 1000 }, { name: "Third Age", startYear: 1400 }];

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
    renderCalendar({ year: "1491", month: "0" });                       // no `eras` key at all
    expect(screen.getByRole("heading", { name: "Hammer 1491 DR" })).toBeInTheDocument();
  });

  /** Structure, not secrets: the player's own calendar reads its dates with the same eras (projected on both). */
  it("gives the player's calendar the same reading of the year", () => {
    render(<PlayerCalendarView calendar={{ yearName: "DR", eras: ERAS, months: CALENDAR.months, weekdays: CALENDAR.weekdays, currentDate: { year: 1491, month: 0, day: 2 } }}
      records={[]} year={null} month={null} onMonthChange={vi.fn()} onOpenEntry={vi.fn()} />);
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

describe("The player's Calendar (D14)", () => {
  const PLAYER_CALENDAR = { yearName: "DR", months: CALENDAR.months, weekdays: CALENDAR.weekdays, currentDate: { year: 1491, month: 0, day: 2 } };

  it("shows ONE clock — the published date — and no way to change the world", () => {
    render(<PlayerCalendarView calendar={PLAYER_CALENDAR} records={[]} year={null} month={null} onMonthChange={vi.fn()} onOpenEntry={vi.fn()} />);

    // The GM's prep clock has no name here and no cell: `currentDate` on the player's calendar IS the
    // published date (the server projects it), so there is nothing to label "yours" against.
    expect(screen.queryByText("Your date")).toBeNull();
    expect(screen.queryByText("GM only")).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish the date" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit calendar" })).toBeNull();
  });

  it("places the player's own records on the same grid", async () => {
    const user = userEvent.setup();
    const onOpenEntry = vi.fn();
    render(<PlayerCalendarView calendar={PLAYER_CALENDAR} onOpenEntry={onOpenEntry} year={null} month={null} onMonthChange={vi.fn()}
      records={[{ id: "j2", kind: "entry", title: "We reached Vallaki", text: "", calendarInstant: HAMMER(6) }]} />);

    await user.click(screen.getByRole("button", { name: /Hammer 6/ }));
    await user.click(await screen.findByRole("button", { name: /We reached Vallaki/ }));
    expect(onOpenEntry).toHaveBeenCalledWith("j2");
  });
});

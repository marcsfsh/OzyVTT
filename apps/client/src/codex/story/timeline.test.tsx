import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

import type { CodexCalendar, GmCodexCalendar } from "@vtt/domain";
import { ageMarks, daySpanLabel, monthDays, realDateLabel, sessionDays, spineGroups, yearMonths } from "./model";
import { GmStorySection, GmTimelineSection, PlayerStorySection, PlayerTimelineSection } from "./sections";
import { gmRecord, playerRecord, renderGmStory, renderPlayerStory } from "./harness";

/**
 * The timeline's three zooms over the same records, and the reading rules under them. Ages puts dated events on one
 * line with quiet centuries folded; Year lays a year out by month; Month lists the days that hold anything, with the
 * reader's dates drawn across it. A player's timeline reads only the player's own records.
 */

/** Two 30-day months a year and a five-day week; Hammer 1 of year Y is instant Y x 60. */
const CALENDAR: GmCodexCalendar = {
  yearName: "DR",
  eras: [],
  months: [
    { name: "Hammer", days: 30 },
    { name: "Alturiak", days: 30 }
  ],
  weekdays: ["Sul", "Mol", "Zor", "Ches", "Tar"],
  currentDate: { year: 1492, month: 0, day: 20 },
  publishedDate: { year: 1492, month: 0, day: 10 }
};
const PLAYER_CALENDAR: CodexCalendar = {
  yearName: "DR",
  months: CALENDAR.months,
  weekdays: CALENDAR.weekdays,
  currentDate: { year: 1492, month: 0, day: 10 }
};
const AT = (year: number, month: number, day: number) => year * 60 + month * 30 + day - 1;

const FOUNDING = gmRecord({
  kind: "event",
  id: "e1",
  title: "Founding of Daggerford",
  text: "The ford is walled.",
  calendarInstant: AT(1000, 0, 1),
  revealedToPlayers: true
});
const STORM = gmRecord({
  kind: "event",
  id: "e2",
  title: "The great storm",
  text: "The chapel falls into the sea.",
  calendarInstant: AT(1480, 1, 3)
});
const ENTRY = gmRecord({
  id: "j1",
  text: "We crossed the mists.",
  sessionNumber: 3,
  sessionId: "s3",
  calendarInstant: AT(1492, 0, 4)
});
const LATER = gmRecord({
  id: "j2",
  text: "We met Ireena.",
  sessionNumber: 4,
  sessionId: "s4",
  calendarInstant: AT(1492, 0, 15)
});
const VOTE = gmRecord({ kind: "deadline", id: "d1", text: "The council votes.", calendarInstant: AT(1492, 0, 18) });

describe("The reading rules", () => {
  it("folds quiet centuries out of the ages and ends at the campaign, spanning the sessions played", () => {
    const marks = ageMarks([FOUNDING, STORM, ENTRY, LATER], CALENDAR, CALENDAR.currentDate);
    expect(marks.map((mark) => mark.title)).toEqual(["Founding of Daggerford", "The great storm", "The campaign"]);
    expect(marks[1].foldBefore).toBe(true);
    expect(marks[2].foldBefore).toBe(false);
    expect(marks[2].line).toBe("Sessions 3 to 4");
    // A hidden event says so; the campaign mark never does.
    expect(marks[1].hidden).toBe(true);
    expect(marks[0].hidden).toBe(false);
  });

  it("lays a year out by month, naming the sessions each month saw", () => {
    const months = yearMonths([ENTRY, LATER, VOTE], CALENDAR, 1492);
    expect(months.map((month) => month.name)).toEqual(["Hammer", "Alturiak"]);
    expect(months[0].records.map((record) => record.id)).toEqual(["j1", "j2", "d1"]);
    expect(months[0].sessions).toBe("Sessions 3 to 4");
    expect(months[1].records).toHaveLength(0);
  });

  it("lists only the days of a month that hold anything, with their weekdays", () => {
    const days = monthDays([ENTRY, LATER, VOTE], CALENDAR, 1492, 0);
    expect(days.map((day) => day.day)).toEqual([4, 15, 18]);
    expect(days[0].weekday).not.toBeNull();
  });

  it("dates a session by the records filed under it, and says a span briefly", () => {
    expect(
      sessionDays([ENTRY, gmRecord({ ...ENTRY, id: "j3", calendarInstant: AT(1492, 0, 6) })], "s3", CALENDAR)
    ).toBe("Hammer 4 to 6");
    expect(sessionDays([ENTRY], "s9", CALENDAR)).toBe("");
    expect(daySpanLabel(CALENDAR, AT(1492, 0, 29), AT(1492, 1, 2))).toBe("Hammer 29 to Alturiak 2");
  });

  it("puts sessions newest first, each with what was filed under it, and what no session holds last", () => {
    const groups = spineGroups(
      [
        { id: "s3", sessionNumber: 3 },
        { id: "s4", sessionNumber: 4 }
      ],
      [ENTRY, LATER, VOTE, gmRecord({ id: "loose", text: "A rumour." })]
    );
    expect(groups.map((group) => group.key)).toEqual(["s4", "s3", "none"]);
    // Deadlines live in Clocks and events on the timeline, never on the spine.
    expect(groups.flatMap((group) => group.records.map((record) => record.id))).toEqual(["j2", "j1", "loose"]);
  });

  it("says a real date as people do, and leaves free text as typed", () => {
    expect(realDateLabel("2026-10-24")).toBe("October 24");
    expect(realDateLabel("2026-10-24", true)).toBe("Saturday, October 24");
    expect(realDateLabel("last Saturday")).toBe("last Saturday");
    expect(realDateLabel(null)).toBeNull();
  });
});

describe("The GM's timeline", () => {
  it("opens on the ages, folds the quiet years, and reads an event on the right", async () => {
    const user = userEvent.setup();
    renderGmStory(GmTimelineSection, "/codex/timeline", { records: [FOUNDING, STORM, ENTRY], calendar: CALENDAR });
    const ages = within(screen.getByRole("list", { name: "The ages, oldest first" }));
    expect(ages.getByRole("img", { name: "Quiet years folded" })).toBeInTheDocument();
    // A hidden event says so on the line.
    expect(ages.getByRole("button", { name: /The great storm/ })).toHaveTextContent("Hidden");

    await user.click(ages.getByRole("button", { name: /Founding of Daggerford/ }));
    const aside = within(screen.getByRole("complementary", { name: "Founding of Daggerford" }));
    expect(aside.getByText("The ford is walled.")).toBeInTheDocument();
    await user.click(aside.getByRole("button", { name: "Open the page" }));
    expect(window.location.pathname).toBe("/codex/pages/e1");
  });

  it("zooms by the address, and the campaign's mark opens its year", async () => {
    const user = userEvent.setup();
    renderGmStory(GmTimelineSection, "/codex/timeline", { records: [FOUNDING, ENTRY], calendar: CALENDAR });
    await user.click(screen.getByRole("button", { name: /The campaign/ }));
    const query = new URLSearchParams(window.location.search);
    expect(query.get("zoom")).toBe("year");
    expect(query.get("y")).toBe("1492");
    expect(screen.getByRole("region", { name: "1492 DR, by month" })).toBeInTheDocument();
  });

  it("draws both dates across the month, the players' first and yours after, in words", () => {
    renderGmStory(GmTimelineSection, "/codex/timeline?zoom=month", {
      records: [ENTRY, LATER, VOTE],
      calendar: CALENDAR
    });
    const month = within(screen.getByRole("list", { name: "Hammer 1492 DR" }));
    const lines = month.getAllByText(/date ·/).map((line) => line.textContent);
    expect(lines).toEqual([
      expect.stringMatching(/^Players' date · .*Hammer 10$/),
      expect.stringMatching(/^Your date · .*Hammer 20$/)
    ]);
    expect(month.getByText("We crossed the mists.")).toBeInTheDocument();
    expect(month.getByText("The council votes.")).toBeInTheDocument();
  });

  it("steps month by month and writes the month into the address", async () => {
    const user = userEvent.setup();
    renderGmStory(GmTimelineSection, "/codex/timeline?zoom=month&y=1492&m=1", { records: [], calendar: CALENDAR });
    await user.click(screen.getByRole("button", { name: "Next month" }));
    const query = new URLSearchParams(window.location.search);
    expect([query.get("y"), query.get("m")]).toEqual(["1493", "0"]);
  });

  it("is the phone's Story, one lane under the dates and Add to the chronicle", () => {
    renderGmStory(GmStorySection, "/codex/story", { records: [ENTRY, VOTE], calendar: CALENDAR, phone: true });
    expect(screen.getByRole("group", { name: "The two dates" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to the chronicle" })).toBeInTheDocument();
    const month = within(screen.getByRole("list", { name: "Hammer 1492 DR" }));
    // One lane on a phone: the world's record and the party's sit together, each saying which.
    expect(month.getAllByText("The party").length).toBeGreaterThan(0);
    expect(month.getAllByText("In the world").length).toBeGreaterThan(0);
  });
});

describe("A player's Story", () => {
  it("shows one date, Today, and no way to move it or the world", () => {
    renderPlayerStory(PlayerStorySection, "/codex/story", {
      records: [playerRecord({ id: "j1", text: "We crossed the mists.", sessionId: "s3", sessionNumber: 3 })],
      calendar: PLAYER_CALENDAR,
      sessions: [{ id: "s3", sessionNumber: 3, realDate: null, recap: "The mists parted.", tags: [] }]
    });
    expect(screen.getByRole("group", { name: "Today" })).toHaveTextContent("Hammer 10, 1492 DR");
    expect(screen.queryByText("Yours")).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit calendar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add to the chronicle" })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText("The mists parted.")).toBeInTheDocument();
  });

  it("reads a revealed deadline in Clocks with its word, and downtime by person, with no Confirm", () => {
    renderPlayerStory(PlayerStorySection, "/codex/story", {
      records: [
        playerRecord({
          kind: "deadline",
          id: "d1",
          text: "The duke's ultimatum expires.",
          fired: true,
          calendarInstant: AT(1492, 0, 9)
        }),
        playerRecord({
          kind: "downtime",
          id: "w1",
          text: "",
          payload: { who: "Aldric", activity: "Forging a blade", days: 7, characterPageId: null }
        })
      ],
      calendar: PLAYER_CALENDAR
    });
    const clocks = within(screen.getByRole("region", { name: "Clocks" }));
    expect(clocks.getByText("The duke's ultimatum expires.").closest("div")).toHaveTextContent("Passed");
    const downtime = within(screen.getByRole("region", { name: "Downtime" }));
    expect(downtime.getByRole("rowheader", { name: "Aldric" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm|Move your date/ })).toBeNull();
  });

  it("opens a record from the calendar's day on the spine", async () => {
    const user = userEvent.setup();
    renderPlayerStory(PlayerStorySection, "/codex/story", {
      records: [playerRecord({ id: "j2", title: "We reached Vallaki", calendarInstant: AT(1492, 0, 6) })],
      calendar: PLAYER_CALENDAR
    });
    await user.click(screen.getByRole("button", { name: "Hammer 6, 1 record" }));
    await user.click(
      within(screen.getByRole("region", { name: "Records on this day" })).getByRole("button", {
        name: /We reached Vallaki/
      })
    );
    expect(document.getElementById("story-row-j2")).toHaveAttribute("aria-expanded", "true");
  });

  it("reads the timeline from the player's own records and opens a revealed event's page", async () => {
    const user = userEvent.setup();
    renderPlayerStory(PlayerTimelineSection, "/codex/timeline", {
      records: [
        playerRecord({
          kind: "event",
          id: "e1",
          title: "Founding of Daggerford",
          text: "The ford is walled.",
          calendarInstant: AT(1000, 0, 1)
        })
      ],
      calendar: PLAYER_CALENDAR,
      pages: [{ id: "e1", title: "Founding of Daggerford" } as never]
    });
    await user.click(screen.getByRole("button", { name: /Founding of Daggerford/ }));
    await user.click(
      within(screen.getByRole("complementary", { name: "Founding of Daggerford" })).getByRole("button", {
        name: "Open the page"
      })
    );
    expect(window.location.pathname).toBe("/codex/pages/e1");
  });
});

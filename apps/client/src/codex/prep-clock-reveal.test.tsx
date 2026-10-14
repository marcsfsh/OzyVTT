import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const chronicle = vi.fn();
const listPages = vi.fn();
const getCalendar = vi.fn();
const publishCalendar = vi.fn();
const revealEntry = vi.fn();
const revealPage = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      listPages: (...a: unknown[]) => listPages(...a),
      revealPage: (...a: unknown[]) => revealPage(...a)
    },
    calendarApi: {
      ...actual.calendarApi,
      get: (...a: unknown[]) => getCalendar(...a),
      publish: (...a: unknown[]) => publishCalendar(...a)
    },
    journalApi: {
      ...actual.journalApi,
      chronicle: (...a: unknown[]) => chronicle(...a),
      reveal: (...a: unknown[]) => revealEntry(...a)
    }
  };
});

import { JournalView } from "./JournalView";
import { revealAheadOfPlayers } from "./chronicle";
import type { CodexChronicleRecord, GmCodexCalendar } from "./api";

/**
 * The prep-clock reveal warning and the publish acknowledgement. Warned tests assert the reveal call did
 * not happen; the quiet cases (clocks agree, never published, hiding) are tested as hard as the loud one.
 */
const CALENDAR: GmCodexCalendar = {
  yearName: "DR",
  months: [
    { name: "Hammer", days: 30 },
    { name: "Alturiak", days: 30 }
  ],
  weekdays: [],
  // The GM is 48 days ahead of the table.
  currentDate: { year: 1492, month: 1, day: 28 },
  publishedDate: { year: 1492, month: 0, day: 10 }
};
/** Clocks agree: nothing is private, so nothing to warn about. */
const IN_SYNC: GmCodexCalendar = { ...CALENDAR, currentDate: { year: 1492, month: 0, day: 10 } };
/** Never published: nothing for a record to be ahead of. */
const NEVER_PUBLISHED: GmCodexCalendar = { ...CALENDAR, publishedDate: null };

const RECORD = (over: Partial<CodexChronicleRecord> = {}): CodexChronicleRecord => ({
  kind: "entry",
  id: "j1",
  title: null,
  text: "The party crossed the mists.",
  gmText: null,
  revealedToPlayers: false,
  sessionId: null,
  sessionNumber: null,
  realDate: null,
  inWorldLabel: null,
  calendarInstant: null,
  inWorldDate: null,
  tags: [],
  attachPageId: null,
  attachMarkerId: null,
  sourceEncounterId: null,
  payload: null,
  fired: false,
  proposedDate: null,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  ...over
});

/** Dated at the GM's clock, 48 days past the table's. */
const AHEAD = RECORD({
  kind: "milestone",
  id: "m1",
  text: "The party reached 5.",
  payload: { level: 5, reason: "Barovia", applied: false },
  inWorldLabel: "Alturiak 28, 1492 DR",
  calendarInstant: 1492 * 60 + 57,
  inWorldDate: { year: 1492, month: 1, day: 28 }
});
/** Dated exactly at the published date: the party's present. */
const TODAY = RECORD({
  kind: "entry",
  id: "j2",
  text: "A quiet day in Vallaki.",
  inWorldLabel: "Hammer 10, 1492 DR",
  calendarInstant: 1492 * 60 + 9,
  inWorldDate: { year: 1492, month: 0, day: 10 }
});
const UNDATED = RECORD({ id: "j3", text: "Session notes." });

const renderJournal = async (records: CodexChronicleRecord[], calendar: GmCodexCalendar = CALENDAR) => {
  chronicle.mockResolvedValue(records);
  listPages.mockResolvedValue([]);
  getCalendar.mockResolvedValue(calendar);
  revealEntry.mockResolvedValue({});
  revealPage.mockResolvedValue({});
  publishCalendar.mockResolvedValue({});
  render(<JournalView gmToken="gm" autosave={{ enabled: true, intervalSeconds: 1 }} pages={[]} onOpenPage={vi.fn()} />);
  await waitFor(() => expect(chronicle).toHaveBeenCalled());
};

const rowOf = (id: string) => document.getElementById(`codex-entry-${id}`)!;
const switchIn = (id: string) => within(rowOf(id)).getByRole("switch");

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  revealEntry.mockReset();
  revealPage.mockReset();
  publishCalendar.mockReset();
});

describe("Revealing a record dated ahead of the players (owner decision, 2026-07-30)", () => {
  it("warns, names both dates, and does not reveal until the GM says so", async () => {
    await renderJournal([AHEAD]);
    const user = userEvent.setup();

    await user.click(switchIn("m1"));

    // The message names both dates.
    expect(
      await screen.findByText(
        "Players' date is still Hammer 10, 1492 DR. Showing this record tells them the date has reached Alturiak 28, 1492 DR. Publish the date first if you do not want that."
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/date is still Hammer 10, 1492 DR/)).toBeInTheDocument();
    // The warning must block the route, not paint after it.
    expect(revealEntry).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Show anyway" }));
    await waitFor(() => expect(revealEntry).toHaveBeenCalledWith("gm", "m1", true));
  });

  it("reveals nothing when the GM backs out", async () => {
    await renderJournal([AHEAD]);
    const user = userEvent.setup();

    await user.click(switchIn("m1"));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(revealEntry).not.toHaveBeenCalled();
    // The switch follows the record, which nothing mutated.
    expect(switchIn("m1")).toHaveAttribute("aria-checked", "false");
  });

  it("says nothing when the record is dated at the players' own present", async () => {
    await renderJournal([TODAY]);
    const user = userEvent.setup();

    await user.click(switchIn("j2"));
    await waitFor(() => expect(revealEntry).toHaveBeenCalledWith("gm", "j2", true));
    expect(screen.queryByText(/dated ahead/i)).not.toBeInTheDocument();
  });

  it("says nothing about an undated record", async () => {
    await renderJournal([UNDATED]);
    const user = userEvent.setup();

    await user.click(switchIn("j3"));
    await waitFor(() => expect(revealEntry).toHaveBeenCalledWith("gm", "j3", true));
  });

  it("says nothing while the two clocks agree", async () => {
    await renderJournal([TODAY], IN_SYNC);
    const user = userEvent.setup();

    await user.click(switchIn("j2"));
    await waitFor(() => expect(revealEntry).toHaveBeenCalledWith("gm", "j2", true));
  });

  /** With no published date there is nothing to be ahead of. */
  it("says nothing when the clock has never been published", async () => {
    await renderJournal([AHEAD], NEVER_PUBLISHED);
    const user = userEvent.setup();

    await user.click(switchIn("m1"));
    await waitFor(() => expect(revealEntry).toHaveBeenCalledWith("gm", "m1", true));
  });

  /** Hiding discloses nothing. */
  it("never warns about HIDING a record, however far ahead it is dated", async () => {
    await renderJournal([RECORD({ ...AHEAD, id: "m2", revealedToPlayers: true })]);
    const user = userEvent.setup();

    await user.click(switchIn("m2"));
    await waitFor(() => expect(revealEntry).toHaveBeenCalledWith("gm", "m2", false));
  });
});

describe("The warning's own switch (owner decision: there must be a way to turn it off)", () => {
  it("stops warning once the GM asks it to, and reveals straight away thereafter", async () => {
    await renderJournal([AHEAD, RECORD({ ...AHEAD, id: "m3", text: "The party reached 6." })]);
    const user = userEvent.setup();

    await user.click(switchIn("m1"));
    await user.click(await screen.findByRole("switch", { name: "Stop warning me about this" }));
    await user.click(screen.getByRole("button", { name: "Show anyway" }));
    await waitFor(() => expect(revealEntry).toHaveBeenCalledWith("gm", "m1", true));

    await user.click(switchIn("m3"));
    await waitFor(() => expect(revealEntry).toHaveBeenCalledWith("gm", "m3", true));
    expect(screen.queryByText(/dated ahead/i)).not.toBeInTheDocument();
  });

  /** Suppression only rides on the affirmative button; cancelling must not disable the warning. */
  it("does not take the switch from a dialog the GM cancelled", async () => {
    await renderJournal([AHEAD, RECORD({ ...AHEAD, id: "m3", text: "The party reached 6." })]);
    const user = userEvent.setup();

    await user.click(switchIn("m1"));
    await user.click(await screen.findByRole("switch", { name: "Stop warning me about this" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(switchIn("m3"));
    expect(await screen.findByText(/date has reached Alturiak 28, 1492 DR/)).toBeInTheDocument();
    expect(revealEntry).not.toHaveBeenCalled();
  });

  /** The shared dialog must reset the switch per request. */
  it("does not carry a flicked switch into the next dialog", async () => {
    await renderJournal([AHEAD, RECORD({ ...AHEAD, id: "m3", text: "The party reached 6." })]);
    const user = userEvent.setup();

    await user.click(switchIn("m1"));
    await user.click(await screen.findByRole("switch", { name: "Stop warning me about this" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(switchIn("m3"));
    expect(await screen.findByRole("switch", { name: "Stop warning me about this" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    await user.click(screen.getByRole("button", { name: "Show anyway" }));
    await waitFor(() => expect(revealEntry).toHaveBeenCalledWith("gm", "m3", true));

    await user.click(switchIn("m1"));
    expect(await screen.findByText(/date has reached Alturiak 28, 1492 DR/)).toBeInTheDocument();
  });

  /** The way back lives on the prep-clock row and only appears once the warning is off. */
  it("offers a way back on, only once it has been turned off", async () => {
    await renderJournal([AHEAD]);
    const user = userEvent.setup();

    expect(screen.queryByRole("button", { name: "Warn me again before showing an entry" })).not.toBeInTheDocument();

    await user.click(switchIn("m1"));
    await user.click(await screen.findByRole("switch", { name: "Stop warning me about this" }));
    await user.click(screen.getByRole("button", { name: "Show anyway" }));

    await user.click(await screen.findByRole("button", { name: "Warn me again before showing an entry" }));
    expect(screen.queryByRole("button", { name: "Warn me again before showing an entry" })).not.toBeInTheDocument();

    revealEntry.mockClear();
    await user.click(switchIn("m1"));
    expect(await screen.findByText(/date has reached Alturiak 28, 1492 DR/)).toBeInTheDocument();
    expect(revealEntry).not.toHaveBeenCalled();
  });
});

describe("Publishing the date says so (owner decision: it used to be silent)", () => {
  it("names the date the players now see", async () => {
    await renderJournal([UNDATED]);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Publish the date" }));
    await waitFor(() => expect(publishCalendar).toHaveBeenCalledWith("gm"));
    // The acknowledgement names the date and survives the prep-clock row disappearing.
    expect(await screen.findByText("Players now see Alturiak 28, 1492 DR.")).toBeInTheDocument();
  });

  it("says nothing on a failed publish — the error channel owns that", async () => {
    await renderJournal([UNDATED]);
    publishCalendar.mockRejectedValue(new Error("The calendar is locked."));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Publish the date" }));
    expect(await screen.findByText("The calendar is locked.")).toBeInTheDocument();
    expect(screen.queryByText(/Players now see/)).not.toBeInTheDocument();
  });
});

/** The record axis says "Hidden from players"; the content pill keeps "GM only". Checked on a journal row, where both appear. */
describe("The record axis and the content axis no longer share a phrase", () => {
  it("says 'Hidden from players' for the record and 'GM only' for the GM paragraph, on one row", async () => {
    await renderJournal([
      RECORD({
        id: "j4",
        text: "The party crossed the mists.",
        gmText: "Strahd was watching.",
        revealedToPlayers: false
      })
    ]);
    const row = within(rowOf("j4"));

    expect(row.getByRole("switch")).toHaveAccessibleName("Show this entry to players");
    expect(row.getByText("Hidden from players")).toBeInTheDocument();
    expect(row.getByText("GM only")).toBeInTheDocument();
    expect(row.getByText("Strahd was watching.")).toBeInTheDocument();
  });

  it("says 'Shown to players' once the record is revealed, and never 'GM only' about the record", async () => {
    await renderJournal([
      RECORD({ id: "j5", text: "The party crossed the mists.", gmText: null, revealedToPlayers: true })
    ]);
    const row = within(rowOf("j5"));

    expect(row.getByText("Shown to players")).toBeInTheDocument();
    expect(row.queryByText("Hidden from players")).not.toBeInTheDocument();
    // No GM paragraph, so no content pill.
    expect(row.queryByText("GM only")).not.toBeInTheDocument();
  });
});

describe("The reading rule itself", () => {
  it("is strictly ahead, and silent about everything it cannot honestly answer", () => {
    // Strictly after: the published day is the party's present.
    expect(revealAheadOfPlayers({ calendarInstant: 1492 * 60 + 10 }, CALENDAR)).toBe(true);
    expect(revealAheadOfPlayers({ calendarInstant: 1492 * 60 + 9 }, CALENDAR)).toBe(false);
    expect(revealAheadOfPlayers({ calendarInstant: 1492 * 60 + 8 }, CALENDAR)).toBe(false);
    expect(revealAheadOfPlayers({ calendarInstant: 1492 * 60 + 57 }, NEVER_PUBLISHED)).toBe(false);
    expect(revealAheadOfPlayers({ calendarInstant: null }, CALENDAR)).toBe(false);
    expect(revealAheadOfPlayers({ calendarInstant: 1492 * 60 + 57 }, null)).toBe(false);
    // `undefined` (a narrower calendar shape) must not reach the date maths.
    expect(
      revealAheadOfPlayers(
        { calendarInstant: 1492 * 60 + 57 },
        { ...CALENDAR, publishedDate: undefined as unknown as null }
      )
    ).toBe(false);
  });
});

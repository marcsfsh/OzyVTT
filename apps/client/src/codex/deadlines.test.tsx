import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const chronicle = vi.fn();
const listPages = vi.fn();
const getCalendar = vi.fn();
const publishCalendar = vi.fn();
const createEntry = vi.fn();
const createDeadline = vi.fn();
const createDowntime = vi.fn();
const applyDowntime = vi.fn();
const updateEntry = vi.fn();
const setCalendar = vi.fn();
const playerListPages = vi.fn();
const playerListMaps = vi.fn();
const playerListMarkers = vi.fn();
const playerChronicle = vi.fn();
const playerListRelationships = vi.fn();
const playerListLinks = vi.fn();
const playerCalendar = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: { ...actual.codexApi, listPages: (...a: unknown[]) => listPages(...a) },
    calendarApi: {
      ...actual.calendarApi,
      get: (...a: unknown[]) => getCalendar(...a),
      set: (...a: unknown[]) => setCalendar(...a),
      publish: (...a: unknown[]) => publishCalendar(...a)
    },
    journalApi: {
      ...actual.journalApi,
      chronicle: (...a: unknown[]) => chronicle(...a),
      create: (...a: unknown[]) => createEntry(...a),
      createDeadline: (...a: unknown[]) => createDeadline(...a),
      createDowntime: (...a: unknown[]) => createDowntime(...a),
      applyDowntime: (...a: unknown[]) => applyDowntime(...a),
      update: (...a: unknown[]) => updateEntry(...a)
    },
    playerCodexApi: {
      ...actual.playerCodexApi,
      listPages: (...a: unknown[]) => playerListPages(...a),
      listMaps: (...a: unknown[]) => playerListMaps(...a),
      listMarkers: (...a: unknown[]) => playerListMarkers(...a),
      chronicle: (...a: unknown[]) => playerChronicle(...a),
      listConnections: (...a: unknown[]) => playerListRelationships(...a),
      party: (...a: unknown[]) => playerListLinks(...a),
      calendar: (...a: unknown[]) => playerCalendar(...a)
    }
  };
});

import { JournalView } from "./JournalView";
import { goTo } from "../../test/route";
import { PlayerCodex } from "./PlayerCodex";
import {
  CHRONICLE_KIND_META,
  campaignDeadlines,
  deadlineFired,
  downtimeProposedDate,
  downtimeSummaryLabel
} from "./chronicle";
import { CODEX_ICONS } from "./icons";
import type { CodexChronicleRecord, GmCodexCalendar, PlayerCodexChronicleRecord } from "@vtt/domain";

const CALENDAR: GmCodexCalendar = {
  yearName: "DR",
  eras: [],
  months: [
    { name: "Hammer", days: 30 },
    { name: "Alturiak", days: 30 }
  ],
  weekdays: [],
  currentDate: { year: 1492, month: 0, day: 3 },
  publishedDate: { year: 1492, month: 0, day: 3 }
};

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

const DEADLINE = RECORD({
  kind: "deadline",
  id: "d1",
  text: "The duke's ultimatum expires.",
  inWorldLabel: "Hammer 10, 1492 DR",
  calendarInstant: 1492 * 60 + 9,
  inWorldDate: { year: 1492, month: 0, day: 10 }
});
const DOWNTIME = RECORD({
  kind: "downtime",
  id: "w1",
  text: "A quiet tenday in Daggerford.",
  payload: { who: "Aldric", activity: "Forging a blade", days: 7, characterPageId: null, applied: false },
  // The server's landing date (Hammer 3 + 7). One test makes it disagree with local arithmetic on purpose.
  proposedDate: { year: 1492, month: 0, day: 10 },
  inWorldLabel: "Hammer 3, 1492 DR",
  calendarInstant: 1492 * 60 + 2,
  inWorldDate: { year: 1492, month: 0, day: 3 }
});

const renderJournal = async (records: CodexChronicleRecord[], calendar: GmCodexCalendar = CALENDAR) => {
  chronicle.mockResolvedValue(records);
  listPages.mockResolvedValue([]);
  getCalendar.mockResolvedValue(calendar);
  render(<JournalView gmToken="gm" autosave={{ enabled: true, intervalSeconds: 1 }} pages={[]} onOpenPage={vi.fn()} />);
  await waitFor(() => expect(chronicle).toHaveBeenCalled());
};

const rowOf = (id: string) => document.getElementById(`codex-entry-${id}`)!;
const playerRowOf = (id: string) => document.getElementById(`codex-player-entry-${id}`)!;

beforeEach(() => sessionStorage.clear());

/** Filing fields live in the Details panel, whose open state persists across mounts. */
const openEntryDetails = async (user: ReturnType<typeof userEvent.setup>) => {
  const details = await screen.findByRole("button", { name: "Details" });
  if (details.getAttribute("aria-expanded") !== "true") await user.click(details);
};

describe("A new kind reads by icon AND word", () => {
  it("every chronicle kind names an icon the registry actually has", () => {
    // `iconChildren` silently falls back to `pin` for an unknown id.
    for (const [kind, meta] of Object.entries(CHRONICLE_KIND_META)) {
      expect(CODEX_ICONS[meta.iconId], `${kind} names an icon that does not exist: ${meta.iconId}`).toBeDefined();
      expect(meta.label.trim()).not.toBe("");
    }
    // Distinct labels, or colour would be the only difference.
    const labels = Object.values(CHRONICLE_KIND_META).map((meta) => meta.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("a deadline and a downtime row each say their kind in text, with no colour at all", async () => {
    await renderJournal([DEADLINE, DOWNTIME]);
    // Colour is CSS-only, so the row text must distinguish the kinds.
    expect(rowOf("d1").textContent).toContain("Deadline");
    expect(rowOf("w1").textContent).toContain("Downtime");
    expect(rowOf("d1").querySelector(".codex-entry-kindglyph")).not.toBeNull();
    expect(rowOf("w1").querySelector(".codex-entry-kindglyph")).not.toBeNull();
  });
});

describe("A deadline's state is the SERVER's, and it reads as a word", () => {
  it("says Approaching before the campaign passes it and Passed after", async () => {
    await renderJournal([DEADLINE, { ...DEADLINE, id: "d2", fired: true, text: "The comet fell." }]);

    expect(within(rowOf("d1")).getByText("Approaching")).toBeInTheDocument();
    expect(within(rowOf("d2")).getByText("Passed")).toBeInTheDocument();
    expect(within(rowOf("d1")).queryByText("Passed")).not.toBeInTheDocument();
  });

  it("says nothing about firing on a record that is not a deadline", async () => {
    // The kind gate stops a non-deadline that carries the flag from showing a state.
    await renderJournal([RECORD({ id: "j9", fired: true })]);
    expect(rowOf("j9").textContent).not.toContain("Passed");
    expect(rowOf("j9").textContent).not.toContain("Approaching");
  });
});

describe("Downtime proposes; the GM confirms", () => {
  it("logging downtime writes a record and does not touch the clock", async () => {
    await renderJournal([]);
    createDowntime.mockResolvedValue({ entry: {}, proposedDate: { year: 1492, month: 0, day: 10 } });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Downtime" }));
    await user.type(screen.getByLabelText("Who"), "Aldric");
    await user.type(screen.getByLabelText("Activity"), "Forging a blade");
    await user.type(screen.getByLabelText("Days"), "7");
    await user.click(screen.getByRole("button", { name: "Log downtime" }));

    await waitFor(() => expect(createDowntime).toHaveBeenCalled());
    expect(createDowntime.mock.calls.at(-1)![1].downtime).toEqual({
      who: "Aldric",
      activity: "Forging a blade",
      days: 7
    });
    // Creating downtime must not move the clock.
    expect(applyDowntime).not.toHaveBeenCalled();
    expect(setCalendar).not.toHaveBeenCalled();
    expect(publishCalendar).not.toHaveBeenCalled();
  });

  it("states what confirming will do BEFORE the button that does it", async () => {
    await renderJournal([DOWNTIME]);
    applyDowntime.mockResolvedValue({ entry: {}, calendar: CALENDAR });
    const user = userEvent.setup();
    const row = within(rowOf("w1"));

    expect(row.getByText("Move your date to Hammer 10, 1492 DR")).toBeInTheDocument();
    expect(row.getByText("Aldric · Forging a blade · 7 days")).toBeInTheDocument();

    await user.click(row.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(applyDowntime).toHaveBeenCalledWith("gm", "w1"));
  });

  /** The fixture is built so each likely bug gives a different number: all 4, ignoring `fired` 3, `<` in place of `<=` 1. */
  it("says how many deadlines confirming would pass", async () => {
    await renderJournal([
      DOWNTIME, // proposes Hammer 10
      DEADLINE, // Hammer 10, exactly the landing day: counts
      RECORD({
        kind: "deadline",
        id: "d2",
        text: "The caravan leaves.",
        fired: false,
        inWorldLabel: "Hammer 5, 1492 DR",
        calendarInstant: 1492 * 60 + 4,
        inWorldDate: { year: 1492, month: 0, day: 5 }
      }),
      RECORD({
        kind: "deadline",
        id: "d3",
        text: "The tax was due.",
        fired: true, // already passed: not caused by this
        inWorldLabel: "Hammer 2, 1492 DR",
        calendarInstant: 1492 * 60 + 1,
        inWorldDate: { year: 1492, month: 0, day: 2 }
      }),
      RECORD({
        kind: "deadline",
        id: "d4",
        text: "Midwinter.",
        fired: false, // beyond the landing day
        inWorldLabel: "Alturiak 20, 1492 DR",
        calendarInstant: 1492 * 60 + 49,
        inWorldDate: { year: 1492, month: 1, day: 20 }
      })
    ]);
    const row = within(rowOf("w1"));

    expect(row.getByText("Move your date to Hammer 10, 1492 DR. This passes 2 deadlines.")).toBeInTheDocument();
  });

  it("counts one deadline in the singular", async () => {
    await renderJournal([DOWNTIME, DEADLINE]);
    expect(
      within(rowOf("w1")).getByText("Move your date to Hammer 10, 1492 DR. This passes 1 deadline.")
    ).toBeInTheDocument();
  });

  /** A warning that is always present stops being read. */
  it("adds no clause when the move passes nothing", async () => {
    await renderJournal([
      DOWNTIME,
      RECORD({
        kind: "deadline",
        id: "d5",
        text: "Midwinter.",
        fired: false,
        inWorldLabel: "Alturiak 20, 1492 DR",
        calendarInstant: 1492 * 60 + 49,
        inWorldDate: { year: 1492, month: 1, day: 20 }
      })
    ]);
    const row = within(rowOf("w1"));

    expect(row.getByText("Move your date to Hammer 10, 1492 DR")).toBeInTheDocument();
    expect(row.queryByText(/deadline/)).not.toBeInTheDocument();
  });

  /** Server and local arithmetic disagree here, so the row can only show Alturiak 12 by reading the server. */
  it("names the SERVER's proposed date, not a locally recomputed one", async () => {
    await renderJournal([RECORD({ ...DOWNTIME, id: "w3", proposedDate: { year: 1492, month: 1, day: 12 } })]);
    const row = within(rowOf("w3"));

    expect(row.getByText("Move your date to Alturiak 12, 1492 DR")).toBeInTheDocument();
    expect(row.queryByText(/Hammer 10/)).not.toBeInTheDocument();
  });

  /** No server date, no promise, no Confirm. */
  it("promises nothing when the server proposed no date", async () => {
    await renderJournal([RECORD({ ...DOWNTIME, id: "w4", proposedDate: null })]);
    const row = within(rowOf("w4"));

    expect(row.queryByText(/Advance the campaign clock/)).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });

  /** The edit path must guard the date too; a dateless deadline never fires. */
  it("will not let an edit take a deadline's date away", async () => {
    await renderJournal([DEADLINE, RECORD()]); // the ordinary entry is the contrast
    const user = userEvent.setup();
    await user.click(within(rowOf(DEADLINE.id)).getByRole("button", { name: "Edit" }));

    const save = screen.getByRole("button", { name: "Save entry" });
    expect(save).not.toBeDisabled();

    await openEntryDetails(user);
    await user.clear(screen.getByLabelText("Year"));
    expect(save).toBeDisabled();
    expect(screen.getByText(/A deadline needs a date/)).toBeInTheDocument();
    expect(updateEntry).not.toHaveBeenCalled();

    // Only a deadline's date is required.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(within(rowOf("j1")).getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Year"));
    expect(screen.getByRole("button", { name: "Save entry" })).not.toBeDisabled();
  });

  it("offers no second confirmation once the clock has already been advanced", async () => {
    await renderJournal([
      RECORD({
        ...DOWNTIME,
        id: "w2",
        payload: { who: "Aldric", activity: "Forging a blade", days: 7, characterPageId: null, applied: true }
      })
    ]);
    const row = within(rowOf("w2"));

    expect(row.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(row.queryByText(/Advance the campaign clock/)).not.toBeInTheDocument();
    // An applied downtime still says what it was.
    expect(row.getByText("Aldric · Forging a blade · 7 days")).toBeInTheDocument();
    expect(row.getByText(/Your date has already been moved/)).toBeInTheDocument();
  });
});

describe("A deadline cannot be written without a date", () => {
  it("will not arm until the date is there, then sends the raw date the GM typed", async () => {
    await renderJournal([]);
    createDeadline.mockResolvedValue({});
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Deadline" }));
    await user.type(screen.getByLabelText("Player-visible notes"), "The duke's ultimatum expires.");
    // A deadline with no date could never fire.
    expect(screen.getByRole("button", { name: "Add deadline" })).toBeDisabled();
    expect(screen.getByText(/A deadline needs a date/)).toBeInTheDocument();

    await openEntryDetails(user);
    await user.type(screen.getByLabelText("Year"), "1492");
    await user.type(screen.getByLabelText("Day"), "10");
    await user.click(screen.getByRole("button", { name: "Add deadline" }));

    await waitFor(() => expect(createDeadline).toHaveBeenCalled());
    const payload = createDeadline.mock.calls.at(-1)![1];
    expect(payload.inWorldDate).toEqual({ year: 1492, month: 0, day: 10 });
    expect(payload.playerText).toBe("The duke's ultimatum expires.");
    // A deadline stores no payload; its text is what will happen.
    expect(payload).not.toHaveProperty("downtime");
    expect(createEntry).not.toHaveBeenCalled();
  });
});

describe("The prep clock is quiet until it matters", () => {
  it("says nothing at all while the GM's clock and the players' clock agree", async () => {
    await renderJournal([]);
    // While the clocks agree there is no prep-clock UI at all.
    expect(screen.queryByRole("button", { name: "Publish the date" })).not.toBeInTheDocument();
    expect(screen.queryByText("Players' date:")).not.toBeInTheDocument();
    expect(screen.getByText(/(Your date|Today): Hammer 3, 1492 DR/)).toBeInTheDocument();
  });

  it("shows what the table is on, and publishes, once the two diverge", async () => {
    await renderJournal([], {
      ...CALENDAR,
      currentDate: { year: 1492, month: 0, day: 20 },
      publishedDate: { year: 1492, month: 0, day: 3 }
    });
    publishCalendar.mockResolvedValue(CALENDAR);
    const user = userEvent.setup();

    expect(screen.getByText("Players' date:")).toBeInTheDocument();
    // Both dates on screen: the GM's ahead, the players' behind.
    expect(screen.getByText("Your date: Hammer 20, 1492 DR")).toBeInTheDocument();
    expect(screen.getByText("Hammer 3, 1492 DR")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Publish the date" }));
    await waitFor(() => expect(publishCalendar).toHaveBeenCalledWith("gm"));
    // Publishing is never a side effect of saving the calendar.
    expect(setCalendar).not.toHaveBeenCalled();
  });
});

describe("The player's chronicle and the player's clock", () => {
  const PLAYER_RECORD = (over: Partial<PlayerCodexChronicleRecord> = {}): PlayerCodexChronicleRecord => ({
    kind: "entry",
    id: "j1",
    title: null,
    text: "The party crossed the mists.",
    sessionId: null,
    sessionNumber: null,
    realDate: null,
    inWorldLabel: null,
    inWorldDate: null,
    calendarInstant: null,
    tags: [],
    payload: null,
    fired: false,
    firstShownAt: "2026-07-20T00:00:00.000Z",
    ...over
  });

  const renderPlayer = async (records: PlayerCodexChronicleRecord[]) => {
    playerListPages.mockResolvedValue([]);
    playerListMaps.mockResolvedValue([]);
    playerListMarkers.mockResolvedValue([]);
    playerChronicle.mockResolvedValue(records);
    playerListRelationships.mockResolvedValue([]);
    playerListLinks.mockResolvedValue(null);
    // The player projection: `currentDate` is the published date; no GM clock on this shape.
    playerCalendar.mockResolvedValue({
      yearName: "DR",
      months: CALENDAR.months,
      weekdays: [],
      currentDate: { year: 1492, month: 0, day: 3 }
    });
    (goTo("/codex"), render)(<PlayerCodex token="player" />);
    await waitFor(() => expect(playerChronicle).toHaveBeenCalled());
  };

  it("reads a revealed deadline and a revealed downtime with their icon and their word", async () => {
    const user = userEvent.setup();
    await renderPlayer([
      PLAYER_RECORD({
        kind: "deadline",
        id: "d1",
        text: "The duke's ultimatum expires.",
        inWorldLabel: "Hammer 10, 1492 DR",
        fired: true
      }),
      PLAYER_RECORD({
        kind: "downtime",
        id: "w1",
        text: "A quiet tenday.",
        payload: { who: "Aldric", activity: "Forging a blade", days: 7, characterPageId: null }
      })
    ]);
    await user.click(screen.getByRole("button", { name: "Story" }));

    expect(playerRowOf("d1").textContent).toContain("Deadline");
    expect(playerRowOf("d1").querySelector(".codex-entry-kindglyph")).not.toBeNull();
    expect(within(playerRowOf("d1")).getByText("Passed")).toBeInTheDocument();
    expect(playerRowOf("w1").textContent).toContain("Downtime");
    expect(within(playerRowOf("w1")).getByText("Aldric · Forging a blade · 7 days")).toBeInTheDocument();
  });

  it("never asks the GM calendar route, and never offers a Confirm", async () => {
    await renderPlayer([
      PLAYER_RECORD({
        kind: "downtime",
        id: "w1",
        text: "A quiet tenday.",
        payload: { who: "Aldric", activity: "Forging a blade", days: 7, characterPageId: null }
      })
    ]);

    // What a client test can prove: this surface asks the player route, never `calendarApi.get`.
    expect(playerCalendar).toHaveBeenCalledWith("player");
    expect(getCalendar).not.toHaveBeenCalled();
    expect(await screen.findByText("Hammer 3, 1492 DR")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
    // Applying downtime is GM-only; `applied` isn't even on the player payload.
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Advance the campaign clock/)).not.toBeInTheDocument();
  });
});

/**
 * jsdom can't measure 44px, but it can check which tap route each control takes: default-size `Button`
 * grows its paint; `size="sm"` adds an ::after that would overlap neighbours in these stacks.
 */
describe("The new controls take the tap route a stacked control needs", () => {
  it("Confirm and Publish are route 1, and the card's rows use the route-1 chassis", async () => {
    await renderJournal([DOWNTIME], { ...CALENDAR, currentDate: { year: 1492, month: 0, day: 20 } });

    const confirm = within(rowOf("w1")).getByRole("button", { name: "Confirm" });
    expect(confirm).toHaveClass("nh-btn");
    expect(confirm).not.toHaveClass("nh-btn--sm");
    expect(confirm).not.toHaveClass("tap-target");

    const publish = screen.getByRole("button", { name: "Publish the date" });
    expect(publish).toHaveClass("nh-btn");
    expect(publish).not.toHaveClass("nh-btn--sm");
    expect(publish).not.toHaveClass("tap-target");

    // `@vtt/ui` inputs carry the tap floor themselves.
    await userEvent.setup().click(screen.getByRole("button", { name: "Downtime" }));
    for (const label of ["Who", "Activity", "Days"]) expect(screen.getByLabelText(label)).toHaveClass("nh-input");
  });
});

describe("The shared reading rules themselves", () => {
  it("only a deadline can be fired, and an absent flag reads as not fired", () => {
    // The kind check, and `=== true` so a row without the key reads as not fired.
    expect(deadlineFired({ kind: "deadline", fired: true })).toBe(true);
    expect(deadlineFired({ kind: "deadline", fired: false })).toBe(false);
    expect(deadlineFired({ kind: "entry", fired: true })).toBe(false);
    expect(deadlineFired({ kind: "downtime", fired: true })).toBe(false);
    expect(deadlineFired({ kind: "deadline" })).toBe(false);
  });

  it("orders deadlines passed-first and leaves every other kind out", () => {
    const records = [RECORD({ id: "j1" }), DEADLINE, RECORD({ ...DEADLINE, id: "d2", fired: true }), DOWNTIME];
    expect(campaignDeadlines(records).map((record) => record.id)).toEqual(["d2", "d1"]);
  });

  it("walks months and years when downtime advances the clock, and never clamps into the wrong day", () => {
    const calendar = {
      yearName: "DR",
      months: [
        { name: "Hammer", days: 30 },
        { name: "Alturiak", days: 30 }
      ],
      weekdays: []
    };
    expect(downtimeProposedDate({ ...calendar, currentDate: { year: 1492, month: 0, day: 3 } }, 7)).toEqual({
      year: 1492,
      month: 0,
      day: 10
    });
    // Rolls into the next month.
    expect(downtimeProposedDate({ ...calendar, currentDate: { year: 1492, month: 0, day: 28 } }, 5)).toEqual({
      year: 1492,
      month: 1,
      day: 3
    });
    // Rolls the year.
    expect(downtimeProposedDate({ ...calendar, currentDate: { year: 1492, month: 1, day: 28 } }, 5)).toEqual({
      year: 1493,
      month: 0,
      day: 3
    });
    // A stored day 31 of a 30-day month counts as day 30, as on the server, so +1 is the next month's day 1.
    expect(downtimeProposedDate({ ...calendar, currentDate: { year: 1492, month: 0, day: 31 } }, 1)).toEqual({
      year: 1492,
      month: 1,
      day: 1
    });
    expect(downtimeProposedDate({ ...calendar, currentDate: null }, 7)).toBeNull();
    expect(downtimeProposedDate(null, 7)).toBeNull();
  });

  it("says a downtime in one line without inventing punctuation for the halves it was not given", () => {
    expect(downtimeSummaryLabel({ who: "Aldric", activity: "Forging a blade", days: 7, characterPageId: null })).toBe(
      "Aldric · Forging a blade · 7 days"
    );
    expect(downtimeSummaryLabel({ who: "", activity: "Carousing", days: 1, characterPageId: null })).toBe(
      "Carousing · 1 day"
    );
    expect(downtimeSummaryLabel({ who: "", activity: "", days: 0, characterPageId: null })).toBe("0 days");
  });
});

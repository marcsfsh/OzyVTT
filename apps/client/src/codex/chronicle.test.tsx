import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const chronicle = vi.fn();
const listPages = vi.fn();
const getCalendar = vi.fn();
const revealEntry = vi.fn();
const revealPage = vi.fn();
const updatePage = vi.fn();
// The editor's Connections area reads entries and pins on mount; stub them so no error Alert appears.
const markersForPage = vi.fn();
const forPage = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      listPages: (...a: unknown[]) => listPages(...a),
      revealPage: (...a: unknown[]) => revealPage(...a),
      updatePage: (...a: unknown[]) => updatePage(...a),
      markersForPage: (...a: unknown[]) => markersForPage(...a)
    },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    journalApi: {
      ...actual.journalApi,
      chronicle: (...a: unknown[]) => chronicle(...a),
      reveal: (...a: unknown[]) => revealEntry(...a),
      forPage: (...a: unknown[]) => forPage(...a)
    }
  };
});

import { JournalView } from "./JournalView";
import { groupChronicle } from "./chronicle";
import type { CodexCalendar, CodexChronicleRecord } from "@vtt/domain";

/**
 * One timeline of journal entries and dated `event` pages. Kinds read by icon and label as well as colour; the
 * lens toggle regroups without refetching or writing.
 */
const CALENDAR: CodexCalendar = {
  yearName: "DR",
  months: [
    { name: "Hammer", days: 30 },
    { name: "Alturiak", days: 30 }
  ],
  weekdays: []
};

const ENTRY: CodexChronicleRecord = {
  kind: "entry",
  id: "j1",
  title: null,
  text: "The party crossed the mists.",
  gmText: null,
  revealedToPlayers: false,
  sessionId: null,
  sessionNumber: 3,
  realDate: null,
  inWorldLabel: "Hammer 1, 1492 DR",
  calendarInstant: 1492 * 60,
  inWorldDate: { year: 1492, month: 0, day: 1 },
  tags: [],
  attachPageId: null,
  attachMarkerId: null,
  sourceEncounterId: null,
  payload: null,
  fired: false,
  proposedDate: null,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z"
};
const EVENT: CodexChronicleRecord = {
  kind: "event",
  id: "p9",
  title: "The Sundering",
  text: "The sky tore open.",
  gmText: "Strahd engineered it.",
  revealedToPlayers: false,
  sessionId: null,
  sessionNumber: null,
  realDate: null,
  inWorldLabel: "Hammer 2, 1493 DR",
  calendarInstant: 1493 * 60 + 1,
  inWorldDate: { year: 1493, month: 0, day: 2 },
  tags: [],
  attachPageId: null,
  attachMarkerId: null,
  sourceEncounterId: null,
  payload: null,
  fired: false,
  proposedDate: null,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z"
};

const renderJournal = async (records: CodexChronicleRecord[], onOpenPage = vi.fn()) => {
  chronicle.mockResolvedValue(records);
  listPages.mockResolvedValue([]);
  getCalendar.mockResolvedValue(CALENDAR);
  render(
    <JournalView gmToken="gm" autosave={{ enabled: true, intervalSeconds: 1 }} pages={[]} onOpenPage={onOpenPage} />
  );
  await waitFor(() => expect(chronicle).toHaveBeenCalled());
  return onOpenPage;
};

// The lens persists in sessionStorage, so clear it between tests.
beforeEach(() => sessionStorage.clear());

const rowOf = (id: string) => document.getElementById(`codex-entry-${id}`)!;
/** The group headings, in order. */
const headings = () => [...document.querySelectorAll(".codex-timeline-year")].map((node) => node.textContent);

describe("The chronicle is ONE timeline", () => {
  it("renders a dated event page beside a journal entry, each naming its own kind", async () => {
    await renderJournal([ENTRY, EVENT]);

    const event = within(rowOf("p9"));
    expect(event.getByText("The Sundering")).toBeInTheDocument(); // the page's title
    expect(event.getByText("The sky tore open.")).toBeInTheDocument(); // its player-facing excerpt
    expect(event.getByText("Event")).toBeInTheDocument();
    expect(within(rowOf("j1")).getByText("Entry")).toBeInTheDocument();
  });

  it("a record's kind reads without any colour at all", async () => {
    await renderJournal([ENTRY, EVENT]);
    // Colour is CSS-only, so each row's text must distinguish its kind.
    expect(rowOf("p9").textContent).toContain("Event");
    expect(rowOf("j1").textContent).toContain("Entry");
    expect(rowOf("p9").querySelector(".codex-entry-kindglyph")).not.toBeNull();
    expect(rowOf("j1").querySelector(".codex-entry-kindglyph")).not.toBeNull();
  });

  it("offers an event row its page, and never the entry composer's Edit/Delete", async () => {
    // An event is a wiki page and is edited there, never from the row.
    const onOpenPage = await renderJournal([EVENT]);
    const user = userEvent.setup();
    const event = within(rowOf("p9"));
    expect(event.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(event.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();

    await user.click(event.getByRole("button", { name: "Open page" }));
    expect(onOpenPage).toHaveBeenCalledWith("p9");
  });

  it("reveals an event through the PAGE route, not the journal route", async () => {
    // One record, one reveal state: the row's switch flips the page's own flag.
    await renderJournal([EVENT]);
    revealPage.mockResolvedValue({});
    const user = userEvent.setup();

    await user.click(within(rowOf("p9")).getByLabelText("Show this event to players"));

    await waitFor(() => expect(revealPage).toHaveBeenCalledWith("gm", "p9", true));
    expect(revealEntry).not.toHaveBeenCalled();
  });

  it("does not regress an ordinary entry: text, date and its own actions all survive", async () => {
    await renderJournal([ENTRY]);
    const entry = within(rowOf("j1"));
    expect(entry.getByText("The party crossed the mists.")).toBeInTheDocument();
    expect(entry.getByText("Hammer 1, 1492 DR")).toBeInTheDocument();
    expect(entry.getByText("Session 3")).toBeInTheDocument();
    expect(entry.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(entry.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});

describe("Two lenses over the same records", () => {
  it("regroups without refetching and without writing anything", async () => {
    await renderJournal([ENTRY, EVENT]);
    const user = userEvent.setup();
    expect(chronicle).toHaveBeenCalledTimes(1);

    // By date: one group per year.
    expect(headings()).toEqual(["1492 DR", "1493 DR"]);

    await user.click(screen.getByRole("button", { name: "By session" }));

    // By session: the event goes under "No session yet". Read the headings, since the entry row also says "Session 3".
    expect(headings()).toEqual(["Session 3", "No session yet"]);
    expect(screen.queryByText("1493 DR")).not.toBeInTheDocument();
    // Same data, no refetch, no write.
    expect(chronicle).toHaveBeenCalledTimes(1);
    expect(revealEntry).not.toHaveBeenCalled();
    expect(revealPage).not.toHaveBeenCalled();
    expect(rowOf("j1")).toBeInTheDocument();
    expect(rowOf("p9")).toBeInTheDocument();
  });

  it("groups by year ascending with undated last, and by session with the unsessioned last", () => {
    // The grouping contract on its own, below the component.
    const undated: CodexChronicleRecord = {
      ...ENTRY,
      id: "j0",
      sessionId: null,
      sessionNumber: null,
      calendarInstant: null,
      inWorldDate: null,
      inWorldLabel: null
    };
    const records = [ENTRY, EVENT, undated];

    expect(
      groupChronicle(records, "date", CALENDAR).map((group) => [group.label, group.records.map((record) => record.id)])
    ).toEqual([
      ["1492 DR", ["j1"]],
      ["1493 DR", ["p9"]],
      ["Undated", ["j0"]]
    ]);
    expect(
      groupChronicle(records, "session", CALENDAR).map((group) => [
        group.label,
        group.records.map((record) => record.id)
      ])
    ).toEqual([
      ["Session 3", ["j1"]],
      ["No session yet", ["p9", "j0"]]
    ]);
    // Both lenses cover exactly the same records.
    for (const lens of ["date", "session"] as const) {
      expect(
        groupChronicle(records, lens, CALENDAR)
          .flatMap((group) => group.records.map((record) => record.id))
          .sort()
      ).toEqual(["j0", "j1", "p9"]);
    }
  });
});

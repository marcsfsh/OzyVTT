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
// The editor's Connections area reads a page's entries and pins on mount; neither is what this file is
// about, and an unstubbed read would put its own error Alert on screen.
const markersForPage = vi.fn();
const forPage = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      listPages: (...a: unknown[]) => listPages(...a), revealPage: (...a: unknown[]) => revealPage(...a),
      updatePage: (...a: unknown[]) => updatePage(...a), markersForPage: (...a: unknown[]) => markersForPage(...a)
    },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    journalApi: { ...actual.journalApi, chronicle: (...a: unknown[]) => chronicle(...a), reveal: (...a: unknown[]) => revealEntry(...a), forPage: (...a: unknown[]) => forPage(...a) }
  };
});

import { JournalView } from "./JournalView";
import { PageEditor } from "./PageEditor";
import { groupChronicle } from "./chronicle";
import type { CodexCalendar, CodexChronicleRecord, CodexPage } from "./api";

/**
 * CT-11 / CT-12 on the client: **one** timeline carrying journal entries and dated `event` pages, read
 * through two lenses.
 *
 * What these are actually for, stated so a later reader does not soften them:
 *  - **R2** — one row shape for every record, and the kind readable by icon + label rather than colour.
 *    The colour assertion is the one that matters: it is the accessibility rule, and it is the one a
 *    "tidy-up" would quietly break by dropping the kind badge as redundant.
 *  - **CT-12** — the lens toggle is a REGROUPING. It must not refetch (two fetches are two answers that
 *    can disagree) and must not write (a lens is a way of looking, not an edit).
 *  - **Non-regression** — an ordinary entry still renders its text, its date and its Edit/Delete actions.
 */
const CALENDAR: CodexCalendar = { yearName: "DR", months: [{ name: "Hammer", days: 30 }, { name: "Alturiak", days: 30 }], weekdays: [] };

const ENTRY: CodexChronicleRecord = {
  kind: "entry", id: "j1", title: null, text: "The party crossed the mists.", gmText: null, revealedToPlayers: false,
  sessionNumber: 3, realDate: null, inWorldLabel: "Hammer 1, 1492 DR", calendarInstant: 1492 * 60, inWorldDate: { year: 1492, month: 0, day: 1 },
  tags: [], attachPageId: null, attachMarkerId: null, sourceEncounterId: null,
  createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z"
};
const EVENT: CodexChronicleRecord = {
  kind: "event", id: "p9", title: "The Sundering", text: "The sky tore open.", gmText: "Strahd engineered it.", revealedToPlayers: false,
  sessionNumber: null, realDate: null, inWorldLabel: "Hammer 2, 1493 DR", calendarInstant: 1493 * 60 + 1, inWorldDate: { year: 1493, month: 0, day: 2 },
  tags: [], attachPageId: null, attachMarkerId: null, sourceEncounterId: null,
  createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z"
};

const renderJournal = async (records: CodexChronicleRecord[], onOpenPage = vi.fn()) => {
  chronicle.mockResolvedValue(records);
  listPages.mockResolvedValue([]);
  getCalendar.mockResolvedValue(CALENDAR);
  render(<JournalView gmToken="gm" onOpenPage={onOpenPage} />);
  await waitFor(() => expect(chronicle).toHaveBeenCalled());
  return onOpenPage;
};

// The lens persists in sessionStorage (it is a reading preference), so a test that toggles it would
// otherwise decide the starting lens of every test after it.
beforeEach(() => sessionStorage.clear());

const rowOf = (id: string) => document.getElementById(`codex-entry-${id}`)!;
/** The timeline's group headings, in order — the only honest read of "how is this grouped right now". */
const headings = () => [...document.querySelectorAll(".codex-timeline-year")].map((node) => node.textContent);

describe("The chronicle is ONE timeline (CT-11)", () => {
  it("renders a dated event page beside a journal entry, each naming its own kind", async () => {
    await renderJournal([ENTRY, EVENT]);

    const event = within(rowOf("p9"));
    expect(event.getByText("The Sundering")).toBeInTheDocument();      // the page's title
    expect(event.getByText("The sky tore open.")).toBeInTheDocument(); // its player-facing excerpt
    expect(event.getByText("Event")).toBeInTheDocument();
    expect(within(rowOf("j1")).getByText("Entry")).toBeInTheDocument();
  });

  it("R2: a record's kind reads without any colour at all", async () => {
    await renderJournal([ENTRY, EVENT]);
    // The rule is "icon + label, never colour alone". Colour lives entirely in CSS classes, so the proof
    // is that the *text* of each row already distinguishes the kinds: strip every stylesheet and a reader
    // still knows which row is which. A row whose only kind signal were its accent fails this.
    expect(rowOf("p9").textContent).toContain("Event");
    expect(rowOf("j1").textContent).toContain("Entry");
    expect(rowOf("p9").querySelector(".codex-entry-kindglyph")).not.toBeNull();
    expect(rowOf("j1").querySelector(".codex-entry-kindglyph")).not.toBeNull();
  });

  it("offers an event row its page, and never the entry composer's Edit/Delete", async () => {
    // An event is a wiki page: editing it from a timeline row would be a second place to edit one record.
    const onOpenPage = await renderJournal([EVENT]);
    const user = userEvent.setup();
    const event = within(rowOf("p9"));
    expect(event.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(event.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();

    await user.click(event.getByRole("button", { name: "Open page" }));
    expect(onOpenPage).toHaveBeenCalledWith("p9");
  });

  it("reveals an event through the PAGE route, not the journal route", async () => {
    // One record has one reveal state. Flipping the row's switch must flip the page's own flag, or the
    // chronicle becomes a second, disagreeing copy of it.
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

describe("Two lenses over the same records (CT-12)", () => {
  it("regroups without refetching and without writing anything", async () => {
    await renderJournal([ENTRY, EVENT]);
    const user = userEvent.setup();
    expect(chronicle).toHaveBeenCalledTimes(1);

    // By in-world date: one group per year, and the event's year is its own.
    expect(headings()).toEqual(["1492 DR", "1493 DR"]);

    await user.click(screen.getByRole("button", { name: "By session" }));

    // By session: the entry under its session, the event under "No session yet" (sessions arrive in M9).
    // Read the GROUP HEADINGS, not any text on the page — the entry's own row also says "Session 3", and
    // a looser query would pass on that alone while the grouping did nothing.
    expect(headings()).toEqual(["Session 3", "No session yet"]);
    expect(screen.queryByText("1493 DR")).not.toBeInTheDocument();
    // The two properties that make this a LENS: same data, no server round-trip, no mutation.
    expect(chronicle).toHaveBeenCalledTimes(1);
    expect(revealEntry).not.toHaveBeenCalled();
    expect(revealPage).not.toHaveBeenCalled();
    expect(rowOf("j1")).toBeInTheDocument();
    expect(rowOf("p9")).toBeInTheDocument();
  });

  it("groups by year ascending with undated last, and by session with the unsessioned last", () => {
    // The grouping rule on its own, below the component: a UI test can only show one arrangement, and the
    // ordering contract is what the two lenses actually promise.
    const undated: CodexChronicleRecord = { ...ENTRY, id: "j0", sessionNumber: null, calendarInstant: null, inWorldDate: null, inWorldLabel: null };
    const records = [ENTRY, EVENT, undated];

    expect(groupChronicle(records, "date", CALENDAR).map((group) => [group.label, group.records.map((record) => record.id)]))
      .toEqual([["1492 DR", ["j1"]], ["1493 DR", ["p9"]], ["Undated", ["j0"]]]);
    expect(groupChronicle(records, "session", CALENDAR).map((group) => [group.label, group.records.map((record) => record.id)]))
      .toEqual([["Session 3", ["j1"]], ["No session yet", ["p9", "j0"]]]);
    // Neither lens invents or drops a record: both partitions cover exactly the same set.
    for (const lens of ["date", "session"] as const) {
      expect(groupChronicle(records, lens, CALENDAR).flatMap((group) => group.records.map((record) => record.id)).sort())
        .toEqual(["j0", "j1", "p9"]);
    }
  });
});

/**
 * Dating a page in the editor (CT-11). The editor autosaves the WHOLE draft on a debounce, so the
 * question that matters is not only "does a date reach the server" but "what does a save say about the
 * date when the page has no date control at all" — because `inWorldDate: null` on that path would erase
 * an event's date the moment it were demoted to a note and edited.
 */
describe("An event page is dated in the editor (CT-11)", () => {
  const PAGE: CodexPage = {
    id: "p9", title: "The Sundering", entityType: "event", fields: {}, gmFields: {},
    folder: null, tags: [], revealedToPlayers: false, bannerAssetId: null,
    inWorldLabel: null, calendarInstant: null, inWorldDate: null, rev: 3,
    createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z",
    playerBody: "The sky tore open.", gmBody: ""
  };
  const renderEditor = (page: CodexPage) => render(
    <PageEditor gmToken="gm" page={page} pages={[page]} backlinks={[]} relationships={[]}
      onChange={() => {}} onDeleted={() => {}} onNavigate={() => {}} onRelationshipsChanged={() => {}} />
  );

  beforeEach(() => {
    updatePage.mockResolvedValue({ ...PAGE, rev: 4 });
    markersForPage.mockResolvedValue([]);
    forPage.mockResolvedValue([]);
    getCalendar.mockResolvedValue(CALENDAR);
  });

  it("offers the date control on an event and on nothing else", async () => {
    const { unmount } = renderEditor(PAGE);
    expect(await screen.findByLabelText("Year")).toBeInTheDocument();
    unmount();

    renderEditor({ ...PAGE, entityType: "location" });
    await waitFor(() => expect(markersForPage).toHaveBeenCalled());
    expect(screen.queryByLabelText("Year")).not.toBeInTheDocument();
  });

  it("sends the raw date the GM typed, and nothing derived from it", async () => {
    const user = userEvent.setup();
    renderEditor(PAGE);
    await user.type(await screen.findByLabelText("Year"), "1492");
    await user.type(screen.getByLabelText("Day"), "2");

    await waitFor(() => expect(updatePage).toHaveBeenCalled(), { timeout: 3000 });
    const payload = updatePage.mock.calls.at(-1)![2];
    expect(payload.inWorldDate).toEqual({ year: 1492, month: 0, day: 2 });
    // The sort key and the label are the server's to derive; a client that sent either would be a second
    // authority on where this record sits, and it would go stale the next time the calendar changed.
    expect(payload).not.toHaveProperty("calendarInstant");
    expect(payload).not.toHaveProperty("inWorldLabel");
  });

  it("says nothing about the date when the page is not an event", async () => {
    // A `location` page has no date control, so a save must OMIT the key. Sending `null` here is what
    // would silently un-date an event the moment it was demoted and its body touched.
    const user = userEvent.setup();
    renderEditor({ ...PAGE, entityType: "location" });
    await user.type(await screen.findByLabelText("Page title"), "!");

    await waitFor(() => expect(updatePage).toHaveBeenCalled(), { timeout: 3000 });
    expect(updatePage.mock.calls.at(-1)![2]).not.toHaveProperty("inWorldDate");
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const timeline = vi.fn();
const chronicle = vi.fn();
const createEntry = vi.fn();
const updateEntry = vi.fn();
const listPages = vi.fn();
const getCalendar = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: { ...actual.codexApi, listPages: (...a: unknown[]) => listPages(...a) },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    journalApi: {
      ...actual.journalApi,
      timeline: (...a: unknown[]) => timeline(...a),
      chronicle: (...a: unknown[]) => chronicle(...a),
      create: (...a: unknown[]) => createEntry(...a),
      update: (...a: unknown[]) => updateEntry(...a)
    },
    atlasApi: {
      ...actual.atlasApi
    }
  };
});

import { JournalView } from "./JournalView";
import type { CodexCalendar, CodexChronicleRecord, CodexJournalEntry } from "@vtt/domain";

/**
 * Maps, markers and journal entries show and edit tags, and what leaves the client already satisfies the
 * server's slug rule (it rejects non-slugs), which is why editors keep `TagInput`'s default slugify.
 */
const CALENDAR: CodexCalendar = { yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] };

const ENTRY = (over: Partial<CodexJournalEntry> = {}): CodexJournalEntry => ({
  id: "j1",
  playerText: "The party reached Barovia.",
  gmText: null,
  revealedToPlayers: false,
  kind: "note",
  attachMarkerId: null,
  attachPageId: null,
  sourceEncounterId: null,
  payload: null,
  sessionId: null,
  sessionNumber: null,
  realDate: null,
  inWorldLabel: null,
  calendarInstant: null,
  inWorldDate: null,
  sortKey: 0,
  tags: ["dark-gift"],
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  firstShownAt: null,
  ...over
});

/** The Journal reads the chronicle record shape. */
const RECORD = (over: Partial<CodexChronicleRecord> = {}): CodexChronicleRecord => ({
  kind: "entry",
  id: "j1",
  title: null,
  text: "The party reached Barovia.",
  gmText: null,
  revealedToPlayers: false,
  sessionId: null,
  sessionNumber: null,
  realDate: null,
  inWorldLabel: null,
  calendarInstant: null,
  inWorldDate: null,
  tags: ["dark-gift"],
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

// ----- Journal entries -----

/** Filing fields live in the Details panel, whose open state persists across mounts. */
const openEntryDetails = async (user: ReturnType<typeof userEvent.setup>) => {
  const details = await screen.findByRole("button", { name: "Details" });
  if (details.getAttribute("aria-expanded") !== "true") await user.click(details);
};

describe("Journal entry tags", () => {
  const renderJournal = async (records: CodexChronicleRecord[]) => {
    chronicle.mockResolvedValue(records);
    listPages.mockResolvedValue([]);
    getCalendar.mockResolvedValue(CALENDAR);
    render(
      <JournalView gmToken="gm" autosave={{ enabled: true, intervalSeconds: 1 }} pages={[]} onOpenPage={vi.fn()} />
    );
    await waitFor(() => expect(chronicle).toHaveBeenCalled());
  };

  it("shows an entry's stored tags on its card, without opening the editor", async () => {
    await renderJournal([RECORD({ tags: ["dark-gift", "session-3"] })]);
    const tags = await screen.findByRole("list", { name: "Entry tags" });
    expect(tags).toHaveTextContent("dark-gift");
    expect(tags).toHaveTextContent("session-3");
  });

  it("sends a tag typed in the composer with the new entry, slugified to the server's rule", async () => {
    await renderJournal([]);
    createEntry.mockResolvedValue(ENTRY());
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Player-visible notes"), "They crossed the mists.");
    await openEntryDetails(user);
    // The server would reject "Session Recap" as typed.
    await user.type(screen.getByLabelText("Tags"), "Session Recap{Enter}");
    await user.click(screen.getByRole("button", { name: "Add entry" }));

    await waitFor(() => expect(createEntry).toHaveBeenCalled());
    expect(createEntry.mock.calls[0][1]).toMatchObject({ tags: ["session-recap"] });
  });

  it("loads an existing entry's tags into the composer on Edit and saves them back", async () => {
    await renderJournal([RECORD({ tags: ["dark-gift"] })]);
    updateEntry.mockResolvedValue(ENTRY());
    const user = userEvent.setup();

    // Scoped to the entry row: the composer's editors also have Edit/Preview controls.
    const row = within(await screen.findByRole("article"));
    await user.click(row.getByRole("button", { name: "Edit" }));
    await openEntryDetails(user);
    expect(await screen.findByRole("list", { name: /chosen/i })).toHaveTextContent("dark-gift");

    await user.type(screen.getByLabelText("Tags"), "Ravenloft{Enter}");
    await user.click(screen.getByRole("button", { name: "Save entry" }));

    await waitFor(() => expect(updateEntry).toHaveBeenCalled());
    expect(updateEntry.mock.calls[0][2]).toMatchObject({ tags: ["dark-gift", "ravenloft"] });
  });
});

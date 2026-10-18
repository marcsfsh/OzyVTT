import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const getCalendar = vi.fn();
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
      updatePage: (...a: unknown[]) => updatePage(...a),
      markersForPage: (...a: unknown[]) => markersForPage(...a)
    },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    journalApi: {
      ...actual.journalApi,
      forPage: (...a: unknown[]) => forPage(...a)
    }
  };
});

import { PageEditor } from "./PageEditor";
import type { CodexCalendar, CodexPage } from "@vtt/domain";

/** An event page is the chronicle's record of a world event; it is dated in the page editor. */
const CALENDAR: CodexCalendar = {
  yearName: "DR",
  months: [
    { name: "Hammer", days: 30 },
    { name: "Alturiak", days: 30 }
  ],
  weekdays: []
};

/**
 * The editor autosaves the whole draft, so a page with no date control must omit `inWorldDate` (sending
 * `null` would erase an event's date once it was demoted and edited).
 */
describe("An event page is dated in the editor", () => {
  const PAGE: CodexPage = {
    id: "p9",
    title: "The Sundering",
    entityType: "event",
    fields: {},
    gmFields: {},
    folder: null,
    tags: [],
    revealedToPlayers: false,
    bannerAssetId: null,
    inWorldLabel: null,
    calendarInstant: null,
    inWorldDate: null,
    rev: 3,
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    playerUpdatedAt: "2026-07-28T00:00:00.000Z",
    firstShownAt: null,
    playerBody: "The sky tore open.",
    gmBody: ""
  };
  const renderEditor = (page: CodexPage) =>
    render(
      <PageEditor
        gmToken="gm"
        page={page}
        pages={[page]}
        connections={[]}
        autosave={{ enabled: true, intervalSeconds: 1 }}
        onChange={() => {}}
        onDeleted={() => {}}
        onNavigate={() => {}}
        onOpenConnection={vi.fn()}
        onConnectionsChanged={() => {}}
      />
    );

  beforeEach(() => {
    // These tests are about the Details panel's contents, so its remembered state is seeded open.
    localStorage.setItem("codex-page-details", "open");
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
    // The sort key and label are derived server-side; the client never sends them.
    expect(payload).not.toHaveProperty("calendarInstant");
    expect(payload).not.toHaveProperty("inWorldLabel");
  });

  it("says nothing about the date when the page is not an event", async () => {
    // A `location` page has no date control, so the save omits the key.
    const user = userEvent.setup();
    renderEditor({ ...PAGE, entityType: "location" });
    await user.type(await screen.findByLabelText("Page title"), "!");

    await waitFor(() => expect(updatePage).toHaveBeenCalled(), { timeout: 3000 });
    expect(updatePage.mock.calls.at(-1)![2]).not.toHaveProperty("inWorldDate");
  });
});

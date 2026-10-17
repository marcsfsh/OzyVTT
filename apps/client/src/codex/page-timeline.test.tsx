import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const forPage = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    journalApi: { ...actual.journalApi, forPage: (...a: unknown[]) => forPage(...a), create: vi.fn() }
  };
});

import { PageTimeline } from "./PageTimeline";
import type { CodexJournalEntry } from "@vtt/domain";

/**
 * The hidden-record cue keys on `revealedToPlayers` (empty player text doesn't decide it), and says "Hidden from
 * players" ("GM only" is the content pill's wording).
 */
const entry = (over: Partial<CodexJournalEntry>): CodexJournalEntry => ({
  id: "j1",
  playerText: "",
  gmText: null,
  revealedToPlayers: false,
  kind: "note",
  attachMarkerId: null,
  attachPageId: "p1",
  sourceEncounterId: null,
  payload: null,
  sessionId: null,
  sessionNumber: null,
  realDate: null,
  inWorldLabel: null,
  calendarInstant: null,
  inWorldDate: null,
  sortKey: 0,
  tags: [],
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  firstShownAt: null,
  ...over
});

const renderTimeline = async (entries: CodexJournalEntry[]) => {
  forPage.mockResolvedValue(entries);
  render(<PageTimeline gmToken="gm" pageId="p1" />);
  await waitFor(() => expect(forPage).toHaveBeenCalled());
};

describe("PageTimeline: the hidden-record cue (CD-5)", () => {
  beforeEach(() => forPage.mockReset());

  it("flags an unrevealed entry that HAS player text: the case the old check missed entirely", async () => {
    await renderTimeline([entry({ playerText: "The party reached Barovia.", revealedToPlayers: false })]);
    expect(await screen.findByText("Hidden from players")).toBeInTheDocument();
  });

  it("does not flag a revealed entry that happens to have no player text", async () => {
    // Revealed with no player text: not hidden.
    await renderTimeline([entry({ playerText: "", gmText: "note to self", revealedToPlayers: true })]);
    await waitFor(() => expect(screen.queryByText("Hidden from players")).not.toBeInTheDocument());
  });

  it("does not flag an ordinary revealed entry", async () => {
    await renderTimeline([entry({ playerText: "Strahd was sighted.", revealedToPlayers: true })]);
    await waitFor(() => expect(screen.queryByText("Hidden from players")).not.toBeInTheDocument());
  });
});

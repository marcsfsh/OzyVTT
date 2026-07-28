import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const forPage = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, journalApi: { ...actual.journalApi, forPage: (...a: unknown[]) => forPage(...a), create: vi.fn() } };
});

import { PageTimeline } from "./PageTimeline";
import type { CodexJournalEntry } from "./api";

/**
 * CD-5: the "GM only" cue derived secrecy from **empty player text** instead of `revealedToPlayers`.
 *
 * That got the ordinary case exactly backwards. A GM writes a player-facing summary and simply hasn't
 * revealed it yet — non-empty player text, not revealed — and the badge stayed *off*, which is the one
 * case where the GM most needs to see it. Meanwhile a revealed entry that happened to have no player
 * text was labelled "GM only" when players could in fact see it.
 */
const entry = (over: Partial<CodexJournalEntry>): CodexJournalEntry => ({
  id: "j1", playerText: "", gmText: null, revealedToPlayers: false, kind: "note",
  attachMarkerId: null, attachPageId: "p1", sourceEncounterId: null,
  sessionNumber: null, realDate: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  sortKey: 0, createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z", ...over
});

const renderTimeline = async (entries: CodexJournalEntry[]) => {
  forPage.mockResolvedValue(entries);
  render(<PageTimeline gmToken="gm" pageId="p1" />);
  await waitFor(() => expect(forPage).toHaveBeenCalled());
};

describe("PageTimeline — the GM-only cue (CD-5)", () => {
  beforeEach(() => forPage.mockReset());

  it("flags an unrevealed entry that HAS player text — the case the old check missed entirely", async () => {
    await renderTimeline([entry({ playerText: "The party reached Barovia.", revealedToPlayers: false })]);
    expect(await screen.findByText("GM only")).toBeInTheDocument();
  });

  it("does not flag a revealed entry that happens to have no player text", async () => {
    // The old check called this "GM only" even though players could see it.
    await renderTimeline([entry({ playerText: "", gmText: "note to self", revealedToPlayers: true })]);
    await waitFor(() => expect(screen.queryByText("GM only")).not.toBeInTheDocument());
  });

  it("does not flag an ordinary revealed entry", async () => {
    await renderTimeline([entry({ playerText: "Strahd was sighted.", revealedToPlayers: true })]);
    await waitFor(() => expect(screen.queryByText("GM only")).not.toBeInTheDocument());
  });
});

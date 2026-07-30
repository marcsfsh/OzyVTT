import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const chronicle = vi.fn();
const listPages = vi.fn();
const getCalendar = vi.fn();
const createEntry = vi.fn();
const createMilestone = vi.fn();
const createDeadline = vi.fn();
const createDowntime = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: { ...actual.codexApi, listPages: (...a: unknown[]) => listPages(...a) },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    journalApi: {
      ...actual.journalApi,
      chronicle: (...a: unknown[]) => chronicle(...a),
      create: (...a: unknown[]) => createEntry(...a),
      createMilestone: (...a: unknown[]) => createMilestone(...a),
      createDeadline: (...a: unknown[]) => createDeadline(...a),
      createDowntime: (...a: unknown[]) => createDowntime(...a)
    }
  };
});

import { JournalView } from "./JournalView";
import type { CodexChronicleRecord, CodexPageSummary, GmCodexCalendar } from "./api";

/**
 * M12 / CT-8 — milestones on the client.
 *
 * The composer writes FOUR shapes of one record now, and the thing that keeps that honest is that the
 * kind switch chooses a ROUTE: a milestone posted through `journalApi.create` would land as a `note` and
 * every row of it would render as an ordinary entry. So the route is asserted, not just the payload.
 *
 * `standing` is deliberately NOT in the switch and that is asserted too — a standing record must never
 * exist without the table change it describes, and the only thing that writes both is the standing card.
 */
const CALENDAR: GmCodexCalendar = {
  yearName: "DR", months: [{ name: "Hammer", days: 30 }, { name: "Alturiak", days: 30 }], weekdays: [],
  currentDate: { year: 1492, month: 0, day: 3 }, publishedDate: { year: 1492, month: 0, day: 3 }
};

const RECORD = (over: Partial<CodexChronicleRecord> = {}): CodexChronicleRecord => ({
  kind: "entry", id: "j1", title: null, text: "", gmText: null, revealedToPlayers: false,
  sessionNumber: null, realDate: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  tags: [], attachPageId: null, attachMarkerId: null, sourceEncounterId: null, payload: null,
  fired: false, proposedDate: null, createdAt: "2026-07-29T00:00:00.000Z", updatedAt: "2026-07-29T00:00:00.000Z", ...over
});

const FACTION: CodexPageSummary = {
  id: "f1", title: "The Zhentarim", entityType: "faction", fields: {}, folder: null, tags: [],
  revealedToPlayers: false, bannerAssetId: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  rev: 1, createdAt: "2026-07-29T00:00:00.000Z", updatedAt: "2026-07-29T00:00:00.000Z"
};

const renderJournal = async (records: CodexChronicleRecord[] = [], pages: CodexPageSummary[] = []) => {
  chronicle.mockResolvedValue(records);
  listPages.mockResolvedValue(pages);
  getCalendar.mockResolvedValue(CALENDAR);
  render(<JournalView gmToken="gm" onOpenPage={vi.fn()} />);
  await waitFor(() => expect(chronicle).toHaveBeenCalled());
};

const rowOf = (id: string) => document.getElementById(`codex-entry-${id}`)!;

// The composer draft persists in sessionStorage, so a test that types into it would otherwise decide
// what the next test's composer starts on.
beforeEach(() => sessionStorage.clear());

describe("The milestone is a FOURTH shape of the one composer (CT-8)", () => {
  it("offers Entry, Deadline, Downtime and Milestone — and never Standing", async () => {
    await renderJournal();
    const switcher = screen.getByRole("group", { name: "What to write" });
    expect(within(switcher).getAllByRole("button").map((option) => option.textContent))
      .toEqual(["Entry", "Deadline", "Downtime", "Milestone"]);
    // A standing record is written BY the standing card, as half of one transaction that also moves the
    // number. Offering it here would be a second way to write a record that must never stand alone.
    expect(within(switcher).queryByText("Standing")).not.toBeInTheDocument();
  });

  it("posts through the milestone route with { level, reason }, not through the ordinary entry route", async () => {
    await renderJournal();
    createMilestone.mockResolvedValue({});
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Milestone" }));
    await user.type(screen.getByLabelText("Level reached"), "5");
    await user.type(screen.getByLabelText("Why"), "Cleared the Sunless Citadel");
    await user.click(screen.getByRole("button", { name: "Record milestone" }));

    await waitFor(() => expect(createMilestone).toHaveBeenCalled());
    expect(createMilestone.mock.calls.at(-1)![1].milestone).toEqual({ level: 5, reason: "Cleared the Sunless Citadel" });
    // The route is the half that decides the KIND. Posted through `create` this would land as a `note`
    // and every row of it would read as an ordinary entry, silently.
    expect(createEntry).not.toHaveBeenCalled();
    expect(createDeadline).not.toHaveBeenCalled();
    expect(createDowntime).not.toHaveBeenCalled();
  });

  it("stands on its level alone — prose is optional colour, the level is the record", async () => {
    await renderJournal();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Milestone" }));

    expect(screen.getByRole("button", { name: "Record milestone" })).toBeDisabled();
    await user.type(screen.getByLabelText("Level reached"), "3");
    expect(screen.getByRole("button", { name: "Record milestone" })).toBeEnabled();
  });

  it("clamps the level to the 5e range rather than letting the server reject it", async () => {
    await renderJournal();
    createMilestone.mockResolvedValue({});
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Milestone" }));
    await user.type(screen.getByLabelText("Level reached"), "99");
    await user.click(screen.getByRole("button", { name: "Record milestone" }));

    await waitFor(() => expect(createMilestone).toHaveBeenCalled());
    expect(createMilestone.mock.calls.at(-1)![1].milestone.level).toBe(20);
  });

  it("needs no date — the store dates it at the campaign clock", async () => {
    // A deadline REQUIRES its date (one with no date can never fire). A milestone is a thing that
    // happened, so requiring one would be borrowing a rule from a record it is not.
    await renderJournal();
    createMilestone.mockResolvedValue({});
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Milestone" }));
    await user.type(screen.getByLabelText("Level reached"), "5");
    await user.click(screen.getByRole("button", { name: "Record milestone" }));

    await waitFor(() => expect(createMilestone).toHaveBeenCalled());
    expect(createMilestone.mock.calls.at(-1)![1].inWorldDate).toBeNull();
  });
});

describe("A milestone and a standing row read as themselves on the chronicle (R2)", () => {
  it("each says its kind in text and carries its own payload line", async () => {
    await renderJournal([
      RECORD({ kind: "milestone", id: "m1", text: "The company came back changed.", payload: { level: 5, reason: "Cleared the citadel" } }),
      RECORD({ kind: "standing", id: "s1", text: "", payload: { factionPageId: "f1", delta: -20, reason: "Burned the caravan" } })
    ], [FACTION]);

    // Colour lives entirely in CSS, so the proof is that the TEXT of each row distinguishes them.
    expect(rowOf("m1").textContent).toContain("Milestone");
    expect(rowOf("m1").textContent).toContain("Reached level 5 — Cleared the citadel");
    expect(rowOf("s1").textContent).toContain("Standing");
    // The faction is NAMED from the page list, and the delta is the change — never the new value.
    expect(rowOf("s1").textContent).toContain("The Zhentarim — down 20 · Burned the caravan");
    expect(rowOf("m1").querySelector(".codex-entry-kindglyph")).not.toBeNull();
    expect(rowOf("s1").querySelector(".codex-entry-kindglyph")).not.toBeNull();
  });

  it("never renders one kind's payload on the other's row", async () => {
    await renderJournal([
      RECORD({ kind: "entry", id: "e1", text: "An ordinary note.", payload: { level: 9, reason: "smuggled" } })
    ]);
    // The gate is the KIND, not the payload's shape: a note carrying a milestone-shaped payload says
    // nothing about a level, because nothing asked it to.
    expect(rowOf("e1").textContent).not.toContain("Reached level");
    expect(rowOf("e1").textContent).not.toContain("smuggled");
  });
});

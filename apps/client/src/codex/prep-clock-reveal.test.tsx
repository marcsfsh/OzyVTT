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
    codexApi: { ...actual.codexApi, listPages: (...a: unknown[]) => listPages(...a), revealPage: (...a: unknown[]) => revealPage(...a) },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a), publish: (...a: unknown[]) => publishCalendar(...a) },
    journalApi: { ...actual.journalApi, chronicle: (...a: unknown[]) => chronicle(...a), reveal: (...a: unknown[]) => revealEntry(...a) }
  };
});

import { JournalView } from "./JournalView";
import { revealAheadOfPlayers } from "./chronicle";
import type { CodexChronicleRecord, GmCodexCalendar } from "./api";

/**
 * O-1's prep clock, as the GM meets it — the two OWNER DECISIONS of 2026-07-30.
 *
 * **The warning.** M11 gave the GM a private clock and M11/M12 then wired three new record kinds to
 * auto-date at it (the way `appendCombatEntry` already did). Measured with the GM prepping 48 days ahead: a
 * revealed milestone carried `inWorldLabel: "Second, Alturiak 28, 1492 DR"` to a player whose own "now" was
 * Hammer 10 — a date they had never been shown. The owner kept the dating (it is genuinely when the thing
 * happened) and asked to be warned at the moment of reveal, with a switch to turn the warning off.
 *
 * **The acknowledgement.** Publishing was silent. The prep-clock row renders only WHILE the two clocks
 * disagree, so a successful publish made the row — and the only readout of what the table is on — vanish,
 * which reads exactly like a click that did nothing.
 *
 * What these tests are really defending, stated so a later reader does not soften it:
 *  - The warning must gate the *route*, not just paint a dialog. Every "warned" test asserts the reveal
 *    call did NOT happen; a warning you can click through by accident is worse than none.
 *  - The quiet cases are tested as hard as the loud one. "Always warn" would be the easy wrong answer that
 *    still passed a divergence test, and it is the answer that trains the GM to dismiss the dialog unread.
 *  - HIDING is never warned about. It discloses nothing, and a confirm on the way back to safety is the
 *    fastest way to make a GM stop hiding things.
 */
const CALENDAR: GmCodexCalendar = {
  yearName: "DR",
  months: [{ name: "Hammer", days: 30 }, { name: "Alturiak", days: 30 }],
  weekdays: [],
  // The GM is 48 days ahead of the table — the exact divergence the defect was measured at.
  currentDate: { year: 1492, month: 1, day: 28 },
  publishedDate: { year: 1492, month: 0, day: 10 }
};
/** Both clocks together: the state in which nothing is private, so nothing is worth warning about. */
const IN_SYNC: GmCodexCalendar = { ...CALENDAR, currentDate: { year: 1492, month: 0, day: 10 } };
/** Nothing published ever. There is no "what players have been shown" for a record to be ahead OF. */
const NEVER_PUBLISHED: GmCodexCalendar = { ...CALENDAR, publishedDate: null };

const RECORD = (over: Partial<CodexChronicleRecord> = {}): CodexChronicleRecord => ({
  kind: "entry", id: "j1", title: null, text: "The party crossed the mists.", gmText: null, revealedToPlayers: false,
  sessionId: null, sessionNumber: null, realDate: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  tags: [], attachPageId: null, attachMarkerId: null, sourceEncounterId: null, payload: null, fired: false, proposedDate: null,
  createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z", ...over
});

/** Dated at the GM's prep clock (Alturiak 28), 48 days past what the table is on. */
const AHEAD = RECORD({
  kind: "milestone", id: "m1", text: "The party reached 5.",
  payload: { level: 5, reason: "Barovia", applied: false },
  inWorldLabel: "Alturiak 28, 1492 DR", calendarInstant: 1492 * 60 + 57, inWorldDate: { year: 1492, month: 1, day: 28 }
});
/** Dated exactly at the published date — the party's own present, and therefore not a disclosure. */
const TODAY = RECORD({
  kind: "entry", id: "j2", text: "A quiet day in Vallaki.",
  inWorldLabel: "Hammer 10, 1492 DR", calendarInstant: 1492 * 60 + 9, inWorldDate: { year: 1492, month: 0, day: 10 }
});
/** No in-world date at all. Nothing to disclose. */
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

    // The two dates are the whole point: "ahead" is meaningless without saying ahead of WHAT.
    expect(await screen.findByText(/story has reached Alturiak 28, 1492 DR/)).toBeInTheDocument();
    expect(screen.getByText(/date is still Hammer 10, 1492 DR/)).toBeInTheDocument();
    // Nothing has been revealed yet. A dialog that paints AFTER the route fires is decoration.
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
    // The switch is driven by the record, which nothing here mutated — so it reads as the off state it is,
    // rather than showing a reveal that did not happen.
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

  /**
   * The two clocks agreeing is the ordinary state, and in it there is nothing private to leak — the GM's
   * "now" IS the table's. Warning here would fire on every reveal in every campaign that never runs ahead.
   */
  it("says nothing while the two clocks agree", async () => {
    await renderJournal([TODAY], IN_SYNC);
    const user = userEvent.setup();

    await user.click(switchIn("j2"));
    await waitFor(() => expect(revealEntry).toHaveBeenCalledWith("gm", "j2", true));
  });

  /**
   * Nothing published ever is deliberately NOT a warning. The leak is being ahead of what players have been
   * shown; with no published date there is nothing to be ahead of, and the first date they see is one the GM
   * typed on a record they chose to reveal.
   */
  it("says nothing when the clock has never been published", async () => {
    await renderJournal([AHEAD], NEVER_PUBLISHED);
    const user = userEvent.setup();

    await user.click(switchIn("m1"));
    await waitFor(() => expect(revealEntry).toHaveBeenCalledWith("gm", "m1", true));
  });

  /** Hiding discloses nothing. A confirm on the way back to safety would teach the GM to stop hiding things. */
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

    // The next reveal of an equally-ahead record goes straight through.
    await user.click(switchIn("m3"));
    await waitFor(() => expect(revealEntry).toHaveBeenCalledWith("gm", "m3", true));
    expect(screen.queryByText(/dated ahead/i)).not.toBeInTheDocument();
  });

  /**
   * Suppression rides on the AFFIRMATIVE button only. A GM who flicks the switch and then backs out has
   * abandoned the whole interaction, and silently disabling a warning on the way out of a dialog they
   * cancelled is how a safety net disappears without anyone deciding it should.
   */
  it("does not take the switch from a dialog the GM cancelled", async () => {
    await renderJournal([AHEAD, RECORD({ ...AHEAD, id: "m3", text: "The party reached 6." })]);
    const user = userEvent.setup();

    await user.click(switchIn("m1"));
    await user.click(await screen.findByRole("switch", { name: "Stop warning me about this" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    // Still armed: the next ahead-dated reveal is still stopped.
    await user.click(switchIn("m3"));
    expect(await screen.findByText(/story has reached Alturiak 28, 1492 DR/)).toBeInTheDocument();
    expect(revealEntry).not.toHaveBeenCalled();
  });

  /**
   * A flicked switch belongs to the request it was flicked on, and dies with it.
   *
   * The shared dialog keeps this state, so without a reset per request a switch flicked on a dialog the GM
   * backed out of arrives pre-flicked on the NEXT one — and the next "Show anyway" would disable the
   * warning without the GM asking for it in that interaction at all.
   */
  it("does not carry a flicked switch into the next dialog", async () => {
    await renderJournal([AHEAD, RECORD({ ...AHEAD, id: "m3", text: "The party reached 6." })]);
    const user = userEvent.setup();

    await user.click(switchIn("m1"));
    await user.click(await screen.findByRole("switch", { name: "Stop warning me about this" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(switchIn("m3"));
    expect(await screen.findByRole("switch", { name: "Stop warning me about this" })).toHaveAttribute("aria-checked", "false");
    await user.click(screen.getByRole("button", { name: "Show anyway" }));
    await waitFor(() => expect(revealEntry).toHaveBeenCalledWith("gm", "m3", true));

    // Nothing was suppressed, so the warning is still armed.
    await user.click(switchIn("m1"));
    expect(await screen.findByText(/story has reached Alturiak 28, 1492 DR/)).toBeInTheDocument();
  });

  /**
   * There is no settings screen in this app, so the way back has to be somewhere the GM will find it. It
   * lives on the prep-clock row — the only place both clocks are on screen, and one that renders exactly
   * when the warning would have mattered — and it is absent while the warning is still on.
   */
  it("offers a way back on, only once it has been turned off", async () => {
    await renderJournal([AHEAD]);
    const user = userEvent.setup();

    expect(screen.queryByRole("button", { name: "Warn me again before showing an entry" })).not.toBeInTheDocument();

    await user.click(switchIn("m1"));
    await user.click(await screen.findByRole("switch", { name: "Stop warning me about this" }));
    await user.click(screen.getByRole("button", { name: "Show anyway" }));

    await user.click(await screen.findByRole("button", { name: "Warn me again before showing an entry" }));
    expect(screen.queryByRole("button", { name: "Warn me again before showing an entry" })).not.toBeInTheDocument();

    // Re-armed without a reload.
    revealEntry.mockClear();
    await user.click(switchIn("m1"));
    expect(await screen.findByText(/story has reached Alturiak 28, 1492 DR/)).toBeInTheDocument();
    expect(revealEntry).not.toHaveBeenCalled();
  });
});

describe("Publishing the date says so (owner decision: it used to be silent)", () => {
  it("names the date the players now see", async () => {
    await renderJournal([UNDATED]);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Publish the date" }));
    await waitFor(() => expect(publishCalendar).toHaveBeenCalledWith("gm"));
    // The GM's clock was Alturiak 28, so that is what the table is on now. This survives the prep-clock row
    // disappearing, which is the half of the defect a transient flash would not have fixed.
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

/**
 * "GM only" used to mean two different things eighty pixels apart (fixed 2026-07-30).
 *
 * On one journal row the reveal switch's off state read "GM only" for the WHOLE ENTRY, and the violet pill
 * read "GM only" for ONE PARAGRAPH of it — the same three words answering two different questions on one
 * row. The record axis now says "Hidden from players", the exact antonym of the state it toggles out of;
 * the content pill keeps "GM only" and its violet, which R5 reserves for GM-only content.
 *
 * Asserted on the journal row because that is the surface where both appear at once — the collision itself,
 * not a proxy for it.
 */
describe("The record axis and the content axis no longer share a phrase", () => {
  it("says 'Hidden from players' for the record and 'GM only' for the GM paragraph, on one row", async () => {
    await renderJournal([RECORD({ id: "j4", text: "The party crossed the mists.", gmText: "Strahd was watching.", revealedToPlayers: false })]);
    const row = within(rowOf("j4"));

    expect(row.getByRole("switch")).toHaveAccessibleName("Show this entry to players");
    expect(row.getByText("Hidden from players")).toBeInTheDocument();
    // The content pill is still there, still saying what it has always said about the paragraph beside it.
    expect(row.getByText("GM only")).toBeInTheDocument();
    expect(row.getByText("Strahd was watching.")).toBeInTheDocument();
  });

  it("says 'Shown to players' once the record is revealed, and never 'GM only' about the record", async () => {
    await renderJournal([RECORD({ id: "j5", text: "The party crossed the mists.", gmText: null, revealedToPlayers: true })]);
    const row = within(rowOf("j5"));

    expect(row.getByText("Shown to players")).toBeInTheDocument();
    expect(row.queryByText("Hidden from players")).not.toBeInTheDocument();
    // No GM paragraph on this row, so the content pill has nothing to label and must not appear either.
    expect(row.queryByText("GM only")).not.toBeInTheDocument();
  });
});

describe("The reading rule itself", () => {
  it("is strictly ahead, and silent about everything it cannot honestly answer", () => {
    // Strictly after: the published day itself is the party's present, not a disclosure.
    expect(revealAheadOfPlayers({ calendarInstant: 1492 * 60 + 10 }, CALENDAR)).toBe(true);
    expect(revealAheadOfPlayers({ calendarInstant: 1492 * 60 + 9 }, CALENDAR)).toBe(false);
    expect(revealAheadOfPlayers({ calendarInstant: 1492 * 60 + 8 }, CALENDAR)).toBe(false);
    // Nothing to compare against, or nothing to compare.
    expect(revealAheadOfPlayers({ calendarInstant: 1492 * 60 + 57 }, NEVER_PUBLISHED)).toBe(false);
    expect(revealAheadOfPlayers({ calendarInstant: null }, CALENDAR)).toBe(false);
    expect(revealAheadOfPlayers({ calendarInstant: 1492 * 60 + 57 }, null)).toBe(false);
    // Falsy-safe rather than merely null-safe: a caller holding a narrower calendar shape gives `undefined`
    // here, and `=== null` let that through into the date maths, which threw inside the click handler.
    expect(revealAheadOfPlayers({ calendarInstant: 1492 * 60 + 57 }, { ...CALENDAR, publishedDate: undefined as unknown as null })).toBe(false);
  });
});

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
      listRelationships: (...a: unknown[]) => playerListRelationships(...a),
      listLinks: (...a: unknown[]) => playerListLinks(...a),
      calendar: (...a: unknown[]) => playerCalendar(...a)
    }
  };
});

import { JournalView } from "./JournalView";
import { PlayerCodex } from "./PlayerCodex";
import { CampaignHome } from "./CampaignHome";
import { CHRONICLE_KIND_META, campaignDeadlines, deadlineFired, downtimeProposedDate, downtimeSummaryLabel } from "./chronicle";
import { CODEX_ICONS } from "./icons";
import type { CodexChronicleRecord, GmCodexCalendar, PlayerCodexChronicleRecord } from "./api";

/**
 * M11 — deadlines (CT-5) and downtime (CT-10) on the client, plus O-1's prep clock.
 *
 * What each group here is actually for, stated so a later reader does not soften it:
 *  - **R2** — a record's kind reads by icon AND word. The colour assertion is the accessibility rule and
 *    the one a "tidy-up" would break by dropping a badge as redundant. The icon-registry test is its
 *    quiet half: `iconChildren` falls back to `pin` for an unknown id, so a typo in `CHRONICLE_KIND_META`
 *    would not throw — every deadline in the campaign would simply draw a map pin.
 *  - **O-3** — creating downtime PROPOSES; a separate, explicit action applies it. Two assertions carry
 *    that: the create path must not touch the clock, and the confirm must state its effect before it.
 *  - **O-1** — the GM's clock and the players' clock are two values. The quiet case (they agree → nothing
 *    on screen) is tested as hard as the loud one, because "always visible" would be the easy wrong
 *    answer that still passed a divergence test.
 *  - **Viewer safety** — the player surface must read the PLAYER calendar route. Asserting that the GM
 *    route was never called is the only version of this a client test can honestly prove: what the two
 *    routes return is the server's business, but which one this surface asks is entirely ours.
 */
const CALENDAR: GmCodexCalendar = {
  yearName: "DR",
  months: [{ name: "Hammer", days: 30 }, { name: "Alturiak", days: 30 }],
  weekdays: [],
  currentDate: { year: 1492, month: 0, day: 3 },
  publishedDate: { year: 1492, month: 0, day: 3 }
};

const RECORD = (over: Partial<CodexChronicleRecord> = {}): CodexChronicleRecord => ({
  kind: "entry", id: "j1", title: null, text: "The party crossed the mists.", gmText: null, revealedToPlayers: false,
  sessionNumber: null, realDate: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  tags: [], attachPageId: null, attachMarkerId: null, sourceEncounterId: null, payload: null, fired: false, proposedDate: null,
  createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z", ...over
});

const DEADLINE = RECORD({
  kind: "deadline", id: "d1", text: "The duke's ultimatum expires.",
  inWorldLabel: "Hammer 10, 1492 DR", calendarInstant: 1492 * 60 + 9, inWorldDate: { year: 1492, month: 0, day: 10 }
});
const DOWNTIME = RECORD({
  kind: "downtime", id: "w1", text: "A quiet tenday in Daggerford.",
  payload: { who: "Aldric", activity: "Forging a blade", days: 7, applied: false },
  // The server's answer for where the clock lands. Hammer 3 + 7 = Hammer 10 — the same date local
  // arithmetic would reach, so the ordinary tests below read naturally; the test that proves WHICH of
  // the two the row is showing deliberately makes them disagree.
  proposedDate: { year: 1492, month: 0, day: 10 },
  inWorldLabel: "Hammer 3, 1492 DR", calendarInstant: 1492 * 60 + 2, inWorldDate: { year: 1492, month: 0, day: 3 }
});

const renderJournal = async (records: CodexChronicleRecord[], calendar: GmCodexCalendar = CALENDAR) => {
  chronicle.mockResolvedValue(records);
  listPages.mockResolvedValue([]);
  getCalendar.mockResolvedValue(calendar);
  render(<JournalView gmToken="gm" onOpenPage={vi.fn()} />);
  await waitFor(() => expect(chronicle).toHaveBeenCalled());
};

const rowOf = (id: string) => document.getElementById(`codex-entry-${id}`)!;
const playerRowOf = (id: string) => document.getElementById(`codex-player-entry-${id}`)!;

beforeEach(() => sessionStorage.clear());

describe("A new kind reads by icon AND word (R2)", () => {
  it("every chronicle kind names an icon the registry actually has", () => {
    // `iconChildren` falls back to `pin` rather than throwing, so an invented id is silent at runtime:
    // every deadline row in the campaign would draw a map pin and nothing would ever say so.
    for (const [kind, meta] of Object.entries(CHRONICLE_KIND_META)) {
      expect(CODEX_ICONS[meta.iconId], `${kind} names an icon that does not exist: ${meta.iconId}`).toBeDefined();
      expect(meta.label.trim()).not.toBe("");
    }
    // And the labels are distinct — two kinds sharing a word would leave colour as the only difference.
    const labels = Object.values(CHRONICLE_KIND_META).map((meta) => meta.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("a deadline and a downtime row each say their kind in text, with no colour at all", async () => {
    await renderJournal([DEADLINE, DOWNTIME]);
    // Colour lives entirely in CSS classes, so the proof is that the TEXT of each row distinguishes the
    // kinds: strip every stylesheet and a reader still knows which row is which.
    expect(rowOf("d1").textContent).toContain("Deadline");
    expect(rowOf("w1").textContent).toContain("Downtime");
    expect(rowOf("d1").querySelector(".codex-entry-kindglyph")).not.toBeNull();
    expect(rowOf("w1").querySelector(".codex-entry-kindglyph")).not.toBeNull();
  });
});

describe("A deadline's state is the SERVER's, and it reads as a word (CT-5)", () => {
  it("says Approaching before the campaign passes it and Passed after", async () => {
    await renderJournal([DEADLINE, { ...DEADLINE, id: "d2", fired: true, text: "The comet fell." }]);

    expect(within(rowOf("d1")).getByText("Approaching")).toBeInTheDocument();
    expect(within(rowOf("d2")).getByText("Passed")).toBeInTheDocument();
    expect(within(rowOf("d1")).queryByText("Passed")).not.toBeInTheDocument();
  });

  it("says nothing about firing on a record that is not a deadline", async () => {
    // `fired` is derived against the clock for whatever the server hands over; the kind gate is what
    // stops an ordinary note that happens to carry the flag from announcing a state it does not have.
    await renderJournal([RECORD({ id: "j9", fired: true })]);
    expect(rowOf("j9").textContent).not.toContain("Passed");
    expect(rowOf("j9").textContent).not.toContain("Approaching");
  });
});

describe("Downtime proposes; the GM confirms (O-3)", () => {
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
    expect(createDowntime.mock.calls.at(-1)![1].downtime).toEqual({ who: "Aldric", activity: "Forging a blade", days: 7 });
    // The whole of O-3 in three lines: nothing here moved the campaign date.
    expect(applyDowntime).not.toHaveBeenCalled();
    expect(setCalendar).not.toHaveBeenCalled();
    expect(publishCalendar).not.toHaveBeenCalled();
  });

  it("states what confirming will do BEFORE the button that does it", async () => {
    await renderJournal([DOWNTIME]);
    applyDowntime.mockResolvedValue({ entry: {}, calendar: CALENDAR });
    const user = userEvent.setup();
    const row = within(rowOf("w1"));

    // Hammer 3 + 7 days = Hammer 10. The sentence is the affordance; the button only agrees with it.
    expect(row.getByText("Advance the campaign clock to Hammer 10, 1492 DR")).toBeInTheDocument();
    expect(row.getByText("Aldric — Forging a blade · 7 days")).toBeInTheDocument();

    await user.click(row.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(applyDowntime).toHaveBeenCalledWith("gm", "w1"));
  });

  /**
   * OWNER DECISION (2026-07-30): the confirm names what the clock move would COST, not only where it lands.
   *
   * Measured before this existed: a 7-day confirm moved the clock 16→23 and flipped two deadlines to
   * "Passed" with no notice anywhere — the GM found out by going back to the dashboard. A deadline exists
   * precisely because it happens whether or not the party acts, which makes the instant the clock jumps
   * over it the instant the GM most needs to know.
   *
   * The fixture is built so a wrong implementation gives a wrong NUMBER rather than merely a wrong row:
   * counting everything gives 4, ignoring `fired` gives 3, comparing `<` instead of `<=` gives 1.
   */
  it("says how many deadlines confirming would pass", async () => {
    await renderJournal([
      DOWNTIME,                                                                     // proposes Hammer 10
      DEADLINE,                                                                     // Hammer 10 — exactly the landing day, counts
      RECORD({ kind: "deadline", id: "d2", text: "The caravan leaves.", fired: false,
        inWorldLabel: "Hammer 5, 1492 DR", calendarInstant: 1492 * 60 + 4, inWorldDate: { year: 1492, month: 0, day: 5 } }),
      RECORD({ kind: "deadline", id: "d3", text: "The tax was due.", fired: true,    // already passed — not caused by this
        inWorldLabel: "Hammer 2, 1492 DR", calendarInstant: 1492 * 60 + 1, inWorldDate: { year: 1492, month: 0, day: 2 } }),
      RECORD({ kind: "deadline", id: "d4", text: "Midwinter.", fired: false,         // beyond the landing day
        inWorldLabel: "Alturiak 20, 1492 DR", calendarInstant: 1492 * 60 + 49, inWorldDate: { year: 1492, month: 1, day: 20 } })
    ]);
    const row = within(rowOf("w1"));

    expect(row.getByText("Advance the campaign clock to Hammer 10, 1492 DR — this passes 2 deadlines.")).toBeInTheDocument();
  });

  /** One is "1 deadline", not "1 deadlines" — the sentence is read mid-session, at speed. */
  it("counts one deadline in the singular", async () => {
    await renderJournal([DOWNTIME, DEADLINE]);
    expect(within(rowOf("w1")).getByText("Advance the campaign clock to Hammer 10, 1492 DR — this passes 1 deadline.")).toBeInTheDocument();
  });

  /**
   * Zero says NOTHING, rather than "this passes 0 deadlines".
   *
   * The clause is a warning. A campaign with no deadlines would otherwise carry it on every downtime it ever
   * logs, and a warning that is always present is one the GM stops reading — which costs the real case the
   * only notice it gets.
   */
  it("adds no clause when the move passes nothing", async () => {
    await renderJournal([DOWNTIME, RECORD({ kind: "deadline", id: "d5", text: "Midwinter.", fired: false,
      inWorldLabel: "Alturiak 20, 1492 DR", calendarInstant: 1492 * 60 + 49, inWorldDate: { year: 1492, month: 1, day: 20 } })]);
    const row = within(rowOf("w1"));

    expect(row.getByText("Advance the campaign clock to Hammer 10, 1492 DR")).toBeInTheDocument();
    expect(row.queryByText(/deadline/)).not.toBeInTheDocument();
  });

  /**
   * The Confirm sentence names the SERVER's date, not a second local computation of it.
   *
   * The client can do this arithmetic and for the composer's live preview it must — no record exists yet
   * to ask about. But once a row exists the server decides where its own clock lands, and Confirm promises
   * that date out loud. Two implementations of one answer is the shape this overhaul exists to remove.
   *
   * Proved by making them DISAGREE: local arithmetic on Hammer 3 + 7 days reaches Hammer 10, so a row
   * whose server-supplied date is Alturiak 12 can only render that if it is reading the server's value.
   */
  it("names the SERVER's proposed date, not a locally recomputed one", async () => {
    await renderJournal([RECORD({ ...DOWNTIME, id: "w3", proposedDate: { year: 1492, month: 1, day: 12 } })]);
    const row = within(rowOf("w3"));

    expect(row.getByText("Advance the campaign clock to Alturiak 12, 1492 DR")).toBeInTheDocument();
    expect(row.queryByText(/Hammer 10/)).not.toBeInTheDocument();
  });

  /** A row the server gave no proposed date offers no promise — and therefore no Confirm to break it. */
  it("promises nothing when the server proposed no date", async () => {
    await renderJournal([RECORD({ ...DOWNTIME, id: "w4", proposedDate: null })]);
    const row = within(rowOf("w4"));

    expect(row.queryByText(/Advance the campaign clock/)).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });

  /**
   * A deadline's date cannot be edited away — the composer will not arm, and it says why.
   *
   * The create path guarded this from the start; the EDIT path did not, and it is the door a GM uses more
   * often. Clearing the Year field on an existing deadline produced a row reading "Deadline · Approaching"
   * forever that could never fire, on the GM journal, the dashboard card and every player's timeline.
   * The store refuses it too; this is the affordance, so the GM never meets that refusal.
   */
  it("will not let an edit take a deadline's date away", async () => {
    await renderJournal([DEADLINE, RECORD()]);   // a deadline and an ordinary entry, so the contrast is real
    const user = userEvent.setup();
    await user.click(within(rowOf(DEADLINE.id)).getByRole("button", { name: "Edit" }));

    const save = screen.getByRole("button", { name: "Save entry" });
    expect(save).not.toBeDisabled();                                  // as loaded, the date is there

    await user.clear(screen.getByLabelText("Year"));
    expect(save).toBeDisabled();
    expect(screen.getByText(/A deadline needs a date/)).toBeInTheDocument();
    expect(updateEntry).not.toHaveBeenCalled();

    // Editing an ORDINARY entry is unaffected — only a deadline's date is load-bearing.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(within(rowOf("j1")).getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Year"));
    expect(screen.getByRole("button", { name: "Save entry" })).not.toBeDisabled();
  });

  it("offers no second confirmation once the clock has already been advanced", async () => {
    await renderJournal([RECORD({ ...DOWNTIME, id: "w2", payload: { who: "Aldric", activity: "Forging a blade", days: 7, applied: true } })]);
    const row = within(rowOf("w2"));

    expect(row.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(row.queryByText(/Advance the campaign clock/)).not.toBeInTheDocument();
    // It still says what it was, and that it has been applied — an applied downtime is not a silent row.
    expect(row.getByText("Aldric — Forging a blade · 7 days")).toBeInTheDocument();
    expect(row.getByText(/already been advanced/)).toBeInTheDocument();
  });
});

describe("A deadline cannot be written without a date (CT-5)", () => {
  it("will not arm until the date is there, then sends the raw date the GM typed", async () => {
    await renderJournal([]);
    createDeadline.mockResolvedValue({});
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Deadline" }));
    await user.type(screen.getByLabelText("What will happen"), "The duke's ultimatum expires.");
    // Text alone is not enough: a deadline with no date could never fire, and the store rejects it.
    expect(screen.getByRole("button", { name: "Add deadline" })).toBeDisabled();
    expect(screen.getByText(/A deadline needs a date/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Year"), "1492");
    await user.type(screen.getByLabelText("Day"), "10");
    await user.click(screen.getByRole("button", { name: "Add deadline" }));

    await waitFor(() => expect(createDeadline).toHaveBeenCalled());
    const payload = createDeadline.mock.calls.at(-1)![1];
    expect(payload.inWorldDate).toEqual({ year: 1492, month: 0, day: 10 });
    expect(payload.playerText).toBe("The duke's ultimatum expires.");
    // A deadline stores no payload of its own — what will happen IS this text (D11-C).
    expect(payload).not.toHaveProperty("downtime");
    expect(createEntry).not.toHaveBeenCalled();
  });
});

describe("The prep clock is quiet until it matters (O-1)", () => {
  it("says nothing at all while the GM's clock and the players' clock agree", async () => {
    await renderJournal([]);
    // The normal state is the matching state; a permanent "in sync" readout would make every GM who has
    // never prepped ahead learn a second clock exists for no reason.
    expect(screen.queryByRole("button", { name: "Publish the date" })).not.toBeInTheDocument();
    expect(screen.queryByText("Players still see")).not.toBeInTheDocument();
    // The GM's own clock still reads, exactly as it did before M11.
    expect(screen.getByText("Now: Hammer 3, 1492 DR")).toBeInTheDocument();
  });

  it("shows what the table is on, and publishes, once the two diverge", async () => {
    await renderJournal([], { ...CALENDAR, currentDate: { year: 1492, month: 0, day: 20 }, publishedDate: { year: 1492, month: 0, day: 3 } });
    publishCalendar.mockResolvedValue(CALENDAR);
    const user = userEvent.setup();

    expect(screen.getByText("Players still see")).toBeInTheDocument();
    // BOTH dates on screen at once, and they are different values — the GM's ahead, the table's behind.
    expect(screen.getByText("Now: Hammer 20, 1492 DR")).toBeInTheDocument();
    expect(screen.getByText("Hammer 3, 1492 DR")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Publish the date" }));
    await waitFor(() => expect(publishCalendar).toHaveBeenCalledWith("gm"));
    // Publishing is its own action: it must never be reachable as a side effect of writing the calendar.
    expect(setCalendar).not.toHaveBeenCalled();
  });
});

describe("The player's chronicle (O-2) and the player's clock (O-1)", () => {
  const PLAYER_RECORD = (over: Partial<PlayerCodexChronicleRecord> = {}): PlayerCodexChronicleRecord => ({
    kind: "entry", id: "j1", title: null, text: "The party crossed the mists.", sessionNumber: null,
    realDate: null, inWorldLabel: null, tags: [], payload: null, fired: false,
    createdAt: "2026-07-20T00:00:00.000Z", ...over
  });

  const renderPlayer = async (records: PlayerCodexChronicleRecord[]) => {
    playerListPages.mockResolvedValue([]);
    playerListMaps.mockResolvedValue([]);
    playerListMarkers.mockResolvedValue([]);
    playerChronicle.mockResolvedValue(records);
    playerListRelationships.mockResolvedValue([]);
    playerListLinks.mockResolvedValue([]);
    // The PLAYER's projection: `currentDate` is the published date, and there is no `publishedDate` key
    // and no GM clock on this shape at all.
    playerCalendar.mockResolvedValue({ yearName: "DR", months: CALENDAR.months, weekdays: [], currentDate: { year: 1492, month: 0, day: 3 } });
    render(<PlayerCodex token="player" />);
    await waitFor(() => expect(playerChronicle).toHaveBeenCalled());
  };

  it("reads a revealed deadline and a revealed downtime with their icon and their word", async () => {
    const user = userEvent.setup();
    await renderPlayer([
      PLAYER_RECORD({ kind: "deadline", id: "d1", text: "The duke's ultimatum expires.", inWorldLabel: "Hammer 10, 1492 DR", fired: true }),
      PLAYER_RECORD({ kind: "downtime", id: "w1", text: "A quiet tenday.", payload: { who: "Aldric", activity: "Forging a blade", days: 7 } })
    ]);
    await user.click(screen.getByRole("tab", { name: "Journal" }));

    expect(playerRowOf("d1").textContent).toContain("Deadline");
    expect(playerRowOf("d1").querySelector(".codex-entry-kindglyph")).not.toBeNull();
    // A revealed deadline the campaign has passed reads as passed.
    expect(within(playerRowOf("d1")).getByText("Passed")).toBeInTheDocument();
    expect(playerRowOf("w1").textContent).toContain("Downtime");
    expect(within(playerRowOf("w1")).getByText("Aldric — Forging a blade · 7 days")).toBeInTheDocument();
  });

  it("never asks the GM calendar route, and never offers a Confirm", async () => {
    await renderPlayer([PLAYER_RECORD({ kind: "downtime", id: "w1", text: "A quiet tenday.", payload: { who: "Aldric", activity: "Forging a blade", days: 7 } })]);

    // The one half of the prep clock a client test can honestly prove: which route this surface asks.
    // `calendarApi.get` is the GM read and its answer carries the GM's own clock beside `publishedDate`.
    expect(playerCalendar).toHaveBeenCalledWith("player");
    expect(getCalendar).not.toHaveBeenCalled();
    // The date a player sees is the one the player projection sent.
    expect(await screen.findByText("Now: Hammer 3, 1492 DR")).toBeInTheDocument();
    // Applying downtime is a GM action against the GM's clock; neither the control nor the state that
    // drives it exists here — `applied` is not even a field on the player payload.
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Advance the campaign clock/)).not.toBeInTheDocument();
  });
});

describe("The Campaign dashboard's deadlines card (CT-5)", () => {
  const CARDS = [
    { id: "d2", summary: "The comet fell.", when: "Hammer 1, 1492 DR", fired: true },
    { id: "d1", summary: "The duke's ultimatum expires.", when: "Hammer 10, 1492 DR", fired: false }
  ];

  it("lists what has passed and what is coming, each saying which, and opens the record", async () => {
    const onOpenEntry = vi.fn();
    const user = userEvent.setup();
    render(<CampaignHome pages={[]} deadlines={CARDS} onOpenEntry={onOpenEntry}
      onPickType={vi.fn()} onPickTag={vi.fn()} onOpenPage={vi.fn()} onOpenMap={vi.fn()} />);

    const card = within(screen.getByRole("navigation", { name: "Deadlines" }));
    const rows = card.getAllByRole("button").map((row) => row.textContent ?? "");
    // Passed first: unlike a completed quest, nobody marked this done — the clock did, and it is the one
    // thing on this card that needs the GM's attention now.
    expect(rows[0]).toContain("The comet fell.");
    expect(rows[0]).toContain("Passed");
    expect(rows[1]).toContain("The duke's ultimatum expires.");
    expect(rows[1]).toContain("Approaching");

    await user.click(card.getByText("The duke's ultimatum expires."));
    expect(onOpenEntry).toHaveBeenCalledWith("d1");
  });

  it("renders no card at all when there are no deadlines", () => {
    render(<CampaignHome pages={[{ id: "p1", title: "Strahd", entityType: "character", tags: [], updatedAt: "2026-07-28T00:00:00.000Z" }]}
      onOpenEntry={vi.fn()} onPickType={vi.fn()} onPickTag={vi.fn()} onOpenPage={vi.fn()} onOpenMap={vi.fn()} />);
    expect(screen.queryByRole("navigation", { name: "Deadlines" })).not.toBeInTheDocument();
  });
});

/**
 * P6 / §4. jsdom loads no stylesheet, so this cannot MEASURE 44px — only a browser can, and
 * `scripts/tap-audit.mjs` is where that number comes from. What it can prove is the thing a later edit
 * would actually get wrong: **which route each new control takes.**
 *
 * §4 forbids route 2 (`.tap-target::after`) for a control in a vertical stack, because overlapping
 * invisible boxes steal their neighbours' taps — and both new controls here sit in one. `Button` at its
 * default size is route 1 (`.nh-btn`, `min-height: var(--tap-min)`, no `::after`); `Button size="sm"` is
 * route 2 (`.nh-btn--sm`, 32px paint + a 44px `::after` overhanging 6px per side). The Confirm sits
 * directly above `.codex-entry-foot`, which is a row of route-2 small buttons; the Publish sits directly
 * above the composer's field stack. Changing either to `size="sm"` is a one-word edit that looks tidier
 * and would quietly break both — so it fails here.
 */
describe("The new controls take the tap route §4 requires of a stacked control (P6)", () => {
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

    // The downtime fields are `@vtt/ui` inputs, which carry the floor themselves (`.nh-input`).
    await userEvent.setup().click(screen.getByRole("button", { name: "Downtime" }));
    for (const label of ["Who", "Activity", "Days"]) expect(screen.getByLabelText(label)).toHaveClass("nh-input");
  });

  it("a deadline card row is the dashboard's own row chassis, not a new control", () => {
    render(<CampaignHome pages={[]} deadlines={[{ id: "d1", summary: "The duke's ultimatum expires.", when: "Hammer 10, 1492 DR", fired: false }]}
      onOpenEntry={vi.fn()} onPickType={vi.fn()} onPickTag={vi.fn()} onOpenPage={vi.fn()} onOpenMap={vi.fn()} />);
    // `.codex-campaign-recentitem` is §4 route 1 and is where every list on this surface gets its floor;
    // a bespoke class here would be a new control with a new floor to argue about (R2 and §4 both).
    expect(within(screen.getByRole("navigation", { name: "Deadlines" })).getByRole("button"))
      .toHaveClass("codex-campaign-recentitem");
  });
});

describe("The shared reading rules themselves", () => {
  it("only a deadline can be fired, and an absent flag reads as not fired", () => {
    // The helper's own gate, below the components. Both halves are load-bearing: the kind check is what
    // stops "has this passed" from being asked of a record that has no such question, and the `=== true`
    // is what makes a row that arrives WITHOUT the key read as not-fired rather than as `undefined` —
    // which is exactly what an older server, or a fixture written before M11, would send.
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
    const calendar = { yearName: "DR", months: [{ name: "Hammer", days: 30 }, { name: "Alturiak", days: 30 }], weekdays: [] };
    // Within a month.
    expect(downtimeProposedDate({ ...calendar, currentDate: { year: 1492, month: 0, day: 3 } }, 7)).toEqual({ year: 1492, month: 0, day: 10 });
    // Off the end of a month: rolls into the next one rather than stopping at 30.
    expect(downtimeProposedDate({ ...calendar, currentDate: { year: 1492, month: 0, day: 28 } }, 5)).toEqual({ year: 1492, month: 1, day: 3 });
    // Off the end of a year: rolls the year.
    expect(downtimeProposedDate({ ...calendar, currentDate: { year: 1492, month: 1, day: 28 } }, 5)).toEqual({ year: 1493, month: 0, day: 3 });
    // The one lossy date the calendar admits (F-4): a stored day 31 of a 30-day month computes as day 30
    // on the SERVER, so advancing from it must land on Hammer 31 + 0... which is Alturiak 1, not day 31.
    expect(downtimeProposedDate({ ...calendar, currentDate: { year: 1492, month: 0, day: 31 } }, 1)).toEqual({ year: 1492, month: 1, day: 1 });
    // Nothing to advance from is not a date.
    expect(downtimeProposedDate({ ...calendar, currentDate: null }, 7)).toBeNull();
    expect(downtimeProposedDate(null, 7)).toBeNull();
  });

  it("says a downtime in one line without inventing punctuation for the halves it was not given", () => {
    expect(downtimeSummaryLabel({ who: "Aldric", activity: "Forging a blade", days: 7 })).toBe("Aldric — Forging a blade · 7 days");
    expect(downtimeSummaryLabel({ who: "", activity: "Carousing", days: 1 })).toBe("Carousing · 1 day");
    expect(downtimeSummaryLabel({ who: "", activity: "", days: 0 })).toBe("0 days");
  });
});

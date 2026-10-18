import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const api = vi.hoisted(() => ({
  publish: vi.fn(),
  unpublish: vi.fn(),
  setCalendar: vi.fn(),
  create: vi.fn(),
  createDeadline: vi.fn(),
  createDowntime: vi.fn(),
  createMilestone: vi.fn(),
  applyDowntime: vi.fn(),
  update: vi.fn(),
  reveal: vi.fn(),
  remove: vi.fn(),
  revealPage: vi.fn()
}));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    calendarApi: { ...actual.calendarApi, publish: api.publish, unpublish: api.unpublish, set: api.setCalendar },
    codexApi: { ...actual.codexApi, revealPage: api.revealPage },
    journalApi: {
      ...actual.journalApi,
      create: api.create,
      createDeadline: api.createDeadline,
      createDowntime: api.createDowntime,
      createMilestone: api.createMilestone,
      applyDowntime: api.applyDowntime,
      update: api.update,
      reveal: api.reveal,
      remove: api.remove
    }
  };
});

import type { CodexChronicleRecord, CodexPageSummary, CodexQuest, CodexSession, GmCodexCalendar } from "@vtt/domain";
import { revealAheadOfPlayers } from "../chronicle";
import { GmStorySection } from "./sections";
import { gmRecord, renderGmStory, type GmStoryFeeds } from "./harness";

/**
 * The GM's chronicle: the session spine, the calendar side with both dates, the clocks and downtime, and the one
 * composer. Records are placed by the server's `calendarInstant` and dated by its labels, never by client maths.
 */

/** Two 30-day months; Hammer 1 of 1492 is instant 1492 x 60. */
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
const HAMMER = (day: number) => 1492 * 60 + day - 1;

const DEADLINE = gmRecord({
  kind: "deadline",
  id: "d1",
  title: "The duke's ultimatum",
  text: "The duke's ultimatum expires.",
  inWorldLabel: "Hammer 10, 1492 DR",
  calendarInstant: HAMMER(10),
  inWorldDate: { year: 1492, month: 0, day: 10 }
});
const DOWNTIME = gmRecord({
  kind: "downtime",
  id: "w1",
  text: "A quiet tenday in Daggerford.",
  payload: { who: "Aldric", activity: "Forging a blade", days: 7, characterPageId: null, applied: false },
  // The server's landing date (Hammer 3 + 7). One test makes it disagree with local arithmetic on purpose.
  proposedDate: { year: 1492, month: 0, day: 10 },
  inWorldLabel: "Hammer 3, 1492 DR",
  calendarInstant: HAMMER(3),
  inWorldDate: { year: 1492, month: 0, day: 3 }
});

const session = (id: string, sessionNumber: number, over: Partial<CodexSession> = {}): CodexSession =>
  ({
    id,
    sessionNumber,
    realDate: null,
    attendees: [],
    recapBody: "",
    status: "played",
    tags: [],
    revealedToPlayers: true,
    rev: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...over
  }) as CodexSession;

const page = (id: string, title: string, entityType: CodexPageSummary["entityType"] = "character") =>
  ({
    id,
    title,
    entityType,
    fields: {},
    folder: null,
    tags: [],
    revealedToPlayers: true,
    bannerAssetId: null,
    inWorldDate: null,
    inWorldLabel: null,
    calendarInstant: null,
    rev: 1,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    playerUpdatedAt: "2026-07-31T00:00:00.000Z",
    characterUpdatedAt: {},
    hiddenFields: [],
    firstShownAt: null
  }) as CodexPageSummary;

const renderStory = (records: readonly CodexChronicleRecord[], over: GmStoryFeeds = {}) =>
  renderGmStory(GmStorySection, over.phone ? "/codex/story?zoom=month" : "/codex/story", {
    records,
    calendar: CALENDAR,
    ...over
  });

const spine = () => within(screen.getByRole("list", { name: "Sessions and what happened" }));
const clocks = () => within(screen.getByRole("region", { name: "Clocks" }));
const cardOf = (id: string) => within(document.getElementById(`codex-entry-${id}`)!);
/** Opens a record's row on the spine and returns its full card. */
const openRow = async (user: ReturnType<typeof userEvent.setup>, id: string) => {
  await user.click(document.getElementById(`story-row-${id}`)!);
  return cardOf(id);
};
const openComposer = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Add to the chronicle" }));
  return within(await screen.findByRole("dialog", { name: "Add to the chronicle" }));
};

beforeEach(() => {
  localStorage.clear();
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({});
});

describe("The session spine", () => {
  it("lists sessions newest first, each with its recap and what was filed under it, then what no session holds", () => {
    renderStory(
      [
        gmRecord({ id: "a", text: "We met Ireena.", sessionId: "s1", sessionNumber: 1 }),
        gmRecord({ id: "b", text: "The church burned.", sessionId: "s2", sessionNumber: 2 }),
        gmRecord({ id: "c", text: "A rumour, filed nowhere." })
      ],
      {
        sessions: [
          session("s1", 1, { recapBody: "The party reached Barovia." }),
          session("s2", 2, { recapBody: "", status: "planned" })
        ]
      }
    );

    const titles = spine()
      .getAllByRole("button", { name: /^Session \d/ })
      .map((button) => button.textContent);
    expect(titles).toEqual(["Session 2", "Session 1"]);
    expect(spine().getByText("The party reached Barovia.")).toBeInTheDocument();
    expect(spine().getByText("Prep only. The recap is written after the session.")).toBeInTheDocument();
    expect(spine().getByText("Planned")).toBeInTheDocument();
    expect(spine().getByText("Not in a session")).toBeInTheDocument();
    expect(spine().getByRole("button", { name: /A rumour, filed nowhere/ })).toBeInTheDocument();
  });

  it("names each row's kind in words and a short day, and marks a hidden one Hidden", () => {
    renderStory([DOWNTIME, gmRecord({ id: "j2", text: "Shown to all.", revealedToPlayers: true })]);

    const row = document.getElementById("story-row-w1")!;
    // Colour is CSS-only, so the row text must say the kind; the month above it carries the year.
    expect(row).toHaveTextContent("Hammer 3 · Downtime");
    expect(row).toHaveTextContent("Hidden");
    expect(row.querySelector(".story-spinerow-icon")).not.toBeNull();
    expect(document.getElementById("story-row-j2")).not.toHaveTextContent("Hidden");
  });

  it("names the quest a quest event is about, from the GM's own quest list", () => {
    renderStory([gmRecord({ kind: "quest", id: "q-e", text: "", payload: { questId: "q1", status: "active" } })], {
      quests: [{ id: "q1", title: "The Sunless Crown" } as CodexQuest]
    });
    expect(spine().getByRole("button", { name: /The Sunless Crown/ })).toBeInTheDocument();
  });

  it("opens one record at a time, in full, with its own actions", async () => {
    const user = userEvent.setup();
    renderStory([gmRecord({ sessionNumber: 3, inWorldLabel: "Hammer 1, 1492 DR" }), gmRecord({ id: "j2" })]);

    const card = await openRow(user, "j1");
    expect(card.getByText("The party crossed the mists.")).toBeInTheDocument();
    expect(card.getByText("Hammer 1, 1492 DR")).toBeInTheDocument();
    expect(card.getByText("Session 3")).toBeInTheDocument();
    expect(card.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(card.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(document.getElementById("codex-entry-j2")).toBeNull();
  });

  it("lands on the record the address names, open and marked", () => {
    renderGmStory(GmStorySection, "/codex/story?entry=j2", {
      records: [gmRecord(), gmRecord({ id: "j2", text: "The second record." })],
      calendar: CALENDAR
    });
    expect(document.getElementById("codex-entry-j2")).toHaveAttribute("aria-current", "true");
    expect(document.getElementById("story-row-j2")).toHaveAttribute("aria-current", "true");
    expect(document.getElementById("story-row-j1")).not.toHaveAttribute("aria-current");
  });

  it("shows an entry's stored tags on its card", async () => {
    const user = userEvent.setup();
    renderStory([gmRecord({ tags: ["dark-gift", "session-3"] })]);
    const card = await openRow(user, "j1");
    const tags = card.getByRole("list", { name: "Entry tags" });
    expect(tags).toHaveTextContent("dark-gift");
    expect(tags).toHaveTextContent("session-3");
  });
});

describe("A milestone and a standing record read as themselves", () => {
  it("each says its kind in text and carries its own payload line", async () => {
    const user = userEvent.setup();
    renderStory(
      [
        gmRecord({
          kind: "milestone",
          id: "m1",
          text: "The company came back changed.",
          payload: { level: 5, reason: "Cleared the citadel" }
        }),
        gmRecord({
          kind: "standing",
          id: "s1",
          text: "",
          payload: { factionPageId: "f1", delta: -20, reason: "Burned the caravan" }
        })
      ],
      { pages: [page("f1", "The Zhentarim", "faction")] }
    );

    expect(document.getElementById("story-row-m1")).toHaveTextContent("Milestone");
    expect(document.getElementById("story-row-s1")).toHaveTextContent("Standing");
    // The faction is named from the page list; the delta is the change, and the new value is elsewhere.
    expect(document.getElementById("story-row-s1")).toHaveTextContent("The Zhentarim · down 20 · Burned the caravan");
    expect((await openRow(user, "m1")).getByText("Reached level 5 · Cleared the citadel")).toBeInTheDocument();
  });

  it("never renders one kind's payload on the other's row", async () => {
    const user = userEvent.setup();
    renderStory([
      gmRecord({ id: "e1", text: "An ordinary note.", payload: { level: 9, reason: "smuggled" } as never })
    ]);
    // The gate is the kind; the payload shape doesn't open it.
    const card = await openRow(user, "e1");
    expect(document.getElementById("codex-entry-e1")).not.toHaveTextContent("Reached level");
    expect(card.queryByText(/smuggled/)).not.toBeInTheDocument();
  });
});

describe("An event is its page's record", () => {
  const EVENT = gmRecord({
    kind: "event",
    id: "p9",
    title: "The Sundering",
    text: "The sky tore open.",
    inWorldLabel: "Hammer 2, 1493 DR",
    calendarInstant: 1493 * 60 + 1,
    inWorldDate: { year: 1493, month: 0, day: 2 }
  });

  it("stays off the spine, and opens from the calendar with its page and never the composer's Edit or Delete", async () => {
    const user = userEvent.setup();
    renderGmStory(GmStorySection, "/codex/story?y=1493&m=0", { records: [EVENT], calendar: CALENDAR });

    expect(document.getElementById("story-row-p9")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Hammer 2, 1 record" }));
    await user.click(
      within(screen.getByRole("region", { name: "Records on this day" })).getByRole("button", { name: /The Sundering/ })
    );

    const card = cardOf("p9");
    expect(card.getByText("The sky tore open.")).toBeInTheDocument();
    expect(card.getByText("Event")).toBeInTheDocument();
    expect(card.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(card.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    await user.click(card.getByRole("button", { name: "Open page" }));
    expect(window.location.pathname).toBe("/codex/pages/p9");
  });

  it("shows an event through the PAGE route, never the journal route", async () => {
    const user = userEvent.setup();
    // The players are past the event's date, so showing it never warns.
    renderGmStory(GmStorySection, "/codex/story?y=1493&m=0", {
      records: [EVENT],
      calendar: { ...CALENDAR, publishedDate: { year: 1494, month: 0, day: 1 } }
    });
    await user.click(screen.getByRole("button", { name: "Hammer 2, 1 record" }));
    await user.click(
      within(screen.getByRole("region", { name: "Records on this day" })).getByRole("button", { name: /The Sundering/ })
    );
    await user.click(cardOf("p9").getByRole("switch", { name: "Who sees this event: Hidden" }));

    await waitFor(() => expect(api.revealPage).toHaveBeenCalledWith("gm", "p9", true));
    expect(api.reveal).not.toHaveBeenCalled();
  });
});

describe("A deadline's state is the server's, and it reads as a word", () => {
  it("lists clocks passed first, each saying Approaching or Passed", () => {
    renderStory([DEADLINE, { ...DEADLINE, id: "d2", title: "The comet fell.", fired: true }]);
    const rows = clocks().getAllByRole("button");
    expect(rows[0]).toHaveTextContent("The comet fell.");
    expect(rows[0]).toHaveTextContent("Passed");
    expect(rows[1]).toHaveTextContent("The duke's ultimatum");
    expect(rows[1]).toHaveTextContent("Approaching");
  });

  it("says nothing about firing on a record that is not a deadline", async () => {
    const user = userEvent.setup();
    renderStory([gmRecord({ id: "j9", fired: true })]);
    await openRow(user, "j9");
    expect(document.getElementById("codex-entry-j9")).not.toHaveTextContent("Passed");
    expect(document.getElementById("codex-entry-j9")).not.toHaveTextContent("Approaching");
  });

  it("opens a clock in full, with its state and its kind", async () => {
    const user = userEvent.setup();
    renderStory([DEADLINE]);
    await user.click(clocks().getByRole("button", { name: /The duke's ultimatum/ }));
    const card = cardOf("d1");
    expect(card.getByText("Deadline")).toBeInTheDocument();
    expect(card.getByText("Approaching")).toBeInTheDocument();
  });

  it("will not let an edit take a deadline's date away, and only a deadline's", async () => {
    const user = userEvent.setup();
    renderStory([DEADLINE, gmRecord()]);
    await user.click(clocks().getByRole("button", { name: /The duke's ultimatum/ }));
    await user.click(cardOf("d1").getByRole("button", { name: "Edit" }));

    const editor = within(await screen.findByRole("dialog", { name: "Edit a chronicle record" }));
    const save = editor.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await user.clear(editor.getByLabelText("Year"));
    expect(save).toBeDisabled();
    expect(editor.getByText(/A deadline needs a date/)).toBeInTheDocument();
    expect(api.update).not.toHaveBeenCalled();

    await user.click(editor.getByRole("button", { name: "Cancel" }));
    await user.click((await openRow(user, "j1")).getByRole("button", { name: "Edit" }));
    const entryEditor = within(await screen.findByRole("dialog", { name: "Edit a chronicle record" }));
    await user.clear(entryEditor.getByLabelText("Year"));
    expect(entryEditor.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});

describe("Downtime proposes; the GM confirms", () => {
  it("states what confirming will do BEFORE the button that does it", async () => {
    const user = userEvent.setup();
    renderStory([DOWNTIME]);
    const card = await openRow(user, "w1");

    expect(card.getByText("Move your date to Hammer 10, 1492 DR")).toBeInTheDocument();
    expect(card.getByText("Aldric · Forging a blade · 7 days")).toBeInTheDocument();
    await user.click(card.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.applyDowntime).toHaveBeenCalledWith("gm", "w1"));
  });

  /** Each likely bug gives a different number: all 4, ignoring `fired` 3, `<` in place of `<=` 1. */
  it("says how many deadlines confirming would pass", async () => {
    const user = userEvent.setup();
    renderStory([
      DOWNTIME,
      DEADLINE, // Hammer 10, exactly the landing day: counts
      gmRecord({
        kind: "deadline",
        id: "d2",
        text: "The caravan leaves.",
        calendarInstant: HAMMER(5),
        inWorldDate: { year: 1492, month: 0, day: 5 }
      }),
      // Already passed: not caused by this.
      gmRecord({
        kind: "deadline",
        id: "d3",
        text: "The tax was due.",
        fired: true,
        calendarInstant: HAMMER(2),
        inWorldDate: { year: 1492, month: 0, day: 2 }
      }),
      // Beyond the landing day.
      gmRecord({
        kind: "deadline",
        id: "d4",
        text: "Midwinter.",
        calendarInstant: 1492 * 60 + 49,
        inWorldDate: { year: 1492, month: 1, day: 20 }
      })
    ]);
    expect(
      (await openRow(user, "w1")).getByText("Move your date to Hammer 10, 1492 DR. This passes 2 deadlines.")
    ).toBeInTheDocument();
  });

  it("counts one deadline in the singular, and adds no clause when the move passes nothing", async () => {
    const user = userEvent.setup();
    const view = renderStory([DOWNTIME, DEADLINE]);
    expect(
      (await openRow(user, "w1")).getByText("Move your date to Hammer 10, 1492 DR. This passes 1 deadline.")
    ).toBeInTheDocument();
    view.unmount();

    renderStory([DOWNTIME]);
    const card = await openRow(user, "w1");
    expect(card.getByText("Move your date to Hammer 10, 1492 DR")).toBeInTheDocument();
    expect(card.queryByText(/deadline/)).not.toBeInTheDocument();
  });

  /** Server and local arithmetic disagree here, so the card can only show Alturiak 12 by reading the server. */
  it("names the SERVER's proposed date, and promises nothing when it proposed none", async () => {
    const user = userEvent.setup();
    renderStory([
      gmRecord({ ...DOWNTIME, id: "w3", proposedDate: { year: 1492, month: 1, day: 12 } }),
      gmRecord({ ...DOWNTIME, id: "w4", proposedDate: null })
    ]);
    const w3 = await openRow(user, "w3");
    expect(w3.getByText("Move your date to Alturiak 12, 1492 DR")).toBeInTheDocument();
    expect(w3.queryByText(/Hammer 10/)).not.toBeInTheDocument();

    const w4 = await openRow(user, "w4");
    expect(w4.queryByText(/Move your date/)).not.toBeInTheDocument();
    expect(w4.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });

  it("offers no second confirmation once the date has already moved", async () => {
    const user = userEvent.setup();
    renderStory([
      gmRecord({
        ...DOWNTIME,
        id: "w2",
        payload: { who: "Aldric", activity: "Forging a blade", days: 7, characterPageId: null, applied: true }
      })
    ]);
    const card = await openRow(user, "w2");
    expect(card.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(card.getByText("Aldric · Forging a blade · 7 days")).toBeInTheDocument();
    expect(card.getByText(/Your date has already been moved/)).toBeInTheDocument();
  });
});

describe("The Downtime card", () => {
  const PAGES = [page("c1", "Vex"), page("c2", "Ireena"), page("l1", "Vallaki", "location")];
  const downtime = (
    id: string,
    payload: Readonly<{
      who: string;
      activity: string;
      days: number;
      applied: boolean;
      characterPageId?: string | null;
    }>
  ) =>
    gmRecord({
      ...DOWNTIME,
      id,
      text: "",
      payload: { characterPageId: null, ...payload },
      proposedDate: { year: 1492, month: 0, day: 10 }
    });
  const card = () => within(screen.getByRole("region", { name: "Downtime" }));

  it("totals a person once, whatever the spelling, and opens a linked one's page", async () => {
    const user = userEvent.setup();
    renderStory(
      [
        downtime("d1", { who: "Vex", activity: "Forging", days: 7, applied: true, characterPageId: "c1" }),
        downtime("d2", { who: "vex the bold", activity: "Carousing", days: 3, applied: true, characterPageId: "c1" }),
        downtime("d3", { who: "Ireena", activity: "Praying", days: 2, applied: true })
      ],
      { pages: PAGES }
    );

    const rows = card().getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole("rowheader")).toHaveTextContent("Vex");
    expect(within(rows[0]).getAllByRole("cell")[0]).toHaveTextContent("10");
    expect(within(rows[1]).getByRole("rowheader")).toHaveTextContent("Ireena");
    // An unlinked name is plain text; a linked one opens its page.
    expect(within(rows[1]).getByRole("rowheader").querySelector("button")).toBeNull();
    await user.click(within(rows[0]).getByRole("button", { name: "Vex" }));
    expect(window.location.pathname).toBe("/codex/pages/c1");
  });

  it("says the log is empty and shows no table", () => {
    renderStory([]);
    expect(card().getByText("No downtime logged yet.")).toBeInTheDocument();
    expect(card().queryByRole("table")).toBeNull();
  });

  it("lists what waits to be confirmed, names the landing date on the button and warns of a deadline", async () => {
    const user = userEvent.setup();
    renderStory([
      downtime("d1", { who: "Vex", activity: "Forging", days: 7, applied: false }),
      downtime("d2", { who: "Ireena", activity: "Praying", days: 2, applied: true }),
      gmRecord({
        kind: "deadline",
        id: "dl",
        text: "The vote.",
        calendarInstant: HAMMER(7),
        inWorldDate: { year: 1492, month: 0, day: 7 }
      })
    ]);

    const pending = within(card().getByRole("list", { name: "Waiting to be confirmed" }));
    expect(pending.getAllByRole("listitem")).toHaveLength(1);
    expect(pending.getByText("Vex · Forging · 7 days")).toBeInTheDocument();
    await user.click(pending.getByRole("button", { name: "Move your date to Hammer 10, 1492 DR (passes 1 deadline)" }));
    await waitFor(() => expect(api.applyDowntime).toHaveBeenCalledWith("gm", "d1"));
  });

  it("with no date to start from, says why beside the control and sends nothing", async () => {
    const user = userEvent.setup();
    renderStory(
      [
        gmRecord({
          ...downtime("d1", { who: "Vex", activity: "Forging", days: 7, applied: false }),
          proposedDate: null
        })
      ],
      {
        calendar: { ...CALENDAR, currentDate: null, publishedDate: null }
      }
    );
    const confirm = card().getByRole("button", { name: "Confirm" });
    expect(confirm).toBeDisabled();
    expect(card().getByText(/Set your date before passing time/)).toBeInTheDocument();
    await user.click(confirm);
    expect(api.applyDowntime).not.toHaveBeenCalled();
  });

  it("shows a stale-list conflict on the row that was pressed, and reads the chronicle again", async () => {
    const user = userEvent.setup();
    const view = renderStory([
      downtime("d1", { who: "Vex", activity: "Forging", days: 7, applied: false }),
      downtime("d2", { who: "Ireena", activity: "Praying", days: 3, applied: false })
    ]);
    api.applyDowntime.mockRejectedValueOnce(new Error("That downtime has already moved the date."));
    const rows = within(card().getByRole("list", { name: "Waiting to be confirmed" })).getAllByRole("listitem");
    await user.click(within(rows[0]).getByRole("button", { name: /^Move your date to/ }));

    expect(await within(rows[0]).findByText(/already moved/)).toBeInTheDocument();
    expect(within(rows[1]).queryByText(/already moved/)).toBeNull();
    expect(view.reload).toHaveBeenCalled();
  });

  it("links an old free-text row to a character page, and never offers to edit the days", async () => {
    const user = userEvent.setup();
    const names = ["Ana", "Bo", "Cass", "Dain", "Eda", "Finn", "Gale", "Hex", "Ivy"];
    renderStory([downtime("d1", { who: "ivy", activity: "Scouting", days: 4, applied: true })], {
      // Nine characters: one past the Combobox's default page, plus a location that must be left out.
      pages: [...names.map((name, index) => page(`c${index + 1}`, name)), page("l1", "Vallaki", "location")]
    });

    await user.click(card().getByText("Link a row to a character"));
    await user.click(card().getByRole("button", { name: "Link" }));
    expect(card().queryByLabelText("Days")).toBeNull();
    expect(card().getByText(/Days can't change after logging/)).toBeInTheDocument();

    await user.click(card().getByRole("combobox", { name: "Link to a character page" }));
    expect(
      within(await screen.findByRole("listbox"))
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(names);
    await user.click(screen.getByRole("option", { name: "Ivy" }));
    await user.click(card().getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(api.update.mock.calls[0][2].downtime).toMatchObject({
      who: "ivy",
      activity: "Scouting",
      characterPageId: "c9"
    });
  });

  it("opens the composer on Downtime from Log downtime", async () => {
    const user = userEvent.setup();
    renderStory([]);
    await user.click(card().getByRole("button", { name: "Log downtime" }));
    const composer = within(await screen.findByRole("dialog", { name: "Add to the chronicle" }));
    expect(composer.getByRole("button", { name: "Downtime", pressed: true })).toBeInTheDocument();
  });
});

describe("The composer", () => {
  it("offers Entry, Deadline, Downtime and Milestone, and never Standing", async () => {
    const user = userEvent.setup();
    renderStory([]);
    const composer = await openComposer(user);
    const kinds = within(composer.getByRole("group", { name: "What to add" }));
    expect(kinds.getAllByRole("button").map((option) => option.textContent)).toEqual([
      "Entry",
      "Deadline",
      "Downtime",
      "Milestone"
    ]);
    expect(kinds.queryByText("Standing")).not.toBeInTheDocument();
  });

  for (const kind of ["Entry", "Deadline", "Downtime", "Milestone"]) {
    it(`names what players read and the hidden note the same way on a ${kind.toLowerCase()}`, async () => {
      const user = userEvent.setup();
      renderStory([]);
      const composer = await openComposer(user);
      await user.click(composer.getByRole("button", { name: kind }));
      expect(composer.getByRole("textbox", { name: "What players read" })).toBeInTheDocument();
      expect(composer.getByRole("textbox", { name: "Hidden note" })).toBeInTheDocument();
    });
  }

  it("sends a tag typed with a new entry, slugified to the server's rule", async () => {
    const user = userEvent.setup();
    renderStory([]);
    const composer = await openComposer(user);
    await user.type(composer.getByRole("textbox", { name: "What players read" }), "They crossed the mists.");
    // The server would reject "Session Recap" as typed.
    await user.type(composer.getByLabelText("Tags"), "Session Recap{Enter}");
    await user.click(composer.getByRole("button", { name: "Add entry" }));

    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0][1]).toMatchObject({
      tags: ["session-recap"],
      playerText: "They crossed the mists."
    });
  });

  it("loads an existing entry's tags on Edit and saves them back", async () => {
    const user = userEvent.setup();
    renderStory([gmRecord({ tags: ["dark-gift"] })]);
    await user.click((await openRow(user, "j1")).getByRole("button", { name: "Edit" }));
    const editor = within(await screen.findByRole("dialog", { name: "Edit a chronicle record" }));
    expect(editor.getByRole("list", { name: /chosen/i })).toHaveTextContent("dark-gift");

    await user.type(editor.getByLabelText("Tags"), "Ravenloft{Enter}");
    await user.click(editor.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(api.update.mock.calls[0][2]).toMatchObject({ tags: ["dark-gift", "ravenloft"] });
  });

  it("will not arm a deadline until its date is there, then sends the raw date the GM typed", async () => {
    const user = userEvent.setup();
    renderStory([]);
    const composer = await openComposer(user);
    await user.click(composer.getByRole("button", { name: "Deadline" }));
    await user.type(composer.getByRole("textbox", { name: "What players read" }), "The duke's ultimatum expires.");
    expect(composer.getByRole("button", { name: "Add deadline" })).toBeDisabled();
    expect(composer.getByText(/A deadline needs a date/)).toBeInTheDocument();

    await user.type(composer.getByLabelText("Year"), "1492");
    await user.type(composer.getByLabelText("Day"), "10");
    await user.click(composer.getByRole("button", { name: "Add deadline" }));

    await waitFor(() => expect(api.createDeadline).toHaveBeenCalled());
    const body = api.createDeadline.mock.calls.at(-1)![1];
    expect(body.inWorldDate).toEqual({ year: 1492, month: 0, day: 10 });
    expect(body.playerText).toBe("The duke's ultimatum expires.");
    expect(body).not.toHaveProperty("downtime");
    expect(api.create).not.toHaveBeenCalled();
  });

  it("logs downtime as a record and leaves the date alone, proposing the landing day first", async () => {
    const user = userEvent.setup();
    renderStory([], { pages: [page("c1", "Vex"), page("l1", "Vallaki", "location")] });
    const composer = await openComposer(user);
    await user.click(composer.getByRole("button", { name: "Downtime" }));
    expect(composer.getByRole("button", { name: "Log downtime" })).toBeDisabled();

    // Only character pages are offered.
    await user.click(composer.getByRole("combobox", { name: "Who spent the time" }));
    expect(
      within(await screen.findByRole("listbox"))
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["Vex"]);
    await user.click(screen.getByRole("option", { name: "Vex" }));
    await user.type(composer.getByLabelText("Activity"), "Forging a blade");
    await user.type(composer.getByLabelText("Days"), "7");
    // Hammer 3 + 7, stated as a proposal before anything moves.
    expect(composer.getByText(/proposes moving your date to Hammer 10, 1492 DR/)).toBeInTheDocument();
    await user.click(composer.getByRole("button", { name: "Log downtime" }));

    await waitFor(() => expect(api.createDowntime).toHaveBeenCalled());
    const body = api.createDowntime.mock.calls.at(-1)![1];
    // `who` carries the page title so readers without the page still have a name.
    expect(body.downtime).toEqual({ who: "Vex", activity: "Forging a blade", days: 7, characterPageId: "c1" });
    // Creates carry an idempotency key (double-tap on a phone).
    expect(body.commandId).toEqual(expect.any(String));
    expect(api.applyDowntime).not.toHaveBeenCalled();
    expect(api.setCalendar).not.toHaveBeenCalled();
    expect(api.publish).not.toHaveBeenCalled();
  });

  it("takes a free-text name for someone who has no page", async () => {
    const user = userEvent.setup();
    renderStory([]);
    const composer = await openComposer(user);
    await user.click(composer.getByRole("button", { name: "Downtime" }));
    await user.type(composer.getByRole("combobox", { name: "Who spent the time" }), "Vex the Bold{Enter}");
    await user.click(composer.getByRole("button", { name: "Log downtime" }));

    await waitFor(() => expect(api.createDowntime).toHaveBeenCalled());
    expect(api.createDowntime.mock.calls[0][1].downtime).toMatchObject({ who: "Vex the Bold" });
    expect(api.createDowntime.mock.calls[0][1].downtime.characterPageId).toBeUndefined();
  });

  it("records a milestone through its own route on its level alone, clamped to 5e's range and undated", async () => {
    const user = userEvent.setup();
    renderStory([]);
    const composer = await openComposer(user);
    await user.click(composer.getByRole("button", { name: "Milestone" }));
    expect(composer.getByRole("button", { name: "Record milestone" })).toBeDisabled();
    await user.type(composer.getByLabelText("Level reached"), "99");
    await user.type(composer.getByLabelText("Why"), "Cleared the Sunless Citadel");
    // Unlike a deadline, a milestone needs no date: the store dates it at the campaign clock.
    await user.clear(composer.getByLabelText("Year"));
    await user.click(composer.getByRole("button", { name: "Record milestone" }));

    await waitFor(() => expect(api.createMilestone).toHaveBeenCalled());
    const body = api.createMilestone.mock.calls.at(-1)![1];
    expect(body.milestone).toEqual({ level: 20, reason: "Cleared the Sunless Citadel" });
    expect(body.inWorldDate).toBeNull();
    expect(api.create).not.toHaveBeenCalled();
    expect(api.createDeadline).not.toHaveBeenCalled();
    expect(api.createDowntime).not.toHaveBeenCalled();
  });
});

describe("Showing a record dated ahead of the players", () => {
  /** Players are on Hammer 10; the GM is on Alturiak 28. */
  const AHEAD_CALENDAR: GmCodexCalendar = {
    ...CALENDAR,
    currentDate: { year: 1492, month: 1, day: 28 },
    publishedDate: { year: 1492, month: 0, day: 10 }
  };
  const AHEAD = gmRecord({
    kind: "milestone",
    id: "m1",
    text: "The party reached 5.",
    payload: { level: 5, reason: "Barovia" },
    inWorldLabel: "Alturiak 28, 1492 DR",
    calendarInstant: 1492 * 60 + 57,
    inWorldDate: { year: 1492, month: 1, day: 28 }
  });
  const TODAY = gmRecord({
    id: "j2",
    text: "A quiet day.",
    calendarInstant: HAMMER(10),
    inWorldDate: { year: 1492, month: 0, day: 10 }
  });
  const UNDATED = gmRecord({ id: "j3", text: "Session notes." });
  const show = async (user: ReturnType<typeof userEvent.setup>, id: string) =>
    user.click((await openRow(user, id)).getByRole("switch", { name: /^Who sees this entry/ }));

  it("warns, names both dates, and shows nothing until the GM says so", async () => {
    const user = userEvent.setup();
    renderStory([AHEAD], { calendar: AHEAD_CALENDAR });
    await show(user, "m1");

    expect(
      await screen.findByText(
        "Players' date is still Hammer 10, 1492 DR. Showing this record tells them the date has reached Alturiak 28, 1492 DR. Publish the date first if you don't want that."
      )
    ).toBeInTheDocument();
    expect(api.reveal).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Show anyway" }));
    await waitFor(() => expect(api.reveal).toHaveBeenCalledWith("gm", "m1", true));
  });

  it("shows nothing when the GM backs out", async () => {
    const user = userEvent.setup();
    renderStory([AHEAD], { calendar: AHEAD_CALENDAR });
    await show(user, "m1");
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(api.reveal).not.toHaveBeenCalled();
    expect(cardOf("m1").getByRole("switch", { name: /^Who sees this entry/ })).toHaveAttribute("aria-checked", "false");
  });

  it("says nothing for a record at the players' own date, an undated one, clocks that agree or a date never published", async () => {
    const user = userEvent.setup();
    const one = renderStory([TODAY, UNDATED], { calendar: AHEAD_CALENDAR });
    await show(user, "j2");
    await waitFor(() => expect(api.reveal).toHaveBeenCalledWith("gm", "j2", true));
    await show(user, "j3");
    await waitFor(() => expect(api.reveal).toHaveBeenCalledWith("gm", "j3", true));
    one.unmount();

    const two = renderStory([AHEAD], { calendar: { ...AHEAD_CALENDAR, publishedDate: AHEAD_CALENDAR.currentDate } });
    await show(user, "m1");
    await waitFor(() => expect(api.reveal).toHaveBeenCalledWith("gm", "m1", true));
    two.unmount();
    api.reveal.mockClear();

    renderStory([AHEAD], { calendar: { ...AHEAD_CALENDAR, publishedDate: null } });
    await show(user, "m1");
    await waitFor(() => expect(api.reveal).toHaveBeenCalledWith("gm", "m1", true));
    expect(screen.queryByText(/dated ahead/i)).not.toBeInTheDocument();
  });

  it("never warns about HIDING a record, however far ahead it is dated", async () => {
    const user = userEvent.setup();
    renderStory([gmRecord({ ...AHEAD, id: "m2", revealedToPlayers: true })], { calendar: AHEAD_CALENDAR });
    await user.click((await openRow(user, "m2")).getByRole("switch", { name: /^Who sees this entry/ }));
    await waitFor(() => expect(api.reveal).toHaveBeenCalledWith("gm", "m2", false));
  });

  it("stops warning once asked, only from the affirmative button, with a fresh switch each time and a way back on", async () => {
    const user = userEvent.setup();
    renderStory([AHEAD, gmRecord({ ...AHEAD, id: "m3", text: "The party reached 6." })], { calendar: AHEAD_CALENDAR });
    expect(screen.queryByRole("button", { name: "Warn me again before showing a record" })).not.toBeInTheDocument();

    // Cancelling keeps the warning on, and the next dialog's switch starts off.
    await show(user, "m1");
    await user.click(await screen.findByRole("switch", { name: "Stop warning me about this" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await show(user, "m3");
    expect(await screen.findByRole("switch", { name: "Stop warning me about this" })).toHaveAttribute(
      "aria-checked",
      "false"
    );

    // Turned off from Show anyway: the next record shows at once.
    await user.click(screen.getByRole("switch", { name: "Stop warning me about this" }));
    await user.click(screen.getByRole("button", { name: "Show anyway" }));
    await waitFor(() => expect(api.reveal).toHaveBeenCalledWith("gm", "m3", true));
    await show(user, "m1");
    await waitFor(() => expect(api.reveal).toHaveBeenCalledWith("gm", "m1", true));

    // And back on.
    await user.click(screen.getByRole("button", { name: "Warn me again before showing a record" }));
    expect(screen.queryByRole("button", { name: "Warn me again before showing a record" })).not.toBeInTheDocument();
  });

  it("is strictly ahead, and silent about everything it cannot honestly answer", () => {
    expect(revealAheadOfPlayers({ calendarInstant: HAMMER(11) }, AHEAD_CALENDAR)).toBe(true);
    expect(revealAheadOfPlayers({ calendarInstant: HAMMER(10) }, AHEAD_CALENDAR)).toBe(false);
    expect(revealAheadOfPlayers({ calendarInstant: HAMMER(9) }, AHEAD_CALENDAR)).toBe(false);
    expect(revealAheadOfPlayers({ calendarInstant: HAMMER(11) }, { ...AHEAD_CALENDAR, publishedDate: null })).toBe(
      false
    );
    expect(revealAheadOfPlayers({ calendarInstant: null }, AHEAD_CALENDAR)).toBe(false);
    expect(revealAheadOfPlayers({ calendarInstant: HAMMER(11) }, null)).toBe(false);
  });
});

describe("The two dates", () => {
  const SPLIT: GmCodexCalendar = { ...CALENDAR, currentDate: { year: 1492, month: 0, day: 20 } };
  const bar = () => within(screen.getByRole("group", { name: "The two dates" }));

  it("shows yours, Hidden, with the game clock's hour, and the players' beside it", () => {
    renderStory([], { calendar: SPLIT, gameHours: 38 });
    expect(bar().getByRole("button", { name: "Your date is Hammer 20, 1492 DR. Change it." })).toHaveTextContent(
      "Hammer 20"
    );
    expect(bar().getByText("14:00")).toBeInTheDocument();
    expect(bar().getByText("Hidden")).toBeInTheDocument();
    expect(bar().getByText("Hammer 3")).toBeInTheDocument();
  });

  it("always offers Publish, and turns it off only while the party is on your date", async () => {
    const user = userEvent.setup();
    const view = renderStory([], { calendar: SPLIT });
    await user.click(bar().getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(api.publish).toHaveBeenCalledWith("gm"));
    expect(view.reload).toHaveBeenCalled();
    // Publishing is never a side effect of saving the calendar, and it says what players now see.
    expect(api.setCalendar).not.toHaveBeenCalled();
    expect(await screen.findByText("Players now see Hammer 20, 1492 DR.")).toBeInTheDocument();
    view.unmount();

    renderStory([]);
    expect(bar().getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(bar().getByText(/The party is on your date/)).toBeInTheDocument();
  });

  it("hides the players' date again, so they see none until the next Publish", async () => {
    const user = userEvent.setup();
    api.unpublish.mockResolvedValue({});
    const view = renderStory([], { calendar: SPLIT });
    await user.click(bar().getByRole("button", { name: "Hide the date from players" }));
    await waitFor(() => expect(api.unpublish).toHaveBeenCalledWith("gm"));
    expect(view.reload).toHaveBeenCalled();
    expect(await screen.findByText("Players no longer see a date.")).toBeInTheDocument();
  });

  it("offers Publish from the unset state, where the party has no date at all", () => {
    renderStory([], { calendar: { ...CALENDAR, publishedDate: null } });
    expect(bar().getByText("Not shared yet")).toBeInTheDocument();
    expect(bar().getByRole("button", { name: "Publish" })).toBeEnabled();
    expect(bar().getByText(/The party has no date yet/)).toBeInTheDocument();
  });

  it("makes your date a door to its editor, and gives the players' date none", async () => {
    const user = userEvent.setup();
    renderStory([], { calendar: { ...CALENDAR, currentDate: null, publishedDate: null } });
    await user.click(bar().getByRole("button", { name: "Set your date" }));
    expect(await screen.findByRole("dialog", { name: "Your date" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Not shared yet/ })).toBeNull();
  });

  it("shows a failed publish where the GM is looking, and says nothing about success", async () => {
    const user = userEvent.setup();
    api.publish.mockRejectedValue(new Error("Couldn't reach the table."));
    renderStory([], { calendar: SPLIT });
    await user.click(bar().getByRole("button", { name: "Publish" }));
    expect(await screen.findByText("Couldn't reach the table.")).toBeInTheDocument();
    expect(screen.queryByText(/Players now see/)).not.toBeInTheDocument();
  });

  it("invites a GM with no calendar to set one up", () => {
    renderStory([], { calendar: null });
    expect(screen.getByText("The world has no calendar yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set up the calendar" })).toBeInTheDocument();
  });
});

describe("The month on the calendar side", () => {
  /** Two 10-day months and a 5-day week, so every cell is countable. Hammer 1 of 1491 is 1491 x 20. */
  const SMALL: GmCodexCalendar = {
    yearName: "DR",
    eras: [],
    months: [
      { name: "Hammer", days: 10 },
      { name: "Alturiak", days: 10 }
    ],
    weekdays: ["Sul", "Mol", "Zor", "Ches", "Tar"],
    currentDate: { year: 1491, month: 0, day: 4 },
    publishedDate: { year: 1491, month: 0, day: 2 }
  };
  const DAY = (day: number) => 29819 + day;
  const at = (path: string, records: readonly CodexChronicleRecord[] = [], calendar: GmCodexCalendar = SMALL) =>
    renderGmStory(GmStorySection, path, { records, calendar });

  it("lays out the GM's month under short weekday names, with the week's own lead blanks", () => {
    at("/codex/story");
    const grid = screen.getByRole("grid", { name: "Hammer 1491 DR" });
    const headers = within(grid).getAllByRole("columnheader");
    expect(headers.map((cell) => cell.textContent)).toEqual(["Su", "Mo", "Zo", "Ch", "Ta"]);
    // The full name is what a screen reader hears.
    expect(headers[3]).toHaveAccessibleName("Ches");
    expect(within(grid).getAllByRole("button")).toHaveLength(10);
    // 29820 % 5 === 0, so Hammer 1 is the first weekday: no lead blanks.
    expect(grid.querySelectorAll(".story-cal-cell.is-blank")).toHaveLength(0);
  });

  it("marks your date and the players' date in words as well as colour", () => {
    at("/codex/story");
    expect(screen.getByRole("button", { name: "Hammer 4, your date" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hammer 2, players' date" })).toBeInTheDocument();
  });

  it("places a record by the SERVER's instant, and opens it from the day", async () => {
    const user = userEvent.setup();
    // The raw date says day 31 of a 10-day month; the server's instant says Hammer 7.
    at("/codex/story", [
      gmRecord({
        id: "j9",
        title: "The feast",
        inWorldDate: { year: 1491, month: 0, day: 31 },
        calendarInstant: DAY(7)
      })
    ]);

    expect(screen.queryByRole("button", { name: /Hammer 10, 1 record/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Hammer 7, 1 record" }));
    const day = within(await screen.findByRole("region", { name: "Records on this day" }));
    expect(day.getByRole("heading", { name: "Hammer 7, 1491 DR" })).toBeInTheDocument();
    await user.click(day.getByRole("button", { name: /The feast/ }));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("entry")).toBe("j9"));
    expect(document.getElementById("codex-entry-j9")).toBeInTheDocument();
  });

  it("says so when a day holds nothing, and closes on a second tap", async () => {
    const user = userEvent.setup();
    at("/codex/story");
    await user.click(screen.getByRole("button", { name: "Hammer 5" }));
    expect(await screen.findByText("Nothing happened on this day.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hammer 5" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Records on this day" })).toBeNull());
  });

  it("counts every record on a day, past the dots it has room for", () => {
    at(
      "/codex/story",
      ["a", "b", "c", "d"].map((id) => gmRecord({ id, calendarInstant: DAY(3) }))
    );
    expect(within(screen.getByRole("button", { name: "Hammer 3, 4 records" })).getByText("+1")).toBeInTheDocument();
  });

  it("shows the month the address names, steps across the year, and clamps a nonsense month", async () => {
    const user = userEvent.setup();
    const one = at("/codex/story?y=1491&m=1");
    expect(screen.getByRole("grid", { name: "Alturiak 1491 DR" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next month" }));
    // Two months a year, so after Alturiak 1491 comes Hammer 1492.
    expect(new URLSearchParams(window.location.search).get("y")).toBe("1492");
    expect(new URLSearchParams(window.location.search).get("m")).toBe("0");
    one.unmount();

    at("/codex/story?y=1491&m=99");
    expect(screen.getByRole("grid", { name: "Alturiak 1491 DR" })).toBeInTheDocument();
  });

  /** Must agree with the server's `formatWorldYear`, which writes the stored `in_world_label`. */
  it("leads a year with the era it has reached, the earlier era before the later one, and none before every era", () => {
    const eras = [
      { name: "Age of Ruin", startYear: 1000 },
      { name: "Third Age", startYear: 1400 }
    ];
    const one = at("/codex/story?y=1491&m=0", [], { ...SMALL, eras });
    expect(screen.getByRole("heading", { name: "Hammer Third Age 1491 DR" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Your date is Hammer 4, Third Age 1491 DR/ })).toBeInTheDocument();
    one.unmount();
    const two = at("/codex/story?y=1200&m=0", [], { ...SMALL, eras });
    expect(screen.getByRole("heading", { name: "Hammer Age of Ruin 1200 DR" })).toBeInTheDocument();
    two.unmount();
    at("/codex/story?y=900&m=0", [], { ...SMALL, eras });
    expect(screen.getByRole("heading", { name: "Hammer 900 DR" })).toBeInTheDocument();
  });
});

describe("Loading, failure and filters", () => {
  it("does not call an empty campaign 'no calendar' while the feed is in flight", () => {
    const { container } = renderGmStory(GmStorySection, "/codex/story", { campaign: { loading: true } });
    expect(container.querySelector(".story-loading")).not.toBeNull();
    expect(screen.queryByText("The world has no calendar yet.")).toBeNull();
  });

  it("reports a failed read", () => {
    renderGmStory(GmStorySection, "/codex/story", { campaign: { error: "Could not load the campaign dashboard." } });
    expect(screen.getByText("Could not load the campaign dashboard.")).toBeInTheDocument();
  });

  it("filters by kind, tag and words from the address, and writes the address from the flyout", async () => {
    const user = userEvent.setup();
    renderGmStory(GmStorySection, "/codex/story?tag=travel", {
      calendar: CALENDAR,
      records: [
        gmRecord({ id: "a", text: "We reached Vallaki", tags: ["travel"] }),
        gmRecord({ id: "b", text: "A quiet night", tags: [] }),
        gmRecord({ kind: "milestone", id: "c", text: "Level up", tags: ["travel"], payload: { level: 3, reason: "" } })
      ]
    });
    expect(spine().getByRole("button", { name: /We reached Vallaki/ })).toBeInTheDocument();
    expect(spine().queryByRole("button", { name: /A quiet night/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Filters · 1" }));
    await user.click(within(screen.getByRole("group", { name: "Kind" })).getByRole("button", { name: "Milestone" }));
    expect(new URLSearchParams(window.location.search).get("kind")).toBe("milestone");
    expect(spine().queryByRole("button", { name: /We reached Vallaki/ })).toBeNull();
    expect(spine().getByRole("button", { name: /Reached level 3/ })).toBeInTheDocument();
  });
});

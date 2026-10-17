import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createDowntime = vi.fn();
const applyDowntime = vi.fn();
const update = vi.fn();

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    journalApi: {
      ...actual.journalApi,
      createDowntime: (...a: unknown[]) => createDowntime(...a),
      applyDowntime: (...a: unknown[]) => applyDowntime(...a),
      update: (...a: unknown[]) => update(...a)
    }
  };
});

import { DowntimeView, PlayerDowntimeView } from "./DowntimeView";
import type { CodexChronicleRecord, CodexPageSummary, GmCodexCalendar } from "@vtt/domain";

const CALENDAR: GmCodexCalendar = {
  yearName: "DR",
  eras: [],
  months: [
    { name: "Hammer", days: 30 },
    { name: "Alturiak", days: 30 }
  ],
  weekdays: ["Sul", "Mol"],
  currentDate: { year: 1491, month: 0, day: 10 },
  publishedDate: { year: 1491, month: 0, day: 10 }
};

const page = (
  id: string,
  title: string,
  entityType: CodexPageSummary["entityType"] = "character"
): CodexPageSummary => ({
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
  firstShownAt: null
});

const downtime = (
  id: string,
  payload: Readonly<{ who: string; activity: string; days: number; applied: boolean; characterPageId?: string | null }>
): CodexChronicleRecord =>
  ({
    id,
    kind: "downtime",
    title: null,
    text: "",
    playerText: "",
    gmText: "",
    tags: [],
    revealedToPlayers: false,
    sessionId: null,
    sessionNumber: null,
    realDate: null,
    inWorldDate: null,
    inWorldLabel: "Hammer 3, 1491 DR",
    calendarInstant: null,
    proposedDate: { year: 1491, month: 0, day: 17 },
    attachPageId: null,
    attachMarkerId: null,
    archiveId: null,
    payload: { characterPageId: null, ...payload },
    createdAt: "2026-07-31T00:00:00.000Z"
  }) as unknown as CodexChronicleRecord;

const PAGES = [page("c1", "Vex"), page("c2", "Ireena"), page("l1", "Vallaki", "location")];

const renderDowntime = (over: Partial<React.ComponentProps<typeof DowntimeView>> = {}) => {
  const props = {
    gmToken: "gm",
    records: [] as readonly CodexChronicleRecord[],
    calendar: CALENDAR,
    pages: PAGES,
    loading: false,
    error: null,
    onChanged: vi.fn(),
    onOpenEntry: vi.fn(),
    onOpenPage: vi.fn(),
    ...over
  };
  return { props, ...render(<DowntimeView {...props} />) };
};

beforeEach(() => {
  createDowntime.mockResolvedValue(undefined);
  applyDowntime.mockResolvedValue(undefined);
  update.mockResolvedValue(undefined);
});

describe("Totals: a person counts once, whatever the spelling", () => {
  it("groups a linked row with its page however its `who` string is spelled", () => {
    renderDowntime({
      records: [
        downtime("d1", { who: "Vex", activity: "Forging", days: 7, applied: true, characterPageId: "c1" }),
        downtime("d2", { who: "vex the bold", activity: "Carousing", days: 3, applied: true, characterPageId: "c1" }),
        downtime("d3", { who: "Ireena", activity: "Praying", days: 2, applied: true })
      ]
    });

    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    // Two people, and three spellings; the linked one is named by its page.
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole("rowheader")).toHaveTextContent("Vex");
    expect(within(rows[0]).getAllByRole("cell")[0]).toHaveTextContent("10");
    expect(within(rows[1]).getByRole("rowheader")).toHaveTextContent("Ireena");
    expect(within(rows[1]).getAllByRole("cell")[0]).toHaveTextContent("2");
  });

  it("still totals an unlinked row by name, and opens a linked one's page", async () => {
    const user = userEvent.setup();
    const onOpenPage = vi.fn();
    renderDowntime({
      onOpenPage,
      records: [
        downtime("d1", { who: "Vex", activity: "Forging", days: 4, applied: true, characterPageId: "c1" }),
        downtime("d2", { who: "The party", activity: "Resting", days: 1, applied: true })
      ]
    });

    // Unlinked free-text names still total.
    expect(screen.getByRole("rowheader", { name: "The party" })).toBeInTheDocument();
    // A linked name opens the page; an unlinked one is plain text.
    await user.click(within(screen.getByRole("rowheader", { name: "Vex" })).getByRole("button"));
    expect(onOpenPage).toHaveBeenCalledWith("c1");
    expect(within(screen.getByRole("rowheader", { name: "The party" })).queryByRole("button")).toBeNull();
  });

  it("says the log is empty rather than showing a table of nothing", () => {
    renderDowntime();
    expect(screen.getByText("No downtime recorded yet.")).toBeInTheDocument();
    expect(screen.getByText("No downtime logged yet. Use the form above to log some.")).toBeInTheDocument();
  });
});

describe("Logging downtime", () => {
  it("writes through the Journal's own route, with the picked character page attached", async () => {
    const user = userEvent.setup();
    renderDowntime();

    await user.click(screen.getByRole("combobox", { name: "Who spent the time" }));
    await user.click(await screen.findByRole("option", { name: /Vex/ }));
    await user.type(screen.getByLabelText("Activity"), "Forging a blade");
    await user.click(screen.getByRole("button", { name: "Log downtime" }));

    await waitFor(() => expect(createDowntime).toHaveBeenCalled());
    const [, body] = createDowntime.mock.calls[0];
    // `who` carries the page title so readers without the page still have a name.
    expect(body.downtime).toMatchObject({ who: "Vex", activity: "Forging a blade", days: 7, characterPageId: "c1" });
    // Creates carry an idempotency key (double-tap on a phone).
    expect(body.commandId).toEqual(expect.any(String));
  });

  it("takes a free-text name for someone who has no page", async () => {
    const user = userEvent.setup();
    renderDowntime();

    await user.type(screen.getByRole("combobox", { name: "Who spent the time" }), "Vex the Bold{Enter}");
    await user.click(screen.getByRole("button", { name: "Log downtime" }));

    await waitFor(() => expect(createDowntime).toHaveBeenCalled());
    expect(createDowntime.mock.calls[0][1].downtime).toMatchObject({ who: "Vex the Bold" });
    expect(createDowntime.mock.calls[0][1].downtime.characterPageId).toBeUndefined();
  });

  it("refuses to log nobody, and says the date it is proposing before anything moves", () => {
    renderDowntime();
    expect(screen.getByRole("button", { name: "Log downtime" })).toBeDisabled();
    // Hammer 10 + 7 = Hammer 17, stated as a proposal.
    expect(screen.getByText(/Hammer 17, 1491 DR/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing moves until you confirm it below/)).toBeInTheDocument();
  });

  it("the note is the shared editor, so a downtime note can link to the world", async () => {
    const user = userEvent.setup();
    renderDowntime();

    // The toolbar shows it's the shared editor, beyond a bare Textarea.
    const editors = screen.getAllByRole("toolbar", { name: "Formatting" });
    expect(editors).toHaveLength(1);
    await user.type(screen.getByLabelText("Note"), "Worked with [[[[Ire");
    const list = await screen.findByRole("listbox", { name: "Link to page" });
    expect(within(list).getByRole("option", { name: "Ireena" })).toBeInTheDocument();
  });
});

describe("Pending confirmations", () => {
  it("lists only what is unconfirmed, and names the consequence on the button", () => {
    renderDowntime({
      records: [
        downtime("d1", { who: "Vex", activity: "Forging", days: 7, applied: false }),
        downtime("d2", { who: "Ireena", activity: "Praying", days: 2, applied: true })
      ]
    });

    const pending = within(document.querySelector(".codex-downtime-pending")!);
    expect(pending.getAllByRole("listitem")).toHaveLength(1);
    expect(pending.getByText("Vex · Forging · 7 days")).toBeInTheDocument();
    // The button names the landing date where it could say "Confirm".
    expect(pending.getByRole("button", { name: /^Move your date to Hammer 17, 1491 DR/ })).toBeInTheDocument();
  });

  it("warns when confirming would step past a deadline the party has not seen fall", () => {
    const deadline = {
      ...downtime("dl", { who: "", activity: "", days: 0, applied: false }),
      id: "dl",
      kind: "deadline",
      payload: null,
      inWorldDate: { year: 1491, month: 0, day: 14 },
      calendarInstant: 44743
    } as unknown as CodexChronicleRecord;
    renderDowntime({
      records: [downtime("d1", { who: "Vex", activity: "Forging", days: 7, applied: false }), deadline]
    });

    // Hammer 14 falls between the clock (10) and the proposal (17).
    expect(screen.getByRole("button", { name: /passes 1 deadline/ })).toBeInTheDocument();
  });

  it("confirms through the apply route and reports failure rather than swallowing it", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    renderDowntime({
      onChanged,
      records: [downtime("d1", { who: "Vex", activity: "Forging", days: 7, applied: false })]
    });

    await user.click(screen.getByRole("button", { name: /^Move your date to/ }));
    await waitFor(() => expect(applyDowntime).toHaveBeenCalledWith("gm", "d1"));
    expect(onChanged).toHaveBeenCalled();

    applyDowntime.mockRejectedValueOnce(new Error("Couldn't move the clock."));
    await user.click(screen.getByRole("button", { name: /^Move your date to/ }));
    expect(await screen.findByText("Couldn't move the clock.")).toBeInTheDocument();
  });

  /** Both failure branches show their reason in view: no campaign date (prevented) and already applied (409). */
  it("`5e.4`: with no campaign date, says why in view and does not fire a request it knows will fail", async () => {
    const user = userEvent.setup();
    renderDowntime({
      // No current date: nothing to advance from.
      calendar: { ...CALENDAR, currentDate: null, publishedDate: null },
      records: [
        {
          ...downtime("d1", { who: "Vex", activity: "Forging", days: 7, applied: false }),
          proposedDate: null
        } as CodexChronicleRecord
      ]
    });

    // Found by heading, since the claim is that the reason sits beside the control.
    const pending = within(screen.getByRole("heading", { name: "Pending confirmations" }).closest("section")!);
    const confirm = pending.getByRole("button", { name: "Confirm" });
    expect(confirm).toBeDisabled();
    expect(pending.getByText(/Set your date on the Calendar before passing time/)).toBeInTheDocument();

    await user.click(confirm);
    expect(applyDowntime).not.toHaveBeenCalled();
  });

  it("`5e.4`: renders a stale-page conflict on the row that was pressed, and refetches", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    renderDowntime({
      onChanged,
      records: [
        downtime("d1", { who: "Vex", activity: "Forging", days: 7, applied: false }),
        downtime("d2", { who: "Ireena", activity: "Praying", days: 3, applied: false })
      ]
    });

    // 409: already applied elsewhere, so this list is stale.
    applyDowntime.mockRejectedValueOnce(new Error("That downtime has already passed - the clock has already moved."));
    const rows = within(document.querySelector(".codex-downtime-pending")!).getAllByRole("listitem");
    await user.click(within(rows[0]).getByRole("button", { name: /^Move your date to/ }));

    // On the pressed row only.
    expect(await within(rows[0]).findByText(/already passed/)).toBeInTheDocument();
    expect(within(rows[1]).queryByText(/already passed/)).toBeNull();
    // The refetch is the repair, so it runs on failure too.
    expect(onChanged).toHaveBeenCalled();
  });
});

describe("Adopting an old row (the Edit path)", () => {
  it("points a free-text row at a character page, and never offers to edit the days", async () => {
    const user = userEvent.setup();
    renderDowntime({ records: [downtime("d1", { who: "vex", activity: "Forging", days: 7, applied: true })] });

    expect(screen.getByText("Not linked")).toBeInTheDocument();
    // Scoped to the history list: the composer's editor also has an "Edit" switch.
    const history = within(document.querySelector(".codex-downtime-history")!);
    await user.click(history.getByRole("button", { name: "Edit" }));

    // Days are what the clock already moved by, so the row edit doesn't offer them.
    expect(history.queryByLabelText("Days")).toBeNull();
    expect(
      history.getByText("Days cannot be changed after logging. Delete the entry and log it again to correct it.")
    ).toBeInTheDocument();

    await user.click(history.getByRole("combobox", { name: "Link to a character page" }));
    await user.click(await screen.findByRole("option", { name: /Vex/ }));
    await user.click(history.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][2].downtime).toMatchObject({ who: "vex", activity: "Forging", characterPageId: "c1" });
  });

  it("offers only character pages as the link target", async () => {
    const user = userEvent.setup();
    renderDowntime();

    await user.click(screen.getByRole("combobox", { name: "Who spent the time" }));
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    // Locations are excluded.
    expect(options).toEqual(["Vex", "Ireena"]);
  });
});

/** `Combobox` truncates at 8 by default; both tests browse without typing, which is where truncation bites. */
describe("A party bigger than the Combobox's default page", () => {
  // Nine characters (one past the default cap) plus a location that must be excluded.
  const NAMES = ["Ana", "Bo", "Cass", "Dain", "Eda", "Finn", "Gale", "Hex", "Ivy"];
  const NINE = [...NAMES.map((name, index) => page(`c${index + 1}`, name)), page("l1", "Vallaki", "location")];

  it("offers every character, not the first eight", async () => {
    const user = userEvent.setup();
    renderDowntime({ pages: NINE });

    await user.click(screen.getByRole("combobox", { name: "Who spent the time" }));
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual(NAMES);
    // "Ivy" is the one the default cap would drop.
    expect(options).toContain("Ivy");
  });

  it("logs downtime against the ninth character, linked to its page", async () => {
    const user = userEvent.setup();
    renderDowntime({ pages: NINE });

    await user.click(screen.getByRole("combobox", { name: "Who spent the time" }));
    await user.click(await screen.findByRole("option", { name: "Ivy" }));
    await user.type(screen.getByLabelText("Activity"), "Scouting");
    await user.click(screen.getByRole("button", { name: "Log downtime" }));

    await waitFor(() => expect(createDowntime).toHaveBeenCalled());
    expect(createDowntime.mock.calls[0][1].downtime).toMatchObject({ who: "Ivy", characterPageId: "c9" });
  });

  it("lets the edit row link an old entry to the ninth character", async () => {
    const user = userEvent.setup();
    renderDowntime({
      pages: NINE,
      records: [downtime("d1", { who: "ivy", activity: "Scouting", days: 4, applied: true })]
    });

    const history = within(document.querySelector(".codex-downtime-history")!);
    await user.click(history.getByRole("button", { name: "Edit" }));
    await user.click(history.getByRole("combobox", { name: "Link to a character page" }));

    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual(NAMES);

    // The edit row has no free-text escape, so Ivy must be listed.
    await user.click(screen.getByRole("option", { name: "Ivy" }));
    await user.click(history.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][2].downtime).toMatchObject({ who: "ivy", characterPageId: "c9" });
  });
});

describe("The player's Downtime", () => {
  const PLAYER_ROWS = [
    {
      id: "d1",
      kind: "downtime" as const,
      title: null,
      text: "",
      tags: [],
      realDate: null,
      inWorldLabel: "Hammer 3, 1491 DR",
      calendarInstant: 44732,
      sessionId: null,
      sessionNumber: null,
      createdAt: "2026-07-31T00:00:00.000Z",
      payload: { who: "Vex", activity: "Forging", days: 7, characterPageId: "c1" }
    }
  ];

  it("has no Pending section, by construction and with no role check", () => {
    render(
      <PlayerDowntimeView
        records={PLAYER_ROWS as never}
        pages={[{ id: "c1", title: "Vex" }]}
        onOpenEntry={vi.fn()}
        onOpenPage={vi.fn()}
      />
    );

    // `applied` isn't on the player payload, so there is no Pending section or Confirm.
    expect(screen.queryByText("Pending confirmations")).toBeNull();
    expect(screen.queryByRole("button", { name: /Confirm|Move your date to/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByText("Log downtime")).toBeNull();
    expect(screen.getByRole("rowheader", { name: "Vex" })).toBeInTheDocument();
  });

  it("says nothing has happened yet rather than rendering an empty table", () => {
    render(<PlayerDowntimeView records={[]} pages={[]} onOpenEntry={vi.fn()} onOpenPage={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "No downtime yet" })).toBeInTheDocument();
  });
});

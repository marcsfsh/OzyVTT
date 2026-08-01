import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * D12 — the Downtime tracker, and the owed test for it.
 *
 * The tracker is **a lens over the Journal, never a second store** (invariant 7): every row on it is a
 * `downtime` chronicle record the Journal already carries, and there is deliberately no aggregation
 * endpoint. So the things worth pinning are the ones a lens can still get wrong.
 *
 * **Totals group by `characterPageId ?? who`** — the whole point of D12's new field. Before it, "Vex",
 * "vex" and "Vex the Bold" were three people; a linked row must total with its page whatever its `who`
 * string says, and an unlinked row must still total by name. The **Edit** action is the adoption path for
 * everything recorded before the field existed, and it must not offer to edit `days` (the clock has
 * already moved by them).
 *
 * **Confirming states its consequence in words** — the date the clock will move to, and how many
 * deadlines that passes — because the confirm is what actually advances the campaign's date.
 *
 * **D13: the note is the shared editor**, not a bare `Textarea`. It was the last writing surface in the
 * suite that was not, which meant typing `[[` here silently did nothing while the identical write
 * through the Journal composer linked pages properly.
 */

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
import type { CodexChronicleRecord, CodexPageSummary, GmCodexCalendar } from "./api";

const CALENDAR: GmCodexCalendar = {
  yearName: "DR",
  months: [{ name: "Hammer", days: 30 }, { name: "Alturiak", days: 30 }],
  weekdays: ["Sul", "Mol"],
  currentDate: { year: 1491, month: 0, day: 10 },
  publishedDate: { year: 1491, month: 0, day: 10 }
};

const page = (id: string, title: string, entityType: CodexPageSummary["entityType"] = "character"): CodexPageSummary => ({
  id, title, entityType, fields: {}, folder: null, tags: [], revealedToPlayers: true, bannerAssetId: null,
  inWorldDate: null, inWorldLabel: null, calendarInstant: null,
  rev: 1, createdAt: "2026-07-31T00:00:00.000Z", updatedAt: "2026-07-31T00:00:00.000Z"
});

const downtime = (id: string, payload: Readonly<{ who: string; activity: string; days: number; applied: boolean; characterPageId?: string | null }>): CodexChronicleRecord => ({
  id, kind: "downtime", title: null, text: "", playerText: "", gmText: "", tags: [], revealedToPlayers: false,
  sessionId: null, sessionNumber: null, realDate: null, inWorldDate: null, inWorldLabel: "Hammer 3, 1491 DR",
  calendarInstant: null, proposedDate: { year: 1491, month: 0, day: 17 }, attachPageId: null, attachMarkerId: null, archiveId: null,
  payload: { characterPageId: null, ...payload },
  createdAt: "2026-07-31T00:00:00.000Z"
} as unknown as CodexChronicleRecord);

const PAGES = [page("c1", "Vex"), page("c2", "Ireena"), page("l1", "Vallaki", "location")];

const renderDowntime = (over: Partial<React.ComponentProps<typeof DowntimeView>> = {}) => {
  const props = {
    gmToken: "gm", records: [] as readonly CodexChronicleRecord[], calendar: CALENDAR, pages: PAGES,
    loading: false, error: null, onChanged: vi.fn(), onOpenEntry: vi.fn(), onOpenPage: vi.fn(), ...over
  };
  return { props, ...render(<DowntimeView {...props} />) };
};

beforeEach(() => {
  createDowntime.mockResolvedValue(undefined);
  applyDowntime.mockResolvedValue(undefined);
  update.mockResolvedValue(undefined);
});

describe("Totals — a person, not a spelling (D12)", () => {
  it("groups a linked row with its page however its `who` string is spelled", () => {
    renderDowntime({
      records: [
        downtime("d1", { who: "Vex", activity: "Forging", days: 7, applied: true, characterPageId: "c1" }),
        downtime("d2", { who: "vex the bold", activity: "Carousing", days: 3, applied: true, characterPageId: "c1" }),
        downtime("d3", { who: "Ireena", activity: "Praying", days: 2, applied: true })
      ]
    });

    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    // Two people, not three — and the linked one is named by its PAGE, not by either string.
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

    // The free-text name survives — D12 preserves it deliberately, so a table with no character pages
    // still tracks people.
    expect(screen.getByRole("rowheader", { name: "The party" })).toBeInTheDocument();
    // A linked name is a way INTO the page; an unlinked one is plain text with nothing to open.
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
    // The page id is what makes the totals a person; `who` carries the page's TITLE so an old reader
    // (and the player projection) still has a name to print.
    expect(body.downtime).toMatchObject({ who: "Vex", activity: "Forging a blade", days: 7, characterPageId: "c1" });
    // A create is the write worth an idempotency key — this button is double-tappable on a phone.
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
    // Seven days from Hammer 10 is Hammer 17 — stated up front, and stated as a proposal.
    expect(screen.getByText(/Hammer 17, 1491 DR/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing moves until you confirm it below/)).toBeInTheDocument();
  });

  it("D13: the note is the shared editor, so a downtime note can link to the world", async () => {
    const user = userEvent.setup();
    renderDowntime();

    // The toolbar is the tell — a bare `Textarea` has none of it.
    const editors = screen.getAllByRole("toolbar", { name: "Formatting" });
    expect(editors).toHaveLength(1);
    // …and the `[[` autocomplete offers the campaign's pages, which is the capability D13 exists for.
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
    // The button says what confirming DOES — the date the clock lands on — rather than "Confirm".
    expect(pending.getByRole("button", { name: /^Move your date to Hammer 17, 1491 DR/ })).toBeInTheDocument();
  });

  it("warns when confirming would step past a deadline the party has not seen fall", () => {
    const deadline = {
      ...downtime("dl", { who: "", activity: "", days: 0, applied: false }),
      id: "dl", kind: "deadline", payload: null,
      inWorldDate: { year: 1491, month: 0, day: 14 }, calendarInstant: 44743
    } as unknown as CodexChronicleRecord;
    renderDowntime({ records: [downtime("d1", { who: "Vex", activity: "Forging", days: 7, applied: false }), deadline] });

    // Hammer 14 falls between the clock (10) and the proposal (17) — the count is on the button, because
    // this is the tap that would silently fire it.
    expect(screen.getByRole("button", { name: /passes 1 deadline/ })).toBeInTheDocument();
  });

  it("confirms through the apply route and reports failure rather than swallowing it", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    renderDowntime({ onChanged, records: [downtime("d1", { who: "Vex", activity: "Forging", days: 7, applied: false }) ] });

    await user.click(screen.getByRole("button", { name: /^Move your date to/ }));
    await waitFor(() => expect(applyDowntime).toHaveBeenCalledWith("gm", "d1"));
    expect(onChanged).toHaveBeenCalled();

    applyDowntime.mockRejectedValueOnce(new Error("Couldn't move the clock."));
    await user.click(screen.getByRole("button", { name: /^Move your date to/ }));
    expect(await screen.findByText("Couldn't move the clock.")).toBeInTheDocument();
  });
});

describe("Adopting an old row (the Edit path)", () => {
  it("points a free-text row at a character page, and never offers to edit the days", async () => {
    const user = userEvent.setup();
    renderDowntime({ records: [downtime("d1", { who: "vex", activity: "Forging", days: 7, applied: true })] });

    expect(screen.getByText("Not linked")).toBeInTheDocument();
    // Scoped to the history list: since D13 the composer's shared editor has an Edit/View switch, so
    // "Edit" is no longer unique on this screen.
    const history = within(document.querySelector(".codex-downtime-history")!);
    await user.click(history.getByRole("button", { name: "Edit" }));

    // Days are what the clock has already moved by; a "typo" there would desynchronise the campaign date
    // from its own history, so the ROW says so instead of offering the field. (The composer above still
    // has its own Days field — this is about the row being edited.)
    expect(history.queryByLabelText("Days")).toBeNull();
    expect(history.getByText("Days cannot be changed after logging. Delete the entry and log it again to correct it.")).toBeInTheDocument();

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
    // Vallaki is a location; linking downtime to it would make the totals meaningless.
    expect(options).toEqual(["Vex", "Ireena"]);
  });
});

describe("The player's Downtime (D12/D14)", () => {
  const PLAYER_ROWS = [
    { id: "d1", kind: "downtime" as const, title: null, text: "", tags: [], realDate: null, inWorldLabel: "Hammer 3, 1491 DR", calendarInstant: 44732, sessionId: null, sessionNumber: null, createdAt: "2026-07-31T00:00:00.000Z", payload: { who: "Vex", activity: "Forging", days: 7, characterPageId: "c1" } }
  ];

  it("has no Pending section — by construction, not by a role check", () => {
    render(<PlayerDowntimeView records={PLAYER_ROWS as never} pages={[{ id: "c1", title: "Vex" }]} onOpenEntry={vi.fn()} onOpenPage={vi.fn()} />);

    // `applied` is a GM-payload field with no player equivalent, so this component could not render a
    // pending row even if it tried — and there is no Confirm anywhere on it.
    expect(screen.queryByText("Pending confirmations")).toBeNull();
    expect(screen.queryByRole("button", { name: /Confirm|Move your date to/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByText("Log downtime")).toBeNull();
    // What they DO get is the same lens: their totals and their history.
    expect(screen.getByRole("rowheader", { name: "Vex" })).toBeInTheDocument();
  });

  it("says nothing has happened yet rather than rendering an empty table", () => {
    render(<PlayerDowntimeView records={[]} pages={[]} onOpenEntry={vi.fn()} onOpenPage={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "No downtime yet" })).toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * `5a` + `5e.3` — the two "who" fields are bound to the characters that exist.
 *
 * They are ONE design and two mechanisms, and both halves are pinned here because the temptation is to
 * make them one component and the primitives already made that unnecessary:
 *   - "Who played" collects SEVERAL names, so it is `TagInput pick` — a visible chooser over the same
 *     open list, with its own limit already defeating `Combobox`'s default page of 8;
 *   - downtime's "Who" holds ONE, so it stays the `Combobox` it already was and gains `meta`.
 *
 * **Three things must not move**, and each has its own test below.
 *   1. *Archived last, and said out loud.* "Archived" is a TABLE flag (`Actor.archived`) that a Codex
 *      page does not carry, so the join is by name — and a campaign with no table state must get the
 *      list it always got, in the order it always got it.
 *   2. *The wire shape.* `attendees` stays `readonly string[]` of NAMES. It is GM-only in the
 *      projection (`codex-projections.ts`), and page ids would be both a migration and a new shape on
 *      a record that never needed one.
 *   3. *Still open.* Both fields take a name the campaign has never heard of — a guest at the table,
 *      a hireling nobody made a page for.
 */

const update = vi.fn();
const createDowntime = vi.fn();

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    sessionApi: { ...actual.sessionApi, update: (...a: unknown[]) => update(...a) },
    journalApi: { ...actual.journalApi, createDowntime: (...a: unknown[]) => createDowntime(...a) }
  };
});

import { charactersFor } from "./characters";
import { DowntimeView } from "./DowntimeView";
import { SessionsView } from "./SessionsView";
import type { CodexPageSummary, CodexSession, GmCodexCalendar } from "./api";

const page = (id: string, title: string, entityType: CodexPageSummary["entityType"] = "character"): CodexPageSummary => ({
  id, title, entityType, fields: {}, folder: null, tags: [], revealedToPlayers: true, bannerAssetId: null,
  inWorldDate: null, inWorldLabel: null, calendarInstant: null,
  rev: 1, createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z"
});

// Vallaki is a location and must never be offered; Ireena is retired at the table, Ozy is not.
const PAGES = [page("c1", "Ireena"), page("c2", "Ozy"), page("c3", "Ismark"), page("l1", "Vallaki", "location")];
const ACTORS = [
  { id: "a1", name: "Ireena", archived: true, kind: "npc" },
  { id: "a2", name: "Ozy", archived: false, kind: "player-character" },
  { id: "a3", name: "Ismark", archived: false, kind: "npc" }
];

const CALENDAR: GmCodexCalendar = {
  yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: ["Sul"],
  currentDate: { year: 1491, month: 0, day: 10 }, publishedDate: null
};

const SESSION: CodexSession = {
  id: "s1", sessionNumber: 3, tags: [], realDate: "2026-07-12", attendees: [],
  prepBody: "", recapBody: "", revealedToPlayers: false, status: "planned", rev: 1,
  createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z"
};

const renderSessions = (over: Partial<React.ComponentProps<typeof SessionsView>> = {}) =>
  render(<SessionsView gmToken="gm" sessions={[SESSION]} activeSessionId={null} loading={false} error={null}
    openSessionId="s1" onOpenSession={vi.fn()} onChanged={vi.fn()}
    autosave={{ enabled: false, intervalSeconds: 1 }} pages={PAGES} actors={ACTORS} {...over} />);

const renderDowntime = (over: Partial<React.ComponentProps<typeof DowntimeView>> = {}) =>
  render(<DowntimeView gmToken="gm" records={[]} calendar={CALENDAR} pages={PAGES} actors={ACTORS}
    loading={false} error={null} onChanged={vi.fn()} onOpenEntry={vi.fn()} onOpenPage={vi.fn()} {...over} />);

describe("the rule underneath both fields (characters.ts)", () => {
  it("puts archived characters last and leaves the active order alone", () => {
    expect(charactersFor(PAGES, ACTORS).map((option) => `${option.title}${option.archived ? "*" : ""}`))
      .toEqual(["Ozy", "Ismark", "Ireena*"]);
  });

  it("treats a campaign with no table state as all-active, in page order", () => {
    // The Codex is usable on its own. With no actors the list must be byte-identical to the one these
    // pickers already offered, or this change is a regression for every table that never archives.
    expect(charactersFor(PAGES).map((option) => option.title)).toEqual(["Ireena", "Ozy", "Ismark"]);
    expect(charactersFor(PAGES).every((option) => !option.archived)).toBe(true);
  });

  it("will not let a monster archive the character page it shares a name with", () => {
    const options = charactersFor(PAGES, [{ name: "Ozy", archived: true, kind: "monster" }]);
    expect(options.find((option) => option.title === "Ozy")?.archived).toBe(false);
  });

  it("matches on the name a human typed, not on an exact string", () => {
    const options = charactersFor(PAGES, [{ name: "  ireena ", archived: true, kind: "npc" }]);
    expect(options.find((option) => option.title === "Ireena")?.archived).toBe(true);
  });
});

describe("`5a` — Who played", () => {
  it("offers the campaign's characters, archived last and marked", async () => {
    const user = userEvent.setup();
    renderSessions();

    await user.click(screen.getByRole("combobox", { name: "Who played" }));
    // Scoped to the chooser's own listbox: the rail's status filter and the editor's Status are
    // `<select>`s, and their `<option>`s carry the same ARIA role.
    const list = within(await screen.findByRole("listbox", { name: "Who played" }));
    expect(list.getAllByRole("option").map((option) => option.textContent))
      .toEqual(["Ozy", "Ismark", "Ireena — Archived"]);
  });

  it("stores the NAME, not the page id and not the marked-up label", async () => {
    const user = userEvent.setup();
    renderSessions();

    await user.click(screen.getByRole("combobox", { name: "Who played" }));
    const list = within(await screen.findByRole("listbox", { name: "Who played" }));
    await user.click(list.getByRole("option", { name: "Ireena — Archived" }));

    // The chip — and therefore the value that travels — is the plain name. `optionLabel` is display only.
    expect(within(document.querySelector(".nh-taginput-tags")!).getByText("Ireena")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(update.mock.calls[0][2].attendees).toEqual(["Ireena"]);
  });

  it("still takes a guest the campaign has no page for", async () => {
    const user = userEvent.setup();
    renderSessions();

    // Enter on unmatched text is `Combobox allowFreeText`, which `TagInput pick` passes through — the
    // field is a chooser now, and it is still open.
    await user.type(screen.getByRole("combobox", { name: "Who played" }), "Garrett P.{Enter}");
    await user.click(screen.getByRole("button", { name: "Save" }));
    // …and the name survives verbatim: `normalize` is overridden here so it is not slugified to "garrett-p".
    expect(update.mock.calls[0][2].attendees).toEqual(["Garrett P."]);
  });

  it("does not offer a character already listed", async () => {
    const user = userEvent.setup();
    renderSessions({ sessions: [{ ...SESSION, attendees: ["Ozy"] }] });

    await user.click(screen.getByRole("combobox", { name: "Who played" }));
    const list = within(await screen.findByRole("listbox", { name: "Who played" }));
    expect(list.getAllByRole("option").map((option) => option.textContent))
      .toEqual(["Ismark", "Ireena — Archived"]);
  });
});

describe("`5e.3` — downtime's Who", () => {
  it("offers the same list in the same order, with the same word for archived", async () => {
    const user = userEvent.setup();
    renderDowntime();

    await user.click(screen.getByRole("combobox", { name: "Who spent the time" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Ozy", "Ismark", "IreenaArchived"]);
    // The marker is a muted `meta` span, not part of the name — `Combobox` renders it separately.
    expect(within(options[2]).getByText("Archived")).toHaveClass("nh-combobox-optionmeta");
  });

  it("keeps `characterPageId` when an archived character is picked (D12's totals depend on it)", async () => {
    const user = userEvent.setup();
    renderDowntime();

    await user.click(screen.getByRole("combobox", { name: "Who spent the time" }));
    await user.click((await screen.findAllByRole("option"))[2]);
    await user.type(screen.getByLabelText("Activity"), "Resting");
    await user.click(screen.getByRole("button", { name: "Log downtime" }));

    expect(createDowntime.mock.calls[0][1].downtime).toMatchObject({ who: "Ireena", characterPageId: "c1" });
  });

  it("marks the archived option on the edit row's link picker too", async () => {
    const user = userEvent.setup();
    renderDowntime({
      records: [{
        id: "d1", kind: "downtime", title: null, text: "", playerText: "", gmText: "", tags: [],
        revealedToPlayers: false, sessionId: null, sessionNumber: null, realDate: null, inWorldDate: null,
        inWorldLabel: "Hammer 3, 1491 DR", calendarInstant: null, proposedDate: null, attachPageId: null,
        attachMarkerId: null, archiveId: null, createdAt: "2026-08-08T00:00:00.000Z",
        payload: { who: "ireena", activity: "Resting", days: 3, applied: true, characterPageId: null }
      }] as never
    });

    const history = within(document.querySelector(".codex-downtime-history")!);
    await user.click(history.getByRole("button", { name: "Edit" }));
    await user.click(history.getByRole("combobox", { name: "Link to a character page" }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent))
      .toEqual(["Ozy", "Ismark", "IreenaArchived"]);
  });
});

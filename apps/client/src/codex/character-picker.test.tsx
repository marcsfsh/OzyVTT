import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The two "who" fields offer existing characters: "Who played" via `TagInput pick` (several names) and
 * downtime's "Who" via `Combobox` (one). Archived characters come last and marked (joined by name; no table
 * state means the plain list). `attendees` stays an array of names. Both fields still accept a new name.
 */

const update = vi.hoisted(() => vi.fn());
const createDowntime = vi.hoisted(() => vi.fn());

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    journalApi: { ...actual.journalApi, createDowntime, chronicle: vi.fn(async () => []) },
    calendarApi: { ...actual.calendarApi, get: vi.fn(async () => null) }
  };
});
vi.mock("./prep/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./prep/api")>();
  return { ...actual, prepSessionApi: { ...actual.prepSessionApi, update } };
});

import { charactersFor } from "./characters";
import { gmRecord, renderGmStory } from "./story/harness";
import { GmSessionsSection, GmStorySection } from "./story/sections";
import type { CodexChronicleRecord, CodexPageSummary, CodexSession, GmCodexCalendar } from "@vtt/domain";

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
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt: "2026-08-08T00:00:00.000Z",
  playerUpdatedAt: "2026-08-08T00:00:00.000Z",
  firstShownAt: null
});

// Vallaki is a location and is never offered; Ireena is archived at the table, Ozy is not.
const PAGES = [page("c1", "Ireena"), page("c2", "Ozy"), page("c3", "Ismark"), page("l1", "Vallaki", "location")];
const ACTORS = [
  { id: "a1", name: "Ireena", archived: true, kind: "npc" },
  { id: "a2", name: "Ozy", archived: false, kind: "player-character" },
  { id: "a3", name: "Ismark", archived: false, kind: "npc" }
];

const CALENDAR: GmCodexCalendar = {
  yearName: "DR",
  eras: [],
  months: [{ name: "Hammer", days: 30 }],
  weekdays: ["Sul"],
  currentDate: { year: 1491, month: 0, day: 10 },
  publishedDate: null
};

const SESSION = {
  id: "s1",
  sessionNumber: 3,
  tags: [],
  realDate: "2026-07-12",
  attendees: [],
  prepBody: "",
  prep: [],
  prepTemplateId: null,
  currentSceneId: null,
  recapBody: "",
  revealedToPlayers: false,
  status: "planned",
  sceneIds: [],
  rev: 1,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
} as CodexSession;

/** The session's details dialog, where Who played lives; it saves when it closes. */
const renderSessions = async (sessions: readonly CodexSession[] = [SESSION]) => {
  update.mockResolvedValue({ ...SESSION, rev: 2 });
  renderGmStory(GmSessionsSection, "/codex/sessions/s1", { sessions, pages: PAGES, actors: ACTORS });
  const user = userEvent.setup();
  // The options menu is a details and summary pair, so its trigger is found by its name.
  await user.click(await screen.findByLabelText("Session 3 options"));
  await user.click(await screen.findByRole("menuitem", { name: "Edit details" }));
  return user;
};
const closeDetails = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Done" }));

/** The chronicle's composer on Downtime, where downtime's Who lives. */
const renderDowntime = async (records: readonly CodexChronicleRecord[] = []) => {
  createDowntime.mockResolvedValue({});
  renderGmStory(GmStorySection, "/codex/story", { records, calendar: CALENDAR, pages: PAGES, actors: ACTORS });
  return userEvent.setup();
};
const openDowntimeComposer = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Add to the chronicle" }));
  await user.click(await screen.findByRole("button", { name: "Downtime" }));
};
const listedOptions = async () =>
  within(await screen.findByRole("listbox"))
    .getAllByRole("option")
    .map((option) => option.textContent);

describe("the rule underneath both fields (characters.ts)", () => {
  it("puts archived characters last and leaves the active order alone", () => {
    expect(charactersFor(PAGES, ACTORS).map((option) => `${option.title}${option.archived ? "*" : ""}`)).toEqual([
      "Ozy",
      "Ismark",
      "Ireena*"
    ]);
  });

  it("treats a campaign with no table state as all-active, in page order", () => {
    // With no actors, the list is unchanged.
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

describe("`5a`: Who played", () => {
  it("offers the campaign's characters, archived last and marked", async () => {
    const user = await renderSessions();

    await user.click(screen.getByRole("combobox", { name: "Who played" }));
    // Scoped to the chooser's listbox: the `<select>` options share the role.
    const list = within(await screen.findByRole("listbox", { name: "Who played" }));
    expect(list.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Ozy",
      "Ismark",
      "Ireena · Archived"
    ]);
  });

  it("stores the NAME, not the page id and not the marked-up label", async () => {
    const user = await renderSessions();

    await user.click(screen.getByRole("combobox", { name: "Who played" }));
    const list = within(await screen.findByRole("listbox", { name: "Who played" }));
    await user.click(list.getByRole("option", { name: "Ireena · Archived" }));

    // The stored value is the plain name; `optionLabel` is display only.
    expect(within(document.querySelector(".nh-taginput-tags")!).getByText("Ireena")).toBeInTheDocument();
    await closeDetails(user);
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls.at(-1)![2].attendees).toEqual(["Ireena"]);
  });

  it("still takes a guest the campaign has no page for", async () => {
    const user = await renderSessions();

    // Unmatched text still commits: the field stays open.
    await user.type(screen.getByRole("combobox", { name: "Who played" }), "Garrett P.{Enter}");
    await closeDetails(user);
    await waitFor(() => expect(update).toHaveBeenCalled());
    // Not slugified.
    expect(update.mock.calls.at(-1)![2].attendees).toEqual(["Garrett P."]);
  });

  it("does not offer a character already listed", async () => {
    const user = await renderSessions([{ ...SESSION, attendees: ["Ozy"] }]);

    await user.click(screen.getByRole("combobox", { name: "Who played" }));
    const list = within(await screen.findByRole("listbox", { name: "Who played" }));
    expect(list.getAllByRole("option").map((option) => option.textContent)).toEqual(["Ismark", "Ireena · Archived"]);
  });
});

describe("`5e.3`: downtime's Who", () => {
  it("offers the same list in the same order, with the same word for archived", async () => {
    const user = await renderDowntime();
    await openDowntimeComposer(user);

    await user.click(screen.getByRole("combobox", { name: "Who spent the time" }));
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Ozy", "Ismark", "IreenaArchived"]);
    // A separate muted `meta` span, outside the name.
    expect(within(options[2]).getByText("Archived")).toHaveClass("nh-combobox-optionmeta");
  });

  it("keeps `characterPageId` when an archived character is picked (D12's totals depend on it)", async () => {
    const user = await renderDowntime();
    await openDowntimeComposer(user);

    await user.click(screen.getByRole("combobox", { name: "Who spent the time" }));
    await user.click(within(await screen.findByRole("listbox")).getAllByRole("option")[2]);
    await user.type(screen.getByLabelText("Activity"), "Resting");
    await user.click(
      within(screen.getByRole("dialog", { name: "Add to the chronicle" })).getByRole("button", { name: "Log downtime" })
    );

    await waitFor(() => expect(createDowntime).toHaveBeenCalled());
    expect(createDowntime.mock.calls[0][1].downtime).toMatchObject({ who: "Ireena", characterPageId: "c1" });
  });

  it("marks the archived option on the edit row's link picker too", async () => {
    const user = await renderDowntime([
      gmRecord({
        id: "d1",
        kind: "downtime",
        text: "",
        payload: { who: "ireena", activity: "Resting", days: 3, applied: true, characterPageId: null }
      })
    ]);
    const card = within(screen.getByRole("region", { name: "Downtime" }));
    await user.click(card.getByText("Link a row to a character"));
    await user.click(card.getByRole("button", { name: "Link" }));
    await user.click(card.getByRole("combobox", { name: "Link to a character page" }));
    expect(await listedOptions()).toEqual(["Ozy", "Ismark", "IreenaArchived"]);
  });
});

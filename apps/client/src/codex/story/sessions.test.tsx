import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const api = vi.hoisted(() => ({
  update: vi.fn(),
  get: vi.fn(),
  activate: vi.fn(),
  reveal: vi.fn(),
  remove: vi.fn(),
  chronicle: vi.fn(),
  calendar: vi.fn(),
  getPage: vi.fn(),
  templates: vi.fn(),
  createSession: vi.fn(),
  applyTemplate: vi.fn(),
  happened: vi.fn()
}));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    sessionApi: {
      ...actual.sessionApi,
      update: api.update,
      get: api.get,
      activate: api.activate,
      reveal: api.reveal,
      remove: api.remove
    },
    journalApi: { ...actual.journalApi, chronicle: api.chronicle },
    calendarApi: { ...actual.calendarApi, get: api.calendar }
  };
});
vi.mock("../api-records", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api-records")>();
  return { ...actual, pageRecordApi: { ...actual.pageRecordApi, get: api.getPage } };
});
vi.mock("../prep/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../prep/api")>();
  return {
    ...actual,
    templateApi: { ...actual.templateApi, list: api.templates },
    prepSessionApi: { create: api.createSession, applyTemplate: api.applyTemplate },
    liveApi: { ...actual.liveApi, happened: api.happened }
  };
});

import type { CodexPrepSection, CodexPrepTemplate, CodexSession, PlayerCodexSession } from "@vtt/domain";
import { GmSessionsSection, PlayerSessionsSection } from "./sections";
import { gmRecord, playerRecord, renderGmStory, renderPlayerStory } from "./harness";

/**
 * A session's page: made from a template, its prep edited as typed sections, and after play the recap step with
 * what happened beside the recap players read. Every write goes through the session's own routes.
 */

const TEMPLATE: CodexPrepTemplate = {
  id: "t1",
  name: "My session prep",
  builtIn: false,
  isDefault: true,
  sections: [],
  rev: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z"
};

const PREP: CodexPrepSection[] = [
  { id: "x1", type: "text", title: "Strong start", prompt: null, templateSectionId: null, text: "Fog on the quay." },
  {
    id: "x2",
    type: "scenes",
    title: "Scenes",
    prompt: null,
    templateSectionId: null,
    scenes: [{ id: "sc1", title: "The tower at night", placePageId: "p-tower", notes: "" }]
  },
  {
    id: "x3",
    type: "checklist",
    title: "Secrets and clues",
    prompt: null,
    templateSectionId: null,
    items: [
      {
        id: "c1",
        text: "Ysolde owes the Tidebound.",
        done: false,
        doneAt: null,
        link: { recordKind: "page", recordId: "p-ysolde", blockId: "b-debt" }
      }
    ]
  },
  { id: "x4", type: "pages", title: "Cast", prompt: null, templateSectionId: null, pageIds: ["p-ysolde"] }
];

const session = (id: string, sessionNumber: number, over: Partial<CodexSession> = {}): CodexSession =>
  ({
    id,
    sessionNumber,
    realDate: "2026-10-24",
    attendees: ["Lyra Emberwise", "Borin Stoneguard"],
    recapBody: "",
    status: "planned",
    tags: [],
    revealedToPlayers: false,
    prep: PREP,
    prepTemplateId: "t1",
    currentSceneId: null,
    encounterIds: [],
    rev: 3,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    firstShownAt: null,
    ...over
  }) as CodexSession;

const page = (id: string, title: string) => ({
  id,
  title,
  entityType: "character" as const,
  fields: {},
  hiddenFields: [],
  folder: null,
  tags: [],
  revealedToPlayers: true,
  bannerAssetId: null,
  inWorldDate: null,
  inWorldLabel: null,
  calendarInstant: null,
  rev: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  playerUpdatedAt: "2026-10-01T00:00:00.000Z",
  characterUpdatedAt: {},
  firstShownAt: null
});
const PAGES = [
  page("p-ysolde", "Ysolde Varn"),
  { ...page("p-tower", "Harbourmaster's Tower"), entityType: "location" as const }
];
const PARTY = [
  { id: "a-lyra", name: "Lyra Emberwise" },
  { id: "a-borin", name: "Borin Stoneguard" }
];

beforeEach(() => {
  localStorage.clear();
  for (const fn of Object.values(api)) fn.mockReset();
  api.chronicle.mockResolvedValue([]);
  api.calendar.mockResolvedValue(null);
  api.templates.mockResolvedValue({ templates: [TEMPLATE], defaultTemplateId: "t1" });
  api.getPage.mockResolvedValue({ page: { blocks: [{ id: "b-debt", title: "The debt" }] }, connections: [] });
  api.update.mockImplementation(async (_token: string, id: string, input: Partial<CodexSession>) =>
    session(id, 6, { ...input, rev: 4 } as Partial<CodexSession>)
  );
  api.happened.mockResolvedValue({ sessionId: "s6", entries: [], cluesTicked: [], reveals: [] });
  api.activate.mockResolvedValue("s7");
  api.reveal.mockResolvedValue(session("s5", 5));
});

const S5 = session("s5", 5, { status: "played", recapBody: "The party copied the ledger.", realDate: "2026-10-10" });
const S6 = session("s6", 6);
const S7 = session("s7", 7, { realDate: "2026-10-31", prep: [] });

describe("The session page", () => {
  it("opens on the active session, with its date, its players and the template it was made from", async () => {
    renderGmStory(GmSessionsSection, "/codex/sessions", {
      sessions: [S5, S6, S7],
      activeSessionId: "s6",
      pages: PAGES
    });
    const article = await screen.findByRole("article", { name: "Session 6" });
    expect(within(article).getByText("Active")).toBeInTheDocument();
    expect(within(article).getByText("Saturday, October 24 · Lyra Emberwise, Borin Stoneguard")).toBeInTheDocument();
    expect(await within(article).findByRole("button", { name: /Made from My session prep/ })).toBeInTheDocument();
  });

  it("edits the prep as typed sections and saves the whole list with the session's rev", async () => {
    const user = userEvent.setup();
    renderGmStory(GmSessionsSection, "/codex/sessions/s6", { sessions: [S6], activeSessionId: "s6", pages: PAGES });
    const start = await screen.findByRole("textbox", { name: "Strong start" });
    await user.type(start, " Two lanterns.");
    await waitFor(() => expect(api.update).toHaveBeenCalled(), { timeout: 3000 });
    const [, id, body] = api.update.mock.calls.at(-1)!;
    expect(id).toBe("s6");
    expect(body.expectedRev).toBe(3);
    expect(body.prep[0]).toMatchObject({ id: "x1", type: "text", text: "Fog on the quay. Two lanterns." });
    expect(body.prep).toHaveLength(4);
  });

  it("names a clue's hidden block by its title, read from the linked page", async () => {
    renderGmStory(GmSessionsSection, "/codex/sessions/s6", { sessions: [S6], pages: PAGES });
    expect(await screen.findByText("Ysolde Varn · The debt")).toBeInTheDocument();
    expect(api.getPage).toHaveBeenCalledWith("gm", "p-ysolde");
  });

  it("starts a planned session, which puts it on the table's Tonight tab", async () => {
    const user = userEvent.setup();
    renderGmStory(GmSessionsSection, "/codex/sessions/s7", { sessions: [S6, S7], activeSessionId: "s6", pages: PAGES });
    await user.click(await screen.findByRole("button", { name: "Start session 7" }));
    await waitFor(() => expect(api.activate).toHaveBeenCalledWith("gm", "s7"));
    expect(await screen.findByText("Session 7 is on the table's Tonight tab.")).toBeInTheDocument();
  });

  it("shares a played session's recap with players", async () => {
    const user = userEvent.setup();
    renderGmStory(GmSessionsSection, "/codex/sessions/s5", { sessions: [S5], pages: PAGES });
    await user.click(await screen.findByRole("button", { name: "Share the recap" }));
    await waitFor(() => expect(api.reveal).toHaveBeenCalledWith("gm", "s5", true));
  });

  it("re-applies a template through its route, keeping what was written", async () => {
    const user = userEvent.setup();
    api.applyTemplate.mockResolvedValue(session("s6", 6, { rev: 5 }));
    renderGmStory(GmSessionsSection, "/codex/sessions/s6", { sessions: [S6], pages: PAGES });
    await user.click(await screen.findByLabelText("Session 6 options"));
    await user.click(await screen.findByRole("menuitem", { name: "Re-apply a template" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Re-apply a template" }));
    await user.click(dialog.getByRole("button", { name: "Re-apply" }));
    await waitFor(() => expect(api.applyTemplate).toHaveBeenCalledWith("gm", "s6", "t1", 3));
  });

  it("says when the template it was made from is gone", async () => {
    renderGmStory(GmSessionsSection, "/codex/sessions/s6", {
      sessions: [session("s6", 6, { prepTemplateId: "gone" })],
      pages: PAGES
    });
    expect(await screen.findByRole("button", { name: /Made from a deleted template/ })).toBeDisabled();
  });

  it("makes a new session from the default template, numbered after the last, and opens it", async () => {
    const user = userEvent.setup();
    api.createSession.mockResolvedValue(session("s8", 8));
    renderGmStory(GmSessionsSection, "/codex/sessions", { sessions: [S6, S7], pages: PAGES });
    await user.click(await screen.findByRole("button", { name: "New session" }));
    await waitFor(() => expect(api.createSession).toHaveBeenCalledWith("gm", { sessionNumber: 8 }));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/sessions/s8"));
  });
});

describe("The recap step", () => {
  const HAPPENED = {
    sessionId: "s6",
    entries: [
      {
        ...gmRecord({ id: "e1", inWorldLabel: "Emberfall 15" }),
        kind: "note",
        playerText: "The party found the second ledger.",
        gmText: null
      }
    ],
    cluesTicked: [
      {
        id: "c1",
        text: "Ysolde owes the Tidebound.",
        done: true,
        doneAt: "2026-10-24T20:00:00.000Z",
        link: null,
        linkTitle: null,
        blockTitle: null,
        linkRevealed: null,
        sectionId: "x3",
        sectionTitle: "Secrets and clues"
      }
    ],
    reveals: [
      {
        recordKind: "page",
        recordId: "p-ysolde",
        recordTitle: "Ysolde Varn",
        blockId: "b-debt",
        blockTitle: "The debt",
        to: "a-lyra",
        at: "2026-10-24T20:05:00.000Z",
        inWorldLabel: "Emberfall 14"
      }
    ]
  };

  it("lists what happened, from the board, and Add copies a line into the recap players read", async () => {
    const user = userEvent.setup();
    api.happened.mockResolvedValue(HAPPENED);
    renderGmStory(GmSessionsSection, "/codex/sessions/s6", {
      sessions: [session("s6", 6, { status: "played" })],
      pages: PAGES,
      party: PARTY
    });
    const happened = within(await screen.findByRole("region", { name: "What happened" }));
    expect(await happened.findByText("Revealed to Lyra Emberwise")).toBeInTheDocument();
    expect(happened.getByText("Revealed to Lyra Emberwise").closest("li")).toHaveTextContent("Ysolde Varn · The debt");
    expect(happened.getByText("Clue ticked")).toBeInTheDocument();
    expect(happened.getByText("The party found the second ledger.")).toBeInTheDocument();
    expect(api.happened).toHaveBeenCalledWith("gm", "s6");

    await user.click(happened.getByRole("button", { name: "Add to the recap: The party found the second ledger." }));
    expect(screen.getByRole("textbox", { name: "Recap for players" })).toHaveValue(
      "The party found the second ledger."
    );
  });

  it("moves a clue not reached onto the next planned session's checklist", async () => {
    const user = userEvent.setup();
    const next = session("s7", 7, { prep: [], rev: 9 });
    api.get.mockResolvedValue(next);
    api.update.mockResolvedValue(next);
    renderGmStory(GmSessionsSection, "/codex/sessions/s6", {
      sessions: [session("s6", 6, { status: "played" }), next],
      pages: PAGES
    });
    const notReached = await screen.findByText("Not reached");
    await user.click(within(notReached.closest("section")!).getByRole("button", { name: "Move to session 7" }));

    await waitFor(() => expect(api.update).toHaveBeenCalledWith("gm", "s7", expect.anything()));
    const body = api.update.mock.calls.at(-1)![2];
    expect(body.expectedRev).toBe(9);
    expect(body.prep).toEqual([
      expect.objectContaining({
        type: "checklist",
        title: "Secrets and clues",
        items: [
          {
            text: "Ysolde owes the Tidebound.",
            done: false,
            link: PREP[2].type === "checklist" ? PREP[2].items[0].link : null
          }
        ]
      })
    ]);
    expect(await screen.findByText("Added to Session 7's clues.")).toBeInTheDocument();
  });
});

describe("A session on a phone", () => {
  it("reads the prep through, ticks a clue into the draft, and edits from the menu", async () => {
    const user = userEvent.setup();
    renderGmStory(GmSessionsSection, "/codex/sessions/s6", { sessions: [S6], pages: PAGES, phone: true });
    const strong = within(await screen.findByRole("region", { name: "Strong start" }));
    expect(strong.getByText("Fog on the quay.")).toBeInTheDocument();
    const scenes = within(screen.getByRole("region", { name: "Scenes" }));
    expect(scenes.getByText("The tower at night")).toBeInTheDocument();
    expect(scenes.getByText("Harbourmaster's Tower")).toBeInTheDocument();
    // The cast is on its own tab.
    expect(screen.queryByRole("region", { name: "Cast" })).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: /Ysolde owes the Tidebound/ }));
    await waitFor(() => expect(api.update).toHaveBeenCalled(), { timeout: 3000 });
    const items = api.update.mock.calls.at(-1)![2].prep[2].items;
    expect(items[0]).toMatchObject({ id: "c1", done: true });

    await user.click(screen.getByLabelText("Session 6 options"));
    await user.click(await screen.findByRole("menuitem", { name: "Edit the prep" }));
    expect(await screen.findByRole("textbox", { name: "Strong start" })).toHaveValue("Fog on the quay.");
  });

  it("lists the sessions newest first, with no page open", async () => {
    renderGmStory(GmSessionsSection, "/codex/sessions", { sessions: [S5, S6], pages: PAGES, phone: true });
    const list = within(await screen.findByRole("list", { name: "Sessions" }));
    expect(list.getAllByRole("button").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Session 6"),
      expect.stringContaining("Session 5")
    ]);
    expect(screen.queryByRole("article")).toBeNull();
  });
});

describe("A player's sessions", () => {
  const P5: PlayerCodexSession = {
    id: "s5",
    sessionNumber: 5,
    realDate: "2026-10-10",
    recap: "The party copied the ledger.",
    tags: []
  };
  const P4: PlayerCodexSession = {
    id: "s4",
    sessionNumber: 4,
    realDate: "2026-10-03",
    recap: "The crypt was cleared.",
    tags: []
  };

  it("opens the newest recap with what was filed under it, the quest named by the player's own list", async () => {
    renderPlayerStory(PlayerSessionsSection, "/codex/sessions", {
      sessions: [P4, P5],
      records: [
        playerRecord({ id: "r1", sessionId: "s5", text: "The Black Gull never docked." }),
        playerRecord({
          id: "r2",
          kind: "quest",
          sessionId: "s5",
          text: "",
          payload: { questId: "q1", status: "active" }
        })
      ],
      quests: [{ id: "q1", title: "The Harbourmaster's Ledger" } as never]
    });
    const article = await screen.findByRole("article", { name: "Session 5" });
    expect(within(article).getByText("October 10")).toBeInTheDocument();
    expect(within(article).getByText("The party copied the ledger.")).toBeInTheDocument();
    expect(within(article).getByText("The Black Gull never docked.")).toBeInTheDocument();
    expect(within(article).getByText(/The Harbourmaster's Ledger/)).toBeInTheDocument();
  });

  it("shows recaps as cards on a phone, marks one new until it is opened, and opens it", async () => {
    const user = userEvent.setup();
    localStorage.setItem("codex-read-recaps", JSON.stringify(["s4"]));
    renderPlayerStory(PlayerSessionsSection, "/codex/sessions", { sessions: [P4, P5], phone: true });
    const cards = within(await screen.findByRole("list", { name: "Recaps, newest first" }));
    const newest = cards.getAllByRole("listitem")[0];
    expect(newest).toHaveTextContent("Session 5");
    expect(newest).toHaveTextContent("New");
    expect(cards.getAllByRole("listitem")[1]).not.toHaveTextContent("New");

    await user.click(within(newest).getByRole("button", { name: /Session 5/ }));
    expect(window.location.pathname).toBe("/codex/sessions/s5");
    expect(JSON.parse(localStorage.getItem("codex-read-recaps")!)).toContain("s5");
  });
});

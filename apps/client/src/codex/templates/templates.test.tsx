import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const list = vi.fn();
const update = vi.fn();
const create = vi.fn();
const duplicate = vi.fn();
const setDefault = vi.fn();
const remove = vi.fn();
const createSession = vi.fn();
const applyTemplate = vi.fn();
vi.mock("../prep/api", () => ({
  templateApi: {
    list: (...a: unknown[]) => list(...a),
    update: (...a: unknown[]) => update(...a),
    create: (...a: unknown[]) => create(...a),
    duplicate: (...a: unknown[]) => duplicate(...a),
    setDefault: (...a: unknown[]) => setDefault(...a),
    remove: (...a: unknown[]) => remove(...a)
  },
  prepSessionApi: {
    create: (...a: unknown[]) => createSession(...a),
    applyTemplate: (...a: unknown[]) => applyTemplate(...a)
  }
}));

import { ToastProvider } from "@vtt/ui";
import type { CodexPrepTemplate, CodexSession } from "@vtt/domain";

/** The server's id for the starting template. */
const BUILT_IN_TEMPLATE_ID = "00000000-0000-4000-8000-00000000b001";
import { TemplatesView } from "./TemplatesView";

const BUILT_IN: CodexPrepTemplate = {
  id: BUILT_IN_TEMPLATE_ID,
  name: "Session prep",
  builtIn: true,
  isDefault: false,
  sections: [
    {
      id: "00000000-0000-4000-8000-00000000b101",
      title: "Strong start",
      prompt: "Open with something happening.",
      type: "text"
    },
    { id: "00000000-0000-4000-8000-00000000b102", title: "Scenes", prompt: null, type: "scenes" }
  ],
  rev: 0,
  createdAt: null,
  updatedAt: null
};
const MINE: CodexPrepTemplate = {
  id: "t1",
  name: "My session prep",
  builtIn: false,
  isDefault: true,
  sections: [
    { id: "s1", title: "Strong start", prompt: null, type: "text" },
    { id: "s2", title: "Secrets and clues", prompt: "Link each clue.", type: "checklist" },
    { id: "s3", title: "Cast", prompt: null, type: "pages" }
  ],
  rev: 3,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z"
};
const SESSION = (over: Partial<CodexSession> = {}): CodexSession =>
  ({
    id: "x6",
    sessionNumber: 6,
    realDate: "2026-10-24",
    attendees: [],
    recapBody: "",
    revealedToPlayers: false,
    status: "played",
    tags: [],
    sceneIds: [],
    rev: 4,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    prep: [],
    prepTemplateId: "t1",
    currentSceneId: null,
    ...over
  }) as CodexSession;

function renderView(over: Partial<Parameters<typeof TemplatesView>[0]> = {}) {
  const props = {
    gmToken: "gm",
    autosave: { enabled: false, intervalSeconds: 1 },
    sessions: [SESSION()],
    templateId: null,
    onSelectTemplate: vi.fn(),
    onOpenSession: vi.fn(),
    onSessionsChanged: vi.fn(),
    ...over
  };
  render(
    <ToastProvider>
      <TemplatesView {...props} />
    </ToastProvider>
  );
  return props;
}

beforeEach(() => {
  list.mockResolvedValue({ templates: [BUILT_IN, MINE], defaultTemplateId: "t1" });
});

describe("The prep template library", () => {
  it("lists the templates with their sections and the default marked, and opens the default", async () => {
    renderView();
    const library = await screen.findByRole("list", { name: "Prep templates" });
    expect(within(library).getByText("Built in · 2 sections")).toBeInTheDocument();
    const mine = within(library).getByRole("button", { name: /My session prep/ });
    expect(within(mine).getByText("Default")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Template name" })).toHaveValue("My session prep");
  });

  it("keeps the starting template read-only and offers its copy", async () => {
    const props = renderView({ templateId: BUILT_IN_TEMPLATE_ID });
    expect(
      await screen.findByText("The starting template can't be changed. Duplicate it to make your own.")
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Template name" })).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: /Move Strong start/ })).not.toBeInTheDocument();
    duplicate.mockResolvedValue({ ...BUILT_IN, id: "t9", name: "Session prep copy", builtIn: false });
    await userEvent.setup().click(screen.getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(duplicate).toHaveBeenCalledWith("gm", BUILT_IN_TEMPLATE_ID));
    expect(props.onSelectTemplate).toHaveBeenCalledWith("t9");
  });

  it("reorders sections with Alt and an arrow key, and saves the whole list with the rev", async () => {
    update.mockImplementation((_token: string, _id: string, input: { sections: unknown[] }) =>
      Promise.resolve({ ...MINE, rev: 4, sections: input.sections })
    );
    renderView();
    const user = userEvent.setup();
    const handle = await screen.findByRole("button", { name: "Move Secrets and clues" });
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowUp", altKey: true });
    const titles = () =>
      screen.getAllByRole("textbox", { name: /Section \d title/ }).map((input) => (input as HTMLInputElement).value);
    expect(titles()).toEqual(["Secrets and clues", "Strong start", "Cast"]);
    expect(screen.getByText("Secrets and clues moved to place 1 of 3.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][2]).toMatchObject({
      expectedRev: 3,
      sections: [
        { id: "s2", title: "Secrets and clues", prompt: "Link each clue.", type: "checklist" },
        { id: "s1", title: "Strong start", prompt: null, type: "text" },
        { id: "s3", title: "Cast", prompt: null, type: "pages" }
      ]
    });
  });

  it("adds a typed section from Add a section, each type said in one line", async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByText("Add a section"));
    const clocks = screen.getByRole("menuitem", { name: /^Clocks/ });
    expect(clocks).toHaveTextContent("Holds deadlines picked from the calendar.");
    const addMenu = clocks.closest<HTMLElement>("[role='menu']")!;
    expect(
      within(addMenu)
        .getAllByRole("menuitem")
        .map((item) => item.querySelector(".tpl-typeoption-name")?.textContent)
    ).toEqual(["Text", "Checklist", "Linked pages", "Scenes", "Clocks", "Quests in play", "Encounters"]);
    await user.click(clocks);
    const titles = screen
      .getAllByRole("textbox", { name: /Section \d title/ })
      .map((input) => (input as HTMLInputElement).value);
    expect(titles).toEqual(["Strong start", "Secrets and clues", "Cast", "Clocks"]);
  });

  it("makes a new session from the template, copying its sections, and opens it", async () => {
    createSession.mockResolvedValue(SESSION({ id: "x7", sessionNumber: 7, status: "planned" }));
    const props = renderView();
    const user = userEvent.setup();
    const panel = await screen.findByRole("region", { name: "New session from this template" });
    expect(within(panel).getByLabelText("Session")).toHaveValue(7);
    expect(
      within(within(panel).getByRole("list", { name: "Sections it copies" })).getAllByRole("listitem")
    ).toHaveLength(3);
    await user.type(within(panel).getByLabelText("Played on"), "2026-10-31");
    await user.click(within(panel).getByRole("button", { name: "Create session 7" }));
    await waitFor(() =>
      expect(createSession).toHaveBeenCalledWith("gm", { sessionNumber: 7, realDate: "2026-10-31", templateId: "t1" })
    );
    await waitFor(() => expect(props.onOpenSession).toHaveBeenCalledWith("x7"));
    expect(props.onSessionsChanged).toHaveBeenCalled();
  });

  it("lists the sessions made from the template and re-applies it to one", async () => {
    applyTemplate.mockResolvedValue(SESSION());
    renderView();
    const panel = await screen.findByRole("region", { name: "Made from this template" });
    expect(within(panel).getByText("Session 6")).toBeInTheDocument();
    await userEvent.setup().click(within(panel).getByRole("button", { name: "Re-apply" }));
    await waitFor(() => expect(applyTemplate).toHaveBeenCalledWith("gm", "x6", "t1", 4));
  });

  it("hands the default back to the starting template when it is switched off", async () => {
    setDefault.mockResolvedValue(BUILT_IN_TEMPLATE_ID);
    renderView();
    await userEvent.setup().click(await screen.findByRole("switch", { name: "Default for new sessions" }));
    await waitFor(() => expect(setDefault).toHaveBeenCalledWith("gm", BUILT_IN_TEMPLATE_ID));
  });
});

describe("Prep templates on a phone", () => {
  it("lists them read-only and still starts a session from one", async () => {
    const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query.includes("max-width: 760px"),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {}
        }) as unknown as MediaQueryList
    );
    createSession.mockResolvedValue(SESSION({ id: "x7", sessionNumber: 7 }));
    const props = renderView();
    expect(
      await screen.findByText("Templates are edited on a laptop. A new session here can use any of them.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Template name" })).not.toBeInTheDocument();
    const sections = screen.getByRole("region", { name: "My session prep sections" });
    expect(within(sections).getByText("Linked pages")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "New session from this template" }));
    await waitFor(() =>
      expect(createSession).toHaveBeenCalledWith("gm", { sessionNumber: 7, realDate: null, templateId: "t1" })
    );
    await waitFor(() => expect(props.onOpenSession).toHaveBeenCalledWith("x7"));
    matchMedia.mockRestore();
  });
});

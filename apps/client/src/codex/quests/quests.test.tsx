import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("../MapSurface", () => ({ MapSurface: () => <div data-testid="map-surface" /> }));
vi.mock("../api", async (actual) => (await import("../../../test/codex-fakes")).fakeApiModule(await actual()));
vi.mock("../api-records", async () => (await import("../../../test/codex-fakes")).fakeRecordsModule());

import type { CodexQuest } from "@vtt/domain";
import { api, block, playerQuest, quest, records, resetFakes, summary } from "../../../test/codex-fakes";
import { renderGmCodex, renderPlayerCodex } from "../../../test/codex-render";
import { setViewport } from "../../../test/viewport";

const OPEN = quest({
  blocks: [block({ id: "qb1", anchor: 1, title: "The truth", text: "The crown is a phylactery." })]
});
const DONE = quest({ id: "q2", title: "The Bell of Vallaki", status: "completed", objectives: [] });
const LOST = quest({ id: "q3", title: "The Missing Caravan", status: "failed", objectives: [] });
const FRESH = quest({ id: "q0", title: "A rumour in Vallaki", status: "not-started", objectives: [] });
const SECRET = quest({ id: "q5", title: "The Amber Bargain", revealedToPlayers: false, objectives: [] });

const list = () => within(screen.getByRole("complementary", { name: "Quests" }));
const rowTitles = () =>
  list()
    .queryAllByRole("button")
    .map((row) => row.querySelector("b")?.textContent)
    .filter(Boolean);

beforeEach(() => {
  localStorage.clear();
  resetFakes();
  api.codexApi.listPages.mockResolvedValue([summary({ id: "p1", title: "Vallaki", entityType: "location" })]);
  api.questApi.list.mockResolvedValue([OPEN, DONE, LOST, FRESH, SECRET]);
  records.questRecordApi.get.mockImplementation(async (_t: string, id: string) =>
    [OPEN, DONE, LOST, FRESH, SECRET].find((row) => row.id === id)
  );
  records.questRecordApi.update.mockImplementation(
    async (
      _t: string,
      _id: string,
      input: Omit<Partial<CodexQuest>, "objectives"> & { objectives?: { text: string; done: boolean }[] }
    ) => ({
      ...OPEN,
      ...input,
      objectives: (input.objectives ?? OPEN.objectives).map((row, at) => ({
        id: `o${at + 1}`,
        audience: "everyone",
        characterIds: [],
        ...row
      })),
      rev: OPEN.rev + 1
    })
  );
});

describe("The GM's quest list", () => {
  it("lists the active quests at first, with progress in words, and marks a Hidden quest", async () => {
    renderGmCodex("/codex/quests");
    await waitFor(() => expect(rowTitles()).toEqual(["The Sunless Crown", "The Amber Bargain"]));
    expect(list().getByText("1 of 2 done")).toBeInTheDocument();
    expect(list().getByRole("button", { name: /The Amber Bargain/ })).toHaveTextContent("Hidden");
    expect(screen.getByText("Active quests")).toBeInTheDocument();
  });

  it("filters by status in the address, and reads an older status address as its group", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/quests?status=completed");
    await waitFor(() => expect(rowTitles()).toEqual(["The Bell of Vallaki", "The Missing Caravan"]));
    expect(screen.getByText("Done quests")).toBeInTheDocument();

    await user.click(list().getByRole("button", { name: "Not started" }));
    expect(new URLSearchParams(window.location.search).get("status")).toBe("done,not-started");
    await waitFor(() => expect(rowTitles()).toContain("A rumour in Vallaki"));
  });

  it("lists every quest once no status is chosen", async () => {
    renderGmCodex("/codex/quests?status=none");
    await waitFor(() => expect(rowTitles()).toHaveLength(5));
    expect(screen.getByText("Every quest")).toBeInTheDocument();
  });

  it("filters by who sees it, which only the GM has", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/quests");
    await waitFor(() => expect(rowTitles()).toHaveLength(2));
    await user.click(
      within(list().getByRole("group", { name: "Who sees it" })).getByRole("button", { name: "Hidden" })
    );
    await waitFor(() => expect(rowTitles()).toEqual(["The Amber Bargain"]));
  });

  it("opens a quest at its own address and writes nothing to get there", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/quests");
    await user.click(await list().findByRole("button", { name: /The Sunless Crown/ }));
    expect(window.location.pathname).toBe("/codex/quests/q1");
    expect(await screen.findByRole("heading", { level: 1, name: "The Sunless Crown" })).toBeInTheDocument();
    expect(records.questRecordApi.update).not.toHaveBeenCalled();
    expect(api.questApi.create).not.toHaveBeenCalled();
  });

  it("makes a new quest and opens it for writing", async () => {
    const user = userEvent.setup();
    api.questApi.create.mockResolvedValue({ ...OPEN, id: "q9", title: "New quest" });
    renderGmCodex("/codex/quests");
    await user.click(await screen.findByRole("button", { name: "New quest" }));
    await waitFor(() => expect(api.questApi.create).toHaveBeenCalled());
    await waitFor(() => expect(window.location.pathname).toBe("/codex/quests/q9"));
    expect(window.location.search).toBe("?mode=edit");
  });
});

describe("Reading and running a quest as the GM", () => {
  it("ticks an objective in place, keeping the order, through the quest's own route", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/quests/q1");
    await user.click(await screen.findByRole("checkbox", { name: "Open the sarcophagus done" }));
    await waitFor(() => expect(records.questRecordApi.update).toHaveBeenCalled());
    const [, id, input] = records.questRecordApi.update.mock.calls[0];
    expect(id).toBe("q1");
    expect(input.objectives).toEqual([
      { id: "o1", text: "Find the crypt", done: true },
      { id: "o2", text: "Open the sarcophagus", done: true }
    ]);
    expect(input.expectedRev).toBe(3);
  });

  it("adds an objective for everyone at the end of the list", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/quests/q1");
    await user.type(await screen.findByLabelText("New objective"), "Return the crown");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(records.questRecordApi.update).toHaveBeenCalled());
    expect(records.questRecordApi.update.mock.calls[0][2].objectives.at(-1)).toEqual({
      text: "Return the crown",
      done: false,
      audience: "everyone"
    });
  });

  it("sets who sees one objective through the objective's own route", async () => {
    const user = userEvent.setup();
    records.questRecordApi.setObjectiveAudience.mockResolvedValue(OPEN);
    renderGmCodex("/codex/quests/q1");
    const row = (await screen.findByText("Open the sarcophagus")).closest("li") as HTMLElement;
    await user.click(within(row).getByLabelText(/Who sees Open the sarcophagus/));
    await user.click(within(row).getByRole("menuitemradio", { name: "Hidden" }));
    await waitFor(() =>
      expect(records.questRecordApi.setObjectiveAudience).toHaveBeenCalledWith("gm", "q1", "o2", { audience: "hidden" })
    );
  });

  it("boxes the quest's hidden block as Hidden and reveals it through the block route", async () => {
    const user = userEvent.setup();
    records.questRecordApi.blocks.setAudience.mockResolvedValue(OPEN);
    renderGmCodex("/codex/quests/q1");
    await screen.findByRole("region", { name: "The truth · Hidden" });
    await user.click(screen.getByRole("button", { name: "Reveal The truth" }));
    const panel = within(await screen.findByRole("dialog", { name: "Reveal The truth" }));
    await user.click(panel.getByRole("button", { name: "Reveal to everyone" }));
    await waitFor(() =>
      expect(records.questRecordApi.blocks.setAudience).toHaveBeenCalledWith("gm", "q1", "qb1", {
        audience: "everyone"
      })
    );
  });

  it("hides the whole quest from players through the quest's reveal route", async () => {
    const user = userEvent.setup();
    api.questApi.reveal.mockResolvedValue({ ...OPEN, revealedToPlayers: false });
    renderGmCodex("/codex/quests/q1");
    await user.click(await screen.findByLabelText("Who can open this quest: Everyone"));
    await user.click(screen.getByRole("menuitemradio", { name: "Hide the quest from players" }));
    await waitFor(() => expect(api.questApi.reveal).toHaveBeenCalledWith("gm", "q1", false));
  });

  it("deletes the quest only after asking", async () => {
    const user = userEvent.setup();
    api.questApi.remove.mockResolvedValue({ deleted: true });
    renderGmCodex("/codex/quests/q1");
    await screen.findByRole("heading", { level: 1, name: "The Sunless Crown" });
    await user.click(screen.getByLabelText("More"));
    await user.click(screen.getByRole("menuitem", { name: "Delete quest" }));
    const ask = await screen.findByRole("dialog", { name: "Delete quest" });
    expect(api.questApi.remove).not.toHaveBeenCalled();
    await user.click(within(ask).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.questApi.remove).toHaveBeenCalledWith("gm", "q1"));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/quests"));
  });

  it("follows a link to a page that exists, and offers to make one no page has", async () => {
    const user = userEvent.setup();
    const body = "Meet Ismark in [[Vallaki]], then ride to [[Wave Echo Cave]].";
    records.questRecordApi.get.mockResolvedValue({ ...OPEN, playerBody: body, blocks: [] });
    renderGmCodex("/codex/quests/q1");
    await user.click(await screen.findByRole("button", { name: "Create the page Wave Echo Cave" }));
    expect(await screen.findByRole("dialog", { name: /New page/ })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Wave Echo Cave")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Vallaki" }));
    expect(window.location.pathname).toBe("/codex/pages/p1");
  });

  it("reads the quest as a player receives it, through a preview token", async () => {
    const user = userEvent.setup();
    api.playerCodexApi.quests.mockResolvedValue([playerQuest()]);
    renderGmCodex("/codex/quests/q1");
    await screen.findByRole("heading", { level: 1, name: "The Sunless Crown" });
    await user.click(screen.getByRole("switch", { name: "See as players" }));
    await waitFor(() => expect(api.playerCodexApi.quests).toHaveBeenCalledWith("preview-token"));
    await waitFor(() => expect(screen.queryByText("The crown is a phylactery.")).not.toBeInTheDocument());
    expect(screen.getByText("The burgomaster wants the crown returned.")).toBeInTheDocument();
  });
});

describe("Writing a quest", () => {
  it("offers all five statuses in lifecycle order and saves the one chosen", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/quests/q1?mode=edit");
    const status = await screen.findByLabelText("Status");
    expect([...(status as HTMLSelectElement).options].map((option) => option.textContent)).toEqual([
      "Not started",
      "Active",
      "Completed",
      "Failed",
      "Canceled"
    ]);
    await user.selectOptions(status, "canceled");
    await waitFor(() => expect(records.questRecordApi.update).toHaveBeenCalled(), { timeout: 4000 });
    expect(records.questRecordApi.update.mock.calls.at(-1)![2]).toMatchObject({ status: "canceled", expectedRev: 3 });
  });

  it("keeps a new objective's audience with it until it is saved, so a Hidden one is never shown first", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/quests/q1?mode=edit");
    await user.click(await screen.findByRole("button", { name: "Add an objective" }));
    const row = screen.getByLabelText("Objective 3").closest("li") as HTMLElement;
    await user.click(within(row).getByLabelText(/Who sees objective 3/));
    await user.click(within(row).getByRole("menuitemradio", { name: "Hidden" }));
    await user.type(screen.getByLabelText("Objective 3"), "Learn the vestige's name");
    await waitFor(() => expect(records.questRecordApi.update).toHaveBeenCalled(), { timeout: 4000 });
    expect(records.questRecordApi.update.mock.calls.at(-1)![2].objectives.at(-1)).toEqual({
      text: "Learn the vestige's name",
      done: false,
      audience: "hidden"
    });
    expect(records.questRecordApi.setObjectiveAudience).not.toHaveBeenCalled();
  });
});

describe("A player's quests (viewer safety)", () => {
  beforeEach(() => {
    api.playerCodexApi.quests.mockResolvedValue([
      playerQuest(),
      playerQuest({ id: "q2", title: "The Bell of Vallaki", status: "completed", objectives: [] })
    ]);
  });

  it("reads the player's own quest feed, and never the GM's", async () => {
    renderPlayerCodex("/codex/quests");
    await waitFor(() => expect(rowTitles()).toEqual(["The Sunless Crown"]));
    expect(api.playerCodexApi.quests).toHaveBeenCalledWith("player");
    expect(api.questApi.list).not.toHaveBeenCalled();
    expect(records.questRecordApi.get).not.toHaveBeenCalled();
  });

  it("reads a quest: title, status, text and objectives, with nothing to tick", async () => {
    renderPlayerCodex("/codex/quests/q1");
    expect(await screen.findByRole("heading", { level: 1, name: "The Sunless Crown" })).toBeInTheDocument();
    const quest = within(document.querySelector(".cx-doc") as HTMLElement);
    expect(quest.getByText("Active")).toBeInTheDocument();
    expect(quest.getByText("The burgomaster wants the crown returned.")).toBeInTheDocument();
    expect(quest.getByText("Find the crypt")).toBeInTheDocument();
    expect(quest.getByText("1 of 2 done")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /objective/i })).not.toBeInTheDocument();
  });

  it("keeps finished quests under Done, and opens one straight from an address", async () => {
    const user = userEvent.setup();
    const view = renderPlayerCodex("/codex/quests");
    await waitFor(() => expect(rowTitles()).toEqual(["The Sunless Crown"]));
    await user.click(list().getByRole("button", { name: "Done" }));
    await waitFor(() => expect(rowTitles()).toContain("The Bell of Vallaki"));
    view.unmount();

    // A search hit lands on a finished quest even though the list starts on the active ones.
    renderPlayerCodex("/codex/quests/q2");
    expect(await screen.findByRole("heading", { level: 1, name: "The Bell of Vallaki" })).toBeInTheDocument();
  });

  it("renders nothing from a GM-shaped quest, should the server ever send one", async () => {
    api.playerCodexApi.quests.mockResolvedValue([
      { ...playerQuest(), playerBody: "a GM-shaped copy of the body", blocks: [], gmBody: "The crown is a phylactery." }
    ]);
    renderPlayerCodex("/codex/quests/q1");
    await screen.findByRole("heading", { level: 1, name: "The Sunless Crown" });
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("The crown is a phylactery.");
    expect(text).not.toContain("a GM-shaped copy of the body");
  });

  it("says plainly when an address names a quest the player can't open", async () => {
    renderPlayerCodex("/codex/quests/q9");
    expect(await screen.findByText("This quest isn't one you can open.")).toBeInTheDocument();
  });
});

describe("Quests on a phone", () => {
  beforeEach(() => setViewport(390));

  it("lists the quests under the top bar, and a quest opens with a way back", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/quests");
    expect(await screen.findByRole("heading", { level: 2, name: "Quests" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /The Sunless Crown/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "The Sunless Crown" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(window.location.pathname).toBe("/codex/quests");
  });
});

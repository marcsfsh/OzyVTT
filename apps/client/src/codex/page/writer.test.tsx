import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("../MapSurface", () => ({ MapSurface: () => <div data-testid="map-surface" /> }));
vi.mock("../api", async (actual) => (await import("../../../test/codex-fakes")).fakeApiModule(await actual()));
vi.mock("../api-records", async () => (await import("../../../test/codex-fakes")).fakeRecordsModule());

import type { CodexPage, CodexPageConnection } from "@vtt/domain";
import { ApiError } from "../../lib/api";
import { api, block, page, records, resetFakes, summary } from "../../../test/codex-fakes";
import { renderGmCodex } from "../../../test/codex-render";

const PAGE: CodexPage = page({
  rev: 3,
  playerBody: "The harbourmaster of Saltmere.",
  fields: { role: "Harbourmaster", status: "Alive", goals: "Pay the Tidebound back." },
  hiddenFields: ["goals"],
  blocks: [block({ id: "b1", anchor: 1, title: "The debt", text: "She owes the Tidebound." })]
});
const MEMBER: CodexPageConnection = {
  id: "c1",
  direction: "out",
  otherKind: "page",
  otherId: "p2",
  otherTitle: "The Tidebound",
  otherEntityType: "faction",
  otherRevealed: true,
  label: "member of",
  origin: "declared",
  layer: "player",
  characterIds: [],
  section: null,
  began: null,
  learned: null
};

const write = (at = PAGE) => renderGmCodex(`/codex/pages/${at.id}?mode=edit`);
const saved = (over: Partial<CodexPage> = {}) => ({ ...PAGE, rev: PAGE.rev + 1, ...over });

beforeEach(() => {
  localStorage.clear();
  resetFakes();
  api.codexApi.listPages.mockResolvedValue([
    summary({ id: "p1", title: "Ysolde Varn" }),
    summary({ id: "p2", title: "The Tidebound", entityType: "faction" })
  ]);
  records.pageRecordApi.get.mockResolvedValue({ page: PAGE, connections: [MEMBER] });
  records.pageRecordApi.update.mockImplementation(async (_t: string, _id: string, input: Partial<CodexPage>) =>
    saved(input)
  );
});

describe("Saving what the GM writes", () => {
  it("autosaves an edit, showing the in-flight state, then settles", async () => {
    let release!: (value: unknown) => void;
    records.pageRecordApi.update.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const user = userEvent.setup();
    write();
    await user.type(await screen.findByLabelText("Page title"), "!");
    await waitFor(() => expect(records.pageRecordApi.update).toHaveBeenCalled(), { timeout: 4000 });
    expect((await screen.findAllByText("Saving…")).length).toBeGreaterThan(0);
    release(saved());
    await waitFor(() => expect(screen.queryByText("Saving…")).not.toBeInTheDocument(), { timeout: 4000 });
  });

  it("sends the page's revision with the save, the optimistic-concurrency check", async () => {
    const user = userEvent.setup();
    write();
    await user.type(await screen.findByLabelText("Page title"), "!");
    await waitFor(() => expect(records.pageRecordApi.update).toHaveBeenCalled(), { timeout: 4000 });
    const [token, id, input] = records.pageRecordApi.update.mock.calls[0];
    expect([token, id]).toEqual(["gm", "p1"]);
    expect(input).toMatchObject({
      title: "Ysolde Varn!",
      expectedRev: 3,
      playerBody: "The harbourmaster of Saltmere."
    });
    // The layout places every block the page keeps.
    expect(input.layout).toEqual([{ id: "b1", anchor: 1 }]);
  });

  it("says the page changed elsewhere on a 409, and reads it again", async () => {
    records.pageRecordApi.update.mockRejectedValueOnce(new ApiError("This page changed.", 409, "conflict"));
    const user = userEvent.setup();
    write();
    await user.type(await screen.findByLabelText("Page title"), "!");
    expect((await screen.findAllByText("Changed elsewhere", {}, { timeout: 4000 })).length).toBeGreaterThan(0);
    await waitFor(() => expect(records.pageRecordApi.get.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByText(/Someone else changed this page/)).toBeInTheDocument();
  });

  it("does not save when nothing changed", async () => {
    write();
    await screen.findByLabelText("Page title");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(records.pageRecordApi.update).not.toHaveBeenCalled();
  });

  it("Done saves what is left and goes back to reading", async () => {
    const user = userEvent.setup();
    write();
    await user.type(await screen.findByLabelText("Page title"), "!");
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(records.pageRecordApi.update).toHaveBeenCalled());
    await waitFor(() => expect(window.location.search).toBe(""));
  });
});

describe("Hidden blocks in the writer", () => {
  it("adds a Hidden block through the block route, then places it with the page's layout", async () => {
    const user = userEvent.setup();
    const added = block({ id: "b9", anchor: 1, title: null, text: "Wren is alive." });
    records.pageRecordApi.blocks.add.mockResolvedValue({
      record: saved({ blocks: [...PAGE.blocks, added] }),
      blockId: "b9"
    });
    write();
    await screen.findByLabelText("Page title");
    await user.click(screen.getByRole("button", { name: "Hidden block" }));
    const text = screen.getByLabelText("Untitled block text");
    expect(text.closest("section")).toHaveClass("is-draft");
    await user.type(text, "Wren is alive.");

    await waitFor(() => expect(records.pageRecordApi.blocks.add).toHaveBeenCalled(), { timeout: 4000 });
    const [, , input] = records.pageRecordApi.blocks.add.mock.calls[0];
    expect(input).toMatchObject({ text: "Wren is alive.", title: null, expectedRev: 3 });
    await waitFor(() => expect(records.pageRecordApi.update).toHaveBeenCalled());
    const layout = records.pageRecordApi.update.mock.calls.at(-1)![2].layout as { id: string }[];
    expect(layout.map((row) => row.id)).toEqual(["b1", "b9"]);
  });

  it("writes a block's text through that block's own route", async () => {
    const user = userEvent.setup();
    records.pageRecordApi.blocks.update.mockResolvedValue(saved());
    write();
    await user.type(await screen.findByLabelText("The debt text"), " Four thousand gold.");
    await waitFor(() => expect(records.pageRecordApi.blocks.update).toHaveBeenCalled(), { timeout: 4000 });
    expect(records.pageRecordApi.blocks.update.mock.calls[0]).toEqual([
      "gm",
      "p1",
      "b1",
      { title: "The debt", text: "She owes the Tidebound. Four thousand gold.", expectedRev: 3 }
    ]);
  });

  it("removes a block through the block route", async () => {
    const user = userEvent.setup();
    records.pageRecordApi.blocks.remove.mockResolvedValue(saved({ blocks: [] }));
    write();
    await user.click(await screen.findByRole("button", { name: "Remove The debt" }));
    await waitFor(() => expect(records.pageRecordApi.blocks.remove).toHaveBeenCalledWith("gm", "p1", "b1"), {
      timeout: 4000
    });
  });

  it("offers Reveal on a saved block from inside the writer", async () => {
    const user = userEvent.setup();
    write();
    await user.click(await screen.findByRole("button", { name: "Reveal The debt" }));
    expect(await screen.findByRole("dialog", { name: "Reveal The debt" })).toBeInTheDocument();
  });
});

describe("Who sees each field", () => {
  it("sets a field's audience through the field route, which is no edit of the page", async () => {
    const user = userEvent.setup();
    records.pageRecordApi.setFieldAudience.mockResolvedValue({ ...PAGE, hiddenFields: [] });
    write();
    const toggle = await screen.findByRole("switch", { name: "Who sees Goals & motives: Hidden" });
    await user.click(toggle);
    await waitFor(() =>
      expect(records.pageRecordApi.setFieldAudience).toHaveBeenCalledWith("gm", "p1", "goals", "everyone")
    );
    expect(records.pageRecordApi.update).not.toHaveBeenCalled();
  });

  it("adds a field the kind has and the page does not show yet", async () => {
    const user = userEvent.setup();
    write();
    await screen.findByLabelText("Page title");
    expect(screen.queryByLabelText("Age")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Add a field"));
    await user.click(screen.getByRole("menuitem", { name: "Age" }));
    expect(screen.getByLabelText("Age")).toBeInTheDocument();
  });
});

describe("Changing a page's kind", () => {
  const kind = () => screen.getByLabelText("Kind");
  const dialog = () => screen.findByRole("dialog");

  it("asks even when nothing would be lost: the prompt is unconditional", async () => {
    const user = userEvent.setup();
    records.pageRecordApi.get.mockResolvedValue({
      page: { ...PAGE, entityType: "note", fields: {} },
      connections: []
    });
    write();
    await screen.findByLabelText("Page title");
    await user.selectOptions(kind(), "character");
    const box = within(await dialog());
    expect(box.getByText("Change kind to Character?")).toBeInTheDocument();
    expect(box.getByText(/Nothing you have written is lost/)).toBeInTheDocument();
  });

  it("names the fields at risk when text would be dropped, and says Version history can restore them", async () => {
    const user = userEvent.setup();
    write();
    await screen.findByLabelText("Page title");
    await user.selectOptions(kind(), "item");
    const box = within(await dialog());
    expect(box.getByText(/Role \/ occupation, Status/)).toBeInTheDocument();
    expect(box.getByText(/restore them from Version history/)).toBeInTheDocument();
  });

  it("counts only fields that hold text: an empty field loses nothing", async () => {
    const user = userEvent.setup();
    records.pageRecordApi.get.mockResolvedValue({
      page: { ...PAGE, fields: { role: "   ", status: "" } },
      connections: []
    });
    write();
    await screen.findByLabelText("Page title");
    await user.selectOptions(kind(), "item");
    expect(within(await dialog()).getByText(/Nothing you have written is lost/)).toBeInTheDocument();
  });

  it("promises no recovery when version history is off", async () => {
    api.codexApi.getSettings.mockResolvedValue({
      autosave: { enabled: true, intervalSeconds: 1 },
      revisionHistory: { enabled: false, windowMinutes: 10 }
    });
    const user = userEvent.setup();
    write();
    await screen.findByLabelText("Page title");
    await waitFor(() => expect(api.codexApi.getSettings).toHaveBeenCalled());
    await user.selectOptions(kind(), "item");
    const box = within(await dialog());
    expect(box.getByText(/Version history is off, so this cannot be undone/)).toBeInTheDocument();
    expect(box.queryByText(/restore them/)).not.toBeInTheDocument();
  });

  it("leaves the kind alone when the GM cancels", async () => {
    const user = userEvent.setup();
    write();
    await screen.findByLabelText("Page title");
    await user.selectOptions(kind(), "item");
    await user.click(within(await dialog()).getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(kind()).toHaveValue("character"));
    expect(records.pageRecordApi.update).not.toHaveBeenCalled();
  });

  it("changes the kind and drops the fields the new kind has no place for", async () => {
    const user = userEvent.setup();
    write();
    await screen.findByLabelText("Page title");
    await user.selectOptions(kind(), "item");
    await user.click(within(await dialog()).getByRole("button", { name: "Change kind" }));
    await waitFor(() => expect(kind()).toHaveValue("item"));
    expect(screen.queryByLabelText("Role / occupation")).not.toBeInTheDocument();
  });

  it("does not ask when the kind did not change", async () => {
    const user = userEvent.setup();
    write();
    await screen.findByLabelText("Page title");
    await user.selectOptions(kind(), "character");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Relationships in the writer", () => {
  it("adds one with a label, a page, who sees it and when it began", async () => {
    const user = userEvent.setup();
    api.codexApi.addConnection.mockResolvedValue({});
    write();
    const panel = within(await screen.findByRole("region", { name: "Relationships" }));
    await user.click(panel.getByRole("button", { name: "rival of" }));
    await user.click(panel.getByLabelText("To: Choose a page"));
    await user.click(panel.getByRole("option", { name: /The Tidebound/ }));
    await user.selectOptions(panel.getByLabelText("When it began"), "before");
    await user.click(panel.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(api.codexApi.addConnection).toHaveBeenCalledWith("gm", "p1", {
        toPageId: "p2",
        label: "rival of",
        layer: "player",
        began: { inWorldDate: null, beforeCampaign: true }
      })
    );
  });

  it("dates one that exists, and hides it from players through its own route", async () => {
    const user = userEvent.setup();
    api.codexApi.updateConnection.mockResolvedValue({});
    write();
    const panel = within(await screen.findByRole("region", { name: "Relationships" }));
    await user.click(panel.getByRole("button", { name: "When Member of The Tidebound began: No start date" }));
    await user.selectOptions(panel.getByLabelText("When it began", { selector: "#cx-began-c1-mode" }), "before");
    await user.click(panel.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.codexApi.updateConnection).toHaveBeenCalledWith("gm", "c1", {
        began: { inWorldDate: null, beforeCampaign: true }
      })
    );

    await user.click(panel.getByRole("switch", { name: "Who sees Member of The Tidebound: Everyone" }));
    await waitFor(() => expect(api.codexApi.updateConnection).toHaveBeenCalledWith("gm", "c1", { layer: "gm" }));
  });
});

describe("Links while writing", () => {
  it("offers the pages a [[ link could mean, and a new page for a title no page has", async () => {
    const user = userEvent.setup();
    write();
    const text = await screen.findByLabelText("Page text");
    await user.click(text);
    // user-event reads "[[" as one literal bracket.
    await user.keyboard("{End} [[[[Tide");
    const menu = within(await screen.findByRole("listbox", { name: "Link to a page" }));
    expect(menu.getByRole("option", { name: /The Tidebound/ })).toBeInTheDocument();
    expect(menu.getByRole("option", { name: "New page: Tide" })).toBeInTheDocument();
  });

  it("offers a Hidden block from a slash at the start of a line", async () => {
    const user = userEvent.setup();
    write();
    const text = await screen.findByLabelText("Page text");
    await user.click(text);
    await user.keyboard("{End}{Enter}{Enter}/");
    expect(
      within(await screen.findByRole("listbox", { name: "Add a block" })).getByRole("option", { name: "Hidden block" })
    ).toBeInTheDocument();
  });
});

// The writer saves the whole draft, so a page with no date control must leave `inWorldDate` out: sending null would
// erase an event's date once it was made some other kind and edited.
describe("An event page is dated in the writer", () => {
  const EVENT = page({ id: "p9", title: "The Sundering", entityType: "event", playerBody: "The sky tore open." });

  it("offers the date control on an event and on nothing else", async () => {
    records.pageRecordApi.get.mockResolvedValue({ page: EVENT, connections: [] });
    const view = write(EVENT);
    expect(await screen.findByLabelText("Year")).toBeInTheDocument();
    view.unmount();

    records.pageRecordApi.get.mockResolvedValue({ page: { ...EVENT, entityType: "location" }, connections: [] });
    write(EVENT);
    await screen.findByLabelText("Page title");
    expect(screen.queryByLabelText("Year")).not.toBeInTheDocument();
  });

  it("sends the raw date the GM typed, and nothing derived from it", async () => {
    const user = userEvent.setup();
    records.pageRecordApi.get.mockResolvedValue({ page: EVENT, connections: [] });
    write(EVENT);
    await user.type(await screen.findByLabelText("Year"), "1492");
    await user.type(screen.getByLabelText("Day"), "2");
    await waitFor(() => expect(records.pageRecordApi.update).toHaveBeenCalled(), { timeout: 4000 });
    const payload = records.pageRecordApi.update.mock.calls.at(-1)![2];
    expect(payload.inWorldDate).toEqual({ year: 1492, month: 0, day: 2 });
    // The sort key and label are the server's to work out.
    expect(payload).not.toHaveProperty("calendarInstant");
    expect(payload).not.toHaveProperty("inWorldLabel");
  });

  it("says nothing about the date when the page is not an event", async () => {
    const user = userEvent.setup();
    records.pageRecordApi.get.mockResolvedValue({ page: { ...EVENT, entityType: "location" }, connections: [] });
    write(EVENT);
    await user.type(await screen.findByLabelText("Page title"), "!");
    await waitFor(() => expect(records.pageRecordApi.update).toHaveBeenCalled(), { timeout: 4000 });
    expect(records.pageRecordApi.update.mock.calls.at(-1)![2]).not.toHaveProperty("inWorldDate");
  });
});

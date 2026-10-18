import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("../api", async (actual) => (await import("../../../test/codex-fakes")).fakeApiModule(await actual()));
vi.mock("../api-records", async () => (await import("../../../test/codex-fakes")).fakeRecordsModule());

import { api, resetFakes, summary } from "../../../test/codex-fakes";
import { renderGmCodex, renderPlayerCodex } from "../../../test/codex-render";

const PAGES = [
  summary({ id: "p1", title: "Ysolde Varn", tags: ["saltmere"], folder: "NPCs/Harbour" }),
  summary({ id: "p2", title: "Saltmere", entityType: "location", tags: ["saltmere", "coast"] }),
  summary({ id: "p3", title: "The Tidebound", entityType: "faction", revealedToPlayers: false, folder: "NPCs" })
];
const PLAYER_PAGES = [
  {
    id: "p1",
    title: "Ysolde Varn",
    entityType: "character",
    tags: [],
    bannerAssetId: null,
    playerUpdatedAt: "2026-10-01T00:00:00.000Z"
  },
  {
    id: "p2",
    title: "Saltmere",
    entityType: "location",
    tags: [],
    bannerAssetId: null,
    playerUpdatedAt: "2026-10-01T00:00:00.000Z"
  }
];

const list = () => within(document.querySelector(".cx-pagelist") as HTMLElement);
const titles = () =>
  list()
    .getAllByRole("button")
    .map((row) => row.querySelector(".cx-pagerow-title")?.textContent);

beforeEach(() => {
  localStorage.clear();
  resetFakes();
  api.codexApi.listPages.mockResolvedValue(PAGES);
  api.codexApi.listFolders.mockResolvedValue(["NPCs", "NPCs/Harbour", "Empty"]);
  api.playerCodexApi.listPages.mockResolvedValue(PLAYER_PAGES);
});

describe("The GM's Pages", () => {
  it("counts each group in words, marks a Hidden page, and lists every page by name", async () => {
    renderGmCodex("/codex/pages");
    await waitFor(() => expect(titles()).toEqual(["Saltmere", "The Tidebound", "Ysolde Varn"]));
    expect(screen.getByRole("button", { name: /^Factions/ })).toHaveTextContent("0 revealed · 1 hidden");
    expect(list().getByRole("button", { name: /The Tidebound/ })).toHaveTextContent("Hidden");
    expect(list().getByRole("button", { name: /Saltmere/ })).not.toHaveTextContent("Hidden");
  });

  it("filters to one group in place, and the address says which", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/pages");
    await user.click(await screen.findByRole("button", { name: /^Places/ }));
    expect(window.location.search).toBe("?group=places");
    await waitFor(() => expect(titles()).toEqual(["Saltmere"]));
  });

  it("narrows by name, and says when no page has that name", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/pages");
    await user.type(await screen.findByLabelText("Find a page by name"), "salt");
    await waitFor(() => expect(titles()).toEqual(["Saltmere"]));
    await user.type(screen.getByLabelText("Find a page by name"), "zzz");
    expect(await screen.findByText("No page has that name.")).toBeInTheDocument();
  });

  it("opens a page, and a tag opens everything that carries it", async () => {
    const user = userEvent.setup();
    const view = renderGmCodex("/codex/pages");
    await waitFor(() => expect(titles()).toContain("Saltmere"));
    await user.click(list().getByRole("button", { name: /Saltmere/ }));
    expect(window.location.pathname).toBe("/codex/pages/p2");
    view.unmount();

    renderGmCodex("/codex/pages");
    const tags = within(await screen.findByRole("list", { name: "Tags" }));
    // The tag most pages carry comes first.
    expect(tags.getAllByRole("listitem").map((tag) => tag.textContent)).toEqual(["#saltmere", "#coast"]);
    await user.click(tags.getByText("#coast"));
    expect(window.location.pathname).toBe("/codex/tags/coast");
  });

  it("makes a new page of the group on screen", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/pages?group=places");
    await user.click(await screen.findByRole("button", { name: "New page" }));
    const dialog = await screen.findByRole("dialog", { name: /New page/ });
    expect(within(dialog).getByLabelText(/Kind/)).toHaveValue("location");
  });
});

describe("The GM's folders", () => {
  it("lists the folders the GM made, an empty one included, and filters to one in place", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/pages");
    const folders = within(await screen.findByRole("region", { name: "Folders" }));
    await waitFor(() => expect(folders.getByRole("button", { name: "Empty" })).toBeInTheDocument());
    await user.click(folders.getByRole("button", { name: "NPCs" }));
    expect(new URLSearchParams(window.location.search).get("folder")).toBe("NPCs");
    // A folder holds what is filed in it and in the folders inside it.
    await waitFor(() => expect(titles()).toEqual(["The Tidebound", "Ysolde Varn"]));
  });

  it("makes a new folder", async () => {
    const user = userEvent.setup();
    api.codexApi.createFolder.mockResolvedValue({ folders: [] });
    renderGmCodex("/codex/pages");
    const folders = within(await screen.findByRole("region", { name: "Folders" }));
    await user.click(folders.getByRole("button", { name: "New folder" }));
    await user.type(folders.getByLabelText("New folder name"), "Lore");
    await user.click(folders.getByRole("button", { name: "Make folder" }));
    await waitFor(() => expect(api.codexApi.createFolder).toHaveBeenCalledWith("gm", "Lore"));
  });

  it("puts every folder action behind one menu, each running on the right folder", async () => {
    const user = userEvent.setup();
    api.codexApi.moveFolder.mockResolvedValue({ moved: 1 });
    api.codexApi.deleteFolder.mockResolvedValue({ deleted: true });
    renderGmCodex("/codex/pages");
    const folders = within(await screen.findByRole("region", { name: "Folders" }));
    const menu = await folders.findByLabelText("Actions for NPCs/Harbour");
    const row = menu.closest(".cx-folderrow") as HTMLElement;
    // The row carries the folder's name and the one menu, and nothing else to tap.
    expect([...row.querySelectorAll("button, summary")].filter((el) => !el.closest(".nh-menu-popover"))).toHaveLength(
      2
    );
    expect(
      within(row)
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual(["New page here", "New subfolder", "Rename folder", "Move to top level", "Delete folder"]);

    await user.click(menu);
    await user.click(within(row).getByRole("menuitem", { name: "Move to top level" }));
    await waitFor(() => expect(api.codexApi.moveFolder).toHaveBeenCalledWith("gm", "NPCs/Harbour", "Harbour"));

    await user.click(folders.getByLabelText("Actions for NPCs"));
    await user.click(
      within(folders.getByLabelText("Actions for NPCs").closest(".cx-folderrow") as HTMLElement).getByRole("menuitem", {
        name: "Rename folder"
      })
    );
    const name = folders.getByLabelText("New name for NPCs");
    await user.clear(name);
    await user.type(name, "People");
    await user.click(folders.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(api.codexApi.moveFolder).toHaveBeenCalledWith("gm", "NPCs", "People"));

    await user.click(folders.getByLabelText("Actions for Empty"));
    await user.click(
      within(folders.getByLabelText("Actions for Empty").closest(".cx-folderrow") as HTMLElement).getByRole(
        "menuitem",
        { name: "Delete folder" }
      )
    );
    await user.click(
      within(await screen.findByRole("dialog", { name: "Delete folder" })).getByRole("button", {
        name: "Delete folder"
      })
    );
    await waitFor(() => expect(api.codexApi.deleteFolder).toHaveBeenCalledWith("gm", "Empty"));
  });

  it("files a new page in the folder it was made from", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/pages");
    const folders = within(await screen.findByRole("region", { name: "Folders" }));
    await user.click(await folders.findByLabelText("Actions for NPCs"));
    await user.click(
      within(folders.getByLabelText("Actions for NPCs").closest(".cx-folderrow") as HTMLElement).getByRole("menuitem", {
        name: "New page here"
      })
    );
    const dialog = await screen.findByRole("dialog", { name: /New page/ });
    expect(within(dialog).getByText(/NPCs/)).toBeInTheDocument();
  });
});

describe("A player's Pages (viewer safety)", () => {
  it("lists the player's own pages with plain counts, and no folder, Hidden mark or New", async () => {
    renderPlayerCodex("/codex/pages");
    await waitFor(() => expect(titles()).toEqual(["Saltmere", "Ysolde Varn"]));
    expect(api.codexApi.listPages).not.toHaveBeenCalled();
    expect(api.codexApi.listFolders).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Folders" })).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New page" })).not.toBeInTheDocument();
  });

  it("filters to a group in place, not only from Home", async () => {
    const user = userEvent.setup();
    renderPlayerCodex("/codex/pages");
    await user.click(await screen.findByRole("button", { name: /^Places/ }));
    expect(window.location.search).toBe("?group=places");
    await waitFor(() => expect(titles()).toEqual(["Saltmere"]));
  });
});

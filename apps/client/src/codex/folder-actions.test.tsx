import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NotebookTree, buildFolderTree } from "./NotebookTree";
import type { CodexPageSummary } from "@vtt/domain";

/**
 * A folder row has one `Menu` trigger in place of four small icon buttons that couldn't meet the 44px tap
 * floor. jsdom can't measure pixels, so this checks the structure: one control on the row, every action a
 * `menuitem` (which carries the floor).
 */

const PAGE = (id: string, title: string, folder: string | null): CodexPageSummary => ({
  id,
  title,
  folder,
  entityType: "note",
  fields: {},
  hiddenFields: [],
  characterUpdatedAt: {},
  tags: [],
  revealedToPlayers: false,
  bannerAssetId: null,
  inWorldLabel: null,
  calendarInstant: null,
  inWorldDate: null,
  rev: 1,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  playerUpdatedAt: "2026-07-28T00:00:00.000Z",
  firstShownAt: null
});

const handlers = () => ({
  collapsed: new Set<string>(),
  selectedId: null,
  sort: "name-asc" as const,
  onToggle: vi.fn(),
  onSelect: vi.fn(),
  onNewInFolder: vi.fn(),
  onNewSubfolder: vi.fn(),
  onRenameFolder: vi.fn(),
  onDeleteFolder: vi.fn(),
  onMovePage: vi.fn(),
  onMoveFolder: vi.fn(),
  onRequestMove: vi.fn(),
  onRequestMoveFolder: vi.fn()
});

const renderTree = (h: ReturnType<typeof handlers>) =>
  render(<NotebookTree node={buildFolderTree([PAGE("p1", "Strahd", "NPCs")], ["NPCs"])} {...h} />);

/** The row's action control. `Menu`'s trigger is a `<summary>` with no `button` role in jsdom, so find it by name. */
const folderMenu = () => screen.getByLabelText("Actions for NPCs");

describe("Notebook folder row: one action control for four actions", () => {
  it("puts every folder action behind a single menu trigger", async () => {
    const user = userEvent.setup();
    renderTree(handlers());

    // The row carries exactly two controls: the folder name and the ⋯ trigger.
    const row = folderMenu().closest(".codex-tree-folder-row") as HTMLElement;
    const onRow = [...row.querySelectorAll("button, summary")].filter((el) => !el.closest(".nh-menu-popover"));
    expect(onRow).toHaveLength(2);

    await user.click(folderMenu());
    const items = within(row)
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    // "Move to top level" is the touch-friendly way to move a folder; still one control on the row.
    expect(items).toEqual(["New subfolder", "New page here", "Rename folder", "Move to top level", "Delete folder"]);
  });

  it("no action sits on a bare button any more: each is a menu item, which is what carries the floor", async () => {
    const user = userEvent.setup();
    const { container } = renderTree(handlers());

    // The removed button class must not come back either.
    expect(container.querySelectorAll(".codex-tree-folder-btn")).toHaveLength(0);

    await user.click(folderMenu());
    for (const label of ["New subfolder", "New page here", "Rename folder", "Move to top level", "Delete folder"]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
  });

  it("still runs all four actions on the right folder", async () => {
    const user = userEvent.setup();
    const h = handlers();
    renderTree(h);

    for (const [label, spy] of [
      ["New subfolder", h.onNewSubfolder],
      ["New page here", h.onNewInFolder],
      ["Rename folder", h.onRenameFolder],
      ["Delete folder", h.onDeleteFolder]
    ] as const) {
      if (!(folderMenu().parentElement as HTMLDetailsElement).open) await user.click(folderMenu());
      await user.click(screen.getByRole("menuitem", { name: label }));
      expect(spy).toHaveBeenCalledWith("NPCs");
    }
  });
});

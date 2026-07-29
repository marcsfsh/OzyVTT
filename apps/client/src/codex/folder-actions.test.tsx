import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NotebookTree, buildFolderTree } from "./NotebookTree";
import type { CodexPageSummary } from "./api";

/**
 * **The notebook folder row's actions — §4's touch floor, solved by removing UI rather than resizing it.**
 *
 * A folder row used to carry four bare icon buttons (new subfolder / new note / rename / delete), measured
 * 13–15px wide at a 375px viewport. Neither §4 route could rescue them: route 2 centres a 44px box on ~15px
 * of paint, a 14.5px overhang per side against ~8px of separation, so each button would steal its
 * neighbour's taps; route 1 needs 4 × 44 = 176px of actions inside a row measured at 223px on a ~343px rail.
 * The fix is that four controls do not belong on a tree row — they are one `Menu`, which carries the floor
 * itself.
 *
 * **What these tests can and cannot prove.** jsdom loads no stylesheet (see `test/setup.ts`), so the pixel
 * floor itself is a browser measurement, not something assertable here. What IS assertable — and what
 * actually keeps the fix from being undone — is the *structure* the floor rests on: one control on the row
 * instead of four, and every action living on a `role="menuitem"`, which is the element `.nh-menu-item`
 * gives `min-height: var(--tap-min)`. A future edit that re-adds a bare button to the row fails these.
 */

const PAGE = (id: string, title: string, folder: string | null): CodexPageSummary => ({
  id, title, folder, entityType: "note", fields: {}, tags: [], revealedToPlayers: false, bannerAssetId: null,
  inWorldLabel: null, calendarInstant: null, inWorldDate: null, rev: 1,
  createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z"
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
  onRequestMove: vi.fn()
});

const renderTree = (h: ReturnType<typeof handlers>) =>
  render(<NotebookTree node={buildFolderTree([PAGE("p1", "Strahd", "NPCs")], ["NPCs"])} {...h} />);

/** The row's one action control, named for its folder. `Menu`'s trigger is a `<summary>`, whose implicit
    role is not `button` in jsdom's mapping, so it is found by its accessible name rather than by role. */
const folderMenu = () => screen.getByLabelText("Actions for NPCs");

describe("Notebook folder row — one action control, not four (§4)", () => {
  it("puts every folder action behind a single menu trigger", async () => {
    const user = userEvent.setup();
    renderTree(handlers());

    // The ROW itself carries exactly two controls: the folder name (expand/collapse) and the ⋯ trigger.
    // Anything inside the popover is not on the row — that is the entire point of the change.
    const row = folderMenu().closest(".codex-tree-folder-row") as HTMLElement;
    const onRow = [...row.querySelectorAll("button, summary")].filter((el) => !el.closest(".nh-menu-popover"));
    expect(onRow).toHaveLength(2);

    await user.click(folderMenu());
    const items = within(row).getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(["New subfolder", "New note here", "Rename folder", "Delete folder"]);
  });

  it("no action sits on a bare button any more — each is a menu item, which is what carries the floor", async () => {
    const user = userEvent.setup();
    const { container } = renderTree(handlers());

    // The four sub-floor buttons are gone by class as well as by count: the CSS rule that styled them at
    // 13–15px went with them, so a re-introduction cannot quietly inherit it.
    expect(container.querySelectorAll(".codex-tree-folder-btn")).toHaveLength(0);

    await user.click(folderMenu());
    for (const label of ["New subfolder", "New note here", "Rename folder", "Delete folder"]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
  });

  it("still runs all four actions on the right folder", async () => {
    const user = userEvent.setup();
    const h = handlers();
    renderTree(h);

    for (const [label, spy] of [
      ["New subfolder", h.onNewSubfolder],
      ["New note here", h.onNewInFolder],
      ["Rename folder", h.onRenameFolder],
      ["Delete folder", h.onDeleteFolder]
    ] as const) {
      if (!(folderMenu().parentElement as HTMLDetailsElement).open) await user.click(folderMenu());
      await user.click(screen.getByRole("menuitem", { name: label }));
      expect(spy).toHaveBeenCalledWith("NPCs");
    }
  });
});

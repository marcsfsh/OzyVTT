import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SortDialog } from "./SortDialog";

// The Sort dialog over any list's columns: levels in order, each column once, dates starting newest first.

type Key = "name" | "size" | "modified";
const LABEL: Record<Key, string> = { name: "Name", size: "Size", modified: "Modified" };

function dialog(onSort = vi.fn(), onCancel = vi.fn()) {
  render(
    <SortDialog<Key>
      levels={[{ key: "name", direction: "asc" }]}
      keys={["name", "size", "modified"]}
      keyLabel={(key) => LABEL[key]}
      directionLabel={(key, direction) =>
        key === "modified"
          ? direction === "desc"
            ? "Newest first"
            : "Oldest first"
          : direction === "asc"
            ? "A to Z"
            : "Z to A"
      }
      firstDirection={(key) => (key === "modified" ? "desc" : "asc")}
      maxLevels={2}
      onCancel={onCancel}
      onSort={onSort}
    />
  );
  return { onSort, onCancel, box: within(screen.getByRole("dialog", { name: "Sort" })) };
}

describe("the Sort dialog", () => {
  it("adds the next unused column as a level, and moves it up", async () => {
    const user = userEvent.setup();
    const { onSort, box } = dialog();
    await user.click(box.getByRole("button", { name: "Add a level" }));
    expect(box.getByLabelText("Then by: column")).toHaveValue("size");
    await user.selectOptions(box.getByLabelText("Then by: column"), "modified");
    expect(box.getByLabelText("Then by: order")).toHaveValue("desc");
    expect(box.getByRole("button", { name: "Add a level" })).toBeDisabled();
    await user.click(box.getByRole("button", { name: "Move up" }));
    await user.click(box.getByRole("button", { name: "Sort" }));
    expect(onSort).toHaveBeenCalledWith([
      { key: "modified", direction: "desc" },
      { key: "name", direction: "asc" }
    ]);
  });

  it("offers each column once, and keeps at least one level", async () => {
    const user = userEvent.setup();
    const { onSort, onCancel, box } = dialog();
    await user.click(box.getByRole("button", { name: "Add a level" }));
    const second = box.getByLabelText("Then by: column");
    expect(within(second).getByRole("option", { name: "Name" })).toBeDisabled();
    await user.click(box.getByRole("button", { name: "Delete this level: Size" }));
    expect(box.getByRole("button", { name: "Delete this level: Name" })).toBeDisabled();
    await user.click(box.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSort).not.toHaveBeenCalled();
  });
});

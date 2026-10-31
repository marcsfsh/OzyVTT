import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SideList, SideListGroup, SideListRow } from "./SideList";

// One side list (theme rule 13): an eyebrow of words, then rows of a leading icon or face, a name and a count.

describe("the side list", () => {
  it("draws each row's leading slot, name and count, and marks the chosen row", async () => {
    const onSelect = vi.fn();
    render(
      <SideList
        label="Maps"
        groups={[
          {
            eyebrow: "Maps",
            rows: [
              { key: "all", label: "All maps", count: 6, current: true },
              { key: "act1", label: "Act 1", leading: <svg data-testid="folder" />, count: 3, onSelect }
            ]
          }
        ]}
      />
    );
    const list = screen.getByRole("navigation", { name: "Maps" });
    const rows = within(list).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual(["All maps6", "Act 13"]);
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(rows[1]).not.toHaveAttribute("aria-current");
    expect(within(rows[1]!).getByTestId("folder")).toBeInTheDocument();
    await userEvent.setup().click(rows[1]!);
    expect(onSelect).toHaveBeenCalled();
  });

  it("indents a tree 16px a level", () => {
    render(
      <SideListGroup eyebrow="Folders">
        <SideListRow label="Act 1" />
        <SideListRow label="Act 1/Camp" depth={1} />
      </SideListGroup>
    );
    const nested = screen.getByRole("button", { name: "Act 1/Camp" });
    expect(nested.style.getPropertyValue("--sidelist-depth")).toBe("1");
    expect(screen.getByRole("button", { name: "Act 1" }).style.getPropertyValue("--sidelist-depth")).toBe("");
  });

  it("names its group by the eyebrow's words, which take no count", () => {
    render(
      <SideListGroup eyebrow="Folders">
        <SideListRow label="Act 1" count={2} />
      </SideListGroup>
    );
    expect(screen.getByRole("group", { name: "Folders" })).toBeInTheDocument();
    expect(screen.getByText("Folders")).toHaveClass("nh-sidelist-eyebrow");
  });

  it("links a row that has an address", () => {
    render(
      <SideListGroup>
        <SideListRow label="Device" href="/settings/device" current />
      </SideListGroup>
    );
    expect(screen.getByRole("link", { name: "Device" })).toHaveAttribute("aria-current", "page");
  });
});

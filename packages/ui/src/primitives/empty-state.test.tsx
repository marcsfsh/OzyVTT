import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";

// An empty state is one line and an optional secondary button: no heading, icon or box (theme spec rule 3).

describe("EmptyState", () => {
  it("says what is missing in one line, with the button that fixes it", () => {
    const { container } = render(<EmptyState action={<Button>New encounter</Button>}>No encounters yet.</EmptyState>);
    expect(screen.getByText("No encounters yet.").tagName).toBe("P");
    expect(screen.getByRole("button", { name: "New encounter" }).className).toContain("nh-btn--secondary");
    expect(container.querySelector("h1, h2, h3, h4, svg")).toBeNull();
  });

  it("stands without a button", () => {
    render(<EmptyState>Nothing needs you.</EmptyState>);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

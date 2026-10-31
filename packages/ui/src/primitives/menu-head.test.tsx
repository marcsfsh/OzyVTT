import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MenuHead } from "./Menu";

// A menu about one thing names it (theme rule 15): the name in display capitals and its line beside it.

describe("a menu's head", () => {
  it("shows the thing's name and its line, and a close where it has one", () => {
    render(<MenuHead name="Goblin Boss" line="Monster · 15/21" end={<button type="button">Close menu</button>} />);
    expect(screen.getByText("Goblin Boss")).toHaveClass("nh-menu-head-name");
    expect(screen.getByText("Monster · 15/21")).toHaveClass("nh-menu-head-line");
    expect(screen.getByRole("button", { name: "Close menu" })).toBeInTheDocument();
  });
});

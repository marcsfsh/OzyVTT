import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CodexMarkdown } from "./CodexMarkdown";

// A page's links and template headings as each audience reads them: the GM can make a page a link names, a
// player reads such a link as plain words, and a player never sees a heading the GM left empty.

const BODY = [
  "## Description",
  "",
  "## Points of interest",
  "A frontier town under the shadow of [[Wave Echo Cave]], near [[Phandalin]].",
  "",
  "## Rumors"
].join("\n");
const KNOWN = new Set(["phandalin"]);

describe("a link to a page that doesn't exist", () => {
  it("offers the GM to create it", async () => {
    const onCreate = vi.fn();
    const onNavigate = vi.fn();
    render(<CodexMarkdown text={BODY} onNavigate={onNavigate} knownTitles={KNOWN} onCreate={onCreate} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create the page Wave Echo Cave" }));
    expect(onCreate).toHaveBeenCalledWith("Wave Echo Cave");
    await user.click(screen.getByRole("button", { name: "Phandalin" }));
    expect(onNavigate).toHaveBeenCalledWith("Phandalin");
  });

  it("reads as plain text for a player", () => {
    render(<CodexMarkdown text={BODY} onNavigate={() => {}} knownTitles={KNOWN} audience="player" />);
    expect(screen.queryByRole("button", { name: /Wave Echo Cave/ })).toBeNull();
    const words = screen.getByText("Wave Echo Cave");
    expect(words.className).toBe("");
    expect(screen.getByRole("button", { name: "Phandalin" })).toBeTruthy();
  });
});

describe("a page template's empty headings", () => {
  it("are left out of a player's page, and the filled ones stay", () => {
    render(<CodexMarkdown text={BODY} audience="player" />);
    expect(screen.queryByRole("heading", { name: "Description" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Rumors" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Points of interest" })).toBeTruthy();
  });

  it("keep a heading whose content sits under a subheading", () => {
    render(<CodexMarkdown text={"# Lore\n### The founding\nIt was long ago.\n# Empty"} audience="player" />);
    expect(screen.getByRole("heading", { name: "Lore" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "The founding" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Empty" })).toBeNull();
  });

  it("all stay for the GM, who is still writing them", () => {
    render(<CodexMarkdown text={BODY} />);
    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
      "Description",
      "Points of interest",
      "Rumors"
    ]);
  });
});

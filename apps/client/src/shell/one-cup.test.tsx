import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "@vtt/ui";
import { setViewport } from "../../test/viewport";
import { BarPrimary, SectionBar } from "./SectionBar";

// One Cup in view (theme rule 2): the bar's New is the Cup until the page shows a Cup of its own.

const bar = (page: React.ReactNode) => (
  <SectionBar
    name="Prep"
    navLabel="Prep pages"
    pages={[{ id: "encounters", label: "Encounters" }]}
    activeId="encounters"
    onChange={() => {}}
    end={<BarPrimary label="New encounter" onClick={() => {}} />}
  >
    {page}
  </SectionBar>
);

describe("one Cup in view", () => {
  it("draws the bar's New as the Cup, words only, when the page has none", () => {
    setViewport(1280);
    render(bar(<p>A list</p>));
    const cup = screen.getByRole("button", { name: "New encounter" });
    expect(cup).toHaveClass("nh-btn--primary");
    expect(cup.querySelector("svg")).toBeNull();
  });

  it("steps the bar's New down to a Base line button with its + when the page shows its own Cup", async () => {
    setViewport(1280);
    render(bar(<Button variant="primary">Make live</Button>));
    const step = await screen.findByRole("button", { name: "New encounter" });
    await vi.waitFor(() => expect(step).not.toHaveClass("nh-btn--primary"));
    expect(screen.getByRole("button", { name: "New encounter" }).querySelector("svg")).not.toBeNull();
    expect(document.querySelectorAll(".nh-btn--primary")).toHaveLength(1);
  });
});

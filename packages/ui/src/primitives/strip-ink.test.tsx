import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreAnimate, stubAnimate } from "../../test/animate";
import { Tabs } from "./Tabs";

const TABS = [
  { id: "spells", label: "Spells" },
  { id: "gear", label: "Gear" },
  { id: "notes", label: "Notes" }
];

afterEach(() => restoreAnimate());

describe("the strip's ink", () => {
  it("is one hidden line in the strip, shown under the chosen tab and hidden when none is chosen", () => {
    const { container, rerender } = render(<Tabs tabs={TABS} activeId="gear" onChange={() => {}} ariaLabel="Sheet" />);
    const ink = container.querySelector(".nh-tabs-ink")!;
    expect(container.querySelectorAll(".nh-tabs-ink")).toHaveLength(1);
    expect(ink).toHaveAttribute("aria-hidden", "true");
    expect(ink).not.toHaveAttribute("hidden");
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    rerender(<Tabs tabs={TABS} activeId="" onChange={() => {}} ariaLabel="Sheet" />);
    expect(ink).toHaveAttribute("hidden");
  });

  it("runs no light on the first render, or at all without the Web Animations API", () => {
    const { container, rerender } = render(<Tabs tabs={TABS} activeId="gear" onChange={() => {}} ariaLabel="Sheet" />);
    rerender(<Tabs tabs={TABS} activeId="notes" onChange={() => {}} ariaLabel="Sheet" />);
    expect(container.querySelector(".lr-part")).toBeNull();
  });

  it("drains the old ink, runs a comet along the strip and fills the new ink when the tab changes", () => {
    stubAnimate();
    const { container, rerender } = render(
      <Tabs tabs={TABS} activeId="spells" onChange={() => {}} ariaLabel="Sheet" />
    );
    expect(container.querySelector(".lr-part")).toBeNull();
    rerender(<Tabs tabs={TABS} activeId="notes" onChange={() => {}} ariaLabel="Sheet" />);
    const strip = screen.getByRole("tablist");
    expect(strip.querySelector(":scope > .lr-ink-ghost")).not.toBeNull();
    expect(strip.querySelector(":scope > .lr-comet")).not.toBeNull();
    expect(strip.querySelector(":scope > .lr-burst")).not.toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("hands the trip to `onTravel` and draws no comet of its own", () => {
    stubAnimate();
    const travel = vi.fn();
    const { rerender } = render(
      <Tabs tabs={TABS} activeId="spells" onChange={() => {}} ariaLabel="Sections" onTravel={travel} />
    );
    rerender(<Tabs tabs={TABS} activeId="gear" onChange={() => {}} ariaLabel="Sections" onTravel={travel} />);
    const strip = screen.getByRole("tablist");
    expect(travel).toHaveBeenCalledWith(
      screen.getByRole("tab", { name: "Spells" }),
      screen.getByRole("tab", { name: "Gear" })
    );
    expect(strip.querySelector(".lr-comet")).toBeNull();
    expect(strip.querySelector(".lr-ink-ghost")).not.toBeNull();
  });

  it("sits along the start of a vertical strip's tabs", () => {
    const { container } = render(
      <Tabs tabs={TABS} activeId="gear" onChange={() => {}} ariaLabel="Steps" orientation="vertical" />
    );
    expect(container.querySelector(".nh-tabs-ink")).toHaveAttribute("data-edge", "start");
  });
});

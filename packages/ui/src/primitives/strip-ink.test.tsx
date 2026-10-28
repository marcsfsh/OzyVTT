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

  describe("on its line", () => {
    // jsdom lays nothing out: tabs 100px apart in a strip 100px into a 1280px bar marked as the horizon.
    const layout = () => {
      vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute("role") === "tab") return TABS.findIndex((tab) => tab.label === this.textContent) * 100;
        return parseFloat(this.style.left) || 0;
      });
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        if (this.hasAttribute("data-horizon")) return { left: 0, width: 1280 } as DOMRect;
        if (this.getAttribute("role") === "tablist") return { left: 100, width: 300 } as DOMRect;
        return { left: 0, width: 0 } as DOMRect;
      });
    };
    afterEach(() => vi.restoreAllMocks());

    it("lies on its bar's horizon and shows the stretch of it where it lies", () => {
      layout();
      const { container } = render(
        <header data-horizon="">
          <Tabs tabs={TABS} activeId="gear" onChange={() => {}} ariaLabel="Sections" onHorizon />
        </header>
      );
      const ink = container.querySelector<HTMLElement>(".nh-tabs-ink")!;
      expect(ink).toHaveAttribute("data-on-horizon");
      expect(ink.style.getPropertyValue("--ink-win-w")).toBe("1280px");
      // The bar's left edge is 200px left of the ink, under Gear.
      expect(ink.style.getPropertyValue("--ink-win-x")).toBe("-200px");
    });

    it("leaves the old tab a copy that shows its own stretch of the horizon as it drains", () => {
      layout();
      stubAnimate();
      const { container, rerender } = render(
        <header data-horizon="">
          <Tabs tabs={TABS} activeId="spells" onChange={() => {}} ariaLabel="Sections" onHorizon />
        </header>
      );
      rerender(
        <header data-horizon="">
          <Tabs tabs={TABS} activeId="notes" onChange={() => {}} ariaLabel="Sections" onHorizon />
        </header>
      );
      const ghost = container.querySelector<HTMLElement>(".lr-ink-ghost")!;
      expect(
        container.querySelector<HTMLElement>(".nh-tabs-ink:not(.lr-ink-ghost)")!.style.getPropertyValue("--ink-win-x")
      ).toBe("-300px");
      expect(ghost.style.getPropertyValue("--ink-win-x")).toBe("-100px");
    });

    it("moves onto the strip's line by the strip's --nh-ink-shift", () => {
      const style = document.createElement("style");
      style.textContent = ".over-the-line { --nh-ink-shift: 1px; }";
      document.head.append(style);
      const { container } = render(
        <Tabs tabs={TABS} activeId="gear" onChange={() => {}} ariaLabel="Sheet" className="over-the-line" />
      );
      expect(container.querySelector<HTMLElement>(".nh-tabs-ink")!.style.top).toBe("1px");
      expect(container.querySelector(".nh-tabs-ink")).not.toHaveAttribute("data-on-horizon");
      style.remove();
    });
  });
});

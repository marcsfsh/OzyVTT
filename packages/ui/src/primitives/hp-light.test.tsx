import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreAnimate, stubAnimate, type Played } from "../../test/animate";
import { Chip } from "./Chip";
import { LifeBar } from "./LifeBar";
import { Portrait } from "./Portrait";

const parts = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const on = (played: Played[], selector: string) => played.filter((call) => call.el.matches(selector));

afterEach(() => {
  restoreAnimate();
  vi.restoreAllMocks();
  document.querySelectorAll(".lr-ghost").forEach((ghost) => ghost.remove());
});

describe("the life bar's light", () => {
  let played: Played[];
  beforeEach(() => {
    played = stubAnimate();
  });

  it("stays still on the first render", () => {
    render(<LifeBar hp={{ current: 30, maximum: 44 }} />);
    expect(played).toHaveLength(0);
  });

  it("runs a red comet to the new value as damage lands, and the fill follows it", () => {
    const { rerender } = render(<LifeBar hp={{ current: 38, maximum: 44 }} />);
    rerender(<LifeBar hp={{ current: 29, maximum: 44 }} />);
    expect(parts(".nh-lifebar-well > .lr-comet.lr-red")).toHaveLength(1);
    expect(parts(".nh-lifebar-well > .lr-burst.lr-red")).toHaveLength(1);
    const [fill] = on(played, ".nh-lifebar-left");
    expect(fill?.frames.map((frame) => frame.clipPath)).toEqual([
      `inset(0 ${(1 - 38 / 44) * 100}% 0 0)`,
      `inset(0 ${(1 - 29 / 44) * 100}% 0 0)`
    ]);
  });

  it("runs gold as hit points come back", () => {
    const { rerender } = render(<LifeBar hp={{ current: 20, maximum: 44 }} />);
    rerender(<LifeBar hp={{ current: 27, maximum: 44 }} />);
    expect(parts(".lr-comet.lr-gold")).toHaveLength(1);
    expect(parts(".lr-comet.lr-red")).toHaveLength(0);
  });

  it("draws the temporary hit points line with a cyan comet as they arrive", () => {
    const { rerender } = render(<LifeBar hp={{ current: 38, maximum: 44, temporary: 0 }} />);
    rerender(<LifeBar hp={{ current: 38, maximum: 44, temporary: 5 }} />);
    expect(on(played, ".nh-lifebar-templine")).toHaveLength(1);
    expect(parts(".lr-comet.lr-cyan")).toHaveLength(1);
    expect(on(played, ".nh-lifebar-temp")).toHaveLength(1);
  });

  it("runs a band's change along its line with no number", () => {
    const { rerender } = render(<LifeBar band={{ label: "Healthy", band: "healthy" }} />);
    rerender(<LifeBar band={{ label: "Bloodied", band: "bloodied" }} />);
    expect(parts(".nh-lifebar--band > .lr-comet.lr-red")).toHaveLength(1);
    expect(document.querySelector(".nh-lifebar")?.textContent).not.toMatch(/\d/);
  });

  it("stays still without motion", () => {
    restoreAnimate();
    const { rerender } = render(<LifeBar hp={{ current: 38, maximum: 44 }} />);
    rerender(<LifeBar hp={{ current: 10, maximum: 44 }} />);
    expect(parts(".lr-part")).toHaveLength(0);
    expect(document.querySelector(".nh-lifebar-now")).toHaveTextContent("10");
  });
});

describe("a portrait going down", () => {
  it("dims as the creature drops", () => {
    const played = stubAnimate();
    const picture = { fallback: "gem" } as const;
    const { rerender } = render(<Portrait picture={picture} />);
    rerender(<Portrait picture={picture} down />);
    expect(document.querySelector(".nh-portrait")).toHaveClass("is-down");
    expect(on(played, ".nh-portrait")).toHaveLength(1);
  });
});

describe("a chip leaving", () => {
  beforeEach(() => {
    stubAnimate();
    // jsdom lays nothing out; the copy needs a box to stand in.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 10,
      right: 110,
      bottom: 34,
      width: 100,
      height: 24,
      x: 10,
      y: 10,
      toJSON: () => ({})
    } as DOMRect);
  });

  it("leaves a split copy where it was when it leaves its strip", async () => {
    const strip = (shown: boolean) => (
      <span>
        {shown && (
          <Chip leave="split" tone="info">
            Concentration
          </Chip>
        )}
        <Chip>Prone</Chip>
      </span>
    );
    const { rerender } = render(strip(true));
    rerender(strip(false));
    await Promise.resolve();
    const ghost = document.querySelector(".lr-ghost");
    expect(ghost).toHaveAttribute("aria-hidden", "true");
    expect(ghost?.textContent).toBe("Concentration");
  });

  it("leaves nothing when its whole strip goes", async () => {
    const { unmount } = render(
      <span>
        <Chip leave="split">Concentration</Chip>
      </span>
    );
    unmount();
    await Promise.resolve();
    expect(document.querySelector(".lr-ghost")).toBeNull();
  });
});

import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOrderLight } from "./orderLight";

/** jsdom has no Web Animations API; this records which elements were animated, so the light runs. */
function stubAnimate(): Element[] {
  const animated: Element[] = [];
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element) {
      animated.push(this);
      const finished = new Promise<Animation>(() => {});
      return { finished, cancel: () => {} } as unknown as Animation;
    }
  });
  return animated;
}

/** jsdom lays nothing out: each tile sits 100px further along, so a trip has a length. */
function giveBoxes() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const index = Number(this.closest("li")?.getAttribute("data-index") ?? 0);
    const left = this.matches(".counter") ? 0 : 100 + index * 100;
    return { left, top: 0, right: left + 80, bottom: 60, width: 80, height: 60, x: left, y: 0 } as DOMRect;
  });
}

function Order({ keys, acting, round }: Readonly<{ keys: string[]; acting: string | null; round: number | null }>) {
  const host = useRef<HTMLDivElement>(null);
  const tile = (key: string) => host.current?.querySelector<HTMLElement>(`li[data-key="${key}"]`) ?? null;
  useOrderLight(host, {
    keys,
    acting,
    round,
    item: tile,
    frame: (key) => tile(key)?.querySelector<HTMLElement>(".picture") ?? null,
    counter: () => host.current?.querySelector<HTMLElement>(".counter") ?? null,
    axis: "x",
    rail: () => 59
  });
  return (
    <div ref={host}>
      <span className="counter">RND</span>
      <ol>
        {keys.map((key, index) => (
          <li key={key} data-key={key} data-index={index}>
            <span className="picture" />
            <span className="turn-tile-score">12</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const parts = (selector: string) => document.querySelectorAll(selector).length;

afterEach(() => {
  delete (Element.prototype as { animate?: unknown }).animate;
  vi.restoreAllMocks();
});

describe("the turn order's light", () => {
  let animated: Element[];
  beforeEach(() => {
    animated = stubAnimate();
    giveBoxes();
  });

  it("runs nothing on the first render", () => {
    render(<Order keys={["a", "b"]} acting="a" round={1} />);
    expect(animated).toHaveLength(0);
  });

  it("runs from the counter to the first creature as an encounter starts, and lands each score", () => {
    const { rerender } = render(<Order keys={[]} acting={null} round={null} />);
    rerender(<Order keys={["a", "b"]} acting="a" round={1} />);
    expect(parts(".lr-comet")).toBe(1);
    expect(parts(".lr-burst")).toBe(1);
    expect(parts(".lr-sunframe")).toBe(1);
    expect(animated.filter((el) => el.matches(".turn-tile-score"))).toHaveLength(2);
  });

  it("runs from one creature to the next and slides the sun frame on a new turn", () => {
    const { rerender } = render(<Order keys={["a", "b"]} acting="a" round={1} />);
    rerender(<Order keys={["a", "b"]} acting="b" round={1} />);
    expect(parts(".lr-comet")).toBe(1);
    expect(parts(".lr-sunframe")).toBe(1);
  });

  it("runs back to the counter when the order ends, with no sun frame where the tiles were", () => {
    const { rerender } = render(<Order keys={["a", "b"]} acting="b" round={2} />);
    rerender(<Order keys={[]} acting={null} round={null} />);
    expect(parts(".lr-comet")).toBe(1);
    expect(parts(".lr-sunframe")).toBe(0);
  });

  it("sends a comet each way when two creatures trade places", () => {
    const { rerender } = render(<Order keys={["a", "b", "c"]} acting="c" round={1} />);
    rerender(<Order keys={["b", "a", "c"]} acting="c" round={1} />);
    expect(parts(".lr-comet")).toBe(2);
  });

  it("drains the rail where a creature that leaves the order was", () => {
    const { rerender } = render(<Order keys={["a", "b", "c"]} acting="a" round={1} />);
    rerender(<Order keys={["a", "c"]} acting="a" round={1} />);
    expect(parts(".lr-drop-mark")).toBe(1);
  });

  it("stays still without motion", () => {
    delete (Element.prototype as { animate?: unknown }).animate;
    const { rerender } = render(<Order keys={["a", "b"]} acting="a" round={1} />);
    rerender(<Order keys={["a", "b"]} acting="b" round={1} />);
    expect(parts(".lr-part")).toBe(0);
  });
});

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReconnectBar } from "./ReconnectBar";

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

let animated: Element[];
beforeEach(() => {
  animated = stubAnimate();
});
afterEach(() => {
  delete (Element.prototype as { animate?: unknown }).animate;
});

describe("the reconnect bar's line", () => {
  it("waits on a still grey line, then lights it as the table comes back", () => {
    const { rerender, container } = render(<ReconnectBar current />);
    rerender(<ReconnectBar current={false} />);
    const line = container.querySelector(".reconnect-bar-line");
    expect(line).not.toBeNull();
    expect(animated).not.toContain(line);
    rerender(<ReconnectBar current />);
    expect(container.querySelector(".reconnect-bar.is-back > .lr-comet")).not.toBeNull();
    expect(animated).toContain(container.querySelector(".reconnect-bar-line"));
  });
});

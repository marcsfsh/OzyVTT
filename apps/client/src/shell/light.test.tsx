import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pageLight } from "./pageLight";
import { useRecordLight } from "./recordLight";

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

afterEach(() => {
  delete (Element.prototype as { animate?: unknown }).animate;
  document.body.replaceChildren();
});

describe("the page light", () => {
  let animated: Element[];
  beforeEach(() => {
    animated = stubAnimate();
  });

  function frame() {
    document.body.innerHTML = `
      <main>
        <header class="app-bar" data-horizon=""><button id="from">Prep</button><button id="to">Codex</button></header>
        <div class="app-pane"><div class="roll-call-dock"></div><div class="page"></div><section class="anim-view"></section></div>
      </main>`;
    const at = (selector: string) => document.querySelector<HTMLElement>(selector)!;
    return { from: at("#from"), to: at("#to"), horizon: at("[data-horizon]"), pane: at(".app-pane") };
  }

  it("runs the trip along the horizon, washes the pane and fades the page in", () => {
    const { from, to, horizon, pane } = frame();
    pageLight(from, to);
    expect(horizon.querySelector(":scope > .lr-comet")).not.toBeNull();
    expect(horizon.querySelector(":scope > .lr-burst")).not.toBeNull();
    expect(pane.querySelector(":scope > .lr-wash")).not.toBeNull();
    expect(animated).toContain(pane.querySelector(".page"));
  });

  it("leaves the rows that ride along and a page that fades itself alone", () => {
    const { from, to, pane } = frame();
    pageLight(from, to);
    expect(animated).not.toContain(pane.querySelector(".roll-call-dock"));
    expect(animated).not.toContain(pane.querySelector(".anim-view"));
  });

  it("does nothing without the Web Animations API", () => {
    delete (Element.prototype as { animate?: unknown }).animate;
    const { from, to } = frame();
    pageLight(from, to);
    expect(document.querySelector(".lr-part")).toBeNull();
  });
});

describe("the record light", () => {
  function Shell({ recordKey, rows }: Readonly<{ recordKey: string | null; rows: readonly string[] }>) {
    const host = useRef<HTMLDivElement>(null);
    useRecordLight(host, recordKey, { content: ":scope > .cx-content" });
    return (
      <div ref={host} className="cx-shell">
        <div className="cx-content">
          {rows.map((key) => (
            <button key={key} type="button" data-record-key={key}>
              {key}
            </button>
          ))}
        </div>
      </div>
    );
  }

  it("runs no light on the first render", () => {
    stubAnimate();
    const { container } = render(<Shell recordKey="equipment:acid" rows={["equipment:acid"]} />);
    expect(container.querySelector(".lr-part")).toBeNull();
  });

  it("washes the record as it opens, and runs light along the row where the list stays beside it", () => {
    const animated = stubAnimate();
    const { container, rerender } = render(<Shell recordKey={null} rows={["equipment:acid", "spell:shield"]} />);
    act(() => rerender(<Shell recordKey="equipment:acid" rows={["equipment:acid", "spell:shield"]} />));
    const shell = container.querySelector(".cx-shell")!;
    expect(shell.querySelector(":scope > .lr-wash")).not.toBeNull();
    expect(shell.querySelector(":scope > .lr-comet")).not.toBeNull();
    expect(animated).toContain(shell.querySelector(".cx-content"));
  });

  it("runs the light back along the row the record came from", () => {
    stubAnimate();
    const { container, rerender } = render(<Shell recordKey="spell:shield" rows={[]} />);
    act(() => rerender(<Shell recordKey={null} rows={["equipment:acid", "spell:shield"]} />));
    const shell = container.querySelector(".cx-shell")!;
    expect(shell.querySelector(":scope > .lr-wash")).toBeNull();
    // jsdom lays nothing out, so the trip has no length and no direction to check here.
    expect(shell.querySelectorAll(":scope > .lr-comet")).toHaveLength(1);
    expect(shell.querySelector(":scope > .lr-burst")).not.toBeNull();
  });
});

import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { restoreAnimate, stubAnimate, type Played } from "../../test/animate";
import { usePipLight } from "../motion/pips";
import { Checklist } from "./Checklist";
import { Skeleton } from "./Skeleton";
import { Steps } from "./Steps";
import { Switch } from "./Switch";

const parts = (selector: string) => [...document.querySelectorAll(selector)];

let played: Played[];
beforeEach(() => {
  played = stubAnimate();
});
afterEach(restoreAnimate);

function Pips({ lit }: Readonly<{ lit: number }>) {
  const row = useRef<HTMLSpanElement>(null);
  usePipLight(row, lit);
  return (
    <span ref={row} className="row">
      {[0, 1, 2, 3].map((index) => (
        <i key={index} className={index < lit ? "is-on" : undefined} />
      ))}
    </span>
  );
}

describe("pips", () => {
  it("cool the one spent with an afterglow", () => {
    const { rerender, container } = render(<Pips lit={3} />);
    rerender(<Pips lit={2} />);
    const pips = container.querySelectorAll("i");
    expect(played.map((call) => call.el)).toEqual([pips[2]]);
    expect(parts(".lr-pop")).toHaveLength(0);
  });

  it("relight in order with a burst each when a rest brings them back", () => {
    const { rerender } = render(<Pips lit={1} />);
    rerender(<Pips lit={4} />);
    expect(parts(".lr-pop")).toHaveLength(3);
    const delays = played.filter((call) => call.el.matches("i")).map((call) => call.options.delay);
    expect(delays).toEqual([0, 60, 120]);
  });
});

describe("small controls", () => {
  it("run light through a switch's track as it turns on", () => {
    const { rerender } = render(<Switch checked={false} onChange={() => {}} aria-label="Sound" />);
    rerender(<Switch checked onChange={() => {}} aria-label="Sound" />);
    expect(parts(".nh-switch-track > .lr-comet.lr-cyan")).toHaveLength(1);
  });

  it("burst a checked box and run along its row", () => {
    const items = (done: boolean) => [{ text: "Find the key", done }];
    const { rerender } = render(<Checklist items={items(false)} ariaLabel="Goals" />);
    rerender(<Checklist items={items(true)} ariaLabel="Goals" />);
    expect(parts(".nh-checklist-item > .lr-pop")).toHaveLength(1);
    expect(parts(".nh-checklist-item > .lr-comet")).toHaveLength(1);
  });

  it("run one comet over a group of loading plates, and never loop", () => {
    render(
      <div>
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
    expect(parts(".nh-skeleton > .lr-comet")).toHaveLength(1);
    expect(played.every((call) => call.options.iterations === undefined)).toBe(true);
  });

  it("run light to the next step", () => {
    const steps = [{ label: "Class" }, { label: "Species" }, { label: "Abilities" }];
    const { rerender } = render(<Steps steps={steps} current={0} />);
    rerender(<Steps steps={steps} current={1} />);
    // jsdom lays nothing out, so neither form reads as shown; nothing runs rather than light in the wrong place.
    expect(parts(".lr-part")).toHaveLength(0);
  });
});

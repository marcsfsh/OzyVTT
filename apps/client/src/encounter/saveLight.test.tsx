import { render } from "@testing-library/react";
import { useRef } from "react";
import type { DeathSaves } from "@vtt/domain";
import { Chip, useChipStrip } from "@vtt/ui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSaveLight } from "./saveLight";

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
});

const saves = (successes: number, failures: number, stable = false): DeathSaves =>
  ({ successes, failures, stable }) as DeathSaves;

function Tracker({ value }: Readonly<{ value: DeathSaves }>) {
  const host = useRef<HTMLDivElement>(null);
  useSaveLight(host, value, { success: ".ok", failure: ".bad", word: ".word" });
  return (
    <div ref={host}>
      <span className="word">{value.stable ? "Stable" : "Dying"}</span>
      {[0, 1, 2].map((index) => (
        <i key={`ok${index}`} className="ok" data-on={index < value.successes} />
      ))}
      {[0, 1, 2].map((index) => (
        <i key={`bad${index}`} className="bad" data-on={index < value.failures} />
      ))}
    </div>
  );
}

function Strip({ names }: Readonly<{ names: string[] }>) {
  const host = useRef<HTMLSpanElement>(null);
  useChipStrip(host);
  return (
    <span ref={host}>
      {names.map((name) => (
        <Chip key={name}>{name}</Chip>
      ))}
    </span>
  );
}

describe("death saves lighting", () => {
  let animated: Element[];
  beforeEach(() => {
    animated = stubAnimate();
  });

  it("fills the newly marked pip with a cyan pop for a success", () => {
    const { rerender, container } = render(<Tracker value={saves(1, 0)} />);
    rerender(<Tracker value={saves(2, 0)} />);
    expect(animated).toContain(container.querySelectorAll(".ok")[1]);
    expect(container.querySelectorAll(".lr-pop.lr-cyan")).toHaveLength(1);
  });

  it("pops red for a failure", () => {
    const { rerender, container } = render(<Tracker value={saves(0, 0)} />);
    rerender(<Tracker value={saves(0, 1)} />);
    expect(container.querySelectorAll(".lr-pop.lr-red")).toHaveLength(1);
  });

  it("lights the word as the creature turns stable", () => {
    const { rerender, container } = render(<Tracker value={saves(2, 1)} />);
    rerender(<Tracker value={saves(3, 1, true)} />);
    expect(animated).toContain(container.querySelector(".word"));
    expect(container.querySelectorAll(".lr-burst.lr-cyan")).toHaveLength(1);
  });
});

describe("a chip strip", () => {
  it("settles in only the chip that arrived, never the first render's", () => {
    const animated = stubAnimate();
    const { rerender } = render(<Strip names={["Prone"]} />);
    expect(animated).toHaveLength(0);
    rerender(<Strip names={["Prone", "Poisoned"]} />);
    expect(animated.map((el) => el.textContent)).toEqual(["Poisoned"]);
  });
});

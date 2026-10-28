import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { restoreAnimate, stubAnimate, type Played } from "../../test/animate";
import { Lamp, MoveLamp } from "./Lamp";
import { Roll } from "./Roll";
import { VcrCounter } from "./VcrCounter";

const on = (played: Played[], selector: string) => played.filter((call) => call.el.matches(selector));

afterEach(restoreAnimate);

describe("a tape counter's roll", () => {
  let played: Played[];
  beforeEach(() => {
    played = stubAnimate();
  });

  it("stays still on the first render", () => {
    render(<Roll value="03" />);
    expect(played).toHaveLength(0);
    expect(document.querySelector(".lr-roll-out")).toBeNull();
  });

  it("rolls the old value out over the new one when the value changes", () => {
    const { rerender } = render(<Roll value="03" />);
    rerender(<Roll value="04" />);
    expect(document.querySelector(".nh-roll-now")).toHaveTextContent("04");
    expect(document.querySelector(".lr-roll-out")).toHaveTextContent("03");
    expect(on(played, ".nh-roll-now")).toHaveLength(1);
  });

  it("removes the old value once it has rolled away", async () => {
    const { rerender } = render(<Roll value="03" />);
    rerender(<Roll value="04" />);
    for (const call of on(played, ".lr-roll-out")) call.finish();
    await Promise.resolve();
    expect(document.querySelector(".lr-roll-out")).toBeNull();
  });

  it("rolls the VCR counter's words and round", () => {
    const { rerender } = render(<VcrCounter round={null} />);
    rerender(<VcrCounter round={1} />);
    const leaving = [...document.querySelectorAll(".lr-roll-out")].map((part) => part.textContent);
    expect(leaving).toEqual(["STOP", "--"]);
  });
});

describe("a lamp's light", () => {
  let played: Played[];
  beforeEach(() => {
    played = stubAnimate();
  });

  it("warms with a burst in its colour when it lights", () => {
    const { rerender } = render(<Lamp kind="action" label="Action" lit={false} />);
    expect(played).toHaveLength(0);
    rerender(<Lamp kind="action" label="Action" lit />);
    expect(on(played, ".nh-lamp-light")).toHaveLength(1);
    expect(document.querySelector(".nh-lamp > .lr-pop")).not.toBeNull();
  });

  it("cools through its afterglow when it is spent", () => {
    const { rerender } = render(<Lamp kind="bonus" label="Bonus" lit />);
    rerender(<Lamp kind="bonus" label="Bonus" lit={false} />);
    const [cooling] = on(played, ".nh-lamp-light");
    expect(cooling?.frames[0]?.boxShadow).toBe("var(--nh-lamp-afterglow)");
    expect(document.querySelector(".lr-pop")).toBeNull();
  });

  it("cools the move gauge when the last foot is spent", () => {
    const { rerender } = render(<MoveLamp feetLeft={5} speedFeet={30} />);
    rerender(<MoveLamp feetLeft={0} speedFeet={30} />);
    expect(on(played, ".nh-lamp-gauge")).toHaveLength(1);
  });

  it("stays still under reduced motion", () => {
    restoreAnimate();
    const { rerender } = render(<Lamp kind="action" label="Action" lit={false} />);
    rerender(<Lamp kind="action" label="Action" lit />);
    expect(document.querySelector(".lr-part")).toBeNull();
  });
});

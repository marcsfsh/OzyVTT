import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreAnimate, stubAnimate, type Played } from "../../test/animate";
import { Button } from "../primitives/Button";
import { installCupPress } from "./press";

let played: Played[];
let uninstall: () => void;
beforeEach(() => {
  played = stubAnimate();
  uninstall = installCupPress();
  // jsdom lays nothing out: a 200px button whose left edge is at 100px.
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 100 } as DOMRect);
});
afterEach(() => {
  uninstall();
  restoreAnimate();
  vi.restoreAllMocks();
});

const parts = (button: HTMLElement) => [...button.querySelectorAll(":scope > .lr-part")] as HTMLElement[];
const origin = (button: HTMLElement) =>
  button.querySelector<HTMLElement>(".lr-cup-line")?.style.getPropertyValue("transform-origin");

describe("the Cup's press", () => {
  it("fills the cup and lights the base from where the pointer went down", () => {
    render(<Button variant="primary">End turn</Button>);
    const button = screen.getByRole("button", { name: "End turn" });
    fireEvent.pointerDown(button, { clientX: 160 });
    expect(parts(button).map((part) => part.className)).toEqual(["lr-part lr-cup-fill", "lr-part lr-cup-line"]);
    expect(parts(button).every((part) => part.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(origin(button)).toBe("60px 50%");
    // The rising layer settles back and the line fades: nothing stays lit.
    expect(played.every((call) => (call.frames.at(-1) as { opacity: number }).opacity === 0)).toBe(true);
  });

  it("lights from the middle for a keyboard press, and removes its parts when they finish", () => {
    render(<Button variant="primary">Make live</Button>);
    const button = screen.getByRole("button", { name: "Make live" });
    fireEvent.click(button, { detail: 0 });
    expect(origin(button)).toBe("100px 50%");
    return Promise.all(played.map((call) => call.finish())).then(() =>
      new Promise((resolve) => setTimeout(resolve)).then(() => expect(parts(button)).toHaveLength(0))
    );
  });

  it("lights the encounter panel's own primary too, and leaves the quiet one, the cyan step and the rest dark", () => {
    render(
      <div>
        <button type="button" className="encounter-primary">
          Roll
        </button>
        <button type="button" className="encounter-primary is-quiet">
          Confirm
        </button>
        <button type="button" className="encounter-primary resume">
          Next turn
        </button>
        <Button>Rename</Button>
        <Button variant="primary" disabled>
          Create
        </Button>
      </div>
    );
    for (const name of ["Roll", "Confirm", "Next turn", "Rename", "Create"])
      fireEvent.pointerDown(screen.getByRole("button", { name }), { clientX: 150 });
    expect(parts(screen.getByRole("button", { name: "Roll" }))).toHaveLength(2);
    for (const name of ["Confirm", "Next turn", "Rename", "Create"])
      expect(parts(screen.getByRole("button", { name })), name).toHaveLength(0);
  });

  it("runs nothing under reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    render(<Button variant="primary">End turn</Button>);
    const button = screen.getByRole("button", { name: "End turn" });
    fireEvent.pointerDown(button, { clientX: 160 });
    expect(parts(button)).toHaveLength(0);
  });
});

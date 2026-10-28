import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreAnimate, stubAnimate, type Played } from "../../test/animate";
import { Menu, MenuItem } from "./Menu";
import { Modal } from "./Modal";
import { ToastProvider, useToast } from "./Toast";

/** jsdom lays nothing out; the light needs a box to measure. */
function giveBoxes() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 40,
    top: 60,
    right: 440,
    bottom: 360,
    width: 400,
    height: 300,
    x: 40,
    y: 60,
    toJSON: () => ({})
  } as DOMRect);
}

const flush = () => act(async () => await Promise.resolve());
const animated = (played: Played[], selector: string) => played.some((call) => call.el.matches(selector));

afterEach(() => {
  restoreAnimate();
  document.querySelectorAll(".lr-ghost").forEach((ghost) => ghost.remove());
});

describe("a dialog's edge", () => {
  let played: Played[];
  beforeEach(() => {
    played = stubAnimate();
    giveBoxes();
  });

  it("is a hidden line along the top that lights as the dialog opens", () => {
    render(
      <Modal open onClose={() => {}} title="Rest">
        Body
      </Modal>
    );
    const edge = document.querySelector(".nh-modal-surface > .nh-overlay-edge");
    expect(edge).toHaveAttribute("aria-hidden", "true");
    expect(animated(played, ".nh-overlay-edge")).toBe(true);
  });

  it("has no edge when the dialog asks for no accent", () => {
    render(
      <Modal open onClose={() => {}} title="Rest" accent="none">
        Body
      </Modal>
    );
    expect(document.querySelector(".nh-overlay-edge")).toBeNull();
  });

  it("closes at once and leaves an inert copy, with no ids, that removes itself", async () => {
    const { rerender } = render(
      <Modal open onClose={() => {}} title="Rest">
        <input id="rest-hours" aria-label="Hours" />
      </Modal>
    );
    rerender(
      <Modal open={false} onClose={() => {}} title="Rest">
        <input id="rest-hours" aria-label="Hours" />
      </Modal>
    );
    await flush();
    expect(document.querySelector("dialog")?.open).toBe(false);
    expect(document.querySelector(".nh-modal-surface:not(.lr-ghost *)")).toBeNull();
    const ghost = document.querySelector(".lr-ghost:not(.lr-ghost-scrim)")!;
    expect(ghost).toHaveAttribute("aria-hidden", "true");
    expect(ghost.querySelector("[id]")).toBeNull();
    expect(document.querySelector(".lr-ghost-scrim")).not.toBeNull();
    played.filter((call) => ghost.contains(call.el) || call.el === ghost).forEach((call) => call.finish());
    await flush();
    expect(document.querySelector(".lr-ghost:not(.lr-ghost-scrim)")).toBeNull();
  });

  it("leaves a copy when the caller unmounts it while it is open", async () => {
    const { unmount } = render(
      <Modal open onClose={() => {}} title="Rest">
        Body
      </Modal>
    );
    unmount();
    await flush();
    expect(document.querySelector(".lr-ghost")).not.toBeNull();
  });
});

describe("without motion", () => {
  it("closes at once and draws nothing", async () => {
    giveBoxes();
    const { rerender } = render(
      <Modal open onClose={() => {}} title="Rest">
        Body
      </Modal>
    );
    rerender(
      <Modal open={false} onClose={() => {}} title="Rest">
        Body
      </Modal>
    );
    await flush();
    expect(document.querySelector("dialog")?.open).toBe(false);
    expect(document.querySelector(".lr-ghost, .lr-part")).toBeNull();
  });
});

describe("a menu's edge", () => {
  it("lights from the trigger as the menu opens and leaves a copy as it closes", async () => {
    const played = stubAnimate();
    giveBoxes();
    render(
      <Menu trigger="Encounter">
        <MenuItem>End the encounter</MenuItem>
      </Menu>
    );
    const details = document.querySelector("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(animated(played, ".nh-menu-popover > .nh-overlay-edge")).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "End the encounter" }));
    expect(details.open).toBe(false);
    expect(document.querySelector(".lr-ghost .nh-menu-popover")).not.toBeNull();
  });
});

describe("a toast's edge", () => {
  function Speak() {
    const { toast } = useToast();
    return (
      <button type="button" onClick={() => toast("Encounter saved.", { tone: "success" })}>
        Save
      </button>
    );
  }

  it("runs a comet along the top as it arrives and leaves a sinking copy when dismissed", async () => {
    const played = stubAnimate();
    giveBoxes();
    render(
      <ToastProvider>
        <Speak />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const card = document.querySelector(".nh-toast")!;
    expect(card.querySelector(":scope > .lr-comet")).not.toBeNull();
    expect(animated(played, ".nh-toast > .nh-overlay-edge")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await flush();
    expect(document.querySelector(".nh-toast:not(.lr-ghost *)")).toBeNull();
    expect(document.querySelector(".lr-ghost .nh-toast")).not.toBeNull();
  });
});

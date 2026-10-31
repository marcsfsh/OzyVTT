import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Drawer } from "./Drawer";
import { Modal } from "./Modal";

// One way a phone sheet opens (theme rule 16): the handle, then the title and the close over a hairline.

// Drawer.css is left out: jsdom cannot compute some of its rules, so the drawer's case checks the markup the CSS keys.
const sheets = ["src/primitives/Modal.css"];
let styles: HTMLStyleElement[] = [];
beforeEach(() => {
  styles = sheets.map((path) => {
    const style = document.createElement("style");
    style.textContent = readFileSync(`${process.cwd()}/${path}`, "utf8");
    document.head.append(style);
    return style;
  });
});
afterEach(() => styles.forEach((style) => style.remove()));

const handleOf = (root: Element) => root.querySelector(".nh-sheet-handle")!;

describe("a phone sheet's head", () => {
  it("draws the handle above the title and a close named Close on a sheet from the bottom", () => {
    render(
      <Modal open onClose={() => {}} title="Who plays" align="bottom">
        <p>Body</p>
      </Modal>
    );
    const dialog = screen.getByRole("dialog", { name: "Who plays", hidden: true });
    const handle = handleOf(dialog);
    expect(getComputedStyle(handle).display).toBe("block");
    expect(handle.nextElementSibling).toHaveClass("nh-modal-head");
    expect(within(dialog).getByRole("button", { name: "Close", hidden: true })).toBeInTheDocument();
  });

  it("keeps the handle off a dialog that opens in the middle", () => {
    render(
      <Modal open onClose={() => {}} title="Rename">
        <p>Body</p>
      </Modal>
    );
    expect(getComputedStyle(handleOf(screen.getByRole("dialog", { name: "Rename", hidden: true }))).display).toBe(
      "none"
    );
  });

  it("draws it on a drawer from the bottom", () => {
    const { container } = render(
      <Drawer open onClose={() => {}} title="Rules" side="bottom">
        <p>Body</p>
      </Drawer>
    );
    expect(container.querySelector(".nh-drawer--bottom > .nh-sheet-handle + .nh-drawer-head")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});

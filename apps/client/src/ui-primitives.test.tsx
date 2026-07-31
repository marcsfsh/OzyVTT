/**
 * Direct tests for `@vtt/ui` primitives whose contract is behavioural rather than visual.
 *
 * **Why these live in `apps/client` rather than `packages/ui`.** That package has no test script and no
 * test harness at all - only `check` - so primitives are otherwise exercised only indirectly, through
 * whichever feature happens to render them. That is adequate for a Button and inadequate for a control
 * whose defining property is something a feature test would never assert.
 *
 * `Drawer` is exactly that case. The whole reason it is not built on `Modal` is that the session console
 * must stay usable *alongside* the Codex mode behind it: no top layer, no focus trap, no scroll lock, and
 * no swallowing of Escape meant for the surface still running. None of that is visible in a screenshot,
 * and all of it would be silently lost by a later "simplification" onto `<dialog>`. So it is asserted here.
 *
 * jsdom caveat (`test/setup.ts`): layout and pointer geometry are not real here, so the 44px tap floor is
 * NOT verifiable in this file and still wants a browser check.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Drawer } from "@vtt/ui";

describe("Drawer", () => {
  it("renders titled, closeable, non-modal, and inert while closed", async () => {
    const onClose = vi.fn();
    const { rerender, container } = render(
      <><button type="button">Outside</button><Drawer open={false} onClose={onClose} title="Session 14"><button type="button">Inside</button></Drawer></>
    );
    const panel = container.querySelector("aside")!;
    expect(panel.tagName).toBe("ASIDE");
    // Non-modal: never a <dialog>, so nothing can be in the top layer or focus-trapped.
    expect(container.querySelector("dialog")).toBeNull();
    expect(panel.className).not.toContain("is-open");
    // Closed but still mounted (so the slide plays both ways) - `inert` is what keeps its controls out of
    // the tab order and out of the accessibility tree while it is off-screen.
    expect(panel.hasAttribute("inert")).toBe(true);
    // …and `aria-hidden` says the same thing to engines that do not implement `inert` yet. Safe to pair
    // here precisely BECAUSE `inert` has already made the subtree unfocusable.
    expect(panel.getAttribute("aria-hidden")).toBe("true");
    // Named by its own visible title without a caller-supplied label. Queried through the DOM rather
    // than by role, since the closed panel is (correctly) absent from the accessibility tree.
    expect(panel.getAttribute("aria-labelledby")).toBe(panel.querySelector("h2")!.id);

    rerender(<><button type="button">Outside</button><Drawer open onClose={onClose} title="Session 14"><button type="button">Inside</button></Drawer></>);
    expect(panel.className).toContain("is-open");
    expect(panel.hasAttribute("inert")).toBe(false);
    expect(panel.hasAttribute("aria-hidden")).toBe(false);
    expect(screen.getByRole("heading", { name: "Session 14" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // Escape closes, but only from inside. A global listener would eat Escape from the Codex mode still
    // running behind the drawer - which is the precise failure a non-modal panel invites.
    screen.getByRole("button", { name: "Inside" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    screen.getByRole("button", { name: "Outside" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("takes an explicit label and a side", () => {
    const { container } = render(
      <Drawer open onClose={() => {}} side="left" ariaLabel="Session console" title={<span>Session 14</span>}>body</Drawer>
    );
    const panel = container.querySelector("aside")!;
    expect(panel.className).toContain("nh-drawer--left");
    expect(panel.getAttribute("aria-label")).toBe("Session console");
    // An explicit label wins outright rather than being stacked with a generated one - two names on one
    // landmark is an ambiguity, not redundancy.
    expect(panel.hasAttribute("aria-labelledby")).toBe(false);
  });
});

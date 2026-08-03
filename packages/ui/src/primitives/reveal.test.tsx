/**
 * The reveal family, and the four words it owns (D28).
 *
 * These components came from `apps/client/src/codex/SecretMarkers.tsx`, where they were the Codex's one
 * answer to "do the players see this?". Every surface asks that question now — homebrew records, the
 * staging tray, archived previews, per-replay visibility, adding a monster, moving a token between
 * layers — so the components moved here and the words moved with them. **The words are the contract.**
 * They were previously covered only indirectly, by the Codex vocabulary scanner reading the file they
 * lived in; that scanner cannot see a ternary's branches, so the switch's two labels had no pin at all.
 * They have one now, and it is here, where the strings are.
 *
 * The counterpart lock lives in `apps/client/src/codex/vocabulary.test.ts`: no Codex source may type
 * the two record-axis phrases itself, so the only way to say them is through this component.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GmOnlyTag, HiddenFromPlayers, RevealSwitch, VisibilityBadge } from "./Reveal";

describe("RevealSwitch — the one reveal toggle", () => {
  it("says the state in the glossary's exact words, both ways round", () => {
    const view = render(<RevealSwitch revealed onChange={() => {}} />);
    expect(screen.getByRole("switch")).toHaveTextContent("Shown to players");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");

    view.rerender(<RevealSwitch revealed={false} onChange={() => {}} />);
    // "Hidden from players" and not "GM only": the record axis and the content axis used to share one
    // phrase, and on a journal row both appeared at once, answering two different questions.
    expect(screen.getByRole("switch")).toHaveTextContent("Hidden from players");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("keeps one constant name whatever the state says, and takes the caller's when given", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const view = render(<RevealSwitch revealed={false} onChange={onChange} />);
    // The default exists so a control that forgets its own name is still announced as an action rather
    // than as whichever state it happens to be in.
    expect(screen.getByRole("switch")).toHaveAccessibleName("Show to players");
    await user.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);

    view.rerender(<RevealSwitch revealed onChange={onChange} ariaLabel="Show this quest to players" />);
    expect(screen.getByRole("switch")).toHaveAccessibleName("Show this quest to players");
  });

  it("reserves the other label's width so the track cannot walk out from under the pointer (D23c)", () => {
    const { container } = render(<RevealSwitch revealed onChange={() => {}} />);
    expect(container.querySelector(".nh-stableswap-ghost")!.getAttribute("data-stable-swap-alt")).toBe("Hidden from players");
  });

  it("can take the label band, for the form rows it now appears in", () => {
    render(<RevealSwitch revealed={false} onChange={() => {}} banded />);
    expect(screen.getByRole("switch").className).toContain("nh-switch--banded");
  });
});

describe("VisibilityBadge — the same fact, read-only", () => {
  it("says the words AND draws the mark, in both states — never colour alone", () => {
    // The palette is heavy in the red-pink-magenta band and reserves violet for GM-only content, so no
    // state in this system may be carried by hue. Icon first, word always.
    const view = render(<VisibilityBadge revealed />);
    expect(screen.getByText("Shown to players")).toBeInTheDocument();
    expect(view.container.querySelector("svg")).not.toBeNull();

    view.rerender(<VisibilityBadge revealed={false} />);
    expect(screen.getByText("Hidden from players")).toBeInTheDocument();
    expect(view.container.querySelector("svg")).not.toBeNull();
  });

  it("says exactly what the switch says — a card and its toggle cannot drift into two vocabularies", () => {
    const badge = render(<VisibilityBadge revealed />);
    const badgeWords = badge.container.textContent;
    badge.unmount();
    const control = render(<RevealSwitch revealed onChange={() => {}} />);
    expect(control.container.textContent).toBe(badgeWords);
  });

  it("is width-stable too — these sit in card headers whose contents must not shuffle", () => {
    const { container } = render(<VisibilityBadge revealed={false} />);
    expect(container.querySelector(".nh-stableswap-ghost")!.getAttribute("data-stable-swap-alt")).toBe("Shown to players");
  });
});

describe("The two axes stay two axes", () => {
  it("marks a withheld record with the record words, and GM-only content with the content pill", () => {
    const record = render(<HiddenFromPlayers />);
    expect(record.container.textContent!.trim()).toBe("Hidden from players");
    expect(record.container.querySelector("svg"), "the pill must carry the eye-off mark, not colour alone").not.toBeNull();
    // Never violet: violet is reserved for GM-only CONTENT, and a hidden record is one switch away from
    // being shared while a GM body never will be.
    expect(record.container.querySelector(".nh-badge")!.className).not.toContain("nh-badge--violet");
    record.unmount();

    const content = render(<GmOnlyTag />);
    expect(content.container.textContent).toBe("GM only");
    expect(content.container.querySelector(".nh-badge")!.className).toContain("nh-badge--violet");
  });

  it("corner-anchors the content pill on request, without eating the clicks in that corner", () => {
    const { container } = render(<GmOnlyTag floating />);
    expect(container.querySelector(".nh-badge")!.className).toContain("nh-reveal-pill--floating");
  });
});

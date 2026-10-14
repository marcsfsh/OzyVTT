/**
 * The reveal family and its words, which are the contract. `apps/client/src/codex/vocabulary.test.ts` is the
 * counterpart: no Codex source may type the record-axis phrases itself.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GmOnlyTag, HiddenFromPlayers, RevealSwitch, VisibilityBadge } from "./Reveal";

describe("RevealSwitch — the one reveal toggle", () => {
  it("says the state in the glossary's exact words, both ways round", () => {
    // Icon-only: the two strings live in the tooltip and `title`, still written in one place.
    const view = render(<RevealSwitch revealed onChange={() => {}} />);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Shown to players");
    expect(screen.getByRole("switch")).toHaveAttribute("title", "Shown to players");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");

    view.rerender(<RevealSwitch revealed={false} onChange={() => {}} />);
    // "Hidden from players", not "GM only", so the record axis never collides with the content pill.
    expect(screen.getByRole("tooltip")).toHaveTextContent("Hidden from players");
    expect(screen.getByRole("switch")).toHaveAttribute("title", "Hidden from players");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("never becomes an unnamed icon — ruling 17's own constraint", () => {
    // An icon-only toggle must keep its name: asserted per carrier (screen reader, pointer, long press).
    render(<RevealSwitch revealed={false} onChange={() => {}} ariaLabel="Show this page to players" />);
    const control = screen.getByRole("switch");
    expect(control).toHaveAccessibleName("Show this page to players");
    expect(control).toHaveAttribute("title");
    expect(control.querySelector("svg"), "the state is a glyph as well as a colour").not.toBeNull();
    expect(screen.getByRole("tooltip"), "a pointer gets the words too").toBeInTheDocument();
  });

  it("keeps one constant name whatever the state says, and takes the caller's when given", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const view = render(<RevealSwitch revealed={false} onChange={onChange} />);
    // The default announces an action rather than a state.
    expect(screen.getByRole("switch")).toHaveAccessibleName("Show to players");
    await user.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);

    view.rerender(<RevealSwitch revealed onChange={onChange} ariaLabel="Show this quest to players" />);
    expect(screen.getByRole("switch")).toHaveAccessibleName("Show this quest to players");
  });

  it("cannot walk out from under the pointer at all any more (D23c, closed by ruling 17)", () => {
    // Icon-only, so the width is constant and no label reservation (StableSwap) is needed; keep it that way.
    const view = render(<RevealSwitch revealed onChange={() => {}} />);
    expect(view.container.querySelector(".nh-stableswap")).toBeNull();
    const on = screen.getByRole("switch").className;
    view.rerender(<RevealSwitch revealed={false} onChange={() => {}} />);
    expect(screen.getByRole("switch").className.replace(" is-revealed", "")).toBe(on.replace(" is-revealed", ""));
  });

  it("can take the label band, for the form rows it now appears in", () => {
    const { container } = render(<RevealSwitch revealed={false} onChange={() => {}} banded />);
    expect(container.querySelector(".nh-reveal")!.className).toContain("nh-reveal--banded");
  });
});

describe("VisibilityBadge — the same fact, read-only", () => {
  it("draws the mark and NAMES it, in both states — no visible label, never colour alone", () => {
    // The read-only mark is the same icon-only eye (no badge, no printed words), and the glyph changes with the state
    // so it never relies on hue.
    const view = render(<VisibilityBadge revealed />);
    expect(screen.getByRole("img")).toHaveAccessibleName("Shown to players");
    expect(screen.getByRole("img")).toHaveAttribute("title", "Shown to players");
    expect(view.container.querySelector("svg")).not.toBeNull();
    // No badge box and no printed label; the words reach a pointer through the tooltip.
    expect(view.container.querySelector(".nh-badge")).toBeNull();
    expect(screen.getByText("Shown to players")).toHaveAttribute("role", "tooltip");

    view.rerender(<VisibilityBadge revealed={false} />);
    expect(screen.getByRole("img")).toHaveAccessibleName("Hidden from players");
    expect(view.container.querySelector("svg")).not.toBeNull();
  });

  it("says exactly what the switch says — a card and its toggle cannot drift into two vocabularies", () => {
    const badge = render(<VisibilityBadge revealed />);
    const badgeWords = badge.container.textContent;
    badge.unmount();
    const control = render(<RevealSwitch revealed onChange={() => {}} />);
    expect(control.container.textContent).toBe(badgeWords);
  });

  it("is width-stable by construction — these sit in card headers whose contents must not shuffle", () => {
    // No StableSwap: a fixed square holds one of two glyphs.
    const view = render(<VisibilityBadge revealed={false} />);
    expect(view.container.querySelector(".nh-stableswap")).toBeNull();
    const off = screen.getByRole("img").className;
    view.rerender(<VisibilityBadge revealed />);
    expect(screen.getByRole("img").className.replace(" is-revealed", "")).toBe(off);
  });
});

describe("The two axes stay two axes", () => {
  it("marks a withheld record with the record MARK, and GM-only content with the content pill", () => {
    const record = render(<HiddenFromPlayers />);
    // Same eye-off, colour and position as everywhere; the words are in the name, title and tooltip.
    expect(screen.getByRole("img")).toHaveAccessibleName("Hidden from players");
    expect(record.container.querySelector("svg"), "the mark must be a glyph, not colour alone").not.toBeNull();
    // Never violet and never a badge: violet is reserved for GM-only content.
    expect(record.container.querySelector(".nh-badge")).toBeNull();
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

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { restoreAnimate, stubAnimate, type Played } from "../../test/animate";
import { AttentionBell } from "./AttentionBell";

afterEach(restoreAnimate);

describe("the attention bell", () => {
  let played: Played[];
  beforeEach(() => {
    played = stubAnimate();
  });

  it("renders nothing while nothing waits", () => {
    const { container } = render(<AttentionBell count={0} label="Waiting, 0" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows its count on the badge and names itself when it stands alone", () => {
    render(<AttentionBell count={3} label="Waiting, 3" />);
    expect(screen.getByRole("img", { name: "Waiting, 3" })).toHaveTextContent("3");
  });

  it("rings once with a burst when the count rises, and stays still when it falls", () => {
    const { rerender } = render(<AttentionBell count={1} />);
    expect(played).toHaveLength(0);
    rerender(<AttentionBell count={2} />);
    const rang = played.length;
    expect(rang).toBeGreaterThan(0);
    rerender(<AttentionBell count={1} />);
    expect(played).toHaveLength(rang);
  });
});

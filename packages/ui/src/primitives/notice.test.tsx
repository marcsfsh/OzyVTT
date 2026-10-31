import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Notice } from "./Notice";

// One notice (theme rule 21): its meaning's 3px edge and frame, no fill.

describe("a notice", () => {
  it.each(["caution", "info", "danger", "success", "violet"] as const)("draws the %s edge from its tone", (tone) => {
    render(
      <Notice tone={tone} role="status">
        Words
      </Notice>
    );
    expect(screen.getByRole("status")).toHaveClass("nh-notice", `nh-notice--${tone}`);
  });
});

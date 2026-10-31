import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tick } from "./Tick";

// Picking several is ticks (theme 2.5): a checkbox and its words.

describe("a tick", () => {
  it("is a checkbox named by its words that reports its new state", async () => {
    const onChange = vi.fn();
    render(<Tick checked={false} onChange={onChange} label="roll:create" />);
    const tick = screen.getByRole("checkbox", { name: "roll:create" });
    expect(tick).not.toBeChecked();
    await userEvent.setup().click(tick);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

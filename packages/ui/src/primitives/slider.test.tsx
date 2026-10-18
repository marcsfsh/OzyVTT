import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Slider } from "./Slider";

function Level({ onCommit }: Readonly<{ onCommit: (value: number) => void }>) {
  const [value, setValue] = useState(0.7);
  return <Slider value={value} onChange={setValue} onCommit={onCommit} label="Music volume" />;
}

describe("Slider", () => {
  it("reads and sets a 0-1 level as a percentage, and commits when let go", () => {
    const onCommit = vi.fn();
    render(<Level onCommit={onCommit} />);
    const input = screen.getByRole("slider", { name: "Music volume" });
    expect(input).toHaveAttribute("aria-valuetext", "70%");
    fireEvent.change(input, { target: { value: "35" } });
    expect(input).toHaveAttribute("aria-valuetext", "35%");
    expect(screen.getByText("35%")).toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(input);
    expect(onCommit).toHaveBeenLastCalledWith(0.35);
  });

  it("can keep its label for screen readers only", () => {
    render(<Slider value={0} onChange={() => {}} label="Rain volume" hideLabel />);
    expect(screen.getByRole("slider", { name: "Rain volume" })).toBeInTheDocument();
    expect(screen.getByText("Rain volume")).toHaveClass("nh-sr-only");
  });
});

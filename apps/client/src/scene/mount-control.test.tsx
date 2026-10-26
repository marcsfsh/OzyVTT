import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MountControl } from "./MountControl";

describe("riding from a token's menu", () => {
  it("offers each mount within reach, controlled or on its own, and the way off the one it rides", () => {
    const onMount = vi.fn();
    const { rerender } = render(
      <MountControl
        name="Borin"
        riding={null}
        mounts={[{ id: "horse", name: "Warhorse" }]}
        busy={false}
        onMount={onMount}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Ride Warhorse" }));
    expect(onMount).toHaveBeenCalledWith("horse", "controlled");
    fireEvent.click(screen.getByRole("button", { name: "Ride Warhorse, acting on its own" }));
    expect(onMount).toHaveBeenLastCalledWith("horse", "independent");
    rerender(<MountControl name="Borin" riding="Warhorse" mounts={[]} busy={false} onMount={onMount} />);
    expect(screen.getByText(/can only Dash, Disengage or Dodge/)).toBeTruthy();
    rerender(
      <MountControl name="Borin" riding="Warhorse" controls={false} mounts={[]} busy={false} onMount={onMount} />
    );
    expect(screen.getByText("Warhorse acts on its own.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismount from Warhorse" }));
    expect(onMount).toHaveBeenLastCalledWith(null);
    rerender(<MountControl name="Borin" riding={null} mounts={[]} busy={false} onMount={onMount} />);
    expect(screen.queryByRole("group", { name: "Borin's mount" })).toBeNull();
  });
});

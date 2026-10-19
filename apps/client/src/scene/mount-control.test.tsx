import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MountControl } from "./MountControl";

describe("riding from a token's menu", () => {
  it("offers each mount within reach, and the way off the one it rides", () => {
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
    expect(onMount).toHaveBeenCalledWith("horse");
    rerender(<MountControl name="Borin" riding="Warhorse" mounts={[]} busy={false} onMount={onMount} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismount from Warhorse" }));
    expect(onMount).toHaveBeenLastCalledWith(null);
    rerender(<MountControl name="Borin" riding={null} mounts={[]} busy={false} onMount={onMount} />);
    expect(screen.queryByRole("group", { name: "Borin's mount" })).toBeNull();
  });
});

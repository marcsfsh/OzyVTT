import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HeightControl } from "./HeightControl";
import { TokenAltitudeBadge } from "./tokenGlyph";

// A creature's height on the map: the badge that shows it, and the token menu's way to change it.

describe("a creature's height", () => {
  it("shows how high a token is, and nothing on the ground", () => {
    const { container, rerender } = render(
      <svg>
        <TokenAltitudeBadge sizePx={40} altitudeFeet={20} />
      </svg>
    );
    expect(container.querySelector(".token-altitude text")?.textContent).toBe("20 ft");
    expect(container.querySelector(".token-altitude title")?.textContent).toBe("20 feet up");
    rerender(
      <svg>
        <TokenAltitudeBadge sizePx={40} />
      </svg>
    );
    expect(container.querySelector(".token-altitude")).toBeNull();
  });

  it("lets the creature whose move counts fly up in place, by the way it moves", () => {
    const onMove = vi.fn();
    render(
      <HeightControl
        name="Red Dragon"
        altitudeFeet={10}
        airborne="fly"
        mode="fly"
        canMove
        gm={false}
        busy={false}
        onMove={onMove}
        onSet={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Increase" }));
    fireEvent.click(screen.getByRole("button", { name: "Fly to 15 ft up" }));
    expect(onMove).toHaveBeenCalledWith(15);
    expect(screen.queryByRole("button", { name: "Set height" })).toBeNull();
  });

  it("offers nothing to a walker, and the GM a free placement on a surface or in the air", () => {
    const { container, rerender } = render(
      <HeightControl
        name="Borin"
        altitudeFeet={0}
        airborne={undefined}
        mode="walk"
        canMove
        gm={false}
        busy={false}
        onMove={() => {}}
        onSet={() => {}}
      />
    );
    expect(container.textContent).toBe("");
    const onSet = vi.fn();
    rerender(
      <HeightControl
        name="Borin"
        altitudeFeet={0}
        airborne={undefined}
        mode="walk"
        canMove={false}
        gm
        busy={false}
        onMove={() => {}}
        onSet={onSet}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Increase" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase" }));
    fireEvent.click(screen.getByRole("button", { name: "Set height" }));
    expect(onSet).toHaveBeenLastCalledWith(10, null);
    fireEvent.click(screen.getByRole("switch", { name: "In the air" }));
    fireEvent.click(screen.getByRole("button", { name: "Set height" }));
    expect(onSet).toHaveBeenLastCalledWith(10, "fly");
  });
});

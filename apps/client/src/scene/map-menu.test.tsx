import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { useMenuDismiss, useMenuPlacement } from "./menuPlacement";

// The map's menus (C2 spec 2.1): beside the thing and inside the window on a laptop, from the view's foot on a phone,
// one at a time, and Escape gives the focus back to the thing.

function TestMenu({ name, x, y, onClose }: Readonly<{ name: string; x: number; y: number; onClose: () => void }>) {
  const ref = useRef<HTMLDivElement | null>(null);
  const style = useMenuPlacement(ref, x, y);
  useMenuDismiss(ref, onClose);
  return (
    <div ref={ref} role="menu" aria-label={name} style={style}>
      {name}
    </div>
  );
}

const setPhone = (phone: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes("max-width: 760px"),
    addEventListener() {},
    removeEventListener() {}
  })) as unknown as typeof window.matchMedia;
};

afterEach(() => setPhone(false));

describe("a map menu", () => {
  it("keeps inside the window on a laptop", () => {
    setPhone(false);
    render(<TestMenu name="Door" x={5000} y={5000} onClose={() => {}} />);
    const menu = screen.getByRole("menu", { name: "Door" });
    expect(parseFloat(menu.style.left)).toBeLessThanOrEqual(window.innerWidth);
    expect(parseFloat(menu.style.top)).toBeLessThanOrEqual(window.innerHeight);
  });

  it("opens from the view's foot on a phone, with 10px gutters", () => {
    setPhone(true);
    render(<TestMenu name="Door" x={100} y={100} onClose={() => {}} />);
    const menu = screen.getByRole("menu", { name: "Door" });
    expect(menu.style.left).toBe("10px");
    expect(menu.style.right).toBe("10px");
    expect(menu.style.top).toBe("auto");
  });

  it("closes the one open when another opens, and gives the focus back on Escape", async () => {
    const user = userEvent.setup();
    const thing = document.createElement("button");
    thing.textContent = "Token";
    document.body.append(thing);
    thing.focus();
    let firstOpen = true;
    const first = render(<TestMenu name="First" x={10} y={10} onClose={() => (firstOpen = false)} />);
    render(<TestMenu name="Second" x={10} y={10} onClose={() => {}} />);
    expect(firstOpen).toBe(false);
    first.unmount();
    let closed = false;
    const third = render(<TestMenu name="Third" x={10} y={10} onClose={() => (closed = true)} />);
    await user.keyboard("{Escape}");
    expect(closed).toBe(true);
    act(() => third.unmount());
    expect(document.activeElement).toBe(thing);
    thing.remove();
  });
});

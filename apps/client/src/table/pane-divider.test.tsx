import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  PaneDivider,
  SHEET_SHARE,
  SPLIT_MAX,
  SPLIT_MIN,
  TARGETING_SHARE,
  useMomentShare,
  useTableSplit,
  type SplitMoment
} from "./PaneDivider";

// The phone's divider between the map pane and the panel: a separator with a value, moved by keys and a finger, and
// remembered on the device.

/** A table 600px tall from the top of the viewport, split by the divider. */
function Table() {
  const [split, setSplit] = useTableSplit();
  return (
    <div>
      <PaneDivider
        value={split}
        onChange={setSplit}
        container={() =>
          ({ getBoundingClientRect: () => ({ top: 100, height: 600, left: 0, width: 390 }) }) as unknown as HTMLElement
        }
      />
    </div>
  );
}

/** The table's divider as the moment moves it. */
function MomentTable({ moment }: Readonly<{ moment: SplitMoment }>) {
  const [share, change] = useMomentShare(moment);
  return (
    <PaneDivider
      value={share}
      onChange={change}
      container={() =>
        ({ getBoundingClientRect: () => ({ top: 100, height: 600, left: 0, width: 390 }) }) as unknown as HTMLElement
      }
    />
  );
}

afterEach(() => localStorage.clear());

describe("the map and panel divider", () => {
  it("is a separator whose value is the map's share, moved by the arrow keys, Home and End", () => {
    render(<Table />);
    const divider = screen.getByRole("separator", { name: "Map and panel split" });
    expect(divider.getAttribute("aria-orientation")).toBe("horizontal");
    expect(divider.getAttribute("aria-valuenow")).toBe("42");
    expect(divider.getAttribute("aria-valuemin")).toBe(String(SPLIT_MIN));
    expect(divider.getAttribute("aria-valuemax")).toBe(String(SPLIT_MAX));
    expect(divider.tabIndex).toBe(0);
    fireEvent.keyDown(divider, { key: "ArrowDown" });
    expect(divider.getAttribute("aria-valuenow")).toBe("47");
    fireEvent.keyDown(divider, { key: "ArrowUp" });
    fireEvent.keyDown(divider, { key: "ArrowUp" });
    expect(divider.getAttribute("aria-valuenow")).toBe("37");
    fireEvent.keyDown(divider, { key: "End" });
    expect(divider.getAttribute("aria-valuenow")).toBe(String(SPLIT_MAX));
    fireEvent.keyDown(divider, { key: "Home" });
    expect(divider.getAttribute("aria-valuenow")).toBe(String(SPLIT_MIN));
  });

  it("follows a finger, within its bounds, and is remembered on this device", () => {
    const { unmount } = render(<Table />);
    const divider = screen.getByRole("separator");
    fireEvent.pointerDown(divider, { pointerId: 1, clientY: 352 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientY: 460 });
    // 360px down a 600px table is 60%.
    expect(divider.getAttribute("aria-valuenow")).toBe("60");
    fireEvent.pointerMove(divider, { pointerId: 1, clientY: 700 });
    expect(divider.getAttribute("aria-valuenow")).toBe(String(SPLIT_MAX));
    fireEvent.pointerUp(divider, { pointerId: 1, clientY: 700 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientY: 200 });
    expect(divider.getAttribute("aria-valuenow")).toBe(String(SPLIT_MAX));
    unmount();
    render(<Table />);
    expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe(String(SPLIT_MAX));
  });
});

describe("the divider through a moment", () => {
  const value = () => Number(screen.getByRole("separator").getAttribute("aria-valuenow"));

  it("gives the sheet most of the height and the map most of it while a target is chosen, then comes back", () => {
    const { rerender } = render(<MomentTable moment={null} />);
    expect(value()).toBe(42);
    rerender(<MomentTable moment="sheet" />);
    expect(value()).toBe(SHEET_SHARE);
    rerender(<MomentTable moment="choosing" />);
    expect(value()).toBe(TARGETING_SHARE);
    rerender(<MomentTable moment={null} />);
    expect(value()).toBe(42);
  });

  it("keeps a split moved during the moment until it ends, and remembers it as the person's own", () => {
    const { rerender } = render(<MomentTable moment="sheet" />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowDown" });
    expect(value()).toBe(SHEET_SHARE + 5);
    rerender(<MomentTable moment={null} />);
    expect(value()).toBe(SHEET_SHARE + 5);
    expect(localStorage.getItem("vtt.table-split")).toBe(String(SHEET_SHARE + 5));
    // The next moment moves it again.
    rerender(<MomentTable moment="choosing" />);
    expect(value()).toBe(TARGETING_SHARE);
  });

  it("moves a split only as far as the moment needs", () => {
    localStorage.setItem("vtt.table-split", "70");
    const { rerender } = render(<MomentTable moment="choosing" />);
    expect(value()).toBe(70);
    rerender(<MomentTable moment="sheet" />);
    expect(value()).toBe(SHEET_SHARE);
  });
});

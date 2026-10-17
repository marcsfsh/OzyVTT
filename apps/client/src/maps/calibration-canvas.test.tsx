import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useGridAreaGesture } from "./calibration-canvas";

function Canvas() {
  const surface = useRef<HTMLDivElement | null>(null);
  const gesture = useGridAreaGesture({
    map: { width: 700, height: 500 },
    surface,
    placing: true,
    busy: false,
    pendingArea: null,
    setPendingArea: () => {},
    setPoints: () => {},
    pointAt: () => null
  });
  return (
    <div ref={surface} data-testid="canvas" {...gesture.handlers}>
      <svg data-testid="image" />
    </div>
  );
}

const touchMove = (target: EventTarget) => {
  const event = new Event("touchmove", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
};

describe("the calibration canvas", () => {
  // A touchmove the page lets through can end in a browser fling, and the tap that follows only stops it.
  it("cancels a finger's movement on the canvas, so a drag never becomes a scroll", () => {
    render(<Canvas />);
    expect(touchMove(screen.getByTestId("image"))).toBe(true);
    expect(touchMove(screen.getByTestId("canvas"))).toBe(true);
  });

  it("leaves touch movement elsewhere on the page alone, and lets go of the canvas when it unmounts", () => {
    const { unmount } = render(<Canvas />);
    const canvas = screen.getByTestId("canvas");
    expect(touchMove(document.body)).toBe(false);
    unmount();
    expect(touchMove(canvas)).toBe(false);
  });
});

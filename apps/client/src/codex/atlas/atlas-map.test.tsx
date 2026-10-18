import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// A 1000 by 800 map, ready at once. jsdom has no screen matrix, so a client point is the map point here.
vi.mock("../../scene/mapImage", () => ({
  useAuthorizedMapImage: () => ({ status: "ready", url: "blob:map", width: 1000, height: 800 }),
  imagePointFromClient: (_svg: unknown, x: number, y: number) => ({ x, y }),
  clampPoint: (point: { x: number; y: number }) => point
}));

import { AtlasMap, type MapPin } from "./AtlasMap";

const PIN = (over: Partial<MapPin> = {}): MapPin => ({
  id: "k1",
  x: 100,
  y: 200,
  iconId: "village",
  iconColor: "#FF2E9A",
  label: "Vallaki",
  ...over
});
const svg = () => document.querySelector(".atlas-map-svg") as SVGSVGElement;
const label = () => document.querySelector(".atlas-pin-label") as SVGTextElement;

/** The frame measures 500 by 400 CSS pixels, half the map's size, so one CSS pixel is two map units at zoom 1. */
function sizeFrame() {
  const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(500);
  const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
  return () => {
    width.mockRestore();
    height.mockRestore();
  };
}

describe("The atlas map", () => {
  let restoreSize: () => void;
  beforeEach(() => {
    restoreSize = sizeFrame();
  });
  afterEach(() => restoreSize());

  it("names the party pin in words on the map and to a screen reader", () => {
    render(<AtlasMap token="gm" assetId="a1" pins={[PIN({ isParty: true })]} selectedPinId={null} />);
    const pin = document.querySelector('[data-pin-id="k1"]')!;
    expect(pin.textContent).toContain("The party is here");
    expect(pin.querySelector("title")!.textContent).toBe("Vallaki, the party is here");
    expect(pin.querySelector(".atlas-pin-partyring")).not.toBeNull();
  });

  it("draws no second caption when the party pin's own label already names the party", () => {
    render(
      <AtlasMap token="gm" assetId="a1" pins={[PIN({ isParty: true, label: "The party" })]} selectedPinId={null} />
    );
    const pin = document.querySelector('[data-pin-id="k1"]')!;
    expect(pin.querySelectorAll("text")).toHaveLength(1);
    expect(pin.querySelector("title")!.textContent).toBe("The party is here");
  });

  it("says nothing about the party on an ordinary pin, and names a hidden pin as hidden", () => {
    render(<AtlasMap token="gm" assetId="a1" pins={[PIN({ revealedToPlayers: false })]} selectedPinId={null} />);
    const pin = document.querySelector('[data-pin-id="k1"]')!;
    expect(pin.textContent).not.toContain("The party");
    expect(pin.querySelector(".atlas-pin-partyring")).toBeNull();
    expect(pin.querySelector("title")!.textContent).toBe("Vallaki, hidden");
    expect(pin).toHaveClass("is-hidden");
  });

  it("keeps pin labels at one screen size as the map zooms", () => {
    render(<AtlasMap token="gm" assetId="a1" pins={[PIN()]} selectedPinId={null} />);
    // Two map units per pixel at zoom 1: a 12 pixel label is 24 units tall.
    expect(parseFloat(label().style.fontSize)).toBeCloseTo(24);
    fireEvent.wheel(svg(), { deltaY: -100, clientX: 500, clientY: 400 });
    // Zoomed in by 1.12: the same 12 pixels are fewer map units.
    expect(parseFloat(label().style.fontSize)).toBeCloseTo(24 / 1.12);
  });

  it("opens the spot menu on a right-click, and an entry acts on that spot", async () => {
    const onSelect = vi.fn();
    render(
      <AtlasMap
        token="gm"
        assetId="a1"
        pins={[]}
        selectedPinId={null}
        menu={[
          { id: "party", label: "Set party position here", iconId: "flag", onSelect },
          { id: "pin", label: "Add a pin here", iconId: "pin", onSelect: vi.fn() }
        ]}
      />
    );
    fireEvent.contextMenu(svg(), { clientX: 320, clientY: 240 });
    const menu = screen.getByRole("menu", { name: "This spot" });
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Set party position here",
      "Add a pin here"
    ]);
    await userEvent.setup().click(screen.getByRole("menuitem", { name: "Set party position here" }));
    expect(onSelect).toHaveBeenCalledWith({ x: 320, y: 240 });
    expect(menu).not.toBeInTheDocument();
  });

  it("opens the same menu on a long press, and not when the finger moves", () => {
    vi.useFakeTimers();
    try {
      render(
        <AtlasMap
          token="gm"
          assetId="a1"
          pins={[]}
          selectedPinId={null}
          menu={[{ id: "party", label: "Set party position here", iconId: "flag", onSelect: vi.fn() }]}
        />
      );
      // A finger that wanders is a pan.
      fireEvent.pointerDown(svg(), { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 100 });
      fireEvent.pointerMove(svg(), { pointerId: 1, pointerType: "touch", clientX: 140, clientY: 100 });
      act(() => vi.advanceTimersByTime(800));
      fireEvent.pointerUp(svg(), { pointerId: 1, pointerType: "touch", clientX: 140, clientY: 100 });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();

      // A finger held still opens the menu.
      fireEvent.pointerDown(svg(), { pointerId: 2, pointerType: "touch", clientX: 200, clientY: 150 });
      act(() => vi.advanceTimersByTime(600));
      expect(screen.getByRole("menu", { name: "This spot" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers no menu without entries, as on a player's map", () => {
    render(<AtlasMap token="pl" assetId="a1" pins={[]} selectedPinId={null} readOnly />);
    fireEvent.contextMenu(svg(), { clientX: 320, clientY: 240 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("drops at a tap while placing, and a pan is never a drop", () => {
    const onPlace = vi.fn();
    render(
      <AtlasMap
        token="gm"
        assetId="a1"
        pins={[]}
        selectedPinId={null}
        placing="party"
        onPlace={onPlace}
        hint="Tap or click the map where the party is. Esc cancels."
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("where the party is");
    fireEvent.pointerDown(svg(), { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 });
    fireEvent.pointerMove(svg(), { pointerId: 1, pointerType: "mouse", clientX: 60, clientY: 10 });
    fireEvent.pointerUp(svg(), { pointerId: 1, pointerType: "mouse", clientX: 60, clientY: 10 });
    expect(onPlace).not.toHaveBeenCalled();
    fireEvent.pointerDown(svg(), { pointerId: 2, pointerType: "mouse", clientX: 300, clientY: 220 });
    fireEvent.pointerUp(svg(), { pointerId: 2, pointerType: "mouse", clientX: 300, clientY: 220 });
    expect(onPlace).toHaveBeenCalledWith({ x: 300, y: 220 });
  });

  it("reports a tapped pin and never drags one on a read-only map", () => {
    const onPinClick = vi.fn();
    const onPinDragEnd = vi.fn();
    render(
      <AtlasMap
        token="pl"
        assetId="a1"
        pins={[PIN()]}
        selectedPinId={null}
        readOnly
        onPinClick={onPinClick}
        onPinDragEnd={onPinDragEnd}
      />
    );
    const pin = document.querySelector('[data-pin-id="k1"] circle')!;
    fireEvent.pointerDown(pin, { pointerId: 1, pointerType: "mouse", clientX: 100, clientY: 200 });
    fireEvent.pointerMove(svg(), { pointerId: 1, pointerType: "mouse", clientX: 150, clientY: 260 });
    fireEvent.pointerUp(svg(), { pointerId: 1, pointerType: "mouse", clientX: 150, clientY: 260 });
    expect(onPinDragEnd).not.toHaveBeenCalled();
    fireEvent.pointerDown(pin, { pointerId: 2, pointerType: "mouse", clientX: 100, clientY: 200 });
    fireEvent.pointerUp(svg(), { pointerId: 2, pointerType: "mouse", clientX: 100, clientY: 200 });
    expect(onPinClick).toHaveBeenCalledWith("k1");
  });

  it("draws who stands at a pin and the ground a faction holds, the hidden ones dashed", () => {
    render(
      <AtlasMap
        token="gm"
        assetId="a1"
        pins={[PIN()]}
        selectedPinId={null}
        people={new Map([["k1", [{ id: "p1", name: "Ysolde Varn", initials: "YV", hidden: true }]]])}
        ground={[
          { key: "g1", factionId: "f1", name: "Tidebound", x: 100, y: 200, tone: 2, hidden: true, labelled: true }
        ]}
      />
    );
    const person = document.querySelector(".atlas-person")!;
    expect(person).toHaveClass("is-hidden");
    expect(person.querySelector("title")!.textContent).toBe("Ysolde Varn, hidden");
    const ground = document.querySelector(".atlas-ground")!;
    expect(ground).toHaveClass("is-hidden");
    expect(ground.textContent).toBe("Tidebound (Hidden)");
  });
});

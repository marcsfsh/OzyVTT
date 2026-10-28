import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FogOverlay } from "./FogOverlay";
import { MapToken } from "./MapToken";
import { TerrainOverlay } from "./TerrainOverlay";
import { VisionLayer, type MapWall } from "./VisionLayer";

/** jsdom has no Web Animations API; this records which elements were animated, so the light runs. */
function stubAnimate(): Element[] {
  const animated: Element[] = [];
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element) {
      animated.push(this);
      const finished = new Promise<Animation>(() => {});
      return { finished, cancel: () => {} } as unknown as Animation;
    }
  });
  return animated;
}

let animated: Element[];
beforeEach(() => {
  animated = stubAnimate();
});
afterEach(() => {
  delete (Element.prototype as { animate?: unknown }).animate;
});

const svg = (child: React.ReactNode) => <svg>{child}</svg>;

describe("light on the map", () => {
  it("glides a token that moved and draws its trail", () => {
    const token = (x: number) =>
      svg(
        <MapToken
          encounterToken={{ actorId: "a", position: { x, y: 50 }, sizePx: 50 } as never}
          actor={
            {
              id: "a",
              name: "Lyra",
              kind: "player-character",
              hp: { current: 9, maximum: 9, temporary: 0 },
              conditions: [],
              effects: [],
              visibility: "public"
            } as never
          }
          role="gm"
          authToken={null}
          movable
          active={false}
          dragging={false}
          targetable={false}
          targeted={false}
          label="Lyra"
          onKeyDown={() => {}}
        />
      );
    const { rerender, container } = render(token(50));
    rerender(token(150));
    expect(animated).toContain(container.querySelector("[data-token-id='a']"));
    expect(container.querySelectorAll(".lr-trail.lr-tone-party")).toHaveLength(1);
  });

  it("never glides the token this device is dragging", () => {
    const token = (x: number, dragging: boolean) =>
      svg(
        <MapToken
          encounterToken={{ actorId: "a", position: { x, y: 50 }, sizePx: 50 } as never}
          actor={
            {
              id: "a",
              name: "Lyra",
              kind: "player-character",
              hp: { current: 9, maximum: 9, temporary: 0 },
              conditions: [],
              effects: [],
              visibility: "public"
            } as never
          }
          role="gm"
          authToken={null}
          movable
          active={false}
          dragging={dragging}
          targetable={false}
          targeted={false}
          label="Lyra"
          onKeyDown={() => {}}
        />
      );
    const { rerender, container } = render(token(50, true));
    rerender(token(150, true));
    rerender(token(50, false));
    rerender(token(150, false));
    expect(container.querySelectorAll(".lr-trail")).toHaveLength(0);
  });

  it("clears a new reveal behind an edge of light", () => {
    const fog = (ids: string[]) =>
      svg(
        <FogOverlay
          width={400}
          height={300}
          variant="gm"
          fog={{ enabled: true, shapes: ids.map((id) => ({ id, op: "reveal", x: 10, y: 10, width: 100, height: 80 })) }}
        />
      );
    const { rerender, container } = render(fog(["one"]));
    rerender(fog(["one", "two"]));
    expect(container.querySelectorAll(".lr-fog-edge")).toHaveLength(1);
  });

  it("flashes a trap as it springs", () => {
    const traps = (state: "armed" | "sprung") =>
      svg(
        <TerrainOverlay
          difficult={[]}
          cellSizePx={50}
          traps={[{ id: "t", name: "Pit", state, area: { x: 0, y: 0, width: 50, height: 50 } } as never]}
        />
      );
    const { rerender, container } = render(traps("armed"));
    rerender(traps("sprung"));
    expect(container.querySelectorAll(".lr-trap-flash")).toHaveLength(1);
  });

  it("swings a door open on its hinge", () => {
    const door = (open: boolean): MapWall =>
      ({ id: "d", kind: "door", a: { x: 0, y: 0 }, b: { x: 0, y: 50 }, open }) as MapWall;
    const layer = (open: boolean) =>
      svg(
        <VisionLayer
          role="player"
          walls={[door(open)]}
          tokenPositions={new Map()}
          pixelsPerFoot={10}
          cellSizePx={50}
          showWalls={false}
          erasing={false}
          onDoorMenu={() => {}}
        />
      );
    const { rerender, container } = render(layer(false));
    rerender(layer(true));
    expect(container.querySelectorAll(".lr-door-swing")).toHaveLength(1);
  });
});

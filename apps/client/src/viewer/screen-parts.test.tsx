import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ScreenColumn, ScreenTop, screenTiles } from "./ScreenParts";
import type { Presentation } from "./ViewerApp";

const MAP = "map-1";
const entries = [
  { actorId: "lyra", name: "Lyra Emberwise", initiative: 19, active: false },
  { actorId: "boss", name: "Goblin Boss", initiative: 17, active: true },
  { actorId: "borin", name: "Borin Stoneguard", initiative: 14, active: false }
];
const presentation = (initiative: Partial<Presentation["initiative"]> = {}): Presentation => ({
  schemaVersion: 1,
  revision: 1,
  enabled: true,
  activeMap: { assetId: MAP, altText: "Goblin warren" },
  camera: null,
  measurement: null,
  pings: [],
  initiative: { visible: true, round: 3, hiddenTurn: false, entries, ...initiative },
  encounter: {
    mapAssetId: MAP,
    tokens: [
      {
        actorId: "lyra",
        name: "Lyra Emberwise",
        kind: "player-character",
        position: { x: 1, y: 1 },
        sizePx: 50,
        active: false,
        tokenAssetId: "art-1"
      },
      { actorId: "boss", name: "Goblin Boss", kind: "monster", position: { x: 2, y: 2 }, sizePx: 50, active: true }
    ]
  }
});

describe("the table screen's strip and column", () => {
  it("marks the acting turn, the next one after it, and the ones done this round", () => {
    const tiles = screenTiles(presentation().initiative);
    expect(tiles.map((tile) => [tile.entry.actorId, tile.acting, tile.next, tile.acted])).toEqual([
      ["lyra", false, false, true],
      ["boss", true, false, false],
      ["borin", false, true, false]
    ]);
    // NEXT wraps at the round's end, and the one it wraps to is not dimmed as done.
    const last = screenTiles(
      presentation({ entries: entries.map((entry) => ({ ...entry, active: entry.actorId === "borin" })) }).initiative
    );
    expect(last.find((tile) => tile.next)?.entry.actorId).toBe("lyra");
    expect(last.find((tile) => tile.entry.actorId === "lyra")?.acted).toBe(false);
  });

  it("shows the round, the tiles and who acts now with who is next", () => {
    render(
      <>
        <ScreenTop presentation={presentation()} />
        <ScreenColumn presentation={presentation()} />
      </>
    );
    expect(screen.getByRole("img", { name: "Round 3" })).toBeTruthy();
    const order = screen.getByRole("list", { name: "Turn order, round 3" });
    expect(within(order).getByRole("listitem", { name: "Goblin Boss, initiative 17, acting" })).toBeTruthy();
    expect(within(order).getByRole("listitem", { name: "Borin Stoneguard, initiative 14, next" })).toBeTruthy();
    // A character by first name on its tile; its label keeps the whole name.
    expect(within(order).getByText("Lyra")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Acting now: Goblin Boss" })).toBeTruthy();
    expect(screen.getByText("Next: Borin Stoneguard")).toBeTruthy();
  });

  it("takes token art only from a placed token, and the actor id's avatar otherwise", () => {
    const { container } = render(<ScreenTop presentation={presentation()} />);
    const images = [...container.querySelectorAll<HTMLImageElement>(".screen-tile img")].map((image) =>
      image.getAttribute("src")
    );
    expect(images.filter((src) => src?.includes("/token-assets/art-1/"))).toHaveLength(1);
    // Borin has no placed token: no art is asked for, only the fallback.
    expect(images.filter((src) => src?.includes("/token-assets/"))).toHaveLength(1);
  });

  it("during a hidden turn shows the GM's turn and marks no creature", () => {
    render(
      <>
        <ScreenTop
          presentation={presentation({ hiddenTurn: true, entries: entries.map((e) => ({ ...e, active: false })) })}
        />
        <ScreenColumn
          presentation={presentation({ hiddenTurn: true, entries: entries.map((e) => ({ ...e, active: false })) })}
        />
      </>
    );
    expect(screen.getByRole("region", { name: "GM turn" })).toBeTruthy();
    expect(screen.queryByRole("listitem", { name: /acting|next/ })).toBeNull();
  });

  it("between fights reads STOP with the scene's name, and keeps the roll's place with its notice", () => {
    render(
      <>
        <ScreenTop presentation={presentation({ visible: false })} />
        <ScreenColumn presentation={presentation({ visible: false })} />
      </>
    );
    expect(screen.getByRole("img", { name: "No fight running" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: /Turn order/ })).toBeNull();
    expect(screen.getByRole("region", { name: "No fight running" }).textContent).toContain("Goblin warren");
    expect(
      within(screen.getByRole("region", { name: "Latest roll" })).getByText("Roll display is not available yet.")
    ).toBeTruthy();
  });
});

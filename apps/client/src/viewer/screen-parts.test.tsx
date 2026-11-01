import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ScreenLadder, diceWords, screenTiles } from "./ScreenParts";
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

describe("the table screen's ladder", () => {
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

  it("shows the round, a row a turn with names in full, the acting card and NEXT on the next row", () => {
    render(<ScreenLadder presentation={presentation()} />);
    expect(screen.getByRole("img", { name: "Round 3" })).toBeTruthy();
    const order = screen.getByRole("list", { name: "Turn order, round 3" });
    const acting = within(order).getByRole("listitem", { name: "Goblin Boss, initiative 17, acting" });
    expect(acting).toHaveTextContent("Acting now");
    const next = within(order).getByRole("listitem", { name: "Borin Stoneguard, initiative 14, next" });
    expect(next).toHaveTextContent("NEXT");
    // A character's name in full (the old tiles shortened it to a first name).
    expect(within(order).getByText("Lyra Emberwise")).toBeTruthy();
  });

  it("before the round's first turn lights no row and says so", () => {
    render(<ScreenLadder presentation={presentation({ entries: entries.map((e) => ({ ...e, active: false })) })} />);
    expect(screen.getByText("Waiting for the first turn")).toBeTruthy();
    expect(screen.queryByRole("listitem", { name: /acting/ })).toBeNull();
  });

  it("takes token art only from a placed token, and the actor id's avatar otherwise", () => {
    const { container } = render(<ScreenLadder presentation={presentation()} />);
    const images = [...container.querySelectorAll<HTMLImageElement>(".screen-rung img")].map((image) =>
      image.getAttribute("src")
    );
    expect(images.filter((src) => src?.includes("/token-assets/art-1/"))).toHaveLength(1);
    // Borin has no placed token: no art is asked for, only the fallback.
    expect(images.filter((src) => src?.includes("/token-assets/"))).toHaveLength(1);
  });

  it("during a hidden turn shows the GM's turn and marks no creature", () => {
    render(
      <ScreenLadder
        presentation={presentation({ hiddenTurn: true, entries: entries.map((e) => ({ ...e, active: false })) })}
      />
    );
    expect(screen.getByRole("listitem", { name: "Acting now: GM turn" })).toHaveTextContent("GM turn");
    expect(screen.queryByRole("listitem", { name: /initiative \d+, (acting|next)/ })).toBeNull();
  });

  it("between encounters reads STOP with the encounter's name, and keeps the roll's place with its notice", () => {
    render(<ScreenLadder presentation={presentation({ visible: false })} />);
    expect(screen.getByRole("img", { name: "No encounter running" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: /Turn order/ })).toBeNull();
    expect(screen.getByRole("region", { name: "No encounter running" }).textContent).toContain("Goblin warren");
    expect(within(screen.getByRole("region", { name: "Latest roll" })).getByText("No roll to show yet.")).toBeTruthy();
  });

  it("shows the latest roll's who, what, total and dice", () => {
    const card = {
      id: "card-1",
      who: "Lyra",
      what: "Fire Bolt",
      total: 19,
      dice: [{ sides: 20, face: 12, kept: true }],
      modifier: 7,
      at: "2026-10-27T12:00:00.000Z"
    };
    render(<ScreenLadder presentation={{ ...presentation(), latestRoll: card }} />);
    const shown = screen.getByRole("region", { name: "Latest roll: Lyra, Fire Bolt, 19" });
    expect(within(shown).getByText("d20 12 +7")).toBeTruthy();
    expect(diceWords({ ...card, dice: [...card.dice, { sides: 20, face: 3, kept: false }], modifier: -1 })).toBe(
      "d20 12 (d20 3) -1"
    );
  });
});

describe("a long order on the table screen", () => {
  it("brings the acting row into view as the turn moves", () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const { rerender } = render(<ScreenLadder presentation={presentation()} />);
    scrolled.mockClear();
    rerender(
      <ScreenLadder
        presentation={presentation({
          entries: entries.map((entry) => ({ ...entry, active: entry.actorId === "borin" }))
        })}
      />
    );
    expect(scrolled).toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("../../codex/MapSurface", () => ({ MapSurface: () => <div data-testid="map-surface" /> }));
vi.mock("../../codex/api", async (actual) => (await import("../../../test/codex-fakes")).fakeApiModule(await actual()));
vi.mock("../../codex/api-records", async () => (await import("../../../test/codex-fakes")).fakeRecordsModule());

import { renderPlayerCodex } from "../../../test/codex-render";
import { resetReaderCompendium } from "./data";

const spell = (id: string, name: string, source: "srd" | "homebrew") => ({
  id,
  name,
  source,
  level: 3,
  school: "evocation",
  castingTime: "action",
  rangeText: "150 feet",
  attackRoll: false,
  rangeFeet: 150,
  componentsText: "V, S",
  duration: "Instantaneous",
  concentration: false,
  ritual: false,
  description: `${name} roars into a fiery explosion.`,
  higherLevel: null,
  classes: ["wizard"],
  damageRoll: "8d6",
  damageTypes: ["fire"],
  castingOptions: []
});

/** What the player's own route answers: the SRD and the homebrew shared with this player's character. */
const reads: string[] = [];
beforeEach(() => {
  reads.length = 0;
  resetReaderCompendium();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      reads.push(path);
      if (path.startsWith("/api/v1/content/compendium")) {
        const kind = new URL(path, "http://table").searchParams.get("kind");
        const rows =
          kind === "spell"
            ? [spell("fireball", "Fireball", "srd"), spell("hb-brine-burst-a1b2c3", "Brine Burst", "homebrew")]
            : [];
        return new Response(JSON.stringify({ ok: true, apiVersion: "1", data: { kind, rows, attribution: null } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "not_found", message: "Not here." } }), {
        status: 404
      });
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("the Compendium in a player's Codex", () => {
  it("reads only the player's own route, marks homebrew, and lists no monsters", async () => {
    const user = userEvent.setup();
    renderPlayerCodex("/codex/compendium?kind=spells");
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("row", { name: /Brine Burst/ })).toHaveTextContent("Homebrew");
    expect(within(table).getByRole("row", { name: /Fireball/ })).toHaveTextContent("SRD 5.2.1");
    expect(reads.filter((path) => path.includes("/compendium"))).toEqual(["/api/v1/content/compendium?kind=spell"]);
    expect(reads.some((path) => path.includes("/homebrew"))).toBe(false);

    await user.click(screen.getByRole("button", { name: /^Kind: Spells/ }));
    const kinds = screen.getByRole("menu", { name: "Kind" });
    expect(within(kinds).queryByRole("menuitemradio", { name: /Monsters/ })).toBeNull();
    expect(within(kinds).queryByRole("menuitemradio", { name: /Spell lists/ })).toBeNull();
    expect(within(kinds).getByRole("menuitemradio", { name: /Items/ })).toBeInTheDocument();
  });

  it("opens a record's card, the one the sheet draws, at its own address", async () => {
    const user = userEvent.setup();
    renderPlayerCodex("/codex/compendium?kind=spells");
    await user.click(await screen.findByRole("button", { name: /Brine Burst/ }));
    expect(window.location.pathname).toBe("/codex/compendium/hb-brine-burst-a1b2c3");
    const card = await screen.findByRole("article", { name: "Brine Burst spell card" });
    expect(within(card).getByText(/roars into a fiery explosion/)).toBeInTheDocument();
  });
});

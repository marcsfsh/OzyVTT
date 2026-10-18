import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("../api", async (actual) => (await import("../../../test/codex-fakes")).fakeApiModule(await actual()));
vi.mock("../api-records", async () => (await import("../../../test/codex-fakes")).fakeRecordsModule());

import type { CodexConnection } from "@vtt/domain";
import { CALENDAR, api, resetFakes, summary } from "../../../test/codex-fakes";
import { renderGmCodex, renderPlayerCodex } from "../../../test/codex-render";
import { setViewport } from "../../../test/viewport";

const AT = "2026-10-01T00:00:00.000Z";
const PAGES = [
  summary({ id: "f1", title: "The Tidebound", entityType: "faction" }),
  summary({ id: "f2", title: "The Lantern Order", entityType: "faction", revealedToPlayers: false }),
  summary({ id: "p1", title: "Ysolde Varn", entityType: "character" }),
  summary({ id: "p2", title: "Wren", entityType: "character" })
];
const tie = (over: Partial<CodexConnection>): CodexConnection => ({
  id: "c1",
  fromKind: "page",
  fromId: "p1",
  toPageId: "f1",
  label: "member of",
  origin: "declared",
  layer: "player",
  characterIds: [],
  began: null,
  learned: null,
  createdAt: AT,
  ...over
});
const TIES = [
  tie({
    began: { inWorldDate: null, beforeCampaign: true, inWorldLabel: null, calendarInstant: null },
    learned: { at: AT, sessionId: null, sessionNumber: 5, inWorldDate: null, inWorldLabel: null }
  }),
  tie({ id: "c2", fromId: "f1", toPageId: "f2", label: "rival of", layer: "gm" }),
  tie({ id: null, fromId: "p2", toPageId: "f1", label: null, origin: "mention", createdAt: null })
];
const STANDING = [
  {
    id: "s1",
    factionPageId: "f1",
    value: -80,
    revealedToPlayers: true,
    createdAt: AT,
    updatedAt: AT,
    firstShownAt: AT
  },
  {
    id: "s2",
    factionPageId: "f2",
    value: 50,
    revealedToPlayers: false,
    createdAt: AT,
    updatedAt: AT,
    firstShownAt: null
  }
];

const web = () => screen.getByRole("img", { name: /and the pages tied to it/ });
const ties = () => within(screen.getByRole("complementary", { name: /ties$/ }));

beforeEach(() => {
  localStorage.clear();
  resetFakes();
  api.codexApi.listPages.mockResolvedValue(PAGES);
  api.codexApi.listConnections.mockResolvedValue(TIES);
  api.standingApi.list.mockResolvedValue(STANDING);
});

describe("The web", () => {
  it("centres on the first faction, and draws every tie to it, declared or written in a page's text", async () => {
    renderGmCodex("/codex/relationships");
    await waitFor(() => expect(web()).toHaveAccessibleName("The Lantern Order and the pages tied to it"));
    // The Lantern Order sorts first; centre on the Tidebound to see its three ties.
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Centre on: The Lantern Order"));
    await user.click(screen.getByRole("option", { name: /The Tidebound/ }));
    expect(new URLSearchParams(window.location.search).get("focus")).toBe("f1");
    await waitFor(() => expect(web()).toHaveAccessibleName("The Tidebound and the pages tied to it"));

    const edges = web().querySelectorAll(".cx-web-edge");
    expect(edges).toHaveLength(3);
    expect([...edges].map((edge) => [edge.getAttribute("data-origin"), edge.textContent])).toEqual([
      ["declared", "member of"],
      ["declared", "rival of"],
      ["mention", "mentions"]
    ]);
    // The GM-only tie is drawn dashed violet.
    expect(edges[1]).toHaveClass("is-hidden");
    expect(edges[0]).not.toHaveClass("is-hidden");
  });

  it("draws one node for a neighbour tied twice, its line naming the declared tie", async () => {
    api.codexApi.listConnections.mockResolvedValue([
      ...TIES,
      tie({ id: null, fromId: "f1", toPageId: "p1", label: null, origin: "mention", createdAt: null })
    ]);
    renderGmCodex("/codex/relationships?focus=f1");
    await waitFor(() => expect(web().querySelectorAll(".cx-web-edge")).toHaveLength(3));
    const ysolde = [...web().querySelectorAll(".cx-web-edge")].find((edge) => edge.textContent === "member of");
    expect(ysolde).toHaveAttribute("data-origin", "declared");
    expect(screen.getAllByRole("link", { name: "Centre on Ysolde Varn" })).toHaveLength(1);
  });

  it("re-centres on a neighbour", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/relationships?focus=f1");
    await user.click(await screen.findByRole("link", { name: "Centre on Ysolde Varn" }));
    expect(window.location.search).toBe("?focus=p1");
    await waitFor(() => expect(web()).toHaveAccessibleName("Ysolde Varn and the pages tied to it"));
  });

  it("lists the ties beside the web under their labels, a Hidden one marked, and a tie opens its page", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/relationships?focus=f1");
    await waitFor(() => expect(ties().getByText("Member of The Tidebound")).toBeInTheDocument());
    expect(ties().getByText("Rival of")).toBeInTheDocument();
    expect(ties().getByRole("button", { name: /The Lantern Order/ })).toHaveTextContent("Hidden");
    await user.click(ties().getByRole("button", { name: /Ysolde Varn/ }));
    expect(window.location.pathname).toBe("/codex/pages/p1");
  });
});

describe("The factions grid", () => {
  it("says how each faction stands with every other, and with the party in words and numbers", async () => {
    renderGmCodex("/codex/relationships?view=grid&focus=f1");
    const grid = within(await screen.findByRole("table"));
    const tidebound = grid.getByRole("rowheader", { name: "The Tidebound" }).closest("tr") as HTMLElement;
    expect(tidebound).toHaveClass("is-focus");
    expect(within(tidebound).getByText("Rival of")).toBeInTheDocument();
    expect(tidebound).toHaveTextContent("Hunted -80");
    const lantern = grid.getByRole("rowheader", { name: "The Lantern Order" }).closest("tr") as HTMLElement;
    expect(lantern).toHaveTextContent("Allied +50");
  });

  it("lets the GM adjust a standing from its cell, and a player has nothing to tap", async () => {
    const user = userEvent.setup();
    const view = renderGmCodex("/codex/relationships?view=grid");
    await user.click(await screen.findByRole("button", { name: /Adjust The Tidebound's standing/ }));
    expect(await screen.findByRole("dialog", { name: "Standing with The Tidebound" })).toBeInTheDocument();
    view.unmount();

    api.playerCodexApi.listPages.mockResolvedValue([
      { id: "f1", title: "The Tidebound", entityType: "faction", tags: [], bannerAssetId: null, playerUpdatedAt: AT }
    ]);
    api.playerCodexApi.standing.mockResolvedValue([{ factionPageId: "f1", value: 20 }]);
    renderPlayerCodex("/codex/relationships?view=grid");
    const grid = within(await screen.findByRole("table"));
    expect(grid.getByRole("rowheader", { name: "The Tidebound" }).closest("tr") as HTMLElement).toHaveTextContent(
      "Friendly +20"
    );
    expect(screen.queryByRole("button", { name: /Adjust/ })).not.toBeInTheDocument();
  });

  it("says None known where no tie or standing is known", async () => {
    api.standingApi.list.mockResolvedValue([]);
    api.codexApi.listConnections.mockResolvedValue([]);
    renderGmCodex("/codex/relationships?view=grid");
    const grid = within(await screen.findByRole("table"));
    expect(grid.getAllByText("None known")).toHaveLength(2);
    expect(grid.getAllByRole("button", { name: /Not set/ })).toHaveLength(2);
  });
});

describe("Over time", () => {
  it("draws each tie from when it began, and says when the party learned it", async () => {
    api.calendarApi.get.mockResolvedValue(CALENDAR);
    renderGmCodex("/codex/relationships?view=time&focus=f1");
    const list = within(await screen.findByRole("list", { name: "Relationships over time" }));
    const member = list.getByText(/Member of The Tidebound: Ysolde Varn/).closest("[role='listitem']") as HTMLElement;
    expect(member).toHaveTextContent("Before the campaign · learned in session 5");
    const rival = list.getByText(/Rival of: The Lantern Order/).closest("[role='listitem']") as HTMLElement;
    expect(rival).toHaveTextContent("No start date · Hidden");
  });
});

describe("A player's Relationships (viewer safety)", () => {
  it("reads the player's own feeds and never the GM's", async () => {
    api.playerCodexApi.listPages.mockResolvedValue([
      { id: "f1", title: "The Tidebound", entityType: "faction", tags: [], bannerAssetId: null, playerUpdatedAt: AT },
      { id: "p1", title: "Ysolde Varn", entityType: "character", tags: [], bannerAssetId: null, playerUpdatedAt: AT }
    ]);
    api.playerCodexApi.listConnections.mockResolvedValue([
      {
        fromKind: "page",
        fromId: "p1",
        toPageId: "f1",
        label: "member of",
        origin: "declared",
        began: null,
        learned: null
      }
    ]);
    renderPlayerCodex("/codex/relationships?focus=f1");
    await waitFor(() => expect(web().querySelectorAll(".cx-web-edge")).toHaveLength(1));
    expect(api.playerCodexApi.listConnections).toHaveBeenCalledWith("player");
    expect(api.codexApi.listConnections).not.toHaveBeenCalled();
    expect(api.codexApi.listPages).not.toHaveBeenCalled();
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });

  it("tells a player relationships appear once the GM shows the pages", async () => {
    renderPlayerCodex("/codex/relationships");
    expect(
      await screen.findByText("Relationships appear here once your GM shows the pages they tie.")
    ).toBeInTheDocument();
  });
});

describe("Relationships on a phone", () => {
  beforeEach(() => setViewport(390));

  it("opens on the factions grid in a sideways scroller, with the ties below", async () => {
    renderGmCodex("/codex/relationships?focus=f1");
    expect(await screen.findByRole("heading", { level: 2, name: "Relationships" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Swipe the grid sideways to see every column.")).toBeInTheDocument();
    expect(screen.getByText("Member of The Tidebound")).toBeInTheDocument();
  });
});

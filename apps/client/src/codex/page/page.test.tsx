import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("../api", async (actual) => (await import("../../../test/codex-fakes")).fakeApiModule(await actual()));
vi.mock("../api-records", async () => (await import("../../../test/codex-fakes")).fakeRecordsModule());

import type { CodexPage, CodexPageConnection } from "@vtt/domain";
import { api, block, page, playerBlock, playerPage, records, resetFakes, summary } from "../../../test/codex-fakes";
import { renderGmCodex, renderPlayerCodex } from "../../../test/codex-render";
import { setViewport } from "../../../test/viewport";

const AT = "2026-10-01T00:00:00.000Z";
const LATER = "2026-10-10T00:00:00.000Z";

const STAMP = { at: AT, sessionId: null, sessionNumber: 5, inWorldDate: null, inWorldLabel: "Emberfall 12" };

/** Ysolde's page: two paragraphs, a Hidden block after the first, and one revealed to Lyra after the second. */
const YSOLDE: CodexPage = page({
  playerBody: "The harbourmaster of Saltmere.\n\nShe keeps the tide clock.",
  fields: { role: "Harbourmaster", goals: "Pay the Tidebound back." },
  hiddenFields: ["goals"],
  blocks: [
    block({ id: "b1", anchor: 1, title: "The debt", text: "Ysolde owes the Tidebound four thousand gold." }),
    block({
      id: "b2",
      anchor: 2,
      title: "Lena's letters",
      text: "Lena wrote to Lyra every week.",
      audience: "characters",
      characterIds: ["a-lyra"],
      reveals: [{ ...STAMP, to: "a-lyra" }]
    })
  ]
});

const connection = (over: Partial<CodexPageConnection>): CodexPageConnection => ({
  id: "c1",
  direction: "out",
  otherKind: "page",
  otherId: "p2",
  otherTitle: "The Tidebound",
  otherEntityType: "faction",
  otherRevealed: true,
  label: "member of",
  origin: "declared",
  layer: "player",
  characterIds: [],
  section: null,
  began: null,
  learned: null,
  ...over
});

const CONNECTIONS = [
  connection({}),
  connection({ id: "c2", otherId: "p3", otherTitle: "Wren", otherEntityType: "character", label: "owes", layer: "gm" }),
  connection({
    id: null,
    direction: "in",
    otherKind: "journal",
    otherId: "j1",
    otherTitle: "We met Ysolde at the Gull.",
    otherEntityType: null,
    label: null,
    origin: "mention"
  })
];

beforeEach(() => {
  localStorage.clear();
  resetFakes();
  api.codexApi.listPages.mockResolvedValue([
    summary({ id: "p1", title: "Ysolde Varn" }),
    summary({ id: "p2", title: "The Tidebound", entityType: "faction" }),
    summary({ id: "p3", title: "Wren", revealedToPlayers: false })
  ]);
  records.pageRecordApi.get.mockResolvedValue({ page: YSOLDE, connections: CONNECTIONS });
});

const doc = () => document.querySelector(".cx-doc") as HTMLElement;

describe("Reading a page as the GM", () => {
  it("reads as one document: the player text with each hidden block where it belongs", async () => {
    renderGmCodex("/codex/pages/p1");
    await screen.findByRole("heading", { level: 1, name: "Ysolde Varn" });
    const text = doc().textContent ?? "";
    const order = [
      "The harbourmaster of Saltmere.",
      "Ysolde owes the Tidebound four thousand gold.",
      "She keeps the tide clock.",
      "Lena wrote to Lyra every week."
    ].map((line) => text.indexOf(line));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("boxes a hidden block as Hidden with Reveal in its corner, and a revealed one says who and since when", async () => {
    renderGmCodex("/codex/pages/p1");
    const debt = await screen.findByRole("region", { name: "The debt · Hidden" });
    expect(within(debt).getByText("Hidden")).toBeInTheDocument();
    expect(within(debt).getByRole("button", { name: "Reveal The debt" })).toBeInTheDocument();

    const letters = screen.getByRole("region", { name: "Lena's letters · Revealed to Lyra Emberwise" });
    expect(within(letters).getByText("Since Emberfall 12, session 5")).toBeInTheDocument();
    expect(within(letters).getByRole("button", { name: "Hide Lena's letters again" })).toBeInTheDocument();
  });

  it("says under the title who reads the page and how much of it is hidden", async () => {
    renderGmCodex("/codex/pages/p1");
    await screen.findByRole("heading", { level: 1, name: "Ysolde Varn" });
    const line = document.querySelector(".cx-visline") as HTMLElement;
    expect(line).toHaveTextContent("Revealed to everyone");
    expect(line).toHaveTextContent("1 block revealed to Lyra Emberwise");
    expect(line).toHaveTextContent("1 block and 1 field hidden");
  });

  it("marks a Hidden field in words beside its value", async () => {
    renderGmCodex("/codex/pages/p1");
    await screen.findByRole("heading", { level: 1, name: "Ysolde Varn" });
    const goals = screen.getByText("Pay the Tidebound back.").closest(".cx-meta-row") as HTMLElement;
    expect(goals).toHaveClass("is-hidden");
    expect(goals).toHaveTextContent("Hidden");
    expect(screen.getByText("Harbourmaster").closest(".cx-meta-row")).not.toHaveClass("is-hidden");
  });

  it("groups relationships under their labels, marks a Hidden one, and a row opens its page", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/pages/p1");
    const panel = within(await screen.findByRole("region", { name: "Relationships" }));
    expect(panel.getByText("Member of")).toBeInTheDocument();
    expect(panel.getByRole("button", { name: /Wren/ })).toHaveTextContent("Hidden");
    await user.click(panel.getByRole("button", { name: /The Tidebound/ }));
    expect(window.location.pathname).toBe("/codex/pages/p2");
  });

  it("opens a journal entry that mentions the page in Story with that entry marked", async () => {
    const user = userEvent.setup();
    const push = vi.spyOn(window.history, "pushState");
    renderGmCodex("/codex/pages/p1");
    const mentioned = within(await screen.findByRole("region", { name: "Mentioned on" }));
    await user.click(mentioned.getByRole("button", { name: /We met Ysolde/ }));
    expect(push.mock.calls.at(-1)?.[2]).toBe("/codex/story?entry=j1");
  });

  it("opens a pin on its own map with the pin selected", async () => {
    const user = userEvent.setup();
    api.codexApi.markersForPage.mockResolvedValue([
      {
        id: "pin1",
        mapId: "m2",
        x: 1,
        y: 2,
        label: "Harbourmaster's Tower",
        iconId: "pin",
        iconColor: "#fff",
        revealedToPlayers: true
      }
    ]);
    api.atlasApi.listMaps.mockResolvedValue([
      { id: "m1", assetId: "a1", name: "The Sundered Coast" },
      { id: "m2", assetId: "a2", name: "Saltmere" }
    ]);
    renderGmCodex("/codex/pages/p1");
    const atlas = within(await screen.findByRole("region", { name: "On the atlas" }));
    await user.click(await atlas.findByRole("button", { name: /Harbourmaster's Tower · Saltmere/ }));
    expect(window.location.pathname).toBe("/codex/atlas/m2");
    expect(new URLSearchParams(window.location.search).get("pin")).toBe("pin1");
  });

  it("says the pin lookup failed rather than leaving the page off the atlas in silence", async () => {
    api.codexApi.markersForPage.mockRejectedValue(new Error("The codex request failed (500)."));
    renderGmCodex("/codex/pages/p1");
    const atlas = within(await screen.findByRole("region", { name: "On the atlas" }));
    expect(atlas.getByRole("alert")).toHaveTextContent("The codex request failed (500).");
  });

  it("shows the page in Relationships from More, centred on it", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/pages/p1");
    await screen.findByRole("heading", { level: 1, name: "Ysolde Varn" });
    await user.click(screen.getByLabelText("More"));
    await user.click(screen.getByRole("menuitem", { name: "Show in Relationships" }));
    expect(window.location.pathname).toBe("/codex/relationships");
    expect(window.location.search).toBe("?focus=p1");
  });

  it("deletes the page only after asking, then lands on its group", async () => {
    const user = userEvent.setup();
    api.codexApi.deletePage.mockResolvedValue({ deleted: true });
    renderGmCodex("/codex/pages/p1");
    await screen.findByRole("heading", { level: 1, name: "Ysolde Varn" });
    await user.click(screen.getByLabelText("More"));
    await user.click(screen.getByRole("menuitem", { name: "Delete page" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete page" });
    expect(api.codexApi.deletePage).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.codexApi.deletePage).toHaveBeenCalledWith("gm", "p1"));
    await waitFor(() => expect(window.location.search).toBe("?group=people"));
  });

  it("scrolls to and marks the block an address names", async () => {
    renderGmCodex("/codex/pages/p1?block=b1");
    const debt = await screen.findByRole("region", { name: "The debt · Hidden" });
    expect(debt).toHaveClass("is-focus");
    expect(screen.getByRole("region", { name: /Lena's letters/ })).not.toHaveClass("is-focus");
  });

  it("says the page is missing when the server has no such page", async () => {
    records.pageRecordApi.get.mockRejectedValue(new Error("That page does not exist."));
    renderGmCodex("/codex/pages/p9");
    expect(await screen.findByText("That page does not exist.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to Pages" })).toBeInTheDocument();
  });
});

describe("Revealing", () => {
  it("reveals a block to everyone through the block's own audience route", async () => {
    const user = userEvent.setup();
    records.pageRecordApi.blocks.setAudience.mockResolvedValue({
      ...YSOLDE,
      blocks: [{ ...YSOLDE.blocks[0], audience: "everyone", reveals: [{ ...STAMP, to: "everyone" }] }, YSOLDE.blocks[1]]
    });
    renderGmCodex("/codex/pages/p1");
    await user.click(await screen.findByRole("button", { name: "Reveal The debt" }));
    const panel = within(await screen.findByRole("dialog", { name: "Reveal The debt" }));
    expect(panel.getByText("Ysolde owes the Tidebound four thousand gold.")).toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: "Reveal to everyone" }));

    await waitFor(() =>
      expect(records.pageRecordApi.blocks.setAudience).toHaveBeenCalledWith("gm", "p1", "b1", { audience: "everyone" })
    );
    expect(await screen.findByRole("region", { name: "The debt · Revealed to everyone" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Reveal The debt" })).not.toBeInTheDocument();
  });

  it("reveals to chosen characters by name, and will not reveal to nobody", async () => {
    const user = userEvent.setup();
    records.pageRecordApi.blocks.setAudience.mockResolvedValue(YSOLDE);
    renderGmCodex("/codex/pages/p1");
    await user.click(await screen.findByRole("button", { name: "Reveal The debt" }));
    const panel = within(await screen.findByRole("dialog", { name: "Reveal The debt" }));
    await user.click(panel.getByLabelText("Chosen characters"));
    expect(panel.getByRole("button", { name: "Reveal" })).toBeDisabled();
    // The party is the table's characters: no archived character and no monster.
    expect(panel.queryByLabelText("Old Tam")).not.toBeInTheDocument();
    expect(panel.queryByLabelText("Wolf")).not.toBeInTheDocument();
    await user.click(panel.getByLabelText("Borin Stoneguard"));
    await user.click(panel.getByRole("button", { name: "Reveal to Borin Stoneguard" }));

    await waitFor(() =>
      expect(records.pageRecordApi.blocks.setAudience).toHaveBeenCalledWith("gm", "p1", "b1", {
        audience: "characters",
        characterIds: ["a-borin"]
      })
    );
  });

  it("hides a revealed block again in one step", async () => {
    const user = userEvent.setup();
    records.pageRecordApi.blocks.setAudience.mockResolvedValue(YSOLDE);
    renderGmCodex("/codex/pages/p1");
    await user.click(await screen.findByRole("button", { name: "Hide Lena's letters again" }));
    await waitFor(() =>
      expect(records.pageRecordApi.blocks.setAudience).toHaveBeenCalledWith("gm", "p1", "b2", { audience: "hidden" })
    );
  });

  it("says a reveal failed and keeps the block as it was", async () => {
    const user = userEvent.setup();
    records.pageRecordApi.blocks.setAudience.mockRejectedValue(new Error("The codex request failed (500)."));
    renderGmCodex("/codex/pages/p1");
    await user.click(await screen.findByRole("button", { name: "Reveal The debt" }));
    const panel = within(await screen.findByRole("dialog", { name: "Reveal The debt" }));
    await user.click(panel.getByRole("button", { name: "Reveal to everyone" }));
    expect(await panel.findByRole("alert")).toHaveTextContent("The codex request failed (500).");
    expect(screen.getByRole("region", { name: "The debt · Hidden" })).toBeInTheDocument();
  });

  it("reveals the whole page through the page's reveal route", async () => {
    const user = userEvent.setup();
    records.pageRecordApi.get.mockResolvedValue({ page: { ...YSOLDE, revealedToPlayers: false }, connections: [] });
    api.codexApi.revealPage.mockResolvedValue(YSOLDE);
    renderGmCodex("/codex/pages/p1");
    await user.click(await screen.findByLabelText("Who can open this page: Hidden"));
    await user.click(screen.getByRole("menuitemradio", { name: "Reveal the page to everyone" }));
    await waitFor(() => expect(api.codexApi.revealPage).toHaveBeenCalledWith("gm", "p1", true));
  });

  describe("Hiding a faction page takes its standing with it", () => {
    const TIDEBOUND = page({ id: "p2", title: "The Tidebound", entityType: "faction" });
    beforeEach(() => {
      records.pageRecordApi.get.mockResolvedValue({ page: TIDEBOUND, connections: [] });
      api.codexApi.revealPage.mockResolvedValue({ ...TIDEBOUND, revealedToPlayers: false });
      api.standingApi.list.mockResolvedValue([
        {
          id: "s1",
          factionPageId: "p2",
          value: 20,
          revealedToPlayers: true,
          createdAt: AT,
          updatedAt: AT,
          firstShownAt: AT
        }
      ]);
    });
    const hide = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(await screen.findByLabelText("Who can open this page: Everyone"));
      await user.click(screen.getByRole("menuitemradio", { name: "Hide the page from players" }));
    };

    it("asks first, and hides nothing while the question is open", async () => {
      const user = userEvent.setup();
      renderGmCodex("/codex/pages/p2");
      await hide(user);
      const ask = await screen.findByRole("dialog", { name: "Hide this faction page" });
      expect(ask).toHaveTextContent("Your standing with them stops being shown to players as well.");
      expect(api.codexApi.revealPage).not.toHaveBeenCalled();
    });

    it("Cancel calls no route, and Hide page goes through the page's own reveal route", async () => {
      const user = userEvent.setup();
      renderGmCodex("/codex/pages/p2");
      await hide(user);
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
      expect(api.codexApi.revealPage).not.toHaveBeenCalled();

      await hide(user);
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Hide page" }));
      await waitFor(() => expect(api.codexApi.revealPage).toHaveBeenCalledWith("gm", "p2", false));
    });

    it("does not ask about a page that carries no standing", async () => {
      const user = userEvent.setup();
      api.standingApi.list.mockResolvedValue([]);
      renderGmCodex("/codex/pages/p2");
      await hide(user);
      await waitFor(() => expect(api.codexApi.revealPage).toHaveBeenCalledWith("gm", "p2", false));
      expect(screen.queryByRole("dialog", { name: "Hide this faction page" })).not.toBeInTheDocument();
    });
  });
});

describe("See as players, in place", () => {
  it("swaps the page for exactly what Everyone's player receives, read on a preview token", async () => {
    const user = userEvent.setup();
    records.pageRecordApi.getForPlayer.mockResolvedValue({
      page: playerPage({ body: "The harbourmaster of Saltmere.\n\nShe keeps the tide clock." }),
      connections: []
    });
    renderGmCodex("/codex/pages/p1");
    await screen.findByRole("heading", { level: 1, name: "Ysolde Varn" });
    await user.click(screen.getByRole("switch", { name: "See as players" }));

    await waitFor(() => expect(api.codexApi.createPreviewSession).toHaveBeenCalledWith("gm", null));
    await waitFor(() => expect(records.pageRecordApi.getForPlayer).toHaveBeenCalledWith("preview-token", "p1"));
    expect(await screen.findByText("She keeps the tide clock.")).toBeInTheDocument();
    expect(screen.queryByText("Ysolde owes the Tidebound four thousand gold.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Reveal / })).not.toBeInTheDocument();
    // The GM stays at the page's own address.
    expect(window.location.pathname).toBe("/codex/pages/p1");
  });

  it("reads as one character's player when the GM picks that character", async () => {
    const user = userEvent.setup();
    records.pageRecordApi.getForPlayer.mockResolvedValue({ page: playerPage(), connections: [] });
    renderGmCodex("/codex/pages/p1");
    await screen.findByRole("heading", { level: 1, name: "Ysolde Varn" });
    await user.click(screen.getByLabelText("See as: Everyone"));
    await user.click(screen.getByRole("menuitemradio", { name: "Lyra Emberwise" }));
    await waitFor(() => expect(api.codexApi.createPreviewSession).toHaveBeenCalledWith("gm", "a-lyra"));
    expect(
      await screen.findByText("You are reading this page as Lyra Emberwise's player reads it.")
    ).toBeInTheDocument();
  });

  it("says plainly when the chosen player can't open the page at all", async () => {
    const user = userEvent.setup();
    records.pageRecordApi.getForPlayer.mockRejectedValue(new Error("That page does not exist."));
    renderGmCodex("/codex/pages/p1");
    await screen.findByRole("heading", { level: 1, name: "Ysolde Varn" });
    await user.click(screen.getByRole("switch", { name: "See as players" }));
    expect(await screen.findByText("A player can't open this page. It is Hidden.")).toBeInTheDocument();
  });
});

describe("Reading a page as a player (viewer safety)", () => {
  const PLAYER = playerPage({
    body: "The harbourmaster of Saltmere.\n\nLena wrote to Lyra every week.",
    fields: { role: "Harbourmaster" },
    blocks: [
      playerBlock({
        title: "Lena's letters",
        start: 32,
        end: 62,
        characterIds: ["a-lyra"],
        revealed: { at: LATER, sessionNumber: 5, inWorldDate: null, inWorldLabel: "Emberfall 12" }
      })
    ]
  });
  beforeEach(() => {
    records.pageRecordApi.getForPlayer.mockResolvedValue({ page: PLAYER, connections: [] });
  });

  it("reads the page through the player's own token and route, and never the GM's", async () => {
    renderPlayerCodex("/codex/pages/p1");
    expect(await screen.findByText("Lena wrote to Lyra every week.")).toBeInTheDocument();
    expect(records.pageRecordApi.getForPlayer).toHaveBeenCalledWith("player", "p1");
    expect(records.pageRecordApi.get).not.toHaveBeenCalled();
    expect(api.codexApi.listPages).not.toHaveBeenCalled();
  });

  it("shows a player no Hidden label, no Reveal and no count of what they can't read", async () => {
    renderPlayerCodex("/codex/pages/p1");
    await screen.findByText("Lena wrote to Lyra every week.");
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reveal/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/hidden/i)).not.toBeInTheDocument();
  });

  it("marks what reached the player since their last read of the page", async () => {
    localStorage.setItem("codex-page-read", JSON.stringify({ p1: AT }));
    renderPlayerCodex("/codex/pages/p1");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "New on this page since you last read it: Lena's letters"
    );
    expect(screen.getByText("Lena wrote to Lyra every week.").closest(".cx-doc-text")).toHaveClass("is-new");
  });

  it("says a page they can't open is not there, the same as one that does not exist", async () => {
    records.pageRecordApi.getForPlayer.mockRejectedValue(new Error("That page does not exist."));
    renderPlayerCodex("/codex/pages/p9");
    expect(await screen.findByText("That page does not exist.")).toBeInTheDocument();
  });
});

describe("A page on a phone", () => {
  beforeEach(() => setViewport(390));

  it("titles the top bar with the page, and turns each hidden block into a card with its Who sees it control", async () => {
    const user = userEvent.setup();
    records.pageRecordApi.blocks.setAudience.mockResolvedValue(YSOLDE);
    renderGmCodex("/codex/pages/p1");
    expect(await screen.findByRole("heading", { level: 2, name: "Ysolde Varn" })).toBeInTheDocument();
    const debt = screen.getByRole("region", { name: "The debt · Hidden" });
    expect(debt).toHaveClass("is-card");
    await user.click(within(debt).getByLabelText(/Who sees The debt/));
    await user.click(within(debt).getByRole("menuitemcheckbox", { name: "Lyra Emberwise" }));
    await waitFor(() =>
      expect(records.pageRecordApi.blocks.setAudience).toHaveBeenCalledWith("gm", "p1", "b1", {
        audience: "characters",
        characterIds: ["a-lyra"]
      })
    );
  });
});

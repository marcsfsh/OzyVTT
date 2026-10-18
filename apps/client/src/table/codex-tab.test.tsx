import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const listeners = vi.hoisted(() => new Map<string, Set<() => void>>());
vi.mock("../socket", () => ({
  socket: {
    on: (event: string, handler: () => void) => {
      listeners.set(event, (listeners.get(event) ?? new Set()).add(handler));
    },
    off: (event: string, handler: () => void) => listeners.get(event)?.delete(handler),
    emit: vi.fn()
  }
}));
vi.mock("../codex/api", async (actual) => (await import("../../test/codex-fakes")).fakeApiModule(await actual()));
vi.mock("../codex/api-records", async () => (await import("../../test/codex-fakes")).fakeRecordsModule());

import { ToastProvider } from "@vtt/ui";
import { api, block, hit, page, playerBlock, playerHit, playerPage, records, resetFakes } from "../../test/codex-fakes";
import { goTo } from "../../test/route";
import { CodexTab } from "./CodexTab";
import { useCodexNotice } from "./useCodexNotice";

const PARTY = [
  { id: "a-lyra", name: "Lyra Emberwise" },
  { id: "a-borin", name: "Borin Stoneguard" }
];
const YSOLDE = page({
  fields: { role: "Harbourmaster", location: "Saltmere", goals: "Pay the Tidebound back." },
  hiddenFields: ["goals"],
  blocks: [block({ id: "b1", title: "The debt", text: "She owes the Tidebound." })]
});

const renderTab = (role: "gm" | "player") =>
  render(
    <ToastProvider>
      <CodexTab role={role} token={role} party={role === "gm" ? PARTY : []} />
    </ToastProvider>
  );

beforeEach(() => {
  localStorage.clear();
  resetFakes();
  goTo("/table");
  records.findApi.search.mockResolvedValue({ hits: [hit()], truncated: false, total: 1 });
  records.findApi.searchAsPlayer.mockResolvedValue({ hits: [playerHit()], truncated: false, total: 1 });
  records.pageRecordApi.get.mockResolvedValue({ page: YSOLDE, connections: [] });
});

describe("The table's Codex tab for the GM", () => {
  it("finds pages by name a beat after typing stops, and reads one compactly beside the map", async () => {
    const user = userEvent.setup();
    renderTab("gm");
    expect(screen.getByText("Search for a page to read it here, beside the map.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search the Codex"), "ysol");
    await waitFor(() => expect(records.findApi.search).toHaveBeenCalledTimes(1));
    expect(records.findApi.search.mock.calls[0][1]).toMatchObject({ q: "ysol", limit: 8 });
    expect(records.findApi.search.mock.calls[0][1].types).not.toContain("journal");

    await user.click(await screen.findByRole("button", { name: /Ysolde Varn/ }));
    expect(await screen.findByRole("heading", { name: "Ysolde Varn" })).toBeInTheDocument();
    expect(screen.getByText("Harbourmaster · Saltmere")).toBeInTheDocument();
    // What only the GM sees is labelled so: the Hidden field and the Hidden block.
    expect(screen.getByText("Goals & motives · Hidden")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "The debt · Hidden" })).toBeInTheDocument();
    // The table stays where it is.
    expect(window.location.pathname).toBe("/table");
  });

  it("reveals a block from the tab through the block's own route", async () => {
    const user = userEvent.setup();
    localStorage.setItem("vtt.table-codex-recent.gm", JSON.stringify([{ id: "p1", title: "Ysolde Varn" }]));
    records.pageRecordApi.blocks.setAudience.mockResolvedValue({
      ...YSOLDE,
      blocks: [{ ...YSOLDE.blocks[0], audience: "characters", characterIds: ["a-lyra"] }]
    });
    renderTab("gm");
    await user.click(await screen.findByRole("button", { name: "Reveal The debt" }));
    const panel = within(await screen.findByRole("dialog", { name: "Reveal The debt" }));
    await user.click(panel.getByLabelText("Chosen characters"));
    await user.click(panel.getByLabelText("Lyra Emberwise"));
    await user.click(panel.getByRole("button", { name: "Reveal to Lyra Emberwise" }));
    await waitFor(() =>
      expect(records.pageRecordApi.blocks.setAudience).toHaveBeenCalledWith("gm", "p1", "b1", {
        audience: "characters",
        characterIds: ["a-lyra"]
      })
    );
    expect(await screen.findByRole("region", { name: "The debt · Revealed to Lyra Emberwise" })).toBeInTheDocument();
  });

  it("remembers the pages read here as chips, newest first, and reopens the last one", async () => {
    const user = userEvent.setup();
    const view = renderTab("gm");
    await user.type(screen.getByLabelText("Search the Codex"), "ysol");
    await user.click(await screen.findByRole("button", { name: /Ysolde Varn/ }));
    await screen.findByRole("heading", { name: "Ysolde Varn" });
    view.unmount();

    renderTab("gm");
    const recent = within(screen.getByRole("list", { name: "Recent pages" }));
    expect(recent.getByRole("button", { name: "Ysolde Varn" })).toHaveAttribute("aria-current", "true");
    expect(await screen.findByRole("heading", { name: "Ysolde Varn" })).toBeInTheDocument();
  });

  it("opens a hit that is no page at its own address, and the whole page from the compact one", async () => {
    const user = userEvent.setup();
    records.findApi.search.mockResolvedValue({
      hits: [hit({ kind: "quest", id: "q1", title: "The Sunless Crown", entityType: null, type: "quest" })],
      truncated: false,
      total: 1
    });
    const view = renderTab("gm");
    await user.type(screen.getByLabelText("Search the Codex"), "crown");
    await user.click(await screen.findByRole("button", { name: /The Sunless Crown/ }));
    expect(window.location.pathname).toBe("/codex/quests/q1");
    view.unmount();

    goTo("/table");
    localStorage.setItem("vtt.table-codex-recent.gm", JSON.stringify([{ id: "p1", title: "Ysolde Varn" }]));
    renderTab("gm");
    await user.click(await screen.findByRole("button", { name: "Open the whole page" }));
    expect(window.location.pathname).toBe("/codex/pages/p1");
  });

  it("opens a page a block links to in the tab itself", async () => {
    const user = userEvent.setup();
    localStorage.setItem("vtt.table-codex-recent.gm", JSON.stringify([{ id: "p1", title: "Ysolde Varn" }]));
    records.pageRecordApi.get.mockImplementation(async (_t: string, id: string) =>
      id === "p1"
        ? {
            page: { ...YSOLDE, blocks: [block({ id: "b1", title: "The debt", text: "She owes [[The Tidebound]]." })] },
            connections: []
          }
        : { page: page({ id: "p2", title: "The Tidebound", entityType: "faction", blocks: [] }), connections: [] }
    );
    api.codexApi.listPages.mockResolvedValue([{ id: "p2", title: "The Tidebound", entityType: "faction" }]);
    renderTab("gm");
    await user.click(await screen.findByRole("button", { name: "The Tidebound" }));
    expect(await screen.findByRole("heading", { name: "The Tidebound" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/table");
  });

  it("says when the search failed, and when nothing matched", async () => {
    const user = userEvent.setup();
    records.findApi.search.mockRejectedValueOnce(new Error("The codex request failed (500)."));
    renderTab("gm");
    await user.type(screen.getByLabelText("Search the Codex"), "ysol");
    expect(await screen.findByRole("alert")).toHaveTextContent("The codex request failed (500).");

    records.findApi.search.mockResolvedValue({ hits: [], truncated: false, total: 0 });
    await user.type(screen.getByLabelText("Search the Codex"), "zz");
    expect(await screen.findByText("Nothing matches.")).toBeInTheDocument();
  });
});

describe("The table's Codex tab for a player (viewer safety)", () => {
  it("searches and reads through the player's own routes, with the newest block marked", async () => {
    const user = userEvent.setup();
    records.pageRecordApi.getForPlayer.mockResolvedValue({
      page: playerPage({
        body: "The harbourmaster of Saltmere.\n\nShe owes the Tidebound.\n\nLena wrote every week.",
        blocks: [
          playerBlock({
            title: "The debt",
            start: 32,
            end: 55,
            revealed: { at: "2026-10-02T00:00:00.000Z", sessionNumber: 6, inWorldDate: null, inWorldLabel: null }
          }),
          playerBlock({
            title: "Lena's letters",
            start: 57,
            end: 79,
            revealed: { at: "2026-10-01T00:00:00.000Z", sessionNumber: 5, inWorldDate: null, inWorldLabel: null }
          })
        ]
      }),
      connections: []
    });
    renderTab("player");
    await user.type(screen.getByLabelText("Search the Codex"), "ysol");
    await user.click(await screen.findByRole("button", { name: /Ysolde Varn/ }));
    expect(await screen.findByText("She owes the Tidebound.")).toBeInTheDocument();

    expect(records.findApi.searchAsPlayer.mock.calls[0][0]).toBe("player");
    expect(records.pageRecordApi.getForPlayer).toHaveBeenCalledWith("player", "p1");
    expect(records.findApi.search).not.toHaveBeenCalled();
    expect(records.pageRecordApi.get).not.toHaveBeenCalled();
    expect(screen.getByText("She owes the Tidebound.").closest(".cx-doc-text")).toHaveClass("is-new");
    expect(screen.getByText("Lena wrote every week.").closest(".cx-doc-text")).not.toHaveClass("is-new");
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reveal/ })).not.toBeInTheDocument();
  });

  it("keeps a player's recent pages apart from the GM's on a shared device", async () => {
    localStorage.setItem("vtt.table-codex-recent.gm", JSON.stringify([{ id: "p9", title: "The GM's secret page" }]));
    renderTab("player");
    expect(screen.queryByText("The GM's secret page")).not.toBeInTheDocument();
  });
});

function NoticeProbe({ token }: Readonly<{ token: string | null }>) {
  useCodexNotice(token);
  return null;
}

describe("The table tells a player when the Codex gives them something new", () => {
  const listed = (at: string) => [
    {
      id: "p1",
      title: "Ysolde Varn",
      entityType: "character",
      tags: [],
      bannerAssetId: null,
      playerUpdatedAt: "2026-10-01T00:00:00.000Z"
    },
    { id: "p2", title: "Saltmere", entityType: "location", tags: [], bannerAssetId: null, playerUpdatedAt: at }
  ];

  it("says nothing on the first read, then names the page that reached the player since", async () => {
    api.playerCodexApi.listPages.mockResolvedValue(listed("2026-10-01T00:00:00.000Z"));
    render(
      <ToastProvider>
        <NoticeProbe token="player" />
      </ToastProvider>
    );
    await waitFor(() => expect(api.playerCodexApi.listPages).toHaveBeenCalledWith("player"));
    expect(screen.queryByText(/New in the Codex/)).not.toBeInTheDocument();

    api.playerCodexApi.listPages.mockResolvedValue(listed("2026-10-05T00:00:00.000Z"));
    act(() => listeners.get("codex:changed")?.forEach((handler) => handler()));
    expect(await screen.findByText("New in the Codex: Saltmere")).toBeInTheDocument();
  });

  it("reads nothing for a GM, who has no token here", () => {
    render(
      <ToastProvider>
        <NoticeProbe token={null} />
      </ToastProvider>
    );
    expect(api.playerCodexApi.listPages).not.toHaveBeenCalled();
  });
});

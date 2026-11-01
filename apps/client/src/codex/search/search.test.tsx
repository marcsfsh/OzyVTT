import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("../api", async (actual) => (await import("../../../test/codex-fakes")).fakeApiModule(await actual()));
vi.mock("../api-records", async () => (await import("../../../test/codex-fakes")).fakeRecordsModule());

import { hit, playerHit, records, resetFakes } from "../../../test/codex-fakes";
import { renderGmCodex, renderPlayerCodex } from "../../../test/codex-render";
import { setViewport } from "../../../test/viewport";

const HITS = [
  hit({ id: "p1", title: "Strahd", match: { line: "Strahd waits in the castle.", hidden: false } }),
  hit({
    kind: "marker",
    id: "pin1",
    title: "Tser Pool",
    entityType: null,
    mapId: "m2",
    type: "marker",
    revealedToPlayers: false
  }),
  hit({ kind: "map", id: "m1", title: "Barovia", entityType: null, type: "map" }),
  hit({
    kind: "journal",
    id: "j1",
    title: "Strahd crossed the bridge.",
    entityType: null,
    type: "journal",
    match: { line: "Strahd knows the party's names.", hidden: true }
  }),
  hit({ kind: "quest", id: "q2", title: "The Sunless Crown", entityType: null, type: "quest" }),
  hit({ kind: "session", id: "s3", title: "Session 3", entityType: null, type: "session" })
];

const results = () => within(screen.getByRole("list", { name: "Results" }));
const rows = () => results().getAllByRole("listitem");
/** Opens a result: choose its row, then the chosen pane's Open the page. */
async function openRow(user: ReturnType<typeof userEvent.setup>, index: number) {
  await user.click(within(rows()[index]!).getByRole("button"));
  await user.click(screen.getByRole("button", { name: "Open the page" }));
}
/** Where a row sent the browser, whatever the destination does with its address once it opens. */
const pushed = () => vi.spyOn(window.history, "pushState");

beforeEach(() => {
  localStorage.clear();
  resetFakes();
  records.findApi.search.mockResolvedValue({ hits: HITS, truncated: false, total: 6 });
});

describe("Search, the GM's panes", () => {
  it("lists every kind of record as rows, each naming its kind in words", async () => {
    renderGmCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(6));
    expect(rows().map((row) => row.querySelector(".cx-hit-kind")?.textContent)).toEqual([
      "Character",
      "Pin",
      "Map",
      "Chronicle entry",
      "Quest",
      "Session"
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("6 results");
  });

  it("counts each kind at the side, and a kind filters the rows to it", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(6));
    const kinds = within(screen.getByRole("group", { name: "Kinds" }));
    expect(kinds.getByRole("button", { name: /^All/ })).toHaveTextContent("6");
    await user.click(kinds.getByRole("button", { name: /^Pin/ }));
    expect(new URLSearchParams(window.location.search).get("types")).toBe("marker");
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByRole("status")).toHaveTextContent("1 result");
    expect(records.findApi.search).toHaveBeenCalledTimes(1);
  });

  it("chooses the first result on arrival and shows its match beside the list", async () => {
    renderGmCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(6));
    expect(within(rows()[0]!).getByRole("button")).toHaveAttribute("aria-current", "true");
    const pane = within(screen.getByRole("region", { name: "Strahd" }));
    expect(pane.getByText("Strahd", { selector: "mark" })).toBeInTheDocument();
    expect(pane.getByText(/waits in the castle/)).toBeInTheDocument();
  });

  it("moves the choice with the arrows and opens it with Enter", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(6));
    await user.click(screen.getByLabelText("Search"));
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(within(rows()[2]!).getByRole("button")).toHaveAttribute("aria-current", "true");
    expect(new URLSearchParams(window.location.search).get("hit")).toBe("map:m1");
    await user.keyboard("{ArrowUp}{Enter}");
    expect(window.location.pathname).toBe("/codex/atlas/m2");
  });

  it("marks the searched words, and says a line from hidden text is hidden, in violet", async () => {
    renderGmCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(6));
    const journal = rows()[3]!;
    expect(within(journal).getAllByText("Strahd", { selector: "mark" }).length).toBeGreaterThan(0);
    expect(journal.querySelector(".cx-matchline.is-hidden")).not.toBeNull();
    expect(within(journal).getByText("Hidden text:")).toBeInTheDocument();
  });

  it("reads a hit in a page's hidden block as so, with its tag in the chosen pane", async () => {
    records.findApi.search.mockResolvedValue({
      hits: [hit({ id: "p9", title: "Ireena", match: { line: "Strahd wants Ireena.", hidden: true } })],
      truncated: false,
      total: 1
    });
    renderGmCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText("Hidden block:")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Ireena" })).getByText("1 block hidden")).toBeInTheDocument();
  });

  it("says the search failed, and never that nothing matched", async () => {
    records.findApi.search.mockRejectedValue(new Error("The codex request failed (500)."));
    renderGmCodex("/codex/search?q=strahd");
    expect(await screen.findByRole("alert")).toHaveTextContent("The codex request failed (500).");
    expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument();
  });

  it("still says so when nothing matches", async () => {
    records.findApi.search.mockResolvedValue({ hits: [], truncated: false, total: 0 });
    renderGmCodex("/codex/search?q=zzz");
    expect(await screen.findByText("Nothing matches. Change the words or the filters.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("asks once for a settled query, never once per keystroke", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/search");
    await waitFor(() => expect(records.findApi.search).toHaveBeenCalledTimes(1));
    await user.type(screen.getByLabelText("Search"), "strahd");
    await waitFor(() => expect(records.findApi.search).toHaveBeenCalledTimes(2));
    expect(records.findApi.search.mock.calls[1][1].q).toBe("strahd");
  });

  it("lists every record again once the box is cleared, in one request", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/search?q=strahd");
    await waitFor(() => expect(records.findApi.search).toHaveBeenCalledTimes(1));
    await user.clear(screen.getByLabelText("Search"));
    await waitFor(() => expect(window.location.search).toBe(""));
    await waitFor(() => expect(records.findApi.search).toHaveBeenCalledTimes(2));
    expect(records.findApi.search.mock.calls[1][1].q).toBe("");
  });

  it("sends who sees it, when it changed and the sort to the server", async () => {
    renderGmCodex("/codex/search?visibility=hidden&types=character,location&from=2026-09-01&sort=modified:desc");
    await waitFor(() => expect(records.findApi.search).toHaveBeenCalled());
    expect(records.findApi.search.mock.calls[0]).toEqual([
      "gm",
      {
        q: "",
        visibility: "hidden",
        modifiedFrom: "2026-09-01",
        modifiedTo: null,
        sort: ["modified:desc"],
        limit: 200
      }
    ]);
    expect(
      within(screen.getByRole("group", { name: "Who sees it" })).getByRole("button", { name: "Hidden" })
    ).toHaveAttribute("aria-current", "true");
  });

  it("filters to Hidden from Who sees it, and back to all", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/search");
    const who = within(await screen.findByRole("group", { name: "Who sees it" }));
    await user.click(who.getByRole("button", { name: "Hidden" }));
    expect(new URLSearchParams(window.location.search).get("visibility")).toBe("hidden");
    await waitFor(() => expect(records.findApi.search.mock.calls.at(-1)![1].visibility).toBe("hidden"));
    await user.click(who.getByRole("button", { name: "Hidden" }));
    expect(new URLSearchParams(window.location.search).get("visibility")).toBeNull();
  });

  it("sorts by several columns in order from the results' More", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/search");
    await user.click(await screen.findByLabelText("Sort and when it changed"));
    await user.click(screen.getByRole("menuitem", { name: "Sort: Name…" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Sort" }));
    await user.selectOptions(dialog.getByLabelText("Sort by: column"), "type");
    await user.click(dialog.getByRole("button", { name: "Add a level" }));
    await user.selectOptions(dialog.getByLabelText("Then by: column"), "modified");
    await user.click(dialog.getByRole("button", { name: "Sort" }));
    expect(new URLSearchParams(window.location.search).get("sort")).toBe("type:asc,modified:desc");
    await waitFor(() =>
      expect(records.findApi.search.mock.calls.at(-1)![1].sort).toEqual(["type:asc", "modified:desc"])
    );
  });

  it("says when the list was cut at the limit", async () => {
    records.findApi.search.mockResolvedValue({ hits: HITS, truncated: true, total: 412 });
    renderGmCodex("/codex/search");
    expect(await screen.findByText("Showing the first 6. Narrow the search to see the rest.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("412 results");
  });
});

describe("Every jump prepares its destination", () => {
  it("a page hit opens the page", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(6));
    await openRow(user, 0);
    expect(window.location.pathname).toBe("/codex/pages/p1");
  });

  it("a pin hit opens the atlas on the pin's own map with the pin chosen", async () => {
    const user = userEvent.setup();
    const push = pushed();
    renderGmCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(6));
    await openRow(user, 1);
    expect(push.mock.calls.at(-1)?.[2]).toBe("/codex/atlas/m2?pin=pin1");
  });

  it("a map hit opens the atlas on that map with no pin chosen", async () => {
    const user = userEvent.setup();
    const push = pushed();
    renderGmCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(6));
    await openRow(user, 2);
    expect(push.mock.calls.at(-1)?.[2]).toBe("/codex/atlas/m1");
  });

  it("a journal hit opens Story with that entry marked, and a quest hit opens that quest", async () => {
    const user = userEvent.setup();
    const push = pushed();
    const view = renderGmCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(6));
    await openRow(user, 3);
    expect(push.mock.calls.at(-1)?.[2]).toBe("/codex/story?entry=j1");
    view.unmount();

    renderGmCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(6));
    await openRow(user, 4);
    expect(window.location.pathname).toBe("/codex/quests/q2");
  });
});

describe("A player's Search (viewer safety)", () => {
  const PLAYER_HITS = [
    playerHit({ id: "p1", title: "Strahd", match: { line: "Strahd waits in the castle." } }),
    playerHit({ kind: "marker", id: "pin1", title: "Tser Pool", entityType: null, mapId: "m2", type: "marker" }),
    playerHit({ kind: "quest", id: "q2", title: "The Sunless Crown", entityType: null, type: "quest" })
  ];
  beforeEach(() => {
    records.findApi.searchAsPlayer.mockResolvedValue({ hits: PLAYER_HITS, truncated: false, total: 3 });
  });

  it("asks the player's search, never the GM's, and offers no visibility filter or column", async () => {
    renderPlayerCodex("/codex/search?q=strahd&visibility=hidden");
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(records.findApi.searchAsPlayer.mock.calls[0][0]).toBe("player");
    expect(records.findApi.searchAsPlayer.mock.calls[0][1].visibility).toBe("all");
    expect(records.findApi.search).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Who sees it" })).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });

  it("renders the kinds the server sends, and a pin hit opens its map with the pin chosen", async () => {
    const user = userEvent.setup();
    const push = pushed();
    renderPlayerCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows().map((row) => row.querySelector(".cx-hit-kind")?.textContent)).toEqual(["Character", "Pin", "Quest"]);
    await openRow(user, 1);
    expect(push.mock.calls.at(-1)?.[2]).toBe("/codex/atlas/m2?pin=pin1");
  });

  it("tells a player the search failed, and never that nothing matches", async () => {
    records.findApi.searchAsPlayer.mockRejectedValue(new Error("The codex request failed (500)."));
    renderPlayerCodex("/codex/search?q=strahd");
    expect(await screen.findByRole("alert")).toHaveTextContent("The codex request failed (500).");
    expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument();
  });

  it("debounces a player's typing too", async () => {
    const user = userEvent.setup();
    renderPlayerCodex("/codex/search");
    await waitFor(() => expect(records.findApi.searchAsPlayer).toHaveBeenCalledTimes(1));
    await user.type(screen.getByLabelText("Search"), "strahd");
    await waitFor(() => expect(records.findApi.searchAsPlayer).toHaveBeenCalledTimes(2));
    expect(records.findApi.searchAsPlayer.mock.calls[1][1].q).toBe("strahd");
  });
});

describe("Search on a phone", () => {
  beforeEach(() => setViewport(390));

  it("puts the box in the top bar, narrows by kind with chips, and remembers recent searches", async () => {
    const user = userEvent.setup();
    const view = renderGmCodex("/codex/search?q=strahd");
    // A row opens under itself with the part that matched and the way in.
    await user.click((await screen.findAllByRole("button", { name: /^Strahd/ }))[0]!);
    expect(screen.getByText(/waits in the castle/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open the page" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "Kinds" })).getByRole("button", { name: "Places" }));
    expect(new URLSearchParams(window.location.search).get("types")).toBe("location");
    view.unmount();

    renderGmCodex("/codex/search");
    await user.click(await screen.findByRole("button", { name: "strahd" }));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("q")).toBe("strahd"));
  });
});

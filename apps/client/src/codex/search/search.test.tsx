import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("../MapSurface", () => ({ MapSurface: () => <div data-testid="map-surface" /> }));
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

const table = () => within(screen.getByRole("table"));
const rows = () => table().getAllByRole("row").slice(1);
/** Where a row sent the browser, whatever the destination does with its address once it opens. */
const pushed = () => vi.spyOn(window.history, "pushState");

beforeEach(() => {
  localStorage.clear();
  resetFakes();
  records.findApi.search.mockResolvedValue({ hits: HITS, truncated: false, total: 6 });
});

describe("Search, the GM's table", () => {
  it("lists every kind of record in one table, each naming its type in words", async () => {
    renderGmCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(6));
    expect(rows().map((row) => within(row).getAllByRole("cell")[2].textContent)).toEqual([
      "Character",
      "Pin",
      "Map",
      "Chronicle entry",
      "Quest",
      "Session"
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("6 results");
  });

  it("marks the searched words, and shows a line from hidden text in violet as Hidden", async () => {
    renderGmCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(6));
    const journal = rows()[3];
    expect(within(journal).getByText("Strahd", { selector: "mark" })).toBeInTheDocument();
    expect(journal.querySelector(".cx-matchline")).toHaveClass("is-hidden");
    expect(within(journal).getByText("Hidden text:")).toBeInTheDocument();
    expect(within(rows()[1]).getAllByText("Hidden").length).toBeGreaterThan(0);
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
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("q")).toBe("strahd"));
    await waitFor(() => expect(records.findApi.search).toHaveBeenCalledTimes(2));
    expect(records.findApi.search.mock.calls.map((call) => call[1].q)).toEqual(["", "strahd"]);
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

  it("sends the filters in the address to the server, which does the filtering", async () => {
    renderGmCodex("/codex/search?visibility=hidden&types=character,location&from=2026-09-01&sort=modified:desc");
    await waitFor(() => expect(records.findApi.search).toHaveBeenCalled());
    expect(records.findApi.search.mock.calls[0]).toEqual([
      "gm",
      {
        q: "",
        types: ["character", "location"],
        visibility: "hidden",
        modifiedFrom: "2026-09-01",
        modifiedTo: null,
        sort: ["modified:desc"],
        limit: 200
      }
    ]);
    expect(screen.getByText("Visibility: Hidden")).toBeInTheDocument();
    expect(screen.getByText("Type: 2 of 13")).toBeInTheDocument();
  });

  it("filters to Hidden from the Visibility menu", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/search");
    await user.click(await screen.findByRole("button", { name: /Visibility: All/ }));
    await user.click(screen.getByLabelText("Hidden"));
    expect(new URLSearchParams(window.location.search).get("visibility")).toBe("hidden");
    await waitFor(() => expect(records.findApi.search.mock.calls.at(-1)![1].visibility).toBe("hidden"));
  });

  it("asks for nothing once every type is cleared", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/search");
    await waitFor(() => expect(records.findApi.search).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: /Type: all 13/ }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(new URLSearchParams(window.location.search).get("types")).toBe("none");
    expect(await screen.findByText("Nothing matches. Change the words or the filters.")).toBeInTheDocument();
    expect(records.findApi.search).toHaveBeenCalledTimes(1);
  });

  it("sorts by several columns in order, as a spreadsheet does", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/search");
    await user.click(await screen.findByRole("button", { name: "Sort: Name" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Sort" }));
    await user.selectOptions(dialog.getByLabelText("Sort by: column"), "type");
    await user.click(dialog.getByRole("button", { name: "Add a level" }));
    await user.selectOptions(dialog.getByLabelText("Then by: column"), "modified");
    await user.click(dialog.getByRole("button", { name: "Sort" }));
    expect(new URLSearchParams(window.location.search).get("sort")).toBe("type:asc,modified:desc");
    await waitFor(() =>
      expect(records.findApi.search.mock.calls.at(-1)![1].sort).toEqual(["type:asc", "modified:desc"])
    );
    expect(screen.getByRole("button", { name: "Sort: Type, then Modified" })).toBeInTheDocument();
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
    await user.click(within(rows()[0]).getByRole("button"));
    expect(window.location.pathname).toBe("/codex/pages/p1");
  });

  it("a pin hit opens the atlas on the pin's own map with the pin chosen", async () => {
    const user = userEvent.setup();
    const push = pushed();
    renderGmCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(6));
    await user.click(within(rows()[1]).getByRole("button"));
    expect(push.mock.calls.at(-1)?.[2]).toBe("/codex/atlas/m2?pin=pin1");
  });

  it("a map hit opens the atlas on that map with no pin chosen", async () => {
    const user = userEvent.setup();
    const push = pushed();
    renderGmCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(6));
    await user.click(within(rows()[2]).getByRole("button"));
    expect(push.mock.calls.at(-1)?.[2]).toBe("/codex/atlas/m1");
  });

  it("a journal hit opens Story with that entry marked, and a quest hit opens that quest", async () => {
    const user = userEvent.setup();
    const push = pushed();
    const view = renderGmCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(6));
    await user.click(within(rows()[3]).getByRole("button"));
    expect(push.mock.calls.at(-1)?.[2]).toBe("/codex/story?entry=j1");
    view.unmount();

    renderGmCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(6));
    await user.click(within(rows()[4]).getByRole("button"));
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
    expect(screen.queryByRole("button", { name: /Visibility/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Who sees it" })).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });

  it("renders the kinds the server sends, and a pin hit opens its map with the pin chosen", async () => {
    const user = userEvent.setup();
    const push = pushed();
    renderPlayerCodex("/codex/search?q=strahd");
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows().map((row) => within(row).getAllByRole("cell")[1].textContent)).toEqual(["Character", "Pin", "Quest"]);
    await user.click(within(rows()[1]).getByRole("button"));
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
    expect(await screen.findByText(/waits in the castle/)).toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "Kinds" })).getByRole("button", { name: "Places" }));
    expect(new URLSearchParams(window.location.search).get("types")).toBe("location");
    view.unmount();

    renderGmCodex("/codex/search");
    await user.click(await screen.findByRole("button", { name: "strahd" }));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("q")).toBe("strahd"));
  });
});

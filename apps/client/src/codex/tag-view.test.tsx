import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The cross-type tag view. Pins come through search (they load per map) and are exact-matched on their
 * tags, so `#coastal` never appears under `#coast`. Role-blind by shape: the visibility badge renders only
 * when the row carries `revealedToPlayers`. A truncated pin search says so.
 */

const gmSearch = vi.fn();
const playerSearch = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: { ...actual.codexApi, search: (...a: unknown[]) => gmSearch(...a) },
    playerCodexApi: { ...actual.playerCodexApi, search: (...a: unknown[]) => playerSearch(...a) }
  };
});

import { TagView, type TagViewProps } from "./TagView";

const PAGES = [
  { id: "p1", title: "Vallaki", entityType: "location" as const, tags: ["coast"], revealedToPlayers: true },
  { id: "p2", title: "Strahd", entityType: "character" as const, tags: ["coastal"], revealedToPlayers: false },
  { id: "p3", title: "Krezk", entityType: "location" as const, tags: ["mountain"], revealedToPlayers: true }
];
const MAPS = [{ id: "m1", name: "Barovia", tags: ["coast"], revealedToPlayers: false }];
const RECORDS = [
  {
    id: "j1",
    kind: "entry" as const,
    text: "We reached the shore",
    payload: null,
    tags: ["coast"],
    revealedToPlayers: true
  },
  { id: "j2", kind: "entry" as const, text: "Inland", payload: null, tags: ["mountain"], revealedToPlayers: true }
];
const SESSIONS = [{ id: "s1", sessionNumber: 4, tags: ["coast"], revealedToPlayers: false }];
const QUESTS = [
  { id: "q1", title: "The Missing Cask", status: "active" as const, tags: ["coast"], revealedToPlayers: true }
];

const PIN_HIT = {
  kind: "marker" as const,
  id: "k1",
  title: "The lighthouse",
  tags: ["coast"],
  entityType: null,
  mapId: "m1"
};
const OTHER_PIN = {
  kind: "marker" as const,
  id: "k2",
  title: "Inland well",
  tags: ["coastal"],
  entityType: null,
  mapId: "m1"
};

const renderTags = (over: Partial<TagViewProps> = {}) => {
  const props: TagViewProps = {
    gmToken: "gm",
    tag: "coast",
    pages: PAGES,
    maps: MAPS,
    records: RECORDS,
    sessions: SESSIONS,
    quests: QUESTS,
    onNavigate: vi.fn(),
    ...over
  };
  return { props, ...render(<TagView {...props} />) };
};

beforeEach(() => {
  gmSearch.mockResolvedValue({ hits: [PIN_HIT, OTHER_PIN], truncated: false });
  playerSearch.mockResolvedValue({ hits: [], truncated: false });
});

describe("Everything that carries the tag, across types", () => {
  it("lists one section per kind, exact-matched on the slug", async () => {
    renderTags();

    expect(screen.getByRole("heading", { name: "#coast" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Pages with this tag" })).getAllByRole("button")).toHaveLength(
      1
    );
    expect(screen.queryByText("Strahd")).toBeNull();
    expect(screen.getByText("Vallaki")).toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation", { name: "Maps with this tag" })).getByText("Barovia")
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation", { name: "Journal entries with this tag" })).getByText(
        "We reached the shore"
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation", { name: "Sessions with this tag" })).getByText("Session 4")
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation", { name: "Quests with this tag" })).getByText("The Missing Cask")
    ).toBeInTheDocument();

    const pins = within(await screen.findByRole("navigation", { name: "Pins with this tag" }));
    expect(pins.getByText("The lighthouse")).toBeInTheDocument();
    expect(pins.queryByText("Inland well")).toBeNull();
  });

  it("opens each row at the address that record already has", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderTags({ onNavigate });

    await user.click(screen.getByRole("button", { name: /Vallaki/ }));
    expect(onNavigate).toHaveBeenLastCalledWith("/codex/pages/p1");
    await user.click(screen.getByRole("button", { name: /Barovia/ }));
    expect(onNavigate).toHaveBeenLastCalledWith("/codex/atlas/m1");
    await user.click(screen.getByRole("button", { name: /We reached the shore/ }));
    expect(onNavigate).toHaveBeenLastCalledWith("/codex/story?entry=j1");
    await user.click(screen.getByRole("button", { name: /Session 4/ }));
    expect(onNavigate).toHaveBeenLastCalledWith("/codex/sessions/s1");
    await user.click(screen.getByRole("button", { name: /The Missing Cask/ }));
    expect(onNavigate).toHaveBeenLastCalledWith("/codex/quests/q1");

    // A pin opens its map and selects the pin.
    await user.click(await screen.findByRole("button", { name: /The lighthouse/ }));
    expect(onNavigate).toHaveBeenLastCalledWith("/codex/atlas/m1?pin=k1");
  });

  it("names a quest's status in the word every other surface uses", () => {
    renderTags();
    // The status label, never the wire value.
    expect(
      within(screen.getByRole("navigation", { name: "Quests with this tag" })).getByText("Active")
    ).toBeInTheDocument();
  });

  it("says the tag is unused rather than rendering empty sections", async () => {
    renderTags({ tag: "nothing-has-this" });
    expect(await screen.findByText("Nothing carries this tag yet.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Pages with this tag" })).toBeNull();
  });

  it("normalizes the tag from the address before matching", () => {
    // `#Coast` and `coast ` find the same records as `coast`.
    renderTags({ tag: "  COAST " });
    expect(screen.getByRole("heading", { name: "#coast" })).toBeInTheDocument();
    expect(screen.getByText("Vallaki")).toBeInTheDocument();
  });
});

describe("Pins: the one kind that is not client-enumerable", () => {
  it("waits for the search rather than claiming there are no pins", () => {
    let resolve: (value: unknown) => void = () => {};
    gmSearch.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const { container } = renderTags();

    expect(container.querySelector(".codex-list-loading")).not.toBeNull();
    expect(screen.queryByText("No pins carry this tag.")).toBeNull();
    resolve({ hits: [], truncated: false });
  });

  it("admits a clipped answer instead of presenting it as the whole one", async () => {
    gmSearch.mockResolvedValue({ hits: [PIN_HIT], truncated: true });
    renderTags();

    expect(
      await screen.findByText("More pins may carry this tag. Filter by tag in the Atlas to see all of them.")
    ).toBeInTheDocument();
  });

  it("says so plainly when the search comes back with none", async () => {
    gmSearch.mockResolvedValue({ hits: [], truncated: false });
    renderTags();

    expect(await screen.findByText("No pins carry this tag.")).toBeInTheDocument();
  });
});

describe("Role-blindness", () => {
  it("badges reveal state for the GM, on every kind that has one", () => {
    renderTags();
    // The badge is per row.
    expect(within(screen.getByRole("button", { name: /Vallaki/ })).getByText("Shown to players")).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: /Barovia/ })).getByText("Hidden from players")
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: /Session 4/ })).getByText("Hidden from players")
    ).toBeInTheDocument();
  });

  it("shows no reveal badge at all on player rows, because the field is absent (no flag says so)", async () => {
    playerSearch.mockResolvedValue({ hits: [PIN_HIT], truncated: false });
    // Player projections have no `revealedToPlayers`; they type-check unchanged.
    render(
      <TagView
        gmToken="player-token"
        player
        tag="coast"
        onNavigate={vi.fn()}
        pages={[{ id: "p1", title: "Vallaki", entityType: "location", tags: ["coast"] }]}
        maps={[{ id: "m1", name: "Barovia", tags: ["coast"] }]}
        records={[{ id: "j1", kind: "entry", text: "We reached the shore", payload: null, tags: ["coast"] }]}
        sessions={[{ id: "s1", sessionNumber: 4, tags: ["coast"] }]}
        quests={[{ id: "q1", title: "The Missing Cask", status: "active", tags: ["coast"] }]}
      />
    );

    await screen.findByRole("navigation", { name: "Pins with this tag" });
    expect(screen.queryByText("Shown to players")).toBeNull();
    expect(screen.queryByText("Hidden from players")).toBeNull();
  });

  it("a player's pins come from the PLAYER search route and never the GM's", async () => {
    playerSearch.mockResolvedValue({ hits: [PIN_HIT], truncated: false });
    render(
      <TagView
        gmToken="player-token"
        player
        tag="coast"
        onNavigate={vi.fn()}
        pages={[]}
        maps={[]}
        records={[]}
        sessions={[]}
        quests={[]}
      />
    );

    await waitFor(() => expect(playerSearch).toHaveBeenCalledWith("player-token", "coast"));
    // The GM search is never called from the player view.
    expect(gmSearch).not.toHaveBeenCalled();
  });
});

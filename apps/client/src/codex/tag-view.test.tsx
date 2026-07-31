import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * D10 — **clicking a tag anywhere opens everything that carries it**, and the owed test for that view.
 *
 * Three properties are load-bearing and none of them was covered.
 *
 * **It is cross-type.** Pages, maps, journal records, sessions and quests come from feeds the shell
 * already holds and are filtered by EXACT slug; **pins** are the one kind that is not client-enumerable
 * (they load per map), so they arrive through the search route and are exact-matched on the hit's own
 * tags — a substring match here would put `#coastal` under `#coast`.
 *
 * **It is role-blind by SHAPE, not by a flag** (invariant 2 / §3.3). Every row type makes
 * `revealedToPlayers` optional, and the player's real projections satisfy them unchanged. The badge
 * renders only when the field is actually present, so "no reveal state to show" and "no badge" are one
 * fact rather than two — this replaced five `as never` casts and a fabricated `revealedToPlayers: true`
 * on player data. A player must reach the GM search route through neither.
 *
 * **A clipped answer says so.** When the pin search truncates, the section admits it rather than
 * presenting the first N as the whole answer.
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
  { id: "j1", kind: "entry" as const, text: "We reached the shore", payload: null, tags: ["coast"], revealedToPlayers: true },
  { id: "j2", kind: "entry" as const, text: "Inland", payload: null, tags: ["mountain"], revealedToPlayers: true }
];
const SESSIONS = [{ id: "s1", sessionNumber: 4, tags: ["coast"], revealedToPlayers: false }];
const QUESTS = [{ id: "q1", title: "The Missing Cask", status: "active" as const, tags: ["coast"], revealedToPlayers: true }];

const PIN_HIT = { kind: "marker" as const, id: "k1", title: "The lighthouse", tags: ["coast"], entityType: null, mapId: "m1" };
const OTHER_PIN = { kind: "marker" as const, id: "k2", title: "Inland well", tags: ["coastal"], entityType: null, mapId: "m1" };

const renderTags = (over: Partial<TagViewProps> = {}) => {
  const props: TagViewProps = {
    gmToken: "gm", tag: "coast", pages: PAGES, maps: MAPS, records: RECORDS, sessions: SESSIONS, quests: QUESTS,
    onNavigate: vi.fn(), ...over
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
    // `#coastal` is a different tag: Strahd and the inland well must not appear under `#coast`.
    expect(within(screen.getByRole("navigation", { name: "Pages with this tag" })).getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByText("Strahd")).toBeNull();
    expect(screen.getByText("Vallaki")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Maps with this tag" })).getByText("Barovia")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Journal entries with this tag" })).getByText("We reached the shore")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Sessions with this tag" })).getByText("Session 4")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Quests with this tag" })).getByText("The Missing Cask")).toBeInTheDocument();

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
    expect(onNavigate).toHaveBeenLastCalledWith("/codex/journal?entry=j1");
    await user.click(screen.getByRole("button", { name: /Session 4/ }));
    expect(onNavigate).toHaveBeenLastCalledWith("/codex/sessions/s1");
    await user.click(screen.getByRole("button", { name: /The Missing Cask/ }));
    expect(onNavigate).toHaveBeenLastCalledWith("/codex/quests/q1");

    // A pin carries BOTH halves: the map to open and the pin to select on it.
    await user.click(await screen.findByRole("button", { name: /The lighthouse/ }));
    expect(onNavigate).toHaveBeenLastCalledWith("/codex/atlas/m1?pin=k1");
  });

  it("names a quest's status in the word every other surface uses", () => {
    renderTags();
    // Never the wire value: this view was the only place that read "active".
    expect(within(screen.getByRole("navigation", { name: "Quests with this tag" })).getByText("Active")).toBeInTheDocument();
  });

  it("says the tag is unused rather than rendering empty sections", async () => {
    renderTags({ tag: "nothing-has-this" });
    expect(await screen.findByText("Nothing carries this tag yet.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Pages with this tag" })).toBeNull();
  });

  it("normalizes the tag from the address before matching", () => {
    // The address is a URL segment; `#Coast` and `coast ` must find the same records as `coast`.
    renderTags({ tag: "  COAST " });
    expect(screen.getByRole("heading", { name: "#coast" })).toBeInTheDocument();
    expect(screen.getByText("Vallaki")).toBeInTheDocument();
  });
});

describe("Pins — the one kind that is not client-enumerable", () => {
  it("waits for the search rather than claiming there are no pins", () => {
    let resolve: (value: unknown) => void = () => {};
    gmSearch.mockReturnValue(new Promise((done) => { resolve = done; }));
    const { container } = renderTags();

    expect(container.querySelector(".codex-list-loading")).not.toBeNull();
    expect(screen.queryByText("No pins carry this tag.")).toBeNull();
    resolve({ hits: [], truncated: false });
  });

  it("admits a clipped answer instead of presenting it as the whole one", async () => {
    gmSearch.mockResolvedValue({ hits: [PIN_HIT], truncated: true });
    renderTags();

    expect(await screen.findByText(/More pins may carry this tag/)).toBeInTheDocument();
  });

  it("says so plainly when the search comes back with none", async () => {
    gmSearch.mockResolvedValue({ hits: [], truncated: false });
    renderTags();

    expect(await screen.findByText("No pins carry this tag.")).toBeInTheDocument();
  });
});

describe("Role-blindness (invariant §3.3)", () => {
  it("badges reveal state for the GM, on every kind that has one", () => {
    renderTags();
    // Mixed on purpose: a shown page, a hidden map, a hidden session — the badge is the GM's answer to
    // "can the party see this?", and it is per row.
    expect(within(screen.getByRole("button", { name: /Vallaki/ })).getByText("Shown to players")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /Barovia/ })).getByText("Hidden from players")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /Session 4/ })).getByText("Hidden from players")).toBeInTheDocument();
  });

  it("shows no reveal badge at all on player rows — because the field is absent, not because a flag says so", async () => {
    playerSearch.mockResolvedValue({ hits: [PIN_HIT], truncated: false });
    // A player's real projections: no `revealedToPlayers` anywhere. The rows type-check unchanged, which
    // is the point — the previous shell cast them and invented the field.
    render(<TagView gmToken="player-token" player tag="coast" onNavigate={vi.fn()}
      pages={[{ id: "p1", title: "Vallaki", entityType: "location", tags: ["coast"] }]}
      maps={[{ id: "m1", name: "Barovia", tags: ["coast"] }]}
      records={[{ id: "j1", kind: "entry", text: "We reached the shore", payload: null, tags: ["coast"] }]}
      sessions={[{ id: "s1", sessionNumber: 4, tags: ["coast"] }]}
      quests={[{ id: "q1", title: "The Missing Cask", status: "active", tags: ["coast"] }]} />);

    await screen.findByRole("navigation", { name: "Pins with this tag" });
    // The RevealSwitch vocabulary, which is what a badge would say if one rendered.
    expect(screen.queryByText("Shown to players")).toBeNull();
    expect(screen.queryByText("Hidden from players")).toBeNull();
  });

  it("a player's pins come from the PLAYER search route and never the GM's", async () => {
    playerSearch.mockResolvedValue({ hits: [PIN_HIT], truncated: false });
    render(<TagView gmToken="player-token" player tag="coast" onNavigate={vi.fn()}
      pages={[]} maps={[]} records={[]} sessions={[]} quests={[]} />);

    await waitFor(() => expect(playerSearch).toHaveBeenCalledWith("player-token", "coast"));
    // The whole of this surface's viewer safety: the GM feed is not narrowed here, it is never called.
    expect(gmSearch).not.toHaveBeenCalled();
  });
});

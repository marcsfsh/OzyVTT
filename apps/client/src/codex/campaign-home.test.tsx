import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./MapSurface", () => ({
  MapSurface: (props: { assetId: string; selectedMarkerId: string | null }) => (
    <div data-testid="map-surface" data-asset={props.assetId} data-selected={props.selectedMarkerId ?? ""} />
  )
}));

const listPages = vi.fn();
const listRelationships = vi.fn();
const listLinks = vi.fn();
const markersForPage = vi.fn();
const forPage = vi.fn();
const listFolders = vi.fn();
const getPage = vi.fn();
const search = vi.fn();
const timeline = vi.fn();
const chronicle = vi.fn();
const forMarker = vi.fn();
const getCalendar = vi.fn();
const listMaps = vi.fn();
const listAssets = vi.fn();
const listMarkers = vi.fn();
const playerListPages = vi.fn();
const playerListMaps = vi.fn();
const playerListMarkers = vi.fn();
const playerChronicle = vi.fn();
const playerListRelationships = vi.fn();
const playerListLinks = vi.fn();
// Standing is an uncaught dashboard read, so it must be stubbed or every assertion here fails.
const listStanding = vi.fn();
const playerStanding = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      listPages: (...a: unknown[]) => listPages(...a),
      listConnections: (...a: unknown[]) => listRelationships(...a),
      party: (...a: unknown[]) => listLinks(...a),
      markersForPage: (...a: unknown[]) => markersForPage(...a),
      listFolders: (...a: unknown[]) => listFolders(...a),
      getPage: (...a: unknown[]) => getPage(...a),
      search: (...a: unknown[]) => search(...a)
    },
    journalApi: {
      ...actual.journalApi,
      forPage: (...a: unknown[]) => forPage(...a),
      timeline: (...a: unknown[]) => timeline(...a),
      chronicle: (...a: unknown[]) => chronicle(...a),
      forMarker: (...a: unknown[]) => forMarker(...a)
    },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    standingApi: { ...actual.standingApi, list: (...a: unknown[]) => listStanding(...a) },
    atlasApi: {
      ...actual.atlasApi,
      listMaps: (...a: unknown[]) => listMaps(...a),
      listAssets: (...a: unknown[]) => listAssets(...a),
      listMarkers: (...a: unknown[]) => listMarkers(...a)
    },
    playerCodexApi: {
      ...actual.playerCodexApi,
      calendar: (...a: unknown[]) => getCalendar(...a),
      listPages: (...a: unknown[]) => playerListPages(...a),
      listMaps: (...a: unknown[]) => playerListMaps(...a),
      listMarkers: (...a: unknown[]) => playerListMarkers(...a),
      chronicle: (...a: unknown[]) => playerChronicle(...a),
      listConnections: (...a: unknown[]) => playerListRelationships(...a),
      party: (...a: unknown[]) => playerListLinks(...a),
      standing: (...a: unknown[]) => playerStanding(...a)
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { CodexShell } from "./CodexShell";
import { PlayerCodex } from "./PlayerCodex";
import { TagsCard } from "./CampaignCards";
import type {
  CodexCalendar,
  CodexChronicleRecord,
  CodexMap,
  CodexPageSummary,
  PlayerCodexChronicleRecord,
  PlayerCodexMap,
  PlayerCodexPageSummary
} from "@vtt/domain";

const CALENDAR: CodexCalendar = {
  yearName: "DR",
  months: [{ name: "Hammer", days: 30 }],
  weekdays: [],
  currentDate: { year: 1492, month: 0, day: 3 }
};

const summary = (
  id: string,
  title: string,
  entityType: CodexPageSummary["entityType"],
  tags: string[] = []
): CodexPageSummary => ({
  id,
  title,
  entityType,
  fields: {},
  folder: null,
  tags,
  revealedToPlayers: false,
  bannerAssetId: null,
  inWorldLabel: null,
  calendarInstant: null,
  inWorldDate: null,
  rev: 1,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  playerUpdatedAt: "2026-07-28T00:00:00.000Z"
});
const PAGES = [summary("p1", "Strahd", "character", ["villain"]), summary("p2", "Barovia", "location")];

/** One GM chronicle row; the dashboard reads the chronicle. */
const RECORD = (over: Partial<CodexChronicleRecord> = {}): CodexChronicleRecord => ({
  kind: "entry",
  id: "j1",
  title: null,
  text: "The party crossed the mists.",
  gmText: null,
  revealedToPlayers: false,
  sessionId: null,
  sessionNumber: null,
  realDate: null,
  inWorldLabel: null,
  calendarInstant: null,
  inWorldDate: null,
  tags: [],
  attachPageId: null,
  attachMarkerId: null,
  sourceEncounterId: null,
  payload: null,
  fired: false,
  proposedDate: null,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  ...over
});

const MAP_OTHER: CodexMap = {
  id: "m0",
  assetId: "a0",
  name: "Castle Ravenloft",
  kind: "battlemap",
  parentMapId: null,
  revealedToPlayers: false,
  sortKey: 0,
  tags: [],
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z"
};
const MAP_TARGET: CodexMap = {
  ...MAP_OTHER,
  id: "m1",
  assetId: "a1",
  name: "Barovia map",
  kind: "regional",
  revealedToPlayers: true
};

const renderWorkspace = () =>
  (goTo("/codex"), render)(
    <ToastProvider>
      <CodexShell gmToken="gm" />
    </ToastProvider>
  );
const gmDefaults = () => {
  listPages.mockResolvedValue(PAGES);
  listRelationships.mockResolvedValue([]);
  listLinks.mockResolvedValue(null);
  markersForPage.mockResolvedValue([]);
  forPage.mockResolvedValue([]);
  listFolders.mockResolvedValue([]);
  getPage.mockResolvedValue({ page: null, connections: [] });
  search.mockResolvedValue({ hits: [], truncated: false });
  timeline.mockResolvedValue([]);
  chronicle.mockResolvedValue([]);
  listMaps.mockResolvedValue([]);
  listAssets.mockResolvedValue([]);
  listMarkers.mockResolvedValue([]);
  forMarker.mockResolvedValue([]);
  getCalendar.mockResolvedValue(CALENDAR);
  listStanding.mockResolvedValue([]);
};

const PLAYER_PAGES: PlayerCodexPageSummary[] = [
  {
    id: "p1",
    title: "Strahd",
    entityType: "character",
    tags: ["villain"],
    bannerAssetId: null,
    playerUpdatedAt: "2026-07-28T00:00:00.000Z"
  }
];
const PLAYER_MAPS: PlayerCodexMap[] = [
  { id: "m1", assetId: "a1", name: "Barovia map", kind: "regional", parentMapId: null, tags: [] }
];
const PLAYER_ENTRY: PlayerCodexChronicleRecord = {
  kind: "entry",
  id: "j1",
  title: null,
  text: "The party crossed the mists.",
  sessionId: null,
  sessionNumber: 3,
  realDate: null,
  inWorldLabel: null,
  inWorldDate: null,
  calendarInstant: null,
  tags: [],
  payload: null,
  fired: false,
  createdAt: "2026-07-20T00:00:00.000Z"
};
const PLAYER_OLDER: PlayerCodexChronicleRecord = {
  ...PLAYER_ENTRY,
  id: "j0",
  text: "They left Daggerford.",
  sessionId: null,
  sessionNumber: 1,
  createdAt: "2026-07-01T00:00:00.000Z"
};
/** A revealed dated `event` page on the same chronicle. */
const PLAYER_EVENT: PlayerCodexChronicleRecord = {
  kind: "event",
  id: "p9",
  title: "The Sundering",
  text: "The sky tore open.",
  sessionId: null,
  sessionNumber: null,
  realDate: null,
  inWorldLabel: "Hammer 1, 1492 DR",
  inWorldDate: null,
  calendarInstant: null,
  tags: [],
  payload: null,
  fired: false,
  createdAt: "2026-07-10T00:00:00.000Z"
};
const playerDefaults = () => {
  playerListPages.mockResolvedValue(PLAYER_PAGES);
  playerListMaps.mockResolvedValue(PLAYER_MAPS);
  playerListMarkers.mockResolvedValue([]);
  // Oldest first, as the server sends it.
  playerChronicle.mockResolvedValue([PLAYER_OLDER, PLAYER_EVENT, PLAYER_ENTRY]);
  playerListRelationships.mockResolvedValue([]);
  playerListLinks.mockResolvedValue(null);
  playerStanding.mockResolvedValue([]);
  getCalendar.mockResolvedValue(CALENDAR);
};

describe("Home is the section name, and 'World' is not a destination", () => {
  it("on the GM mode bar, and 'World' is gone from it", async () => {
    gmDefaults();
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
    // "World" is a nav group eyebrow and no destination.
    expect(
      within(screen.getByRole("navigation", { name: "Codex sections" })).queryByRole("button", { name: "World" })
    ).not.toBeInTheDocument();
  });

  it("on the PLAYER mode bar too: the split the plan warned about is between these two", async () => {
    playerDefaults();
    (goTo("/codex"), render)(<PlayerCodex token="player" />);
    await waitFor(() => expect(playerListPages).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(
      within(screen.getAllByRole("navigation", { name: "Codex sections" })[0]).queryByRole("button", { name: "World" })
    ).not.toBeInTheDocument();
    // Players land here too.
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });

  it("as the command palette's goto target, which must still reach the mode beyond a relabel", async () => {
    gmDefaults();
    const user = userEvent.setup();
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    await user.click(screen.getAllByRole("button", { name: "Search" })[0]);
    const palette = within(screen.getByRole("dialog", { name: "Codex command palette" }));
    expect(palette.queryByText("Go to World")).not.toBeInTheDocument();
    await user.click(palette.getByText("Go to Home"));

    // The action must reach the section as well as carry the label.
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("navigation", { name: "Recently updated pages" })).toBeInTheDocument();
  });
});

describe("The Campaign dashboard shows what exists today", () => {
  beforeEach(() => {
    gmDefaults();
    /** Server order is ascending, so any recency the dashboard shows is its own work. */
    chronicle.mockResolvedValue([
      RECORD({ id: "j1", text: "The party crossed the mists.", createdAt: "2026-07-01T00:00:00.000Z" }),
      RECORD({
        kind: "combat",
        id: "j2",
        text: "A battle was fought here.",
        sourceEncounterId: 7,
        createdAt: "2026-07-20T00:00:00.000Z"
      })
    ]);
    listMaps.mockResolvedValue([MAP_OTHER, MAP_TARGET]);
  });

  const openCampaign = async (user: ReturnType<typeof userEvent.setup>) => {
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Home" }));
    await waitFor(() => expect(chronicle).toHaveBeenCalled());
  };

  it("entities by type, recent journal activity, atlas presence, and the in-world date", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await openCampaign(user);

    expect(await screen.findByText("Character")).toBeInTheDocument();
    // Newest first, although the feed arrives oldest first.
    const journal = within(await screen.findByRole("navigation", { name: "Latest journal activity" }));
    const rows = journal.getAllByRole("button").map((row) => row.textContent ?? "");
    expect(rows[0]).toContain("A battle was fought here.");
    expect(rows[1]).toContain("The party crossed the mists.");
    // A combat record reads by a text badge as well as colour.
    expect(journal.getByText("Battle")).toBeInTheDocument();
    const atlas = within(await screen.findByRole("navigation", { name: "Maps in the atlas" }));
    expect(atlas.getByText("Barovia map")).toBeInTheDocument();
    expect(atlas.getByText("Castle Ravenloft")).toBeInTheDocument();
    expect(screen.getByText(/(Your date|Today): Hammer 3, 1492 DR/)).toBeInTheDocument();
  });

  it("a journal row jumps to the Journal with THAT entry marked", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await openCampaign(user);

    const journal = within(await screen.findByRole("navigation", { name: "Latest journal activity" }));
    await user.click(journal.getByText("The party crossed the mists."));

    expect(screen.getByRole("button", { name: "Journal" })).toHaveAttribute("aria-current", "page");
    // The entry is marked as well as the Journal opened.
    await waitFor(() => expect(document.getElementById("codex-entry-j1")).toHaveAttribute("aria-current", "true"));
    expect(document.getElementById("codex-entry-j2")).not.toHaveAttribute("aria-current");
  });

  it("an atlas row opens the Atlas ON that map", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await openCampaign(user);

    const atlas = within(await screen.findByRole("navigation", { name: "Maps in the atlas" }));
    // The second map, so landing on the default first map fails.
    await user.click(atlas.getByText("Barovia map"));

    expect(screen.getByRole("button", { name: "Atlas" })).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(screen.getByTestId("map-surface")).toHaveAttribute("data-asset", "a1"));
  });

  it("says a feed failed rather than rendering one section fewer, silently", async () => {
    chronicle.mockRejectedValue(new Error("The codex request failed (500)."));
    const user = userEvent.setup();
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Home" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The codex request failed (500).");
  });

  it("does not claim the campaign is empty when the notebook is empty but the journal is not", async () => {
    // A campaign with journal entries and maps is not empty even with no pages.
    listPages.mockResolvedValue([]);
    const user = userEvent.setup();
    renderWorkspace();
    await openCampaign(user);

    expect(await screen.findByRole("navigation", { name: "Latest journal activity" })).toBeInTheDocument();
    // Scoped to the whole-surface heading; individual cards may truthfully say "No pages yet."
    expect(screen.queryByRole("heading", { name: /No pages yet/i })).not.toBeInTheDocument();
    // It says how to make the first page and offers it, and leaves out the cards with nothing in them yet.
    const first = screen.getByRole("region", { name: "Make your first page" });
    expect(within(first).getByRole("button", { name: "New page" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Tags" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recently updated" })).not.toBeInTheDocument();
  });
});

/**
 * Kinds with their own card (deadlines, standing) stay out of the feed. Kinds without one (downtime,
 * milestones) must stay in it, or they'd vanish from the dashboard entirely.
 */
describe("A record with a card of its own does not also sit in the feed (owner decision, 2026-07-30)", () => {
  const DEADLINE = RECORD({
    kind: "deadline",
    id: "d1",
    text: "The duke's ultimatum expires.",
    fired: false,
    inWorldLabel: "Hammer 10, 1492 DR",
    calendarInstant: 1492 * 30 + 9,
    inWorldDate: { year: 1492, month: 0, day: 10 }
  });
  const STANDING = RECORD({
    kind: "standing",
    id: "s1",
    text: "",
    payload: { factionPageId: "p1", delta: -2, reason: "the stolen ledger" }
  });
  const MILESTONE = RECORD({ kind: "milestone", id: "m1", text: "", payload: { level: 5, reason: "Barovia" } });
  const DOWNTIME = RECORD({
    kind: "downtime",
    id: "w1",
    text: "A quiet tenday.",
    payload: { who: "Aldric", activity: "Forging", days: 7, characterPageId: null, applied: false }
  });

  beforeEach(() => {
    gmDefaults();
    chronicle.mockResolvedValue([RECORD(), DEADLINE, STANDING, MILESTONE, DOWNTIME]);
  });

  const openCampaign = async (user: ReturnType<typeof userEvent.setup>) => {
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Home" }));
    await waitFor(() => expect(chronicle).toHaveBeenCalled());
  };

  it("keeps the deadline in its card and out of the feed", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await openCampaign(user);

    const feed = within(await screen.findByRole("navigation", { name: "Latest journal activity" }));
    expect(feed.queryByText("The duke's ultimatum expires.")).not.toBeInTheDocument();
    // Still shown, in its card: de-duplicated and kept.
    expect(
      within(screen.getByRole("navigation", { name: "Deadlines" })).getByText("The duke's ultimatum expires.")
    ).toBeInTheDocument();
  });

  it("keeps standing changes out of the feed, where five of them used to crowd out every real entry", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await openCampaign(user);

    const feed = within(await screen.findByRole("navigation", { name: "Latest journal activity" }));
    expect(feed.queryByText(/the stolen ledger/)).not.toBeInTheDocument();
    expect(feed.getByText("The party crossed the mists.")).toBeInTheDocument();
  });

  it("keeps milestones IN the feed: the dashboard has no card for them", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await openCampaign(user);

    const feed = within(await screen.findByRole("navigation", { name: "Latest journal activity" }));
    // A milestone's meaning is in its payload, read through the shared summary rule.
    expect(feed.getByText(/Reached level 5/)).toBeInTheDocument();
  });

  /**
   * Unconfirmed downtime has its own card, so it leaves the feed. De-duplicated by id and never by kind
   * because `DASHBOARD_CARDED_KINDS` is shared with the player, who has no such card.
   */
  it("moves UNCONFIRMED downtime out of the feed and into the card that can act on it", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await openCampaign(user);

    const feed = within(await screen.findByRole("navigation", { name: "Latest journal activity" }));
    expect(feed.queryByText("A quiet tenday.")).not.toBeInTheDocument();
    // Still shown, in its card.
    expect(
      within(screen.getByRole("navigation", { name: "Downtime pending" })).getByText(/Aldric/)
    ).toBeInTheDocument();
  });
});

describe("The player's Campaign dashboard is the server's projection (viewer safety)", () => {
  beforeEach(playerDefaults);

  it("renders the entries and maps the SERVER sent, with no reveal state a player was never given", async () => {
    (goTo("/codex"), render)(<PlayerCodex token="player" />);
    await waitFor(() => expect(playerListPages).toHaveBeenCalled());

    const journal = within(await screen.findByRole("navigation", { name: "Latest journal activity" }));
    expect(journal.getByText("The party crossed the mists.")).toBeInTheDocument();
    expect(journal.getAllByRole("button")[0].textContent ?? "").toContain("The party crossed the mists.");
    expect(
      within(await screen.findByRole("navigation", { name: "Maps in the atlas" })).getByText("Barovia map")
    ).toBeInTheDocument();
    // Player map rows carry no reveal state, so neither visibility marker appears.
    expect(screen.queryByText("GM only")).not.toBeInTheDocument();
    expect(screen.queryByText("Shown")).not.toBeInTheDocument();
    expect(screen.queryByText("revealed to players")).not.toBeInTheDocument();
  });

  it("counts in the singular for one, and gives a player none of the GM's how-to", async () => {
    (goTo("/codex"), render)(<PlayerCodex token="player" />);
    await waitFor(() => expect(playerListPages).toHaveBeenCalled());
    await screen.findByRole("navigation", { name: "Latest journal activity" });
    expect(screen.queryByText(/Tags are added on a page/)).not.toBeInTheDocument();
    const stats = document.querySelector(".codex-campaign-stats")!;
    expect(stats.textContent).toMatch(/1page(?!s)/);
    expect(stats.textContent).toMatch(/1tag(?!s)/);
  });

  it("a player's journal row jumps to the revealed timeline with that entry marked", async () => {
    const user = userEvent.setup();
    (goTo("/codex"), render)(<PlayerCodex token="player" />);
    await waitFor(() => expect(playerListPages).toHaveBeenCalled());

    await user.click(
      within(await screen.findByRole("navigation", { name: "Latest journal activity" })).getByText(
        "The party crossed the mists."
      )
    );

    expect(screen.getByRole("button", { name: "Journal" })).toHaveAttribute("aria-current", "page");
    await waitFor(() =>
      expect(document.getElementById("codex-player-entry-j1")).toHaveAttribute("aria-current", "true")
    );
  });
});

describe("the Tags card with nothing in it", () => {
  it("tells the GM where tags come from, and a player only that there are none", () => {
    const view = render(<TagsCard tags={[]} gm onPickTag={() => {}} />);
    expect(screen.getByText(/Tags are added on a page while you write it/)).toBeInTheDocument();
    view.rerender(<TagsCard tags={[]} onPickTag={() => {}} />);
    expect(screen.getByText("No tags yet.")).toBeInTheDocument();
    expect(screen.queryByText(/Tags are added/)).not.toBeInTheDocument();
  });
});

// Players get no edit time that a GM-only save moves, so their card sorts by the date only the player half moves.
// The GM's card sorts by every save, which is what "what have I been writing" means for the GM.
describe("the Recently updated card", () => {
  /** The card's titles in order; a GM row also carries its reveal badge. */
  const rows = () =>
    within(screen.getByRole("navigation", { name: "Recently updated pages" }))
      .getAllByRole("button")
      .map((row) => ["Lantern Order", "Vallaki"].find((title) => row.textContent?.includes(title)));

  it("orders a player's pages by when the player half changed", async () => {
    playerDefaults();
    playerListPages.mockResolvedValue([
      { ...PLAYER_PAGES[0], id: "p1", title: "Lantern Order", playerUpdatedAt: "2026-07-01T00:00:00.000Z" },
      { ...PLAYER_PAGES[0], id: "p2", title: "Vallaki", playerUpdatedAt: "2026-07-20T00:00:00.000Z" }
    ] satisfies PlayerCodexPageSummary[]);
    (goTo("/codex"), render)(<PlayerCodex token="player" />);
    await screen.findByRole("navigation", { name: "Recently updated pages" });
    expect(rows()).toEqual(["Vallaki", "Lantern Order"]);
  });

  it("orders the GM's pages by their last save", async () => {
    gmDefaults();
    // By the player date Vallaki would come first; the GM's last save was to the Lantern Order's GM notes.
    listPages.mockResolvedValue([
      {
        ...summary("p1", "Lantern Order", "faction"),
        updatedAt: "2026-07-30T00:00:00.000Z",
        playerUpdatedAt: "2026-07-01T00:00:00.000Z"
      },
      {
        ...summary("p2", "Vallaki", "location"),
        updatedAt: "2026-07-20T00:00:00.000Z",
        playerUpdatedAt: "2026-07-20T00:00:00.000Z"
      }
    ]);
    const user = userEvent.setup();
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Home" }));
    await screen.findByRole("navigation", { name: "Recently updated pages" });
    expect(rows()).toEqual(["Lantern Order", "Vallaki"]);
  });
});

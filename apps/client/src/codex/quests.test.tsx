import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./MapSurface", () => ({ MapSurface: () => <div data-testid="map-surface" /> }));

const listPages = vi.fn();
const listRelationships = vi.fn();
const listLinks = vi.fn();
const listFolders = vi.fn();
const getPage = vi.fn();
const search = vi.fn();
const markersForPage = vi.fn();
const forPage = vi.fn();
const timeline = vi.fn();
const chronicle = vi.fn();
const getCalendar = vi.fn();
const listMaps = vi.fn();
const listAssets = vi.fn();
const listMarkers = vi.fn();
const listSessions = vi.fn();
// The quest surface. The four WRITE mocks exist so the dashboard test can assert that rendering a
// presentational card called none of them — a test that only checked the read would pass on a card that
// silently PATCHed on mount.
const listQuests = vi.fn();
const createQuest = vi.fn();
const updateQuest = vi.fn();
const revealQuest = vi.fn();
const removeQuest = vi.fn();
const playerListPages = vi.fn();
const playerListMaps = vi.fn();
const playerListMarkers = vi.fn();
const playerChronicle = vi.fn();
const playerListRelationships = vi.fn();
const playerListLinks = vi.fn();
const playerSessions = vi.fn();
const playerQuests = vi.fn();
// The PLAYER's search, mocked separately from the GM's: the reader's whole reason for existing is that a
// quest hit has somewhere to land, and a test driving that through the real `fetch` would prove nothing.
const playerSearch = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      listPages: (...a: unknown[]) => listPages(...a), listRelationships: (...a: unknown[]) => listRelationships(...a),
      listLinks: (...a: unknown[]) => listLinks(...a), listFolders: (...a: unknown[]) => listFolders(...a),
      getPage: (...a: unknown[]) => getPage(...a), search: (...a: unknown[]) => search(...a),
      markersForPage: (...a: unknown[]) => markersForPage(...a)
    },
    journalApi: { ...actual.journalApi, timeline: (...a: unknown[]) => timeline(...a), chronicle: (...a: unknown[]) => chronicle(...a), forPage: (...a: unknown[]) => forPage(...a) },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    atlasApi: { ...actual.atlasApi, listMaps: (...a: unknown[]) => listMaps(...a), listAssets: (...a: unknown[]) => listAssets(...a), listMarkers: (...a: unknown[]) => listMarkers(...a) },
    sessionApi: { ...actual.sessionApi, list: (...a: unknown[]) => listSessions(...a) },
    questApi: {
      list: (...a: unknown[]) => listQuests(...a), create: (...a: unknown[]) => createQuest(...a),
      update: (...a: unknown[]) => updateQuest(...a), reveal: (...a: unknown[]) => revealQuest(...a),
      remove: (...a: unknown[]) => removeQuest(...a), get: vi.fn()
    },
    playerCodexApi: {
      ...actual.playerCodexApi,
      // M11: the player's own calendar read. It was `calendarApi.get` until O-1 split the two clocks;
      // it is stubbed with the SAME mock, so what this file asserts about the date is unchanged.
      calendar: (...a: unknown[]) => getCalendar(...a),
      listPages: (...a: unknown[]) => playerListPages(...a), listMaps: (...a: unknown[]) => playerListMaps(...a),
      listMarkers: (...a: unknown[]) => playerListMarkers(...a), chronicle: (...a: unknown[]) => playerChronicle(...a),
      listConnections: (...a: unknown[]) => playerListRelationships(...a), party: (...a: unknown[]) => playerListLinks(...a),
      sessions: (...a: unknown[]) => playerSessions(...a), quests: (...a: unknown[]) => playerQuests(...a),
      search: (...a: unknown[]) => playerSearch(...a)
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { CodexShell } from "./CodexShell";
import { PlayerCodex } from "./PlayerCodex";
import { openQuests, questProgress } from "./quests";
import type { CodexCalendar, CodexQuest, CodexSearchHit, PlayerCodexQuest } from "./api";

/**
 * M10 on the client: quests, their objectives, and the two audiences' one card.
 *
 * What each group below is actually for, stated so a later reader does not soften it:
 *  - **"Open" is one predicate, applied once.** Both dashboards filter through `openQuests`, so a GM and
 *    a player can never disagree about which quests are still live.
 *  - **The dashboard card is PRESENTATIONAL.** It fetches nothing and writes nothing, for either
 *    audience; the test that would catch that regression is the one that counts the write calls.
 *  - **A blank objective is a real state.** "Add objective" makes an empty row and the GM types into it;
 *    the save must carry that row through untouched and in position, because filtering it would delete
 *    a line mid-sentence and the server accepts it precisely so this flow works.
 *  - **The player sees progress, never a tickable box.** `Checklist` is handed no `onChange`, so there is
 *    no checkbox, no field and nothing focusable at all in their copy.
 *  - **Viewer safety is tested against a payload that could actually leak.** M9's version of this test
 *    asserted the absence of a string that was unreachable from the render it guarded; here the PLAYER
 *    endpoint is armed with a GM-shaped row, so `gmBody` genuinely reaches the card's props.
 */
const CALENDAR: CodexCalendar = { yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] };

const QUEST = (over: Partial<CodexQuest> = {}): CodexQuest => ({
  id: "q1", title: "The Sunless Crown", status: "active",
  playerBody: "The burgomaster wants the crown returned.",
  gmBody: "The crown is a phylactery and the burgomaster knows it.",
  objectives: [{ text: "Find the crypt", done: true }, { text: "Open the sarcophagus", done: false }],
  entityIds: [], revealedToPlayers: false, tags: [], rev: 3,
  createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-02T00:00:00.000Z", ...over
});
const OPEN = QUEST();
const DONE = QUEST({ id: "q2", title: "The Bell of Vallaki", status: "completed", gmBody: "Already spent.", objectives: [] });
const LOST = QUEST({ id: "q3", title: "The Missing Caravan", status: "failed", gmBody: "Eaten.", objectives: [] });
/**
 * A SECOND open quest, and it is not decoration. The log's "nothing chosen yet" fallback lands on the
 * first still-open quest, so a test that jumps to that very quest cannot fail — it would pass with the
 * latch deleted. Every jump below therefore targets THIS one, which the fallback would never pick.
 */
const OTHER = QUEST({
  id: "q4", title: "The Amber Temple", gmBody: "The vestiges are still bargaining.",
  objectives: [{ text: "Cross the pass", done: false }]
});

const gmDefaults = (quests: CodexQuest[] = [OPEN, OTHER, DONE, LOST]) => {
  listPages.mockResolvedValue([]);
  listRelationships.mockResolvedValue([]);
  listLinks.mockResolvedValue(null);
  listFolders.mockResolvedValue([]);
  getPage.mockResolvedValue({ page: null, connections: [] });
  search.mockResolvedValue({ hits: [], truncated: false });
  markersForPage.mockResolvedValue([]);
  forPage.mockResolvedValue([]);
  timeline.mockResolvedValue([]);
  chronicle.mockResolvedValue([]);
  getCalendar.mockResolvedValue(CALENDAR);
  listMaps.mockResolvedValue([]);
  listAssets.mockResolvedValue([]);
  listMarkers.mockResolvedValue([]);
  listSessions.mockResolvedValue({ sessions: [], activeSessionId: null });
  listQuests.mockResolvedValue(quests);
};
const renderWorkspace = async () => {
  (goTo("/codex/quests"), render)(<ToastProvider><CodexShell gmToken="gm" /></ToastProvider>);
  await waitFor(() => expect(listQuests).toHaveBeenCalled());
};

// vitest.config.ts restores mocks between tests but does NOT clear storage, and the workspace this
// suite mounts persists the session console's open/closed state under a `codex-` key. Without this, one
// test would decide the starting state of every test after it.
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe("What counts as OPEN (the rule, below the components)", () => {
  it("is `active` and nothing else — a failed quest is finished too", () => {
    // The negative half is the point. `failed` is the one a looser predicate ("not completed") would
    // wave through, and it is exactly the quest a dashboard must stop offering.
    expect(openQuests([OPEN, DONE, LOST]).map((quest) => quest.id)).toEqual(["q1"]);
    expect(openQuests([DONE, LOST])).toEqual([]);
    // Order is content: the filter preserves the GM's sequence, it does not re-rank by anything.
    const second = QUEST({ id: "qz", title: "Second" });
    expect(openQuests([OPEN, DONE, second]).map((quest) => quest.id)).toEqual(["q1", "qz"]);
  });

  it("counts progress in words, so it never reads by colour or by a bare ratio", () => {
    expect(questProgress(OPEN.objectives)).toEqual({ done: 1, total: 2, label: "1 of 2 done" });
    expect(questProgress([])).toEqual({ done: 0, total: 0, label: "0 of 0 done" });
  });
});

describe("The dashboard's open-quests card (M10)", () => {
  it("shows the GM the open quests only, and lands ON one — writing nothing to get there", async () => {
    gmDefaults();
    const user = userEvent.setup();
    await renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Home" }));
    const card = within(await screen.findByRole("navigation", { name: "Open quests" }));
    expect(card.getByText("The Sunless Crown")).toBeInTheDocument();
    expect(card.getByText("The Amber Temple")).toBeInTheDocument();
    // Both finished states are absent, and they are separate assertions because they fail separately.
    expect(card.queryByText("The Bell of Vallaki")).not.toBeInTheDocument();
    expect(card.queryByText("The Missing Caravan")).not.toBeInTheDocument();
    // Progress is on the row itself, in words.
    expect(card.getByText("1 of 2 done")).toBeInTheDocument();

    // The SECOND open quest, deliberately: the log's own fallback would select the first one, so landing
    // here is a claim the latch has to earn rather than one the default satisfies for free.
    await user.click(card.getByText("The Amber Temple"));

    // R1: "prepared" means the record is OPEN, not merely highlighted — the log is on that quest, the
    // other rows are unmarked, and the GM half of the record is on screen and editable.
    const log = within(await screen.findByRole("navigation", { name: "Quests" }));
    await waitFor(() => expect(log.getByRole("button", { name: /The Amber Temple/ })).toHaveAttribute("aria-current", "true"));
    expect(log.getByRole("button", { name: /The Sunless Crown/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("textbox", { name: /Where this is really going/ })).toHaveValue("The vestiges are still bargaining.");

    // The card is a view: one read for the whole workspace, and no write anywhere on the way here.
    expect(listQuests).toHaveBeenCalledTimes(1);
    for (const write of [createQuest, updateQuest, revealQuest, removeQuest]) expect(write).not.toHaveBeenCalled();
  });

  it("re-opens the SAME quest from a later jump, because the latch clears when its target goes away", async () => {
    /**
     * The handled-ref stops a re-render re-selecting a quest the GM has navigated away from; clearing it
     * when `openQuestId` goes null is what keeps the same quest reachable a SECOND time.
     *
     * This has to be driven through the command palette, and that is not incidental. The palette is
     * mounted over the destinations, so both jumps reach a quest log that never unmounts in between — and
     * an unmount would give the ref a fresh `null` for free, which is exactly how this test could pass
     * without the clear existing at all.
     */
    gmDefaults();
    search.mockResolvedValue({ hits: [{ kind: "quest", id: "q4", title: "The Amber Temple", tags: [], entityType: null, mapId: null } as CodexSearchHit], truncated: false });
    const user = userEvent.setup();
    await renderWorkspace();

    const jumpViaPalette = async () => {
      await user.click(screen.getAllByRole("button", { name: "Search" })[0]);
      const palette = within(await screen.findByRole("dialog", { name: "Codex command palette" }));
      await user.type(palette.getByLabelText("Search the Codex"), "temple");
      await user.click(await palette.findByText("The Amber Temple"));
    };

    await jumpViaPalette();
    const log = within(await screen.findByRole("navigation", { name: "Quests" }));
    await waitFor(() => expect(log.getByRole("button", { name: /The Amber Temple/ })).toHaveAttribute("aria-current", "true"));

    // The GM backs out to the list — `selectedId` becomes an explicit null, so nothing can quietly
    // re-select the quest and the second landing is the latch's work alone.
    await user.click(screen.getByRole("button", { name: "All quests" }));
    await waitFor(() => expect(log.getByRole("button", { name: /The Amber Temple/ })).not.toHaveAttribute("aria-current"));

    await jumpViaPalette();
    await waitFor(() => expect(log.getByRole("button", { name: /The Amber Temple/ })).toHaveAttribute("aria-current", "true"));
  });
});

describe("The GM's objective checklist (M10)", () => {
  it("adds a BLANK row and saves it in place — order is content and a blank line is a real state", async () => {
    // The server's `ObjectiveSchema` deliberately omits `.min(1)` for exactly this flow. If the client
    // filtered blank rows before sending, "Add objective" would silently delete itself on the next save.
    gmDefaults([OPEN]);
    updateQuest.mockResolvedValue(QUEST());
    const user = userEvent.setup();
    await renderWorkspace();

    await user.click(screen.getAllByRole("button", { name: "Quests" })[0]);
    await user.click(await screen.findByRole("button", { name: /The Sunless Crown/ }));
    const list = within(await screen.findByRole("list", { name: "Objectives" }));
    expect(list.getAllByRole("checkbox")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Add objective" }));
    expect(within(screen.getByRole("list", { name: "Objectives" })).getAllByRole("checkbox")).toHaveLength(3);

    // D6: no Save button to press — the edit saves itself on the autosave debounce (1s by default,
    // which is the shipped cadence). The blank row still has to survive the round trip in position.
    await waitFor(() => expect(updateQuest).toHaveBeenCalled(), { timeout: 3000 });
    const [, , input] = updateQuest.mock.calls[0] as [string, string, { objectives: readonly { text: string; done: boolean }[]; expectedRev: number }];
    expect(input.objectives).toEqual([
      { text: "Find the crypt", done: true },
      { text: "Open the sarcophagus", done: false },
      { text: "", done: false }   // the blank row survived, and it survived IN POSITION
    ]);
    // The optimistic-concurrency token rides along, so a stale edit is a 409 rather than a silent clobber.
    expect(input.expectedRev).toBe(3);
  });

  it("ticks an objective without reordering the list", async () => {
    gmDefaults([OPEN]);
    updateQuest.mockResolvedValue(QUEST());
    const user = userEvent.setup();
    await renderWorkspace();

    await user.click(screen.getAllByRole("button", { name: "Quests" })[0]);
    await user.click(await screen.findByRole("button", { name: /The Sunless Crown/ }));
    await screen.findByRole("list", { name: "Objectives" });
    // G6: THE regression this milestone's autosave exists for — a tick used to be lost unless the GM
    // also pressed Save, on the one surface where the tick IS the work.
    await user.click(screen.getByRole("checkbox", { name: "Open the sarcophagus done" }));

    await waitFor(() => expect(updateQuest).toHaveBeenCalled(), { timeout: 3000 });
    const [, , input] = updateQuest.mock.calls[0] as [string, string, { objectives: readonly { text: string; done: boolean }[] }];
    // A done item is not promoted, demoted or dropped — the GM's sequence is the meaning.
    expect(input.objectives).toEqual([
      { text: "Find the crypt", done: true },
      { text: "Open the sarcophagus", done: true }
    ]);
  });
});

/**
 * The player's quest fixtures, module-level because the dashboard card and the quest reader are two views
 * of the SAME feed. Giving each describe its own copy is precisely how two surfaces start disagreeing
 * about what a quest says.
 */
const PLAYER_QUEST: PlayerCodexQuest = {
  id: "q1", title: "The Sunless Crown", status: "active",
  body: "The burgomaster wants the crown returned.",
  objectives: [{ text: "Find the crypt", done: true }, { text: "Open the sarcophagus", done: false }],
  entityIds: [], tags: []
};
/** The quest the reader exists for: finished, so the open-quests card never lists it. */
const PLAYER_DONE: PlayerCodexQuest = {
  id: "q2", title: "The Bell of Vallaki", status: "completed",
  body: "The bell was hauled back up the hill.", objectives: [{ text: "Raise the bell", done: true }], entityIds: [], tags: []
};
const PLAYER_LOST: PlayerCodexQuest = { id: "q3", title: "The Missing Caravan", status: "failed", body: "", objectives: [], entityIds: [], tags: [] };

const playerDefaults = (quests: readonly unknown[] = [PLAYER_QUEST]) => {
  playerListPages.mockResolvedValue([]);
  playerListMaps.mockResolvedValue([]);
  playerListMarkers.mockResolvedValue([]);
  playerChronicle.mockResolvedValue([]);
  playerListRelationships.mockResolvedValue([]);
  playerListLinks.mockResolvedValue(null);
  playerSessions.mockResolvedValue([]);
  playerSearch.mockResolvedValue({ hits: [], truncated: false });
  getCalendar.mockResolvedValue(CALENDAR);
  playerQuests.mockResolvedValue(quests);
};

describe("The player's copy of the card (M10, viewer safety)", () => {
  beforeEach(() => { playerDefaults(); });

  it("shows progress and never a tickable box — no checkbox, no field, nothing focusable", async () => {
    (goTo("/codex"), render)(<PlayerCodex token="player" />);

    const card = within(await screen.findByRole("navigation", { name: "Open quests" }));
    expect(card.getByText("The Sunless Crown")).toBeInTheDocument();
    // The objectives are READ, in order, with their state in text beside them...
    const objectives = within(card.getByRole("list", { name: "Objectives for The Sunless Crown" }));
    expect(objectives.getByText("Find the crypt")).toBeInTheDocument();
    expect(objectives.getByText("Open the sarcophagus")).toBeInTheDocument();
    expect(objectives.getByText("— done")).toBeInTheDocument();
    expect(objectives.getByText("— not done")).toBeInTheDocument();
    // ...and there is nothing here to operate. A disabled checkbox would be a different, worse statement
    // ("a control you are refused") than a status; the read-only branch renders no control at all.
    expect(card.queryAllByRole("checkbox")).toHaveLength(0);
    expect(card.queryAllByRole("textbox")).toHaveLength(0);
    // The ROW itself is now a button, because a player finally has somewhere for it to go. The old
    // assertion here was `queryByRole("button")` → absent, on the premise that there was no player quest
    // reader to open; that premise is what this change removes.
    expect(card.getByRole("button", { name: /The Sunless Crown/ })).toBeInTheDocument();
  });

  /**
   * The trap this replaces: an absence assertion whose string never reaches the render it guards. `OPEN`
   * above is only ever fed to `questApi.list`, which `PlayerCodex` does not import, so asserting the
   * absence of `OPEN.gmBody` here would pass with the GM body rendered verbatim.
   *
   * So the PLAYER endpoint is armed with a GM-shaped row — the payload a regressed `projectPlayerQuest`
   * would actually send — and the card is asked to survive being handed secrets it should never receive.
   * `CampaignQuest` having no `gmBody` field is what makes that survivable; the test is what proves the
   * component does not reach around the type.
   */
  it("renders nothing from extra keys if the server ever regresses and sends a GM row", async () => {
    playerDefaults([{
      ...PLAYER_QUEST,
      gmBody: "The crown is a phylactery and the burgomaster knows it.",
      playerBody: "a GM-shaped duplicate of the hook",
      revealedToPlayers: true, rev: 3
    }]);
    (goTo("/codex"), render)(<PlayerCodex token="player" />);

    const card = within(await screen.findByRole("navigation", { name: "Open quests" }));
    expect(card.getByText("The Sunless Crown")).toBeInTheDocument();          // the legitimate keys render...
    expect(card.getByText("Find the crypt")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("The crown is a phylactery");                  // ...and none of the smuggled ones do
    expect(text).not.toContain("a GM-shaped duplicate of the hook");
  });

  it("hides a quest the GM has finished, on the same rule the GM's own card uses", async () => {
    // A player is sent a revealed quest whatever its status, so "open" is decided on this side for both
    // audiences — the player's card must not be the one place a completed quest lingers.
    playerDefaults([PLAYER_DONE]);
    (goTo("/codex"), render)(<PlayerCodex token="player" />);

    await screen.findByRole("heading", { name: "By kind" });
    expect(screen.queryByRole("navigation", { name: "Open quests" })).not.toBeInTheDocument();
    expect(screen.queryByText("The Bell of Vallaki")).not.toBeInTheDocument();
  });
});

/**
 * The player's quest reader — the gap M10 left, closed.
 *
 * What each test below is actually for, stated so a later reader does not soften it:
 *  - **A tap on a quest lands ON the quest.** Both entrances (the dashboard card and search) go through
 *    one handler, so a search result can never again be dropped on a dashboard that does not mention it.
 *  - **Finished quests have a home, and it is NOT the dashboard card.** The card stays open-only — a
 *    thread the party can no longer pull must not keep being offered — so the reader's rail is where
 *    every revealed quest lives, whatever its status.
 *  - **The reader is READ-ONLY.** Same `Checklist` contract the card uses: no `onChange`, so no checkbox,
 *    no field, nothing focusable. A player sees progress; the GM's tickable copy is in their own log.
 *  - **Viewer safety is tested against a payload that could actually leak.** The player endpoint is armed
 *    with a GM-shaped row, so `gmBody` genuinely reaches the reader's props and its absence means
 *    something — and the same test pins that this surface never calls the GM's `questApi` at all.
 */
describe("The player's quest reader", () => {
  const railOf = async () => within(await screen.findByRole("navigation", { name: "Quests" }));
  const readerOf = async () => within(await screen.findByRole("article"));

  it("opens a quest from the dashboard and reads it — title, status, description, objectives", async () => {
    playerDefaults();
    const user = userEvent.setup();
    (goTo("/codex"), render)(<PlayerCodex token="player" />);

    const card = within(await screen.findByRole("navigation", { name: "Open quests" }));
    await user.click(card.getByRole("button", { name: /The Sunless Crown/ }));

    // R1: "landed" means the record is OPEN, not merely that some quest surface appeared — the rail marks
    // this quest and the reader is showing it.
    const rail = await railOf();
    await waitFor(() => expect(rail.getByRole("button", { name: /The Sunless Crown/ })).toHaveAttribute("aria-current", "true"));

    const reader = await readerOf();
    expect(reader.getByRole("heading", { name: /The Sunless Crown/ })).toBeInTheDocument();
    // R2: the status reads as a WORD, and progress in words — never a bare ratio and never by colour.
    expect(reader.getByText("Active")).toBeInTheDocument();
    expect(reader.getByText("1 of 2 done")).toBeInTheDocument();
    // The description — the `playerBody` the GM wrote, arriving as `body`.
    expect(reader.getByText("The burgomaster wants the crown returned.")).toBeInTheDocument();
    const objectives = within(reader.getByRole("list", { name: "Objectives for The Sunless Crown" }));
    expect(objectives.getByText("Find the crypt")).toBeInTheDocument();
    expect(objectives.getByText("— done")).toBeInTheDocument();
    expect(objectives.getByText("— not done")).toBeInTheDocument();
    // Read-only, on the same terms as the card: nothing here is operable, anywhere on the surface.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("is where the FINISHED quests live — the dashboard card stays open-only", async () => {
    playerDefaults([PLAYER_QUEST, PLAYER_DONE, PLAYER_LOST]);
    const user = userEvent.setup();
    (goTo("/codex"), render)(<PlayerCodex token="player" />);

    // The card is untouched by this change: still open-only, both finished states absent, and they are
    // separate assertions because they fail separately.
    const card = within(await screen.findByRole("navigation", { name: "Open quests" }));
    expect(card.queryByText("The Bell of Vallaki")).not.toBeInTheDocument();
    expect(card.queryByText("The Missing Caravan")).not.toBeInTheDocument();

    await user.click(card.getByRole("button", { name: /The Sunless Crown/ }));

    // The rail is the other half: every revealed quest, each saying its status as a word.
    const rail = await railOf();
    expect(rail.getByRole("button", { name: /The Bell of Vallaki/ })).toHaveTextContent("Completed");
    expect(rail.getByRole("button", { name: /The Missing Caravan/ })).toHaveTextContent("Failed");

    // ...and a finished one is one tap from there, with its own body on screen.
    await user.click(rail.getByRole("button", { name: /The Bell of Vallaki/ }));
    const reader = await readerOf();
    await waitFor(() => expect(reader.getByRole("heading", { name: /The Bell of Vallaki/ })).toBeInTheDocument());
    expect(reader.getByText("The bell was hauled back up the hill.")).toBeInTheDocument();
  });

  it("lands a search hit ON a completed quest — the jump that used to go nowhere", async () => {
    /**
     * Only finished quests exist here, and that is the whole point: the dashboard's card does not render
     * at all, so before the reader a `quest` hit sent the player to a surface that never mentions the
     * record they searched for. Nothing about this test can pass by accident on the old behaviour.
     */
    playerDefaults([PLAYER_DONE]);
    playerSearch.mockResolvedValue({ hits: [{ kind: "quest", id: "q2", title: "The Bell of Vallaki", tags: [], entityType: null, mapId: null } as CodexSearchHit], truncated: false });
    const user = userEvent.setup();
    (goTo("/codex"), render)(<PlayerCodex token="player" />);

    await screen.findByRole("heading", { name: "By kind" });
    expect(screen.queryByRole("navigation", { name: "Open quests" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pages" }));
    await user.type(screen.getAllByLabelText("Search the Codex")[0], "bell");
    const results = within(screen.getByRole("navigation", { name: "Pages" }));
    // R2: the row names its kind as a word before it is ever tapped.
    expect(await results.findByText("Quest")).toBeInTheDocument();
    await user.click(results.getByText("The Bell of Vallaki"));

    const reader = await readerOf();
    expect(reader.getByRole("heading", { name: /The Bell of Vallaki/ })).toBeInTheDocument();
    expect(reader.getByText("Completed")).toBeInTheDocument();
    expect(reader.getByText("The bell was hauled back up the hill.")).toBeInTheDocument();
    // D1/D3 replaced the mode bar with the sidebar, and the answer got BETTER: the jump lands on
    // `/codex/quests/q2`, so the lit item is Quests — the destination the reader actually belongs to —
    // rather than the old "Campaign" tab that was the nearest available lie. Home must be dark.
    expect(window.location.pathname).toBe("/codex/quests/q2");
    const sidebar = within(screen.getByRole("navigation", { name: "Codex sections" }));
    expect(sidebar.getByRole("button", { name: "Quests" })).toHaveAttribute("aria-current", "page");
    expect(sidebar.getByRole("button", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  /**
   * The armed-payload rule again, now for the reader — and it matters MORE here than on the card. The
   * card is safe by its type: `CampaignQuest` has no `gmBody` field to fill in. The reader renders a
   * `PlayerCodexQuest` straight out of this surface's own state, so a regressed `projectPlayerQuest` puts
   * the GM's plan one property access away from the article. Arming the PLAYER endpoint is what makes the
   * absence assertion below mean anything at all.
   */
  it("survives a GM-shaped row from a regressed server, and never asks the GM feed for one", async () => {
    playerDefaults([{
      ...PLAYER_QUEST,
      gmBody: "The crown is a phylactery and the burgomaster knows it.",
      playerBody: "a GM-shaped duplicate of the hook",
      revealedToPlayers: true, rev: 3
    }]);
    const user = userEvent.setup();
    (goTo("/codex"), render)(<PlayerCodex token="player" />);

    const card = within(await screen.findByRole("navigation", { name: "Open quests" }));
    await user.click(card.getByRole("button", { name: /The Sunless Crown/ }));

    const reader = await readerOf();
    expect(reader.getByRole("heading", { name: /The Sunless Crown/ })).toBeInTheDocument();   // the legitimate keys render...
    expect(reader.getByText("The burgomaster wants the crown returned.")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("The crown is a phylactery");                                  // ...and none of the smuggled ones do
    expect(text).not.toContain("a GM-shaped duplicate of the hook");

    // And the reader added no second path to a quest: it reads the player projection this surface already
    // fetched, and the GM's own quest feed is never touched from here.
    expect(playerQuests).toHaveBeenCalledWith("player");
    expect(listQuests).not.toHaveBeenCalled();
  });
});

describe("A quest in suite-wide search (M10)", () => {
  // q4 again, not q1: the log's fallback would land on q1 on its own, so a hit for it could not fail.
  const HIT: CodexSearchHit = { kind: "quest", id: "q4", title: "The Amber Temple", tags: [], entityType: null, mapId: null };

  it("names its kind in TEXT and opens the quest log ON that quest", async () => {
    gmDefaults();
    search.mockResolvedValue({ hits: [HIT], truncated: false });
    const user = userEvent.setup();
    await renderWorkspace();

    // D20 recut: suite-wide search is the palette, not a rail box that happened to search everything.
    await user.click(screen.getAllByRole("button", { name: "Search" })[0]);
    const results = within(await screen.findByRole("dialog", { name: "Codex command palette" }));
    await user.type(results.getByLabelText("Search the Codex"), "temple");
    // R2: the row says "Quest" as a word — remove every colour and the list still reads correctly.
    expect(await results.findByText("Quest")).toBeInTheDocument();

    await user.click(results.getByText("The Amber Temple"));
    const log = within(await screen.findByRole("navigation", { name: "Quests" }));
    await waitFor(() => expect(log.getByRole("button", { name: /The Amber Temple/ })).toHaveAttribute("aria-current", "true"));
    expect(log.getByRole("button", { name: /The Sunless Crown/ })).not.toHaveAttribute("aria-current");
  });
});

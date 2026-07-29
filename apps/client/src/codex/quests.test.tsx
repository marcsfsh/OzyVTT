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
      listPages: (...a: unknown[]) => playerListPages(...a), listMaps: (...a: unknown[]) => playerListMaps(...a),
      listMarkers: (...a: unknown[]) => playerListMarkers(...a), chronicle: (...a: unknown[]) => playerChronicle(...a),
      listRelationships: (...a: unknown[]) => playerListRelationships(...a), listLinks: (...a: unknown[]) => playerListLinks(...a),
      sessions: (...a: unknown[]) => playerSessions(...a), quests: (...a: unknown[]) => playerQuests(...a)
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { CodexWorkspace } from "./CodexWorkspace";
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
  entityIds: [], revealedToPlayers: false, rev: 3,
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
  listLinks.mockResolvedValue([]);
  listFolders.mockResolvedValue([]);
  getPage.mockResolvedValue({ page: null, backlinks: [], relationships: [] });
  search.mockResolvedValue([]);
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
  render(<ToastProvider><CodexWorkspace gmToken="gm" /></ToastProvider>);
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

    await user.click(screen.getByRole("tab", { name: "Campaign" }));
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
    const log = within(await screen.findByRole("navigation", { name: "Quest log" }));
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
    search.mockResolvedValue([{ kind: "quest", id: "q4", title: "The Amber Temple", tags: [], entityType: null, mapId: null } as CodexSearchHit]);
    const user = userEvent.setup();
    await renderWorkspace();

    const jumpViaPalette = async () => {
      await user.click(screen.getByRole("button", { name: "Search" }));
      const palette = within(screen.getByRole("dialog", { name: "Codex command palette" }));
      await user.type(palette.getByLabelText("Command palette"), "temple");
      await user.click(await palette.findByText("The Amber Temple"));
    };

    await jumpViaPalette();
    const log = within(await screen.findByRole("navigation", { name: "Quest log" }));
    await waitFor(() => expect(log.getByRole("button", { name: /The Amber Temple/ })).toHaveAttribute("aria-current", "true"));

    // The GM backs out to the list — `selectedId` becomes an explicit null, so nothing can quietly
    // re-select the quest and the second landing is the latch's work alone.
    await user.click(screen.getByRole("button", { name: "‹ All quests" }));
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

    await user.click(screen.getByRole("button", { name: "Quests" }));
    const list = within(await screen.findByRole("list", { name: "Objectives" }));
    expect(list.getAllByRole("checkbox")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Add objective" }));
    expect(within(screen.getByRole("list", { name: "Objectives" })).getAllByRole("checkbox")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Save quest" }));

    await waitFor(() => expect(updateQuest).toHaveBeenCalled());
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

    await user.click(screen.getByRole("button", { name: "Quests" }));
    await screen.findByRole("list", { name: "Objectives" });
    await user.click(screen.getByRole("checkbox", { name: "Open the sarcophagus done" }));
    await user.click(screen.getByRole("button", { name: "Save quest" }));

    await waitFor(() => expect(updateQuest).toHaveBeenCalled());
    const [, , input] = updateQuest.mock.calls[0] as [string, string, { objectives: readonly { text: string; done: boolean }[] }];
    // A done item is not promoted, demoted or dropped — the GM's sequence is the meaning.
    expect(input.objectives).toEqual([
      { text: "Find the crypt", done: true },
      { text: "Open the sarcophagus", done: true }
    ]);
  });
});

describe("The player's copy of the card (M10, viewer safety)", () => {
  const PLAYER_QUEST: PlayerCodexQuest = {
    id: "q1", title: "The Sunless Crown", status: "active",
    body: "The burgomaster wants the crown returned.",
    objectives: [{ text: "Find the crypt", done: true }, { text: "Open the sarcophagus", done: false }],
    entityIds: []
  };
  beforeEach(() => {
    playerListPages.mockResolvedValue([]);
    playerListMaps.mockResolvedValue([]);
    playerListMarkers.mockResolvedValue([]);
    playerChronicle.mockResolvedValue([]);
    playerListRelationships.mockResolvedValue([]);
    playerListLinks.mockResolvedValue([]);
    playerSessions.mockResolvedValue([]);
    getCalendar.mockResolvedValue(CALENDAR);
    playerQuests.mockResolvedValue([PLAYER_QUEST]);
  });

  it("shows progress and never a tickable box — no checkbox, no field, nothing focusable", async () => {
    render(<PlayerCodex token="player" />);

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
    // A button that navigates nowhere is worse than no button: there is no player quest log to open.
    expect(card.queryByRole("button")).not.toBeInTheDocument();
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
    playerQuests.mockResolvedValue([{
      ...PLAYER_QUEST,
      gmBody: "The crown is a phylactery and the burgomaster knows it.",
      playerBody: "a GM-shaped duplicate of the hook",
      revealedToPlayers: true, rev: 3
    } as never]);
    render(<PlayerCodex token="player" />);

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
    playerQuests.mockResolvedValue([{ ...PLAYER_QUEST, id: "q2", title: "The Bell of Vallaki", status: "completed", objectives: [] }]);
    render(<PlayerCodex token="player" />);

    await screen.findByRole("heading", { name: "By type" });
    expect(screen.queryByRole("navigation", { name: "Open quests" })).not.toBeInTheDocument();
    expect(screen.queryByText("The Bell of Vallaki")).not.toBeInTheDocument();
  });
});

describe("A quest in suite-wide search (M10)", () => {
  // q4 again, not q1: the log's fallback would land on q1 on its own, so a hit for it could not fail.
  const HIT: CodexSearchHit = { kind: "quest", id: "q4", title: "The Amber Temple", tags: [], entityType: null, mapId: null };

  it("names its kind in TEXT and opens the quest log ON that quest", async () => {
    gmDefaults();
    search.mockResolvedValue([HIT]);
    const user = userEvent.setup();
    await renderWorkspace();

    await user.type(screen.getByLabelText("Search the notebook"), "temple");
    const results = within(await screen.findByRole("navigation", { name: "Campaign notebook" }));
    // R2: the row says "Quest" as a word — remove every colour and the list still reads correctly.
    expect(await results.findByText("Quest")).toBeInTheDocument();

    await user.click(results.getByText("The Amber Temple"));
    const log = within(await screen.findByRole("navigation", { name: "Quest log" }));
    await waitFor(() => expect(log.getByRole("button", { name: /The Amber Temple/ })).toHaveAttribute("aria-current", "true"));
    expect(log.getByRole("button", { name: /The Sunless Crown/ })).not.toHaveAttribute("aria-current");
  });
});

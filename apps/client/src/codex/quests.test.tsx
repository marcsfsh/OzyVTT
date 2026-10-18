import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./atlas/AtlasMap", () => ({ AtlasMap: () => <div data-testid="map-surface" /> }));
vi.mock("./api", async (actual) => (await import("../../test/codex-fakes")).fakeApiModule(await actual()));
vi.mock("./api-records", async () => (await import("../../test/codex-fakes")).fakeRecordsModule());

import { api, playerQuest, quest, resetFakes } from "../../test/codex-fakes";
import { renderPlayerCodex } from "../../test/codex-render";
import { QUEST_STATUS_LABEL, QUEST_STATUS_ORDER, openQuests, questProgress, questStatusTone } from "./quests";

const OPEN = quest();
const DONE = quest({ id: "q2", title: "The Bell of Vallaki", status: "completed", objectives: [] });
const LOST = quest({ id: "q3", title: "The Missing Caravan", status: "failed", objectives: [] });
const FRESH = quest({ id: "q0", title: "A rumour in Vallaki", status: "not-started", objectives: [] });
const DROPPED = quest({ id: "q4", title: "The Amber Bargain", status: "canceled", objectives: [] });

beforeEach(() => {
  localStorage.clear();
  resetFakes();
});

describe("What counts as OPEN (the rule, below the components)", () => {
  it("is NOT FINISHED: `not-started` and `active`, never one of the three terminal states", () => {
    // `failed` is what a looser "not completed" predicate would let through.
    expect(openQuests([OPEN, DONE, LOST]).map((row) => row.id)).toEqual(["q1"]);
    expect(openQuests([DONE, LOST, DROPPED])).toEqual([]);
    expect(openQuests([FRESH, OPEN, DONE, LOST, DROPPED]).map((row) => row.id)).toEqual(["q0", "q1"]);
    expect(openQuests([DROPPED])).toEqual([]);
    const second = quest({ id: "qz", title: "Second" });
    expect(openQuests([OPEN, DONE, second]).map((row) => row.id)).toEqual(["q1", "qz"]);
  });

  it("names all five statuses, offers them in lifecycle order, and never colours a cancellation as a loss", () => {
    expect(QUEST_STATUS_ORDER).toEqual(["not-started", "active", "completed", "failed", "canceled"]);
    expect(QUEST_STATUS_ORDER.map((status) => QUEST_STATUS_LABEL[status])).toEqual([
      "Not started",
      "Active",
      "Completed",
      "Failed",
      "Canceled"
    ]);
    expect(Object.keys(QUEST_STATUS_LABEL).sort()).toEqual([...QUEST_STATUS_ORDER].sort());
    expect(QUEST_STATUS_ORDER.map(questStatusTone)).toEqual(["neutral", "info", "success", "danger", "neutral"]);
  });

  it("counts progress in words, so it never reads by colour or by a bare ratio", () => {
    expect(questProgress(OPEN.objectives)).toEqual({ done: 1, total: 2, label: "1 of 2 done" });
    expect(questProgress([])).toEqual({ done: 0, total: 0, label: "0 of 0 done" });
  });
});

/** Rendered and never string-asserted: the sentence combines the verb table, the player's quest feed and the row. */
describe("A quest-history row a player reads (5d)", () => {
  const questRecord = (id: string, questId: string, status: string) => ({
    id,
    kind: "quest" as const,
    title: null,
    text: "",
    tags: [],
    realDate: null,
    inWorldLabel: null,
    inWorldDate: null,
    calendarInstant: null,
    sessionId: null,
    sessionNumber: null,
    fired: false,
    firstShownAt: "2026-07-31T00:00:00.000Z",
    payload: { questId, status }
  });

  it("says a quest HAS NOT STARTED and WAS CANCELED, naming the quest from the player's own feed", async () => {
    api.playerCodexApi.quests.mockResolvedValue([
      playerQuest({ id: "q0", title: "A rumour in Vallaki", status: "not-started", objectives: [] }),
      playerQuest({ id: "q4", title: "The Amber Bargain", status: "canceled", objectives: [] })
    ]);
    api.playerCodexApi.chronicle.mockResolvedValue([
      questRecord("j1", "q0", "not-started"),
      questRecord("j2", "q4", "canceled")
    ]);
    renderPlayerCodex("/codex/story");

    expect(await screen.findByText("A rumour in Vallaki has not started")).toBeInTheDocument();
    expect(screen.getByText("The Amber Bargain was canceled")).toBeInTheDocument();
  });

  it('falls back to "A quest" for a status whose quest the player cannot see, and invents no name', async () => {
    // A `questId` that matches nothing in the player's feed must still read as a sentence.
    api.playerCodexApi.chronicle.mockResolvedValue([questRecord("j1", "q-unknown", "canceled")]);
    renderPlayerCodex("/codex/story");

    expect(await screen.findByText("A quest was canceled")).toBeInTheDocument();
  });
});

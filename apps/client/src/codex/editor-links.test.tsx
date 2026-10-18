import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: { ...actual.codexApi, listPages: vi.fn(async () => []) },
    // The session page reads the chronicle and the calendar for its days.
    journalApi: { ...actual.journalApi, chronicle: vi.fn(async () => []) },
    calendarApi: { ...actual.calendarApi, get: vi.fn(async () => null) }
  };
});

import { ToastProvider } from "@vtt/ui";
import type { CodexPageSummary, CodexQuest, CodexSession } from "@vtt/domain";
import { goTo } from "../../test/route";
import { usePageLinks } from "./pageLinks";
import { QuestsView } from "./QuestsView";
import { renderGmStory } from "./story/harness";
import { GmSessionsSection } from "./story/sections";

// A `[[link]]` in a quest or a session body works as one in a page body does: it goes to the page of that title, and
// one no page has offers to create the page.

const page = (id: string, title: string): CodexPageSummary => ({
  id,
  title,
  entityType: "location",
  fields: {},
  folder: null,
  tags: [],
  revealedToPlayers: true,
  bannerAssetId: null,
  inWorldDate: null,
  inWorldLabel: null,
  calendarInstant: null,
  rev: 1,
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt: "2026-08-08T00:00:00.000Z",
  playerUpdatedAt: "2026-08-08T00:00:00.000Z",
  firstShownAt: null
});
const PAGES = [page("p1", "Vallaki")];
const BODY = "Meet Ismark in [[Vallaki]], then ride to [[Wave Echo Cave]].";
const AUTOSAVE = { enabled: false, intervalSeconds: 1 };

const QUEST: CodexQuest = {
  id: "q1",
  title: "The Sunless Crown",
  status: "active",
  playerBody: BODY,
  gmBody: "",
  objectives: [],
  entityIds: [],
  revealedToPlayers: false,
  tags: [],
  rev: 3,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z"
};
const SESSION = {
  id: "s1",
  sessionNumber: 3,
  tags: [],
  realDate: "2026-07-12",
  attendees: [],
  prepBody: "",
  prep: [],
  prepTemplateId: null,
  currentSceneId: null,
  recapBody: BODY,
  revealedToPlayers: false,
  status: "played",
  sceneIds: [],
  rev: 1,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
} as CodexSession;

/** Reads `field`'s body in the editor's View mode and taps the missing link, then the page's link. */
async function followBoth(field: HTMLElement) {
  const user = userEvent.setup();
  await user.click(within(field).getByRole("button", { name: "View" }));
  await user.click(within(field).getByRole("button", { name: "Create the page Wave Echo Cave" }));
  await user.click(within(field).getByRole("button", { name: "Vallaki" }));
}

beforeEach(() => goTo("/codex"));

describe("a link in a quest or session body", () => {
  it("in a quest, offers to create a page no one has made, and follows one that exists", async () => {
    const follow = vi.fn();
    render(
      <ToastProvider>
        <QuestsView
          gmToken="gm"
          quests={[QUEST]}
          pages={PAGES}
          loading={false}
          error={null}
          openQuestId="q1"
          onOpenQuest={vi.fn()}
          onChanged={vi.fn()}
          onOpenPage={vi.fn()}
          onFollowLink={follow}
          autosave={AUTOSAVE}
        />
      </ToastProvider>
    );
    const body = screen.getByRole("textbox", { name: "Player-visible notes" }).closest(".codex-editor-surface");
    await followBoth(body as HTMLElement);
    expect(follow.mock.calls).toEqual([["Wave Echo Cave"], ["Vallaki"]]);
  });

  it("in a session's recap, the same", async () => {
    const view = renderGmStory(GmSessionsSection, "/codex/sessions/s1", { sessions: [SESSION], pages: PAGES });
    const recap = (await screen.findByRole("textbox", { name: "Recap for players" })).closest(".codex-editor-surface");
    await followBoth(recap as HTMLElement);
    expect(view.quickCreate).toHaveBeenCalledWith(expect.objectContaining({ title: "Wave Echo Cave" }));
    expect(window.location.pathname).toBe("/codex/pages/p1");
  });

  it("goes to the page of that title, or opens quick-create with the title filled in", async () => {
    const quickCreate = vi.fn();
    const { result } = renderHook(() => usePageLinks(PAGES, quickCreate));
    result.current("page:vallaki");
    await waitFor(() => expect(window.location.pathname).toBe("/codex/pages/p1"));
    result.current("Wave Echo Cave");
    expect(quickCreate).toHaveBeenCalledWith({
      title: "Wave Echo Cave",
      note: "This link doesn't match a page yet. Create it, or cancel and fix the link."
    });
  });
});

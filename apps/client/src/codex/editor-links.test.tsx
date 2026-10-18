import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, codexApi: { ...actual.codexApi, listPages: vi.fn(async () => []) } };
});

import { ToastProvider } from "@vtt/ui";
import type { CodexPageSummary, CodexSession } from "@vtt/domain";
import { goTo } from "../../test/route";
import { usePageLinks } from "./pageLinks";
import { SessionsView } from "./SessionsView";

// A `[[link]]` in a session body works as one in a page body does (the quest view has its own test): it goes to the page of that title, and
// one no page has offers to create the page.

const page = (id: string, title: string): CodexPageSummary => ({
  id,
  title,
  entityType: "location",
  fields: {},
  hiddenFields: [],
  characterUpdatedAt: {},
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

const SESSION: CodexSession = {
  id: "s1",
  sessionNumber: 3,
  tags: [],
  realDate: "2026-07-12",
  attendees: [],
  prep: [],
  prepTemplateId: null,
  currentSceneId: null,
  recapBody: BODY,
  revealedToPlayers: false,
  status: "planned",
  sceneIds: [],
  rev: 1,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  firstShownAt: null
};

/** Reads `field`'s body in the editor's View mode and taps the missing link, then the page's link. */
async function followBoth(field: HTMLElement) {
  const user = userEvent.setup();
  await user.click(within(field).getByRole("button", { name: "View" }));
  await user.click(within(field).getByRole("button", { name: "Create the page Wave Echo Cave" }));
  await user.click(within(field).getByRole("button", { name: "Vallaki" }));
}

beforeEach(() => goTo("/codex"));

describe("a link in a session body", () => {
  it("in a session's recap, the same", async () => {
    const follow = vi.fn();
    render(
      <ToastProvider>
        <SessionsView
          gmToken="gm"
          sessions={[SESSION]}
          activeSessionId={null}
          loading={false}
          error={null}
          openSessionId="s1"
          onOpenSession={vi.fn()}
          onChanged={vi.fn()}
          autosave={AUTOSAVE}
          pages={PAGES}
          onFollowLink={follow}
        />
      </ToastProvider>
    );
    const recap = screen.getByRole("textbox", { name: "Recap" }).closest(".codex-editor-surface");
    await followBoth(recap as HTMLElement);
    expect(follow.mock.calls).toEqual([["Wave Echo Cave"], ["Vallaki"]]);
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

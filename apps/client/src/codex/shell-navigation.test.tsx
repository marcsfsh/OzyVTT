import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./MapSurface", () => ({ MapSurface: () => <div data-testid="map-surface" /> }));

const listPages = vi.fn();
const listFolders = vi.fn();
const listConnections = vi.fn();
const party = vi.fn();
const getPage = vi.fn();
const getSettings = vi.fn();
const search = vi.fn();
const markersForPage = vi.fn();
const auditList = vi.fn();
const exportBundle = vi.fn();
const chronicle = vi.fn();
const forPage = vi.fn();
const listMaps = vi.fn();
const listAssets = vi.fn();
const getCalendar = vi.fn();
const listSessions = vi.fn();
const listQuests = vi.fn();
const listStanding = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      listPages: (...a: unknown[]) => listPages(...a), listFolders: (...a: unknown[]) => listFolders(...a),
      listConnections: (...a: unknown[]) => listConnections(...a), party: (...a: unknown[]) => party(...a),
      getPage: (...a: unknown[]) => getPage(...a), getSettings: (...a: unknown[]) => getSettings(...a),
      search: (...a: unknown[]) => search(...a), markersForPage: (...a: unknown[]) => markersForPage(...a),
      revealAudit: (...a: unknown[]) => auditList(...a), exportBundle: (...a: unknown[]) => exportBundle(...a)
    },
    journalApi: { ...actual.journalApi, chronicle: (...a: unknown[]) => chronicle(...a), forPage: (...a: unknown[]) => forPage(...a) },
    atlasApi: { ...actual.atlasApi, listMaps: (...a: unknown[]) => listMaps(...a), listAssets: (...a: unknown[]) => listAssets(...a), listMarkers: async () => [] },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    sessionApi: { ...actual.sessionApi, list: (...a: unknown[]) => listSessions(...a) },
    questApi: { ...actual.questApi, list: (...a: unknown[]) => listQuests(...a) },
    standingApi: { ...actual.standingApi, list: (...a: unknown[]) => listStanding(...a) }
  };
});

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { navigate, registerNavigationGuard } from "../router";
import { CodexShell } from "./CodexShell";
import { GM_SIDEBAR } from "./routes";

/**
 * D1 + D3 — the recut's central claim, tested end to end: **every surface is a sidebar destination with
 * a real address**, and the two agree.
 *
 * What this replaces was untestable by construction. The old shell had five mode tabs plus four
 * "destination" overlays that no tab listed and no URL named — the Calendar, the reveal audit, the
 * backup panel and the settings panel were reachable only by having pressed the right button on the
 * right mode. You could not deep-link to them, you could not bookmark them, and the tab bar lit
 * "Campaign" while you were looking at something else. The three tests below could not have been
 * written against it: there was no address to type, no back stack to walk, and no honest active state.
 */

const PAGE = {
  id: "p1", title: "Strahd", entityType: "character" as const, fields: {}, folder: null, tags: ["villain"],
  revealedToPlayers: false, bannerAssetId: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  rev: 1, createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z"
};

const renderShell = (at: string) =>
  (goTo(at), render)(<ToastProvider><CodexShell gmToken="gm" /></ToastProvider>);

beforeEach(() => {
  listPages.mockResolvedValue([PAGE]);
  listFolders.mockResolvedValue([]);
  listConnections.mockResolvedValue([]);
  party.mockResolvedValue(null);
  getSettings.mockResolvedValue({ revealWarn: true, autosave: { enabled: true, intervalSeconds: 1 } });
  search.mockResolvedValue({ hits: [], truncated: false });
  markersForPage.mockResolvedValue([]);
  auditList.mockResolvedValue([]);
  exportBundle.mockResolvedValue({ version: 1, pages: [], counts: {} });
  chronicle.mockResolvedValue([]);
  forPage.mockResolvedValue([]);
  listMaps.mockResolvedValue([]);
  listAssets.mockResolvedValue([]);
  getCalendar.mockResolvedValue({ yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [], currentInstant: 0, publishedInstant: 0 });
  listSessions.mockResolvedValue({ sessions: [], activeSessionId: null });
  listQuests.mockResolvedValue([]);
  listStanding.mockResolvedValue([]);
  getPage.mockResolvedValue({ page: { ...PAGE, playerBody: "", gmBody: "", gmFields: {} }, connections: [] });
});

/** Every sidebar item that navigates, as `[label, address]`. Read from the table the sidebar renders. */
const DESTINATIONS = GM_SIDEBAR.flatMap((group) => group.items)
  .filter((item): item is typeof item & { path: string } => Boolean(item.path))
  .map((item) => [item.label, item.path] as const);

describe("Every sidebar destination is reachable, and says so (D1/D3)", () => {
  it.each(DESTINATIONS)("%s opens at %s with exactly one item lit", async (label, path) => {
    const user = userEvent.setup();
    renderShell("/codex");
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    const sidebar = within(screen.getByRole("navigation", { name: "Codex sections" }));
    await user.click(sidebar.getByRole("button", { name: label }));

    await waitFor(() => expect(window.location.pathname).toBe(path));
    // "Exactly one" is the assertion that matters. The old tab bar lit Campaign over four different
    // surfaces; a nav that lights two things, or nothing, is lying either way.
    const lit = sidebar.getAllByRole("button").filter((button) => button.getAttribute("aria-current") === "page");
    expect(lit).toHaveLength(1);
    expect(lit[0]).toHaveAccessibleName(label);
  });

  it("titles the top bar with the section it is showing", async () => {
    const user = userEvent.setup();
    renderShell("/codex");
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    const sidebar = within(screen.getByRole("navigation", { name: "Codex sections" }));

    await user.click(sidebar.getByRole("button", { name: "Downtime" }));
    expect(await screen.findByRole("heading", { name: "Downtime", level: 2 })).toBeInTheDocument();
  });

  it("keeps Home dark on every other section — the lit-tab lie, specifically", async () => {
    const user = userEvent.setup();
    renderShell("/codex");
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    const sidebar = within(screen.getByRole("navigation", { name: "Codex sections" }));
    expect(sidebar.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");

    await user.click(sidebar.getByRole("button", { name: "Journal" }));
    await waitFor(() => expect(sidebar.getByRole("button", { name: "Home" })).not.toHaveAttribute("aria-current"));
  });

  it("offers Preview as player as an ACTION, not an address — it is a modal, not a section", async () => {
    const sidebar = () => within(screen.getByRole("navigation", { name: "Codex sections" }));
    renderShell("/codex");
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    const preview = sidebar().getByRole("button", { name: "Preview as player" });
    // No `aria-current` is possible for it, ever: it has no path, so it can never be "the page you are on".
    expect(preview).not.toHaveAttribute("aria-current");
  });
});

describe("Deep links (D3)", () => {
  it.each(DESTINATIONS)("renders %s directly from the address %s, with no navigation first", async (label, path) => {
    renderShell(path);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    const sidebar = within(screen.getByRole("navigation", { name: "Codex sections" }));
    await waitFor(() => expect(sidebar.getByRole("button", { name: label })).toHaveAttribute("aria-current", "page"));
  });

  it("opens a RECORD from its address, not just the section", async () => {
    renderShell("/codex/pages/p1");
    await waitFor(() => expect(getPage).toHaveBeenCalledWith("gm", "p1"));
  });

  it("shows the not-found view for a codex address that does not exist", async () => {
    // Invariant §1: an unknown address and a GM-only address must be indistinguishable to a player, which
    // is only possible if "unknown" has a real view of its own rather than falling back to Home.
    renderShell("/codex/notebook");
    expect(await screen.findByRole("heading", { name: /Nothing lives at this address/i })).toBeInTheDocument();
    const sidebar = within(screen.getByRole("navigation", { name: "Codex sections" }));
    expect(sidebar.getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page")).toHaveLength(0);
  });
});

describe("The browser's own buttons (D3)", () => {
  it("goes back to the previous section, and forward again", async () => {
    const user = userEvent.setup();
    renderShell("/codex");
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    const sidebar = within(screen.getByRole("navigation", { name: "Codex sections" }));

    await user.click(sidebar.getByRole("button", { name: "Quests" }));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/quests"));
    await user.click(sidebar.getByRole("button", { name: "Journal" }));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/journal"));

    window.history.back();
    await waitFor(() => expect(sidebar.getByRole("button", { name: "Quests" })).toHaveAttribute("aria-current", "page"));
    window.history.forward();
    await waitFor(() => expect(sidebar.getByRole("button", { name: "Journal" })).toHaveAttribute("aria-current", "page"));
  });

  it("does not stack a history entry when the section already open is chosen again", async () => {
    const user = userEvent.setup();
    renderShell("/codex/quests");
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    const sidebar = within(screen.getByRole("navigation", { name: "Codex sections" }));
    const depth = window.history.length;

    await user.click(sidebar.getByRole("button", { name: "Quests" }));
    expect(window.history.length).toBe(depth);
  });
});

describe("The phone nav drawer (D1, mobile parity)", () => {
  /**
   * ≤760px the sidebar is a Drawer. jsdom loads no stylesheet, so BOTH the aside and the drawer are in
   * the tree here — the drawer carries `inert` and `aria-hidden` while closed, which is what keeps the
   * accessibility tree honest and is why these queries can tell them apart at all.
   */
  const drawerNav = () => screen.getAllByRole("navigation", { name: "Codex sections" });

  it("opens from the top bar and closes on choosing a destination", async () => {
    const user = userEvent.setup();
    renderShell("/codex");
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(drawerNav()).toHaveLength(1);        // the closed drawer is hidden from the a11y tree

    await user.click(screen.getByRole("button", { name: "Codex sections" }));
    await waitFor(() => expect(drawerNav()).toHaveLength(2));

    // Choosing from the drawer navigates AND closes it — a drawer left open over the destination is the
    // single most common phone-nav bug, and it is invisible on a desktop viewport.
    await user.click(within(drawerNav()[1]).getByRole("button", { name: "Atlas" }));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/atlas"));
    await waitFor(() => expect(drawerNav()).toHaveLength(1));
  });

  /**
   * FOUND IN CHROMIUM, and **these two tests do not reproduce it** — stated plainly because a test whose
   * comment claims a guard it does not provide is worse than no test.
   *
   * The bug: choosing a destination from the drawer ran `closeDrawer()` (→ `history.back()`) and then
   * `navigate()`. In a real browser `back()` is a task while `navigate` pushes on a microtask, so the
   * order was always push-then-go-back-off it, and **every tap in the phone nav drawer navigated
   * nowhere**. On a laptop no transient entry is registered, `popTransient` is a no-op, and the same
   * code path is correct — which is how it survived to a browser pass.
   *
   * jsdom sequences `history.back()` differently, so both of these passed against the broken code (I
   * checked, by reverting the fix and re-running). They are kept anyway: they pin the BEHAVIOUR the fix
   * establishes, so a future refactor that reintroduces a `closeDrawer()`-then-navigate shape has
   * something to answer to on the "back is one press" half. The race itself is browser-only, and
   * `scripts/browser-verify.mjs` is what actually catches it.
   */
  it("navigating from the drawer lands on the destination", async () => {
    const user = userEvent.setup();
    renderShell("/codex");
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Codex sections" }));
    await waitFor(() => expect(drawerNav()).toHaveLength(2));
    await user.click(within(drawerNav()[1]).getByRole("button", { name: "Quests" }));

    // The whole point: the address moved, and stayed moved.
    await waitFor(() => expect(window.location.pathname).toBe("/codex/quests"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(window.location.pathname).toBe("/codex/quests");
  });

  /**
   * The assertion here is the history DEPTH, not the pathname after one back().
   *
   * `pushTransient` pushes at the same href, so the stranded entry and the entry before it have the
   * same pathname — one back() lands on "/codex" whether the destination replaced the transient or was
   * pushed on top of it, and the obvious version of this test passed either way. Counting entries is
   * the only thing that can tell the two apart.
   */
  it("replaces the drawer's own history entry, so back from the destination is one press", async () => {
    const user = userEvent.setup();
    renderShell("/codex");
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    const depth = window.history.length;

    await user.click(screen.getByRole("button", { name: "Codex sections" }));
    await waitFor(() => expect(drawerNav()).toHaveLength(2));
    await user.click(within(drawerNav()[1]).getByRole("button", { name: "Journal" }));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/journal"));

    // Exactly ONE new entry for one tap: the drawer's own entry was overwritten by the destination.
    // Two would mean the GM has to press back twice to undo a single tap.
    expect(window.history.length).toBe(depth + 1);
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/codex"));
  });

  /**
   * D6 meets the drawer. `goto` releases the drawer's history entry *before* the guard has answered,
   * because it expects the destination to overwrite it. When the GM answers "stay", nothing overwrites
   * it — and the released entry sits on the stack with nothing registered to absorb its pop, so the next
   * Back press is spent closing a drawer that is already closed and appears to do nothing.
   */
  it("does not swallow the next Back when the guard refuses a destination chosen from the drawer", async () => {
    const user = userEvent.setup();
    renderShell("/codex");
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    void navigate("/codex/quests");
    await waitFor(() => expect(window.location.pathname).toBe("/codex/quests"));

    const release = registerNavigationGuard(() => false);
    await user.click(screen.getByRole("button", { name: "Codex sections" }));
    await waitFor(() => expect(drawerNav()).toHaveLength(2));
    await user.click(within(drawerNav()[1]).getByRole("button", { name: "Journal" }));

    // Vetoed: the drawer closed and the GM stayed put.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(window.location.pathname).toBe("/codex/quests");
    await waitFor(() => expect(drawerNav()).toHaveLength(1));
    release();   // the GM saves, so the guard goes away

    // ONE press must now leave the section. If the drawer's entry is still on the stack it is spent here.
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/codex"));
  });

  it("closes on the back gesture instead of leaving the section", async () => {
    const user = userEvent.setup();
    renderShell("/codex/quests");
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Codex sections" }));
    await waitFor(() => expect(drawerNav()).toHaveLength(2));

    window.history.back();
    await waitFor(() => expect(drawerNav()).toHaveLength(1));
    // The address is untouched: back closed the drawer, it did not navigate.
    expect(window.location.pathname).toBe("/codex/quests");
  });

  it("withdraws its history entry when closed by its own control, so back still means back", async () => {
    const user = userEvent.setup();
    renderShell("/codex/quests");
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Codex sections" }));
    await waitFor(() => expect(drawerNav()).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(drawerNav()).toHaveLength(1));

    // If the transient entry were left behind, this back would be swallowed closing an already-closed
    // drawer, and the GM would have to press back twice to leave Quests.
    window.history.back();
    await waitFor(() => expect(window.location.pathname).not.toBe("/codex/quests"));
  });
});

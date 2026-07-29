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
// The session surface itself. The five WRITE mocks exist so the console test can assert that opening a
// read-only panel called none of them — a test that only checked the read would pass on a console that
// silently PATCHed on mount.
const listSessions = vi.fn();
const createSession = vi.fn();
const updateSession = vi.fn();
const revealSession = vi.fn();
const activateSession = vi.fn();
const removeSession = vi.fn();
const playerListPages = vi.fn();
const playerListMaps = vi.fn();
const playerListMarkers = vi.fn();
const playerChronicle = vi.fn();
const playerListRelationships = vi.fn();
const playerListLinks = vi.fn();
const playerSessions = vi.fn();

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
    sessionApi: {
      list: (...a: unknown[]) => listSessions(...a), create: (...a: unknown[]) => createSession(...a),
      update: (...a: unknown[]) => updateSession(...a), reveal: (...a: unknown[]) => revealSession(...a),
      activate: (...a: unknown[]) => activateSession(...a), remove: (...a: unknown[]) => removeSession(...a),
      get: vi.fn()
    },
    playerCodexApi: {
      ...actual.playerCodexApi,
      listPages: (...a: unknown[]) => playerListPages(...a), listMaps: (...a: unknown[]) => playerListMaps(...a),
      listMarkers: (...a: unknown[]) => playerListMarkers(...a), chronicle: (...a: unknown[]) => playerChronicle(...a),
      listRelationships: (...a: unknown[]) => playerListRelationships(...a), listLinks: (...a: unknown[]) => playerListLinks(...a),
      sessions: (...a: unknown[]) => playerSessions(...a)
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { CodexWorkspace } from "./CodexWorkspace";
import { PlayerCodex } from "./PlayerCodex";
import { useRecapBadge } from "./useRecapBadge";
import { pickNextSession, sessionByNumber, sessionTitle } from "./sessions";
import { socket } from "../socket";
import type { CodexCalendar, CodexChronicleRecord, CodexSession, PlayerCodexSession } from "./api";

/**
 * M9 on the client: sessions, prep and the recap badge.
 *
 * What each group below is actually for, stated so a later reader does not soften it:
 *  - **The console is a VIEW.** Not "mostly a view" — it fetches nothing of its own and calls no write
 *    endpoint, from any mode. A second store for one record is how a console and the editor beside it
 *    end up disagreeing; the test that would catch that regression is the one that counts the calls.
 *  - **No backfill.** A numbered journal group with no session record behind it must keep rendering
 *    exactly as it renders today. The negative half of that assertion is the whole point.
 *  - **The badge keys on session id, not on a timestamp.** `updatedAt` moves when the GM edits prep and
 *    does NOT move when a recap is revealed, so a timestamp badge would fire on precisely the wrong
 *    event in both directions — and `updatedAt` is not in the player projection at all.
 *  - **Two audiences, one card.** The shared dashboard type has no `prep` field to render, and a player
 *    gets a readout rather than a button, because there is no player session log to open.
 */
const CALENDAR: CodexCalendar = { yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] };

const SESSION = (over: Partial<CodexSession> = {}): CodexSession => ({
  id: "s1", sessionNumber: 3, realDate: "2026-07-12", attendees: ["Ozy"],
  prepBody: "Strahd ambushes them at the bridge.", recapBody: "The party crossed the mists.",
  revealedToPlayers: false, status: "planned", rev: 1,
  createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", ...over
});
const S3 = SESSION({ id: "s3" });
const S8 = SESSION({ id: "s8", sessionNumber: 8, realDate: "2026-07-26", prepBody: "The heart of the castle.", recapBody: "They reached the spire.", rev: 2 });

const record = (id: string, sessionNumber: number | null): CodexChronicleRecord => ({
  kind: "entry", id, title: null, text: `Entry ${id}`, gmText: null, revealedToPlayers: false,
  sessionNumber, realDate: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  tags: [], attachPageId: null, attachMarkerId: null, sourceEncounterId: null,
  createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z"
});

const gmDefaults = (sessions: CodexSession[] = [S3, S8], activeSessionId: string | null = "s8") => {
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
  listSessions.mockResolvedValue({ sessions, activeSessionId });
};
const renderWorkspace = async () => {
  render(<ToastProvider><CodexWorkspace gmToken="gm" /></ToastProvider>);
  await waitFor(() => expect(listSessions).toHaveBeenCalled());
};

// C5: `vitest.config.ts` restores mocks between tests but does NOT clear storage, and M9 persists two
// things — the console's open/closed state and the badge's seen-id set. Without this, one test would
// decide the starting state of every test after it. The chronicle lens lives in sessionStorage.
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe("Which session is 'now' (the rule, below the components)", () => {
  it("prefers the GM's explicit pointer, and falls back to the highest number for a player who has none", () => {
    // The active session wins even though a higher-numbered one exists: the GM said so.
    expect(pickNextSession([S3, S8], "s3")?.id).toBe("s3");
    // No pointer — the player's case, since the server always answers them `activeSessionId: null`.
    expect(pickNextSession([S3, S8])?.id).toBe("s8");
    // A pointer at a session that is no longer in the list falls through rather than blanking the card.
    expect(pickNextSession([S3, S8], "deleted")?.id).toBe("s8");
    // An unnumbered scratch record must never take the card off a numbered campaign.
    const scratch = SESSION({ id: "sx", sessionNumber: null });
    expect(pickNextSession([S3, scratch])?.id).toBe("s3");
    expect(pickNextSession([scratch])?.id).toBe("sx");
    expect(pickNextSession([])).toBeNull();
    // ...and it still has a name, because "Session null" is not one.
    expect(sessionTitle(scratch)).toBe("Unnumbered session");
    expect(sessionTitle(S8)).toBe("Session 8");
  });

  it("resolves a session NUMBER only when a record exists for it — there is no backfill", () => {
    expect(sessionByNumber([S3, S8], 3)?.id).toBe("s3");
    expect(sessionByNumber([S3, S8], 4)).toBeNull();
    expect(sessionByNumber([], 3)).toBeNull();
  });
});

describe("The session console is a VIEW (M9)", () => {
  it("opens from three different modes on one fetch, and writes nothing", async () => {
    gmDefaults();
    const user = userEvent.setup();
    await renderWorkspace();

    // From Pages (where the workspace lands), then Campaign, then Atlas. The console is reachable from
    // every mode by design — that is the whole reason it is a drawer and not a panel inside one mode.
    for (const tab of ["Pages", "Campaign", "Atlas"]) {
      await user.click(screen.getByRole("tab", { name: tab }));
      await user.click(screen.getByRole("button", { name: "Session console" }));
      const panel = screen.getByRole("complementary", { name: "Session console" });
      // The drawer stays MOUNTED while closed (so its slide plays both ways), so "is it in the
      // document" proves nothing here — `inert` is what says it is genuinely open in THIS mode.
      expect(panel).not.toHaveAttribute("inert");
      // And it rendered the ACTIVE session's prep, so the call counts below are not passing against an
      // empty panel that never resolved anything.
      expect(within(panel).getByRole("heading", { name: "Session 8" })).toBeInTheDocument();
      expect(within(panel).getByText("The heart of the castle.")).toBeInTheDocument();
      await user.click(within(panel).getByRole("button", { name: "Close" }));
      expect(panel).toHaveAttribute("inert");
    }

    // The two properties that make this a view: one read for the whole workspace, and no write at all.
    expect(listSessions).toHaveBeenCalledTimes(1);
    for (const write of [createSession, updateSession, revealSession, activateSession, removeSession]) {
      expect(write).not.toHaveBeenCalled();
    }
  });

  it("remembers whether it was left open, under a codex- key", async () => {
    // A GM who runs with the console open expects it open next game. Both halves are asserted: the
    // write, and the READ on a fresh mount — a persisted value nothing reads back is not persistence.
    gmDefaults();
    const user = userEvent.setup();
    const first = render(<ToastProvider><CodexWorkspace gmToken="gm" /></ToastProvider>);
    await waitFor(() => expect(listSessions).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Session console" }));
    expect(localStorage.getItem("codex-session-console")).toBe("open");
    first.unmount();

    render(<ToastProvider><CodexWorkspace gmToken="gm" /></ToastProvider>);
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("complementary", { name: "Session console" })).not.toHaveAttribute("inert");
  });
});

describe("Getting to a session (R1: every jump prepares its destination)", () => {
  it("from the Campaign card, landing ON that session with the other one unmarked", async () => {
    // The ACTIVE session is deliberately the LOWER-numbered one here, so "the GM's own pointer wins" is
    // a claim the test can fail: against `pickNextSession(sessions, null)` the card would say Session 8.
    gmDefaults([S3, S8], "s3");
    const user = userEvent.setup();
    await renderWorkspace();

    await user.click(screen.getByRole("tab", { name: "Campaign" }));
    const card = within(await screen.findByRole("navigation", { name: "Next session" }));
    expect(card.queryByText("Session 8")).not.toBeInTheDocument();
    await user.click(card.getByText("Session 3"));

    const log = within(await screen.findByRole("navigation", { name: "Session log" }));
    await waitFor(() => expect(log.getByRole("button", { name: /Session 3/ })).toHaveAttribute("aria-current", "true"));
    expect(log.getByRole("button", { name: /Session 8/ })).not.toHaveAttribute("aria-current");
    // Prepared means the record is OPEN, not merely highlighted: its prep is on screen and editable.
    expect(screen.getByRole("textbox", { name: /Prep for this session/ })).toHaveValue("Strahd ambushes them at the bridge.");
  });

  it("from a by-session journal heading — but ONLY where a session record exists", async () => {
    // Session 3 has a record; session 4 does not (no backfill). Both have entries filed under them.
    gmDefaults([S3], "s1");
    chronicle.mockResolvedValue([record("j3", 3), record("j4", 4)]);
    const user = userEvent.setup();
    await renderWorkspace();

    await user.click(screen.getByRole("tab", { name: "Journal" }));
    await waitFor(() => expect(chronicle).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "By session" }));

    // The negative half is the point: an un-backfilled group heading is still a plain heading. Read the
    // HEADING elements, not any text on the page — the entry rows also say "Session 4", and a looser
    // query would pass on that alone while the heading quietly became a control.
    const heading = (label: string) => [...document.querySelectorAll(".codex-timeline-year")].find((node) => node.textContent?.startsWith(label))!;
    expect(heading("Session 4").tagName).toBe("DIV");
    expect(heading("Session 3").tagName).toBe("BUTTON");

    await user.click(screen.getByRole("button", { name: /^Session 3/ }));
    const log = within(await screen.findByRole("navigation", { name: "Session log" }));
    await waitFor(() => expect(log.getByRole("button", { name: /Session 3/ })).toHaveAttribute("aria-current", "true"));
    expect(screen.getByRole("textbox", { name: /Prep for this session/ })).toHaveValue("Strahd ambushes them at the bridge.");
  });

  it("does not turn a calendar YEAR into a session number under the date lens", async () => {
    // Under "by in-world date" the group key is a year. Resolving it as a session number would make
    // "1492 DR" an opener for session 1492 — or, worse, for whichever session happened to be numbered so.
    gmDefaults([SESSION({ id: "s1492", sessionNumber: 1492 })], null);
    chronicle.mockResolvedValue([{ ...record("j1", null), calendarInstant: 1492 * 30, inWorldDate: { year: 1492, month: 0, day: 1 }, inWorldLabel: "Hammer 1, 1492 DR" }]);
    const user = userEvent.setup();
    await renderWorkspace();

    await user.click(screen.getByRole("tab", { name: "Journal" }));
    await waitFor(() => expect(chronicle).toHaveBeenCalled());

    expect(screen.getByText("1492 DR")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /1492 DR/ })).not.toBeInTheDocument();
  });
});

describe("The player's session card (M9, viewer safety)", () => {
  const PLAYER_SESSION: PlayerCodexSession = { id: "s8", sessionNumber: 8, realDate: "2026-07-26", recap: "They reached the spire." };
  beforeEach(() => {
    playerListPages.mockResolvedValue([]);
    playerListMaps.mockResolvedValue([]);
    playerListMarkers.mockResolvedValue([]);
    playerChronicle.mockResolvedValue([]);
    playerListRelationships.mockResolvedValue([]);
    playerListLinks.mockResolvedValue([]);
    getCalendar.mockResolvedValue(CALENDAR);
    playerSessions.mockResolvedValue([PLAYER_SESSION]);
  });

  it("shows the recap as a readout — never a button, because there is no player session log", async () => {
    render(<PlayerCodex token="player" />);
    // "Latest recap", not "Next session": a player only ever sees a session whose recap was revealed,
    // which has already been played. The GM's copy of this card is the one that says "Next session".
    expect(screen.queryByRole("navigation", { name: "Next session" })).not.toBeInTheDocument();
    const card = within(await screen.findByRole("navigation", { name: "Latest recap" }));

    expect(card.getByText("Session 8")).toBeInTheDocument();
    expect(await screen.findByText("They reached the spire.")).toBeInTheDocument();
    // A button that navigates nowhere is worse than no button.
    expect(card.queryByRole("button")).not.toBeInTheDocument();
  });

  /**
   * The assertion this replaces read `expect(document.body.textContent).not.toContain(S8.prepBody)` and
   * could not fail: `S8` is only ever fed to `sessionApi.list`, which `PlayerCodex` does not import, so
   * that string was unreachable from this render no matter what the card did. It would have passed with
   * `{session.prepBody}` rendered verbatim. Adversarial review caught it; recorded because it is the
   * exact shape of the trap this suite's own header warns about.
   *
   * This version arms the PLAYER endpoint with a GM-shaped row — the payload a regressed
   * `projectPlayerSession` would actually send — so the type guard is no longer the only thing between
   * prep and the screen, and the card is asked to survive being handed secrets it should never receive.
   */
  it("renders nothing from extra keys if the server ever regresses and sends a GM row", async () => {
    playerSessions.mockResolvedValue([{
      ...PLAYER_SESSION,
      prepBody: "The heart of the castle.", attendees: ["Ana", "Bo"], status: "planned", rev: 7,
      recapBody: "a GM-shaped duplicate of the recap"
    } as never]);
    render(<PlayerCodex token="player" />);

    const card = within(await screen.findByRole("navigation", { name: "Latest recap" }));
    expect(card.getByText("Session 8")).toBeInTheDocument();       // the legitimate keys still render...
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("The heart of the castle.");        // ...and none of the smuggled ones do
    expect(text).not.toContain("Ana");
    expect(text).not.toContain("a GM-shaped duplicate of the recap");
  });
});

/** Mirrors main.tsx's use of the hook exactly, so the badge under test is the one on the real button. */
function BadgeProbe({ token }: Readonly<{ token: string | null }>) {
  const badge = useRecapBadge(token);
  return <button type="button" onClick={badge.markSeen}>Open Codex{badge.unread > 0 ? ` ${badge.unread} new` : ""}</button>;
}

describe("The recap badge keys on session ID (CT-3, correction C2)", () => {
  const sessionRow = (id: string, sessionNumber: number): PlayerCodexSession => ({ id, sessionNumber, realDate: null, recap: "…" });

  it("counts revealed sessions the reader has not opened, and forgets them once they have", async () => {
    playerSessions.mockResolvedValue([sessionRow("s1", 1), sessionRow("s2", 2)]);
    const user = userEvent.setup();
    render(<BadgeProbe token="player" />);

    const button = await screen.findByRole("button", { name: "Open Codex 2 new" });
    await user.click(button);
    expect(await screen.findByRole("button", { name: "Open Codex" })).toBeInTheDocument();
    // The seen set is what persists, under a codex- key — not a timestamp.
    expect(JSON.parse(localStorage.getItem("codex-seen-sessions")!).sort()).toEqual(["s1", "s2"]);
  });

  it("stays quiet when the SAME sessions come back, and speaks up for a new id", async () => {
    // This is the correction that matters. `setSessionRevealed` deliberately does not move `updatedAt`,
    // and `updatedAt` DOES move when the GM edits prep — so a recency-keyed badge would miss the one
    // event it exists for and fire on GM activity a player must not be able to infer. Keyed on id, a
    // refetch of the same records is silent no matter what the GM did to them.
    playerSessions.mockResolvedValue([sessionRow("s1", 1)]);
    const user = userEvent.setup();
    render(<BadgeProbe token="player" />);
    await user.click(await screen.findByRole("button", { name: "Open Codex 1 new" }));
    await screen.findByRole("button", { name: "Open Codex" });

    // The GM edits prep and re-reveals; every client is pinged and refetches the same ids.
    const refetch = (socket.on as unknown as { mock: { calls: [string, () => void][] } }).mock.calls.find(([event]) => event === "codex:changed")![1];
    playerSessions.mockResolvedValue([sessionRow("s1", 1)]);
    refetch();
    await waitFor(() => expect(playerSessions).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Open Codex" })).toBeInTheDocument();

    // A genuinely new session is a genuinely new id.
    playerSessions.mockResolvedValue([sessionRow("s1", 1), sessionRow("s9", 9)]);
    refetch();
    expect(await screen.findByRole("button", { name: "Open Codex 1 new" })).toBeInTheDocument();
  });

  it("never reads sessions for a GM token, and shows nothing before the first list lands", () => {
    // The mock is armed on purpose: an unarmed one would make a regression here fail with a TypeError
    // rather than with the assertion that states the rule, and a test that cannot say WHY it failed is
    // half a test. main.tsx passes null for the GM, so this is the GM's path exactly.
    playerSessions.mockResolvedValue([sessionRow("s1", 1)]);
    render(<BadgeProbe token={null} />);
    expect(screen.getByRole("button", { name: "Open Codex" })).toBeInTheDocument();
    expect(playerSessions).not.toHaveBeenCalled();
  });
});

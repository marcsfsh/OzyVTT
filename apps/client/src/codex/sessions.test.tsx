import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./atlas/AtlasMap", () => ({ AtlasMap: () => <div data-testid="map-surface" /> }));

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
// Write mocks exist so the console test can assert opening it writes nothing.
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
      listPages: (...a: unknown[]) => listPages(...a),
      listRelationships: (...a: unknown[]) => listRelationships(...a),
      listLinks: (...a: unknown[]) => listLinks(...a),
      listFolders: (...a: unknown[]) => listFolders(...a),
      getPage: (...a: unknown[]) => getPage(...a),
      search: (...a: unknown[]) => search(...a),
      markersForPage: (...a: unknown[]) => markersForPage(...a)
    },
    journalApi: {
      ...actual.journalApi,
      timeline: (...a: unknown[]) => timeline(...a),
      chronicle: (...a: unknown[]) => chronicle(...a),
      forPage: (...a: unknown[]) => forPage(...a)
    },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    atlasApi: {
      ...actual.atlasApi,
      listMaps: (...a: unknown[]) => listMaps(...a),
      listAssets: (...a: unknown[]) => listAssets(...a),
      listMarkers: (...a: unknown[]) => listMarkers(...a)
    },
    sessionApi: {
      list: (...a: unknown[]) => listSessions(...a),
      create: (...a: unknown[]) => createSession(...a),
      update: (...a: unknown[]) => updateSession(...a),
      reveal: (...a: unknown[]) => revealSession(...a),
      activate: (...a: unknown[]) => activateSession(...a),
      remove: (...a: unknown[]) => removeSession(...a),
      get: vi.fn()
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
      sessions: (...a: unknown[]) => playerSessions(...a)
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { CodexShell } from "./CodexShell";
import { PlayerCodex } from "./PlayerCodex";
import { useRecapBadge } from "./useRecapBadge";
import { pickNextSession, sessionByNumber, sessionTitle } from "./sessions";
import { socket } from "../socket";
import type { CodexCalendar, CodexChronicleRecord, CodexSession, PlayerCodexSession } from "@vtt/domain";

/**
 * The console is a view: it fetches nothing of its own and never writes. Journal groups without a session
 * record stay plain headings. The recap badge keys on session id.
 */
const CALENDAR: CodexCalendar = { yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] };

const SESSION = (over: Partial<CodexSession> = {}): CodexSession => ({
  id: "s1",
  sessionNumber: 3,
  tags: [],
  realDate: "2026-07-12",
  attendees: ["Ozy"],
  prepBody: "Strahd ambushes them at the bridge.",
  recapBody: "The party crossed the mists.",
  revealedToPlayers: false,
  status: "planned",
  sceneIds: [],
  rev: 1,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  ...over
});
const S3 = SESSION({ id: "s3" });
const S8 = SESSION({
  id: "s8",
  sessionNumber: 8,
  realDate: "2026-07-26",
  prepBody: "The heart of the castle.",
  recapBody: "They reached the spire.",
  rev: 2
});

const record = (id: string, sessionNumber: number | null): CodexChronicleRecord => ({
  kind: "entry",
  id,
  title: null,
  text: `Entry ${id}`,
  gmText: null,
  revealedToPlayers: false,
  sessionId: null,
  sessionNumber,
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
  updatedAt: "2026-07-28T00:00:00.000Z"
});

const gmDefaults = (sessions: CodexSession[] = [S3, S8], activeSessionId: string | null = "s8") => {
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
  listSessions.mockResolvedValue({ sessions, activeSessionId });
};
const renderWorkspace = async () => {
  (goTo("/codex/sessions"), render)(
    <ToastProvider>
      <CodexShell gmToken="gm" />
    </ToastProvider>
  );
  await waitFor(() => expect(listSessions).toHaveBeenCalled());
};

// Mocks are restored between tests but storage is not (console state, the badge's seen ids, the lens).
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("Which session is 'now' (the rule, below the components)", () => {
  it("prefers the GM's explicit pointer, and falls back to the highest number for a player who has none", () => {
    // The GM's active pointer wins over a higher number.
    expect(pickNextSession([S3, S8], "s3")?.id).toBe("s3");
    // No pointer: the player's case.
    expect(pickNextSession([S3, S8])?.id).toBe("s8");
    // A stale pointer falls through and the card stays filled.
    expect(pickNextSession([S3, S8], "deleted")?.id).toBe("s8");
    // An unnumbered record never takes the card from a numbered one.
    const scratch = SESSION({ id: "sx", sessionNumber: null });
    expect(pickNextSession([S3, scratch])?.id).toBe("s3");
    expect(pickNextSession([scratch])?.id).toBe("sx");
    expect(pickNextSession([])).toBeNull();
    expect(sessionTitle(scratch)).toBe("Unnumbered session");
    expect(sessionTitle(S8)).toBe("Session 8");
  });

  it("resolves a session NUMBER only when a record exists for it: there is no backfill", () => {
    expect(sessionByNumber([S3, S8], 3)?.id).toBe("s3");
    expect(sessionByNumber([S3, S8], 4)).toBeNull();
    expect(sessionByNumber([], 3)).toBeNull();
  });
});

describe("Getting to a session (R1: every jump prepares its destination)", () => {
  it("from the Campaign card, landing ON that session with the other one unmarked", async () => {
    // The active session is the lower-numbered one, so the GM's pointer has to win for this to pass.
    gmDefaults([S3, S8], "s3");
    const user = userEvent.setup();
    await renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Home" }));
    const card = within(await screen.findByRole("navigation", { name: "Next session" }));
    expect(card.queryByText("Session 8")).not.toBeInTheDocument();
    await user.click(card.getByText("Session 3"));

    const log = within(await screen.findByRole("navigation", { name: "Sessions" }));
    await waitFor(() => expect(log.getByRole("button", { name: /Session 3/ })).toHaveAttribute("aria-current", "true"));
    expect(log.getByRole("button", { name: /Session 8/ })).not.toHaveAttribute("aria-current");
    // The record is open and its prep editable, beyond a highlight.
    expect(screen.getByRole("textbox", { name: /Prep for this session/ })).toHaveValue(
      "Strahd ambushes them at the bridge."
    );
  });

  it("from a by-session journal heading, but ONLY where a session record exists", async () => {
    // Session 3 has a record; session 4 does not. Both have entries.
    gmDefaults([S3], "s1");
    chronicle.mockResolvedValue([record("j3", 3), record("j4", 4)]);
    const user = userEvent.setup();
    await renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Story" }));
    await waitFor(() => expect(chronicle).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "By session" }));

    // Session 4's group heading must stay plain. Query the headings, since entry rows also say "Session 4".
    const heading = (label: string) =>
      [...document.querySelectorAll(".codex-timeline-year")].find((node) => node.textContent?.startsWith(label))!;
    expect(heading("Session 4").tagName).toBe("DIV");
    expect(heading("Session 3").tagName).toBe("BUTTON");

    await user.click(screen.getByRole("button", { name: /^Session 3/ }));
    const log = within(await screen.findByRole("navigation", { name: "Sessions" }));
    await waitFor(() => expect(log.getByRole("button", { name: /Session 3/ })).toHaveAttribute("aria-current", "true"));
    expect(screen.getByRole("textbox", { name: /Prep for this session/ })).toHaveValue(
      "Strahd ambushes them at the bridge."
    );
  });

  it("does not turn a calendar YEAR into a session number under the date lens", async () => {
    // Under the date lens the key is a year, never a session number.
    gmDefaults([SESSION({ id: "s1492", sessionNumber: 1492 })], null);
    chronicle.mockResolvedValue([
      {
        ...record("j1", null),
        calendarInstant: 1492 * 30,
        inWorldDate: { year: 1492, month: 0, day: 1 },
        inWorldLabel: "Hammer 1, 1492 DR"
      }
    ]);
    const user = userEvent.setup();
    await renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Story" }));
    await waitFor(() => expect(chronicle).toHaveBeenCalled());

    expect(screen.getByText("1492 DR")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /1492 DR/ })).not.toBeInTheDocument();
  });
});

describe("The player's session card (viewer safety)", () => {
  const PLAYER_SESSION: PlayerCodexSession = {
    id: "s8",
    sessionNumber: 8,
    realDate: "2026-07-26",
    recap: "They reached the spire.",
    tags: []
  };
  beforeEach(() => {
    playerListPages.mockResolvedValue([]);
    playerListMaps.mockResolvedValue([]);
    playerListMarkers.mockResolvedValue([]);
    playerChronicle.mockResolvedValue([]);
    playerListRelationships.mockResolvedValue([]);
    playerListLinks.mockResolvedValue(null);
    getCalendar.mockResolvedValue(CALENDAR);
    playerSessions.mockResolvedValue([PLAYER_SESSION]);
  });

  /** The recap row navigates, so the test checks the tap actually lands. */
  it("names the card for a recap, not a plan, and lands the tap on that session", async () => {
    const user = userEvent.setup();
    (goTo("/codex"), render)(<PlayerCodex token="player" />);
    // Players only see revealed (already played) sessions, so the card says "Latest recap".
    expect(screen.queryByRole("navigation", { name: "Next session" })).not.toBeInTheDocument();
    const card = within(await screen.findByRole("navigation", { name: "Latest recap" }));

    expect(card.getByText("Session 8")).toBeInTheDocument();
    expect(await screen.findByText("They reached the spire.")).toBeInTheDocument();

    await user.click(card.getByRole("button", { name: /Session 8/ }));
    expect(window.location.pathname).toBe("/codex/sessions/s8");
    const sidebar = within(screen.getByRole("navigation", { name: "Codex sections" }));
    expect(sidebar.getByRole("button", { name: "Story" })).toHaveAttribute("aria-current", "page");
  });

  /**
   * The player endpoint returns a GM-shaped row (what a regressed `projectPlayerSession` would send), so
   * the absence assertions are meaningful.
   */
  it("renders nothing from extra keys if the server ever regresses and sends a GM row", async () => {
    playerSessions.mockResolvedValue([
      {
        ...PLAYER_SESSION,
        prepBody: "The heart of the castle.",
        attendees: ["Ana", "Bo"],
        status: "planned",
        rev: 7,
        recapBody: "a GM-shaped duplicate of the recap"
      } as never
    ]);
    (goTo("/codex"), render)(<PlayerCodex token="player" />);

    const card = within(await screen.findByRole("navigation", { name: "Latest recap" }));
    expect(card.getByText("Session 8")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("The heart of the castle.");
    expect(text).not.toContain("Ana");
    expect(text).not.toContain("a GM-shaped duplicate of the recap");
  });
});

/** Uses the hook exactly as main.tsx does. */
function BadgeProbe({ token }: Readonly<{ token: string | null }>) {
  const badge = useRecapBadge(token);
  return (
    <button type="button" onClick={badge.markSeen}>
      Open Codex{badge.unread > 0 ? ` ${badge.unread} new` : ""}
    </button>
  );
}

describe("The recap badge keys on session ID", () => {
  const sessionRow = (id: string, sessionNumber: number): PlayerCodexSession => ({
    id,
    sessionNumber,
    realDate: null,
    recap: "…",
    tags: []
  });

  it("counts revealed sessions the reader has not opened, and forgets them once they have", async () => {
    playerSessions.mockResolvedValue([sessionRow("s1", 1), sessionRow("s2", 2)]);
    const user = userEvent.setup();
    render(<BadgeProbe token="player" />);

    const button = await screen.findByRole("button", { name: "Open Codex 2 new" });
    await user.click(button);
    expect(await screen.findByRole("button", { name: "Open Codex" })).toBeInTheDocument();
    // The seen set (ids, and no timestamp) is what persists.
    expect(JSON.parse(localStorage.getItem("codex-seen-sessions")!).sort()).toEqual(["s1", "s2"]);
  });

  it("stays quiet when the SAME sessions come back, and speaks up for a new id", async () => {
    // Revealing doesn't move `updatedAt` but editing prep does, so a recency badge would fire on GM
    // activity. Keyed on id, a refetch of the same records stays silent.
    playerSessions.mockResolvedValue([sessionRow("s1", 1)]);
    const user = userEvent.setup();
    render(<BadgeProbe token="player" />);
    await user.click(await screen.findByRole("button", { name: "Open Codex 1 new" }));
    await screen.findByRole("button", { name: "Open Codex" });

    // The GM edits prep and re-reveals; clients refetch the same ids.
    const refetch = (socket.on as unknown as { mock: { calls: [string, () => void][] } }).mock.calls.find(
      ([event]) => event === "codex:changed"
    )![1];
    playerSessions.mockResolvedValue([sessionRow("s1", 1)]);
    refetch();
    await waitFor(() => expect(playerSessions).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Open Codex" })).toBeInTheDocument();

    playerSessions.mockResolvedValue([sessionRow("s1", 1), sessionRow("s9", 9)]);
    refetch();
    expect(await screen.findByRole("button", { name: "Open Codex 1 new" })).toBeInTheDocument();
  });

  it("never reads sessions for a GM token, and shows nothing before the first list lands", () => {
    // Armed so a regression fails on the assertion and never on a TypeError. main.tsx passes null for the GM.
    playerSessions.mockResolvedValue([sessionRow("s1", 1)]);
    render(<BadgeProbe token={null} />);
    expect(screen.getByRole("button", { name: "Open Codex" })).toBeInTheDocument();
    expect(playerSessions).not.toHaveBeenCalled();
  });
});

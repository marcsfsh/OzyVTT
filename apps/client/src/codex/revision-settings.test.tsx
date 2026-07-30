import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const listRevisions = vi.fn();
const getSettings = vi.fn();
const setSettings = vi.fn();
const restoreRevision = vi.fn();
// The editor's Connections area reads this page's journal entries and atlas pins on mount. Neither is what
// this file is about, and an unstubbed read would put its own error Alert on screen beside the panel.
const markersForPage = vi.fn();
const forPage = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      listRevisions: (...a: unknown[]) => listRevisions(...a),
      restoreRevision: (...a: unknown[]) => restoreRevision(...a),
      getSettings: (...a: unknown[]) => getSettings(...a),
      setSettings: (...a: unknown[]) => setSettings(...a),
      markersForPage: (...a: unknown[]) => markersForPage(...a)
    },
    journalApi: { ...actual.journalApi, forPage: (...a: unknown[]) => forPage(...a) }
  };
});

import { PageEditor } from "./PageEditor";
import type { CodexPage, CodexPageRevision, CodexSettings } from "./api";

/**
 * OWNER DECISION (2026-07-30) — the GM's two controls over how much version history the codex keeps.
 *
 * WHY THIS EXISTS AT ALL. Every page save wrote a revision row, nothing pruned the table, and a revision row
 * weighs the same as a page row (both bodies). Measured while completing the export bundle: 200 pages × 15
 * revisions exported 20.8 MB against 1.24 MB without the history. So: history is switchable off, and its
 * frequency is configurable, defaulting to one version per 90 minutes.
 *
 * What these tests are actually defending:
 *  - **`0` is not `off`.** Zero minutes means "keep every save" — the old behaviour — and it is the single
 *    easiest thing to conflate with disabling history entirely. Asserted from both directions.
 *  - **Disabling never destroys.** With history off the existing versions must still be listed and still be
 *    restorable, because a GM turning a feature off has not asked to lose their only undo.
 *  - **The panel says the newest version can be behind the page.** With a window set, it normally is — and
 *    that is the one thing about this list which otherwise reads as a bug.
 *  - **The server's clamped answer wins**, not the number typed at the field, so the control cannot sit
 *    there showing a value the server did not store.
 */
const page: CodexPage = {
  id: "page-1", title: "Barovia", entityType: "location", fields: {}, gmFields: {},
  folder: null, tags: [], revealedToPlayers: false, bannerAssetId: null,
  inWorldLabel: null, calendarInstant: null, inWorldDate: null, rev: 3,
  createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z",
  playerBody: "Fog.", gmBody: ""
};
const REVISION = (over: Partial<CodexPageRevision> = {}): CodexPageRevision => ({
  id: 1, pageId: "page-1", rev: 1, title: "Barovia", playerBody: "Mist.", gmBody: "",
  bannerAssetId: null, tags: [], authoredAt: "2026-07-28T00:00:00.000Z", authorTag: "gm", ...over
});
const SETTINGS = (over: Partial<CodexSettings["revisionHistory"]> = {}): CodexSettings =>
  ({ revisionHistory: { enabled: true, windowMinutes: 90, ...over } });

const openHistory = async (settings: CodexSettings, revisions: CodexPageRevision[] = [REVISION()]) => {
  listRevisions.mockResolvedValue(revisions);
  getSettings.mockResolvedValue(settings);
  setSettings.mockImplementation((_token: string, next: CodexSettings) => Promise.resolve(next));
  render(<PageEditor gmToken="gm" page={page} pages={[page]} backlinks={[]} relationships={[]}
    onChange={() => {}} onDeleted={() => {}} onNavigate={() => {}} onRelationshipsChanged={() => {}} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "History" }));
  await waitFor(() => expect(getSettings).toHaveBeenCalledWith("gm"));
  return user;
};

beforeEach(() => {
  listRevisions.mockReset(); getSettings.mockReset(); setSettings.mockReset(); restoreRevision.mockReset();
  markersForPage.mockResolvedValue([]);
  forPage.mockResolvedValue([]);
});

describe("The GM can switch version history off (owner decision, 2026-07-30)", () => {
  it("offers the switch, and turning it off writes through to the server", async () => {
    const user = await openHistory(SETTINGS());
    const toggle = await screen.findByRole("switch", { name: "Keep version history" });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);

    await waitFor(() => expect(setSettings).toHaveBeenCalledWith("gm", { revisionHistory: { enabled: false, windowMinutes: 90 } }));
  });

  /**
   * Disabling stops WRITING; it must not destroy. A GM who turns a feature off has not asked to lose the
   * only undo the codex has, so the versions already taken stay listed and stay restorable.
   */
  it("keeps the existing versions listed and restorable while it is off", async () => {
    const user = await openHistory(SETTINGS({ enabled: false }), [REVISION({ id: 7, rev: 2, title: "Barovia, older" })]);

    expect(await screen.findByText(/New versions are not being saved/)).toBeInTheDocument();
    expect(screen.getByText(/can still be restored/)).toBeInTheDocument();
    // Listed...
    expect(screen.getByText("Barovia, older")).toBeInTheDocument();
    // ...and genuinely restorable, not merely displayed.
    restoreRevision.mockResolvedValue({ ...page, rev: 4 });
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(restoreRevision).toHaveBeenCalledWith("gm", "page-1", 7));
  });

  /** With history off there is no frequency to set, so the minutes field is not offered at all. */
  it("hides the frequency field while history is off", async () => {
    await openHistory(SETTINGS({ enabled: false }));
    await screen.findByText(/New versions are not being saved/);
    expect(screen.queryByLabelText(/Save a version at most once every/)).not.toBeInTheDocument();
  });
});

describe("The GM can set how often a version is kept", () => {
  it("shows the current window and writes a new one through to the server", async () => {
    const user = await openHistory(SETTINGS({ windowMinutes: 90 }));
    const field = await screen.findByLabelText(/Save a version at most once every/);
    expect(field).toHaveValue(90);

    await user.clear(field);
    await user.type(field, "30");

    await waitFor(() => expect(setSettings).toHaveBeenCalledWith("gm", { revisionHistory: { enabled: true, windowMinutes: 30 } }));
  });

  /**
   * The number the SERVER stored is what the field shows, not the number typed at it. The server clamps, so
   * a field that kept the typed value would sit there claiming a setting the codex does not have.
   */
  it("shows the server's clamped answer rather than what was typed", async () => {
    const user = await openHistory(SETTINGS({ windowMinutes: 90 }));
    // The two must DISAGREE, or the assertion cannot tell them apart. Typing an over-range number is no
    // good: the field clamps it client-side to the same value the server would, so the optimistic value and
    // the server's answer coincide and the test passes with the server's answer thrown away. So: type an
    // in-range 45 and have the server answer 60 — a number the client would never compute on its own.
    setSettings.mockResolvedValue(SETTINGS({ windowMinutes: 60 }));
    const field = await screen.findByLabelText(/Save a version at most once every/);

    await user.clear(field);
    await user.type(field, "45");

    await waitFor(() => expect(field).toHaveValue(60));
  });

  /** And the client still refuses out-of-range input up front, rather than posting it for a 400. */
  it("clamps an out-of-range window before asking the server for it", async () => {
    const user = await openHistory(SETTINGS({ windowMinutes: 90 }));
    const field = await screen.findByLabelText(/Save a version at most once every/);

    await user.clear(field);
    await user.type(field, "99999");

    await waitFor(() => expect(setSettings).toHaveBeenLastCalledWith("gm", { revisionHistory: { enabled: true, windowMinutes: 10_080 } }));
  });

  /**
   * **Zero is not off.** It means "keep every save", which is what the codex did before this existed, and
   * conflating the two is the one mistake that would quietly bring the 20 MB export back.
   */
  it("treats 0 as keep-every-save, with history still on", async () => {
    await openHistory(SETTINGS({ windowMinutes: 0 }));

    expect(await screen.findByRole("switch", { name: "Keep version history" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText(/Save a version at most once every/)).toHaveValue(0);
    // ...and no "the newest version can be behind" note, because at 0 it never is.
    expect(screen.queryByText(/minutes behind it/)).not.toBeInTheDocument();
    expect(screen.queryByText(/New versions are not being saved/)).not.toBeInTheDocument();
  });

  /**
   * With a window set, the newest version is normally BEHIND the page as it stands — the one thing about
   * this list that would otherwise read as a bug. The note names the actual window, so it stays true when
   * the GM changes it.
   */
  it("says how far behind the newest version can be, naming the window in force", async () => {
    await openHistory(SETTINGS({ windowMinutes: 45 }));
    expect(await screen.findByText(/up to 45 minutes behind it/)).toBeInTheDocument();
  });

  /** Codex-wide, on a per-page panel — so it has to say so, or it reads as a setting for this page. */
  it("says out loud that the settings are codex-wide", async () => {
    await openHistory(SETTINGS());
    expect(await screen.findByText("Applies to every page in the codex.")).toBeInTheDocument();
  });
});

describe("A broken settings read does not take the history panel with it", () => {
  it("still lists the versions when the settings cannot be read", async () => {
    listRevisions.mockResolvedValue([REVISION({ title: "Barovia, older" })]);
    getSettings.mockRejectedValue(new Error("nope"));
    render(<PageEditor gmToken="gm" page={page} pages={[page]} backlinks={[]} relationships={[]}
      onChange={() => {}} onDeleted={() => {}} onNavigate={() => {}} onRelationshipsChanged={() => {}} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "History" }));

    // The list is the point of this panel; the settings are an addition to it.
    expect(await screen.findByText("Barovia, older")).toBeInTheDocument();
    // And it claims no setting it could not read — a switch defaulted to "on" here would be a guess
    // presented as the codex's state.
    expect(screen.queryByRole("switch", { name: "Keep version history" })).not.toBeInTheDocument();
  });

  it("says a setting failed to save rather than showing it as applied", async () => {
    const user = await openHistory(SETTINGS());
    setSettings.mockRejectedValue(new Error("nope"));
    getSettings.mockResolvedValue(SETTINGS());

    await user.click(await screen.findByRole("switch", { name: "Keep version history" }));

    expect(await screen.findByText("That setting could not be saved.")).toBeInTheDocument();
    // Re-read, so the panel shows what the codex actually holds rather than the failed optimistic value.
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("switch", { name: "Keep version history" })).toHaveAttribute("aria-checked", "true"));
  });
});

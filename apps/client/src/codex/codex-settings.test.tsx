import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const getSettings = vi.fn();
const setSettings = vi.fn();
const deleteRevisions = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      getSettings: (...a: unknown[]) => getSettings(...a),
      setSettings: (...a: unknown[]) => setSettings(...a),
      deleteRevisions: (...a: unknown[]) => deleteRevisions(...a)
    }
  };
});

import { CodexSettingsView } from "./CodexSettings";
import type { CodexSettings } from "./api";

/**
 * OWNER DECISIONS (2026-07-30) — the codex-wide settings screen, and the GM's control over version history.
 *
 * WHY ANY OF THIS EXISTS. Completing the export bundle showed `codex_page_revisions` is unbounded: every page
 * save writes a row, nothing prunes, and a revision row weighs the same as a page row (both bodies). Worse
 * than "per save" implies — the editor autosaves on an 800ms debounce, so a version is written on every pause
 * in typing and an hour of writing produces hundreds of rows for one page. Measured at a deliberately
 * conservative 15 revisions per page, the export went from 1.24 MB to 20.8 MB.
 *
 * The owner asked for three things, and each has a test group below: history switchable off, its frequency
 * configurable (default 90 minutes), and a way to delete history that already exists.
 *
 * What these tests are really defending, stated so a later reader does not soften it:
 *  - **`0` minutes is not `off`.** Zero means "keep every save" — the old behaviour — and it is the single
 *    easiest thing to conflate with disabling history. Asserted from both directions.
 *  - **Disabling never destroys.** Turning history off stops writing; it must not touch what exists.
 *  - **Deleting everything is not reachable by winding a number down.** The day field and the delete-all
 *    button are separate controls with separate confirms, because they are different decisions and one of
 *    them is unrecoverable. A confirm that names the real count is asserted for the same reason: "this cannot
 *    be undone" over an unknown number is a warning a GM learns to click through.
 *  - **The server's answer wins** over the number typed at a field, so no control can sit there claiming a
 *    setting the codex does not hold.
 */
const SETTINGS = (over: Partial<CodexSettings["revisionHistory"]> = {}): CodexSettings =>
  ({ revisionHistory: { enabled: true, windowMinutes: 90, versionCount: 1412, versionBytes: 8_400_000, ...over } });

const open = async (settings: CodexSettings) => {
  getSettings.mockResolvedValue(settings);
  setSettings.mockImplementation((_t: string, input: { revisionHistory: { enabled: boolean; windowMinutes: number } }) =>
    Promise.resolve({ revisionHistory: { ...settings.revisionHistory, ...input.revisionHistory } }));
  render(<CodexSettingsView gmToken="gm" onClose={vi.fn()} />);
  await waitFor(() => expect(getSettings).toHaveBeenCalledWith("gm"));
  return userEvent.setup();
};

beforeEach(() => { getSettings.mockReset(); setSettings.mockReset(); deleteRevisions.mockReset(); });

describe("Version history can be switched off (owner decision, 2026-07-30)", () => {
  it("writes the switch through to the server", async () => {
    const user = await open(SETTINGS());
    const toggle = await screen.findByRole("switch", { name: "Keep version history" });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);

    await waitFor(() => expect(setSettings).toHaveBeenCalledWith("gm", { revisionHistory: { enabled: false, windowMinutes: 90 } }));
  });

  /**
   * Turning it off stops WRITING and nothing else. A GM switching a feature off has not asked to lose the
   * only undo the codex has, and the copy has to say where the kept versions went.
   */
  it("says the existing versions are kept and still restorable", async () => {
    await open(SETTINGS({ enabled: false }));
    expect(await screen.findByText(/New versions are not being saved/)).toBeInTheDocument();
    expect(screen.getByText(/can still be restored from a page's History/)).toBeInTheDocument();
  });

  /** With history off there is no frequency to set, so the field is not offered at all. */
  it("hides the frequency field while history is off", async () => {
    await open(SETTINGS({ enabled: false }));
    await screen.findByText(/New versions are not being saved/);
    expect(screen.queryByLabelText(/Save a version at most once every/)).not.toBeInTheDocument();
  });
});

describe("How often a version is kept is configurable", () => {
  it("shows the window in force and writes a new one through", async () => {
    const user = await open(SETTINGS({ windowMinutes: 90 }));
    const field = await screen.findByLabelText(/Save a version at most once every/);
    expect(field).toHaveValue(90);

    await user.clear(field);
    await user.type(field, "30");

    await waitFor(() => expect(setSettings).toHaveBeenCalledWith("gm", { revisionHistory: { enabled: true, windowMinutes: 30 } }));
  });

  /**
   * The number the SERVER stored is what the field shows. The two must DISAGREE for this to prove anything —
   * typing an over-range value is no good, because the field bounds it client-side to the same number the
   * server enforces, and the assertion then passes with the server's answer thrown away. So: type an in-range
   * 45 and have the server answer 60, which the client would never compute on its own.
   *
   * They can differ for real: measured against the live route, the server TRUNCATES a fractional value
   * (45.7 stores 45) and REJECTS an out-of-range one with a 400 — which is why the client bounds first.
   */
  it("shows the server's answer rather than what was typed", async () => {
    const user = await open(SETTINGS({ windowMinutes: 90 }));
    setSettings.mockResolvedValue(SETTINGS({ windowMinutes: 60 }));
    const field = await screen.findByLabelText(/Save a version at most once every/);

    await user.clear(field);
    await user.type(field, "45");

    await waitFor(() => expect(field).toHaveValue(60));
  });

  /** And the client still refuses out-of-range input up front rather than posting it for a 400. */
  it("bounds an out-of-range window before asking the server for it — the server 400s on it", async () => {
    const user = await open(SETTINGS({ windowMinutes: 90 }));
    const field = await screen.findByLabelText(/Save a version at most once every/);

    await user.clear(field);
    await user.type(field, "99999");

    await waitFor(() => expect(setSettings).toHaveBeenLastCalledWith("gm", { revisionHistory: { enabled: true, windowMinutes: 10_080 } }));
  });

  /**
   * **Zero is not off.** It means "keep every save", which is what the codex did before any of this existed,
   * and conflating the two is the one mistake that would quietly bring the 20 MB export back.
   */
  it("treats 0 as keep-every-save, with history still on", async () => {
    await open(SETTINGS({ windowMinutes: 0 }));

    expect(await screen.findByRole("switch", { name: "Keep version history" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText(/Save a version at most once every/)).toHaveValue(0);
    // ...and no "behind the page" note, because at 0 it never is.
    expect(screen.queryByText(/minutes behind it/)).not.toBeInTheDocument();
    expect(screen.queryByText(/New versions are not being saved/)).not.toBeInTheDocument();
  });

  /**
   * With a window set, the newest saved version is normally BEHIND the page as it stands — the one thing
   * about a page's History list that would otherwise read as a bug. The note names the window in force, so
   * it stays true when the GM changes it.
   */
  it("says how far behind the newest version can be, naming the window in force", async () => {
    await open(SETTINGS({ windowMinutes: 45 }));
    expect(await screen.findByText(/up to 45 minutes behind it/)).toBeInTheDocument();
  });
});

describe("Existing history can be deleted (owner decision, 2026-07-30)", () => {
  it("reports what the history currently costs, so trimming is a decision and not a guess", async () => {
    await open(SETTINGS());
    // The count is what makes the confirm below readable, and the size is what answers "is this worth it?".
    expect(await screen.findByText("1,412 saved versions")).toBeInTheDocument();
    expect(screen.getByText(/about 8\.0 MB of text/)).toBeInTheDocument();
  });

  it("deletes older than the chosen number of days, after a confirm naming what goes", async () => {
    const user = await open(SETTINGS());
    deleteRevisions.mockResolvedValue({ deleted: 1200 });

    await user.click(await screen.findByRole("button", { name: /Delete versions older than 30 days/ }));
    // The confirm says what is lost AND what is not — a GM must not have to wonder whether this eats pages.
    expect(await screen.findByText(/older than 30 days, across every page/)).toBeInTheDocument();
    expect(screen.getByText(/pages themselves are not touched/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete them" }));

    await waitFor(() => expect(deleteRevisions).toHaveBeenCalledWith("gm", 30));
    expect(await screen.findByText("Deleted 1,200 saved versions.")).toBeInTheDocument();
    // Re-read, so the count on screen is the codex's and not the one from before the delete.
    expect(getSettings).toHaveBeenCalledTimes(2);
  });

  /**
   * Delete-all is its OWN button and its own confirm, and it names the real count. Winding the day field
   * down must never be a route to it: the two are different decisions and one of them is unrecoverable.
   */
  it("deletes everything only from its own button, with the real count in the confirm", async () => {
    const user = await open(SETTINGS());
    deleteRevisions.mockResolvedValue({ deleted: 1412 });

    await user.click(await screen.findByRole("button", { name: "Delete all version history" }));
    expect(await screen.findByText(/Delete all 1,412 saved versions across every page/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete all versions" }));

    // 0 days: nothing is younger than zero days old, so this is arithmetic rather than a magic value.
    await waitFor(() => expect(deleteRevisions).toHaveBeenCalledWith("gm", 0));
  });

  it("cannot delete everything by winding the day field down", async () => {
    const user = await open(SETTINGS());
    const field = await screen.findByLabelText(/Delete versions older than/);

    await user.clear(field);
    await user.type(field, "0");

    // The day field floors at 1. Reaching zero is the other button's job, behind the other confirm.
    expect(screen.getByRole("button", { name: /Delete versions older than 1 day$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /older than 0 day/ })).not.toBeInTheDocument();
  });

  it("deletes nothing when the confirm is declined", async () => {
    const user = await open(SETTINGS());

    await user.click(await screen.findByRole("button", { name: "Delete all version history" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(deleteRevisions).not.toHaveBeenCalled();
  });

  /** Nothing to delete, nothing to offer — a button that would delete zero rows is a button that lies. */
  it("offers neither delete while there is no history at all", async () => {
    await open(SETTINGS({ versionCount: 0, versionBytes: 0 }));
    await screen.findByText("0 saved versions");
    expect(screen.getByRole("button", { name: /Delete versions older than/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete all version history" })).toBeDisabled();
  });
});

describe("The screen never claims a setting it could not read", () => {
  it("says the read failed instead of rendering a guessed default", async () => {
    getSettings.mockRejectedValue(new Error("The codex request failed (500)."));
    render(<CodexSettingsView gmToken="gm" onClose={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("The codex request failed (500).");
    // A switch defaulted to "on" here would be a guess presented as the codex's state (the CF-2 lesson).
    expect(screen.queryByRole("switch", { name: "Keep version history" })).not.toBeInTheDocument();
  });

  it("says a setting failed to save, and re-reads rather than showing it as applied", async () => {
    const user = await open(SETTINGS());
    setSettings.mockRejectedValue(new Error("The codex request failed (500)."));

    await user.click(await screen.findByRole("switch", { name: "Keep version history" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The codex request failed (500).");
    await waitFor(() => expect(screen.getByRole("switch", { name: "Keep version history" })).toHaveAttribute("aria-checked", "true"));
  });
});

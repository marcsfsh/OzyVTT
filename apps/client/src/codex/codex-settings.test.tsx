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
 * The codex settings screen. `0` minutes means keep every save, not off; turning history off never deletes
 * anything; delete-all is its own button and confirm (naming the real count), never reached by winding the
 * day field down; and the server's stored answer is what the controls show.
 */
const SETTINGS = (over: Partial<CodexSettings["revisionHistory"]> = {}): CodexSettings =>
  ({ autosave: { enabled: true, intervalSeconds: 1 }, revisionHistory: { enabled: true, windowMinutes: 90, versionCount: 1412, versionBytes: 8_400_000, ...over } });

const open = async (settings: CodexSettings) => {
  getSettings.mockResolvedValue(settings);
  // The PUT is wholesale: both groups travel on every write.
  setSettings.mockImplementation((_t: string, input: { revisionHistory: { enabled: boolean; windowMinutes: number }; autosave: { enabled: boolean; intervalSeconds: number } }) =>
    Promise.resolve({ revisionHistory: { ...settings.revisionHistory, ...input.revisionHistory }, autosave: { ...settings.autosave, ...input.autosave } }));
  render(<CodexSettingsView gmToken="gm" />);
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

    await waitFor(() => expect(setSettings).toHaveBeenCalledWith("gm", { autosave: { enabled: true, intervalSeconds: 1 }, revisionHistory: { enabled: false, windowMinutes: 90 } }));
  });

  /** Turning history off stops writing only, and the copy says the kept versions remain restorable. */
  it("says the existing versions are kept and still restorable", async () => {
    await open(SETTINGS({ enabled: false }));
    expect(await screen.findByText(/New versions are not being saved/)).toBeInTheDocument();
    expect(screen.getByText(/can still be restored from a page's History/)).toBeInTheDocument();
  });

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

    await waitFor(() => expect(setSettings).toHaveBeenCalledWith("gm", { autosave: { enabled: true, intervalSeconds: 1 }, revisionHistory: { enabled: true, windowMinutes: 30 } }));
  });

  /**
   * The server's stored value wins. Type 45 and answer 60, a value the client would never compute (an
   * out-of-range value would be clamped to the same number client-side and prove nothing).
   */
  it("shows the server's answer rather than what was typed", async () => {
    const user = await open(SETTINGS({ windowMinutes: 90 }));
    setSettings.mockResolvedValue(SETTINGS({ windowMinutes: 60 }));
    const field = await screen.findByLabelText(/Save a version at most once every/);

    await user.clear(field);
    await user.type(field, "45");

    await waitFor(() => expect(field).toHaveValue(60));
  });

  /** Out-of-range input is bounded before posting, since the server answers 400. */
  it("bounds an out-of-range window before asking the server for it — the server 400s on it", async () => {
    const user = await open(SETTINGS({ windowMinutes: 90 }));
    const field = await screen.findByLabelText(/Save a version at most once every/);

    await user.clear(field);
    await user.type(field, "99999");

    await waitFor(() => expect(setSettings).toHaveBeenLastCalledWith("gm", { autosave: { enabled: true, intervalSeconds: 1 }, revisionHistory: { enabled: true, windowMinutes: 10_080 } }));
  });

  /** Zero is "keep every save", not off. */
  it("treats 0 as keep-every-save, with history still on", async () => {
    await open(SETTINGS({ windowMinutes: 0 }));

    expect(await screen.findByRole("switch", { name: "Keep version history" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText(/Save a version at most once every/)).toHaveValue(0);
    // At 0 the newest version is never behind the page.
    expect(screen.queryByText(/minutes behind it/)).not.toBeInTheDocument();
    expect(screen.queryByText(/New versions are not being saved/)).not.toBeInTheDocument();
  });

  /** With a window set, the newest version can lag the page; the note names the window in force. */
  it("says how far behind the newest version can be, naming the window in force", async () => {
    await open(SETTINGS({ windowMinutes: 45 }));
    expect(await screen.findByText(/up to 45 minutes behind it/)).toBeInTheDocument();
  });
});

describe("Existing history can be deleted (owner decision, 2026-07-30)", () => {
  it("reports what the history currently costs, so trimming is a decision and not a guess", async () => {
    await open(SETTINGS());
    expect(await screen.findByText("1,412 saved versions")).toBeInTheDocument();
    expect(screen.getByText(/about 8\.0 MB of text/)).toBeInTheDocument();
  });

  it("deletes older than the chosen number of days, after a confirm naming what goes", async () => {
    const user = await open(SETTINGS());
    deleteRevisions.mockResolvedValue({ deleted: 1200 });

    await user.click(await screen.findByRole("button", { name: /Delete versions older than 30 days/ }));
    // The confirm says what is lost and what is not.
    expect(await screen.findByText(/older than 30 days, across every page/)).toBeInTheDocument();
    expect(screen.getByText("Delete saved versions older than 30 days, across every page? Your pages are not changed. Only the earlier versions are deleted. This cannot be undone.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete them" }));

    await waitFor(() => expect(deleteRevisions).toHaveBeenCalledWith("gm", 30));
    expect(await screen.findByText("Deleted 1,200 saved versions.")).toBeInTheDocument();
    // Re-read so the count is the codex's.
    expect(getSettings).toHaveBeenCalledTimes(2);
  });

  it("deletes everything only from its own button, with the real count in the confirm", async () => {
    const user = await open(SETTINGS());
    deleteRevisions.mockResolvedValue({ deleted: 1412 });

    await user.click(await screen.findByRole("button", { name: "Delete all version history" }));
    expect(await screen.findByText(/Delete all 1,412 saved versions across every page/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete all versions" }));

    // `olderThanDays: 0` deletes everything.
    await waitFor(() => expect(deleteRevisions).toHaveBeenCalledWith("gm", 0));
  });

  it("cannot delete everything by winding the day field down", async () => {
    const user = await open(SETTINGS());
    const field = await screen.findByLabelText(/Delete versions older than/);

    await user.clear(field);
    await user.type(field, "0");

    // The day field floors at 1.
    expect(screen.getByRole("button", { name: /Delete versions older than 1 day$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /older than 0 day/ })).not.toBeInTheDocument();
  });

  it("deletes nothing when the confirm is declined", async () => {
    const user = await open(SETTINGS());

    await user.click(await screen.findByRole("button", { name: "Delete all version history" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(deleteRevisions).not.toHaveBeenCalled();
  });

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
    render(<CodexSettingsView gmToken="gm" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("The codex request failed (500).");
    // Don't show a guessed default before the settings load.
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

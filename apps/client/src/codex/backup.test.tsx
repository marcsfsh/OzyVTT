import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const exportBundle = vi.fn();
const importBundle = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      exportBundle: (...a: unknown[]) => exportBundle(...a),
      importBundle: (...a: unknown[]) => importBundle(...a)
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { BackupView } from "./BackupView";
import { ApiError } from "../lib/api";

/**
 * The restore confirm, tested as a safety device: every section is listed with a count (a missing one is
 * 0), plurals are real words, and the server's refusal is quoted rather than paraphrased.
 */

/** A File whose `.text()` resolves; jsdom lacks the reader. */
function bundleFile(name: string, body: unknown): File {
  const file = new File([JSON.stringify(body)], name, { type: "application/json" });
  Object.defineProperty(file, "text", { value: () => Promise.resolve(JSON.stringify(body)) });
  return file;
}

const renderBackup = () => {
  const onChanged = vi.fn();
  render(
    <ToastProvider>
      <BackupView gmToken="gm" onChanged={onChanged} />
    </ToastProvider>
  );
  return { onChanged };
};

/** Choose a file through the hidden input behind "Choose a backup file". */
async function choose(user: ReturnType<typeof userEvent.setup>, file: File) {
  const input = document.querySelector('input[type="file"][accept="application/json,.json"]') as HTMLInputElement;
  await user.upload(input, file);
}

describe("The restore confirmation states what the file holds (D16)", () => {
  it("counts every section, including the ones the file does not contain", async () => {
    const user = userEvent.setup();
    renderBackup();
    // Pages only: restoring this deletes every map, pin, journal entry, session and quest.
    await choose(user, bundleFile("partial.json", { codex: { pages: [{ id: "p1" }, { id: "p2" }] } }));

    const dialog = await screen.findByRole("dialog", { name: "Restore this backup?" });
    expect(dialog).toHaveTextContent(
      "That file contains 2 pages, 0 maps, 0 pins, 0 journal entries, 0 sessions, 0 quests."
    );
  });

  it("says 'journal entries', not 'journal entrys'", async () => {
    const user = userEvent.setup();
    renderBackup();
    await choose(
      user,
      bundleFile("full.json", {
        codex: { pages: [], maps: [], markers: [], journal: [{ id: "j1" }, { id: "j2" }], sessions: [], quests: [] }
      })
    );

    const dialog = await screen.findByRole("dialog", { name: "Restore this backup?" });
    expect(dialog).toHaveTextContent("2 journal entries");
    expect(dialog.textContent).not.toMatch(/entrys/);
  });

  it("uses the singular for exactly one, and the plural for zero", async () => {
    const user = userEvent.setup();
    renderBackup();
    await choose(
      user,
      bundleFile("one.json", { codex: { pages: [{ id: "p1" }], journal: [{ id: "j1" }], markers: [] } })
    );

    const dialog = await screen.findByRole("dialog", { name: "Restore this backup?" });
    expect(dialog).toHaveTextContent("1 page, 0 maps, 0 pins, 1 journal entry, 0 sessions, 0 quests");
  });

  it("names the file and does not restore until the GM says so", async () => {
    const user = userEvent.setup();
    renderBackup();
    await choose(user, bundleFile("golden-bundle.json", { codex: { pages: [] } }));

    const dialog = await screen.findByRole("dialog", { name: "Restore this backup?" });
    expect(dialog).toHaveTextContent("golden-bundle.json");
    expect(importBundle).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Restore this backup?" })).not.toBeInTheDocument());
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("sends the file's own bytes, with a freshly minted commandId", async () => {
    const user = userEvent.setup();
    importBundle.mockResolvedValue({ counts: { pages: 1, journal: 0, maps: 0 } });
    const { onChanged } = renderBackup();
    await choose(
      user,
      bundleFile("b.json", {
        codex: { pages: [{ id: "p1" }] },
        exportedAt: "2026-07-30T00:00:00.000Z",
        bundleVersion: 1
      })
    );

    await screen.findByRole("dialog", { name: "Restore this backup?" });
    await user.click(screen.getByRole("button", { name: "Replace everything" }));

    await waitFor(() => expect(importBundle).toHaveBeenCalledTimes(1));
    const [, sent] = importBundle.mock.calls[0] as [
      string,
      { codex: unknown; exportedAt?: string; bundleVersion?: number; commandId: string }
    ];
    expect(sent.codex).toEqual({ pages: [{ id: "p1" }] });
    expect(sent.exportedAt).toBe("2026-07-30T00:00:00.000Z");
    expect(sent.bundleVersion).toBe(1);
    expect(sent.commandId).toBeTruthy();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("quotes the server's refusal verbatim, because it names the section and the row", async () => {
    const user = userEvent.setup();
    importBundle.mockRejectedValue(
      new ApiError('That backup\'s "pages" entry 37 is not valid: Codex id is malformed.', 400, "validation_failed")
    );
    renderBackup();
    await choose(user, bundleFile("bad.json", { codex: { pages: [{ id: "!" }] } }));
    await screen.findByRole("dialog", { name: "Restore this backup?" });
    await user.click(screen.getByRole("button", { name: "Replace everything" }));

    expect(
      await screen.findByText('That backup\'s "pages" entry 37 is not valid: Codex id is malformed.')
    ).toBeInTheDocument();
  });

  it("refuses a file that is not a backup at all, without opening the dialog", async () => {
    const user = userEvent.setup();
    renderBackup();
    await choose(user, bundleFile("holiday-photos.json", { some: "other thing" }));

    expect(await screen.findByText("That file isn't a Codex backup.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Restore this backup?" })).not.toBeInTheDocument();
  });
});

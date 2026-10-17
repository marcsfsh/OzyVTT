import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
// Reference reads (classes, spells) never answer here; nothing under test waits on them.
vi.mock("../lib/command", () => ({ command: vi.fn(), read: () => new Promise(() => {}) }));

/** The server's copy of one feat, with its revision. A save may be held, the way a slow network holds it. */
const server = vi.hoisted(() => ({
  rev: 1,
  record: {} as Record<string, unknown>,
  held: null as Promise<void> | null,
  saves: [] as Array<{ record: Record<string, unknown>; expectedRev: number | undefined }>
}));

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  const { ApiError } = await import("../lib/api");
  const document = () => ({
    id: "hb-lucky-charm",
    type: "feat",
    state: "draft",
    visibleToPlayers: false,
    deletedAt: null,
    pendingChanges: false,
    rev: server.rev,
    updatedAt: "2026-10-17T00:00:00.000Z",
    validity: { valid: true, issues: [], warnings: [] },
    record: structuredClone(server.record)
  });
  const list = async () => ({
    records: [
      {
        id: "hb-lucky-charm",
        type: "feat",
        name: String(server.record.name),
        source: "homebrew",
        state: "draft",
        visibleToPlayers: false,
        deletedAt: null,
        rev: server.rev,
        updatedAt: "2026-10-17T00:00:00.000Z",
        valid: true,
        usageCount: 0
      }
    ],
    nextCursor: null,
    total: 1
  });
  return {
    ...actual,
    listAllHomebrew: async () => (await list()).records,
    homebrewApi: {
      ...actual.homebrewApi,
      list,
      get: async () => document(),
      update: async (_token: string, _id: string, record: Record<string, unknown>, expectedRev?: number) => {
        if (server.held) await server.held;
        server.saves.push({ record, expectedRev });
        if (expectedRev !== undefined && expectedRev !== server.rev)
          throw new ApiError("Someone else changed this record.", 409, "conflict", server.rev);
        server.rev += 1;
        server.record = structuredClone(record);
        return document();
      }
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { blankDraft } from "./defaults";
import { HomebrewPanel } from "./HomebrewPanel";
import { keepLocalEdits } from "./useAutosave";

// A record reopened while its last edit is still saving opens on the saved copy, and answers given before a conflict are
// kept when the editor reloads the server's copy. Before, the reopened editor started from the copy without the last
// edit, its next save was refused as a conflict, and Reload replaced the whole draft: two answers were lost that way.

beforeEach(() => {
  server.rev = 1;
  server.record = { ...blankDraft("feat"), name: "Lucky Charm", category: "general" };
  server.held = null;
  server.saves = [];
});

/** The Basics section's fields come first in the editor. */
const field = (name: string) => screen.getAllByRole("textbox", { name })[0]!;
const row = () => within(screen.getByRole("navigation", { name: "Homebrew records" })).getByRole("button");

describe("a homebrew record reopened while it saves", () => {
  it("keeps the edit that was saving and the answers given after it", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <HomebrewPanel gmToken="gm" />
      </ToastProvider>
    );
    await user.click(await waitFor(row));
    const name = (await screen.findAllByRole("textbox", { name: "Name" }))[0]!;
    await user.clear(name);
    await user.type(name, "Lucky Star");

    // The network holds the save the closing editor sends, and the record is opened again meanwhile.
    let release = () => {};
    server.held = new Promise<void>((resolve) => (release = resolve));
    await user.click(row());
    release();
    server.held = null;

    // Two answers in the reopened editor.
    await waitFor(() => expect(field("Name")).toHaveValue("Lucky Star"));
    await user.type(field("Summary"), "Once a day");
    await user.type(field("Description"), "Reroll one die.");

    // The reopened editor started from the saved copy, so its answers save without a conflict.
    await waitFor(
      () =>
        expect(server.record).toMatchObject({
          name: "Lucky Star",
          summary: "Once a day",
          description: "Reroll one die."
        }),
      { timeout: 4000 }
    );
    expect(server.saves.map((save) => save.expectedRev)).toEqual([1, 2]);
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("keeps the answers given here when it reloads the copy another editor changed", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <HomebrewPanel gmToken="gm" />
      </ToastProvider>
    );
    await user.click(await waitFor(row));
    await screen.findAllByRole("textbox", { name: "Summary" });
    // Another tab renames the feat.
    server.record = { ...server.record, name: "Lucky Star" };
    server.rev = 2;
    await user.type(field("Summary"), "Once a day");
    await user.type(field("Description"), "Reroll one die.");
    await user.click(await screen.findByRole("button", { name: "Reload" }, { timeout: 4000 }));
    // The other tab's name and both answers given here, saved over the other tab's revision.
    expect(field("Name")).toHaveValue("Lucky Star");
    expect(field("Summary")).toHaveValue("Once a day");
    expect(field("Description")).toHaveValue("Reroll one die.");
    await waitFor(
      () =>
        expect(server.record).toMatchObject({
          name: "Lucky Star",
          summary: "Once a day",
          description: "Reroll one die."
        }),
      { timeout: 4000 }
    );
  });
});

describe("keeping local edits over a reloaded copy", () => {
  it("takes the server's copy, with each field changed here since the last save kept as it is here", () => {
    const base = { name: "Lucky Charm", summary: "", description: "", tags: ["luck"] };
    const local = { name: "Lucky Charm", summary: "Once a day", description: "", tags: [] };
    const server = { name: "Lucky Star", summary: "", description: "Reroll one die.", tags: ["luck"] };
    expect(keepLocalEdits(base, local, server)).toEqual({
      name: "Lucky Star",
      summary: "Once a day",
      description: "Reroll one die.",
      tags: []
    });
  });
});

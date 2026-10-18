import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
// Reference reads (classes, spells) never answer here; nothing under test waits on them.
vi.mock("../../lib/command", () => ({ command: vi.fn(), read: () => new Promise(() => {}) }));

/** The server's copy of one feat, with its revision. A save may be held, the way a slow network holds it. */
const server = vi.hoisted(() => ({
  rev: 1,
  record: {} as Record<string, unknown>,
  held: null as Promise<void> | null,
  saves: [] as Array<{ record: Record<string, unknown>; expectedRev: number | undefined }>
}));

vi.mock("../../homebrew/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../homebrew/api")>();
  const { ApiError } = await import("../../lib/api");
  const at = "2026-10-17T00:00:00.000Z";
  const row = () => ({
    id: "hb-lucky-charm",
    type: "feat",
    name: String(server.record.name),
    source: "homebrew",
    state: "draft",
    audience: "hidden",
    characterIds: [],
    visibleToPlayers: false,
    packId: "table",
    packName: null,
    inCatalogs: false,
    deletedAt: null,
    rev: server.rev,
    createdAt: at,
    updatedAt: at,
    valid: true,
    pendingChanges: false,
    issueCount: 0,
    basedOn: null,
    usageCount: 0,
    columns: {}
  });
  const document = () => ({
    id: "hb-lucky-charm",
    type: "feat",
    state: "draft",
    audience: "hidden",
    characterIds: [],
    reveals: [],
    visibleToPlayers: false,
    packId: "table",
    packName: null,
    inCatalogs: false,
    basedOn: null,
    references: {},
    deletedAt: null,
    rev: server.rev,
    createdAt: at,
    updatedAt: at,
    validity: { valid: true, issues: [], warnings: [] },
    pendingChanges: false,
    record: structuredClone(server.record)
  });
  return {
    ...actual,
    listAllHomebrew: async () => [row()],
    homebrewApi: {
      ...actual.homebrewApi,
      table: async (_token: string, kind: string) => ({
        kind,
        rows: kind === "feat" ? [{ ...row(), kind: "feat", archived: false, source: "homebrew", usageCount: 0 }] : []
      }),
      packs: async () => ({ srd: { records: 0 }, packs: [] }),
      get: async () => document(),
      update: async (_token: string, _id: string, record: Record<string, unknown>, expectedRev?: number) => {
        if (server.held) await server.held;
        server.saves.push({ record, expectedRev });
        if (expectedRev !== undefined && expectedRev !== server.rev)
          throw new ApiError("Someone else changed this record.", 409, "conflict", server.rev, {
            conflict: {
              baseRev: expectedRev,
              currentRev: server.rev,
              baseKnown: true,
              changes: [{ field: "name", base: "Lucky Charm", current: server.record.name }],
              rowChanges: []
            }
          });
        server.rev += 1;
        server.record = structuredClone(record);
        return document();
      }
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { blankDraft } from "../../homebrew/defaults";
import { navigate } from "../../router";
import { CompendiumShell } from "../CompendiumShell";
import { resetCompendiumData } from "../data";

// A record reopened while its last edit is still saving opens on the saved copy, and answers given before a conflict
// are kept beside the other device's. Before, the reopened editor started from the copy without the last edit, its next
// save was refused as a conflict, and Reload replaced the whole draft: two answers were lost that way.

const RECORD = "/compendium/feats/hb-lucky-charm?tab=edit";

beforeEach(async () => {
  server.rev = 1;
  server.record = { ...blankDraft("feat"), name: "Lucky Charm", category: "general" };
  server.held = null;
  server.saves = [];
  resetCompendiumData();
  await navigate(RECORD);
});

const field = (name: string) => screen.getByRole("textbox", { name });

function mount() {
  render(
    <ToastProvider>
      <CompendiumShell token="gm" party={[]} />
    </ToastProvider>
  );
}

describe("a homebrew record reopened while it saves", () => {
  it("keeps the edit that was saving and the answers given after it", async () => {
    const user = userEvent.setup();
    mount();
    const name = await screen.findByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Lucky Star");

    // The network holds the save the closing editor sends, and the record is opened again meanwhile.
    let release = () => {};
    server.held = new Promise<void>((resolve) => (release = resolve));
    await navigate("/compendium/tables/feats");
    await navigate(RECORD);
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
    expect(screen.queryByRole("region", { name: "Changed on two devices" })).toBeNull();
  });

  it("keeps both devices' changes when a save meets the copy another device changed", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("textbox", { name: "Summary" });
    // Another device renames the feat.
    server.record = { ...server.record, name: "Lucky Star" };
    server.rev = 2;
    await user.type(field("Summary"), "Once a day");
    await user.type(field("Description"), "Reroll one die.");

    // The merge lists each field either device changed, and keeps both by default.
    const merge = await screen.findByRole("region", { name: "Changed on two devices" }, { timeout: 4000 });
    expect(merge).toHaveTextContent("Lucky Star");
    expect(merge).toHaveTextContent("Once a day");
    await user.click(screen.getByRole("button", { name: "Keep both changes" }));

    // The other device's name and both answers given here, saved over the other device's revision.
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

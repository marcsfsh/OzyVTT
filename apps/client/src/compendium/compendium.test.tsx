import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
// Reference reads (classes, spells) never answer here; nothing under test waits on them.
vi.mock("../lib/command", () => ({ command: vi.fn(), read: () => new Promise(() => {}) }));

const { LYRA, MIRENA, AT } = vi.hoisted(() => ({
  LYRA: "11111111-1111-4111-8111-111111111111",
  MIRENA: "22222222-2222-4222-8222-222222222222",
  AT: "2026-10-18T21:40:00.000Z"
}));

/** The GM's routes, answered from a small table: two SRD spells and a homebrew one shared with Lyra. */
const api = vi.hoisted(() => ({
  calls: [] as Array<[string, ...unknown[]]>,
  seeAs: { received: false } as { received: boolean },
  importReport: null as unknown
}));

vi.mock("../homebrew/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../homebrew/api")>();
  const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id,
    kind: "spell",
    name,
    source: "srd",
    packId: null,
    state: "published",
    archived: false,
    inCatalogs: true,
    pendingChanges: false,
    issueCount: 0,
    audience: "everyone",
    characterIds: [],
    basedOn: null,
    createdAt: null,
    updatedAt: null,
    usageCount: null,
    columns: { level: 3, school: "evocation", castingTime: "action", range: "150 feet", lists: ["wizard"] },
    ...extra
  });
  const brine = row("hb-brine-burst-a1b2c3", "Brine Burst", {
    source: "homebrew",
    packId: "table",
    audience: "characters",
    characterIds: [LYRA],
    basedOn: { source: "srd", id: "fireball", name: "Fireball", copiedAt: AT },
    createdAt: AT,
    updatedAt: AT
  });
  const body = (name: string) => ({
    type: "spell",
    name,
    level: 3,
    school: "evocation",
    castingTime: "action",
    range: { kind: "feet", distance: 150 },
    components: { verbal: true, somatic: true, material: false },
    duration: "instantaneous",
    description: `${name} roars into a fiery explosion.`,
    classes: ["wizard"]
  });
  const summary = {
    id: brine.id,
    type: "spell",
    name: "Brine Burst",
    source: "homebrew",
    state: "published",
    audience: "characters",
    characterIds: [LYRA],
    packId: "table",
    packName: null,
    inCatalogs: true,
    deletedAt: null,
    rev: 4,
    createdAt: AT,
    updatedAt: AT,
    valid: true,
    pendingChanges: false,
    issueCount: 0,
    basedOn: brine.basedOn,
    usageCount: 0,
    columns: brine.columns
  };
  const document = {
    id: brine.id,
    type: "spell",
    state: "published",
    audience: "characters",
    characterIds: [LYRA],
    reveals: [{ to: LYRA, at: AT }],
    packId: "table",
    packName: null,
    inCatalogs: true,
    basedOn: brine.basedOn,
    references: {},
    deletedAt: null,
    rev: 4,
    createdAt: AT,
    updatedAt: AT,
    validity: { valid: true, issues: [], warnings: [] },
    pendingChanges: false,
    record: { ...body("Brine Burst"), id: brine.id }
  };
  const record = <T,>(name: string, answer: T) =>
    vi.fn(async (...args: unknown[]) => {
      api.calls.push([name, ...args.slice(1)]);
      return answer;
    });
  return {
    ...actual,
    listAllHomebrew: async () => [summary],
    homebrewApi: {
      ...actual.homebrewApi,
      table: async (_token: string, kind: string) => ({
        kind,
        rows: kind === "spell" ? [row("fireball", "Fireball"), row("counterspell", "Counterspell"), brine] : []
      }),
      packs: async () => ({
        srd: { records: 2 },
        packs: [
          {
            id: "table",
            kind: "table",
            name: null,
            credit: null,
            importedAt: null,
            enabled: true,
            counts: { records: 1, published: 1, drafts: 0, shared: 1, archived: 0 }
          }
        ]
      }),
      overview: async () => ({
        srd: { records: 2 },
        packs: [],
        byKind: [{ kind: "spell", srd: 2, homebrew: 1, drafts: 0, shared: 1 }],
        needsYou: []
      }),
      get: async () => document,
      srdRecord: async (_token: string, id: string) => ({ type: "spell", record: { ...body("Fireball"), id } }),
      seeAsContent: vi.fn(async (_token: string, _id: string, as: string) => {
        api.calls.push(["seeAsContent", as]);
        return { as, kind: "spell", received: api.seeAs.received, entry: null };
      }),
      revisions: async () => [],
      duplicate: record("duplicate", { ...document, id: "hb-wand-of-sleet-b2c3d4", state: "draft" }),
      create: record("create", { ...document, id: "hb-gale-lance-c3d4e5", state: "draft" }),
      setAudience: record("setAudience", document),
      setSharing: record("setSharing", [summary]),
      importPack: vi.fn(async (_token: string, _pack: unknown, decisions: unknown, dryRun: boolean) => {
        api.calls.push(["importPack", decisions, dryRun]);
        return api.importReport;
      })
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { CompendiumShell } from "./CompendiumShell";
import { resetCompendiumData } from "./data";

const PARTY = [
  { id: LYRA, name: "Lyra Emberwise" },
  { id: MIRENA, name: "Mirena Dawnbright" }
];

function mount(path: string) {
  goTo(path);
  render(
    <ToastProvider>
      <CompendiumShell token="gm" party={PARTY} />
    </ToastProvider>
  );
  return userEvent.setup();
}

beforeEach(() => {
  api.calls = [];
  api.seeAs = { received: false };
  resetCompendiumData();
});

describe("the Compendium's tables", () => {
  it("lists the SRD and homebrew in one table, and opens a row at its own address", async () => {
    const user = mount("/compendium/tables/spells");
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Fireball")).toBeInTheDocument();
    const brine = within(table).getByRole("row", { name: /Brine Burst/ });
    expect(within(brine).getByText("Homebrew")).toBeInTheDocument();
    expect(within(brine).getByText("Lyra Emberwise")).toBeInTheDocument();
    await user.click(within(brine).getByRole("button", { name: /Brine Burst/ }));
    expect(window.location.pathname).toBe("/compendium/spells/hb-brine-burst-a1b2c3");
    expect(await screen.findByRole("heading", { name: "Brine Burst", level: 2 })).toBeInTheDocument();
  });
});

describe("a record's Card", () => {
  it("reads the card as one character's player through the server, and says when it does not reach them", async () => {
    const user = mount("/compendium/spells/hb-brine-burst-a1b2c3");
    await screen.findByRole("heading", { name: "Brine Burst", level: 2 });
    await user.selectOptions(screen.getByLabelText("See as"), MIRENA);
    expect(window.location.search).toBe(`?as=${MIRENA}`);
    expect(await screen.findByText(/Mirena Dawnbright's player doesn't receive this spell/)).toBeInTheDocument();
    expect(screen.getByText(/It is revealed to Lyra Emberwise only/)).toBeInTheDocument();
    expect(api.calls).toContainEqual(["seeAsContent", MIRENA]);
  });
});

describe("an SRD record", () => {
  it("opens read only and makes a homebrew copy under the name the GM types first", async () => {
    const user = mount("/compendium/spells/fireball");
    await screen.findByRole("heading", { name: "Fireball", level: 2 });
    expect(screen.queryByRole("tab", { name: "Edit" })).toBeNull();
    // The copy already made from it is one Compare away.
    expect(screen.getByRole("region", { name: "Your copies" })).toHaveTextContent("Brine Burst");
    await user.click(screen.getByRole("button", { name: "Make a homebrew copy" }));
    const dialog = screen.getByRole("dialog", { name: "Make a homebrew copy" });
    expect(within(dialog).getByRole("button", { name: "Make the copy" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Name"), "Wand of Sleet");
    await user.click(within(dialog).getByRole("button", { name: "Make the copy" }));
    await waitFor(() => expect(api.calls).toContainEqual(["duplicate", "fireball", "Wand of Sleet"]));
    // The copy opens on Edit, walked as a new record.
    await waitFor(() => expect(window.location.pathname).toBe("/compendium/spells/hb-wand-of-sleet-b2c3d4"));
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("edit");
  });
});

describe("New homebrew", () => {
  it("asks for the name first and makes a blank draft of the kind in view", async () => {
    const user = mount("/compendium/tables/spells");
    await user.click(await screen.findByRole("button", { name: "New homebrew" }));
    const dialog = screen.getByRole("dialog", { name: "New homebrew" });
    expect(within(dialog).getByLabelText("Kind")).toHaveValue("spell");
    expect(within(dialog).getByText("Name the spell first.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Name"), "Gale Lance");
    await user.click(within(dialog).getByRole("button", { name: "Make it" }));
    await waitFor(() => expect(api.calls.find((call) => call[0] === "create")).toBeDefined());
    expect(api.calls.find((call) => call[0] === "create")![1]).toMatchObject({ type: "spell", name: "Gale Lance" });
  });
});

describe("Sharing", () => {
  it("sets who sees a record from its row of the grid, and several at once", async () => {
    const user = mount("/compendium/sharing");
    const grid = await screen.findByRole("table");
    await user.click(within(grid).getByRole("checkbox", { name: "Brine Burst: Everyone" }));
    await waitFor(() =>
      expect(api.calls).toContainEqual([
        "setAudience",
        "hb-brine-burst-a1b2c3",
        { audience: "everyone", characterIds: [] },
        4
      ])
    );
    await user.click(within(grid).getByRole("checkbox", { name: "Tick Brine Burst" }));
    await user.click(screen.getByRole("button", { name: "Set for 1 selected" }));
    await user.click(
      within(screen.getByRole("group", { name: "Who sees the ticked record" })).getByRole("button", { name: "Hidden" })
    );
    await user.click(screen.getByRole("button", { name: "Set for 1" }));
    await waitFor(() =>
      expect(api.calls).toContainEqual([
        "setSharing",
        [{ id: "hb-brine-burst-a1b2c3", expectedRev: 4 }],
        { audience: "hidden", characterIds: [] }
      ])
    );
  });
});

describe("importing a pack", () => {
  it("reviews the server's dry run with a decision per record, and imports only when the GM confirms", async () => {
    const records = [
      {
        index: 0,
        type: "species",
        name: "Saltborn",
        clash: {
          source: "homebrew",
          id: "hb-saltborn-a1b2c3",
          name: "Saltborn",
          state: "published",
          audience: "everyone",
          archived: false
        },
        problems: [],
        allowed: ["rename", "new", "skip"],
        decision: "rename",
        id: null
      },
      {
        index: 1,
        type: "spell",
        name: "Gale Lance",
        clash: null,
        problems: [{ path: ["level"], message: "Fill in the level.", code: "invalid_type" }],
        allowed: ["new", "skip"],
        decision: "new",
        id: null
      }
    ];
    api.importReport = { imported: [], reminted: [], overwritten: [], rejected: [], dryRun: true, records, pack: null };
    const user = mount("/compendium/sources");
    const input = await screen.findByLabelText("A homebrew pack file");
    const pack = {
      schemaId: "vtt.homebrew-pack",
      schemaVersion: 1,
      name: "Sundered Coast extras",
      attribution: null,
      exportedAt: AT,
      records: [{}, {}]
    };
    await user.upload(
      input as HTMLInputElement,
      new File([JSON.stringify(pack)], "extras.json", { type: "application/json" })
    );

    // The plan is the dry run, asked with no decisions so the server proposes each record's default.
    const review = await screen.findByRole("region", { name: "Review Sundered Coast extras" });
    expect(api.calls).toEqual([["importPack", [], true]]);
    expect(within(review).getByText("Your Saltborn, published and shown")).toBeInTheDocument();
    expect(within(review).getByText("Fill in the level.")).toBeInTheDocument();
    await user.selectOptions(within(review).getByLabelText("What to do with Gale Lance"), "skip");

    api.importReport = {
      ...(api.importReport as object),
      dryRun: false,
      imported: [
        {
          id: "hb-saltborn-d4e5f6",
          type: "species",
          name: "Saltborn (Sundered Coast extras)",
          originalId: "hb-saltborn-d4e5f6"
        }
      ]
    };
    await user.click(within(review).getByRole("button", { name: "Import 1 record" }));
    await waitFor(() =>
      expect(api.calls.at(-1)).toEqual([
        "importPack",
        [
          { index: 0, decision: "rename" },
          { index: 1, decision: "skip" }
        ],
        false
      ])
    );
  });
});

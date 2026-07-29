import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const getAudit = vi.fn();
const revealPage = vi.fn();
const revealMap = vi.fn();
const revealMarker = vi.fn();
const revealEntry = vi.fn();
const revealSession = vi.fn();
const revealQuest = vi.fn();
const revealStanding = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    revealAuditApi: { get: (...a: unknown[]) => getAudit(...a) },
    codexApi: { ...actual.codexApi, revealPage: (...a: unknown[]) => revealPage(...a) },
    atlasApi: { ...actual.atlasApi, revealMap: (...a: unknown[]) => revealMap(...a), revealMarker: (...a: unknown[]) => revealMarker(...a) },
    journalApi: { ...actual.journalApi, reveal: (...a: unknown[]) => revealEntry(...a) },
    sessionApi: { ...actual.sessionApi, reveal: (...a: unknown[]) => revealSession(...a) },
    questApi: { ...actual.questApi, reveal: (...a: unknown[]) => revealQuest(...a) },
    standingApi: { ...actual.standingApi, reveal: (...a: unknown[]) => revealStanding(...a) }
  };
});

import { RevealAudit } from "./RevealAudit";
import type { CodexRevealAudit, CodexRevealAuditKind, CodexRevealAuditSection } from "./api";

/**
 * M12 / CT-9 — the reveal audit on the client.
 *
 * Four properties, and each is a thing CT-9's risk section actually warns about:
 *
 *  1. **It aggregates, it does not decide.** The rows it shows are exactly the rows the server sent, and
 *     membership was decided by running the PLAYER projections. Proved by handing it a section whose
 *     `revealed` count and rows disagree with any flag-based reading and asserting it renders what it was
 *     given: a surface with a predicate of its own would be the second source of truth the spec forbids.
 *  2. **It un-reveals through each record's OWN route.** Seven kinds, seven existing routes, no unreveal
 *     route and no bulk operation. Each is asserted individually, because "hide" reaching the wrong
 *     record type is a silent, destructive miss.
 *  3. **"Nothing revealed" and "not loaded" never look the same** (the CF-2 lesson). All seven sections
 *     are always present in a well-formed answer, so a section that is ABSENT is malformed — and the
 *     audit says "not read" rather than rendering it as an empty category.
 *  4. **`revealed` is not the flag count.** A pin on a hidden map and a standing for an unrevealed
 *     faction both have their own flag set and are still invisible; the section's `revealed`/`total` is
 *     the server's answer to what a player would receive, and the surface reports it verbatim.
 */

const KINDS: readonly CodexRevealAuditKind[] = ["page", "map", "marker", "journal", "session", "quest", "standing"];

const section = (kind: CodexRevealAuditKind, rows: Array<{ id: string; title: string }>, total = rows.length): CodexRevealAuditSection =>
  ({ kind, revealed: rows.length, total, rows: rows.map((row) => ({ kind, ...row })) });

/**
 * Wraps a section list into the whole answer, deriving the codex-wide totals the way the SERVER does.
 * The surface reads `audit.revealed` rather than summing sections, because the sum is only the same number
 * while every section is present — and the malformed case below is exactly when it is not.
 */
const answer = (sections: readonly CodexRevealAuditSection[]): CodexRevealAudit => ({
  sections,
  revealed: sections.reduce((sum, entry) => sum + entry.revealed, 0),
  total: sections.reduce((sum, entry) => sum + entry.total, 0)
});

/** A well-formed answer with nothing revealed: all seven sections present, all empty. */
const EMPTY: CodexRevealAudit = answer(KINDS.map((kind) => section(kind, [])));

const AUDIT: CodexRevealAudit = answer([
    section("page", [{ id: "p1", title: "Strahd" }], 12),
    section("map", [{ id: "m1", title: "Barovia" }], 3),
    section("marker", [{ id: "k1", title: "Vallaki" }], 8),
    section("journal", [{ id: "j1", title: "The party crossed the mists." }], 40),
    section("session", [{ id: "e1", title: "Session 4" }], 4),
    section("quest", [{ id: "q1", title: "Find the Sunsword" }], 5),
    // Addressed by the FACTION PAGE id, which is what the standing reveal route takes.
    section("standing", [{ id: "f1", title: "The Zhentarim" }], 2)
]);

const renderAudit = async (audit: unknown = AUDIT) => {
  getAudit.mockResolvedValue(audit);
  render(<RevealAudit gmToken="gm" onClose={vi.fn()} />);
  await waitFor(() => expect(getAudit).toHaveBeenCalled());
};

const sectionOf = (heading: string) => screen.getByRole("heading", { name: new RegExp(`^${heading}`) }).closest("section")!;

describe("The audit lists every Codex record type (CT-9)", () => {
  it("names all seven kinds and one record from each", async () => {
    await renderAudit();

    // Seven kinds: the six reveal surfaces that existed before M12, plus standing.
    expect(within(sectionOf("Pages")).getByText("Strahd")).toBeInTheDocument();
    expect(within(sectionOf("Maps")).getByText("Barovia")).toBeInTheDocument();
    expect(within(sectionOf("Map pins")).getByText("Vallaki")).toBeInTheDocument();
    expect(within(sectionOf("Chronicle records")).getByText("The party crossed the mists.")).toBeInTheDocument();
    expect(within(sectionOf("Session recaps")).getByText("Session 4")).toBeInTheDocument();
    expect(within(sectionOf("Quests")).getByText("Find the Sunsword")).toBeInTheDocument();
    // A standing row arrives already NAMED by the server; nothing here resolves an id.
    expect(within(sectionOf("Faction standing")).getByText("The Zhentarim")).toBeInTheDocument();
  });

  it("says how much of what exists is shared, using the server's own counts", async () => {
    await renderAudit();
    // `revealed of total` is the question a GM actually opens this screen with, and both halves are the
    // server's: `revealed` is what a PLAYER would receive, not how many flags are set.
    expect(within(sectionOf("Pages")).getByText("1 of 12 shared")).toBeInTheDocument();
    expect(within(sectionOf("Chronicle records")).getByText("1 of 40 shared")).toBeInTheDocument();
    expect(screen.getByText("7 records are shown to players across the Codex.")).toBeInTheDocument();
  });

  it("says out loud that it covers Codex records only (M12-A)", async () => {
    await renderAudit();
    expect(screen.getByText(/Codex records only/)).toBeInTheDocument();
    expect(screen.getByText(/Tokens, fog and the shared table view/)).toBeInTheDocument();
  });
});

describe("It aggregates; it does not decide (CT-9's stated risk)", () => {
  it("renders exactly what the server sent, with no predicate of its own", async () => {
    // The server's aggregation ran the PLAYER projections, so a section can legitimately report fewer
    // rows than there are flagged records — a pin on a hidden map is flagged and still invisible. The
    // surface must report the answer it was given rather than recomputing anything: here `total` is 8
    // and one row came back, and the screen says exactly that.
    await renderAudit(answer([...EMPTY.sections.filter((s) => s.kind !== "marker"), section("marker", [{ id: "k1", title: "Vallaki" }], 8)]));

    expect(within(sectionOf("Map pins")).getByText("Vallaki")).toBeInTheDocument();
    expect(within(sectionOf("Map pins")).getByText("1 of 8 shared")).toBeInTheDocument();
    expect(screen.getByText("1 record is shown to players across the Codex.")).toBeInTheDocument();
  });

  it("offers no bulk operation — hiding is one record at a time", async () => {
    await renderAudit();
    expect(screen.queryByRole("button", { name: /hide all/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /hide everything/i })).toBeNull();
    // One Hide per row, and there are seven rows.
    expect(screen.getAllByRole("button", { name: /^Hide the /i })).toHaveLength(7);
  });
});

describe("Un-revealing goes back out through each record's own route", () => {
  const cases: ReadonlyArray<[string, string, () => ReturnType<typeof vi.fn>, unknown[]]> = [
    ["Pages", "Hide the page Strahd from players", () => revealPage, ["gm", "p1", false]],
    ["Maps", "Hide the map Barovia from players", () => revealMap, ["gm", "m1", false]],
    ["Map pins", "Hide the pin Vallaki from players", () => revealMarker, ["gm", "k1", false]],
    ["Chronicle records", "Hide the record The party crossed the mists. from players", () => revealEntry, ["gm", "j1", false]],
    ["Session recaps", "Hide the recap for Session 4 from players", () => revealSession, ["gm", "e1", false]],
    ["Quests", "Hide the quest Find the Sunsword from players", () => revealQuest, ["gm", "q1", false]],
    // Standing reveals by FACTION page id, which is what its route takes — not the standing row's own id.
    ["Faction standing", "Hide the standing with The Zhentarim from players", () => revealStanding, ["gm", "f1", false]]
  ];

  for (const [kind, label, route, args] of cases) {
    it(`${kind}`, async () => {
      await renderAudit();
      route().mockResolvedValue({});
      await userEvent.setup().click(screen.getByRole("button", { name: label }));
      await waitFor(() => expect(route()).toHaveBeenCalledWith(...args));
      // And it re-reads, so the row it just hid leaves the list.
      await waitFor(() => expect(getAudit).toHaveBeenCalledTimes(2));
    });
  }
});

describe("Nothing revealed and not loaded never look the same (CF-2)", () => {
  it("says what an EMPTY kind means, in that kind's own words", async () => {
    await renderAudit(EMPTY);
    expect(within(sectionOf("Pages")).getByText("No pages are shown to players.")).toBeInTheDocument();
    expect(within(sectionOf("Faction standing")).getByText("No faction standing is shown to players.")).toBeInTheDocument();
    expect(screen.getByText("0 records are shown to players across the Codex.")).toBeInTheDocument();
    // An empty audit is not an incomplete one.
    expect(screen.queryByText(/This audit is incomplete/)).toBeNull();
  });

  it("calls out a kind the answer did not carry, and never renders it as empty", async () => {
    // The contract says all seven sections are always present, so a missing one is a MALFORMED answer.
    // Rendering it as `[]` would tell the GM no map is shared — the opposite of "I could not find out",
    // and the one they would act on wrongly.
    await renderAudit({ sections: EMPTY.sections.filter((s) => s.kind !== "map") });

    expect(within(sectionOf("Maps")).getByText(/didn't load/)).toBeInTheDocument();
    expect(within(sectionOf("Maps")).queryByText("No maps are shown to players.")).toBeNull();
    expect(within(sectionOf("Maps")).getByText("not read")).toBeInTheDocument();
    // And it is called out once at the top, so a GM scrolling past the section still learns of it.
    expect(screen.getByText(/This audit is incomplete/)).toBeInTheDocument();
    expect(screen.getByText(/Couldn't read: maps/)).toBeInTheDocument();
  });

  it("does not claim anything at all while the first read is in flight", async () => {
    // CF-2: before the read settles, "nothing is revealed" is not a claim this screen may make.
    let release: (value: CodexRevealAudit) => void = () => {};
    getAudit.mockReturnValue(new Promise<CodexRevealAudit>((resolve) => { release = resolve; }));
    render(<RevealAudit gmToken="gm" onClose={vi.fn()} />);

    expect(screen.queryByText(/are shown to players across the Codex/)).toBeNull();
    expect(screen.queryByText("No pages are shown to players.")).toBeNull();

    release(EMPTY);
    expect(await screen.findByText("0 records are shown to players across the Codex.")).toBeInTheDocument();
  });
});

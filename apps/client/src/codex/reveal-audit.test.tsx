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
const unpublishDate = vi.fn();
const publishDate = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    revealAuditApi: { get: (...a: unknown[]) => getAudit(...a) },
    codexApi: { ...actual.codexApi, revealPage: (...a: unknown[]) => revealPage(...a) },
    atlasApi: {
      ...actual.atlasApi,
      revealMap: (...a: unknown[]) => revealMap(...a),
      revealMarker: (...a: unknown[]) => revealMarker(...a)
    },
    journalApi: { ...actual.journalApi, reveal: (...a: unknown[]) => revealEntry(...a) },
    sessionApi: { ...actual.sessionApi, reveal: (...a: unknown[]) => revealSession(...a) },
    questApi: { ...actual.questApi, reveal: (...a: unknown[]) => revealQuest(...a) },
    standingApi: { ...actual.standingApi, reveal: (...a: unknown[]) => revealStanding(...a) },
    calendarApi: {
      ...actual.calendarApi,
      publish: (...a: unknown[]) => publishDate(...a),
      unpublish: (...a: unknown[]) => unpublishDate(...a)
    }
  };
});

import { RevealAudit } from "./RevealAudit";
import type { CodexJournalKind, CodexRevealAudit, CodexRevealAuditKind, CodexRevealAuditSection } from "@vtt/domain";

const KINDS: readonly CodexRevealAuditKind[] = [
  "date",
  "page",
  "map",
  "marker",
  "journal",
  "session",
  "quest",
  "standing"
];

/** `journalKind` is present-and-null on non-journal rows. */
const section = (
  kind: CodexRevealAuditKind,
  rows: Array<{ id: string; title: string; journalKind?: CodexJournalKind }>,
  total = rows.length
): CodexRevealAuditSection => ({
  kind,
  revealed: rows.length,
  total,
  rows: rows.map((row) => ({ kind, journalKind: null, ...row }))
});

/** Derives the codex-wide totals the way the server does. */
const answer = (sections: readonly CodexRevealAuditSection[]): CodexRevealAudit => ({
  sections,
  revealed: sections.reduce((sum, entry) => sum + entry.revealed, 0),
  total: sections.reduce((sum, entry) => sum + entry.total, 0)
});

/** Well-formed and empty: every section present. */
const EMPTY: CodexRevealAudit = answer(KINDS.map((kind) => section(kind, [])));

const AUDIT: CodexRevealAudit = answer([
  section("date", [{ id: "published-date", title: "Hammer 10, 1492 DR" }], 1),
  section("page", [{ id: "p1", title: "Strahd" }], 12),
  section("map", [{ id: "m1", title: "Barovia" }], 3),
  section("marker", [{ id: "k1", title: "Vallaki" }], 8),
  section("journal", [{ id: "j1", title: "The party crossed the mists." }], 40),
  section("session", [{ id: "e1", title: "Session 4" }], 4),
  section("quest", [{ id: "q1", title: "Find the Sunsword" }], 5),
  // Addressed by the faction page id, which the standing reveal route takes.
  section("standing", [{ id: "f1", title: "The Zhentarim" }], 2)
]);

/** A standing row shares its faction page's id, so the coupling guard is actually reachable. */
const COUPLED: CodexRevealAudit = answer([
  section(
    "page",
    [
      { id: "f1", title: "The Zhentarim" },
      { id: "p1", title: "Strahd" }
    ],
    12
  ),
  section("map", [], 3),
  section("marker", [], 8),
  section("journal", [], 40),
  section("session", [], 4),
  section("quest", [], 5),
  section("standing", [{ id: "f1", title: "The Zhentarim" }], 2)
]);

const renderAudit = async (audit: unknown = AUDIT) => {
  getAudit.mockResolvedValue(audit);
  render(<RevealAudit gmToken="gm" />);
  await waitFor(() => expect(getAudit).toHaveBeenCalled());
};

const sectionOf = (heading: string) =>
  screen.getByRole("heading", { name: new RegExp(`^${heading}`) }).closest("section")!;

describe("The audit lists every Codex record type", () => {
  it("names all seven kinds and one record from each", async () => {
    await renderAudit();

    expect(within(sectionOf("Pages")).getByText("Strahd")).toBeInTheDocument();
    expect(within(sectionOf("Maps")).getByText("Barovia")).toBeInTheDocument();
    expect(within(sectionOf("Map pins")).getByText("Vallaki")).toBeInTheDocument();
    expect(within(sectionOf("Journal entries")).getByText("The party crossed the mists.")).toBeInTheDocument();
    expect(within(sectionOf("Session recaps")).getByText("Session 4")).toBeInTheDocument();
    expect(within(sectionOf("Quests")).getByText("Find the Sunsword")).toBeInTheDocument();
    // The server names the standing row; nothing here resolves an id.
    expect(within(sectionOf("Faction standing")).getByText("The Zhentarim")).toBeInTheDocument();
  });

  it("says how much of what exists is shared, using the server's own counts", async () => {
    await renderAudit();
    // Both numbers are the server's: what a player would receive, which a flag count can't say.
    expect(within(sectionOf("Pages")).getByText("1 of 12 shared")).toBeInTheDocument();
    expect(within(sectionOf("Journal entries")).getByText("1 of 40 shared")).toBeInTheDocument();
    expect(screen.getByText("8 records are shown to players across the Codex.")).toBeInTheDocument();
  });

  it("says out loud that it covers Codex records only", async () => {
    await renderAudit();
    expect(screen.getByText(/Codex records only/)).toBeInTheDocument();
    expect(screen.getByText(/Tokens, fog and the shared table view/)).toBeInTheDocument();
  });
});

describe("Hiding a faction page takes the standing with it", () => {
  /** Losing this warning over-hides: the standing silently vanishes from players' view. */
  it("asks first, and hides nothing while the question is open", async () => {
    const user = userEvent.setup();
    await renderAudit(COUPLED);

    const pages = within(sectionOf("Pages"));
    await user.click(pages.getByRole("switch", { name: "Show the page The Zhentarim to players" }));

    expect(await screen.findByRole("dialog", { name: "Hide this faction page" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your standing with them stops being shown to players as well. A standing is only shown while its faction page is."
      )
    ).toBeInTheDocument();
    // The warning comes before the act.
    expect(revealPage).not.toHaveBeenCalled();
  });

  it("Cancel leaves the page shown and calls no route", async () => {
    const user = userEvent.setup();
    await renderAudit(COUPLED);

    await user.click(
      within(sectionOf("Pages")).getByRole("switch", { name: "Show the page The Zhentarim to players" })
    );
    await screen.findByRole("dialog", { name: "Hide this faction page" });
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Hide this faction page" })).not.toBeInTheDocument()
    );
    expect(revealPage).not.toHaveBeenCalled();
    expect(
      within(sectionOf("Pages")).getByRole("switch", { name: "Show the page The Zhentarim to players" })
    ).toBeChecked();
  });

  it("Hide page proceeds through the page's own reveal route", async () => {
    const user = userEvent.setup();
    revealPage.mockResolvedValue(undefined);
    await renderAudit(COUPLED);

    await user.click(
      within(sectionOf("Pages")).getByRole("switch", { name: "Show the page The Zhentarim to players" })
    );
    await screen.findByRole("dialog", { name: "Hide this faction page" });
    await user.click(screen.getByRole("button", { name: "Hide page" }));

    await waitFor(() => expect(revealPage).toHaveBeenCalledWith("gm", "f1", false));
  });

  it("does not ask about a page that carries no standing", async () => {
    // Control case: a guard firing on every page row would pass the tests above.
    const user = userEvent.setup();
    revealPage.mockResolvedValue(undefined);
    await renderAudit(COUPLED);

    await user.click(within(sectionOf("Pages")).getByRole("switch", { name: "Show the page Strahd to players" }));
    await waitFor(() => expect(revealPage).toHaveBeenCalledWith("gm", "p1", false));
    expect(screen.queryByRole("dialog", { name: "Hide this faction page" })).not.toBeInTheDocument();
  });
});

describe("A chronicle row says which kind of record it is", () => {
  it("badges the kind, in the chronicle's own words, beside the record's own prose", async () => {
    await renderAudit(
      answer([
        ...KINDS.filter((kind) => kind !== "journal").map((kind) => section(kind, [])),
        section(
          "journal",
          [
            { id: "j1", title: "The duke's ultimatum expires.", journalKind: "deadline" },
            { id: "j2", title: "The party crossed the mists.", journalKind: "note" }
          ],
          40
        )
      ])
    );

    const chronicle = within(sectionOf("Journal entries"));
    // The timeline's own labels; `note` must cross to "Entry".
    expect(chronicle.getByText("Deadline")).toBeInTheDocument();
    expect(chronicle.getByText("Entry")).toBeInTheDocument();
    expect(chronicle.getByText("The duke's ultimatum expires.")).toBeInTheDocument();
  });

  it("badges nothing on the six kinds that are not journal records", async () => {
    await renderAudit();
    // Non-journal sections must not grow a kind badge.
    for (const heading of ["Pages", "Maps", "Map pins", "Session recaps", "Quests", "Faction standing"]) {
      const rows = within(sectionOf(heading));
      for (const label of ["Entry", "Battle", "Deadline", "Downtime", "Milestone", "Standing"]) {
        expect(rows.queryByText(label), `${heading} should carry no ${label} badge`).not.toBeInTheDocument();
      }
    }
  });
});

describe("It aggregates; it does not decide", () => {
  it("renders exactly what the server sent, with no predicate of its own", async () => {
    // Report the server's answer as given: `total` 8 with one row is legitimate (a pin on a hidden map).
    await renderAudit(
      answer([
        ...EMPTY.sections.filter((s) => s.kind !== "marker"),
        section("marker", [{ id: "k1", title: "Vallaki" }], 8)
      ])
    );

    expect(within(sectionOf("Map pins")).getByText("Vallaki")).toBeInTheDocument();
    expect(within(sectionOf("Map pins")).getByText("1 of 8 shared")).toBeInTheDocument();
    expect(screen.getByText("1 record is shown to players across the Codex.")).toBeInTheDocument();
  });

  it("hides the published date through the calendar, and shows it again by publishing", async () => {
    await renderAudit();
    const user = userEvent.setup();
    const date = within(sectionOf("Campaign date"));
    await user.click(date.getByRole("switch", { name: "Show the date Hammer 10, 1492 DR to players" }));
    await waitFor(() => expect(unpublishDate).toHaveBeenCalledWith("gm"));
    await user.click(date.getByRole("switch", { name: "Show the date Hammer 10, 1492 DR to players" }));
    await waitFor(() => expect(publishDate).toHaveBeenCalledWith("gm"));
  });

  it("offers no bulk operation: hiding is one record at a time", async () => {
    await renderAudit();
    expect(screen.queryByRole("button", { name: /hide all/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /hide everything/i })).toBeNull();
    expect(screen.getAllByRole("switch")).toHaveLength(8);
  });
});

describe("Un-revealing goes back out through each record's own route", () => {
  const cases: ReadonlyArray<[string, string, () => ReturnType<typeof vi.fn>, unknown[]]> = [
    ["Pages", "Show the page Strahd to players", () => revealPage, ["gm", "p1", false]],
    ["Maps", "Show the map Barovia to players", () => revealMap, ["gm", "m1", false]],
    ["Map pins", "Show the pin Vallaki to players", () => revealMarker, ["gm", "k1", false]],
    [
      "Journal entries",
      "Show the entry The party crossed the mists. to players",
      () => revealEntry,
      ["gm", "j1", false]
    ],
    ["Session recaps", "Show the recap for Session 4 to players", () => revealSession, ["gm", "e1", false]],
    ["Quests", "Show the quest Find the Sunsword to players", () => revealQuest, ["gm", "q1", false]],
    ["Faction standing", "Show standing with The Zhentarim to players", () => revealStanding, ["gm", "f1", false]]
  ];

  for (const [kind, label, route, args] of cases) {
    it(`${kind}`, async () => {
      await renderAudit();
      route().mockResolvedValue({});
      await userEvent.setup().click(screen.getByRole("switch", { name: label }));
      await waitFor(() => expect(route()).toHaveBeenCalledWith(...args));
      // It re-reads after the write.
      await waitFor(() => expect(getAudit).toHaveBeenCalledTimes(2));
    });
  }
});

describe("Nothing revealed and not loaded never look the same (CF-2)", () => {
  it("says what an EMPTY kind means, in that kind's own words", async () => {
    await renderAudit(EMPTY);
    expect(within(sectionOf("Pages")).getByText("No pages are shown to players.")).toBeInTheDocument();
    expect(
      within(sectionOf("Faction standing")).getByText("No faction standing is shown to players.")
    ).toBeInTheDocument();
    expect(screen.getByText("0 records are shown to players across the Codex.")).toBeInTheDocument();
    expect(screen.queryByText(/This audit is incomplete/)).toBeNull();
  });

  it("calls out a kind the answer did not carry, and never renders it as empty", async () => {
    // A missing section is malformed, and must not render as an empty one.
    await renderAudit({ sections: EMPTY.sections.filter((s) => s.kind !== "map") });

    expect(within(sectionOf("Maps")).getByText(/didn't load/)).toBeInTheDocument();
    expect(within(sectionOf("Maps")).queryByText("No maps are shown to players.")).toBeNull();
    expect(within(sectionOf("Maps")).getByText("not read")).toBeInTheDocument();
    expect(screen.getByText(/This audit is incomplete/)).toBeInTheDocument();
    expect(screen.getByText(/Couldn't read: maps/)).toBeInTheDocument();
  });

  it("does not claim anything at all while the first read is in flight", async () => {
    // Before the read settles, "nothing is revealed" is not a claim the screen may make.
    let release: (value: CodexRevealAudit) => void = () => {};
    getAudit.mockReturnValue(
      new Promise<CodexRevealAudit>((resolve) => {
        release = resolve;
      })
    );
    render(<RevealAudit gmToken="gm" />);

    expect(screen.queryByText(/are shown to players across the Codex/)).toBeNull();
    expect(screen.queryByText("No pages are shown to players.")).toBeNull();

    release(EMPTY);
    expect(await screen.findByText("0 records are shown to players across the Codex.")).toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const chronicle = vi.fn();
const timeline = vi.fn();
const forPage = vi.fn();
const listPages = vi.fn();
const getCalendar = vi.fn();
const getSettings = vi.fn();
const markersForPage = vi.fn();
const exportBundle = vi.fn();
const importBundle = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      listPages: (...a: unknown[]) => listPages(...a),
      getSettings: (...a: unknown[]) => getSettings(...a),
      markersForPage: (...a: unknown[]) => markersForPage(...a),
      exportBundle: (...a: unknown[]) => exportBundle(...a),
      importBundle: (...a: unknown[]) => importBundle(...a)
    },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    journalApi: {
      ...actual.journalApi,
      chronicle: (...a: unknown[]) => chronicle(...a),
      timeline: (...a: unknown[]) => timeline(...a),
      forPage: (...a: unknown[]) => forPage(...a)
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { BODY_LAYER } from "./TwoLayerBodyTabs";
import { JournalView } from "./JournalView";
import { QuestsView } from "./QuestsView";
import { PageEditor } from "./PageEditor";
import { BackupView } from "./BackupView";
import type { CodexCalendar, CodexPage, CodexQuest } from "./api";

/**
 * `5a.1` / `5c` — **one control, one pair of words, on every surface that offers the two-layer split.**
 *
 * The client's report was that the same toggle is named differently everywhere, and the journal was the
 * worst of it: four kinds, four player-side labels. Counted at HEAD before this fix there were SEVEN
 * pairs across four files —
 *
 * | surface                    | was                                          |
 * |----------------------------|----------------------------------------------|
 * | journal · entry            | "Player-facing summary" / "GM-only notes"     |
 * | journal · deadline         | "What will happen" / "GM-only notes"          |
 * | journal · downtime         | "What the party knows" / "GM-only notes"      |
 * | journal · milestone        | "What the party knows" / "GM-only notes"      |
 * | quest editor               | "What the party was told" / "GM notes"        |
 * | page editor                | "Player-facing" / "GM only"                   |
 * | backup · bring in notes    | "Player-facing side" / "GM-only side"         |
 *
 * — and they are now all **"Player-visible notes" / "GM-only notes"**.
 *
 * **This file is the far end of that claim.** `vocabulary.test.ts` reads the SOURCE and fails on the
 * seven retired labels; nothing there proves what a GM actually sees, and a scan cannot — three of those
 * seven were invisible to it (`textLabel:` is not a copy prop, and the second branch of a ternary
 * `ariaLabel={a ? "…" : "…"}` is not captured). So each surface below is rendered and asked for its two
 * buttons by their accessible names. A future surface that hand-rolls its own pair passes the scan and
 * fails nothing — which is why the fix is a shared component, and why the rule that matters most is the
 * last test here: the four surfaces must agree with `BODY_LAYER`, not merely with a string typed twice.
 *
 * **What this is NOT.** Not a visibility change. The gate on who reads a layer is `revealedToPlayers`
 * through `RevealSwitch`, and the layers are the server's `playerBody`/`gmBody` and
 * `playerText`/`gmText` — all untouched. Renaming the control that DESCRIBES the split must not move
 * one byte of what a player receives, and `codex-projections.ts` is not in this change.
 */

const CALENDAR: CodexCalendar = { yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] };

const PAGE: CodexPage = {
  id: "p1", title: "Strahd von Zarovich", entityType: "character", fields: {}, gmFields: {},
  folder: null, tags: [], playerBody: "", gmBody: "", revealedToPlayers: false,
  bannerAssetId: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  rev: 3, createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z"
};

const QUEST: CodexQuest = {
  id: "q1", title: "The Sunless Crown", status: "active",
  playerBody: "The burgomaster wants the crown returned.",
  gmBody: "The crown is a phylactery and the burgomaster knows it.",
  objectives: [], entityIds: [], revealedToPlayers: false, tags: [], rev: 3,
  createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-02T00:00:00.000Z"
};

/** The claim, asked the same way of every surface: both options are on screen, under the canonical names. */
const expectCanonicalPair = async () => {
  expect(await screen.findByRole("button", { name: BODY_LAYER.player.label })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: BODY_LAYER.gm.label })).toBeInTheDocument();
};

beforeEach(() => {
  chronicle.mockResolvedValue([]);
  timeline.mockResolvedValue([]);
  forPage.mockResolvedValue([]);
  listPages.mockResolvedValue([]);
  getCalendar.mockResolvedValue(CALENDAR);
  markersForPage.mockResolvedValue([]);
  getSettings.mockResolvedValue({ revealWarn: true, autosave: { enabled: false, intervalSeconds: 1 }, revisionHistory: { enabled: true, windowMinutes: 10 } });
});

describe("The two-layer notes control names its layers the same way everywhere (5a.1 / 5c)", () => {
  it("is defined once, and these are the words", () => {
    // The pin the other five tests point at. Changing the pair is allowed; changing it in ONE place and
    // leaving six surfaces behind is what this whole unit exists to prevent, so the words are asserted
    // where they are defined and every surface below is compared to that definition rather than to a
    // literal retyped in the test.
    expect(BODY_LAYER.player.label).toBe("Player-visible notes");
    expect(BODY_LAYER.gm.label).toBe("GM-only notes");
  });

  /**
   * The journal composer, all four kinds. This is the surface the client actually named ("every journal
   * entry has a similar but each-differently-named toggle"), and the only one where the label used to
   * change WITHOUT the GM leaving the screen — pick a different kind, get a different word for the same
   * box. The kind switch is driven, not stubbed, so the assertion is about what a GM sees after a tap.
   */
  for (const kind of ["Entry", "Deadline", "Downtime", "Milestone"] as const) {
    it(`says it the same way on a ${kind.toLowerCase()} as on every other kind`, async () => {
      render(<JournalView gmToken="gm" autosave={{ enabled: true, intervalSeconds: 1 }} pages={[]} onOpenPage={vi.fn()} />);
      await waitFor(() => expect(chronicle).toHaveBeenCalled());
      await userEvent.setup().click(screen.getByRole("button", { name: kind }));
      await expectCanonicalPair();
      // The player layer's accessible name follows the tab, so a screen reader is told the same thing the
      // switch says. It used to be the kind's own word, which is how the drift reached the a11y tree too.
      expect(screen.getByRole("textbox", { name: BODY_LAYER.player.label })).toBeInTheDocument();
    });
  }

  it("says it the same way in the quest editor", async () => {
    render(
      <QuestsView gmToken="gm" quests={[QUEST]} pages={[]} loading={false} error={null} openQuestId="q1"
        onOpenQuest={vi.fn()} onChanged={vi.fn()} onOpenPage={vi.fn()} autosave={{ enabled: false, intervalSeconds: 1 }} />
    );
    await expectCanonicalPair();
    // 5c's own half: the GM side used to be "GM notes", one word off from the journal's "GM-only notes"
    // — close enough to look deliberate and not close enough to be one vocabulary.
    await userEvent.setup().click(screen.getByRole("button", { name: BODY_LAYER.gm.label }));
    expect(screen.getByRole("textbox", { name: BODY_LAYER.gm.label })).toHaveValue(QUEST.gmBody);
  });

  it("says it the same way in the page editor", async () => {
    (goTo("/codex/pages/p1"), render)(
      <ToastProvider>
        <PageEditor gmToken="gm" page={PAGE} pages={[]} connections={[]} autosave={{ enabled: false, intervalSeconds: 1 }}
          onChange={vi.fn()} onDeleted={vi.fn()} onNavigate={vi.fn()} onConnectionsChanged={vi.fn()} onOpenConnection={vi.fn()} />
      </ToastProvider>
    );
    await expectCanonicalPair();
    // The page editor is where the reveal axis and the content axis sit closest together, and the reason
    // the retirement rules are anchored: this tab used to read "GM only", which is ALSO what `GmOnlyTag`
    // renders about a different question. The tab moved to the notes wording; the pill is untouched.
    expect(screen.getByRole("switch", { name: "Show this page to players" })).toBeInTheDocument();
  });

  it("says it the same way on the notes importer, which asks the same question about a destination", async () => {
    render(<ToastProvider><BackupView gmToken="gm" onChanged={vi.fn()} /></ToastProvider>);
    await expectCanonicalPair();
    // GM first here, deliberately — it is the default and what a GM importing raw prep almost always
    // wants. Order is this surface's business; the WORDS are not.
    expect(screen.getByRole("group", { name: "Which layer to import into" })).toBeInTheDocument();
  });
});

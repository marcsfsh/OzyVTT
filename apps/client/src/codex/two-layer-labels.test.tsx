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
import { BODY_LAYER } from "./TwoLayerBodyTabs";
import { JournalView } from "./JournalView";
import { BackupView } from "./BackupView";
import type { CodexCalendar } from "@vtt/domain";

/**
 * Every surface that offers the two-layer split shows the canonical pair from `BODY_LAYER`. Renders each
 * surface and asks for its buttons by accessible name, which the source scan in `vocabulary.test.ts` can't
 * fully check.
 */

const CALENDAR: CodexCalendar = { yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] };

/** Both options on screen under the canonical names. */
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
  getSettings.mockResolvedValue({
    revealWarn: true,
    autosave: { enabled: false, intervalSeconds: 1 },
    revisionHistory: { enabled: true, windowMinutes: 10 }
  });
});

describe("The two-layer notes control names its layers the same way everywhere (5a.1 / 5c)", () => {
  it("is defined once, and these are the words", () => {
    // The definition the other tests compare against, so no literal is retyped.
    expect(BODY_LAYER.player.label).toBe("Player-visible notes");
    expect(BODY_LAYER.gm.label).toBe("GM-only notes");
  });

  /** All four journal kinds, switched by tapping the kind control. */
  for (const kind of ["Entry", "Deadline", "Downtime", "Milestone"] as const) {
    it(`says it the same way on a ${kind.toLowerCase()} as on every other kind`, async () => {
      render(
        <JournalView gmToken="gm" autosave={{ enabled: true, intervalSeconds: 1 }} pages={[]} onOpenPage={vi.fn()} />
      );
      await waitFor(() => expect(chronicle).toHaveBeenCalled());
      await userEvent.setup().click(screen.getByRole("button", { name: kind }));
      await expectCanonicalPair();
      // The player layer's accessible name follows the tab.
      expect(screen.getByRole("textbox", { name: BODY_LAYER.player.label })).toBeInTheDocument();
    });
  }

  it("says it the same way on the notes importer, which asks the same question about a destination", async () => {
    render(
      <ToastProvider>
        <BackupView gmToken="gm" onChanged={vi.fn()} />
      </ToastProvider>
    );
    await expectCanonicalPair();
    // GM first here (the import default); the order is this surface's choice, the words are not.
    expect(screen.getByRole("group", { name: "Which layer to import into" })).toBeInTheDocument();
  });
});

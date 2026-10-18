import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./atlas/AtlasMap", () => ({ AtlasMap: () => <div data-testid="map-surface" /> }));

const listPages = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    playerCodexApi: {
      ...actual.playerCodexApi,
      listPages: (...a: unknown[]) => listPages(...a),
      listMaps: async () => [],
      chronicle: async () => [],
      listConnections: async () => [],
      calendar: async () => null,
      sessions: async () => [],
      quests: async () => [],
      standing: async () => [],
      party: async () => null
    }
  };
});

import { goTo } from "../../test/route";
import { setViewport } from "../../test/viewport";
import { PlayerCodex } from "./PlayerCodex";
import { rememberLocation, resumeTarget } from "../router";

/**
 * A GM-only address must be indistinguishable from an unknown one for a player, top bar included: the
 * heading must not name the GM section.
 */

beforeEach(() => {
  listPages.mockResolvedValue([]);
  localStorage.clear();
});

/** Render the player Codex at an address and return all rendered text. */
async function textAt(path: string): Promise<string> {
  goTo(path);
  const view = render(<PlayerCodex token="player" />);
  await waitFor(() => expect(listPages).toHaveBeenCalled());
  const text = view.container.textContent ?? "";
  view.unmount();
  return text;
}

describe("A player at a GM-only address", () => {
  it.each(["/codex/audit", "/codex/templates", "/codex/templates/t1", "/codex/backup", "/codex/settings"])(
    "%s renders exactly what an unknown address renders: no GM section name anywhere",
    async (gmOnlyPath) => {
      const unknown = await textAt("/codex/zzz");
      const gmOnly = await textAt(gmOnlyPath);
      // Byte-identical: both are the same shell around the same not-found view.
      expect(gmOnly).toBe(unknown);
    }
  );

  it("never puts a GM section's name in the chrome", async () => {
    for (const path of ["/codex/audit", "/codex/templates", "/codex/backup", "/codex/settings"]) {
      const text = await textAt(path);
      expect(text, path).not.toMatch(/Reveal audit/);
      expect(text, path).not.toMatch(/Prep templates/);
      // Whole words: the not-found copy contains neither.
      expect(text, path).not.toMatch(/\bBackup\b/);
      expect(text, path).not.toMatch(/\bSettings\b/);
    }
  });

  it("titles the phone's top bar 'Codex', the same as it does for an address that means nothing", async () => {
    setViewport(390);
    goTo("/codex/audit");
    render(<PlayerCodex token="player" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.getByRole("heading", { level: 2, name: "Codex" })).toBeInTheDocument();
  });

  it("still titles the phone's top bar with the section on an address a player MAY reach", async () => {
    // Control: a guard that blanked every title would pass the tests above.
    setViewport(390);
    goTo("/codex/relationships");
    render(<PlayerCodex token="player" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(await screen.findByRole("heading", { level: 2, name: "Relationships" })).toBeInTheDocument();
  });
});

describe("Resume never volunteers a GM-only address", () => {
  it("sends a player to their own default rather than back to a GM-only address they once reached", () => {
    rememberLocation("player", "/codex/audit");
    // The app must never offer a GM-only address as a resume target.
    expect(resumeTarget("player", "/")).toBe("/table");
  });

  it("still resumes the GM there, because it is their screen", () => {
    rememberLocation("gm", "/codex/backup");
    expect(resumeTarget("gm", "/")).toBe("/codex/backup");
  });
});

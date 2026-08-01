import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./MapSurface", () => ({ MapSurface: () => <div data-testid="map-surface" /> }));

const listPages = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    playerCodexApi: {
      ...actual.playerCodexApi,
      listPages: (...a: unknown[]) => listPages(...a),
      listMaps: async () => [], chronicle: async () => [], listConnections: async () => [],
      calendar: async () => null, sessions: async () => [], quests: async () => [],
      standing: async () => [], party: async () => null
    }
  };
});

import { goTo } from "../../test/route";
import { PlayerCodex } from "./PlayerCodex";
import { rememberLocation, resumeTarget } from "../router";

/**
 * **Invariant §3.2 — a GM-only address must be indistinguishable from an address that does not exist.**
 *
 * Not "refused", not "forbidden": indistinguishable. A 403-shaped answer tells the player the surface is
 * real and that they are the wrong person to see it; the not-found view tells them nothing. The whole
 * point is that `/codex/audit` and `/codex/zzz` are the same experience.
 *
 * The leak was the TOP BAR. `gmOnly` gated the body but not the heading, so a player who typed or was
 * sent `/codex/audit` read "Reveal audit" above the not-found card — and `/codex/backup` read "Backup",
 * and `/codex/settings` read "Settings" — while a genuinely unknown child read "Codex". Three GM
 * surfaces confirmed to exist, and named, from an address alone. No test rendered the player surface at
 * a GM-only address; `router.test.ts` covered only the predicate.
 */

beforeEach(() => { listPages.mockResolvedValue([]); localStorage.clear(); });

/** Render the player Codex at an address and return the whole rendered text. */
async function textAt(path: string): Promise<string> {
  goTo(path);
  const view = render(<PlayerCodex token="player" />);
  await waitFor(() => expect(listPages).toHaveBeenCalled());
  const text = view.container.textContent ?? "";
  view.unmount();
  return text;
}

describe("A player at a GM-only address", () => {
  it.each(["/codex/audit", "/codex/backup", "/codex/settings"])(
    "%s renders exactly what an unknown address renders — no GM section name anywhere",
    async (gmOnlyPath) => {
      const unknown = await textAt("/codex/zzz");
      const gmOnly = await textAt(gmOnlyPath);
      // Byte-identical is the standard the invariant asks for, and it is achievable here: both are the
      // same shell around the same not-found view.
      expect(gmOnly).toBe(unknown);
    }
  );

  it("never puts a GM section's name in the chrome", async () => {
    for (const path of ["/codex/audit", "/codex/backup", "/codex/settings"]) {
      const text = await textAt(path);
      expect(text, path).not.toMatch(/Reveal audit/);
      // "Backup" and "Settings" as whole words: the not-found copy contains neither.
      expect(text, path).not.toMatch(/\bBackup\b/);
      expect(text, path).not.toMatch(/\bSettings\b/);
    }
  });

  it("titles the bar 'Codex', the same as it does for an address that means nothing", async () => {
    goTo("/codex/audit");
    render(<PlayerCodex token="player" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.getByRole("heading", { level: 2, name: "Codex" })).toBeInTheDocument();
  });

  it("still titles the bar with the section on an address a player MAY reach", async () => {
    // The control. A guard that blanked every title would pass the three tests above and be useless.
    goTo("/codex/journal");
    render(<PlayerCodex token="player" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.getByRole("heading", { level: 2, name: "Journal" })).toBeInTheDocument();
  });
});

describe("Resume never volunteers a GM-only address (D2 + §3.2)", () => {
  it("sends a player to their own default rather than back to a GM-only address they once reached", () => {
    rememberLocation("player", "/codex/audit");
    // The not-found view would catch it, but being SENT there on sign-in is a worse shape than typing
    // it: the app would be offering the address rather than declining to answer it.
    expect(resumeTarget("player", "/")).toBe("/table");
  });

  it("still resumes the GM there, because it is their screen", () => {
    rememberLocation("gm", "/codex/audit");
    expect(resumeTarget("gm", "/")).toBe("/codex/audit");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../lib/command", () => ({ command: vi.fn(async () => ({ ok: true })), read: vi.fn() }));
vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));
vi.mock("../integrations/CredentialsTable", () => ({ CredentialsTable: () => <p>The credentials table</p> }));
vi.mock("../integrations/ApiReference", () => ({ ApiReference: () => <p>The operations table</p> }));
vi.mock("../components/JoinAddress", () => ({ JoinAddress: () => <p>The join address</p> }));

const codex = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
  importBundle: vi.fn()
}));
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    jsonRequest: vi.fn(async (path: string) => {
      if (path !== "/api/v1/openapi.json") throw new Error("not here");
      return {
        openapi: "3.1.0",
        paths: {
          "/api/v1/a": { get: { operationId: "a", tags: ["Actors"] }, post: { operationId: "b", tags: ["Actors"] } },
          "/api/v1/c": { get: { operationId: "c", tags: ["Codex"] } }
        }
      };
    })
  };
});
vi.mock("../codex/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../codex/api")>();
  return { ...actual, codexApi: { ...actual.codexApi, ...codex } };
});

import { GameStateSchema, type GmView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { setViewport } from "../../test/viewport";
import { isGmOnlyPath, isKnownPath, useRoute } from "../router";
import { searchSettings, settingsFor } from "./sections";
import { SettingsPage } from "./SettingsPage";

const SETTINGS = {
  revisionHistory: { enabled: true, windowMinutes: 10, versionCount: 12, versionBytes: 3072 },
  autosave: { enabled: true, intervalSeconds: 1 }
};

function Page({ role = "gm" }: Readonly<{ role?: "gm" | "player" }>) {
  useRoute();
  const state = GameStateSchema.parse({ schemaVersion: 1 }) as unknown as GmView;
  return <SettingsPage role={role} state={state} gmToken={role === "gm" ? "gm" : null} onSignOut={() => {}} />;
}
const renderAt = (path: string, role: "gm" | "player" = "gm") => {
  goTo(path);
  return render(
    <ToastProvider>
      <Page role={role} />
    </ToastProvider>
  );
};

beforeEach(() => {
  for (const fn of Object.values(codex)) fn.mockReset();
  codex.getSettings.mockResolvedValue(SETTINGS);
  codex.setSettings.mockImplementation(async (_token: string, input: typeof SETTINGS) => ({ ...SETTINGS, ...input }));
});

describe("The Codex's tools in Settings", () => {
  it("lists the five tools as the Codex group, and opens each as its own page", async () => {
    const user = userEvent.setup();
    renderAt("/settings/codex/backup");
    const tools = within(screen.getByRole("navigation", { name: "Codex tools" }));
    expect(tools.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Backup",
      "Restore",
      "Bring in notes",
      "Autosave",
      "Version history"
    ]);
    expect(tools.getByRole("link", { name: /^Backup/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Backup", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download backup" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose a backup file" })).toBeNull();

    await user.click(tools.getByRole("link", { name: /^Bring in notes/ }));
    await waitFor(() => expect(window.location.pathname).toBe("/settings/codex/notes"));
    expect(screen.getByRole("button", { name: "Choose files" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Which layer to import into" })).toBeInTheDocument();
  });

  it("counts the API's operations and says what Autosave and Version history hold, the chosen tool lit", async () => {
    renderAt("/settings/codex/autosave");
    const sections = within(screen.getByRole("navigation", { name: "Settings sections" }));
    await waitFor(() => expect(sections.getByRole("link", { name: /^API/ })).toHaveTextContent("API3"));
    const tools = within(screen.getByRole("navigation", { name: "Codex tools" }));
    await waitFor(() => expect(tools.getByRole("link", { name: /^Autosave/ })).toHaveTextContent("AutosaveOn"));
    expect(tools.getByRole("link", { name: /^Version history/ })).toHaveTextContent("Version history12");
    expect(tools.getByRole("link", { name: /^Autosave/ })).toHaveAttribute("aria-current", "page");
    // No section is lit while a tool is open.
    expect(sections.queryAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page")).toEqual([]);
  });

  it("writes autosave as today, and keeps version history's rows on their own page", async () => {
    const user = userEvent.setup();
    const view = renderAt("/settings/codex/autosave");
    await user.click(await screen.findByRole("switch", { name: "Autosave" }));
    await waitFor(() => expect(codex.setSettings).toHaveBeenCalled());
    expect(codex.setSettings.mock.calls[0][1]).toMatchObject({ autosave: { enabled: false } });
    expect(screen.queryByText("Delete old versions")).toBeNull();
    view.unmount();

    renderAt("/settings/codex/history");
    expect(await screen.findByText("Delete old versions")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Autosave" })).toBeNull();
  });

  it("asks before a restore, with every section's count, and changes nothing until told", async () => {
    const user = userEvent.setup();
    renderAt("/settings/codex/restore");
    const file = new File([JSON.stringify({ codex: { pages: [{}, {}], maps: [] } })], "old.json", {
      type: "application/json"
    });
    const input = document.querySelector<HTMLInputElement>("input[type='file']")!;
    await user.upload(input, file);
    const dialog = within(await screen.findByRole("dialog", { name: "Restore this backup?" }));
    expect(dialog.getByText(/That file contains 2 pages, 0 maps/)).toBeInTheDocument();
    expect(codex.importBundle).not.toHaveBeenCalled();
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(codex.importBundle).not.toHaveBeenCalled();
  });

  it("is found by the search, and a pick opens the tool's page", async () => {
    const found = searchSettings(settingsFor("gm"), "backup").map((entry) => entry.label);
    expect(found).toContain("Backup");
    expect(searchSettings(settingsFor("player"), "backup")).toEqual([]);

    const user = userEvent.setup();
    renderAt("/settings/players");
    await user.type(screen.getByRole("combobox", { name: "Search settings" }), "version history");
    await user.click(await screen.findByRole("option", { name: /Version history/ }));
    await waitFor(() => expect(window.location.pathname).toBe("/settings/codex/history"));
  });

  it("answers the tools' addresses for the GM only", () => {
    expect(isKnownPath("/settings/codex")).toBe(true);
    expect(isKnownPath("/settings/codex/restore")).toBe(true);
    expect(isKnownPath("/settings/codex/everything")).toBe(false);
    expect(isGmOnlyPath("/settings/codex/backup")).toBe(true);
  });

  it("shows the group on a phone's list, and a tool opens as its page", async () => {
    setViewport(390);
    const view = renderAt("/settings");
    expect(within(screen.getByRole("navigation", { name: "Codex tools" })).getAllByRole("link")).toHaveLength(5);
    view.unmount();
    renderAt("/settings/codex/autosave");
    expect(screen.getByRole("heading", { level: 1, name: "Autosave" })).toBeInTheDocument();
  });
});

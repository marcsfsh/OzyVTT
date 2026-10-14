import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const getSettings = vi.fn();
const updatePage = vi.fn();
const markersForPage = vi.fn();
const forPage = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      getSettings: (...a: unknown[]) => getSettings(...a),
      updatePage: (...a: unknown[]) => updatePage(...a),
      markersForPage: (...a: unknown[]) => markersForPage(...a)
    },
    journalApi: { ...actual.journalApi, forPage: (...a: unknown[]) => forPage(...a) }
  };
});

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { PageEditor } from "./PageEditor";
import type { CodexPage } from "./api";

/**
 * Changing a page's kind always confirms; the body names the fields at risk or says nothing is lost. With
 * version history off, the copy must not promise a restore.
 */

const PAGE = (over: Partial<CodexPage> = {}): CodexPage => ({
  id: "p1", title: "Strahd von Zarovich", entityType: "character",
  fields: { role: "Lord of Barovia", status: "Undead" }, gmFields: {},
  folder: null, tags: [], playerBody: "", gmBody: "", revealedToPlayers: false,
  bannerAssetId: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  rev: 3, createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z", ...over
});

const renderEditor = (page = PAGE()) =>
  (goTo("/codex/pages/p1"), render)(
    <ToastProvider>
      <PageEditor
        gmToken="gm" page={page} pages={[]} connections={[]}
        autosave={{ enabled: false, intervalSeconds: 1 }}
        onChange={vi.fn()} onDeleted={vi.fn()} onNavigate={vi.fn()}
        onConnectionsChanged={vi.fn()} onOpenConnection={vi.fn()}
      />
    </ToastProvider>
  );

const dialog = () => screen.findByRole("dialog");

beforeEach(() => {
  // These tests are about the Details panel's contents, so its remembered state is seeded open.
  localStorage.setItem("codex-page-details", "open");
  getSettings.mockResolvedValue({ revealWarn: true, autosave: { enabled: false, intervalSeconds: 1 }, revisionHistory: { enabled: true, windowMinutes: 10 } });
  updatePage.mockImplementation(async (_t: string, _id: string, input: Record<string, unknown>) => ({ ...PAGE(), ...input, rev: 4 }));
  markersForPage.mockResolvedValue([]);
  forPage.mockResolvedValue([]);
});

describe("Changing a page's kind (R7)", () => {
  it("asks even when NOTHING would be lost — the prompt is unconditional", async () => {
    const user = userEvent.setup();
    // A note has no typed fields, so switching to a character drops nothing.
    renderEditor(PAGE({ entityType: "note", fields: {} }));
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText(/kind/i), "character");

    const box = within(await dialog());
    expect(box.getByText(/Change kind to Character\?/i)).toBeInTheDocument();
    expect(box.getByText(/Nothing you have written is lost/i)).toBeInTheDocument();
  });

  it("names the fields at risk when text WOULD be dropped", async () => {
    const user = userEvent.setup();
    renderEditor();                                   // a character with Role and Status filled in
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText(/kind/i), "item");

    const box = within(await dialog());
    // The fields at risk are named.
    expect(box.getByText(/Role/i)).toBeInTheDocument();
    expect(box.getByText(/restore them from History/i)).toBeInTheDocument();
  });

  it("counts only fields that actually HAVE text — an empty field is not a loss", async () => {
    const user = userEvent.setup();
    renderEditor(PAGE({ fields: { role: "   ", status: "" } }));
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText(/kind/i), "item");

    const box = within(await dialog());
    expect(box.getByText(/Nothing you have written is lost/i)).toBeInTheDocument();
  });

  it("SOFTENS the recovery promise when version history is off, rather than repeating it", async () => {
    // With history off there is no snapshot, so the copy must not reassure.
    getSettings.mockResolvedValue({ revealWarn: true, autosave: { enabled: false, intervalSeconds: 1 }, revisionHistory: { enabled: false, windowMinutes: 10 } });
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText(/kind/i), "item");

    const box = within(await dialog());
    expect(box.getByText(/Version history is off, so this cannot be undone/i)).toBeInTheDocument();
    expect(box.queryByText(/restore them from History/i)).not.toBeInTheDocument();
  });

  it("leaves the kind ALONE when the GM cancels", async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText(/kind/i), "item");
    await user.click(within(await dialog()).getByRole("button", { name: /cancel/i }));

    // The control snaps back and nothing is written.
    await waitFor(() => expect(screen.getByLabelText(/kind/i)).toHaveValue("character"));
    expect(updatePage).not.toHaveBeenCalled();
  });

  it("changes the kind and prunes the draft's dead fields on confirm", async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText(/kind/i), "item");
    await user.click(within(await dialog()).getByRole("button", { name: "Change kind" }));

    await waitFor(() => expect(screen.getByLabelText(/kind/i)).toHaveValue("item"));
    // The draft is pruned the way the server prunes on save, so no field shows that the next save deletes.
    expect(screen.queryByLabelText(/^Role/i)).not.toBeInTheDocument();
  });

  it("does not ask when the kind did not actually change", async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText(/kind/i), "character");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

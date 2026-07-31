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
 * R7 — changing a page's KIND asks first, **unconditionally**.
 *
 * The version this replaces asked only when the change would drop text, which sounds thriftier and is
 * the wrong shape twice over. A GM who has learned that the control is silent gets no warning on the one
 * occasion it matters; and "would this drop text?" is a judgement the dialog is better placed to explain
 * than to make on the GM's behalf. So the prompt is unconditional and the BODY is what varies: it names
 * the fields at risk when there are any, and says plainly that nothing is lost when there are not.
 *
 * The recovery promise is a hard one, and it is the server that keeps it: a type-changing save forces a
 * revision snapshot, bypassing the coalescing window, so "restore them from History" is literally true.
 * When the GM has switched version history off the copy softens rather than lying — which is the case
 * most worth testing, because it is the one where a stale reassurance would cost real work.
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
  getSettings.mockResolvedValue({ revealWarn: true, autosave: { enabled: false, intervalSeconds: 1 }, revisionHistory: { enabled: true, windowMinutes: 10 } });
  updatePage.mockImplementation(async (_t: string, _id: string, input: Record<string, unknown>) => ({ ...PAGE(), ...input, rev: 4 }));
  markersForPage.mockResolvedValue([]);
  forPage.mockResolvedValue([]);
});

describe("Changing a page's kind (R7)", () => {
  it("asks even when NOTHING would be lost — the prompt is unconditional", async () => {
    const user = userEvent.setup();
    // A note has no typed fields of its own, so switching a note to a character drops nothing at all.
    renderEditor(PAGE({ entityType: "note", fields: {} }));
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText(/kind/i), "character");

    const box = within(await dialog());
    expect(box.getByText(/Change kind to Character\?/i)).toBeInTheDocument();
    // ...and it says so, rather than implying a cost that is not there.
    expect(box.getByText(/Nothing you've written is lost/i)).toBeInTheDocument();
  });

  it("names the fields at risk when text WOULD be dropped", async () => {
    const user = userEvent.setup();
    renderEditor();                                   // a character with Role and Status filled in
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText(/kind/i), "item");

    const box = within(await dialog());
    // Naming them is the point: "some fields will be removed" is not something a GM can act on.
    expect(box.getByText(/Role/i)).toBeInTheDocument();
    expect(box.getByText(/restore them from History/i)).toBeInTheDocument();
  });

  it("counts only fields that actually HAVE text — an empty field is not a loss", async () => {
    const user = userEvent.setup();
    renderEditor(PAGE({ fields: { role: "   ", status: "" } }));
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText(/kind/i), "item");

    const box = within(await dialog());
    expect(box.getByText(/Nothing you've written is lost/i)).toBeInTheDocument();
  });

  it("SOFTENS the recovery promise when version history is off, rather than repeating it", async () => {
    // The one that matters most. With history off there is no snapshot to restore from, so the
    // reassuring copy would be a lie told at exactly the moment the GM is deciding whether to proceed.
    getSettings.mockResolvedValue({ revealWarn: true, autosave: { enabled: false, intervalSeconds: 1 }, revisionHistory: { enabled: false, windowMinutes: 10 } });
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText(/kind/i), "item");

    const box = within(await dialog());
    expect(box.getByText(/version history is off, so this can't be undone/i)).toBeInTheDocument();
    expect(box.queryByText(/restore them from History/i)).not.toBeInTheDocument();
  });

  it("leaves the kind ALONE when the GM cancels", async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText(/kind/i), "item");
    await user.click(within(await dialog()).getByRole("button", { name: /cancel/i }));

    // Both halves: the control snaps back, and no write went out. A select that stays on the new value
    // after a cancel is the worst outcome — it shows a kind the page does not have.
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
    // The client prunes to match the server, which prunes to the effective kind on every save that
    // touches fields or the kind. Leaving the stripped values in the draft would show the GM a field
    // the very next save deletes.
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

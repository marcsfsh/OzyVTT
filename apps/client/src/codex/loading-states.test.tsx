import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./api", async (actual) => (await import("../../test/codex-fakes")).fakeApiModule(await actual()));
vi.mock("./api-records", async () => (await import("../../test/codex-fakes")).fakeRecordsModule());

import { api, records, resetFakes, summary } from "../../test/codex-fakes";
import { renderGmCodex } from "../../test/codex-render";

/** A promise the test settles by hand, so a view can be looked at while its read is still open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

beforeEach(() => {
  localStorage.clear();
  resetFakes();
});

describe("Codex loading states: a read still open never reads as empty", () => {
  it("Home offers no first page while its counts are still loading", async () => {
    const home = deferred<unknown>();
    records.findApi.home.mockReturnValue(home.promise);
    renderGmCodex("/codex");
    await waitFor(() => expect(records.findApi.home).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Make your first page" })).not.toBeInTheDocument();

    home.resolve({
      collections: [{ type: "character", revealed: 1, hidden: 0 }],
      recent: [],
      revealCheck: { rows: [], total: 0 }
    });
    // The People region is already there with zeros while the read is open, so wait for the count itself.
    await waitFor(() => expect(screen.getByRole("region", { name: "People" })).toHaveTextContent("1 revealed"));
    expect(screen.queryByRole("region", { name: "Make your first page" })).not.toBeInTheDocument();
  });

  it("still offers the first page once the read settles with no pages", async () => {
    renderGmCodex("/codex");
    expect(await screen.findByRole("region", { name: "Make your first page" })).toBeInTheDocument();
  });

  it("Relationships says it is loading, then that there are no pages once that is true", async () => {
    const pages = deferred<unknown[]>();
    api.codexApi.listPages.mockReturnValue(pages.promise);
    renderGmCodex("/codex/relationships");
    expect(await screen.findByText("Loading the pages.")).toBeInTheDocument();
    expect(screen.queryByText(/No pages yet/)).not.toBeInTheDocument();
    pages.resolve([]);
    expect(await screen.findByText(/No pages yet/)).toBeInTheDocument();
  });

  it("Pages says it is loading, then lists what arrived", async () => {
    const pages = deferred<unknown[]>();
    api.codexApi.listPages.mockReturnValue(pages.promise);
    renderGmCodex("/codex/pages");
    expect(await screen.findByText("Loading the pages.")).toBeInTheDocument();
    expect(screen.queryByText("No pages here yet.")).not.toBeInTheDocument();
    pages.resolve([summary({ title: "Strahd" })]);
    expect(await screen.findByText("Strahd")).toBeInTheDocument();
  });
});

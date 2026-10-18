import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./api", async (actual) => (await import("../../test/codex-fakes")).fakeApiModule(await actual()));
vi.mock("./api-records", async () => (await import("../../test/codex-fakes")).fakeRecordsModule());

import { api, records, resetFakes, summary } from "../../test/codex-fakes";
import { renderGmCodex } from "../../test/codex-render";

const PAGES = [
  summary({ id: "p1", title: "Strahd", entityType: "character" }),
  summary({ id: "p2", title: "Barovia", entityType: "location" })
];

const list = () => within(document.querySelector(".cx-pagelist") as HTMLElement);

beforeEach(() => {
  localStorage.clear();
  resetFakes();
  api.codexApi.listPages.mockResolvedValue(PAGES);
  records.findApi.home.mockResolvedValue({
    collections: [
      { type: "character", revealed: 1, hidden: 0 },
      { type: "location", revealed: 1, hidden: 0 }
    ],
    recent: [],
    revealCheck: { rows: [], total: 0 }
  });
});

describe("Codex shell: getting from Home to the pages", () => {
  it("switches section when a section is chosen", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/quests");
    await waitFor(() => expect(api.codexApi.listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Home" }));
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });

  it("prepares its destination: a collection on Home opens Pages with only that group listed", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex");
    await user.click(await screen.findByRole("button", { name: "Open People" }));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/pages"));
    expect(window.location.search).toBe("?group=people");
    expect(await screen.findByRole("heading", { level: 1, name: "People" })).toBeInTheDocument();
    expect(list().getByText("Strahd")).toBeInTheDocument();
    expect(list().queryByText("Barovia")).not.toBeInTheDocument();
  });

  it("clearing the group lists every page again", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/pages?group=people");
    expect(await screen.findByRole("heading", { level: 1, name: "People" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^People/ }));
    expect(window.location.search).toBe("");
    expect(await list().findByText("Barovia")).toBeInTheDocument();
  });
});

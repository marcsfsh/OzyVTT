import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./atlas/AtlasMap", () => ({ AtlasMap: () => <div data-testid="map-surface" /> }));

vi.mock("./api", async (actual) => (await import("../../test/codex-fakes")).fakeApiModule(await actual()));
vi.mock("./api-records", async () => (await import("../../test/codex-fakes")).fakeRecordsModule());

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { setViewport } from "../../test/viewport";
import { CodexShell } from "./CodexShell";
import { codexBar } from "./routes";
import { ACTORS, api, page, records, resetFakes, summary } from "../../test/codex-fakes";

const listPages = api.codexApi.listPages;
const getPage = records.pageRecordApi.get;
const createPreviewSession = api.codexApi.createPreviewSession;

const renderShell = (at: string) =>
  (goTo(at), render)(
    <ToastProvider>
      <CodexShell gmToken="gm" actors={ACTORS} />
    </ToastProvider>
  );

beforeEach(() => {
  localStorage.clear();
  resetFakes();
  listPages.mockResolvedValue([summary()]);
  getPage.mockResolvedValue({ page: page(), connections: [] });
});

const bar = () => within(screen.getByRole("navigation", { name: "Codex sections" }));
const lit = () =>
  bar()
    .queryAllByRole("tab")
    .filter((tab) => tab.getAttribute("aria-selected") === "true");

describe("The laptop's section bar", () => {
  it.each(codexBar("gm").map((item) => [item.label, item.path] as const))(
    "%s opens at %s with exactly one section lit",
    async (label, path) => {
      const user = userEvent.setup();
      renderShell(label === "Home" ? "/codex/quests" : "/codex");
      await waitFor(() => expect(listPages).toHaveBeenCalled());

      await user.click(bar().getByRole("tab", { name: label }));
      await waitFor(() => expect(window.location.pathname).toBe(path));
      expect(lit()).toHaveLength(1);
      expect(lit()[0]).toHaveAccessibleName(label);
    }
  );

  it("renders each section straight from its address, with no navigation first", async () => {
    for (const item of codexBar("gm")) {
      const view = renderShell(item.path);
      await waitFor(() => expect(lit()[0]).toHaveAccessibleName(item.label));
      view.unmount();
    }
  });

  it("lights Story for each of Story's views", async () => {
    for (const path of ["/codex/story", "/codex/timeline", "/codex/sessions"]) {
      const view = renderShell(path);
      await waitFor(() => expect(lit()[0]).toHaveAccessibleName("Story"));
      view.unmount();
    }
  });

  it("lights Pages for a page, and nothing for search, which is the bar's field", async () => {
    const view = renderShell("/codex/pages/p1");
    await waitFor(() => expect(getPage).toHaveBeenCalledWith("gm", "p1"));
    expect(lit().map((tab) => tab.textContent)).toEqual(["Pages"]);
    view.unmount();
    renderShell("/codex/search");
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(lit()).toHaveLength(0);
    expect(bar().queryByRole("tab", { name: "Search" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Search the Codex/ })).toBeInTheDocument();
  });

  it("leaves the Compendium out of the GM's bar, since it is a section of its own", async () => {
    renderShell("/codex");
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(bar().queryByRole("tab", { name: "Compendium" })).not.toBeInTheDocument();
  });

  it("has no left rail and no page tree", async () => {
    renderShell("/codex");
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.getAllByRole("navigation", { name: "Codex sections" })).toHaveLength(1);
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
  });

  it("shows the not-found view for a codex address that does not exist, with nothing lit", async () => {
    renderShell("/codex/notebook");
    // The empty state's one line and one secondary button (frame rule 3.7).
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/^Nothing lives at this address\.Go to the table$/);
    expect(within(status).getByRole("button", { name: "Go to the table" })).toBeInTheDocument();
    expect(lit()).toHaveLength(0);
  });
});

describe("The bar's More and New", () => {
  it("holds Prep templates, Backup, Autosave and history, and See the Codex as players for Everyone and each character", async () => {
    const user = userEvent.setup();
    renderShell("/codex");
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    await user.click(screen.getByLabelText("More in the Codex"));
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(
      expect.arrayContaining([
        "Prep templates",
        "Backup",
        "Autosave and history",
        "See the Codex as players: Everyone",
        "See the Codex as Lyra Emberwise"
      ])
    );
    // An archived character and a monster are no audience.
    expect(items).not.toContain("See the Codex as Old Tam");
    expect(items).not.toContain("See the Codex as Wolf");

    await user.click(screen.getByRole("menuitem", { name: "Backup" }));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/backup"));
    expect(lit()).toHaveLength(0);
  });

  it("opens the player Codex on a preview token for the chosen character", async () => {
    const user = userEvent.setup();
    renderShell("/codex");
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    await user.click(screen.getByLabelText("More in the Codex"));
    await user.click(screen.getByRole("menuitem", { name: "See the Codex as Lyra Emberwise" }));
    await waitFor(() => expect(createPreviewSession).toHaveBeenCalledWith("gm", "a-lyra"));
    expect(await screen.findByRole("dialog", { name: "Player Codex preview" })).toBeInTheDocument();
    // The preview's address is its own: the GM stays where they were.
    expect(window.location.pathname).toBe("/codex");
  });

  it("offers a new page, quest and session under New", async () => {
    const user = userEvent.setup();
    renderShell("/codex");
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByText("New"));
    for (const name of ["New page", "New quest", "New session"])
      expect(screen.getByRole("menuitem", { name })).toBeInTheDocument();
  });
});

describe("Addresses from before the remaster", () => {
  it.each([
    ["/codex/graph?focus=p1", "/codex/relationships", "?focus=p1"],
    ["/codex/journal?entry=e1", "/codex/story", "?entry=e1"],
    ["/codex/calendar?y=1492&m=3", "/codex/story", "?y=1492&m=3"],
    ["/codex/downtime", "/codex/story", "?tab=downtime"],
    ["/codex/audit", "/codex/search", "?visibility=hidden"]
  ])("%s lands at %s%s, replacing itself", async (from, path, search) => {
    const depth = window.history.length;
    renderShell(from);
    await waitFor(() => expect(window.location.pathname).toBe(path));
    expect(window.location.search).toBe(search);
    expect(window.history.length).toBe(depth);
  });
});

describe("The browser's own buttons", () => {
  it("goes back to the previous section, and forward again", async () => {
    const user = userEvent.setup();
    renderShell("/codex");
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    await user.click(bar().getByRole("tab", { name: "Quests" }));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/quests"));
    await user.click(bar().getByRole("tab", { name: "Story" }));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/story"));

    window.history.back();
    await waitFor(() => expect(lit()[0]).toHaveAccessibleName("Quests"));
    window.history.forward();
    await waitFor(() => expect(lit()[0]).toHaveAccessibleName("Story"));
  });

  it("does not stack a history entry when the section already open is chosen again", async () => {
    const user = userEvent.setup();
    renderShell("/codex/quests");
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    const depth = window.history.length;

    await user.click(bar().getByRole("tab", { name: "Quests" }));
    expect(window.history.length).toBe(depth);
  });
});

describe("The phone's strip of pages", () => {
  beforeEach(() => setViewport(390));

  it("runs the same pages under the header as a strip of words, with the section's page on", async () => {
    renderShell("/codex/story");
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(
      bar()
        .getAllByRole("tab")
        .map((tab) => tab.textContent)
    ).toEqual(["Home", "Pages", "Atlas", "Story", "Quests", "Relationships"]);
    expect(lit().map((tab) => tab.textContent)).toEqual(["Story"]);
    // Campaign and its parts are gone.
    expect(screen.queryByRole("navigation", { name: "Campaign" })).not.toBeInTheDocument();
  });

  it("titles the top bar with the section when the view has no bar of its own", async () => {
    renderShell("/codex/backup");
    expect(await screen.findByRole("heading", { level: 1, name: "Backup" })).toBeInTheDocument();
  });

  it("keeps Search, New and More on a section's own header", async () => {
    renderShell("/codex");
    expect(await screen.findByRole("heading", { level: 2, name: "Codex" })).toBeInTheDocument();
    expect(screen.getByLabelText("More in the Codex")).toBeInTheDocument();
    expect(screen.getByLabelText("New")).toBeInTheDocument();
    expect(
      within(document.querySelector(".secbar-head") as HTMLElement).getByRole("button", { name: "Search" })
    ).toBeInTheDocument();
  });

  it("keeps New and More reachable from the header", async () => {
    renderShell("/codex/story");
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.getByLabelText("More in the Codex")).toBeInTheDocument();
    expect(screen.getByLabelText("New")).toBeInTheDocument();
  });
});

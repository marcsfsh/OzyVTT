import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./MapSurface", () => ({ MapSurface: () => <div data-testid="map-surface" /> }));

vi.mock("./api", async (actual) => (await import("../../test/codex-fakes")).fakeApiModule(await actual()));
vi.mock("./api-records", async () => (await import("../../test/codex-fakes")).fakeRecordsModule());

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { setViewport } from "../../test/viewport";
import { CodexShell } from "./CodexShell";
import { CODEX_BAR } from "./routes";
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
    .queryAllByRole("button")
    .filter((button) => button.getAttribute("aria-current") === "page");

describe("The laptop's section bar", () => {
  it.each(CODEX_BAR.map((item) => [item.label, item.path] as const))(
    "%s opens at %s with exactly one section lit",
    async (label, path) => {
      const user = userEvent.setup();
      renderShell(label === "Home" ? "/codex/quests" : "/codex");
      await waitFor(() => expect(listPages).toHaveBeenCalled());

      await user.click(bar().getByRole("button", { name: label }));
      await waitFor(() => expect(window.location.pathname).toBe(path));
      expect(lit()).toHaveLength(1);
      expect(lit()[0]).toHaveAccessibleName(label);
    }
  );

  it("renders each section straight from its address, with no navigation first", async () => {
    for (const item of CODEX_BAR) {
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

  it("lights nothing for a page, which opens from Search or a link", async () => {
    renderShell("/codex/pages/p1");
    await waitFor(() => expect(getPage).toHaveBeenCalledWith("gm", "p1"));
    expect(lit()).toHaveLength(0);
  });

  it("has no left rail and no page tree", async () => {
    renderShell("/codex");
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.getAllByRole("navigation", { name: "Codex sections" })).toHaveLength(1);
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
  });

  it("shows the not-found view for a codex address that does not exist, with nothing lit", async () => {
    renderShell("/codex/notebook");
    expect(await screen.findByRole("heading", { name: /Nothing lives at this address/i })).toBeInTheDocument();
    expect(lit()).toHaveLength(0);
  });
});

describe("The GM menu and New", () => {
  it("holds Prep templates, Backup, Autosave and history, and See as players for Everyone and each character", async () => {
    const user = userEvent.setup();
    renderShell("/codex");
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    await user.click(screen.getByText("GM menu"));
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(
      expect.arrayContaining([
        "Prep templates",
        "Backup",
        "Autosave and history",
        "See as players: Everyone",
        "See as Lyra Emberwise"
      ])
    );
    // An archived character and a monster are no audience.
    expect(items).not.toContain("See as Old Tam");
    expect(items).not.toContain("See as Wolf");

    await user.click(screen.getByRole("menuitem", { name: "Backup" }));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/backup"));
    expect(lit()).toHaveLength(0);
  });

  it("opens the player Codex on a preview token for the chosen character", async () => {
    const user = userEvent.setup();
    renderShell("/codex");
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    await user.click(screen.getByText("GM menu"));
    await user.click(screen.getByRole("menuitem", { name: "See as Lyra Emberwise" }));
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
    ["/codex/downtime", "/codex/story", "?kind=downtime"],
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

    await user.click(bar().getByRole("button", { name: "Quests" }));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/quests"));
    await user.click(bar().getByRole("button", { name: "Story" }));
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

    await user.click(bar().getByRole("button", { name: "Quests" }));
    expect(window.history.length).toBe(depth);
  });
});

describe("The phone's tab bar under the thumb", () => {
  beforeEach(() => setViewport(390));

  it("has Home, Pages, Atlas, Campaign and Search, with the section's tab on", async () => {
    renderShell("/codex/pages/p1");
    await waitFor(() => expect(getPage).toHaveBeenCalled());
    expect(
      bar()
        .getAllByRole("button")
        .map((tab) => tab.textContent)
    ).toEqual(["Home", "Pages", "Atlas", "Campaign", "Search"]);
    expect(lit().map((tab) => tab.textContent)).toEqual(["Pages"]);
    // The laptop's section bar is gone.
    expect(screen.queryByRole("button", { name: "Relationships" })).not.toBeInTheDocument();
  });

  it("switches Campaign's four parts under the top bar, and Campaign reopens the last one", async () => {
    const user = userEvent.setup();
    const view = renderShell("/codex/story");
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    const campaign = within(screen.getByRole("navigation", { name: "Campaign" }));
    expect(campaign.getAllByRole("button").map((part) => part.textContent)).toEqual([
      "Story",
      "Quests",
      "Relationships",
      "Sessions"
    ]);
    expect(lit().map((tab) => tab.textContent)).toEqual(["Campaign"]);

    await user.click(campaign.getByRole("button", { name: "Relationships" }));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/relationships"));
    await user.click(bar().getByRole("button", { name: "Home" }));
    await waitFor(() => expect(window.location.pathname).toBe("/codex"));
    expect(screen.queryByRole("navigation", { name: "Campaign" })).not.toBeInTheDocument();

    await user.click(bar().getByRole("button", { name: "Campaign" }));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/relationships"));
    view.unmount();
  });

  it("titles the top bar with the section when the view has no bar of its own", async () => {
    renderShell("/codex/backup");
    expect(await screen.findByRole("heading", { level: 2, name: "Backup" })).toBeInTheDocument();
  });

  it("keeps New, the GM menu and Search on a section's own top bar", async () => {
    renderShell("/codex");
    expect(await screen.findByRole("heading", { level: 2, name: "Codex" })).toBeInTheDocument();
    expect(screen.getByLabelText("GM menu")).toBeInTheDocument();
    expect(screen.getByLabelText("New")).toBeInTheDocument();
    expect(
      within(document.querySelector(".cx-phonebar") as HTMLElement).getByRole("button", { name: "Search" })
    ).toBeInTheDocument();
  });

  it("keeps New and the GM menu reachable from the top bar", async () => {
    renderShell("/codex/story");
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.getByLabelText("GM menu")).toBeInTheDocument();
    expect(screen.getByLabelText("New")).toBeInTheDocument();
  });
});

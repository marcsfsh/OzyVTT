import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }) as Record<string, unknown>);
vi.mock("../lib/command", () => ({ command: (...args: unknown[]) => command(...args), read: vi.fn() }));
vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));
// The sections' fetching neighbours, which have tests of their own.
vi.mock("../integrations/CredentialsTable", () => ({ CredentialsTable: () => <p>The credentials table</p> }));
vi.mock("../integrations/ApiReference", () => ({ ApiReference: () => <p>The operations table</p> }));
vi.mock("../components/JoinAddress", () => ({ JoinAddress: () => <p>The join address</p> }));

import { GameStateSchema, type GmView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { useRoute } from "../router";
import { SETTING, type SettingsSectionId } from "./sections";
import { SettingsPage } from "./SettingsPage";

function gmView(change: (state: GmView) => void = () => {}): GmView {
  const state = GameStateSchema.parse({ schemaVersion: 1 }) as unknown as GmView;
  change(state);
  return state;
}

/** The page follows the address, as the shell renders it. */
function Page(props: Partial<Parameters<typeof SettingsPage>[0]>) {
  useRoute();
  return <SettingsPage role="gm" state={gmView()} gmToken="gm" onSignOut={() => {}} {...props} />;
}
const renderAt = (path: string, props: Partial<Parameters<typeof SettingsPage>[0]> = {}) => {
  goTo(path);
  return render(
    <ToastProvider>
      <Page {...props} />
    </ToastProvider>
  );
};

beforeEach(() => {
  command.mockClear();
});

describe("the GM's Settings", () => {
  it("lists the sections in the side list and opens Players at /settings", async () => {
    const user = userEvent.setup();
    renderAt("/settings");
    const list = screen.getByRole("navigation", { name: "Settings sections" });
    const sections = within(list).getAllByRole("link");
    // Each row is its name with a count where one helps: who is at the table, the checks the assistant makes.
    expect(sections.map((section) => section.textContent)).toEqual([
      "Players0",
      "Encounters6",
      "Characters",
      "Device",
      "Access",
      "API"
    ]);
    expect(within(list).getByRole("link", { name: /^Players/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Players", level: 2 })).toBeInTheDocument();
    // The head says what the section holds now.
    expect(screen.getByText("Join address · name and class · 0 at the table")).toBeInTheDocument();

    await user.click(within(list).getByRole("link", { name: /^Encounters/ }));
    expect(window.location.pathname).toBe("/settings/fights");
    expect(screen.getByRole("heading", { name: "Rules assistant", level: 3 })).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: /^Encounters/ })).toHaveAttribute("aria-current", "page");
  });

  it.each(["players", "fights", "characters", "device", "access"] as const)(
    "shows every %s setting with its plain label and one sentence of hint",
    (section: SettingsSectionId) => {
      renderAt(`/settings/${section}`);
      const shown = Object.values(SETTING).filter(
        (setting) => setting.section === section && setting.id !== "leaveTable"
      );
      expect(shown.length).toBeGreaterThan(0);
      for (const setting of shown) {
        expect(screen.getByRole("heading", { name: new RegExp(`^${setting.label}`), level: 3 })).toBeInTheDocument();
        expect(screen.getByText(setting.hint)).toBeInTheDocument();
      }
    }
  );

  it("drops the GM only tag from GM sections, which players never see, and keeps it on the GM's row in Device", async () => {
    renderAt("/settings/fights");
    expect(screen.getByRole("heading", { name: "Encounters", level: 2 }).closest("header")).not.toHaveTextContent(
      "GM only"
    );
    act(() => goTo("/settings/device"));
    expect(await screen.findByRole("heading", { name: /^Arrange new encounters/, level: 3 })).toHaveTextContent(
      "GM only"
    );
    expect(screen.getByRole("heading", { name: "Device", level: 2 }).closest("header")).not.toHaveTextContent(
      "GM only"
    );
  });

  it("puts one primary in the bar, the view's own: New credential in Access", () => {
    const { container } = renderAt("/settings/access");
    const primaries = container.querySelectorAll(".nh-btn--primary");
    expect([...primaries].map((button) => button.textContent)).toEqual(["New credential"]);
    expect(primaries[0].closest(".secbar")).not.toBeNull();
    act(() => goTo("/settings/fights"));
    expect(container.querySelectorAll(".nh-btn--primary")).toHaveLength(0);
  });

  it("finds a setting by any of its words and opens its section on it", async () => {
    const user = userEvent.setup();
    renderAt("/settings/players");
    const search = screen.getByRole("combobox", { name: "Search settings" });
    await user.type(search, "password");
    const options = within(screen.getByRole("listbox", { name: "Matching settings" })).getAllByRole("option");
    expect(options[0]).toHaveTextContent("GM password");
    expect(options[0]).toHaveTextContent("Access");
    await user.keyboard("{Enter}");
    expect(window.location.pathname).toBe("/settings/access");
    expect(document.activeElement?.id).toBe("setting-gmPassword");
    expect(search).toHaveValue("");
  });

  // Ctrl K is the app's one search now (ADR-0049); this field stays the page's own filter.
  it("says when nothing matches", async () => {
    const user = userEvent.setup();
    renderAt("/settings/fights");
    const search = screen.getByRole("combobox", { name: "Search settings" });
    await user.type(search, "zeppelin");
    expect(screen.getByRole("status")).toHaveTextContent('No setting matches "zeppelin".');
  });

  it("lists the claimed characters with what the GM can do for each, and previews the table screen", async () => {
    const user = userEvent.setup();
    const onPreviewPlayers = vi.fn();
    const state = gmView((view) => {
      // The fields the rows read; the rest of a character is not this test's business.
      view.actors = [
        {
          id: "a1",
          name: "Lyra Emberwise",
          kind: "player-character",
          archived: false,
          ownerSessionId: "s1",
          presence: "online"
        }
      ] as unknown as GmView["actors"];
    });
    renderAt("/settings/players", { state, onPreviewPlayers });
    const table = screen.getByRole("table");
    const row = within(table).getAllByRole("row")[1];
    expect(row).toHaveTextContent("Connected");
    expect(within(row).getByRole("button", { name: "Force release" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Set token image…" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Preview the table screen" }));
    expect(onPreviewPlayers).toHaveBeenCalled();
  });

  it("sends the character settings, and keeps one ability score method on", async () => {
    const user = userEvent.setup();
    renderAt("/settings/characters", {
      state: gmView((view) => {
        view.builderPolicy = { ...view.builderPolicy, allowedAbilityMethods: ["standard-array"] };
      })
    });
    await user.click(screen.getByRole("switch", { name: "Players can roll their own" }));
    expect(command).toHaveBeenLastCalledWith(
      "builder:set-policy",
      expect.objectContaining({ playerRandom: "open", allowedAbilityMethods: ["standard-array"] })
    );
    command.mockClear();
    await user.click(screen.getByRole("checkbox", { name: "Standard array" }));
    expect(command).not.toHaveBeenCalled();
    expect(await screen.findByText("Leave the players at least one way to set ability scores.")).toBeInTheDocument();
  });

  it("starts new tokens shown or hidden with the words beside the switch", async () => {
    const user = userEvent.setup();
    renderAt("/settings/fights");
    const reveal = screen.getByRole("switch", { name: "New tokens shown to players" });
    expect(reveal.closest(".setting-row")).toHaveTextContent(/Shown to players|Hidden from players/);
    await user.click(reveal);
    expect(command).toHaveBeenLastCalledWith("table:set-staging-defaults", expect.anything());
  });

  it("asks before every GM browser is signed out, through the shell's own confirm", async () => {
    const user = userEvent.setup();
    const onRevokeAll = vi.fn();
    const onSignOut = vi.fn();
    renderAt("/settings/access", { onRevokeAll, onSignOut });
    await user.click(screen.getByRole("button", { name: "Sign out every GM browser" }));
    expect(onRevokeAll).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalled();
    expect(screen.getByText("The credentials table")).toBeInTheDocument();
  });
});

describe("a player's Settings", () => {
  const renderPlayer = (path: string, onLeave = vi.fn()) => {
    goTo(path);
    render(
      <ToastProvider>
        <SettingsPage role="player" state={null} onLeave={onLeave} />
      </ToastProvider>
    );
    return onLeave;
  };

  it("is the Device section alone, with no bar, no search and no GM row", () => {
    renderPlayer("/settings");
    expect(screen.queryByRole("navigation", { name: "Settings sections" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Search settings" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Device", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
    expect(screen.queryByText(SETTING.arrangeScenes.label)).toBeNull();
    expect(screen.queryByText("GM only")).toBeNull();
  });

  it("turns Reduce transparency on for this device, and makes the page solid at once", async () => {
    const user = userEvent.setup();
    localStorage.removeItem("vtt.reduce-transparency");
    renderPlayer("/settings");
    const toggle = screen.getByRole("switch", { name: "Reduce transparency" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement).toHaveAttribute("data-transparency", "reduced");
    expect(localStorage.getItem("vtt.reduce-transparency")).toBe("on");
    await user.click(toggle);
    expect(document.documentElement).not.toHaveAttribute("data-transparency");
  });

  it("never mounts a GM section, even at its address", () => {
    renderPlayer("/settings/fights");
    expect(screen.queryByText(SETTING.rulesAssistant.label)).toBeNull();
    expect(screen.getByRole("heading", { name: "Device", level: 2 })).toBeInTheDocument();
  });

  it("asks before leaving the table", async () => {
    const user = userEvent.setup();
    const onLeave = renderPlayer("/settings");
    await user.click(screen.getByRole("button", { name: "Leave table" }));
    const dialog = screen.getByRole("dialog", { name: "Leave the table?" });
    await user.click(within(dialog).getByRole("button", { name: "Leave table" }));
    expect(onLeave).toHaveBeenCalled();
  });
});

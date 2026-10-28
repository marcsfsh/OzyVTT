import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }) as Record<string, unknown>);
vi.mock("../lib/command", () => ({ command: (...args: unknown[]) => command(...args), read: vi.fn() }));
vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));
// The fetching neighbours of the table settings, which this test does not read.
vi.mock("../integrations/CredentialsTable", () => ({ CredentialsTable: () => null }));
vi.mock("../components/JoinAddress", () => ({ JoinAddress: () => null }));

import { GameStateSchema, type GmView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";
import { FightMenu } from "../encounter/FightMenu";
import { goTo } from "../../test/route";
import { SettingsPage } from "./SettingsPage";

// Settings speak in the positive ("Check movement"), use the same names for the same setting as the fight's options,
// and a control that can't be used says why.

function gmView(change: (state: GmView) => void = () => {}): GmView {
  const state = GameStateSchema.parse({ schemaVersion: 1 }) as unknown as GmView;
  change(state);
  return state;
}

// The fight's settings are the Fights section, at its own address.
const renderSettings = (state: GmView) => {
  goTo("/settings/fights");
  return render(
    <ToastProvider>
      <SettingsPage role="gm" state={state} gmToken="gm" />
    </ToastProvider>
  );
};

describe("the rules assistant's checks", () => {
  beforeEach(() => command.mockClear());

  it("are switches that are on while the assistant checks the family", async () => {
    const state = gmView((view) => {
      view.rulesPolicy = { dial: "strict", exceptions: { movement: "freeform" } };
    });
    renderSettings(state);
    expect(screen.queryByText(/Don't police/)).toBeNull();
    expect(screen.getByRole("switch", { name: "Check movement" })).not.toBeChecked();
    const economy = screen.getByRole("switch", { name: "Check the action economy" });
    expect(economy).toBeChecked();
    const user = userEvent.setup();
    // Turning a check off pins that family Off, as the old "Don't police" switch did when turned on.
    await user.click(economy);
    expect(command).toHaveBeenLastCalledWith("rules:set-policy", {
      dial: "strict",
      exceptions: { movement: "freeform", economy: "freeform" }
    });
    // Turning one back on hands it to the dial again.
    await user.click(screen.getByRole("switch", { name: "Check movement" }));
    expect(command).toHaveBeenLastCalledWith("rules:set-policy", { dial: "strict", exceptions: {} });
  });

  it("can't be turned on while the assistant is Off, and say why", () => {
    renderSettings(gmView((view) => (view.rulesPolicy = { dial: "freeform", exceptions: {} })));
    const movement = screen.getByRole("switch", { name: "Check movement" });
    expect(movement).toBeDisabled();
    expect(movement).not.toBeChecked();
    expect(
      screen.getByText("The rules assistant is Off, so it checks nothing. Choose Enforce or Advise.")
    ).toBeTruthy();
  });

  it("explains each setting of the dial in a sentence", () => {
    renderSettings(gmView());
    expect(screen.getByText("Enforce blocks an illegal move until you allow it.")).toBeTruthy();
    expect(screen.getByText("Advise allows every move and leaves a note on an illegal one.")).toBeTruthy();
    expect(screen.getByText("Off checks nothing and shows no prompts.")).toBeTruthy();
  });
});

describe("one name for one setting", () => {
  it("names the health display, players' hits and players' initiative as the encounter's options do", async () => {
    const state = gmView((view) => {
      view.combat.healthDisplay = { style: "band", audience: "all" };
    });
    renderSettings(state);
    const health = screen.getByRole("combobox", { name: "Health display" });
    expect(within(health).getByRole("option", { name: "Status badge" })).toBeTruthy();
    expect(within(health).queryByRole("option", { name: "Band" })).toBeNull();
    // A status badge is everyone's, so the audience is off, with the reason beside it.
    const audience = screen.getByRole("group", { name: "Health is" });
    for (const option of within(audience).getAllByRole("button")) expect(option).toBeDisabled();
    expect(screen.getByText("A status badge shows to everyone, so it has no GM-only setting.")).toBeTruthy();
    const hits = within(screen.getByRole("group", { name: "Players' hits" }));
    expect(hits.getByRole("button", { name: "Applied by the GM" })).toBeTruthy();
    expect(hits.getByRole("button", { name: "Applied immediately" })).toBeTruthy();
    const initiative = within(screen.getByRole("group", { name: "Players' initiative" }));
    expect(initiative.getByRole("button", { name: "Wait until everyone has rolled" })).toBeTruthy();

    // The fight's options menu says the same.
    const fight = gmView((view) => {
      view.combat = { ...view.combat, active: true, healthDisplay: { style: "band", audience: "all" } };
    });
    render(
      <FightMenu
        state={fight}
        busy={false}
        run={vi.fn()}
        onFeedback={() => {}}
        onAddMonsters={() => {}}
        onEnd={() => {}}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Encounter options/ }));
    const menu = within(screen.getByRole("menu", { name: "Encounter options" }));
    expect(menu.getByRole("option", { name: "Applied by the GM" })).toBeTruthy();
    expect(menu.getByRole("option", { name: "Wait until everyone has rolled" })).toBeTruthy();
    expect(menu.getByRole("option", { name: "Status badge" })).toBeTruthy();
    expect(menu.getByRole("combobox", { name: "Health is" })).toBeDisabled();
    expect(menu.getByText("A status badge shows to everyone, so it has no GM-only setting.")).toBeTruthy();
    expect(menu.queryByText(/GM confirms|Direct - players/)).toBeNull();
  });
});

describe("who picks targets (ADR-0044)", () => {
  beforeEach(() => command.mockClear());

  it("starts with the player, says what each choice does, and hands the choice to the GM", async () => {
    renderSettings(gmView());
    const choice = screen.getByRole("group", { name: "Who picks targets" });
    expect(within(choice).getByRole("button", { name: "The player" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Players tap an action and pick its target on the map.")).toBeTruthy();
    await userEvent.setup().click(within(choice).getByRole("button", { name: "The GM" }));
    expect(command).toHaveBeenLastCalledWith("table:set-targeting", { targeting: "gm" });
  });
});

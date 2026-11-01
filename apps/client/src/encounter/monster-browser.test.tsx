import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@vtt/ui";

const command = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ ok: true, actorId: "new-1" })));
const read = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ ok: true, definition: { name: "Goblin Warrior", kind: "monster" } }))
);
vi.mock("../lib/command", () => ({ command, read }));
vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false } }));
vi.mock("./monster-catalog", () => ({
  loadMonsterCatalog: async () => ({
    attribution: "SRD 5.2.1",
    monsters: [
      monster("goblin", "Goblin Warrior", 0.25, "humanoid", "small"),
      monster("wolf", "Wolf", 0.25, "beast", "medium"),
      monster("ogre", "Ogre", 2, "giant", "large")
    ]
  })
}));
vi.mock("./StatBlock", () => ({
  StatBlock: ({ monster }: { monster: { name: string } }) => <p>{monster.name} stat block</p>
}));

function monster(id: string, name: string, challengeRating: number, type: string, size: string) {
  return { id, name, challengeRating, type, size, armorClass: 13, hitPoints: 10, experiencePoints: 50, source: "srd" };
}

import { MonsterBrowser } from "./MonsterBrowser";

// Adding monsters is the Compendium's browse (C3 running spec 2.4): filters with counts change the rows, choosing a row
// shows its stat block, and Add sends the same command as before.

describe("adding monsters", () => {
  beforeEach(() => vi.clearAllMocks());

  const mount = () =>
    render(
      <ToastProvider>
        <MonsterBrowser visibility="gm-only" joinEncounter targetName="Old road" onClose={() => {}} />
      </ToastProvider>
    );

  it("narrows the rows with a filter, and counts each option with the other filters applied", async () => {
    const user = userEvent.setup();
    mount();
    const dialog = await screen.findByRole("dialog", { name: "Add monsters from the bestiary" });
    const rows = () =>
      within(dialog)
        .getAllByRole("listitem")
        .map((row) => row.textContent ?? "");
    await waitFor(() => expect(rows()).toHaveLength(3));
    const type = within(dialog).getByRole("group", { name: "Type" });
    expect(within(type).getByRole("button", { name: /^Beast/ })).toHaveTextContent("1");
    await user.click(within(type).getByRole("button", { name: /^Beast/ }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain("Wolf");
    // Size counts follow the type chosen.
    const size = within(dialog).getByRole("group", { name: "Size" });
    expect(within(size).getByRole("button", { name: /^Large/ })).toHaveTextContent("0");
  });

  it("shows the chosen monster's stat block and adds it with the dialog's Cup, saying where it landed", async () => {
    const user = userEvent.setup();
    mount();
    const dialog = await screen.findByRole("dialog", { name: "Add monsters from the bestiary" });
    await user.click(await within(dialog).findByRole("button", { name: /^Goblin Warrior/ }));
    expect(await within(dialog).findByText("Goblin Warrior stat block")).toBeTruthy();
    expect(within(dialog).getByText(/Adds land in the staging tray/)).toHaveTextContent("GM only");
    await user.click(within(dialog).getByRole("button", { name: "Add to Old road" }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("actor:add-from-definition", {
        definitionId: "goblin",
        visibility: "gm-only",
        joinEncounter: true
      })
    );
    expect(await within(dialog).findByText("Goblin Warrior is in the staging tray, GM only.")).toBeTruthy();
  });
});

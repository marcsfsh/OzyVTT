import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@vtt/ui";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }) as Record<string, unknown>);
vi.mock("../../lib/command", () => ({
  command: (...args: unknown[]) => command(...args),
  read: vi.fn(async () => ({ ok: false }))
}));
vi.mock("../../encounter/monster-catalog", () => ({
  loadMonsterCatalog: async () => ({ monsters: [{ id: "troll" }], attribution: "" })
}));
vi.mock("../../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { AMBUSH, CHASE, IDS, gmView } from "../../../test/scenes-fakes";
import { AddToScene } from "./AddToScene";

// Add to a scene: two commands, a monster made at the staging default and then staged in a prepared scene, with the
// staging retried on the same monster and never on a live or parked one.

const TROLL = "10000000-0000-4000-8000-0000000000f1";
const withTroll = () => {
  const view = gmView([AMBUSH, CHASE], IDS.chase);
  return { ...view, actors: [...view.actors, { ...view.actors[2]!, id: TROLL, name: "Troll" }] } as typeof view;
};

afterEach(() => command.mockReset());

describe("Add to an encounter", () => {
  it("makes the monster for the roster, then stages it in the prepared encounter it was added to", async () => {
    const user = userEvent.setup();
    command.mockImplementation(async (type: unknown) =>
      type === "actor:add-from-definition" ? { ok: true, actorId: TROLL } : { ok: true }
    );
    render(
      <ToastProvider>
        <AddToScene game={withTroll()} definitionId="troll" name="Troll" />
      </ToastProvider>
    );
    await user.click(await screen.findByRole("button", { name: "Add to an encounter" }));
    const dialog = within(screen.getByRole("dialog", { name: "Add Troll to an encounter" }));
    // The live scene adds from the table instead.
    expect(dialog.getByRole("button", { name: "Tunnel chase" })).toBeDisabled();
    await user.click(dialog.getByRole("button", { name: "Crypt ambush" }));
    expect(command).toHaveBeenNthCalledWith(1, "actor:add-from-definition", {
      definitionId: "troll",
      visibility: "public",
      joinEncounter: false
    });
    expect(command).toHaveBeenNthCalledWith(2, "encounter:set-combatants", {
      encounterId: IDS.ambush,
      combatantIds: [IDS.lyra, IDS.borin, IDS.goblin, IDS.boss, TROLL],
      expectedRevision: 7
    });
  });

  it("keeps the monster it made when the staging is refused, and stages that one again", async () => {
    const user = userEvent.setup();
    let staged = 0;
    command.mockImplementation(async (type: unknown) => {
      if (type === "actor:add-from-definition") return { ok: true, actorId: TROLL };
      staged += 1;
      return staged === 1 ? { ok: false, message: "The table changed. Try again." } : { ok: true };
    });
    render(
      <ToastProvider>
        <AddToScene game={withTroll()} definitionId="troll" name="Troll" />
      </ToastProvider>
    );
    await user.click(await screen.findByRole("button", { name: "Add to an encounter" }));
    const dialog = within(screen.getByRole("dialog", { name: "Add Troll to an encounter" }));
    await user.click(dialog.getByRole("button", { name: "Crypt ambush" }));
    expect(await dialog.findByText(/Troll was added to the roster but isn.t staged here yet/)).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Stage it in Crypt ambush again" }));
    const made = command.mock.calls.filter(([type]) => type === "actor:add-from-definition");
    expect(made).toHaveLength(1);
    expect(command.mock.calls.filter(([type]) => type === "encounter:set-combatants")).toHaveLength(2);
  });

  it("offers nothing for a monster the catalog can't add", async () => {
    render(
      <ToastProvider>
        <AddToScene game={withTroll()} definitionId="not-in-catalog" name="Odd" />
      </ToastProvider>
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("button", { name: "Add to an encounter" })).toBeNull();
  });
});

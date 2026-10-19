import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

import type { PlayerView } from "@vtt/domain";
import { CraftingStartSchema } from "@vtt/domain/commands";
import { socket } from "../socket";
import type { SheetEdit } from "../sheet/useSheetEdit";
import { SheetCrafting } from "./SheetCrafting";

// SRD 5.2.1 Crafting on the sheet: a character's projects with their progress, the party's to help with, and a dialog
// that starts one from what the server says the character's tools make.

type EmitCall = [event: string, payload: Record<string, unknown>, ack: (result: unknown) => void];
const ARIA = { id: "10000000-0000-4000-8000-000000000001", name: "Aria" };
const BREN = { id: "10000000-0000-4000-8000-000000000002", name: "Bren" };
const COMMAND = { commandId: "10000000-0000-4000-8000-0000000000aa" };

const project = (over: Record<string, unknown>) => ({
  id: "10000000-0000-4000-8000-0000000000c1",
  crafterId: ARIA.id,
  itemId: "shortsword",
  itemName: "Shortsword",
  kind: "item",
  toolId: "smiths-tools",
  helperIds: [],
  workMinutes: 960,
  doneMinutes: 480,
  ...over
});

const OFFERS = {
  ok: true,
  tools: [
    {
      toolId: "smiths-tools",
      name: "Smith's Tools",
      carried: true,
      items: [{ id: "shortsword", name: "Shortsword", kind: "item", materialsCp: 500, days: 1 }]
    },
    {
      toolId: "cobblers-tools",
      name: "Cobbler's Tools",
      carried: false,
      items: [{ id: "climbers-kit", name: "Climber's Kit", kind: "item", materialsCp: 1250, days: 3 }]
    }
  ],
  scrolls: null,
  magicItems: [],
  purseCp: 2000
};

function answer() {
  (socket.emit as unknown as { mockImplementation: (run: (...args: EmitCall) => void) => void }).mockImplementation(
    (event, _payload, ack) =>
      ack(
        event === "actor:crafting-offers"
          ? OFFERS
          : event === "content:equipment"
            ? { ok: true, equipment: [{ id: "smiths-tools", name: "Smith's Tools" }] }
            : { ok: true }
      )
  );
}

const viewOf = (projects: readonly object[]) =>
  ({ revision: 1, actors: [ARIA, BREN], crafting: projects }) as unknown as PlayerView;

describe("the sheet's crafting", () => {
  it("lists the character's projects with their progress, and the party's to help with", async () => {
    answer();
    const edit = vi.fn(async () => ({ ok: true })) as unknown as SheetEdit & ReturnType<typeof vi.fn>;
    const user = userEvent.setup();
    const theirs = project({ id: "10000000-0000-4000-8000-0000000000c2", crafterId: BREN.id, itemName: "Boots" });
    render(<SheetCrafting actor={ARIA} state={viewOf([project({}), theirs])} busy={false} edit={edit} />);
    const crafting = screen.getByRole("region", { name: "Crafting" });
    const [mine, bren] = within(crafting).getAllByRole("listitem");
    expect(within(mine!).getByRole("progressbar")).toHaveAttribute("aria-valuemax", "2");
    expect(await within(mine!).findByText("Smith's Tools")).toBeTruthy();
    expect(within(bren!).getByText("Bren crafts")).toBeTruthy();
    await user.click(within(crafting).getByRole("button", { name: "Help" }));
    expect(edit).toHaveBeenCalledWith("crafting:help", { projectId: theirs.id, actorId: ARIA.id, helping: true });
  });

  it("starts a project from what the tools make, and holds Start until the tool is in the pack", async () => {
    answer();
    const edit = vi.fn(async () => ({ ok: true })) as unknown as SheetEdit & ReturnType<typeof vi.fn>;
    const user = userEvent.setup();
    render(<SheetCrafting actor={ARIA} state={viewOf([])} busy={false} edit={edit} />);
    expect(screen.getByText(/Aria makes nothing yet/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Start a project" }));
    const dialog = await screen.findByRole("dialog", { name: "Start a project" });
    expect(await within(dialog).findByText("Aria's purse holds 20 GP.")).toBeTruthy();
    const what = within(dialog).getByRole("combobox", { name: "What to make" });
    await user.selectOptions(what, "tool:cobblers-tools:climbers-kit");
    expect(within(dialog).getByText(/Crafting needs Cobbler's Tools in the pack/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Start" })).toBeDisabled();
    await user.selectOptions(what, "tool:smiths-tools:shortsword");
    expect(
      within(dialog).getByText(/Shortsword takes 5 GP of raw materials and 1 day of work with Smith's Tools/)
    ).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Start" }));
    const [event, payload] = edit.mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe("crafting:start");
    expect(CraftingStartSchema.parse({ ...payload, ...COMMAND })).toEqual({
      ...COMMAND,
      actorId: ARIA.id,
      itemId: "shortsword",
      toolId: "smiths-tools"
    });
  });
});

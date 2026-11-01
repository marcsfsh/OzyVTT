import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GmActor } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true } }));
vi.mock("../lib/command", () => ({
  command: vi.fn(async () => ({ ok: true })),
  read: vi.fn(async () => ({ ok: false }))
}));

import { onOpenRow } from "../encounter/openRow";
import { TokenContextMenu } from "./TokenContextMenu";

// The GM's token menu (C2 spec 2.2): The token and The creature, with no Damage or Heal (they live under the row),
// and Hit points and conditions opens the creature's row.

const GOBLIN = {
  id: "10000000-0000-4000-8000-0000000000a1",
  name: "Goblin 1",
  kind: "monster",
  visibility: "public",
  hp: { current: 7, maximum: 7, temporary: 0 },
  conditions: [],
  effects: [],
  sizeCells: 1
} as unknown as GmActor;

describe("the GM's token menu", () => {
  it("has no Damage or Heal, and opens the creature's row for its hit points and conditions", async () => {
    const user = userEvent.setup();
    const opened = vi.fn();
    const stop = onOpenRow(opened);
    render(
      <ToastProvider>
        <TokenContextMenu
          actor={GOBLIN}
          role="gm"
          gmToken="gm"
          x={20}
          y={20}
          reactionUsed={false}
          placed
          onOpenSheet={() => {}}
          onReturnToTray={() => {}}
          onClose={() => {}}
        />
      </ToastProvider>
    );
    const menu = screen.getByRole("menu", { name: "Actions for Goblin 1" });
    expect(menu.querySelector("input[aria-label='Amount']")).toBeNull();
    expect(screen.queryByRole("button", { name: "Damage" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Heal" })).toBeNull();
    expect(screen.getByText("The token")).toBeTruthy();
    expect(screen.getByText("Its sheet and turn")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Hit points and conditions" }));
    expect(opened).toHaveBeenCalledWith(GOBLIN.id);
    stop();
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GmView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

const command = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ ok: true })));
vi.mock("../lib/command", () => ({ command, read: vi.fn(async () => ({ ok: false })) }));
vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true } }));

import { TokensPage } from "./TokensPage";

// Prep's Tokens page in the GM's groups (ADR-0063): Party, the groups, Monsters; a creature moves by its More, and a
// group deleted returns its creatures.

const GROUP = "20000000-0000-4000-8000-0000000000a1";
const actor = (id: string, name: string, kind: string) => ({
  id,
  name,
  kind,
  visibility: "public",
  hp: { current: 5, maximum: 5, temporary: 0 },
  conditions: [],
  effects: []
});
const state = {
  actors: [
    actor("a1", "Lyra", "player-character"),
    actor("a2", "Goblin 1", "monster"),
    actor("a3", "Goblin Boss", "monster")
  ],
  definitions: [],
  tokenGroups: { groups: [{ id: GROUP, name: "Cave" }], members: { a3: GROUP } }
} as unknown as GmView;

const mount = () =>
  render(
    <ToastProvider>
      <TokensPage state={state} token="gm" />
    </ToastProvider>
  );

describe("the Tokens page in groups", () => {
  it("lists Party, the GM's groups and Monsters, each creature once", () => {
    mount();
    const names = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(names).toEqual(["Party · 1", "Cave · 1", "Monsters · 1"]);
    expect(within(screen.getByRole("list", { name: "Cave" })).getByText("Goblin Boss")).toBeTruthy();
  });

  it("moves a creature into a group from its More", async () => {
    const user = userEvent.setup();
    mount();
    const more = screen.getByLabelText("More for Goblin 1").closest("details")!;
    await user.click(screen.getByLabelText("More for Goblin 1"));
    await user.click(within(more).getByRole("menuitem", { name: "Move to Cave" }));
    expect(command).toHaveBeenCalledWith("actor:set-token-group", { actorId: "a2", groupId: GROUP });
  });

  it("asks before deleting a group, then sends the delete", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByLabelText("More for Cave"));
    await user.click(screen.getByRole("menuitem", { name: "Delete the group" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Delete Cave?" })).getByRole("button", { name: "Delete" })
    );
    await waitFor(() => expect(command).toHaveBeenCalledWith("token-group:delete", { groupId: GROUP }));
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActorDefinition } from "@vtt/domain";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
vi.mock("../lib/command", () => ({
  command: (...args: unknown[]) => command(...args),
  read: vi.fn(async () => ({
    ok: true,
    actions: [
      {
        id: "ready",
        name: "Ready",
        activation: "action",
        available: true,
        violations: [],
        usesRemaining: null,
        componentsRemaining: null,
        builtin: true,
        targeting: "none",
        description: "Ready.",
        damage: []
      }
    ]
  }))
}));

// The runner is brought into view in its own scroll region; jsdom lays nothing out, so the call is checked.
const revealInRegion = vi.fn();
vi.mock("../lib/reveal", () => ({ revealInRegion: (...args: unknown[]) => revealInRegion(...args) }));

import { PlayerActionRunner } from "./PlayerActionRunner";

// SRD Ready: the response is an action or a move, or a spell cast now and held with Concentration.

const ME = "10000000-0000-4000-8000-000000000001";
const WIZARD = {
  name: "Wren",
  actions: [
    {
      id: "spell-fireball",
      name: "Fireball",
      activation: "action",
      description: "Boom.",
      save: { ability: "dex", dc: 15, successDamage: "half", failureConditions: [] },
      damage: [{ formula: "8d6", type: "fire" }],
      spellSlot: { level: 3 },
      spellId: "fireball"
    },
    {
      id: "spell-healing-word",
      name: "Healing Word",
      activation: "bonus-action",
      description: "Heal.",
      damage: [],
      healing: { formula: "2d4 + 4" },
      spellSlot: { level: 1 },
      spellId: "healing-word"
    }
  ],
  spellcasting: {
    ability: "int",
    slots: [
      { level: 1, max: 4 },
      { level: 3, max: 3 },
      { level: 4, max: 1 }
    ],
    spells: []
  }
} as unknown as ActorDefinition;

const mount = () =>
  render(<PlayerActionRunner actorId={ME} definition={WIZARD} revision={2} playerDamageMode="proposal" targets={[]} />);

describe("the Ready action on a player's turn", () => {
  it("readies a spell cast with an action, at the slot level picked", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Ready" }));
    const chooser = within(screen.getByRole("dialog", { name: "What to ready" }));
    expect(chooser.queryByRole("button", { name: /Healing Word/ })).toBeNull();
    await user.click(chooser.getByRole("button", { name: /Fireball/ }));
    const dialog = within(screen.getByRole("dialog", { name: "Ready Fireball" }));
    await user.click(dialog.getByRole("button", { name: "Level 4" }));
    await user.click(dialog.getByRole("button", { name: "Ready it" }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("action:resolve", {
        actorId: ME,
        actionId: "spell-fireball",
        ready: true,
        slotLevel: 4,
        expectedRevision: 2
      })
    );
  });

  it("readies an action or a move with the plain Ready", async () => {
    const user = userEvent.setup();
    command.mockClear();
    mount();
    await user.click(await screen.findByRole("button", { name: "Ready" }));
    await user.click(screen.getByRole("button", { name: /An action or a move/ }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("action:resolve", { actorId: ME, actionId: "ready", expectedRevision: 2 })
    );
  });

  it("says a refusal above the action list, and brings it into view", async () => {
    const user = userEvent.setup();
    revealInRegion.mockClear();
    command.mockResolvedValueOnce({ ok: false, message: "Wren has already used an action this turn." } as never);
    mount();
    await user.click(await screen.findByRole("button", { name: "Ready" }));
    await user.click(screen.getByRole("button", { name: /An action or a move/ }));
    const refusal = await screen.findByText("Wren has already used an action this turn.");
    const list = screen.getByRole("group", { name: "Common actions" });
    expect(refusal.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(revealInRegion).toHaveBeenCalledWith(
      expect.objectContaining({ className: "action-runner player-actions" }),
      "nearest"
    );
  });
});

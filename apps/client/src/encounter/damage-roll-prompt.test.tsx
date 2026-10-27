import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlayerView } from "@vtt/domain";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
const command = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ ok: true })));
vi.mock("../lib/command", () => ({ command, read: () => new Promise(() => {}) }));

import { DamageRollPrompt, damageRollLine } from "./DamageRollPrompt";
import { playerPrompts } from "../table/playerPrompts";

// ADR-0043: a player's damage waits for their dice, as a total or as each die's face.

const ROLL = "40000000-0000-4000-8000-000000000001";
const LYRA = "10000000-0000-4000-8000-000000000001";
const roll = (mode: "total" | "die") => ({
  id: ROLL,
  sourceActorId: LYRA,
  actionName: "Longsword",
  formula: "2d6 + 3",
  dice: [{ count: 2, sides: 6 }],
  fixed: 3,
  mode
});

describe("rolling a player's damage", () => {
  it("takes the total in one field", async () => {
    command.mockClear();
    render(<DamageRollPrompt roll={roll("total")} onFeedback={() => {}} />);
    expect(damageRollLine(roll("total"))).toBe("Roll 2d6 + 3 and type the total, bonus included.");
    await userEvent.type(screen.getByLabelText("Damage total"), "11");
    await userEvent.click(screen.getByRole("button", { name: "Send the damage" }));
    expect(command).toHaveBeenCalledWith("damage:report", { rollId: ROLL, total: 11 });
  });

  it("takes each die's face, and waits until every die has one", async () => {
    command.mockClear();
    render(<DamageRollPrompt roll={roll("die")} onFeedback={() => {}} />);
    expect(damageRollLine(roll("die"))).toBe("Roll 2d6 + 3 and type what each die shows. The app adds 3.");
    await userEvent.type(screen.getByLabelText("d6, die 1"), "4");
    expect(screen.getByRole("button", { name: "Send the damage" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("d6, die 2"), "6");
    await userEvent.click(screen.getByRole("button", { name: "Send the damage" }));
    expect(command).toHaveBeenCalledWith("damage:report", { rollId: ROLL, faces: [4, 6] });
  });

  it("takes the prompt slot for the player's own character", () => {
    const state = {
      actors: [{ id: LYRA, name: "Lyra", kind: "player-character", claimStatus: "mine", hp: { kind: "exact" } }],
      rollCalls: [],
      combat: {
        active: true,
        turnActorId: LYRA,
        turn: {},
        pendingReactions: [],
        pendingSaves: [],
        pendingInitiative: [],
        damageRolls: [roll("total")]
      }
    } as unknown as PlayerView;
    expect(playerPrompts(state)).toMatchObject([{ kind: "damage-roll", key: ROLL }]);
  });
});

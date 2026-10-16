import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ContentActionSummary } from "@vtt/domain";

vi.mock("../socket", () => {
  const emit = vi.fn();
  return { socket: { on: vi.fn(), off: vi.fn(), emit, timeout: () => ({ emit }) } };
});

import { socket } from "../socket";
import { ActionTargetPicker } from "./ActionTargetPicker";
import { beginTargeting, resolveTargeting, toggleTarget, useTargeting } from "./targeting";

// Magic Missile's darts strike one creature or several: the picker assigns them, and the resolve names each target
// once per dart it takes.

const MISSILE = {
  id: "spell-magic-missile",
  name: "Magic Missile",
  activation: "action",
  description: "Darts.",
  attackBonus: null,
  saveAbility: null,
  damage: [{ formula: "1d4 + 1", type: "force" }],
  area: null,
  darts: 3
} as unknown as ContentActionSummary;
const CASTER = "11111111-1111-4111-8111-111111111111";
const GOBLIN = "22222222-2222-4222-8222-222222222222";
const ORC = "33333333-3333-4333-8333-333333333333";

function Picker() {
  const session = useTargeting();
  return session ? (
    <ActionTargetPicker
      picking={session}
      targets={[
        { id: GOBLIN, label: "Goblin" },
        { id: ORC, label: "Orc" }
      ]}
      busy={false}
      onRoll={() => {}}
    />
  ) : null;
}

describe("assigning Magic Missile's darts", () => {
  it("gives each chosen target a dart count, and sends a target once per dart", () => {
    beginTargeting(MISSILE, CASTER, 2, 4);
    render(<Picker />);
    act(() => {
      toggleTarget(GOBLIN);
      toggleTarget(ORC);
    });
    const goblin = screen.getByRole("group", { name: "Darts at Goblin" });
    fireEvent.click(goblin.querySelector('button[aria-label="Increase"]')!);
    fireEvent.click(goblin.querySelector('button[aria-label="Increase"]')!);
    expect(screen.getByText(/4 darts: all assigned/)).toBeTruthy();
    resolveTargeting(undefined, () => {});
    const [event, payload] = vi.mocked(socket.emit).mock.calls.at(-1)!;
    expect(event).toBe("action:resolve");
    expect(payload).toMatchObject({ targetIds: [GOBLIN, GOBLIN, GOBLIN, ORC], slotLevel: 2 });
  });
});

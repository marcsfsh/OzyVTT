import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlayerView } from "@vtt/domain";

// `command()` sends through `socket.timeout(ms).emit` with an error-first ack; routed to `socket.emit` here.
vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, { ok: true, ...((reply as object) ?? {}) }))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

import { socket } from "../socket";
import { ToastProvider } from "@vtt/ui";
import { DicePanel, withD20Mode } from "./DicePanel";

const emit = socket.emit as unknown as ReturnType<typeof vi.fn>;
const formulas = () =>
  emit.mock.calls
    .filter(([event]) => event === "dice:roll")
    .map(([, payload]) => (payload as { formula: string }).formula);

describe("an armed Advantage in a custom formula", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emit.mockImplementation((_event: string, _payload: unknown, ack?: (reply: unknown) => void) => ack?.({}));
  });

  it("goes to the formula's d20 and keeps its bonus", () => {
    expect(withD20Mode("1d20 + 5", "kh1")).toBe("2d20kh1 + 5");
    expect(withD20Mode("d20+3", "kl1")).toBe("2d20kl1+3");
    expect(withD20Mode("3d6 + 1d20", "kh1")).toBe("3d6 + 2d20kh1");
    // Already two d20s, or no d20 at all: nothing to give it to.
    expect(withD20Mode("2d20kh1 + 5", "kh1")).toBeNull();
    expect(withD20Mode("2d6 + 3", "kh1")).toBeNull();
    expect(withD20Mode("1d200", "kh1")).toBeNull();
  });

  it("is spent by the roll, so the next d20 rolls plain", async () => {
    const user = userEvent.setup();
    render(<DicePanel role="player" state={{ rolls: [] } as unknown as PlayerView} />, { wrapper: ToastProvider });
    await user.click(screen.getByRole("button", { name: "Advantage" }));
    await user.click(screen.getByText(/Custom formula/));
    const field = screen.getByLabelText("Formula");
    await user.clear(field);
    await user.type(field, "1d20 + 5");
    await user.click(screen.getByRole("button", { name: "Roll" }));
    expect(formulas()).toEqual(["2d20kh1 + 5"]);
    expect(screen.queryByText(/is armed for the next d20 roll/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "d20" }));
    expect(formulas().at(-1)).toBe("1d20");
  });

  it("stays armed through a formula with no d20", async () => {
    const user = userEvent.setup();
    render(<DicePanel role="player" state={{ rolls: [] } as unknown as PlayerView} />, { wrapper: ToastProvider });
    await user.click(screen.getByRole("button", { name: "Disadvantage" }));
    await user.click(screen.getByText(/Custom formula/));
    const field = screen.getByLabelText("Formula");
    await user.clear(field);
    await user.type(field, "2d6 + 3");
    await user.click(screen.getByRole("button", { name: "Roll" }));
    expect(formulas()).toEqual(["2d6 + 3"]);
    expect(screen.getByText("Disadvantage is armed for the next d20 roll.")).toBeTruthy();
  });
});

describe("a free roll in the history", () => {
  const roll = (id: string, free: boolean) => ({
    id,
    commandId: id,
    initiatorRole: free ? "player" : "gm",
    initiatorLabel: free ? "Hero" : "GM",
    label: "Stealth",
    actorId: null,
    purpose: "check",
    visibility: "public",
    formula: "1d20 + 30",
    normalizedFormula: "1d20+30",
    dice: [{ group: 0, sides: 20, face: 4, kept: true, sign: 1 }],
    modifiers: [{ value: 30, sign: 1 }],
    total: 34,
    ...(free ? { free: true } : {}),
    createdAt: "2026-10-18T00:00:00.000Z"
  });

  it("says a player's roll is a free roll", () => {
    render(
      <DicePanel
        role="player"
        state={{ rolls: [roll("10000000-0000-4000-8000-000000000001", true)] } as unknown as PlayerView}
      />,
      { wrapper: ToastProvider }
    );
    expect(screen.getByText(/Hero · .* · Free roll/)).toBeTruthy();
  });

  it("leaves a GM's roll unmarked", () => {
    render(
      <DicePanel
        role="player"
        state={{ rolls: [roll("10000000-0000-4000-8000-000000000002", false)] } as unknown as PlayerView}
      />,
      { wrapper: ToastProvider }
    );
    expect(screen.queryByText(/Free roll/)).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CombatLogEntry } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

const handlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>());
vi.mock("../socket", () => ({
  socket: {
    on: (event: string, handler: (payload: unknown) => void) => handlers.set(event, handler),
    off: vi.fn(),
    emit: vi.fn(),
    connected: false
  }
}));
vi.mock("../lib/command", () => ({
  command: vi.fn(async () => ({ ok: true })),
  read: vi.fn(async () => ({ ok: false }))
}));

import { CombatLogPanel } from "./CombatLog";

// The log is one line each (log spec 2.1): a roll's line opens to its card, the tags say who sees it and what landed,
// damage reads red and healing gold, and the log holds still while the reader is scrolled up.

let nextId = 5000;
const entry = (overrides: Partial<CombatLogEntry>): CombatLogEntry => ({
  id: nextId++,
  at: "2026-10-30T12:00:00.000Z",
  kind: "damage",
  text: "A line",
  gmOnly: false,
  revision: 1,
  ...overrides
});
const roll = (face: number, overrides: Partial<CombatLogEntry> = {}) =>
  entry({
    kind: "roll",
    text: `Lyra rolled Perception: ${face + 3}.`,
    roll: {
      id: `r${nextId}`,
      formula: "1d20+3",
      total: face + 3,
      dice: [{ sides: 20, face, kept: true }],
      label: "Perception",
      initiatorLabel: "Lyra",
      visibility: "public",
      purpose: "check",
      createdAt: "2026-10-30T12:00:00.000Z"
    } as unknown as CombatLogEntry["roll"],
    ...overrides
  });
const push = (line: CombatLogEntry) => act(() => handlers.get("log:entry")!(line));

function mount() {
  render(
    <ToastProvider>
      <CombatLogPanel />
    </ToastProvider>
  );
  return screen.getByRole("region", { name: "Combat log" });
}

describe("the log's lines", () => {
  it("opens a roll's line to its card and closes it, one open at a time", async () => {
    const user = userEvent.setup();
    const log = mount();
    push(roll(14));
    push(roll(9));
    const [first, second] = within(log).getAllByRole("button", { name: /^Lyra rolled Perception/ });
    expect(first).toHaveAttribute("aria-expanded", "false");
    await user.click(first);
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(within(log).getAllByRole("article")).toHaveLength(1);
    await user.click(second);
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(second).toHaveAttribute("aria-expanded", "true");
    await user.click(second);
    expect(within(log).queryByRole("article")).toBeNull();
  });

  it("tags a GM-only line, a whisper, a natural 20 and a natural 1", () => {
    const log = mount();
    push(entry({ kind: "save", text: "The goblin fails its save.", gmOnly: true }));
    push(
      entry({
        kind: "chat",
        text: "Check the floor.",
        author: { name: "GM", role: "gm" },
        whisper: { characterId: "c1", name: "Lyra" }
      })
    );
    push(roll(20));
    push(roll(1));
    expect(within(log).getAllByText("GM only").length).toBeGreaterThan(0);
    expect(within(log).getByText("Whisper to Lyra")).toBeTruthy();
    expect(within(log).getByText("NAT 20")).toBeTruthy();
    expect(within(log).getByText("NAT 1")).toBeTruthy();
  });

  it("marks damage red and healing gold, and leaves a name's number alone", () => {
    const log = mount();
    push(entry({ kind: "damage", text: "Goblin 1 takes 7 Fire damage." }));
    push(entry({ kind: "heal", text: "Lyra spends a Hit Point Die and regains 6 Hit Points." }));
    const damage = log.querySelector(".log-amount.is-damage");
    const heal = log.querySelector(".log-amount.is-heal");
    expect(damage?.textContent).toBe("7");
    expect(heal?.textContent).toBe("6");
    expect(within(log).getByText(/Goblin 1 takes/)).toBeTruthy();
  });

  it("holds still while scrolled up, counts the new lines, and goes to the foot when asked", () => {
    const log = mount();
    push(entry({ text: "First." }));
    const list = log.querySelector<HTMLOListElement>(".combat-log-list")!;
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 200 });
    list.scrollTop = 100;
    fireEvent.scroll(list);
    push(entry({ text: "Second." }));
    push(entry({ text: "Third." }));
    expect(list.scrollTop).toBe(100);
    fireEvent.click(within(log).getByRole("button", { name: "2 new lines" }));
    expect(list.scrollTop).toBe(1000);
    expect(within(log).queryByRole("button", { name: /new line/ })).toBeNull();
  });
});

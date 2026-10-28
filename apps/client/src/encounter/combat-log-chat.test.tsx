import { describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
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
const command = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("../lib/command", () => ({ command, read: vi.fn(async () => ({ ok: false })) }));

import { CombatLogPanel } from "./CombatLog";

// Chat lines in the log (ADR-0038): who said what, a whisper's mark, Remove where the reader may, and a removed line
// leaving the list.

const LYRA = "10000000-0000-4000-8000-000000000001";
const line = (id: number, overrides: Partial<CombatLogEntry>): CombatLogEntry => ({
  id,
  at: "2026-10-27T12:00:00.000Z",
  kind: "chat",
  text: "Hello",
  gmOnly: false,
  revision: 1,
  ...overrides
});

describe("chat in the log", () => {
  it("shows lines and whispers, offers Remove only where allowed, and drops a removed line", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <CombatLogPanel canRemove={(entry) => entry.author?.actorId === LYRA} />
      </ToastProvider>
    );
    act(() => {
      handlers.get("log:entry")!(line(1, { text: "Hi all", author: { name: "Lyra", role: "player", actorId: LYRA } }));
      handlers.get("log:entry")!(
        line(2, {
          text: "It's a fake",
          author: { name: "GM", role: "gm" },
          whisper: { characterId: LYRA, name: "Lyra" }
        })
      );
    });
    const list = screen.getByRole("list");
    const [mine, whisper] = within(list).getAllByRole("listitem");
    expect(mine).toHaveTextContent("LyraHi all");
    expect(whisper).toHaveTextContent("Whisper to LyraGMIt's a fake");
    expect(within(whisper).queryByRole("button", { name: "Remove this line" })).toBeNull();
    await user.click(within(mine).getByRole("button", { name: "Remove this line" }));
    expect(command).toHaveBeenCalledWith("chat:delete", { entryId: 1 });
    act(() => handlers.get("log:removed")!({ id: 1 }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });
});

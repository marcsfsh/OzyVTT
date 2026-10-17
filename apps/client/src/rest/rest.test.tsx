import { beforeEach, describe, expect, it, vi } from "vitest";
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

import { GameStateSchema, type GmView, type PlayerView } from "@vtt/domain";
import { RestAnswerSchema, RestAskSchema, RestMarkDoneSchema, RestPartySchema } from "@vtt/domain/commands";
import { ToastProvider } from "@vtt/ui";
import { socket } from "../socket";
import { SheetRest } from "../encounter/SheetRest";
import { PartyRest } from "./PartyRest";
import { ShortRestPrompt } from "./ShortRestPrompt";

type EmitCall = [event: string, payload: Record<string, unknown>, ack: (result: unknown) => void];
const emitted = () => (socket.emit as unknown as { mock: { calls: EmitCall[] } }).mock.calls;
const COMMAND = { commandId: "10000000-0000-4000-8000-0000000000aa" };
const TORVA = "10000000-0000-4000-8000-000000000001";
const BRYN = "10000000-0000-4000-8000-000000000002";

function gmView(rest: Record<string, unknown> = {}, bryn: Record<string, unknown> = {}): GmView {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: TORVA, name: "Torva", kind: "player-character", hp: { current: 30, maximum: 75 } },
      { id: BRYN, name: "Bryn", kind: "player-character", hp: { current: 12, maximum: 40 }, ...bryn }
    ],
    rest
  });
  return { ...state, actors: state.actors.map((actor) => ({ ...actor, presence: null })) };
}

describe("the GM's rest panel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the game time and the 16-hour wait, and rests the picked characters together", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PartyRest state={gmView({ clockHours: 38 }, { lastLongRestAt: 30 })} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Rest" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Day 2, 14:00")).toBeTruthy();
    expect(within(dialog).getByText("12/40 HP · Long rest in 8 h")).toBeTruthy();
    await user.click(within(dialog).getByRole("checkbox", { name: /Bryn/ }));
    await user.click(within(dialog).getByRole("button", { name: "Long rest" }));
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("rest:party");
    expect(RestPartySchema.parse({ ...payload, ...COMMAND })).toMatchObject({ kind: "long", actorIds: [TORVA] });
  });

  it("answers a player's request from the button's badge", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PartyRest state={gmView({ requests: [BRYN] })} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: /Rest\s*1 asked/ }));
    const request = within(screen.getByRole("region", { name: "Long rest requests" })).getByRole("listitem");
    expect(within(request).getByText("Bryn")).toBeTruthy();
    await user.click(within(request).getByRole("button", { name: "Approve" }));
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("rest:answer");
    expect(RestAnswerSchema.parse({ ...payload, ...COMMAND })).toMatchObject({ actorId: BRYN, approve: true });
  });

  it("while a Short Rest is open, shows who is done and finishes it", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PartyRest state={gmView({ shortRest: { actorIds: [TORVA, BRYN], done: [BRYN] } })} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Short rest open" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Done")).toBeTruthy();
    expect(within(dialog).getByText("Choosing")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Finish short rest" }));
    expect(emitted().at(-1)!.slice(0, 2)).toEqual(["rest:finish", expect.objectContaining({ apply: true })]);
  });
});

describe("a player's rests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The server accepts, so a control frees itself for the next tap.
    (socket.emit as unknown as { mockImplementation: (run: (...args: EmitCall) => void) => void }).mockImplementation(
      (_event, _payload, ack) => ack({ ok: true, revision: 1 })
    );
  });

  it("the sheet asks the GM for a Long Rest instead of taking one, and can take the ask back", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SheetRest actorId={TORVA} role="player" onFeedback={() => {}} />);
    expect(screen.queryByRole("button", { name: "Long rest" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Ask for a long rest" }));
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("rest:ask");
    expect(RestAskSchema.parse({ ...payload, ...COMMAND })).toEqual({ ...COMMAND, actorId: TORVA });
    rerender(<SheetRest actorId={TORVA} role="player" asked onFeedback={() => {}} />);
    expect(screen.getByText("Long rest asked")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Take back" }));
    expect(emitted().at(-1)![1]).toMatchObject({ actorId: TORVA, withdraw: true });
  });

  it("the party's Short Rest shows the player's Hit Dice and a Done button", async () => {
    const user = userEvent.setup();
    const view = {
      revision: 3,
      actors: [
        {
          id: TORVA,
          name: "Torva",
          kind: "player-character",
          hp: { kind: "exact", current: 30, maximum: 75, temporary: 0 },
          hitDice: { die: "d12", maximum: 7, remaining: 3, entries: [{ die: "d12", maximum: 7, remaining: 3 }] }
        }
      ],
      rest: { requests: [], shortRest: { actorIds: [TORVA], done: [] } }
    } as unknown as PlayerView;
    render(
      <ToastProvider>
        <ShortRestPrompt state={view} />
      </ToastProvider>
    );
    const prompt = screen.getByRole("region", { name: "Short rest for Torva" });
    expect(within(prompt).getByText("Hit Dice 3/7 (d12)")).toBeTruthy();
    await user.click(within(prompt).getByRole("button", { name: "Done" }));
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("rest:mark-done");
    expect(RestMarkDoneSchema.parse({ ...payload, ...COMMAND })).toMatchObject({ actorId: TORVA, done: true });
  });

  it("shows nothing when no Short Rest includes the player's character", () => {
    const view = { revision: 1, actors: [], rest: { requests: [], shortRest: null } } as unknown as PlayerView;
    const { container } = render(<ShortRestPrompt state={view} />);
    expect(container.textContent).toBe("");
  });
});

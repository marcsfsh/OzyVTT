import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContentSkillSummary, GmView, PendingSave, PlayerRollCall, PlayerView, RollCall } from "@vtt/domain";

// `command()` sends through `socket.timeout(ms).emit` with an error-first ack; routed to `socket.emit` here.
vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

import { socket } from "../socket";
import { ToastProvider } from "@vtt/ui";
import { RollCallPrompts } from "../encounter/RollCallPrompt";
import { DicePanel } from "./DicePanel";
import { RollCallPanel } from "./RollCallPanel";

// The GM calls for a check or a save from the players; each player rolls it from a card that follows them across the
// app, and the GM reads who has rolled what.

const SKILLS: readonly ContentSkillSummary[] = [
  { id: "perception", name: "Perception", description: "", ability: "wis" },
  { id: "insight", name: "Insight", description: "", ability: "wis" },
  { id: "stealth", name: "Stealth", description: "", ability: "dex" }
];
const ARIA = "10000000-0000-4000-8000-000000000001";
const BRANN = "10000000-0000-4000-8000-000000000002";
const CALL = "70000000-0000-4000-8000-000000000001";
const SAVE_ID = "60000000-0000-4000-8000-000000000001";

const emit = socket.emit as unknown as ReturnType<typeof vi.fn>;
/** Answers the skill catalog, each command in `replies`, and every other one with ok. */
function serve(replies: Record<string, unknown> = {}) {
  emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
    if (event === "content:skills") ack?.({ ok: true, skills: SKILLS, attribution: "SRD 5.2.1, CC BY 4.0." });
    else ack?.(replies[event] ?? { ok: true });
  });
}
/** The payloads sent for `event`, without the id every command carries. */
const sent = (event: string) =>
  emit.mock.calls
    .filter((call) => call[0] === event)
    .map((call) => {
      const { commandId: _commandId, ...payload } = call[1] as Record<string, unknown>;
      return payload;
    });

const pc = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  kind: "player-character",
  visibility: "public",
  hp: { current: 20, maximum: 20, temporary: 0 },
  conditions: [],
  effects: [],
  ...over
});

const openCall: RollCall = {
  id: CALL,
  kind: "check",
  subject: { ability: "wis", skill: "perception" },
  dc: 15,
  blind: false,
  entries: [{ actorId: ARIA, result: { natural: 12, total: 17, success: true } }, { actorId: BRANN }],
  createdAt: 0
};

const gmState = (rollCalls: readonly RollCall[] = []) =>
  ({ actors: [pc(ARIA, "Aria"), pc(BRANN, "Brann")], rollCalls, combat: { pendingSaves: [] } }) as unknown as GmView;

describe("the GM's call for a roll", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sits at the top of the GM's dice tab beside rolling, and counts the calls still open", async () => {
    serve();
    const user = userEvent.setup();
    const state = { ...gmState([openCall]), rolls: [], definitions: [] } as unknown as GmView;
    render(<DicePanel role="gm" state={state} />, { wrapper: ToastProvider });
    const modes = screen.getByRole("group", { name: "Roll dice or call for a roll" });
    const call = within(modes).getByRole("button", { name: "Call for a roll · 1 open" });
    await user.click(call);
    expect(screen.getByRole("heading", { name: "Call for a roll" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Call for the check" })).toBeTruthy();
    expect(
      within(screen.getByRole("list", { name: "Open calls" })).getByText("Wisdom (Perception) check")
    ).toBeTruthy();
    await user.click(within(modes).getByRole("button", { name: "Roll dice" }));
    expect(screen.getByRole("button", { name: "d20" })).toBeTruthy();
  });

  it("is not offered on a player's dice tab", () => {
    render(<DicePanel role="player" state={{ rolls: [] } as unknown as PlayerView} />, { wrapper: ToastProvider });
    expect(screen.queryByText("Call for a roll")).toBeNull();
  });

  it("calls for a skill check from everyone, or a save with its DC from those picked", async () => {
    serve();
    const user = userEvent.setup();
    render(<RollCallPanel state={gmState()} />, { wrapper: ToastProvider });
    await user.click(screen.getByText(/Call for a roll/));
    await user.click(await screen.findByRole("button", { name: "Call for the check" }));
    expect(sent("roll-call:start")).toEqual([
      { kind: "check", ability: "wis", skill: "perception", actorIds: [ARIA, BRANN] }
    ]);

    await user.click(screen.getByRole("button", { name: "Saving throw" }));
    await user.selectOptions(screen.getByLabelText("Ability"), "dex");
    await user.click(screen.getByRole("button", { name: "Call for the save" }));
    // A save needs its DC before it is sent.
    expect(sent("roll-call:start")).toHaveLength(1);
    expect(await screen.findByText("A saving throw needs a DC.")).toBeTruthy();
    await user.type(screen.getByLabelText("DC"), "14");
    await user.click(screen.getByRole("button", { name: "Brann" }));
    await user.click(screen.getByRole("button", { name: "Call for the save" }));
    expect(sent("roll-call:start").at(-1)).toEqual({ kind: "save", ability: "dex", dc: 14, actorIds: [ARIA] });
  });

  it("can hide a check's results from the players", async () => {
    serve();
    const user = userEvent.setup();
    render(<RollCallPanel state={gmState()} />, { wrapper: ToastProvider });
    await user.click(screen.getByText(/Call for a roll/));
    await user.click(screen.getByRole("switch", { name: "Players see their results" }));
    expect(screen.getByText("Results hidden from players")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Call for the check" }));
    expect(sent("roll-call:start").at(-1)).toMatchObject({ blind: true });
  });

  it("lists who has rolled, rolls for the rest, and closes the call", async () => {
    serve();
    const user = userEvent.setup();
    render(<RollCallPanel state={gmState([openCall])} />, { wrapper: ToastProvider });
    const card = within(screen.getByRole("list", { name: "Open calls" }));
    expect(await card.findByText("Wisdom (Perception) check")).toBeTruthy();
    expect(card.getByText("17 (d20 12) · success")).toBeTruthy();
    expect(card.getByText("Waiting")).toBeTruthy();
    await user.click(card.getByRole("button", { name: "Roll for them" }));
    expect(sent("roll-call:answer")).toEqual([{ callId: CALL, actorId: BRANN }]);
    await user.click(card.getByRole("button", { name: "Close" }));
    expect(sent("roll-call:close")).toEqual([{ callId: CALL }]);
  });
});

const playerCall = (over: Partial<PlayerRollCall> = {}): PlayerRollCall => ({
  id: CALL,
  kind: "check",
  subject: { ability: "wis", skill: "perception" },
  dc: 15,
  blind: false,
  entries: [{ actorId: ARIA, answered: false }],
  createdAt: 0,
  ...over
});
const playerState = (calls: readonly PlayerRollCall[], over: Record<string, unknown> = {}, saves: unknown[] = []) =>
  ({
    actors: [pc(ARIA, "Aria", { heroicInspiration: false, ...over })],
    rollCalls: calls,
    combat: { pendingSaves: saves }
  }) as unknown as PlayerView;

describe("the player's card for a call", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rolls the check the GM called for, and keeps the result until put away", async () => {
    serve({
      "roll-call:answer": {
        ok: true,
        check: { label: "Wisdom (Perception)", natural: 12, total: 17, dc: 15, success: true, rollId: "r1" }
      }
    });
    const user = userEvent.setup();
    const { rerender } = render(<RollCallPrompts state={playerState([playerCall()])} />, { wrapper: ToastProvider });
    expect(await screen.findByText("The GM calls for a roll")).toBeTruthy();
    expect(screen.getByText("Wisdom (Perception) check", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText("DC 15")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Roll Wisdom (Perception) check" }));
    expect(sent("roll-call:answer")).toEqual([{ callId: CALL, actorId: ARIA }]);
    expect(await screen.findByText("Wisdom (Perception): 17 (d20 12) vs DC 15 · success.")).toBeTruthy();
    // The server's view drops the answered call; the card keeps its result until it is put away.
    rerender(<RollCallPrompts state={playerState([])} />);
    expect(screen.getByText("Wisdom (Perception): 17 (d20 12) vs DC 15 · success.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("The GM calls for a roll")).toBeNull();
  });

  it("takes a typed face from a physical die", async () => {
    serve({
      "roll-call:answer": {
        ok: true,
        check: { label: "Wisdom (Perception)", natural: 9, total: 14, dc: 15, success: false, rollId: "r2" }
      }
    });
    const user = userEvent.setup();
    render(<RollCallPrompts state={playerState([playerCall()])} />, { wrapper: ToastProvider });
    await user.type(await screen.findByLabelText("Your d20 for the Wisdom (Perception) check"), "9");
    await user.click(screen.getByRole("button", { name: "Use" }));
    expect(sent("roll-call:answer").at(-1)).toEqual({ callId: CALL, actorId: ARIA, face: 9 });
    await user.click(await screen.findByRole("button", { name: "Done" }));
  });

  it("rerolls the answer with Heroic Inspiration", async () => {
    serve({
      "roll-call:answer": {
        ok: true,
        check: { label: "Wisdom (Perception)", natural: 4, total: 9, dc: 15, success: false, rollId: "r3" }
      }
    });
    const user = userEvent.setup();
    const { rerender } = render(<RollCallPrompts state={playerState([playerCall()], { heroicInspiration: true })} />, {
      wrapper: ToastProvider
    });
    await user.click(await screen.findByRole("button", { name: "Roll Wisdom (Perception) check" }));
    expect(await screen.findByText("Wisdom (Perception): 9 (d20 4) vs DC 15 · failure.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reroll · Heroic Inspiration" }));
    expect(sent("check:reroll")).toEqual([{ actorId: ARIA }]);
    rerender(<RollCallPrompts state={playerState([], { heroicInspiration: true })} />);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("The GM calls for a roll")).toBeNull();
  });

  it("asks for a typed reroll after a typed answer, even on a card mounted again", async () => {
    serve({
      "roll-call:answer": {
        ok: true,
        check: {
          label: "Wisdom (Perception)",
          natural: 9,
          total: 14,
          dc: 15,
          success: false,
          typed: true,
          rollId: "r5"
        }
      }
    });
    const user = userEvent.setup();
    const { unmount } = render(<RollCallPrompts state={playerState([playerCall()], { heroicInspiration: true })} />, {
      wrapper: ToastProvider
    });
    await user.type(await screen.findByLabelText("Your d20 for the Wisdom (Perception) check"), "9");
    await user.click(screen.getByRole("button", { name: "Use" }));
    expect(await screen.findByText("Wisdom (Perception): 14 (d20 9, typed) vs DC 15 · failure.")).toBeTruthy();
    // The prompt slot drops the card while the server's view no longer holds the call, then mounts the kept one anew.
    unmount();
    render(<RollCallPrompts state={playerState([], { heroicInspiration: true })} />, { wrapper: ToastProvider });
    await user.type(screen.getByLabelText("The rerolled d20"), "17");
    await user.click(screen.getByRole("button", { name: "Reroll · Heroic Inspiration" }));
    expect(sent("check:reroll")).toEqual([{ actorId: ARIA, face: 17 }]);
    await user.click(screen.getByRole("button", { name: "Done" }));
  });

  it("keeps a blind call's result with the GM", async () => {
    serve({ "roll-call:answer": { ok: true, hiddenFromRoller: true } });
    const user = userEvent.setup();
    const blind = playerCall({ dc: null, blind: true });
    render(<RollCallPrompts state={playerState([blind], { heroicInspiration: true })} />, { wrapper: ToastProvider });
    expect(await screen.findByText("The GM keeps the result")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Roll Wisdom (Perception) check" }));
    expect(await screen.findByText("Rolled for the GM.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Reroll/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Done" }));
  });

  it("answers a called save through the save it opened, rolled as it appears", async () => {
    serve({
      "save:answer": {
        ok: true,
        outcome: {
          success: true,
          total: 14,
          natural: 12,
          dc: 13,
          appliedDamage: 0,
          conditionApplied: false,
          committed: false
        }
      }
    });
    const user = userEvent.setup();
    const save: PendingSave = {
      id: SAVE_ID,
      targetActorId: ARIA,
      ability: "dex",
      dc: 13,
      sourceActorId: null,
      sourceName: "The GM",
      actionName: "Dexterity saving throw",
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: [],
      saveBonus: 0,
      createdAt: 0
    };
    const call = playerCall({
      kind: "save",
      subject: { ability: "dex" },
      dc: 13,
      entries: [{ actorId: ARIA, saveId: SAVE_ID, answered: false }]
    });
    render(<RollCallPrompts state={playerState([call], {}, [save])} />, { wrapper: ToastProvider });
    expect(screen.getByText("Dexterity saving throw", { selector: "strong" })).toBeTruthy();
    // This browser rolls digitally, so the server throws the die as the card appears; Confirm applies it.
    expect(await screen.findByText("Rolled 14 (d20 12) · Success")).toBeTruthy();
    expect(sent("save:answer")).toEqual([{ saveId: SAVE_ID, method: "roll", commit: false }]);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(sent("save:answer").at(-1)).toEqual({ saveId: SAVE_ID, method: "roll", commit: true });
  });
});

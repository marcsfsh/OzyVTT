import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlayerEffect } from "@vtt/domain";

// `command()` and `read()` send through `socket.timeout(ms).emit` with an error-first ack; routed to `socket.emit`
// here so the assertions read one call list. The conditions reference answers with two SRD texts.
vi.mock("../socket", () => {
  const emit = vi.fn((event: string, _payload: unknown, ack?: (reply: unknown) => void) => {
    if (!ack) return;
    if (event === "content:conditions")
      ack({
        ok: true,
        conditions: [
          {
            id: "restrained",
            name: "Restrained",
            description:
              "While you have the Restrained condition, you experience the following effects. \n* Speed 0. Your Speed is 0 and can't increase."
          },
          { id: "prone", name: "Prone", description: "While you have the Prone condition, you crawl." },
          { id: "poisoned", name: "Poisoned", description: "While you have the Poisoned condition, you suffer." }
        ]
      });
    else ack({ ok: true });
  });
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, timeout: () => timed } };
});

import { socket } from "../socket";
import { ConditionEditor } from "./conditions";
import { EffectChips } from "./EffectChips";

const ACTOR = "10000000-0000-4000-8000-000000000001";
const sent = () => vi.mocked(socket.emit).mock.calls.filter(([event]) => event !== "content:conditions");

beforeEach(() => vi.mocked(socket.emit).mockClear());

describe("a condition chip on a phone", () => {
  it("opens the rules text instead of removing the condition, with an explicit Remove", async () => {
    render(<ConditionEditor actorId={ACTOR} conditions={[{ id: "restrained" }]} viewer="gm" onFeedback={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /restrained/i }));
    expect(sent()).toEqual([]);
    expect(await screen.findByText(/Your Speed is 0 and can't increase/)).toBeTruthy();
    expect(screen.getByText("Speed 0.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove Restrained" }));
    expect(sent()[0]?.[0]).toBe("actor:set-condition");
    expect(sent()[0]?.[1]).toMatchObject({ actorId: ACTOR, conditionId: "restrained", active: false });
  });

  it("offers a player Remove only for what they put on; an imposed one is a question for the GM", async () => {
    const { rerender } = render(
      <ConditionEditor
        actorId={ACTOR}
        conditions={[{ id: "poisoned", selfApplied: true }]}
        viewer="player"
        canAsk
        onFeedback={() => {}}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /poisoned/i }));
    expect(screen.getByRole("button", { name: "Remove Poisoned" })).toBeTruthy();
    expect(screen.getByText("You marked this yourself.")).toBeTruthy();

    rerender(
      <ConditionEditor
        actorId={ACTOR}
        conditions={[{ id: "poisoned" }]}
        effects={[{ name: "Poisoned by Ghast (Claw)", linkedConditionIds: ["poisoned"], escapeDc: null }]}
        viewer="player"
        canAsk
        onFeedback={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: "Remove Poisoned" })).toBeNull();
    expect(screen.getByText("From Poisoned by Ghast (Claw).")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Ask the GM to end it" }));
    expect(sent()[0]?.[0]).toBe("rules:ask");
    expect(sent()[0]?.[1]).toMatchObject({
      type: "actor.set-condition",
      payload: { actorId: ACTOR, conditionId: "poisoned", active: false }
    });
  });

  it("calls a player's way off Prone standing up", async () => {
    render(<ConditionEditor actorId={ACTOR} conditions={[{ id: "prone" }]} viewer="player" onFeedback={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /prone/i }));
    expect(screen.getByRole("button", { name: "Stand up" })).toBeTruthy();
  });
});

const effect = (over: Partial<PlayerEffect>): PlayerEffect => ({
  id: "e1",
  name: "Grappled by Ogre",
  tags: ["grapple"],
  sourceName: "Ogre",
  startedRound: 1,
  duration: { type: "manual" },
  endsWhenSourceDefeated: true,
  voidWhileIncapacitated: false,
  concentration: false,
  endsWithTag: null,
  modifiers: [],
  linkedConditionIds: ["grappled"],
  escapeDc: 13,
  onEnd: [],
  ...over
});

describe("an effect chip", () => {
  it("shows its source, time left and endings, and lets a player end only their own", async () => {
    const { rerender } = render(
      <EffectChips actorId={ACTOR} effects={[effect({})]} canEnd={false} canAsk onFeedback={() => {}} />
    );
    await userEvent.click(screen.getByRole("button", { name: /Grappled by Ogre/ }));
    expect(screen.getByText("From Ogre · until ended · escape DC 13")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^End / })).toBeNull();
    expect(screen.getByRole("button", { name: "Ask the GM to end it" })).toBeTruthy();

    rerender(
      <EffectChips
        actorId={ACTOR}
        effects={[
          effect({
            id: "e2",
            name: "Concentrating on Hold Person",
            tags: ["concentrating"],
            sourceName: "Wizard",
            duration: { type: "rounds", remaining: 9 },
            linkedConditionIds: [],
            escapeDc: null,
            yours: true
          })
        ]}
        canEnd={false}
        onFeedback={() => {}}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /Concentrating on Hold Person/ }));
    await userEvent.click(screen.getByRole("button", { name: "End Concentrating on Hold Person" }));
    expect(sent().at(-1)?.[0]).toBe("effect:end");
    expect(sent().at(-1)?.[1]).toMatchObject({ actorId: ACTOR, effectId: "e2" });
  });
});

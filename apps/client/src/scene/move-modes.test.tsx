import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ActorMovementReply } from "@vtt/domain";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }) as Record<string, unknown>);
vi.mock("../lib/command", () => ({ command: (...args: unknown[]) => command(...args) }));

import { MoveModeBar } from "./MoveModeBar";
import { useMapCommands } from "./useMapCommands";

const HERO = "10000000-0000-4000-8000-000000000001";

const DRAGON_BUDGET: ActorMovementReply = {
  counted: true,
  speedFeet: 40,
  usedFeet: 10,
  enforcement: "strict",
  modes: [
    { mode: "walk", budgetFeet: 40, extraCost: false },
    { mode: "fly", budgetFeet: 80, extraCost: false },
    { mode: "swim", budgetFeet: 40, extraCost: true },
    { mode: "climb", budgetFeet: 40, extraCost: true }
  ]
};

describe("picking how a creature moves", () => {
  it("offers each way with the feet it has left, one tap each, and force to the GM alone", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MoveModeBar name="Red Dragon" budget={DRAGON_BUDGET} mode="walk" onChange={onChange} gm />
    );
    const group = screen.getByRole("group", { name: "How Red Dragon moves" });
    expect([...group.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "Walk 30",
      "Fly 70",
      "Swim",
      "Climb",
      "Teleport",
      "Forced"
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Fly 70" }));
    expect(onChange).toHaveBeenCalledWith("fly");
    rerender(
      <MoveModeBar
        name="Kesh"
        budget={{ ...DRAGON_BUDGET, crawling: true }}
        mode="walk"
        onChange={onChange}
        gm={false}
      />
    );
    expect(screen.getByRole("button", { name: "Crawl 30" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Forced" })).toBeNull();
  });

  it("sends the picked way with the move, and offers the GM's ruling or a player's question when a rule refuses it", async () => {
    command.mockReset();
    command.mockResolvedValueOnce({
      ok: false,
      message: "It isn't Kesh's turn - moving now needs the GM's go-ahead.",
      blocked: { rule: "movement.off-turn", message: "It isn't Kesh's turn.", overridable: true }
    });
    const { result } = renderHook(() =>
      useMapCommands({
        revision: 3,
        size: { width: 500, height: 500 },
        canMove: () => true,
        moveModeFor: () => "fly",
        drawing: { visibility: "public", visibleToActorId: null, color: "#ffffff" },
        onShapeAdded: () => {}
      })
    );
    await act(async () => {
      await result.current.submitMove(HERO, { x: 75, y: 75 });
    });
    expect(command).toHaveBeenCalledWith("token:move", {
      actorId: HERO,
      position: { x: 75, y: 75 },
      mode: "fly",
      expectedRevision: 3
    });
    expect(result.current.blockedMove?.blocked.rule).toBe("movement.off-turn");
    command.mockResolvedValueOnce({ ok: true, ran: false, askId: "a" });
    await act(async () => {
      await result.current.askAboutMove();
    });
    expect(command).toHaveBeenLastCalledWith("rules:ask", {
      type: "token.move",
      payload: { commandId: expect.any(String), actorId: HERO, position: { x: 75, y: 75 }, mode: "fly" }
    });
    expect(result.current.message).toBe("Asked the GM. Waiting for their call.");
    expect(result.current.blockedMove).toBeNull();
  });

  it("stops saying the question waits once the GM has answered it", async () => {
    command.mockReset();
    command.mockResolvedValueOnce({
      ok: false,
      message: "It isn't Kesh's turn - moving now needs the GM's go-ahead.",
      blocked: { rule: "movement.off-turn", message: "It isn't Kesh's turn.", overridable: true }
    });
    const { result, rerender } = renderHook(
      ({ waitingAsks }: { waitingAsks: number }) =>
        useMapCommands({
          revision: 3,
          size: { width: 500, height: 500 },
          canMove: () => true,
          drawing: { visibility: "public", visibleToActorId: null, color: "#ffffff" },
          onShapeAdded: () => {},
          waitingAsks
        }),
      { initialProps: { waitingAsks: 0 } }
    );
    await act(async () => {
      await result.current.submitMove(HERO, { x: 75, y: 75 });
    });
    command.mockResolvedValueOnce({ ok: true, ran: false, askId: "a" });
    await act(async () => {
      await result.current.askAboutMove();
    });
    rerender({ waitingAsks: 1 });
    expect(result.current.message).toBe("Asked the GM. Waiting for their call.");
    rerender({ waitingAsks: 0 });
    expect(result.current.message).toBe("");
  });
});

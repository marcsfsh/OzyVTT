import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TurnOrder } from "./TurnOrder";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
vi.mock("../lib/command", () => ({ command: (...args: unknown[]) => command(...args) }));

const WAITING = {
  id: "71000000-0000-4000-8000-000000000001",
  boundary: "start" as const,
  steps: [
    { key: "temporary:heroism", name: "Heroism" },
    { key: "ongoing:hero:smite", name: "Searing Smite" },
    { key: "ongoing:goblin:hex", name: "Hex", targetName: "Goblin" }
  ]
};

describe("putting a turn's simultaneous steps in order", () => {
  it("lists the steps as the server sent them, naming the creature a step lands on", () => {
    render(<TurnOrder waiting={WAITING} onFeedback={() => {}} />);
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "HeroismEarlierLater",
      "Searing SmiteEarlierLater",
      "Hex on GoblinEarlierLater"
    ]);
    expect(screen.getByRole("button", { name: "Heroism earlier" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Hex on Goblin later" })).toBeDisabled();
  });

  it("sends the order the controller set", async () => {
    const feedback = vi.fn();
    render(<TurnOrder waiting={WAITING} onFeedback={feedback} />);
    fireEvent.click(screen.getByRole("button", { name: "Heroism later" }));
    fireEvent.click(screen.getByRole("button", { name: "Hex on Goblin earlier" }));
    fireEvent.click(screen.getByRole("button", { name: "In this order" }));
    expect(command).toHaveBeenCalledWith("turn:order", {
      stepsId: WAITING.id,
      order: ["ongoing:hero:smite", "ongoing:goblin:hex", "temporary:heroism"]
    });
    await waitFor(() => expect(feedback).toHaveBeenCalledWith("They happen in that order."));
  });

  it("says a turn's end passes the turn once answered", () => {
    render(<TurnOrder waiting={{ ...WAITING, boundary: "end" }} onFeedback={() => {}} />);
    expect(screen.getByRole("button", { name: "In this order, then end the turn" })).toBeEnabled();
  });
});

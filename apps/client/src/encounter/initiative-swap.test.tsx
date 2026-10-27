import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PlayerView } from "@vtt/domain";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
vi.mock("../lib/command", () => ({ command: (...args: unknown[]) => command(...args) }));
vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { InitiativeSwap } from "./PlayerEncounterPanel";

const ME = "10000000-0000-4000-8000-000000000001";
const ALLY = "10000000-0000-4000-8000-000000000002";

/** Two characters in round 1's order, with the swap offers given. */
const view = (offers: Array<{ actorId: string; withActorId: string }>) =>
  ({
    actors: [
      { id: ME, name: "Ilyana", kind: "player-character" },
      { id: ALLY, name: "Corwin", kind: "player-character" }
    ],
    combat: {
      initiative: [
        { actorId: ME, name: "Ilyana", score: 15 },
        { actorId: ALLY, name: "Corwin", score: 8 }
      ],
      initiativeSwapOffers: offers
    }
  }) as unknown as PlayerView;

describe("Alert's Initiative Swap in the player's turn order", () => {
  it("lets the Alert holder offer a swap to another character", async () => {
    render(<InitiativeSwap state={view([])} myId={ME} alert />);
    fireEvent.click(screen.getByRole("button", { name: "Offer Corwin a swap (Alert)" }));
    await waitFor(() => expect(command).toHaveBeenCalledWith("initiative:swap", { actorId: ME, withActorId: ALLY }));
    expect(await screen.findByText(/It is made when their player takes it/)).toBeTruthy();
  });

  it("lets the ally's player take the offer, and shows nothing without Alert or an offer", async () => {
    const { container } = render(<InitiativeSwap state={view([])} myId={ALLY} alert={false} />);
    expect(container.textContent).toBe("");
    render(<InitiativeSwap state={view([{ actorId: ME, withActorId: ALLY }])} myId={ALLY} alert={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Swap Initiative with Ilyana" }));
    await waitFor(() => expect(command).toHaveBeenCalledWith("initiative:swap", { actorId: ALLY, withActorId: ME }));
  });
});

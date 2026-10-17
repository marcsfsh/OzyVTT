import { describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlayerActor, PlayerView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
const command = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
// Reference reads (spells, classes) never answer here; nothing under test waits on them.
vi.mock("../lib/command", () => ({ command, read: () => new Promise(() => {}) }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("../router", async (original) => ({ ...(await original<typeof import("../router")>()), navigate }));

import { ClaimCharacter, pickLine } from "./ClaimCharacter";
import { noteClaimReleased } from "../lib/claim-notice";

const actor = (over: Partial<PlayerActor> & Pick<PlayerActor, "id" | "name">): PlayerActor =>
  ({
    kind: "player-character",
    visibility: "public",
    hp: { kind: "exact", current: 74, maximum: 74, temporary: 0 },
    effects: [],
    conditions: [],
    claimStatus: "available",
    presence: null,
    size: "medium",
    sizeCells: 1,
    ...over
  }) as unknown as PlayerActor;

const view = (actors: PlayerActor[]) =>
  ({ revision: 3, partyVisibility: "name-and-class", actors }) as unknown as PlayerView;

describe("the claim picker", () => {
  it("says who a character is in one line", () => {
    expect(pickLine(actor({ id: "a", name: "Borin", species: "Dwarf", classLine: "Fighter 7" }))).toBe(
      "Dwarf Fighter 7 · HP 74"
    );
    expect(pickLine(actor({ id: "b", name: "Sable" }))).toBe("HP 74");
    expect(
      pickLine(actor({ id: "c", name: "Vex", classLine: "Rogue 3", hp: { kind: "band", band: "healthy" } as never }))
    ).toBe("Rogue 3");
  });

  it("names a character claimed elsewhere and what to do, and claims the rest", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ClaimCharacter
          state={view([
            actor({ id: "a", name: "Borin", species: "Dwarf", classLine: "Fighter 7" }),
            actor({ id: "b", name: "Lyra", claimStatus: "claimed" })
          ])}
        />
      </ToastProvider>
    );
    const cards = screen.getAllByRole("listitem");
    expect(cards[0]).toHaveTextContent("Dwarf Fighter 7 · HP 74");
    expect(within(cards[1]).queryByRole("button")).toBeNull();
    expect(cards[1]).toHaveTextContent("Claimed on another device. Ask the GM to release it.");

    await user.click(screen.getByRole("button", { name: "Claim Borin" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Claim" }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/me"));
    expect(command).toHaveBeenCalledWith("character:claim", { actorId: "a", expectedRevision: 3 });
  });

  it("tells a player the GM released their character", () => {
    render(
      <ToastProvider>
        <ClaimCharacter state={view([actor({ id: "a", name: "Borin" })])} />
      </ToastProvider>
    );
    expect(screen.queryByText("The GM released Borin")).toBeNull();
    act(() => noteClaimReleased({ actorId: "a", name: "Borin" }));
    expect(screen.getByText("The GM released Borin")).toBeInTheDocument();
    act(() => noteClaimReleased(null));
  });
});

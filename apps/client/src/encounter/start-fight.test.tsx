import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameStateSchema, type GmActor, type GmView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

import { socket } from "../socket";
import { EncounterPanel } from "./EncounterPanel";
import { playsOf, rollsLine, sidesOf } from "./StartFight";

const ARIA = "10000000-0000-4000-8000-000000000001";
const BORIN = "10000000-0000-4000-8000-000000000002";
const MAP = "20000000-0000-4000-8000-000000000001";

const stateWith = (
  combat: Record<string, unknown>,
  revision: number,
  extra: Readonly<Record<string, Record<string, unknown>>> = {}
): GmView => {
  const actor = (id: string, name: string) => ({
    id,
    name,
    kind: "player-character",
    visibility: "public",
    hp: { current: 40, maximum: 40 },
    ...extra[id]
  });
  return GameStateSchema.parse({
    schemaVersion: 1,
    revision,
    actors: [actor(ARIA, "Aria"), actor(BORIN, "Borin")],
    combat: { mapAssetId: MAP, ...combat }
  }) as unknown as GmView;
};

describe("starting a second encounter", () => {
  it("rolls everyone again instead of reusing the last encounter's order", async () => {
    const user = userEvent.setup();
    const fighting = stateWith(
      {
        active: true,
        round: 3,
        turnActorId: ARIA,
        initiative: [
          { actorId: ARIA, score: 17 },
          { actorId: BORIN, score: 11 }
        ]
      },
      12
    );
    const panel = (state: GmView) => (
      <ToastProvider>
        <EncounterPanel role="gm" state={state} selectedMap={null} />
      </ToastProvider>
    );
    const { rerender } = render(panel(fighting));
    rerender(panel(stateWith({ active: false }, 13)));

    await user.click(screen.getByRole("button", { name: /Start the encounter/ }));
    const calls = (socket.emit as unknown as { mock: { calls: [string, { entries?: unknown[] }][] } }).mock.calls;
    const start = calls.find(([event]) => event === "encounter:start");
    expect(start?.[1].entries).toEqual([{ actorId: ARIA }, { actorId: BORIN }]);
  });
});

describe("who plays each party character", () => {
  it("starts from the mark, keeps a claimed character on its device, and sends the GM's choice", async () => {
    const user = userEvent.setup();
    const marks = {
      [ARIA]: { playedAtTable: true },
      [BORIN]: { ownerSessionId: "30000000-0000-4000-8000-00000000000a" }
    };
    const fighting = stateWith(
      {
        active: true,
        round: 2,
        turnActorId: ARIA,
        initiative: [
          { actorId: ARIA, score: 9 },
          { actorId: BORIN, score: 4 }
        ]
      },
      20,
      marks
    );
    const panel = (state: GmView) => (
      <ToastProvider>
        <EncounterPanel role="gm" state={state} selectedMap={null} />
      </ToastProvider>
    );
    const { rerender } = render(panel(fighting));
    rerender(panel(stateWith({ active: false }, 21, marks)));

    const aria = within(screen.getByRole("group", { name: "Where Aria is played" }));
    expect(aria.getByRole("button", { name: "At the table" })).toHaveAttribute("aria-pressed", "true");
    const borin = within(screen.getByRole("group", { name: "Where Borin is played" }));
    expect(borin.getByRole("button", { name: "On their device" })).toHaveAttribute("aria-pressed", "true");
    expect(borin.getByRole("button", { name: "At the table" })).toBeDisabled();
    expect(screen.getByText("Claimed on a player's device")).toBeInTheDocument();

    await user.click(aria.getByRole("button", { name: "On their device" }));
    await user.click(screen.getByRole("button", { name: /Start the encounter/ }));
    const calls = (socket.emit as unknown as { mock: { calls: [string, { atTable?: unknown }][] } }).mock.calls;
    const start = calls.filter(([event]) => event === "encounter:start").at(-1);
    expect(start?.[1].atTable).toEqual({ [ARIA]: false, [BORIN]: false });
  });

  it("says on a phone's row who is at the table", () => {
    const party = [
      { id: ARIA, name: "Aria" },
      { id: BORIN, name: "Borin" }
    ] as GmActor[];
    expect(playsOf(party, (actor) => actor.id === ARIA)).toBe("Aria at the table");
    expect(playsOf(party, () => false)).toBe("All on their devices");
  });
});

describe("Start an encounter's list", () => {
  const GOBLIN = "10000000-0000-4000-8000-000000000003";
  const staged = (gmShaped: boolean) => {
    const state = stateWith(
      {
        initiative: [
          { actorId: ARIA, score: 0 },
          { actorId: GOBLIN, score: 0 }
        ]
      },
      4
    );
    const goblin = { ...state.actors[0], id: GOBLIN, name: "Goblin", kind: "monster" };
    return {
      ...state,
      actors: [...state.actors, goblin],
      combat: { ...state.combat, encounters: gmShaped ? [] : undefined }
    } as unknown as GmView;
  };

  it("lists the staged characters and monsters, ticked, and leaves out the rest of the roster", () => {
    render(
      <ToastProvider>
        <EncounterPanel role="gm" state={staged(true)} selectedMap={null} />
      </ToastProvider>
    );
    expect(screen.getByRole("checkbox", { name: "Aria is in this encounter" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Goblin is in this encounter" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Borin is in this encounter" })).toBeNull();
    expect(screen.getByText("Rolls initiative for all 2")).toBeInTheDocument();
  });
});

describe("who rolls initiative", () => {
  const pc = (id: string, claimed: boolean) =>
    ({ id, name: id, kind: "player-character", ownerSessionId: claimed ? "s" : null }) as unknown as GmActor;
  const monster = { id: "g", name: "g", kind: "monster", ownerSessionId: null } as unknown as GmActor;

  it("says the players roll for their claimed characters only when they do", () => {
    expect(rollsLine([pc("a", true), pc("b", false), monster], false)).toBe("Rolls initiative for all 3");
    expect(rollsLine([pc("a", true), pc("b", false), monster], true)).toBe(
      "Rolls initiative for 2. Players roll for their 1 claimed character."
    );
    expect(rollsLine([pc("a", true)], true)).toBe("Players roll for their 1 claimed character.");
    expect(rollsLine([], false)).toBe("Tick at least one character or monster.");
    expect(sidesOf([pc("a", true), monster])).toBe("1 of the party, 1 monster");
  });
});

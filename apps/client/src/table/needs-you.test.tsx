import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { GameStateSchema, type GmView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }) as Record<string, unknown>);
const read = vi.fn(async (..._args: unknown[]) => ({ ok: false }) as Record<string, unknown>);
vi.mock("../lib/command", () => ({
  command: (...args: unknown[]) => command(...args),
  read: (...args: unknown[]) => read(...args)
}));
vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { clearTargeting, useTargeting } from "../encounter/targeting";
import { NeedsYou } from "./NeedsYou";
import { needsItems } from "./needs";

const IDS = {
  lyra: "10000000-0000-4000-8000-0000000000d1",
  borin: "10000000-0000-4000-8000-0000000000d2",
  goblin: "10000000-0000-4000-8000-0000000000d3",
  map: "20000000-0000-5000-8000-0000000000d1",
  player: "30000000-0000-4000-8000-0000000000d1"
} as const;

/** A fight in round 2 with what a GM owes: a hit to apply, a question, a held attack, a dying ally, a rest asked for. */
function table(changes: (state: GmView) => void = () => {}): GmView {
  const game = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.lyra,
        name: "Lyra",
        kind: "player-character",
        hp: { current: 0, maximum: 44 },
        armorClass: 15,
        ownerSessionId: IDS.player,
        deathSaves: { successes: 0, failures: 1, stable: false }
      },
      { id: IDS.borin, name: "Borin", kind: "player-character", hp: { current: 74, maximum: 74 } },
      { id: IDS.goblin, name: "Goblin 1", kind: "monster", hp: { current: 10, maximum: 10 } }
    ],
    combat: {
      active: true,
      round: 2,
      turnActorId: IDS.borin,
      mapAssetId: IDS.map,
      initiative: [
        { actorId: IDS.borin, score: 15 },
        { actorId: IDS.lyra, score: 12 },
        { actorId: IDS.goblin, score: 8 }
      ],
      pendingDamage: [
        {
          id: "40000000-0000-4000-8000-0000000000d1",
          sourceActorId: IDS.lyra,
          sourceName: "Lyra",
          actionName: "Fire Bolt",
          targetActorId: IDS.goblin,
          targetName: "Goblin 1",
          proposedDamageParts: [{ amount: 9, type: "fire" }],
          proposedTotal: 9,
          createdAt: 0
        }
      ],
      pendingRuleAsks: [
        {
          id: "40000000-0000-4000-8000-0000000000d2",
          actorId: IDS.borin,
          rule: "movement.through-hostile",
          family: "movement",
          message: "Borin can't move through Goblin 1's space.",
          command: { type: "token.move", payload: {} },
          createdAt: "2026-10-17T00:00:00.000Z"
        }
      ]
    },
    rest: { requests: [IDS.borin] }
  }) as unknown as GmView;
  const view = { ...game, actors: game.actors.map((actor) => ({ ...actor, presence: null })) } as GmView;
  changes(view);
  return view;
}

describe("Needs you", () => {
  it("lists every decision the GM owes with its numbers, and counts them", () => {
    render(
      <ToastProvider>
        <NeedsYou state={table()} token={null} />
      </ToastProvider>
    );
    const strip = screen.getByRole("region", { name: /Needs you · 4/ });
    expect(within(strip).getByText("Lyra's Fire Bolt hit Goblin 1")).toBeTruthy();
    expect(within(strip).getByText("9 fire.")).toBeTruthy();
    expect(within(strip).getByText("Borin asks for your ruling")).toBeTruthy();
    expect(within(strip).getByText("Borin can't move through Goblin 1's space.")).toBeTruthy();
    expect(within(strip).getByText("Lyra is dying · 0 successes · 1 failure")).toBeTruthy();
    expect(within(strip).getByText("Borin asks for a Long Rest")).toBeTruthy();
    // Asked for during the fight, it waits beside the fight's own decisions.
    expect(within(strip).getByText("Approve gives Borin a Long Rest now. Pass the 8 hours from Rest.")).toBeTruthy();
  });

  it("carries each item's own buttons", async () => {
    command.mockClear();
    render(
      <ToastProvider>
        <NeedsYou state={table()} token={null} />
      </ToastProvider>
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply 9" })));
    expect(command).toHaveBeenCalledWith("damage:resolve", {
      proposalId: "40000000-0000-4000-8000-0000000000d1",
      apply: true
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Allow" })));
    expect(command).toHaveBeenCalledWith("rules:answer", {
      askId: "40000000-0000-4000-8000-0000000000d2",
      allow: true
    });
    // Change takes another number before applying.
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Damage to apply" }), { target: { value: "12" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply 12" })));
    expect(command).toHaveBeenLastCalledWith("damage:resolve", {
      proposalId: "40000000-0000-4000-8000-0000000000d1",
      apply: true,
      amount: 12
    });
  });

  it("shows a held attack as waiting on the player, with a way to answer for them", () => {
    const state = table((view) => {
      view.combat.pendingReactions = [
        {
          id: "40000000-0000-4000-8000-0000000000d3",
          kind: "attack-would-hit",
          actorId: IDS.lyra,
          actionId: "shield",
          actionName: "Shield",
          targetActorId: IDS.lyra,
          sourceActorId: IDS.goblin,
          sourceName: "Goblin 1",
          triggerCommandId: "50000000-0000-4000-8000-0000000000d1",
          proposedDamage: 0,
          proposedDamageParts: [],
          critical: false,
          acBonus: 5,
          rollsAttack: false,
          createdAt: 0,
          parkedAttack: {
            actionId: "shortbow",
            builtin: false,
            attackNatural: 15,
            attackTotal: 19,
            cover: null,
            conditionId: null,
            attackKinds: [],
            pushFeet: null,
            slotLevel: null,
            damageType: null,
            bonusDice: []
          }
        }
      ] as unknown as GmView["combat"]["pendingReactions"];
    });
    render(
      <ToastProvider>
        <NeedsYou state={state} token={null} />
      </ToastProvider>
    );
    expect(screen.getByText("Waiting on Lyra · Shield")).toBeTruthy();
    expect(screen.getByText("Goblin 1's hit (19 against AC 15) waits until Lyra answers.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use Shield" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Answer for Lyra" }));
    expect(screen.getByRole("button", { name: "Use Shield" })).toBeTruthy();
  });

  it("puts a held attack first and renders nothing when nothing waits", () => {
    expect(needsItems(table()).map((item) => item.kind)).toEqual(["damage", "dying", "ask", "rest"]);
    const quiet = table((view) => {
      view.combat.pendingDamage = [];
      view.combat.pendingRuleAsks = [];
      view.rest = { ...view.rest, requests: [] };
      view.actors = view.actors.map((actor) =>
        actor.id === IDS.lyra ? { ...actor, hp: { ...actor.hp, current: 5 } } : actor
      );
    });
    const { container } = render(
      <ToastProvider>
        <NeedsYou state={quiet} token={null} />
      </ToastProvider>
    );
    expect(container.querySelector(".needs-you")).toBeNull();
  });
});

describe("a player's action waiting for the GM's aim (ADR-0044)", () => {
  const ask = {
    id: "40000000-0000-4000-8000-0000000000e1",
    actorId: IDS.borin,
    actorName: "Borin",
    actionId: "spell-guiding-bolt",
    actionName: "Guiding Bolt",
    slotLevel: 2,
    createdAt: 0
  };
  const asking = () =>
    table((state) => {
      state.combat.targetAsks = [ask];
      const borin = state.actors.find((actor) => actor.id === IDS.borin)!;
      (borin as { definitionId?: string }).definitionId = "borin-def";
    });
  function AimProbe() {
    const aim = useTargeting();
    return <output aria-label="Aiming">{aim ? `${aim.attackerId} ${aim.action.id} ${aim.slotLevel}` : "none"}</output>;
  }

  it("names it with how its player cast it, and opens the aim at that slot", async () => {
    clearTargeting();
    read.mockImplementation(async () => ({
      ok: true,
      actions: [{ id: "spell-guiding-bolt", name: "Guiding Bolt", activation: "action", attackBonus: 5, damage: [] }]
    }));
    render(
      <ToastProvider>
        <NeedsYou state={asking()} token={null} />
        <AimProbe />
      </ToastProvider>
    );
    expect(screen.getByText("Borin uses Guiding Bolt · choose a target")).toBeTruthy();
    expect(
      screen.getByText("Cast at level 2. Pick the target on the map, then roll it as you would your own.")
    ).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Choose the target" })));
    expect(read).toHaveBeenCalledWith("content:monster-actions", { definitionId: "borin-def", actorId: IDS.borin });
    expect(screen.getByRole("status", { name: "Aiming" }).textContent).toBe(`${IDS.borin} spell-guiding-bolt 2`);
  });

  it("turns it down", async () => {
    command.mockClear();
    render(
      <ToastProvider>
        <NeedsYou state={asking()} token={null} />
      </ToastProvider>
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Turn down" })));
    expect(command).toHaveBeenCalledWith("action:withdraw-target-ask", { askId: ask.id });
  });
});

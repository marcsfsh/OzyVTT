import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameStateSchema, type GmView, type PlayerView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = { emit: vi.fn() };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});
vi.mock("../lib/command", () => ({
  command: vi.fn(async () => ({ ok: true })),
  read: vi.fn(async () => ({ ok: false }))
}));

import { EncounterPanel } from "../encounter/EncounterPanel";
import { InFooter } from "./footerSlot";
import { TablePanel } from "./TablePanel";

// The panel beside the map is one tablist per role and moment: its tabs are real tabs tied to their panels, the
// chosen one is remembered per device, and the footer holds the view's one primary.

const LYRA = "10000000-0000-4000-8000-0000000000c1";
const BORIN = "10000000-0000-4000-8000-0000000000c2";
const GOBLIN = "10000000-0000-4000-8000-0000000000c3";
const MAP = "20000000-0000-5000-8000-0000000000c1";

function gmView(active: boolean): GmView {
  const game = GameStateSchema.parse({
    schemaVersion: 1,
    revision: 5,
    actors: [
      { id: LYRA, name: "Lyra", kind: "player-character", hp: { current: 37, maximum: 44 }, armorClass: 15 },
      { id: BORIN, name: "Borin", kind: "player-character", hp: { current: 74, maximum: 74 } },
      { id: GOBLIN, name: "Goblin 1", kind: "monster", hp: { current: 10, maximum: 10 } }
    ],
    combat: {
      active,
      round: 2,
      turnActorId: active ? LYRA : null,
      mapAssetId: MAP,
      initiative: [
        { actorId: LYRA, score: 15 },
        { actorId: BORIN, score: 12 },
        { actorId: GOBLIN, score: 8 }
      ]
    }
  });
  return { ...game, actors: game.actors.map((actor) => ({ ...actor, presence: null })) } as unknown as GmView;
}

function playerView(active: boolean, myTurn = true): PlayerView {
  const actor = (id: string, name: string, kind: string, mine = false) => ({
    id,
    name,
    kind,
    visibility: "public",
    claimStatus: mine ? "mine" : "available",
    hp: mine ? { kind: "exact", current: 37, maximum: 44, temporary: 0 } : { kind: "band", band: "healthy" },
    conditions: [],
    effects: []
  });
  return {
    revision: 5,
    rollCalls: [],
    rolls: [],
    actors: [actor(LYRA, "Lyra", "player-character", true), actor(GOBLIN, "Goblin 1", "monster")],
    combat: {
      active,
      round: 2,
      turnActorId: active ? (myTurn ? LYRA : GOBLIN) : null,
      mapAssetId: MAP,
      turn: { actionUsed: false, bonusActionUsed: false, turnUses: {}, movementUsedFeet: 0 },
      initiative: active
        ? [
            { actorId: LYRA, name: "Lyra", active: myTurn },
            { actorId: GOBLIN, name: "Goblin 1", active: !myTurn }
          ]
        : [],
      tokens: [],
      annotations: [],
      reactionsUsed: [],
      ruleExceptions: {},
      rulesMode: "strict",
      playerDamageMode: "proposal",
      pendingReactions: [],
      pendingSaves: [],
      pendingInitiative: [],
      pendingRuleAsks: []
    }
  } as unknown as PlayerView;
}

const slots = {
  dice: <p>The dice</p>,
  log: <p>The log</p>,
  token: <p>The token</p>,
  party: <p>The party</p>,
  needs: <p>Needs you · 2</p>,
  needsCount: 2
};

afterEach(() => localStorage.clear());

const tabNames = (list: HTMLElement) =>
  within(list)
    .getAllByRole("tab")
    .map((tab) => tab.textContent);

describe("the GM's panel", () => {
  it("on a laptop: Fight, Dice, Log and Token under Needs you, with Next turn in the footer", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <EncounterPanel role="gm" state={gmView(true)} selectedMap={null} slots={slots} />
      </ToastProvider>
    );
    const list = screen.getByRole("tablist", { name: "The fight · round 2" });
    expect(tabNames(list)).toEqual(["Fight", "Dice", "Log", "Token"]);
    // Needs you sits above the tabs, outside every tab panel.
    expect(screen.getByText("Needs you · 2").closest("[role=tabpanel]")).toBeNull();
    // The Fight tab holds the order and the acting creature's console.
    const fight = screen.getByRole("tabpanel", { name: "Fight" });
    expect(within(fight).getByRole("region", { name: "Now acting · Lyra" })).toBeTruthy();
    expect(within(fight).getByText("Borin")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Next turn/ })).toBeTruthy();
    // A tab shows its own panel and is remembered on this device.
    await user.click(within(list).getByRole("tab", { name: "Dice" }));
    expect(screen.getByRole("tabpanel", { name: "Dice" }).textContent).toBe("The dice");
    expect(screen.queryByRole("tabpanel", { name: "Fight" })).toBeNull();
    expect(localStorage.getItem("vtt.table-tab.gm.laptop")).toBe("dice");
    // Next turn stays in the footer while another tab is shown.
    expect(screen.getByRole("button", { name: /Next turn/ })).toBeTruthy();
  });

  it("on a phone: Act, Order, Needs with its count, Dice and Log", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <EncounterPanel role="gm" state={gmView(true)} selectedMap={null} phone slots={slots} />
      </ToastProvider>
    );
    const list = screen.getByRole("tablist", { name: "The fight · round 2" });
    expect(tabNames(list)).toEqual(["Act", "Order", "Needs 2", "Dice", "Log"]);
    expect(screen.getByRole("tabpanel", { name: "Act" })).toBeTruthy();
    // Needs you is a tab of its own on a phone.
    expect(screen.queryByText("Needs you · 2")).toBeNull();
    await user.click(within(list).getByRole("tab", { name: "Needs 2" }));
    expect(screen.getByRole("tabpanel", { name: "Needs 2" }).textContent).toBe("Needs you · 2");
  });

  it("between fights: the scene to start a fight from, with Start the fight in the footer", () => {
    render(
      <ToastProvider>
        <EncounterPanel role="gm" state={gmView(false)} selectedMap={null} phone slots={slots} />
      </ToastProvider>
    );
    expect(tabNames(screen.getByRole("tablist", { name: "The table" }))).toEqual(["Scene", "Party", "Dice", "Log"]);
    expect(within(screen.getByRole("tabpanel", { name: "Scene" })).getByRole("heading", { name: "Start a fight" }));
    expect(screen.getByRole("button", { name: /Start the fight/ })).toBeTruthy();
  });
});

describe("a player's panel", () => {
  it("in a fight: Turn, Order, Sheet, Dice and Log, with End turn in the footer on their turn", () => {
    render(
      <ToastProvider>
        <EncounterPanel role="player" state={playerView(true)} slots={slots} />
      </ToastProvider>
    );
    const list = screen.getByRole("tablist", { name: "The fight · round 2" });
    expect(tabNames(list)).toEqual(["Turn", "Order", "Sheet", "Dice", "Log"]);
    const turn = screen.getByRole("tabpanel", { name: "Turn" });
    expect(within(turn).getByRole("heading", { name: "Your turn" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "End turn" })).toBeTruthy();
    // Each tab names the panel it controls.
    for (const tab of within(list).getAllByRole("tab"))
      expect(document.getElementById(tab.getAttribute("aria-controls")!)?.getAttribute("role")).toBe("tabpanel");
  });

  it("while someone else acts: their HP and Reaction in the bar, who acts left to the header, and no End turn", () => {
    render(
      <ToastProvider>
        <EncounterPanel role="player" state={playerView(true, false)} slots={slots} />
      </ToastProvider>
    );
    expect(screen.queryByText(/Goblin 1 is acting/)).toBeNull();
    expect(screen.getByText("HP 37/44")).toBeTruthy();
    expect(screen.getByText("Your actions show here on your turn.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "End turn" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reaction" })).toBeTruthy();
  });

  it("between fights: Me, Party, Dice and Log", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <EncounterPanel role="player" state={playerView(false)} slots={slots} />
      </ToastProvider>
    );
    const list = screen.getByRole("tablist", { name: "The table" });
    expect(tabNames(list)).toEqual(["Me", "Party", "Dice", "Log"]);
    await user.click(within(list).getByRole("tab", { name: "Party" }));
    expect(screen.getByRole("tabpanel", { name: "Party" }).textContent).toBe("The party");
  });
});

describe("the bar under the thumb", () => {
  const panel = (phone: boolean) => (
    <TablePanel
      label="The fight · round 2"
      tabs={[
        {
          id: "turn",
          label: "Turn",
          content: (
            <InFooter>
              <button type="button">Roll Fire Bolt</button>
            </InFooter>
          )
        }
      ]}
      active="turn"
      onActive={() => {}}
      footer={<button type="button">End turn</button>}
      phone={phone}
    />
  );

  it("takes a target picker's Roll on a phone, ahead of the bar's own controls", () => {
    render(panel(true));
    const roll = screen.getByRole("button", { name: "Roll Fire Bolt" });
    expect(roll.closest(".table-panel-foot-slot")).not.toBeNull();
    expect(roll.closest("[role=tabpanel]")).toBeNull();
    expect(screen.getByRole("button", { name: "End turn" }).closest(".table-panel-foot-main")).not.toBeNull();
  });

  it("leaves the Roll in the tab on a laptop", () => {
    render(panel(false));
    expect(screen.getByRole("button", { name: "Roll Fire Bolt" }).closest("[role=tabpanel]")).not.toBeNull();
  });
});

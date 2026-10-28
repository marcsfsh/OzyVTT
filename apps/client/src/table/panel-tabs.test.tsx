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
    builderPolicy: { playerBuilder: "open", maxLevel: 20 },
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
  const fightTab = "Encounter2, 2 waiting on you";
  it("on a laptop: Encounter, Log, Party and Notes, with what waits on the GM leading Encounter and End turn in the footer", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <EncounterPanel
          role="gm"
          state={gmView(true)}
          selectedMap={null}
          slots={{ ...slots, tonight: <p>Tonight board</p>, codex: <p>The Codex</p> }}
        />
      </ToastProvider>
    );
    const list = screen.getByRole("tablist", { name: "The encounter · round 2" });
    // Token joins them only while a token on the map is pressed.
    expect(tabNames(list)).toEqual([fightTab, "Log", "Party", "Notes"]);
    // The Fight tab leads with what waits on the GM, then the order and the acting creature's console.
    const fight = screen.getByRole("tabpanel", { name: /^Encounter/ });
    expect(within(fight).getByText("Needs you · 2")).toBeTruthy();
    expect(within(fight).getByRole("region", { name: "Now acting · Lyra" })).toBeTruthy();
    // The order and its row tools fold under the acting creature.
    expect(within(fight).getByText("Turn order and tools")).toBeTruthy();
    expect(screen.getByRole("button", { name: "End turn" })).toBeTruthy();
    expect(screen.getByText("Next: Borin")).toBeTruthy();
    // A tab shows its own panel and is remembered on this device.
    await user.click(within(list).getByRole("tab", { name: "Log" }));
    // Log holds the feed and the composer under it; the dice tools open from its Dice options.
    const log = screen.getByRole("tabpanel", { name: "Log" });
    expect(within(log).getByText("The log")).toBeTruthy();
    expect(within(log).getByRole("group", { name: "Quick rolls" })).toBeTruthy();
    expect(within(log).getByRole("button", { name: "Dice options" })).toBeTruthy();
    expect(screen.queryByText("Needs you · 2")).toBeNull();
    expect(localStorage.getItem("vtt.table-tab.gm.laptop")).toBe("log");
    // End turn stays in the footer while another tab is shown.
    expect(screen.getByRole("button", { name: "End turn" })).toBeTruthy();
    // Notes switches between Tonight and the Codex.
    await user.click(within(list).getByRole("tab", { name: "Notes" }));
    expect(screen.getByText("Tonight board")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Codex" }));
    expect(screen.getByText("The Codex")).toBeTruthy();
  });

  it("on a phone: Encounter with the acting creature, then Order, Log and Party", () => {
    render(
      <ToastProvider>
        <EncounterPanel role="gm" state={gmView(true)} selectedMap={null} phone slots={slots} />
      </ToastProvider>
    );
    const list = screen.getByRole("tablist", { name: "The encounter · round 2" });
    expect(tabNames(list)).toEqual([fightTab, "Order", "Log", "Party"]);
    const fight = screen.getByRole("tabpanel", { name: /^Encounter/ });
    expect(within(fight).getByText("Needs you · 2")).toBeTruthy();
    expect(within(fight).getByRole("region", { name: "Now acting · Lyra" })).toBeTruthy();
  });

  it("between encounters: Start an encounter on the Encounter tab, with Start the encounter and who rolls in the footer", () => {
    render(
      <ToastProvider>
        <EncounterPanel role="gm" state={gmView(false)} selectedMap={null} slots={slots} />
      </ToastProvider>
    );
    expect(tabNames(screen.getByRole("tablist", { name: "The table" }))).toEqual([fightTab, "Log", "Party"]);
    const fight = screen.getByRole("tabpanel", { name: /^Encounter/ });
    expect(within(fight).getByRole("heading", { name: "Start an encounter" })).toBeTruthy();
    // The staged characters and the monster, ticked.
    for (const name of ["Lyra", "Borin", "Goblin 1"])
      expect(within(fight).getByRole("checkbox", { name: `${name} is in this encounter` })).toBeChecked();
    expect(screen.getByRole("button", { name: "Start the encounter" })).toBeTruthy();
    expect(screen.getByText("Rolls initiative for all 3")).toBeTruthy();
  });
});

describe("a player's panel", () => {
  it("in an encounter: Turn, Sheet, Log and Party, with End turn in the footer on their turn", () => {
    render(
      <ToastProvider>
        <EncounterPanel role="player" state={playerView(true)} slots={slots} />
      </ToastProvider>
    );
    const list = screen.getByRole("tablist", { name: "The encounter · round 2" });
    expect(tabNames(list)).toEqual(["Turn", "Sheet", "Log", "Party"]);
    const turn = screen.getByRole("tabpanel", { name: "Turn" });
    expect(within(turn).getByRole("heading", { name: "Your turn" })).toBeTruthy();
    expect(within(turn).getByRole("img", { name: "Round 2" })).toBeTruthy();
    // The order folds under the turn, with what a player can do from it.
    expect(within(turn).getByText("Turn order")).toBeTruthy();
    expect(screen.getByRole("button", { name: "End turn" })).toBeTruthy();
    // Each tab names the panel it controls.
    for (const tab of within(list).getAllByRole("tab"))
      expect(document.getElementById(tab.getAttribute("aria-controls")!)?.getAttribute("role")).toBe("tabpanel");
  });

  it("on their turn: the four lamps on the turn card, and End turn alone under the thumb", () => {
    render(
      <ToastProvider>
        <EncounterPanel role="player" state={playerView(true)} phone slots={slots} />
      </ToastProvider>
    );
    const lamps = screen.getByRole("group", { name: "Your turn resources" });
    expect(
      within(lamps)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"))
    ).toEqual(["Action", "Bonus", "Reaction"]);
    expect(within(lamps).getByRole("group", { name: /^Move/ })).toBeTruthy();
    const foot = screen.getByRole("button", { name: "End turn" }).closest(".table-panel-foot")!;
    expect(
      within(foot as HTMLElement)
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["End turn"]);
  });

  it("while someone else acts: who acts and when this player is next, only the Reaction ready, and no End turn", () => {
    render(
      <ToastProvider>
        <EncounterPanel role="player" state={playerView(true, false)} slots={slots} />
      </ToastProvider>
    );
    expect(screen.getByText("Goblin 1 is acting")).toBeTruthy();
    // Two in the order: after the goblin, the round wraps to Lyra.
    expect(screen.getByText("Your turn is next")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "End turn" })).toBeNull();
    expect(screen.getByRole("button", { name: "Action" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reaction" })).toBeEnabled();
    expect(screen.getByRole("group", { name: "Reaction: ready" })).toBeTruthy();
  });

  it("between encounters: Me, Log and Party", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <EncounterPanel role="player" state={playerView(false)} slots={slots} />
      </ToastProvider>
    );
    const list = screen.getByRole("tablist", { name: "The table" });
    expect(tabNames(list)).toEqual(["Me", "Log", "Party"]);
    await user.click(within(list).getByRole("tab", { name: "Party" }));
    expect(screen.getByRole("tabpanel", { name: "Party" }).textContent).toBe("The party");
  });
});

describe("the bar under the thumb", () => {
  const panel = (phone: boolean) => (
    <TablePanel
      label="The encounter · round 2"
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

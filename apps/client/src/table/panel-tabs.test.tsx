import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
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
import { TableDock } from "./TableDock";
import { PhoneSwitch } from "./phoneSwitch";
import { setWaitingList } from "../settings/preferences";
import { socket } from "../socket";
import "../encounter/CombatLog";

/** The log's own listener, taken as its module registered it, so a test can deliver lines as the server would. */
const pushLogLine = vi.mocked(socket.on).mock.calls.find(([event]) => event === "log:entry")?.[1] as unknown as (
  entry: unknown
) => void;

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
  waiting: <p>The list alone</p>,
  needsCount: 2
};

afterEach(() => {
  localStorage.clear();
  setWaitingList("turn");
});

const tabNames = (list: HTMLElement) =>
  within(list)
    .getAllByRole("tab")
    .map((tab) => tab.textContent);

describe("the GM's panel", () => {
  const fightTab = "Encounter2, 2 waiting";
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
    // The acting name is Chakra Petch with who runs it; YOUR TURN is the table's one chrome lettering.
    expect(within(fight).getByRole("heading", { name: "Lyra" }).classList.contains("chrome")).toBe(false);
    expect(within(fight).getByText("Acting · from the player's device")).toBeTruthy();
    expect(document.querySelectorAll(".chrome")).toHaveLength(0);
    // The order and its row tools fold under the acting creature.
    expect(within(fight).getByText("Turn order and tools")).toBeTruthy();
    // The encounter's options are a More at the end of the panel's tabs (C3 running spec 2.3).
    expect(within(fight).queryByRole("button", { name: "Encounter options" })).toBeNull();
    expect(screen.getByRole("button", { name: "Encounter options" }).closest(".table-panel-tabrow")).not.toBeNull();
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

  it("with the list in its own tab: the bell's tab comes first and holds it, and Encounter is the turn alone", async () => {
    const user = userEvent.setup();
    localStorage.setItem("vtt.table-tab.gm.laptop", "waiting");
    setWaitingList("tab");
    const view = render(
      <ToastProvider>
        <EncounterPanel role="gm" state={gmView(true)} selectedMap={null} slots={slots} />
      </ToastProvider>
    );
    const list = screen.getByRole("tablist", { name: "The encounter · round 2" });
    expect(tabNames(list)).toEqual(["2Waiting, 2", "Encounter", "Log", "Party"]);
    expect(within(screen.getByRole("tabpanel", { name: "Waiting, 2" })).getByText("The list alone")).toBeTruthy();
    await user.click(within(list).getByRole("tab", { name: "Encounter" }));
    const fight = screen.getByRole("tabpanel", { name: "Encounter" });
    expect(within(fight).queryByText("Needs you · 2")).toBeNull();
    expect(within(fight).getByRole("region", { name: "Now acting · Lyra" })).toBeTruthy();
    // Moving the list back drops its tab, and a remembered list tab falls back to Encounter.
    await user.click(within(list).getByRole("tab", { name: "Waiting, 2" }));
    act(() => setWaitingList("turn"));
    expect(tabNames(screen.getByRole("tablist", { name: "The encounter · round 2" }))).toEqual([
      fightTab,
      "Log",
      "Party"
    ]);
    expect(screen.getByRole("tab", { name: /^Encounter/, selected: true })).toBeTruthy();
    view.unmount();
  });

  it("counts the log lines that arrived since Log was last opened, and drops the count when it opens", async () => {
    const user = userEvent.setup();
    const view = () =>
      render(
        <ToastProvider>
          <EncounterPanel role="gm" state={gmView(true)} selectedMap={null} slots={slots} />
        </ToastProvider>
      );
    const first = view();
    const push = pushLogLine;
    const line = (id: number) =>
      act(() => push({ id, at: "", kind: "chat", text: `Line ${id}`, gmOnly: false, revision: 1 }));
    line(9001);
    line(9002);
    line(9003);
    line(9004);
    const list = () => screen.getByRole("tablist", { name: "The encounter · round 2" });
    // The first line set the mark, as a first visit counts nothing already there; three more arrived after it.
    expect(within(list()).getByRole("tab", { name: "Log, 3 new" })).toBeTruthy();
    // The count survives a reload on the same device.
    first.unmount();
    const second = view();
    expect(within(list()).getByRole("tab", { name: "Log, 3 new" })).toBeTruthy();
    await user.click(within(list()).getByRole("tab", { name: "Log, 3 new" }));
    expect(within(list()).getByRole("tab", { name: "Log" })).toBeTruthy();
    await user.click(within(list()).getByRole("tab", { name: /^Encounter/ }));
    line(9005);
    expect(within(list()).getByRole("tab", { name: "Log, 1 new" })).toBeTruthy();
    // Party carries no count.
    expect(within(list()).getByRole("tab", { name: "Party" })).toBeTruthy();
    second.unmount();
  });

  it("on a phone: the Switch, Map first, then Encounter with the acting creature and the order, Log and Party", () => {
    render(
      <ToastProvider>
        <PhoneSwitch.Provider value={{ map: <p>The map</p>, ladder: <p>The cards</p> }}>
          <EncounterPanel role="gm" state={gmView(true)} selectedMap={null} phone slots={slots} />
        </PhoneSwitch.Provider>
      </ToastProvider>
    );
    const list = screen.getByRole("tablist", { name: "The encounter · round 2" });
    expect(tabNames(list)).toEqual(["Map", fightTab, "Log", "Party"]);
    expect(screen.getByText("The cards")).toBeTruthy();
    // A fight opens on the Encounter view; the map stays mounted behind it.
    const fight = screen.getByRole("tabpanel", { name: /^Encounter/ });
    expect(within(fight).getByText("Needs you · 2")).toBeTruthy();
    expect(within(fight).getByRole("region", { name: "Now acting · Lyra" })).toBeTruthy();
    expect(within(fight).getByText("Turn order and tools")).toBeTruthy();
    expect(screen.getByText("The map")).toBeTruthy();
  });

  it("on a phone before a fight: the Switch opens on the map", () => {
    render(
      <ToastProvider>
        <PhoneSwitch.Provider value={{ map: <p>The map</p>, ladder: null }}>
          <EncounterPanel
            role="gm"
            state={{ ...gmView(false), combat: { ...gmView(false).combat, mapAssetId: "map-1" } } as GmView}
            selectedMap={null}
            phone
            slots={slots}
          />
        </PhoneSwitch.Provider>
      </ToastProvider>
    );
    expect(screen.getByRole("tab", { name: "Map", selected: true })).toBeTruthy();
    expect(within(screen.getByRole("tabpanel", { name: "Map" })).getByText("The map")).toBeTruthy();
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

  it("on their turn: the cost tabs on the turn card, opening on Action, and End turn alone under the thumb", () => {
    render(
      <ToastProvider>
        <EncounterPanel role="player" state={playerView(true)} phone slots={slots} />
      </ToastProvider>
    );
    expect(document.querySelectorAll(".chrome")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Your turn" }).classList.contains("chrome")).toBe(true);
    const tabs = screen.getByRole("group", { name: "Your turn resources" });
    expect(
      within(tabs)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")?.split(",")[0])
    ).toEqual(["Action", "Bonus Action", "Reaction", "Move"]);
    expect(
      within(tabs)
        .getByRole("button", { name: /^Action/ })
        .getAttribute("aria-pressed")
    ).toBe("true");
    const foot = screen.getByRole("button", { name: "End turn" }).closest(".table-panel-foot")!;
    expect(
      within(foot as HTMLElement)
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["End turn"]);
  });

  it("while someone else acts: who acts and when this player is next, the Reaction chosen, and no End turn", () => {
    render(
      <ToastProvider>
        <EncounterPanel role="player" state={playerView(true, false)} slots={slots} />
      </ToastProvider>
    );
    expect(screen.getByText("Goblin 1 is acting")).toBeTruthy();
    // Two in the order: after the goblin, the round wraps to Lyra.
    expect(screen.getByText("Your turn is next")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "End turn" })).toBeNull();
    // The foot says when the turn comes, with no button.
    expect(document.querySelector(".table-panel-foot-wait")?.textContent).toBe("Your turn is next.");
    // Action and Bonus Action wait, and the Reaction tab is chosen.
    expect(screen.getByRole("button", { name: "Action, not now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bonus Action, not now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reaction, ready" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Mark used" })).toBeEnabled();
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

describe("the laptop dock (table spec 2.1)", () => {
  it("heads the order with the round and drops the line about the table once a fight runs", () => {
    const { rerender } = render(<TableDock role="gm" state={gmView(false)} token="gm" />);
    const dock = screen.getByRole("complementary", { name: "Turn order and tools" });
    expect(dock.querySelector(".table-dock-status")).not.toBeNull();
    rerender(<TableDock role="gm" state={gmView(true)} token="gm" />);
    expect(dock.querySelector(".table-dock-status")).toBeNull();
    expect(dock.querySelector(".table-dock-counter")).not.toBeNull();
  });
});

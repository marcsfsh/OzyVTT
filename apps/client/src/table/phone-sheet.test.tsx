import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadActorFixture } from "@vtt/test-fixtures";
import { ActorDefinitionSchema } from "@vtt/schemas";
import type { PlayerActor, PlayerView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

// `command()` and `read()` send through `socket.timeout(ms).emit` with an error-first ack; routed to `socket.emit`.
vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

import { socket } from "../socket";
import { EncounterPanel } from "../encounter/EncounterPanel";
import { clearTargeting } from "../encounter/targeting";

// A phone's panel under the map is short. The player's sheet tells the table it is shown, so the divider gives it the
// height, and an attack tapped on it is aimed on the Turn tab, where the target picker has room beside a bigger map.

const HERO = "10000000-0000-4000-8000-000000000001";
const WOLF = "10000000-0000-4000-8000-000000000002";
const MACE = {
  id: "mace",
  name: "Mace",
  activation: "action",
  description: "Melee Attack Roll: +5, reach 5 ft.",
  attack: { bonus: 5, reachFeet: 5 },
  damage: [{ formula: "1d6 + 3", type: "bludgeoning" }]
};
const MACE_ROW = {
  id: "mace",
  name: "Mace",
  activation: "action",
  available: true,
  violations: [],
  usesRemaining: null,
  description: MACE.description,
  attackBonus: 5,
  damage: [{ formula: "1d6 + 3", type: "bludgeoning" }],
  usesLimit: null,
  usesPer: null,
  usesPool: null,
  targeting: "single"
};

const emit = socket.emit as unknown as ReturnType<typeof vi.fn>;
const fixture = ActorDefinitionSchema.parse(loadActorFixture("player-character"));
const hero = {
  id: HERO,
  name: "Mira",
  kind: "player-character",
  visibility: "public",
  claimStatus: "mine",
  hp: { kind: "exact", current: 30, maximum: 30, temporary: 0 },
  conditions: [],
  effects: [],
  inventory: [],
  currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  definitionId: "srd:player-character",
  definition: ActorDefinitionSchema.parse({ ...fixture, actions: [MACE] })
} as unknown as PlayerActor;
const wolf = {
  id: WOLF,
  name: "Wolf",
  kind: "monster",
  visibility: "public",
  claimStatus: "available",
  hp: { kind: "band", band: "healthy" },
  conditions: [],
  effects: []
};
const state = {
  revision: 3,
  actors: [hero, wolf],
  rolls: [],
  rollCalls: [],
  combat: {
    active: true,
    round: 1,
    turnActorId: HERO,
    mapAssetId: null,
    initiative: [
      { actorId: HERO, name: "Mira", score: 15, active: true },
      { actorId: WOLF, name: "Wolf", score: 10, active: false }
    ],
    turn: { actionUsed: false, bonusActionUsed: false, turnUses: {}, movementUsedFeet: 0 },
    tokens: [],
    annotations: [],
    reactionsUsed: [],
    playerDamageMode: "proposal",
    pendingSaves: [],
    pendingReactions: [],
    pendingInitiative: [],
    pendingRuleAsks: [],
    ruleExceptions: {},
    rulesMode: "strict"
  }
} as unknown as PlayerView;

const ATTACK_SETTING = "Where attacks tapped on the sheet resolve";

beforeEach(() => {
  vi.clearAllMocks();
  clearTargeting();
  emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
    if (event === "actor:available-actions") ack?.({ ok: true, rulesMode: "strict", actions: [MACE_ROW] });
    else ack?.({ ok: false });
  });
});
afterEach(() => {
  clearTargeting();
  localStorage.clear();
});

describe("the player's sheet in the table's panel", () => {
  it("tells the table while it is shown, so a phone's divider can give it the height", async () => {
    const user = userEvent.setup();
    const shown = vi.fn();
    render(<EncounterPanel role="player" state={state} phone onSheetShown={shown} />, { wrapper: ToastProvider });
    expect(shown).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole("tab", { name: "Sheet" }));
    expect(shown).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole("tab", { name: "Order" }));
    expect(shown).toHaveBeenLastCalledWith(false);
  });

  it("on a phone, aims an attack tapped on the sheet on the Turn tab, and offers no choice of where", async () => {
    const user = userEvent.setup();
    localStorage.setItem("vtt.table-tab.player.phone", "sheet");
    render(<EncounterPanel role="player" state={state} phone />, { wrapper: ToastProvider });
    const sheet = screen.getByRole("tabpanel", { name: "Sheet" });
    expect(within(sheet).queryByRole("group", { name: ATTACK_SETTING })).toBeNull();
    await user.click(await within(sheet).findByRole("button", { name: "+5 to hit" }));
    expect(screen.getByRole("tab", { name: "Turn", selected: true })).toBeTruthy();
    const picker = await within(screen.getByRole("tabpanel", { name: "Turn" })).findByRole("group", {
      name: "Targets for Mace"
    });
    expect(within(picker).getByText("Wolf")).toBeTruthy();
  });

  it("on a laptop, keeps the player's choice of where an attack tapped on the sheet resolves", async () => {
    localStorage.setItem("vtt.table-tab.player.laptop", "sheet");
    render(<EncounterPanel role="player" state={state} />, { wrapper: ToastProvider });
    const sheet = screen.getByRole("tabpanel", { name: "Sheet" });
    expect(await within(sheet).findByRole("group", { name: ATTACK_SETTING })).toBeTruthy();
  });
});

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

// A creature a player's character commands (a familiar, a summoned spirit): its turn is the player's to run, and the
// player's sheet lists it with the orders the character can give it.

const HERO = "10000000-0000-4000-8000-000000000001";
const OWL = "10000000-0000-4000-8000-000000000003";
const WOLF = "10000000-0000-4000-8000-000000000002";

const TALONS_ROW = {
  id: "talons",
  name: "Talons",
  activation: "action",
  available: true,
  violations: [],
  usesRemaining: null,
  description: "Melee Attack Roll: +3, reach 5 ft.",
  attackBonus: 3,
  damage: [{ formula: "1", type: "slashing" }],
  usesLimit: null,
  usesPer: null,
  usesPool: null,
  targeting: "single"
};

const emit = socket.emit as unknown as ReturnType<typeof vi.fn>;
const fixture = ActorDefinitionSchema.parse(loadActorFixture("player-character"));
const monster = ActorDefinitionSchema.parse(loadActorFixture("monster"));
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
  definition: ActorDefinitionSchema.parse({ ...fixture, actions: [] })
} as unknown as PlayerActor;
const owl = {
  id: OWL,
  name: "Owl",
  kind: "monster",
  visibility: "public",
  claimStatus: "available",
  commanded: true,
  orders: { look: true, dismiss: "action" },
  hp: { kind: "exact", current: 1, maximum: 1, temporary: 0 },
  conditions: [],
  effects: [],
  actionUses: {},
  definitionId: "summon-owl",
  definition: { ...monster, name: "Owl" }
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

function fight(turnActorId: string): PlayerView {
  return {
    revision: 3,
    builderPolicy: { playerBuilder: "open", maxLevel: 20 },
    actors: [hero, owl, wolf],
    rolls: [],
    rollCalls: [],
    combat: {
      active: true,
      round: 1,
      turnActorId,
      mapAssetId: null,
      initiative: [
        { actorId: OWL, name: "Owl", score: 18, active: turnActorId === OWL },
        { actorId: HERO, name: "Mira", score: 15, active: turnActorId === HERO },
        { actorId: WOLF, name: "Wolf", score: 10, active: turnActorId === WOLF }
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
}

const sent = (event: string) => emit.mock.calls.filter((call) => call[0] === event).map((call) => call[1]);

beforeEach(() => {
  vi.clearAllMocks();
  clearTargeting();
  emit.mockImplementation((event: string, payload: { actorId?: string }, ack?: (result: unknown) => void) => {
    if (event === "actor:available-actions")
      ack?.({ ok: true, rulesMode: "strict", actions: payload.actorId === OWL ? [TALONS_ROW] : [] });
    else if (event === "actor:movement") ack?.({ ok: true, counted: true, speedFeet: 10, usedFeet: 0 });
    else ack?.({ ok: true });
  });
});
afterEach(() => {
  clearTargeting();
  localStorage.clear();
});

describe("a creature the player's character commands", () => {
  it("on its turn, the turn card is the creature's, with its own actions and End turn", async () => {
    render(<EncounterPanel role="player" state={fight(OWL)} phone />, { wrapper: ToastProvider });
    const turn = within(screen.getByRole("tabpanel", { name: "Turn" }));
    expect(turn.getByRole("heading", { name: "Owl's turn" })).toBeTruthy();
    expect(turn.getByText("Mira commands it: you act for it.")).toBeTruthy();
    expect(await turn.findByRole("button", { name: /Talons/ })).toBeTruthy();
    expect(sent("actor:available-actions")).toContainEqual(expect.objectContaining({ actorId: OWL }));
    expect(screen.getByRole("button", { name: "End turn" })).toBeTruthy();
  });

  it("is listed on the player's sheet with the orders the character can give it", async () => {
    const user = userEvent.setup();
    localStorage.setItem("vtt.table-tab.player.phone", "sheet");
    render(<EncounterPanel role="player" state={fight(HERO)} phone />, { wrapper: ToastProvider });
    const sheet = within(screen.getByRole("tabpanel", { name: "Sheet" }));
    const orders = sheet.getByRole("group", { name: "Orders for Owl" });
    expect(within(orders).queryByRole("button", { name: "Command" })).toBeNull();
    await user.click(within(orders).getByRole("button", { name: "See through its eyes" }));
    expect(sent("summon:look")).toEqual([expect.objectContaining({ actorId: OWL })]);
    await user.click(within(orders).getByRole("button", { name: "Send away" }));
    expect(sent("summon:dismiss")).toEqual([expect.objectContaining({ actorId: OWL, temporary: true })]);
    expect(sheet.getByText("1/1 HP")).toBeTruthy();
  });
});

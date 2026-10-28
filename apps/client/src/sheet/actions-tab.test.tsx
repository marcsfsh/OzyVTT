import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadActorFixture } from "@vtt/test-fixtures";
import { ActorDefinitionSchema } from "@vtt/schemas";
import type { PlayerActor, PlayerView } from "@vtt/domain";

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
import { ToastProvider } from "@vtt/ui";
import { followTable } from "../dice/roll-preference";
import { clearTargeting, useTargeting } from "../encounter/targeting";
import { CharacterSheet } from "./CharacterSheet";

// The sheet's Actions tab (ADR-0044): everything the character can do under subtabs by its cost, the six saving
// throws, and a tap that resolves in the encounter, or asks the GM to aim it where the GM picks targets.

const HERO = "10000000-0000-4000-8000-000000000001";
const WOLF = "10000000-0000-4000-8000-000000000002";
const ASK = "50000000-0000-4000-8000-000000000001";

const MACE = {
  id: "mace",
  name: "Mace",
  activation: "action",
  description: "Melee Attack Roll: +5, reach 5 ft.",
  attack: { bonus: 5, reachFeet: 5 },
  damage: [{ formula: "1d6 + 3", type: "bludgeoning" }]
};
const SURGE = {
  id: "surge",
  name: "Battle Surge",
  activation: "bonus-action",
  description: "Regain 1d10 + 1 Hit Points.",
  damage: [],
  healing: { formula: "1d10 + 1", self: true },
  uses: { limit: 1, per: "short-rest" }
};

const emit = socket.emit as unknown as ReturnType<typeof vi.fn>;
const fixture = ActorDefinitionSchema.parse(loadActorFixture("player-character"));
const hero = {
  id: HERO,
  name: "Mira",
  kind: "player-character",
  visibility: "public",
  hp: { current: 30, maximum: 30, temporary: 0 },
  conditions: [],
  effects: [],
  inventory: [],
  currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  definitionId: "srd:player-character",
  definition: ActorDefinitionSchema.parse({ ...fixture, actions: [MACE, SURGE], spellcasting: undefined })
} as unknown as PlayerActor;
const wolf = { ...hero, id: WOLF, name: "Wolf", kind: "monster", definitionId: undefined, definition: undefined };

const view = (combat: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({
    revision: 3,
    actors: [hero, wolf],
    rolls: [],
    rollCalls: [],
    playerDice: { d20: "app", damage: "app" },
    targeting: "player",
    ...extra,
    combat: {
      active: false,
      round: 0,
      turnActorId: null,
      initiative: [],
      playerDamageMode: "proposal",
      pendingSaves: [],
      ruleExceptions: {},
      rulesMode: "strict",
      ...combat
    }
  }) as unknown as PlayerView;

const inEncounter = (extra: Record<string, unknown> = {}, combat: Record<string, unknown> = {}) =>
  view(
    {
      active: true,
      round: 1,
      turnActorId: HERO,
      initiative: [
        { actorId: HERO, name: "Mira", score: 15 },
        { actorId: WOLF, name: "Wolf", score: 10 }
      ],
      ...combat
    },
    extra
  );

const mount = (state: PlayerView) => {
  followTable(state);
  return render(<CharacterSheet actor={hero} role="player" state={state} presentation="page" onClose={() => {}} />, {
    wrapper: ToastProvider
  });
};
const sent = (event: string) => emit.mock.calls.filter(([name]) => name === event).map(([, payload]) => payload);

/** Shows who the shared targeting is aiming for, so a test can see an aim begin. */
function AimProbe() {
  const aim = useTargeting();
  return <output aria-label="Aiming">{aim ? aim.action.id : "none"}</output>;
}

describe("the sheet's Actions tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTargeting();
    try {
      localStorage.clear();
    } catch {
      /* no storage */
    }
    emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
      if (event === "actor:available-actions") ack?.({ ok: true, rulesMode: "strict", actions: [] });
      else ack?.({ ok: true, route: "loose", rollIds: [] });
    });
  });

  it("lists each use under the subtab of its cost, and an attack under Attack too", async () => {
    const user = userEvent.setup();
    mount(view({}));
    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    const subtabs = within(screen.getByRole("tablist", { name: "Actions" }));
    expect(subtabs.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "All",
      "Attack",
      "Action",
      "Bonus Action",
      "Reaction",
      "Other",
      "Saving throws"
    ]);
    expect(await screen.findByRole("button", { name: /Mace/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Battle Surge/ })).toBeTruthy();

    await user.click(subtabs.getByRole("tab", { name: "Attack" }));
    expect(screen.getByRole("button", { name: /Mace/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Battle Surge/ })).toBeNull();

    await user.click(subtabs.getByRole("tab", { name: "Bonus Action" }));
    expect(screen.queryByRole("button", { name: /Mace/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Battle Surge/ })).toBeTruthy();

    await user.click(subtabs.getByRole("tab", { name: "Reaction" }));
    expect(screen.getByText("No Reactions.")).toBeTruthy();
  });

  it("rolls an attack with its damage outside an encounter, as the Gear tab does", async () => {
    const user = userEvent.setup();
    mount(view({}));
    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    await user.click(await screen.findByRole("button", { name: /Mace/ }));
    expect(sent("action:use")).toEqual([
      expect.objectContaining({ actorId: HERO, actionId: "mace", includeDamage: true })
    ]);
  });

  it("puts a save the character owes in its ability's row, and rolls the others freely", async () => {
    const user = userEvent.setup();
    const owed = {
      id: "60000000-0000-4000-8000-000000000001",
      targetActorId: HERO,
      targetName: "Mira",
      sourceName: "Wolf",
      actionName: "Howl",
      ability: "wis",
      dc: 13,
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: [],
      createdAt: 0
    };
    mount(view({ pendingSaves: [owed] }));
    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    await user.click(screen.getByRole("tab", { name: "Saving throws" }));
    expect(screen.getByText("A save waits for Mira. Answer it below.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Roll a Wisdom saving throw/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /saving throw, / })).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: /Roll a Dexterity saving throw/ }));
    expect(emit.mock.calls.some(([name]) => name === "save:roll")).toBe(true);
  });

  it("opens on Actions in an encounter, where a tap aims on the map", async () => {
    const user = userEvent.setup();
    mount(inEncounter());
    render(<AimProbe />);
    expect((await screen.findByRole("tab", { name: "Actions" })).getAttribute("aria-selected")).toBe("true");
    await user.click(await screen.findByRole("button", { name: /Mace/ }));
    expect(screen.getByRole("status", { name: "Aiming" }).textContent).toBe("mace");
    expect(sent("action:ask-target")).toEqual([]);
  });

  it("asks the GM to aim where the GM picks targets, and takes the ask back", async () => {
    const user = userEvent.setup();
    mount(inEncounter({ targeting: "gm" }));
    render(<AimProbe />);
    await user.click(await screen.findByRole("button", { name: /Mace/ }));
    expect(sent("action:ask-target")).toEqual([expect.objectContaining({ actorId: HERO, actionId: "mace" })]);
    expect(screen.getByRole("status", { name: "Aiming" }).textContent).toBe("none");
  });

  it("shows the action waiting for the GM, with Take back", async () => {
    const user = userEvent.setup();
    mount(
      inEncounter(
        { targeting: "gm" },
        { targetAsks: [{ id: ASK, actorId: HERO, actionId: "mace", actionName: "Mace" }] }
      )
    );
    expect(await screen.findByText(/is waiting for the GM to choose its target/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Take back" }));
    expect(sent("action:withdraw-target-ask")).toEqual([expect.objectContaining({ askId: ASK })]);
  });
});

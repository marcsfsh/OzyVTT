import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadActorFixture } from "@vtt/test-fixtures";
import { ActorDefinitionSchema } from "@vtt/schemas";
import type { GmActor, GmView } from "@vtt/domain";

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
import { CharacterSheet } from "./CharacterSheet";
import { HealTargetPicker } from "../encounter/HealTargetPicker";

// Outside a fight a heal asks who regains the hit points (a player: their own character or another member of the
// party; the GM: anyone), and the server moves them. A heal that only heals its user asks nothing.

const HERO = "10000000-0000-4000-8000-000000000001";
const FRIEND = "10000000-0000-4000-8000-000000000002";
const WOLF = "10000000-0000-4000-8000-000000000003";

const SECOND_WIND = {
  id: "second-wind",
  name: "Second Wind",
  activation: "bonus-action",
  description: "Regain 1d10 + 5 Hit Points.",
  damage: [],
  healing: { formula: "1d10 + 5", self: true },
  uses: { limit: 2, per: "long-rest" }
};
const LAY_ON_HANDS = {
  id: "lay-on-hands",
  name: "Lay on Hands",
  activation: "bonus-action",
  description: "Restore Hit Points from the pool.",
  damage: [],
  healing: { formula: "1", perUse: true },
  uses: { limit: 25, per: "long-rest", pool: "lay-on-hands" },
  useCost: "chosen"
};
const POTION_ROW = {
  id: "item-potion-of-healing-drink",
  name: "Drink Potion of Healing",
  activation: "bonus-action",
  available: true,
  usesRemaining: null,
  description: "You regain 2d4 + 2 Hit Points.",
  attackBonus: null,
  damage: [],
  usesLimit: null,
  usesPer: null,
  usesPool: null,
  healing: { formula: "2d4 + 2" },
  targeting: "single"
};

/** The server's rows for the character's own uses, which the Features tab counts. */
const OWN_ROWS = [
  { ...SECOND_WIND, available: true, usesRemaining: 2, usesLimit: 2, usesPer: "long-rest", usesPool: null },
  { ...LAY_ON_HANDS, available: true, usesRemaining: 5, usesLimit: 25, usesPer: "long-rest", usesPool: "lay-on-hands" }
];

const emit = socket.emit as unknown as ReturnType<typeof vi.fn>;
function serve() {
  emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
    if (event === "actor:available-actions")
      ack?.({ ok: true, rulesMode: "assisted", actions: [...OWN_ROWS, POTION_ROW] });
    else ack?.({ ok: true });
  });
}
const sent = (event: string) =>
  emit.mock.calls
    .filter((call) => call[0] === event)
    .map((call) => {
      const { commandId: _commandId, ...payload } = call[1] as Record<string, unknown>;
      return payload;
    });

const fixture = ActorDefinitionSchema.parse(loadActorFixture("player-character"));
const creature = (id: string, name: string, kind: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    name,
    kind,
    visibility: "public",
    hp: { current: 5, maximum: 40, temporary: 0 },
    conditions: [],
    effects: [],
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    ...extra
  }) as unknown as GmActor;
const hero = creature(HERO, "Aria", "player-character", {
  definitionId: "srd:player-character",
  inventory: [{ id: "potion-of-healing", name: "Potion of Healing", quantity: 2, equipped: false, attuned: false }],
  actionUses: { "lay-on-hands": 20 },
  definition: ActorDefinitionSchema.parse({
    ...fixture,
    spellcasting: undefined,
    actions: [SECOND_WIND, LAY_ON_HANDS]
  })
});
const state = {
  revision: 2,
  actors: [hero, creature(FRIEND, "Bryn", "player-character"), creature(WOLF, "Wolf", "monster")],
  combat: { active: false, initiative: [], pendingSaves: [], ruleExceptions: {}, rulesMode: "strict" },
  rolls: []
} as unknown as GmView;

type User = ReturnType<typeof userEvent.setup>;
/** A feature's Use, on the Features tab, once the server's action list has come back. */
async function useFeature(user: User, name: string) {
  await user.click(await screen.findByRole("tab", { name: "Features" }));
  await user.click(await screen.findByRole("button", { name: `Use ${name}` }));
}
/** A potion's own action: the primary of its detail on the Gear tab. */
async function drinkPotion(user: User) {
  await user.click(await screen.findByRole("tab", { name: "Gear" }));
  await user.click(screen.getByText("Potion of Healing"));
  await user.click(await screen.findByRole("button", { name: "Drink Potion of Healing" }));
}

afterEach(() => localStorage.clear());

const mount = (role: "gm" | "player") =>
  render(<CharacterSheet actor={hero} role={role} state={state} presentation="page" onClose={() => {}} />, {
    wrapper: ToastProvider
  });

describe("healing outside an encounter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serve();
  });

  it("asks a player which member of the party a potion heals, then sends them", async () => {
    const user = userEvent.setup();
    mount("player");
    await drinkPotion(user);
    const picker = screen.getByRole("group", { name: "Who regains hit points" });
    expect(
      within(picker)
        .getAllByRole("button")
        .map((chip) => chip.textContent)
    ).toEqual(["Aria", "Bryn"]);
    expect(within(picker).getByRole("button", { name: "Aria" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(picker).getByRole("button", { name: "Bryn" }));
    expect(within(picker).getByRole("button", { name: "Aria" }).getAttribute("aria-pressed")).toBe("false");
    await user.click(
      within(screen.getByRole("dialog", { name: "Who Drink Potion of Healing heals" })).getByRole("button", {
        name: "Heal"
      })
    );
    await waitFor(() =>
      expect(sent("action:use")).toEqual([
        { actorId: HERO, actionId: "item-potion-of-healing-drink", targetIds: [FRIEND] }
      ])
    );
  });

  it("says who regained what once the server has healed them", async () => {
    emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
      if (event === "actor:available-actions") ack?.({ ok: true, rulesMode: "assisted", actions: [POTION_ROW] });
      else if (event === "action:use")
        ack?.({
          ok: true,
          route: "loose",
          healing: { total: 7, targets: [{ targetId: FRIEND, targetName: "Bryn", regained: 7 }] }
        });
      else ack?.({ ok: true });
    });
    const user = userEvent.setup();
    mount("player");
    await drinkPotion(user);
    await user.click(
      within(screen.getByRole("group", { name: "Who regains hit points" })).getByRole("button", { name: "Bryn" })
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "Who Drink Potion of Healing heals" })).getByRole("button", {
        name: "Heal"
      })
    );
    expect(await screen.findByText("Bryn regains 7 hit points.")).toBeTruthy();
  });

  it("lets the GM heal anyone on the roster", async () => {
    const user = userEvent.setup();
    mount("gm");
    await drinkPotion(user);
    const picker = screen.getByRole("group", { name: "Who regains hit points" });
    expect(within(picker).getByRole("button", { name: "Wolf" })).toBeTruthy();
  });

  it("uses Second Wind at once, and asks Lay on Hands for the points to spend", async () => {
    const user = userEvent.setup();
    mount("player");
    await useFeature(user, "Second Wind");
    expect(screen.queryByRole("group", { name: "Who regains hit points" })).toBeNull();
    await waitFor(() => expect(sent("action:use")).toEqual([{ actorId: HERO, actionId: "second-wind" }]));

    await user.click(await screen.findByRole("button", { name: "Use Lay on Hands" }));
    const dialog = within(screen.getByRole("dialog", { name: "Who Lay on Hands heals" }));
    await user.click(dialog.getByRole("button", { name: "Bryn" }));
    const more = dialog.getByRole("button", { name: "Increase" });
    await user.click(more);
    await user.click(more);
    await user.click(dialog.getByRole("button", { name: "Heal" }));
    await waitFor(() =>
      expect(sent("action:use").at(-1)).toEqual({
        actorId: HERO,
        actionId: "lay-on-hands",
        targetIds: [FRIEND],
        spend: 3
      })
    );
  });
});

describe("the heal picker", () => {
  it("picks no more creatures than one use heals", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn();
    render(
      <HealTargetPicker
        heal={{ actionId: "spell-prayer-of-healing", name: "Prayer of Healing", most: 2, spendUpTo: null }}
        candidates={[
          { id: HERO, name: "Aria" },
          { id: FRIEND, name: "Bryn" },
          { id: WOLF, name: "Cato" }
        ]}
        defaultId={HERO}
        onConfirm={confirm}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("Choose up to 2 creatures to regain hit points.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Bryn" }));
    expect((screen.getByRole("button", { name: "Cato" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Heal" }));
    expect(confirm).toHaveBeenCalledWith([HERO, FRIEND], null);
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameStateSchema, type GmActor, type GmView } from "@vtt/domain";

// `command()` and `read()` send through `socket.timeout(ms).emit` with an error-first ack; it is routed to
// `socket.emit` here so the assertions read one call list.
vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

import { socket } from "../socket";
import { TokenContextMenu } from "../scene/TokenContextMenu";
import { EncounterPanel } from "./EncounterPanel";
import { SheetHpControls } from "./SheetVitals";
import { ApplyDamageSchema } from "../../../server/src/game-commands";

/**
 * Each hand-entry damage door (token menu, tracker popover, sheet HP box) sends the picked damage
 * type through the shared payload builder. The hit-point outcome is tested in
 * `damage-type.mirror.test.ts`.
 */

const ACTOR = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Aria",
  kind: "player-character",
  visibility: "public",
  hp: { current: 40, maximum: 40, temporary: 0 },
  conditions: [],
  effects: []
} as unknown as GmActor;

type EmitCall = [event: string, payload: Record<string, unknown>, ack: (result: unknown) => void];
const emitted = () => (socket.emit as unknown as { mock: { calls: EmitCall[] } }).mock.calls;
const lastHpCall = () =>
  emitted()
    .filter(([event]) => event.startsWith("actor:apply-damage") || event === "actor:heal")
    .at(-1)!;

const mount = () =>
  render(
    <TokenContextMenu
      actor={ACTOR}
      role="gm"
      gmToken="gm-token"
      x={20}
      y={20}
      reactionUsed={false}
      placed
      onOpenSheet={() => {}}
      onReturnToTray={() => {}}
      onClose={() => {}}
    />
  );

/** Pick a row out of the chooser's listbox by its visible label. */
async function chooseType(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole("combobox", { name: "Damage type" }));
  await user.click(
    within(await screen.findByRole("listbox", { name: "Damage type" })).getByRole("option", { name: label })
  );
}

describe("the manual damage entry's type chooser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers all thirteen SRD types and reads as Untyped until one is picked", async () => {
    const user = userEvent.setup();
    mount();
    const box = screen.getByRole("combobox", { name: "Damage type" }) as HTMLInputElement;
    // Empty is untyped; the placeholder says so.
    expect(box.value).toBe("");
    expect(box.placeholder).toBe("Untyped");
    await user.click(box);
    // Scoped to this listbox: the menu's Size and Health `<select>`s have native options of their own.
    const list = screen.getByRole("listbox", { name: "Damage type" });
    // The whole vocabulary, not the chooser's default page of eight.
    expect(within(list).getAllByRole("option")).toHaveLength(13);
    expect(within(list).getByRole("option", { name: "Bludgeoning" })).toBeTruthy();
  });

  it("sends the picked type with the number the GM typed", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Amount"), "10");
    await chooseType(user, "Fire");
    await user.click(screen.getByRole("button", { name: "Dmg" }));
    const [event, payload] = lastHpCall();
    expect(event).toBe("actor:apply-damage");
    expect(payload).toMatchObject({ actorId: ACTOR.id, amount: 10, damageType: "fire" });
  });

  it("sends no type at all while the chooser is untouched", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Amount"), "10");
    await user.click(screen.getByRole("button", { name: "Dmg" }));
    // An untouched chooser must not add `damageType` to the payload.
    expect("damageType" in lastHpCall()[1]).toBe(false);
  });

  it("keeps the type off Heal, which shares the row and has none", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Amount"), "10");
    await chooseType(user, "Fire");
    await user.click(screen.getByRole("button", { name: "Heal" }));
    const [event, payload] = lastHpCall();
    expect(event).toBe("actor:heal");
    expect("damageType" in payload).toBe(false);
  });

  it("takes a homebrew type nobody put on the list", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Amount"), "10");
    // Typed, not picked, then left by moving to the next control: `Combobox` commits on blur.
    await user.type(screen.getByRole("combobox", { name: "Damage type" }), "Primordial Ooze");
    await user.click(screen.getByRole("button", { name: "Dmg" }));
    expect(lastHpCall()[1]).toMatchObject({ amount: 10, damageType: "primordial-ooze" });
  });
});

/**
 * The sheet's HP box, which players can reach too (only `Set` is GM-gated). Mounted alone rather
 * than through `CharacterSheet`, which needs a definition fetch and a skill catalog.
 */
describe("the sheet's HP box carries the type too", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** `said` collects the confirmation line. */
  const said: string[] = [];
  const mountSheetHp = () => {
    said.length = 0;
    return render(<SheetHpControls actorId={ACTOR.id} allowSet onFeedback={(text) => said.push(text)} />);
  };

  it("sends the picked type with the number typed on the sheet", async () => {
    const user = userEvent.setup();
    mountSheetHp();
    await user.type(screen.getByLabelText("Amount"), "10");
    await chooseType(user, "Fire");
    await user.click(screen.getByRole("button", { name: "Dmg" }));
    const [event, payload] = lastHpCall();
    expect(event).toBe("actor:apply-damage");
    expect(payload).toMatchObject({ actorId: ACTOR.id, amount: 10, damageType: "fire" });
    // The payload must pass the server's `.strict()` schema.
    expect(ApplyDamageSchema.parse(payload).damageType).toBe("fire");
  });

  it("sends no type at all while the sheet's chooser is untouched", async () => {
    const user = userEvent.setup();
    mountSheetHp();
    await user.type(screen.getByLabelText("Amount"), "10");
    await user.click(screen.getByRole("button", { name: "Dmg" }));
    expect("damageType" in lastHpCall()[1]).toBe(false);
  });

  it("keeps the type off Heal, which shares the sheet's row and has none", async () => {
    const user = userEvent.setup();
    mountSheetHp();
    await user.type(screen.getByLabelText("Amount"), "10");
    await chooseType(user, "Fire");
    await user.click(screen.getByRole("button", { name: "Heal" }));
    const [event, payload] = lastHpCall();
    expect(event).toBe("actor:heal");
    expect("damageType" in payload).toBe(false);
  });

  it("names the type back to whoever tapped, so the confirmation is not a bare number", async () => {
    const user = userEvent.setup();
    mountSheetHp();
    await user.type(screen.getByLabelText("Amount"), "10");
    await chooseType(user, "Cold");
    await user.click(screen.getByRole("button", { name: "Dmg" }));
    // Drive the ack: the feedback line is written from inside it, once the reply settles.
    lastHpCall()[2]({ ok: true });
    await waitFor(() => expect(said.at(-1)).toBe("Damaged 10 cold."));
  });
});

/**
 * The turn-order row's tools popover, through the real `EncounterPanel`: `hpDamageType` is panel
 * state kept when a row closes (one fireball, several tokens), so the fixture has two combatants.
 */
const SECOND_ID = "10000000-0000-4000-8000-000000000002";
const GM_STATE = ((): GmView => {
  // Parsed through the real schema so unrelated fields get their defaults and cannot drift.
  const actor = (id: string, name: string) => ({
    id,
    name,
    kind: "player-character",
    visibility: "public",
    hp: { current: 40, maximum: 40 }
  });
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    revision: 12,
    actors: [actor(ACTOR.id, ACTOR.name), actor(SECOND_ID, "Borin")],
    combat: {
      active: true,
      round: 1,
      turnActorId: ACTOR.id,
      initiative: [
        { actorId: ACTOR.id, score: 17 },
        { actorId: SECOND_ID, score: 11 }
      ],
      tokens: [
        { actorId: ACTOR.id, position: { x: 0, y: 0 }, sizePx: 50 },
        { actorId: SECOND_ID, position: { x: 60, y: 0 }, sizePx: 50 }
      ]
    }
  });
  return state as unknown as GmView;
})();

describe("the turn-order row's tools popover carries the type too", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Opens a combatant's tools card, where the HP editor and its chooser live. */
  const openRowTools = async (user: ReturnType<typeof userEvent.setup>, name = "Aria") => {
    // By `title`: the row button's accessible name includes the avatar and HP readout.
    await user.click(screen.getByTitle(new RegExp(`^Manage ${name}`)));
    return within(screen.getByRole("dialog", { name: `Tools for ${name}` }));
  };
  const openPanel = async (user: ReturnType<typeof userEvent.setup>) => {
    render(<EncounterPanel role="gm" state={GM_STATE} selectedMap={null} />);
    return openRowTools(user);
  };

  it("sends the picked type with the number the GM typed into the row, and says so", async () => {
    const user = userEvent.setup();
    const tools = await openPanel(user);
    await user.type(tools.getByLabelText("Amount"), "10");
    await chooseType(user, "Fire");
    await user.click(tools.getByRole("button", { name: "Dmg" }));
    // Drive the ack: the panel writes its line from inside the promise.
    lastHpCall()[2]({ ok: true });
    // The confirmation is built from the same computed type as the payload, and is asserted first so a
    // wrong value fails here rather than at a payload guard.
    expect(await screen.findByText("Aria took 10 fire damage.")).toBeTruthy();
    const [event, payload] = lastHpCall();
    expect(event).toBe("actor:apply-damage");
    expect(payload).toMatchObject({ actorId: ACTOR.id, amount: 10, damageType: "fire" });
  });

  it("sends no type at all while the row's chooser is untouched", async () => {
    const user = userEvent.setup();
    const tools = await openPanel(user);
    await user.type(tools.getByLabelText("Amount"), "10");
    await user.click(tools.getByRole("button", { name: "Dmg" }));
    expect("damageType" in lastHpCall()[1]).toBe(false);
  });

  it("keeps the type off Heal, which shares the row and has none", async () => {
    const user = userEvent.setup();
    const tools = await openPanel(user);
    await user.type(tools.getByLabelText("Amount"), "10");
    await chooseType(user, "Fire");
    await user.click(tools.getByRole("button", { name: "Heal" }));
    const [event, payload] = lastHpCall();
    expect(event).toBe("actor:heal");
    expect("damageType" in payload).toBe(false);
  });

  it("keeps the type across a KO, which is damage with a different landing", async () => {
    // `KO` is the same command with `nonlethal`, so it gets its own check.
    const user = userEvent.setup();
    const tools = await openPanel(user);
    await user.type(tools.getByLabelText("Amount"), "10");
    await chooseType(user, "Thunder");
    await user.click(tools.getByRole("button", { name: "KO" }));
    expect(lastHpCall()[1]).toMatchObject({ amount: 10, damageType: "thunder", nonlethal: true });
  });

  it("keeps the chosen type when the row closes and the next one opens", async () => {
    // The type survives the accordion (unlike `hpAmount`): the number is retyped, the type is not.
    const user = userEvent.setup();
    const first = await openPanel(user);
    await user.type(first.getByLabelText("Amount"), "10");
    await chooseType(user, "Fire");
    await user.click(first.getByRole("button", { name: "Dmg" }));
    lastHpCall()[2]({ ok: true }); // the panel stays `busy` until the first command is answered
    await user.click(screen.getByTitle(/^Manage Borin/));
    const second = within(screen.getByRole("dialog", { name: "Tools for Borin" }));
    await user.type(second.getByLabelText("Amount"), "6");
    await user.click(second.getByRole("button", { name: "Dmg" }));
    lastHpCall()[2]({ ok: true });
    expect(await screen.findByText("Borin took 6 fire damage.")).toBeTruthy();
    expect(lastHpCall()[1]).toMatchObject({ actorId: SECOND_ID, amount: 6, damageType: "fire" });
  });
});

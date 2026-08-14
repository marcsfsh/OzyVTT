import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameStateSchema, type GmActor, type GmView } from "@vtt/domain";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true } }));

import { socket } from "../socket";
import { TokenContextMenu } from "../scene/TokenContextMenu";
import { EncounterPanel } from "./EncounterPanel";
import { SheetHpControls } from "./CharacterSheet";
import { ApplyDamageSchema } from "../../../server/src/game-commands";

/**
 * REGISTER D7's CLIENT HALF, at the surface: a hand-entry door now has a damage-type chooser, and
 * what the GM picks in it reaches the wire.
 *
 * The far end - that the emitted type comes off a DIFFERENT number of hit points and that the table
 * is told why - is `damage-type.mirror.test.ts`, which drives the same payload builder into the
 * server's own `applyDamageDetailed`. This file is the other half of that join: it proves a real
 * COMPONENT calls the builder, so the mirror test is testing the app and not a module the app merely
 * ships beside.
 *
 * **ALL THREE DOORS, because for a day only one of them was joined here.** The token menu was the
 * door this file opened with - one door, chosen because it was the only one already exported whole.
 * A hostile review on 2026-08-10 then measured what that cost: replacing the type computation with
 * `undefined` in the OTHER two doors left `npm run check` at exit 0 and the client suite
 * byte-identical at 65 files / 917 tests. Two thirds of the register was protected by a browser
 * transcript nothing could re-run. So the popover and the sheet get their own joins below, and the
 * probe that found the hole is the probe that keeps them honest.
 */

const ACTOR = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Aria", kind: "player-character", visibility: "public",
  hp: { current: 40, maximum: 40, temporary: 0 },
  conditions: [], effects: []
} as unknown as GmActor;

type EmitCall = [event: string, payload: Record<string, unknown>, ack: (result: unknown) => void];
const emitted = () => (socket.emit as unknown as { mock: { calls: EmitCall[] } }).mock.calls;
const lastHpCall = () => emitted().filter(([event]) => event.startsWith("actor:apply-damage") || event === "actor:heal").at(-1)!;

const mount = () => render(<TokenContextMenu
  actor={ACTOR} role="gm" gmToken="gm-token" x={20} y={20} reactionUsed={false} placed
  onOpenSheet={() => {}} onReturnToTray={() => {}} onClose={() => {}} />);

/** Pick a row out of the chooser's listbox by its visible label. */
async function chooseType(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole("combobox", { name: "Damage type" }));
  await user.click(within(await screen.findByRole("listbox", { name: "Damage type" })).getByRole("option", { name: label }));
}

describe("the manual damage entry's type chooser", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("offers all thirteen SRD types and reads as Untyped until one is picked", async () => {
    const user = userEvent.setup();
    mount();
    const box = screen.getByRole("combobox", { name: "Damage type" }) as HTMLInputElement;
    // Empty IS untyped - the placeholder says so rather than a fourteenth row a GM could pick.
    expect(box.value).toBe("");
    expect(box.placeholder).toBe("Untyped");
    await user.click(box);
    // Scoped to this listbox: the menu's Size and Health `<select>`s carry eleven native options of
    // their own, which is exactly the confusion an unscoped count would hide.
    const list = screen.getByRole("listbox", { name: "Damage type" });
    // The WHOLE vocabulary, not the chooser's default page of eight: thirteen is a complete list and
    // hiding five of them behind a search a GM has no reason to expect is the defect this replaces.
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
    // Byte-identical to what shipped before this control existed: an untouched chooser must not
    // widen the payload of every GM who never opens it.
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
    // Typed, not picked, and left by moving to the next control - the gesture that used to lose what
    // was typed before `Combobox` learned to commit on blur.
    await user.type(screen.getByRole("combobox", { name: "Damage type" }), "Primordial Ooze");
    await user.click(screen.getByRole("button", { name: "Dmg" }));
    expect(lastHpCall()[1]).toMatchObject({ amount: 10, damageType: "primordial-ooze" });
  });
});

/**
 * DOOR 3 - the character sheet's HP box, the one hand-entry door a PLAYER can also reach.
 *
 * `SheetHpControls` renders for both roles (only `Set` is GM-gated), so a type that fails to travel
 * from here is a player watching their own resistance not apply. Mounted alone rather than through
 * `CharacterSheet`, which would need a definition fetch and a skill catalog to reach five buttons.
 */
describe("the sheet's HP box carries the type too", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /** `said` collects the confirmation line, which is this door's own far end. */
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
    // Whatever this door sends has to survive the server's own `.strict()` gate - the same schema
    // `damage-type.mirror.test.ts` then drives into `applyDamageDetailed` for the hit-point far end.
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
    // The ack is the server's; drive it, because the feedback line is written from inside it.
    lastHpCall()[2]({ ok: true });
    expect(said.at(-1)).toBe("Damaged 10 cold.");
  });
});

/**
 * DOOR 1 - the turn-order row's tools popover, driven through the REAL `EncounterPanel`.
 *
 * The whole GM panel is mounted rather than an extracted row, because the defect this guards against
 * is the panel's own `adjustHp` losing its type - and because `hpDamageType` is PANEL state,
 * deliberately kept when a row closes so a fireball is one type across four tokens. Nothing smaller
 * than the panel can prove that, which is why the fixture carries two combatants and not one.
 */
const SECOND_ID = "10000000-0000-4000-8000-000000000002";
const GM_STATE = ((): GmView => {
  // Parsed through the real schema rather than cast from a literal: every field the tracker reads
  // that this test does not care about arrives at its own default, so the fixture cannot drift out
  // from under the panel the way a hand-rolled object does.
  const actor = (id: string, name: string) => ({ id, name, kind: "player-character", visibility: "public", hp: { current: 40, maximum: 40 } });
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    revision: 12,
    actors: [actor(ACTOR.id, ACTOR.name), actor(SECOND_ID, "Borin")],
    combat: {
      active: true, round: 1, turnActorId: ACTOR.id,
      initiative: [{ actorId: ACTOR.id, score: 17 }, { actorId: SECOND_ID, score: 11 }],
      tokens: [{ actorId: ACTOR.id, position: { x: 0, y: 0 }, sizePx: 50 }, { actorId: SECOND_ID, position: { x: 60, y: 0 }, sizePx: 50 }]
    }
  });
  return state as unknown as GmView;
})();

describe("the turn-order row's tools popover carries the type too", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /** Open a combatant's tools card, which is where the HP editor and its chooser live. */
  const openRowTools = async (user: ReturnType<typeof userEvent.setup>, name = "Aria") => {
    // By `title`, not by accessible name: the row button's name is composed from the avatar, the
    // name and the HP readout it contains, so it reads "AR Aria 40/40" and moves with the fixture.
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
    // The ack is the server's; drive it, because the panel writes its line from inside the promise.
    lastHpCall()[2]({ ok: true });
    // The far end this door can reach on its own: the words the GM reads back. They are written from
    // the same computed type the payload carries, so an untyped hit reads "took 10 damage" - and the
    // assertion sits ABOVE the payload one so a wrong VALUE fails here rather than at a guard.
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
    // `KO` is the same command with `nonlethal`, and it is the call site the spread is most likely
    // to be rebuilt at by hand - so it gets its own join rather than riding on Dmg's.
    const user = userEvent.setup();
    const tools = await openPanel(user);
    await user.type(tools.getByLabelText("Amount"), "10");
    await chooseType(user, "Thunder");
    await user.click(tools.getByRole("button", { name: "KO" }));
    expect(lastHpCall()[1]).toMatchObject({ amount: 10, damageType: "thunder", nonlethal: true });
  });

  it("keeps the chosen type when the row closes and the next one opens", async () => {
    // A fireball is one type across four tokens, so `hpDamageType` is panel state and survives the
    // accordion - unlike `hpAmount`, which the row button clears on purpose. The number is retyped
    // here and the type is NOT re-picked, which is the whole claim.
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

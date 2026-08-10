import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GmActor } from "@vtt/domain";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true } }));

import { socket } from "../socket";
import { TokenContextMenu } from "../scene/TokenContextMenu";

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
 * The map token's context menu is the door under test because it is the one all three share a builder
 * with and the only one already exported whole. Its `Heal` button sits in the same group as `Dmg` and
 * carries no type, which is the case a shared chooser is most likely to get wrong.
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

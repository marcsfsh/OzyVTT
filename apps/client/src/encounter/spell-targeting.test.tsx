import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ContentActionSummary } from "@vtt/domain";

vi.mock("../socket", () => {
  const emit = vi.fn();
  return { socket: { on: vi.fn(), off: vi.fn(), emit, timeout: () => ({ emit }) } };
});

import { socket } from "../socket";
import { ActionTargetPicker } from "./ActionTargetPicker";
import { beginTargeting, resolveTargeting, toggleTarget, useTargeting } from "./targeting";

// Spells that ask the caster something when they target: Magic Missile's darts strike one creature or several (the
// picker assigns them, and the resolve names each target once per dart), and Chromatic Orb's damage type.

const MISSILE = {
  id: "spell-magic-missile",
  name: "Magic Missile",
  activation: "action",
  description: "Darts.",
  attackBonus: null,
  saveAbility: null,
  damage: [{ formula: "1d4 + 1", type: "force" }],
  area: null,
  darts: 3
} as unknown as ContentActionSummary;
const CASTER = "11111111-1111-4111-8111-111111111111";
const GOBLIN = "22222222-2222-4222-8222-222222222222";
const ORC = "33333333-3333-4333-8333-333333333333";

/** The last resolve sent, acknowledged so the next test's resolve isn't held up as busy. */
async function lastResolve(): Promise<Record<string, unknown>> {
  const [event, payload, ack] = vi.mocked(socket.emit).mock.calls.at(-1)! as unknown as [
    string,
    Record<string, unknown>,
    (error: null, reply: unknown) => void
  ];
  expect(event).toBe("action:resolve");
  ack(null, { ok: false, message: "Refused in the test." });
  await Promise.resolve();
  return payload;
}

function Picker() {
  const session = useTargeting();
  return session ? (
    <ActionTargetPicker
      picking={session}
      targets={[
        { id: GOBLIN, label: "Goblin" },
        { id: ORC, label: "Orc" }
      ]}
      busy={false}
      onRoll={() => {}}
    />
  ) : null;
}

describe("assigning Magic Missile's darts", () => {
  it("gives each chosen target a dart count, and sends a target once per dart", async () => {
    beginTargeting(MISSILE, CASTER, 2, 4);
    render(<Picker />);
    act(() => {
      toggleTarget(GOBLIN);
      toggleTarget(ORC);
    });
    const goblin = screen.getByRole("group", { name: "Darts at Goblin" });
    fireEvent.click(goblin.querySelector('button[aria-label="Increase"]')!);
    fireEvent.click(goblin.querySelector('button[aria-label="Increase"]')!);
    expect(screen.getByText(/4 darts: all assigned/)).toBeTruthy();
    resolveTargeting(undefined, () => {});
    expect(await lastResolve()).toMatchObject({ targetIds: [GOBLIN, GOBLIN, GOBLIN, ORC], slotLevel: 2 });
  });

  it("sends the damage type picked for Chromatic Orb", async () => {
    const orb = {
      ...MISSILE,
      id: "spell-chromatic-orb",
      name: "Chromatic Orb",
      darts: undefined,
      damageTypes: ["acid", "fire"]
    };
    beginTargeting(orb as unknown as ContentActionSummary, CASTER, 1);
    render(<Picker />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "fire" } });
    act(() => toggleTarget(GOBLIN));
    resolveTargeting(undefined, () => {});
    expect(await lastResolve()).toMatchObject({ targetIds: [GOBLIN], damageType: "fire" });
  });
});

describe("the condition Blindness/Deafness imposes", () => {
  it("sends the condition picked, and nothing when the first stands", async () => {
    const curse = {
      ...MISSILE,
      id: "spell-blindnessdeafness",
      name: "Blindness/Deafness",
      darts: undefined,
      damage: [],
      saveAbility: "con",
      conditionChoices: ["blinded", "deafened"]
    };
    beginTargeting(curse as unknown as ContentActionSummary, CASTER, 2);
    render(<Picker />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("blinded");
    act(() => toggleTarget(GOBLIN));
    resolveTargeting(undefined, () => {});
    expect(await lastResolve()).not.toHaveProperty("conditionId");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "deafened" } });
    resolveTargeting(undefined, () => {});
    expect(await lastResolve()).toMatchObject({ targetIds: [GOBLIN], conditionId: "deafened" });
  });
});

describe("the condition Lesser Restoration ends", () => {
  it("asks which condition to end, and sends the one picked", async () => {
    const cure = {
      ...MISSILE,
      id: "spell-lesser-restoration",
      name: "Lesser Restoration",
      darts: undefined,
      damage: [],
      conditionChoices: ["blinded", "deafened", "paralyzed", "poisoned"]
    };
    beginTargeting(cure as unknown as ContentActionSummary, CASTER, 2);
    render(<Picker />);
    expect(screen.getByText("Condition to end")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "poisoned" } });
    act(() => toggleTarget(GOBLIN));
    resolveTargeting(undefined, () => {});
    expect(await lastResolve()).toMatchObject({ targetIds: [GOBLIN], conditionId: "poisoned" });
  });
});

describe("an area the GM places", () => {
  it("names a Cylinder by its radius, and maps it to a circle on the map", () => {
    const moonbeam = {
      ...MISSILE,
      id: "spell-moonbeam",
      name: "Moonbeam",
      darts: undefined,
      damage: [{ formula: "2d10", type: "radiant" }],
      saveAbility: "con",
      area: { shape: "cylinder", sizeFeet: 5, widthFeet: null }
    };
    beginTargeting(moonbeam as unknown as ContentActionSummary, CASTER, 2);
    render(<Picker />);
    const picker = screen.getByRole("group", { name: "Targets for Moonbeam" });
    expect(picker.textContent).toContain("Moonbeam · 5-foot-radius cylinder");
    expect(picker.textContent).toContain("Drag on the map to place it.");
    let shape: string | undefined;
    function Shape() {
      shape = useTargeting()?.template?.shape;
      return null;
    }
    render(<Shape />);
    expect(shape).toBe("circle");
  });
});

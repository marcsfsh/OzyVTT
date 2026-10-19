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
import { weaponChoicesOf, type CarriedRow } from "./weapon-choices";

// What an action asks as it resolves: an option (Fire Shield's warm or chill), one for each target (Eyebite), and the
// carried weapon its grant binds to (Shillelagh). Each is sent with the resolve; the server checks it again.

const CASTER = "11111111-1111-4111-8111-111111111111";
const GOBLIN = "22222222-2222-4222-8222-222222222222";
const ORC = "33333333-3333-4333-8333-333333333333";

const base = {
  activation: "action",
  description: "Test.",
  attackBonus: null,
  saveAbility: null,
  damage: [],
  area: null
};
const FIRE_SHIELD = {
  ...base,
  id: "spell-fire-shield",
  name: "Fire Shield",
  targeting: "none",
  choices: {
    options: [
      { id: "warm", name: "Warm Shield" },
      { id: "chill", name: "Chill Shield" }
    ]
  }
} as unknown as ContentActionSummary;
const EYEBITE = {
  ...base,
  id: "spell-eyebite",
  name: "Eyebite",
  saveAbility: "wis",
  choices: {
    optionsPerTarget: true,
    options: [
      { id: "asleep", name: "Asleep" },
      { id: "panicked", name: "Panicked" },
      { id: "sickened", name: "Sickened" }
    ]
  }
} as unknown as ContentActionSummary;
const SHILLELAGH = {
  ...base,
  id: "spell-shillelagh",
  name: "Shillelagh",
  targeting: "none",
  choices: { bindsWeapon: { weaponIds: ["club", "quarterstaff"], melee: true } }
} as unknown as ContentActionSummary;

const weapon = { rangeFeet: null, melee: true, properties: [] };
const CARRIED: CarriedRow[] = [
  { id: "longbow", name: "Longbow", quantity: 1, weapon: { rangeFeet: 150, melee: false } },
  { id: "quarterstaff", name: "Quarterstaff", quantity: 1, weapon },
  { id: "club-2", recordId: "club", name: "Club", quantity: 1, weapon },
  { id: "rope", name: "Rope", quantity: 1 }
];

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
      carried={CARRIED}
      busy={false}
      onRoll={() => {}}
    />
  ) : null;
}

describe("an option picked as the action resolves", () => {
  it("starts on the first option and sends the one picked", async () => {
    beginTargeting(FIRE_SHIELD, CASTER, 4);
    render(<Picker />);
    const choice = screen.getByRole("combobox", { name: "Choice" }) as HTMLSelectElement;
    expect(choice.value).toBe("warm");
    fireEvent.change(choice, { target: { value: "chill" } });
    resolveTargeting(undefined, () => {});
    expect(await lastResolve()).toMatchObject({ actionId: "spell-fire-shield", optionId: "chill", slotLevel: 4 });
  });

  it("asks for each selected target's own pick", async () => {
    beginTargeting(EYEBITE, CASTER, 6);
    render(<Picker />);
    act(() => {
      toggleTarget(GOBLIN);
      toggleTarget(ORC);
    });
    fireEvent.change(screen.getByRole("combobox", { name: "For Goblin" }), { target: { value: "asleep" } });
    fireEvent.change(screen.getByRole("combobox", { name: "For Orc" }), { target: { value: "sickened" } });
    act(() => toggleTarget(ORC));
    resolveTargeting(undefined, () => {});
    // A pick for a creature no longer selected stays behind.
    expect(await lastResolve()).toMatchObject({ targetIds: [GOBLIN], targetOptions: { [GOBLIN]: "asleep" } });
  });
});

describe("who a cantrip's Temporary Hit Points go to", () => {
  const SACRED_FLAME = {
    ...base,
    id: "spell-sacred-flame",
    name: "Sacred Flame",
    saveAbility: "dex",
    vitality: { rangeFeet: 60, amount: 10 }
  } as unknown as ContentActionSummary;

  it("starts on the caster and sends another creature picked", async () => {
    beginTargeting(SACRED_FLAME, CASTER);
    render(<Picker />);
    const select = screen.getByRole("combobox", { name: "Temporary Hit Points to" }) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(["You", "Goblin", "Orc"]);
    expect(select.value).toBe(CASTER);
    act(() => toggleTarget(GOBLIN));
    fireEvent.change(select, { target: { value: ORC } });
    resolveTargeting(undefined, () => {});
    expect(await lastResolve()).toMatchObject({ actionId: "spell-sacred-flame", vitalityTo: ORC });
  });
});

describe("the weapon a grant binds to", () => {
  it("offers the carried weapons it fits and sends the one picked", async () => {
    beginTargeting(SHILLELAGH, CASTER);
    render(<Picker />);
    const select = screen.getByRole("combobox", { name: "Weapon" }) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(["Quarterstaff", "Club"]);
    fireEvent.change(select, { target: { value: "club-2" } });
    resolveTargeting(undefined, () => {});
    expect(await lastResolve()).toMatchObject({ actionId: "spell-shillelagh", itemId: "club-2" });
  });

  it("keeps only Melee weapons when the grant asks for one", () => {
    expect(weaponChoicesOf(CARRIED, { melee: true }).map((row) => row.id)).toEqual(["quarterstaff", "club-2"]);
    expect(weaponChoicesOf(CARRIED, {}).map((row) => row.id)).toEqual(["longbow", "quarterstaff", "club-2"]);
  });
});

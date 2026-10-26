import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { ContentActionSummary } from "@vtt/domain";

vi.mock("../socket", () => {
  const emit = vi.fn();
  return { socket: { on: vi.fn(), off: vi.fn(), emit, timeout: () => ({ emit }) } };
});

import { socket } from "../socket";
import { ActionTargetPicker } from "./ActionTargetPicker";
import {
  beginTargeting,
  picksDestination,
  resolveTargeting,
  setDestination,
  targetingReady,
  toggleTarget,
  useTargeting
} from "./targeting";

// Stat-block actions that set a creature down in a space the user picks: a bulette's Deadly Leap lands the bulette, and
// a kraken's Fling throws the creature chosen first. The picker asks for the space, and the resolve sends it.

const LEAP = {
  id: "deadly-leap",
  name: "Deadly Leap",
  activation: "action",
  description: "A leap.",
  attackBonus: null,
  saveAbility: "dex",
  saveDc: 15,
  damage: [{ formula: "3d12", type: "bludgeoning" }],
  area: null,
  destination: { who: "user", feet: 15 }
} as unknown as ContentActionSummary;
const FLING = { ...LEAP, id: "fling", name: "Fling", destination: { who: "target", feet: 60 } } as ContentActionSummary;
const MONSTER = "11111111-1111-4111-8111-111111111111";
const HERO = "22222222-2222-4222-8222-222222222222";

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
    <ActionTargetPicker picking={session} targets={[{ id: HERO, label: "Hero" }]} busy={false} onRoll={() => {}} />
  ) : null;
}

describe("a leap onto a space", () => {
  it("waits for the space, then sends it with no target", async () => {
    beginTargeting(LEAP, MONSTER);
    render(<Picker />);
    expect(screen.getByText("Tap the space on the map to land in, within 15 ft.")).toBeTruthy();
    expect(targetingReady(useTargetingNow())).toBe(false);
    act(() => setDestination({ x: 125, y: 75 }));
    expect(targetingReady(useTargetingNow())).toBe(true);
    resolveTargeting(undefined, () => {});
    const sent = await lastResolve();
    expect(sent).toMatchObject({ actionId: "deadly-leap", destination: { x: 125, y: 75 } });
    expect(sent.targetIds).toBeUndefined();
  });
});

describe("a throw to a space", () => {
  it("asks for the creature first, then the space it lands in", async () => {
    beginTargeting(FLING, MONSTER);
    render(<Picker />);
    expect(picksDestination(useTargetingNow())).toBe(false);
    expect(screen.getByText("Choose the creature to throw, then tap the space it lands in.")).toBeTruthy();
    act(() => toggleTarget(HERO));
    expect(picksDestination(useTargetingNow())).toBe(true);
    act(() => setDestination({ x: 525, y: 75 }));
    resolveTargeting(undefined, () => {});
    expect(await lastResolve()).toMatchObject({ targetIds: [HERO], destination: { x: 525, y: 75 } });
  });
});

/** The session as it stands, read outside React. */
let current: ReturnType<typeof useTargeting> = null;
function useTargetingNow() {
  render(<Probe />);
  return current!;
}
function Probe() {
  current = useTargeting();
  return null;
}

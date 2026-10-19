import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentActionSummary } from "@vtt/domain";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }) as Record<string, unknown>);
vi.mock("../lib/command", () => ({
  command: (...args: unknown[]) => command(...args),
  read: vi.fn(async () => ({ ok: false }))
}));

import {
  beginTargeting,
  clearTargeting,
  placeAnotherTemplate,
  resolveTargeting,
  setTemplatePlacement
} from "./targeting";

// SRD 5.2.1 Fire Storm: "up to ten 10-foot Cubes, which you arrange as you like". Each Cube is set down in turn, and the
// roll sends every one of them.

const DRUID = "10000000-0000-4000-8000-000000000001";
const FIRE_STORM = {
  id: "spell-fire-storm",
  name: "Fire Storm",
  activation: "action",
  description: "A storm of fire appears within range.",
  attackBonus: null,
  reachFeet: null,
  rangeFeet: null,
  rangeNormalFeet: null,
  saveAbility: "dex",
  saveDc: 18,
  damage: [{ formula: "7d10", type: "fire" }],
  area: { shape: "cube", sizeFeet: 10, widthFeet: null, count: 10, contiguous: true },
  attackCount: null,
  usesLimit: null,
  usesPer: null,
  usesRecharge: null,
  usesPool: null,
  requiresEffectTag: null,
  multiattack: null,
  grants: false,
  reaction: null
} as unknown as ContentActionSummary;

afterEach(() => {
  clearTargeting();
  command.mockClear();
});

describe("a cast that places several areas", () => {
  it("sends every Cube set down with the one placed last", async () => {
    beginTargeting(FIRE_STORM, DRUID);
    setTemplatePlacement({ x: 0, y: 0 }, { x: 100, y: 100 });
    placeAnotherTemplate();
    setTemplatePlacement({ x: 100, y: 0 }, { x: 200, y: 100 });
    resolveTargeting(undefined, () => {});
    await vi.waitFor(() => expect(command).toHaveBeenCalled());
    const [event, payload] = command.mock.calls[0]! as [string, Record<string, unknown>];
    expect(event).toBe("action:resolve");
    expect(payload.templates).toEqual([
      { shape: "square", origin: { x: 0, y: 0 }, target: { x: 100, y: 100 } },
      { shape: "square", origin: { x: 100, y: 0 }, target: { x: 200, y: 100 } }
    ]);
    expect(payload.template).toBeUndefined();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ContentActionSummary } from "@vtt/domain";

vi.mock("../lib/command", () => ({
  command: vi.fn(async () => ({ ok: true })),
  read: vi.fn(async () => ({ ok: false }))
}));

import { beginTargeting, clearTargeting, setEffectOption, useTargeting } from "./targeting";

// SRD 5.2.1 Wall of Fire: "a straight wall up to 60 feet long ... or a ringed wall up to 20 feet in diameter". The form
// is picked as the cast is aimed, and the ring is drawn as the circle the server places.

const WIZARD = "10000000-0000-4000-8000-000000000001";
const WALL_OF_FIRE = {
  id: "spell-wall-of-fire",
  name: "Wall of Fire",
  activation: "action",
  description: "You create a wall of fire.",
  attackBonus: null,
  saveAbility: "dex",
  damage: [{ formula: "5d8", type: "fire" }],
  area: { shape: "line", sizeFeet: 60, widthFeet: 5 },
  options: [
    { id: "left", name: "Straight, burning on the left" },
    { id: "ring-inside", name: "Ring, burning inside", area: { shape: "cylinder", sizeFeet: 10, widthFeet: null } }
  ]
} as unknown as ContentActionSummary;

const template = () => renderHook(() => useTargeting()).result.current?.template;

afterEach(() => clearTargeting());

describe("a wall cast in one of its forms", () => {
  it("starts as the straight wall the first form places", () => {
    beginTargeting(WALL_OF_FIRE, WIZARD, 4);
    expect(template()).toMatchObject({ shape: "line", sizeFeet: 60, widthFeet: 5 });
  });

  it("draws the ring as a circle once the ring is picked, and the line again after", () => {
    beginTargeting(WALL_OF_FIRE, WIZARD, 4);
    setEffectOption("ring-inside");
    expect(template()).toMatchObject({ shape: "circle", sizeFeet: 10, placed: null });
    setEffectOption("left");
    expect(template()).toMatchObject({ shape: "line", sizeFeet: 60 });
  });
});

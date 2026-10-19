import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ContentActionSummary } from "@vtt/domain";

vi.mock("../lib/command", () => ({
  command: vi.fn(async () => ({ ok: true })),
  read: vi.fn(async () => ({ ok: false }))
}));

import { beginTargeting, clearTargeting, useTargeting } from "./targeting";

// SRD 5.2.1 Fog Cloud: "The Sphere's radius increases by 20 feet for each spell slot level above 1." The template drawn
// for a higher slot is the size the server places.

const WIZARD = "10000000-0000-4000-8000-000000000001";
const FOG_CLOUD = {
  id: "spell-fog-cloud",
  name: "Fog Cloud",
  activation: "action",
  description: "You create a 20-foot-radius Sphere of fog.",
  attackBonus: null,
  saveAbility: null,
  damage: [],
  area: { shape: "sphere", sizeFeet: 20, widthFeet: null },
  areaPerSlot: { feet: 20, level: 1 }
} as unknown as ContentActionSummary;

const templateSize = () => renderHook(() => useTargeting()).result.current?.template?.sizeFeet;

afterEach(() => clearTargeting());

describe("an area cast with a higher slot", () => {
  it("draws its template grown by the slot levels above the spell's own", () => {
    beginTargeting(FOG_CLOUD, WIZARD, 3);
    expect(templateSize()).toBe(60);
  });

  it("draws the printed size at the spell's own level", () => {
    beginTargeting(FOG_CLOUD, WIZARD, 1);
    expect(templateSize()).toBe(20);
  });
});

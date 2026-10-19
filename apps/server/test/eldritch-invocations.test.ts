import { describe, expect, it } from "vitest";
import type { ActorDefinition } from "@vtt/schemas";
import { breathesWater } from "../src/breath.js";
import { type CharacterCreateRequestInput } from "../src/character-build.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { specialSpeedsOf } from "../src/speed.js";
import { build, catalog, fight, warlockInput } from "./spell-casters.js";

// SRD 5.2.1 Eldritch Invocation Options, each by its own text.

type Row = CharacterCreateRequestInput["choices"][number];

/** A Warlock 5 (CHA 15, Soldier) whose invocations are swapped as named, with the rows given added. */
function warlockWith(swaps: Readonly<Record<string, string>>, extra: readonly Row[] = []): ActorDefinition {
  const input = warlockInput(["hex", "hellish-rebuke", "hold-person", "misty-step"]);
  const dropped = new Set(Object.keys(swaps));
  const choices = input.choices.flatMap((row) => {
    if (row.kind === "eldritch-invocation" && swaps[row.id]) return [{ ...row, id: swaps[row.id]! }];
    if (row.kind === "cantrip" && dropped.has(String(row.payload?.featureId))) return [];
    return [row];
  });
  return build({ ...input, choices: [...choices, ...extra] } as CharacterCreateRequestInput);
}

describe("Gift of the Depths", () => {
  it("gives a Swim Speed equal to the Warlock's Speed, and breathing underwater", () => {
    const sheet = warlockWith({ "eldritch-spear": "gift-of-the-depths" });
    const { hero } = fight(sheet);
    const speeds = specialSpeedsOf(hero, sheet, deriveEquipment(hero, sheet, catalog));
    expect(speeds.swim).toBe(hero.speedFeet);
    expect(breathesWater(hero, sheet)).toBe(true);
    const without = warlockWith({});
    const plain = fight(without).hero;
    expect(specialSpeedsOf(plain, without, deriveEquipment(plain, without, catalog)).swim ?? 0).toBe(0);
    expect(breathesWater(plain, without)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { PlayerView } from "@vtt/domain";
import { loreWords, playerTargetCandidates, targetRows } from "./targetRows";

// SRD 5.2.1 Hunter's Lore: while its Hunter's Mark marks a creature, the Hunter's player reads its Immunities,
// Resistances and Vulnerabilities in the target list, from what the server sends that player alone.

const GHOST = "10000000-0000-4000-8000-000000000003";

describe("Hunter's Lore in a player's target list", () => {
  it("names the marked creature's defences beside its distance", () => {
    const view = {
      combat: { initiative: [{ actorId: GHOST, name: "Ghost" }] },
      actors: [
        {
          id: GHOST,
          kind: "monster",
          hp: { kind: "band", band: "healthy" },
          knownDefences: {
            damageImmunities: ["necrotic", "poison"],
            damageResistances: ["acid"],
            damageVulnerabilities: [],
            conditionImmunities: ["frightened"]
          }
        }
      ]
    } as unknown as PlayerView;
    const [row] = targetRows("hunter", playerTargetCandidates(view), [], null);
    expect(row!.detail).toBe("Immune Necrotic, Poison · Resists Acid · Can't be Frightened");
  });

  it("says so when the creature has none", () => {
    expect(
      loreWords({ damageImmunities: [], damageResistances: [], damageVulnerabilities: [], conditionImmunities: [] })
    ).toBe("No Immunities, Resistances or Vulnerabilities");
  });
});

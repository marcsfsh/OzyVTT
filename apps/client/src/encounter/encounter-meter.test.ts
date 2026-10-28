import { describe, expect, it } from "vitest";
import type { ContentMonsterSummary, GmActor } from "@vtt/domain";
import { readEncounter } from "./EncounterMeter";

// The scene's encounter reading: the SRD's budget for the staged characters' levels, and never a difficulty the
// catalog can't back.

const pc = (id: string, level: number) =>
  ({ id, name: id, kind: "player-character", hitDice: { maximum: level } }) as unknown as GmActor;
const foe = (id: string, name: string, definitionId: string | null) =>
  ({ id, name, kind: "monster", definitionId }) as unknown as GmActor;
const catalog = [
  { id: "troll", experiencePoints: 1800 },
  { id: "bugbear-stalker", experiencePoints: 700 },
  { id: "worg", experiencePoints: 100 }
] as unknown as ContentMonsterSummary[];

describe("the encounter's difficulty reading", () => {
  const party = [pc("a", 7), pc("b", 7), pc("c", 7)];
  const foes = [
    foe("t", "Troll", "troll"),
    foe("s1", "Bugbear Stalker 1", "bugbear-stalker"),
    foe("s2", "Bugbear Stalker 2", "bugbear-stalker"),
    foe("w1", "Worg 1", "worg"),
    foe("w2", "Worg 2", "worg"),
    foe("w3", "Worg 3", "worg"),
    foe("w4", "Worg 4", "worg")
  ];
  const everyone = [...party, ...foes];

  it("groups the monsters and reads 3,600 XP as Low for three level 7 characters", () => {
    const reading = readEncounter(
      everyone,
      everyone.map((actor) => actor.id),
      catalog
    );
    expect(reading.kind).toBe("reading");
    if (reading.kind !== "reading") return;
    expect(reading.groups.map((group) => [group.name, group.count, group.xp])).toEqual([
      ["Troll", 1, 1800],
      ["Bugbear Stalker", 2, 700],
      ["Worg", 4, 100]
    ]);
    expect(reading.xp).toBe(3600);
    expect(reading.budget).toEqual({ low: 2250, moderate: 3900, high: 5100 });
    expect(reading.difficulty).toBe("low");
  });

  it("reads past High, and mixed levels sum their own rows", () => {
    const big = [...party, foe("t", "Troll", "troll"), foe("t2", "Troll 2", "troll"), foe("t3", "Troll 3", "troll")];
    const reading = readEncounter(
      big,
      big.map((actor) => actor.id),
      catalog
    );
    expect(reading.kind === "reading" && reading.difficulty).toBe("over-high");
    const mixed = [pc("a", 1), pc("b", 5), foe("w", "Worg", "worg")];
    const low = readEncounter(
      mixed,
      mixed.map((actor) => actor.id),
      catalog
    );
    expect(low.kind === "reading" && low.budget).toEqual({ low: 50 + 500, moderate: 75 + 750, high: 100 + 1100 });
  });

  it("says nothing it can't back: no monsters, no party, or a monster the catalog gives no XP", () => {
    expect(
      readEncounter(
        party,
        party.map((actor) => actor.id),
        catalog
      ).kind
    ).toBe("no-foes");
    const alone = readEncounter(
      foes,
      foes.map((actor) => actor.id),
      catalog
    );
    expect(alone.kind === "no-party" && alone.xp).toBe(3600);
    const odd = [...party, foe("h", "Homebrew horror", null)];
    const unknown = readEncounter(
      odd,
      odd.map((actor) => actor.id),
      catalog
    );
    expect(unknown.kind === "unknown-xp" && unknown.missing).toEqual(["Homebrew horror"]);
  });
});

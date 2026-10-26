import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { unconsumedClauses } from "@vtt/content-srd-5.2.1/action-clauses";
import type { ActorAction } from "@vtt/schemas";
import { srdCoverageRows } from "../src/srd-coverage.js";

// The printed failure and target clauses a stat-block action's readers turn into data (a Speed cut, Disadvantage, no
// Reactions, a size gate, a creature type left out, "each enemy", a creature that must see the user). An action the
// manifest marks enforced carries every one it prints, so a rider the readers drop can't read as applied.

const MONSTERS = loadMonsterDefinitions();
const action = (slug: string, id: string): ActorAction =>
  MONSTERS.find((monster) => monster.source.externalId === slug)!.actions.find((entry) => entry.id === id)!;

describe("printed clauses on stat-block actions", () => {
  it("carries every printed clause on each action the manifest marks enforced", () => {
    const enforced = new Set(
      srdCoverageRows()
        .filter((row) => row.group === "Monster actions" && row.state === "enforced")
        .map((row) => row.id)
    );
    const unread = MONSTERS.flatMap((monster) =>
      monster.actions
        .filter((entry) => entry.partOf === undefined && enforced.has(`${monster.name}/${entry.id}`))
        .flatMap((entry) => {
          // An entry that prints its choices inside it is applied by those choices.
          const parts = monster.actions.filter((other) => other.partOf === entry.id);
          const clauses = (parts.length > 0 ? parts : [entry]).flatMap(unconsumedClauses);
          return clauses.length > 0
            ? [`${monster.source.externalId}/${entry.id}: ${[...new Set(clauses)].join(", ")}`]
            : [];
        })
    );
    expect(unread).toEqual([]);
  });

  it("finds each clause an action prints when no data carries it", () => {
    const bare = (entry: ActorAction): ActorAction => {
      const { targets: _targets, sight: _sight, save, ...rest } = entry;
      if (!save) return rest as ActorAction;
      const {
        failureEffect: _effect,
        failureMaxSize: _size,
        sparesCreatureTypes: _types,
        sparesSpecies: _species,
        ...kept
      } = save;
      return { ...rest, save: kept } as ActorAction;
    };
    expect(unconsumedClauses(bare(action("planetar", "holy-burst")))).toEqual(["each-enemy"]);
    expect(unconsumedClauses(bare(action("ghost", "horrific-visage")))).toEqual(["not-type", "sees-user"]);
    expect(unconsumedClauses(bare(action("giant-ape", "boulder-toss")))).toEqual(["size"]);
    expect(unconsumedClauses(bare(action("steam-mephit", "steam-breath")))).toEqual(["speed"]);
    expect(unconsumedClauses(bare(action("dretch", "fetid-cloud-1-day")))).toEqual(["no-reactions"]);
    expect(unconsumedClauses(bare(action("swarm-of-ravens", "cacophony")))).toEqual(["disadvantage"]);
  });
});

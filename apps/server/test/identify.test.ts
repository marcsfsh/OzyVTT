import { describe, expect, it } from "vitest";
import { projectPlayerView } from "../src/projections.js";
import { catalogRow, edit, fighterInput, IDS, tableOf, write } from "./equipment-table.js";
import { HERO } from "./spell-casters.js";
import { actorOf, cast, caster } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 Identify: "You touch an object throughout the spell's casting. If the object is a magic item or some other
// magic-imbued object, you learn its properties and how to use them, whether it requires Attunement, and how many
// charges it has, if any."

const PLAYER_SESSION = "30000000-0000-4000-8000-0000000000c1";

describe("Identify", () => {
  it("marks the carried item it is cast on", () => {
    const table = caster({ combat: false });
    const hero = actorOf(table.state, HERO);
    hero.inventory.push(
      { id: "pearl", name: "Pearl (100 GP)", quantity: 1, equipped: false, attuned: false },
      { id: "ioun-stone", name: "Ioun Stone", quantity: 1, equipped: false, attuned: false, variantId: "insight" }
    );
    const result = cast(table, "identify", { targetIds: [], itemId: "ioun-stone" });
    expect(hero.inventory.find((row) => row.id === "ioun-stone")?.identified).toBe(true);
    expect(result.tableNarration?.map((line) => line.text).join(" ")).toMatch(/learns the properties of the item/);
    expect(() => cast(table, "identify", { targetIds: [], itemId: "nothing-here" })).toThrow(
      "Ansel isn't carrying that item."
    );
  });

  it("shows its player the kind and the GM's pick of an identified copy, which no sheet write can claim", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    table.actor(IDS.fighter).ownerSessionId = PLAYER_SESSION;
    write(table, IDS.fighter, catalogRow("ioun-stone", { variantId: "insight" }), "gm");
    const seen = () =>
      projectPlayerView(table.state, PLAYER_SESSION, () => "online")
        .actors.find((actor) => actor.id === IDS.fighter)!
        .inventory!.find((entry) => entry.id === "ioun-stone")!;
    expect(seen().variantId).toBeUndefined();
    // A player's write can't mark it identified.
    write(table, IDS.fighter, edit(table, IDS.fighter, "ioun-stone", { identified: true }));
    expect(seen().variantId).toBeUndefined();
    // The cast's mark shows it, and survives the player's next write of the row.
    table.actor(IDS.fighter).inventory = table
      .actor(IDS.fighter)
      .inventory.map((row) => (row.id === "ioun-stone" ? { ...row, identified: true as const } : row));
    expect(seen().variantId).toBe("insight");
    const { identified: _mark, ...sheetRow } = edit(table, IDS.fighter, "ioun-stone", { equipped: false });
    write(table, IDS.fighter, sheetRow);
    expect(seen().variantId).toBe("insight");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { CONTENT_PATHS } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import { bootServer } from "./boot-server.js";

// The GM runs a combatant's turn with everything it can do: its stat block's actions, the generic actions, and what
// its carried items give (a Wand of Paralysis' ray), as the combatant's own sheet lists them.

const GOBLIN = "73000000-0000-4000-8000-000000000001";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("the GM's action list for a combatant", () => {
  it("lists what its items give beside its stat block's actions", async () => {
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        {
          id: GOBLIN,
          name: "Goblin Boss",
          kind: "monster",
          visibility: "public",
          hp: { current: 21, maximum: 21 },
          definitionId: "goblin-boss",
          inventory: [
            {
              id: "wand-of-paralysis",
              name: "Wand of Paralysis",
              quantity: 1,
              equipped: true,
              attuned: true,
              category: "wand"
            }
          ]
        }
      ]
    });
    const { base, gmToken, close } = await bootServer(state);
    cleanups.push(close);
    const read = async (query: string) =>
      (
        (await (
          await fetch(`${base}${CONTENT_PATHS.monsterActions.replace("{definitionId}", "goblin-boss")}${query}`, {
            headers: { authorization: `Bearer ${gmToken}` }
          })
        ).json()) as { data: { actions: ReadonlyArray<{ id: string }> } }
      ).data.actions.map((action) => action.id);

    const browsed = await read("");
    expect(browsed.some((id) => id.startsWith("item-wand-of-paralysis"))).toBe(false);
    const played = await read(`?actorId=${GOBLIN}`);
    expect(played).toContain("item-wand-of-paralysis-paralyzing-ray");
    expect(played).toEqual(expect.arrayContaining(browsed));
  });
});

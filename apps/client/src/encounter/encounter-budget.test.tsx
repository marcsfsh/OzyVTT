import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { GmActor } from "@vtt/domain";

vi.mock("./monster-catalog", () => ({
  loadMonsterCatalog: () =>
    Promise.resolve({
      monsters: [
        { id: "goblin-warrior", experiencePoints: 50 },
        { id: "ogre", experiencePoints: 450 }
      ],
      attribution: ""
    })
}));

import { EncounterBudgetLine } from "./EncounterBudget";

const actor = (over: Partial<GmActor> & Pick<GmActor, "id" | "kind">): GmActor =>
  ({ name: over.id, visibility: "public", hitDice: null, ...over }) as unknown as GmActor;
const hero = (id: string, level: number) =>
  actor({ id, kind: "player-character", hitDice: { die: 10, maximum: level, remaining: level, entries: [] } as never });

describe("the staged fight's XP against the SRD budget", () => {
  it("names the difficulty the monsters' XP reaches for the staged characters' levels", async () => {
    // Four level 1 characters: Low 200, Moderate 300, High 400. Three goblins and an ogre: 600 XP.
    const actors = [
      hero("a", 1),
      hero("b", 1),
      hero("c", 1),
      hero("d", 1),
      actor({ id: "g1", kind: "monster", definitionId: "goblin-warrior" }),
      actor({ id: "g2", kind: "monster", definitionId: "goblin-warrior" }),
      actor({ id: "g3", kind: "monster", definitionId: "goblin-warrior" }),
      actor({ id: "o", kind: "monster", definitionId: "ogre" })
    ];
    render(<EncounterBudgetLine actors={actors} staged={actors.map((each) => each.id)} />);
    expect(await screen.findByText(/Beyond High for 4 characters/)).toBeTruthy();
    expect(screen.getByText("600")).toBeTruthy();
  });

  it("says nothing until a monster is staged", async () => {
    const { container } = render(<EncounterBudgetLine actors={[hero("a", 3)]} staged={["a"]} />);
    await Promise.resolve();
    expect(container.textContent).toBe("");
  });
});

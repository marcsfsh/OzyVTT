import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ActorDefinition, ContentSpellSummary } from "@vtt/domain";

vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { summaryOfOwnAction } from "../encounter/PlayerActionRunner";
import { SpellPickChooser } from "../encounter/SpellPickChooser";
import { NO_FACTS, turnOptions } from "./turn-options";

// SRD 5.2.1 Divine Intervention: "choose any Cleric spell of level 5 or lower ... you cast that spell". The server sends
// each spell it may cast as a row of its own; the sheet lists them under the feature's row, to pick when it is tapped.

type Action = ActorDefinition["actions"][number];
const action = (id: string, name: string, extra: Partial<Action> = {}): Action =>
  ({
    id,
    name,
    activation: "action",
    description: "A test action.",
    damage: [],
    uses: { limit: 1, per: "long-rest", pool: "divine-intervention" },
    ...extra
  }) as Action;
const definition = {
  name: "Mira",
  actions: [action("divine-intervention", "Divine Intervention", { uses: { limit: 1, per: "long-rest" } })]
} as unknown as ActorDefinition;
const spells = new Map<string, ContentSpellSummary>([
  ["hold-person", { id: "hold-person", name: "Hold Person", level: 2 } as ContentSpellSummary],
  ["flame-strike", { id: "flame-strike", name: "Flame Strike", level: 5 } as ContentSpellSummary]
]);
const rows = [
  action("divine-intervention-flame-strike", "Flame Strike (Divine Intervention)", {
    save: { ability: "dex", dc: 16, successDamage: "half" } as Action["save"],
    damage: [{ formula: "5d6", type: "fire" }]
  }),
  action("divine-intervention-hold-person", "Hold Person (Divine Intervention)", {
    save: { ability: "wis", dc: 16, successDamage: "none" } as Action["save"]
  })
].map(summaryOfOwnAction);
const options = turnOptions({
  definition,
  actor: null,
  ownSummaries: new Map(definition.actions.map((entry) => [entry.id, summaryOfOwnAction(entry)])),
  extraActions: rows,
  facts: NO_FACTS,
  spellReference: spells,
  characterLevel: 10
});

describe("Divine Intervention's spells on the sheet", () => {
  it("sit under the feature's row, by level, and not in the list on their own", () => {
    expect(options.map((option) => option.id)).toEqual(["divine-intervention"]);
    expect(options[0]!.picks?.map((pick) => [pick.name, pick.level])).toEqual([
      ["Hold Person", 2],
      ["Flame Strike", 5]
    ]);
  });

  it("are found by name and picked to cast", () => {
    const onPick = vi.fn();
    render(<SpellPickChooser option={options[0]!} busy={false} onPick={onPick} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search spells" }), { target: { value: "flame" } });
    expect(screen.queryByRole("button", { name: /Hold Person/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Flame Strike/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "divine-intervention-flame-strike" }));
  });
});

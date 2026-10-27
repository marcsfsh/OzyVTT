import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActorDerivedSheet, GmView } from "@vtt/domain";
import { ToolUses } from "./ToolUses";
import type { SheetActor } from "./sheet-model";
import type { SheetRolls } from "./useSheetRolls";

// SRD 5.2.1 Tools: each tool's Utilize uses at their DCs, and gear that prints one (a Grappling Hook). The server rolls
// the record's check; in a fight a Thief's Fast Hands takes the use as a Bonus Action.

const NORMAL = { mode: "normal", advantage: [], disadvantage: [] } as const;
const ARIA = { id: "10000000-0000-4000-8000-000000000001", name: "Aria" } as unknown as SheetActor;
const BREN = { id: "10000000-0000-4000-8000-000000000002", name: "Bren", kind: "player-character" };

const derived = (over: Partial<ActorDerivedSheet>) =>
  ({ tools: [], gearUses: [], fastHands: false, ...over }) as unknown as ActorDerivedSheet;

function rolls() {
  return { rolling: false, rollUse: vi.fn(), rollCheck: vi.fn() } as unknown as SheetRolls & {
    rollUse: ReturnType<typeof vi.fn>;
    rollCheck: ReturnType<typeof vi.fn>;
  };
}

const hook = {
  id: "grappling-hook",
  name: "Grappling Hook",
  uses: [
    {
      label: "Throw the hook at a catch within 50 feet",
      dc: 13,
      skill: "acrobatics",
      ability: "dex" as const,
      bonus: 4,
      mode: NORMAL
    }
  ]
};

describe("the sheet's Utilize uses", () => {
  it("rolls a carried gear's printed check, and as a Bonus Action for a Thief in a fight", async () => {
    const roller = rolls();
    render(<ToolUses actor={ARIA} derived={derived({ gearUses: [hook], fastHands: true })} rolls={roller} inFight />);
    const user = userEvent.setup();
    expect(screen.getByText("Each use takes your action, and needs the item in your pack.")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Roll Throw the hook at a catch within 50 feet with Grappling Hook, DC 13" })
    );
    await user.click(
      screen.getByRole("button", {
        name: "Roll Throw the hook at a catch within 50 feet with Grappling Hook as a Bonus Action, DC 13"
      })
    );
    await user.click(screen.getByRole("button", { name: "Roll Dexterity (Sleight of Hand) as a Bonus Action" }));
    expect(roller.rollUse.mock.calls.map((call) => call[0])).toEqual([
      {
        item: "grappling-hook",
        index: 0,
        ability: "dex",
        label: "Throw the hook at a catch within 50 feet (Grappling Hook)"
      },
      {
        item: "grappling-hook",
        index: 0,
        ability: "dex",
        label: "Throw the hook at a catch within 50 feet (Grappling Hook)",
        bonusAction: true
      }
    ]);
    expect(roller.rollCheck.mock.calls[0]?.[4]).toEqual({ bonusAction: true });
  });

  it("offers no Bonus Action outside a fight", () => {
    render(
      <ToolUses actor={ARIA} derived={derived({ gearUses: [hook], fastHands: true })} rolls={rolls()} inFight={false} />
    );
    expect(screen.queryByRole("button", { name: /as a Bonus Action/ })).toBeNull();
  });

  it("lets Cobbler's Tools work for another party character", async () => {
    const roller = rolls();
    const cobbler = {
      id: "cobblers-tools",
      name: "Cobbler's Tools",
      ability: "dex",
      bonus: 2,
      mode: NORMAL,
      reliableTalent: false,
      proficient: true,
      carried: true,
      uses: [{ label: "Modify footwear", dc: 10, forAnother: true }]
    };
    const state = { actors: [ARIA, BREN] } as unknown as GmView;
    render(
      <ToolUses
        actor={ARIA}
        derived={derived({ tools: [cobbler] as never })}
        rolls={roller}
        inFight={false}
        state={state}
      />
    );
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "Who Modify footwear is for" }), BREN.id);
    await user.click(screen.getByRole("button", { name: "Roll Modify footwear with Cobbler's Tools, DC 10" }));
    expect(roller.rollUse.mock.calls[0]?.[0]).toMatchObject({ tool: "cobblers-tools", index: 0, forActorId: BREN.id });
  });
});

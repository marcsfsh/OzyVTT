import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ActionResolution, ContentActionSummary, GmActor, GmView } from "@vtt/domain";

vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { ActionResultCard } from "./ActionResultCard";

const FOE = "10000000-0000-4000-8000-000000000002";

const action = (id: string, name: string): ContentActionSummary =>
  ({ id, name, activation: "action", damage: [], attackBonus: 5 }) as unknown as ContentActionSummary;

const card = (result: ActionResolution, onAgain = vi.fn(), applyDamage = vi.fn()) => {
  render(
    <ActionResultCard
      state={{ combat: { pendingReactions: [], pendingSaves: [] } } as unknown as GmView}
      actor={{ id: "10000000-0000-4000-8000-000000000001", name: "Borin" } as GmActor}
      result={result}
      actions={[action("item-greataxe", "Greataxe"), action("item-greataxe-cleave", "Greataxe (Cleave)")]}
      busy={false}
      resolveBusy={false}
      rollMode="auto"
      onFeedback={() => {}}
      resolve={() => {}}
      onAgain={onAgain}
      applied={new Set()}
      damageEdit={null}
      onDamageEditChange={() => {}}
      applyDamage={applyDamage}
    />
  );
  return { onAgain, applyDamage };
};

const swing = (
  outcome: "hit" | "miss",
  damageTotal: number,
  extra: Partial<ActionResolution> = {}
): ActionResolution => ({
  actionName: "Greataxe",
  activation: "action",
  attack: { targetId: FOE, targetName: "Goblin", total: 18, naturalRoll: 13, targetAc: 15, outcome },
  save: null,
  damage: [],
  damageTotal,
  crit: false,
  ...extra
});

describe("the GM's result card", () => {
  it("offers the Cleave a hit opened, starting it like any other action", () => {
    const { onAgain } = card(
      swing("hit", 9, { opens: { actionId: "item-greataxe-cleave", actionName: "Greataxe (Cleave)" } })
    );
    fireEvent.click(screen.getByRole("button", { name: "Greataxe (Cleave)" }));
    expect(onAgain).toHaveBeenCalledWith(expect.objectContaining({ id: "item-greataxe-cleave" }));
  });

  it("lets a Graze miss be applied like a hit", () => {
    const { applyDamage } = card(swing("miss", 3, { bonusDamage: [{ amount: 3, type: "slashing", source: "Graze" }] }));
    fireEvent.click(screen.getByRole("button", { name: "Apply to Goblin" }));
    expect(applyDamage).toHaveBeenCalledWith(FOE, "Goblin", FOE, 3);
  });

  it("splits Magic Missile's darts by target, each with its own Apply", () => {
    const OTHER = "10000000-0000-4000-8000-000000000003";
    const dart = (total: number) => ({ formula: "1d4 + 1", type: "force", total });
    const { applyDamage } = card({
      actionName: "Magic Missile",
      activation: "action",
      attack: null,
      save: null,
      damage: [dart(3), dart(4), dart(2)],
      damageTotal: 9,
      crit: false,
      damageByTarget: [
        { targetId: FOE, targetName: "Goblin", parts: [dart(3), dart(4)], total: 7 },
        { targetId: OTHER, targetName: "Orc", parts: [dart(2)], total: 2 }
      ]
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply to Orc" }));
    expect(applyDamage).toHaveBeenCalledWith(OTHER, "Orc", OTHER);
    expect(screen.getByRole("button", { name: "Apply to Goblin" })).toBeTruthy();
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ActorDefinition, ActorDerivedSheet } from "@vtt/domain";

vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { ToastProvider } from "@vtt/ui";
import { FeaturesTab } from "./FeaturesTab";
import type { SheetActor } from "./sheet-model";

// SRD 5.2.1 Bard Features table: the Bardic Die is a d8 from level 5. The Features tab shows the class table's
// columns that no use counts, as the server reads them.

const BARD = { id: "60000000-0000-4000-8000-0000000000b1", name: "Ysolde", kind: "player-character", actionUses: {} };
const DEFINITION = { name: "Ysolde", actions: [], character: { classes: [], feats: [] } } as unknown as ActorDefinition;

const derived = (columns: ActorDerivedSheet["classColumns"]) =>
  ({ weaponMasteries: [], classColumns: columns }) as unknown as ActorDerivedSheet;

const mount = (columns: ActorDerivedSheet["classColumns"]) =>
  render(
    <ToastProvider>
      <FeaturesTab
        actor={BARD as unknown as SheetActor}
        role="player"
        definition={DEFINITION}
        extension={{}}
        derived={derived(columns)}
        pools={[]}
        serverActions={[]}
        onUse={() => {}}
      />
    </ToastProvider>
  );

describe("the class table on the Features tab", () => {
  it("shows a Bard 5's Bardic Die", () => {
    mount([{ classId: "bard", className: "Bard", id: "bardic-inspiration", name: "Bardic Die", value: "d8" }]);
    const table = within(screen.getByRole("region", { name: "Class table" }));
    expect(table.getByText("Bardic Die")).toBeTruthy();
    expect(table.getByText("d8")).toBeTruthy();
  });

  it("names the class of each column on a multiclass sheet", () => {
    mount([
      { classId: "rogue", className: "Rogue", id: "sneak-attack", name: "Sneak Attack", value: "3d6" },
      { classId: "barbarian", className: "Barbarian", id: "rage-damage", name: "Rage Damage", value: "+2" }
    ]);
    expect(screen.getByText("Rogue · Sneak Attack")).toBeTruthy();
    expect(screen.getByText("Barbarian · Rage Damage")).toBeTruthy();
  });

  it("is left out when the classes print no such column", () => {
    mount([]);
    expect(screen.queryByRole("region", { name: "Class table" })).toBeNull();
  });
});

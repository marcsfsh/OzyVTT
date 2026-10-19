import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PendingSave } from "@vtt/domain";

vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { SavePrompt } from "./SavePrompt";

// A spell's save whose outcome the server applies nothing of (Polymorph, Levitate) says on its card that the GM
// applies it, so the card never implies the engine did.

const SAVE: PendingSave = {
  id: "60000000-0000-4000-8000-000000000001",
  targetActorId: "10000000-0000-4000-8000-000000000002",
  ability: "wis",
  dc: 15,
  sourceActorId: "10000000-0000-4000-8000-000000000001",
  sourceName: "Ansel",
  actionName: "Polymorph",
  proposedDamage: 0,
  halfOnSuccess: false,
  conditionIds: [],
  saveBonus: 0,
  createdAt: 0
};

const mount = (save: PendingSave) =>
  render(<SavePrompt save={save} targetName="Borin" canDismiss onFeedback={() => {}} rollMode="manual" viewer="gm" />);

describe("a save card", () => {
  it("says the GM applies a save the server applies nothing of", () => {
    mount({ ...SAVE, gmApplies: true });
    expect(screen.getByText("The GM applies what this save does.")).toBeTruthy();
  });

  it("says nothing of the kind for a save the server applies", () => {
    mount(SAVE);
    expect(screen.queryByText("The GM applies what this save does.")).toBeNull();
  });
});

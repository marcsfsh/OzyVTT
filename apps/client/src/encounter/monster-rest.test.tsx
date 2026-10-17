import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { GmActor } from "@vtt/domain";

vi.mock("../socket", () => {
  const timed = { emit: vi.fn() };
  return { socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => timed } };
});

import { ToastProvider } from "@vtt/ui";
import { CharacterSheet } from "./CharacterSheet";

const DRAGON = {
  id: "20000000-0000-4000-8000-000000000001",
  name: "Young Red Dragon",
  kind: "monster",
  visibility: "public",
  hp: { current: 90, maximum: 178, temporary: 0 },
  ownerSessionId: null,
  presence: null,
  conditions: [],
  effects: [],
  deathSaves: null,
  actionUses: { "legendary-resistance": 2 },
  choiceOverrides: {},
  conditionImmunities: [],
  hitDice: { die: "d10", maximum: 17, remaining: 17, entries: [{ die: "d10", maximum: 17, remaining: 17 }] },
  lastLongRestAt: null,
  spellSlots: null,
  pactSlots: null,
  preparedSpellIds: [],
  inventory: [],
  currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  archived: false,
  sheetPreview: false
} as unknown as GmActor;

// SRD Monsters: Legendary Resistance and Per Day uses come back on a Long Rest, so the GM needs a rest control on a
// monster's sheet too.
describe("a monster's sheet", () => {
  it("gives the GM both rests and no Hit Dice to spend", () => {
    render(
      <ToastProvider>
        <CharacterSheet actor={DRAGON} role="gm" onClose={() => {}} />
      </ToastProvider>
    );
    const rest = screen.getByRole("group", { name: "Rest" });
    expect(within(rest).getByRole("button", { name: "Short Rest" })).toBeTruthy();
    expect(within(rest).getByRole("button", { name: "Long Rest" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Spend Hit Dice" })).toBeNull();
  });
});

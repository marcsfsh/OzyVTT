import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import type { ContentActionSummary } from "@vtt/domain";
import { ActionTargetPicker } from "./ActionTargetPicker";
import { beginTargeting, clearTargeting, useTargeting } from "./targeting";

const HERO = "70000000-0000-4000-8000-000000000001";
const ALLY = "70000000-0000-4000-8000-000000000002";

const builtin = (fields: Partial<ContentActionSummary>): ContentActionSummary => ({
  id: "help",
  name: "Help",
  activation: "action",
  description: "Distract an enemy within 5 feet of you.",
  attackBonus: null,
  reachFeet: null,
  rangeFeet: null,
  rangeNormalFeet: null,
  saveAbility: null,
  saveDc: null,
  damage: [],
  area: null,
  attackCount: null,
  usesLimit: null,
  usesPer: null,
  usesRecharge: null,
  usesPool: null,
  requiresEffectTag: null,
  multiattack: null,
  grants: true,
  reaction: null,
  builtin: true,
  targeting: "single",
  ...fields
});

function Picker() {
  const session = useTargeting();
  return session ? (
    <ActionTargetPicker picking={session} targets={[{ id: ALLY, label: "Bryn" }]} busy={false} onRoll={() => {}} />
  ) : null;
}

// The picker's button names what pressing it does, and Help rolls no dice.
describe("the action picker's button", () => {
  beforeEach(() => clearTargeting());

  it("says Use for an SRD action that rolls nothing", () => {
    act(() => beginTargeting(builtin({}), HERO));
    render(<Picker />);
    expect(screen.getByRole("button", { name: "Use Help" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Roll Help" })).toBeNull();
  });

  it("says Roll for an SRD action that makes a check", () => {
    act(() =>
      beginTargeting(
        builtin({
          id: "search",
          name: "Search",
          targeting: "none",
          checkSkills: [{ id: "perception", ability: "wis" }]
        }),
        HERO
      )
    );
    render(<Picker />);
    expect(screen.getByRole("button", { name: "Roll Search" })).toBeTruthy();
  });
});

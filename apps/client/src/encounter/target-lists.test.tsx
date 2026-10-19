import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { ContentActionSummary, ContentSpellSummary } from "@vtt/domain";
import { pickableTargets, type TargetRow } from "../table/targetRows";
import { ActionTargetPicker } from "./ActionTargetPicker";
import { beginTargeting, clearTargeting, useTargeting } from "./targeting";

// A target list offers what the action can reach and affect: a dead creature leaves the list of attacks, saves and
// damage (a heal, Spare the Dying and a revival keep it), and one beyond the action's reach stays listed with why.

const action = (fields: Partial<ContentActionSummary>): ContentActionSummary =>
  ({
    id: "spell-fire-bolt",
    name: "Fire Bolt",
    activation: "action",
    description: "",
    attackBonus: 5,
    reachFeet: null,
    rangeFeet: 120,
    rangeNormalFeet: null,
    saveAbility: null,
    saveDc: null,
    damage: [{ formula: "1d10", type: "fire" }],
    area: null,
    attackCount: null,
    usesLimit: null,
    usesPer: null,
    usesRecharge: null,
    usesPool: null,
    requiresEffectTag: null,
    multiattack: null,
    grants: false,
    reaction: null,
    ...fields
  }) as ContentActionSummary;
const FIRE_BOLT = action({});
const SPARE = action({
  id: "spell-spare-the-dying",
  name: "Spare the Dying",
  attackBonus: null,
  rangeFeet: null,
  damage: [],
  spellId: "spare-the-dying"
});
const SPARE_SPELL = { id: "spare-the-dying", rangeFeet: 15, rangeText: "15 feet" } as ContentSpellSummary;

const row = (id: string, label: string, extra: Partial<TargetRow> = {}): TargetRow => ({
  id,
  label,
  initials: label.slice(0, 2),
  kind: "monster",
  ...extra
});
const DEAD_GOBLIN = row("goblin-1", "Goblin 1", { down: true, feet: 10 });
const FAR_GOBLIN = row("goblin-2", "Goblin 2", { feet: 200 });
const DYING_ALLY = row("lyra", "Lyra", { kind: "player-character", down: true, feet: 5 });

describe("who a target list offers", () => {
  it("leaves a dead creature out of an attack's list and keeps it for Spare the Dying", () => {
    const rows = [DEAD_GOBLIN, FAR_GOBLIN, DYING_ALLY];
    expect(pickableTargets(rows, FIRE_BOLT).map((target) => target.id)).toEqual(["goblin-2", "lyra"]);
    expect(pickableTargets(rows, SPARE, SPARE_SPELL).map((target) => target.id)).toEqual([
      "goblin-1",
      "goblin-2",
      "lyra"
    ]);
  });

  it("says why a creature beyond the action's reach can't be picked", () => {
    const [far] = pickableTargets([FAR_GOBLIN], FIRE_BOLT);
    expect(far?.unavailable).toBe("Out of range: 200 ft away, the reach is 120 ft.");
    const [near] = pickableTargets([row("goblin-3", "Goblin 3", { feet: 30 })], FIRE_BOLT);
    expect(near?.unavailable).toBeUndefined();
  });
});

describe("the target picker", () => {
  afterEach(() => clearTargeting());

  function Picker({ targets }: Readonly<{ targets: TargetRow[] }>) {
    const picking = useTargeting();
    return picking ? <ActionTargetPicker picking={picking} targets={targets} busy={false} onRoll={() => {}} /> : null;
  }

  it("shows a creature out of reach disabled, with the reason", () => {
    act(() => beginTargeting(FIRE_BOLT, "10000000-0000-4000-8000-0000000000d1"));
    render(<Picker targets={pickableTargets([FAR_GOBLIN, row("goblin-3", "Goblin 3", { feet: 30 })], FIRE_BOLT)} />);
    const far = screen.getByRole("radio", { name: /Goblin 2/ }) as HTMLInputElement;
    expect(far.disabled).toBe(true);
    expect(screen.getByText("Out of range: 200 ft away, the reach is 120 ft.")).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Goblin 3/ }) as HTMLInputElement).disabled).toBe(false);
  });
});

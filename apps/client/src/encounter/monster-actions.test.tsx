import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ContentActionSummary, GmActor, GmView } from "@vtt/domain";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
vi.mock("../lib/command", () => ({
  command: (...args: unknown[]) => command(...args),
  // The spell list's text links its spells to cards, from a reference these tests don't load.
  read: async () => ({ ok: false })
}));
// The runner under the console reads the server; these tests are about the console's own controls.
vi.mock("./ActionRunner", () => ({ ActionRunner: () => null }));

import { ActingConsole } from "./ActingConsole";
import { GmActionList } from "./GmActionList";
import { actionSummaryParts, componentLabel } from "./action-summary";

const MONSTER = "10000000-0000-4000-8000-000000000007";
const HERO = "10000000-0000-4000-8000-000000000001";

const summary = (id: string, name: string, extra: Partial<Record<keyof ContentActionSummary, unknown>> = {}) =>
  ({
    id,
    name,
    activation: "action",
    description: `${name}.`,
    attackBonus: null,
    reachFeet: null,
    rangeFeet: null,
    attackCount: null,
    saveAbility: null,
    saveDc: null,
    damage: [],
    usesLimit: null,
    usesPer: null,
    usesPool: null,
    requiresEffectTag: null,
    multiattack: null,
    grants: false,
    reaction: null,
    ...extra
  }) as unknown as ContentActionSummary;

const monster = {
  id: MONSTER,
  name: "Lion",
  hp: { current: 22, maximum: 22 },
  effects: [],
  actionUses: {}
} as unknown as GmActor;

/** The GM's view: whose turn it is, the open action, and the legendary marks. */
const view = ({
  turnActorId = MONSTER,
  actionInstance = null,
  legendaryUsed = {}
}: {
  turnActorId?: string;
  actionInstance?: Record<string, unknown> | null;
  legendaryUsed?: Record<string, number>;
} = {}) =>
  ({
    revision: 4,
    combat: {
      turnActorId,
      initiative: [{ actorId: HERO }, { actorId: MONSTER }],
      legendaryUsed,
      reactionsUsed: [],
      turn: {
        actionUsed: actionInstance !== null,
        bonusActionUsed: false,
        actionInstance,
        bonusActionInstance: null,
        turnUses: {},
        movementUsedFeet: 0
      }
    }
  }) as unknown as GmView;

const hintOf = (name: string) =>
  screen.getByRole("button", { name: new RegExp(name) }).querySelector(".action-hint")?.textContent ?? null;

describe("a stat block's Multiattack as the GM reads it", () => {
  it("names the attacks that can fill a place, in the plan and in what is left of it", () => {
    const scimitar = summary("scimitar", "Scimitar");
    const shortbow = summary("shortbow", "Shortbow");
    const plan = summary("multiattack", "Multiattack", {
      multiattack: [{ actionId: "scimitar", count: 2, or: ["shortbow"] }]
    });
    expect(actionSummaryParts(plan, [scimitar, shortbow, plan])).toEqual(["2× Scimitar or Shortbow"]);
    expect(componentLabel({ "scimitar|shortbow": 1, claw: 0 }, [scimitar, shortbow])).toBe("1× Scimitar or Shortbow");
  });

  it("counts a shared place for either action, and leaves a replacement it has left open", () => {
    const rend = summary("rend", "Rend", { attackBonus: 5, damage: [{ formula: "1d8 + 3", type: "slashing" }] });
    const bite = summary("bite", "Bite", { attackBonus: 5, damage: [{ formula: "1d6 + 3", type: "piercing" }] });
    const roar = summary("roar", "Roar", { saveAbility: "wis", saveDc: 11 });
    render(
      <GmActionList
        state={view({
          actionInstance: {
            actorId: MONSTER,
            components: { "rend|bite": 1 },
            parentId: "multiattack",
            replacements: { roar: 1 }
          }
        })}
        actor={monster}
        actions={[rend, bite, roar]}
        busy={false}
        onUse={() => {}}
      />
    );
    expect(hintOf("Rend")).toBe("1 attack left");
    expect(hintOf("Bite")).toBe("1 attack left");
    expect(hintOf("Roar")).toBeNull();
  });
});

describe("legendary actions on the GM's console", () => {
  const dragon = {
    id: MONSTER,
    name: "Adult Red Dragon",
    hp: { current: 256, maximum: 256 },
    effects: [],
    actionUses: {},
    legendary: { actionsPerRound: 3 }
  } as unknown as GmActor;
  const hero = {
    id: HERO,
    name: "Torva",
    hp: { current: 40, maximum: 40 },
    effects: [],
    actionUses: {}
  } as unknown as GmActor;
  const presence = summary("commanding-presence", "Commanding Presence", {
    activation: "other",
    legendaryCost: 1,
    legendaryOncePerRound: true
  });

  it("offers a legendary action with nothing to roll as a tap, and says when it can't be taken again", () => {
    const onUse = vi.fn();
    const { rerender } = render(
      <GmActionList
        state={view({ turnActorId: HERO })}
        actor={dragon}
        actions={[presence]}
        busy={false}
        onUse={onUse}
      />
    );
    const row = screen.getByRole("button", { name: /Commanding Presence/ });
    expect(row.textContent).toContain("Legendary, once a round");
    fireEvent.click(row);
    expect(onUse).toHaveBeenCalledWith(presence, true);
    rerender(
      <GmActionList
        state={view({ turnActorId: HERO, legendaryUsed: { [MONSTER]: 1, [`${MONSTER}:commanding-presence`]: 1 } })}
        actor={dragon}
        actions={[presence]}
        busy={false}
        onUse={onUse}
      />
    );
    expect(hintOf("Commanding Presence")).toBe("Not again until its next turn");
  });

  it("spends one from the pool by hand for a legendary action run at the table", async () => {
    command.mockClear();
    const run = vi.fn(async (operation: () => Promise<unknown>) => {
      await operation();
    });
    render(
      <ActingConsole
        state={view({ turnActorId: HERO, legendaryUsed: { [MONSTER]: 1 } })}
        actorsById={
          new Map([
            [MONSTER, dragon],
            [HERO, hero]
          ])
        }
        busy={false}
        run={run as never}
        onFeedback={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Adult Red Dragon 2\/3/ }));
    fireEvent.click(screen.getByRole("button", { name: "−1" }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("turn:use-legendary", { actorId: MONSTER, spent: 2, expectedRevision: 4 })
    );
  });
});

describe("a stat block's spell list", () => {
  const mage = {
    id: MONSTER,
    name: "Mage",
    hp: { current: 81, maximum: 81 },
    effects: [],
    actionUses: { "spellcasting-cone-of-cold": 1 }
  } as unknown as GmActor;
  const list = summary("spellcasting", "Spellcasting", {
    description:
      "The mage casts one of the following spells.\n\n- **At Will:** Detect Magic\n- **2/Day Each:** Fireball",
    spellList: { ability: "int", saveDc: 14, attackBonus: 6 }
  });
  const fireball = summary("spellcasting-fireball", "Fireball", {
    castFrom: "spellcasting",
    saveAbility: "dex",
    saveDc: 14,
    damage: [{ formula: "8d6", type: "fire" }],
    usesLimit: 2,
    usesPer: "long-rest",
    area: { shape: "sphere", sizeFeet: 20, widthFeet: null }
  });
  const coneOfCold = summary("spellcasting-cone-of-cold", "Cone of Cold", {
    castFrom: "spellcasting",
    saveAbility: "con",
    saveDc: 14,
    damage: [{ formula: "8d8", type: "cold" }],
    usesLimit: 1,
    usesPer: "long-rest"
  });
  const detectMagic = summary("spellcasting-detect-magic", "Detect Magic", { castFrom: "spellcasting" });
  const staff = summary("arcane-burst", "Arcane Burst", {
    attackBonus: 6,
    damage: [{ formula: "3d8", type: "force" }]
  });

  it("heads its casts with the list's numbers, each spell a tap, the spent ones saying so", () => {
    const onUse = vi.fn();
    render(
      <GmActionList
        state={view()}
        actor={mage}
        actions={[staff, list, detectMagic, fireball, coneOfCold]}
        busy={false}
        onUse={onUse}
      />
    );
    const group = screen.getByRole("group", { name: "Spellcasting" });
    expect(group.textContent).toContain("DC 14 · +6 to hit · Intelligence · Magic action");
    // The list is a heading and no row; its spells are rows under it, and Arcane Burst stays with the other actions.
    expect(screen.queryByRole("button", { name: /^Spellcasting/ })).toBeNull();
    const row = screen.getByRole("button", { name: /Fireball/ });
    expect(group.contains(row)).toBe(true);
    expect(row.textContent).toContain("DC 14 DEX save");
    expect(row.textContent).toContain("2/Long Rest");
    expect(group.contains(screen.getByRole("button", { name: /Arcane Burst/ }))).toBe(false);
    expect(hintOf("Cone of Cold")).toBe("No uses left");
    expect(group.textContent).toContain("Nothing to roll: Detect Magic");
    fireEvent.click(row);
    expect(onUse).toHaveBeenCalledWith(fireball, false);
  });
});

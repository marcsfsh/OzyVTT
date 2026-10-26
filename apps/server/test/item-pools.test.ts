import { describe, expect, it } from "vitest";
import { rollStartingCharges } from "../src/item-charges.js";
import { answerSave } from "../src/saving-throws.js";
import {
  actionOf,
  catalog,
  catalogRow,
  fight,
  fighterInput,
  IDS,
  resolveAt,
  tableOf,
  wizardInput,
  write,
  type Table
} from "./equipment-table.js";

// SRD 5.2.1 item pools beyond one count of charges: a Luck Blade's Wish from charges that never come back and once a
// dawn, a Nine Lives Stealer's charges spent one a creature slain, and a Helm of Brilliance's four kinds of gem.

const GM = { role: "gm" } as const;
let sequence = 0;
const nextId = () => `62000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const NOW = () => "2026-10-19T00:00:00.000Z";

/** Answers the first save the creature owes with this total. */
function answerAs(table: Table, actorId: string, total: number) {
  const pending = table.state.combat.pendingSaves.find((save) => save.targetActorId === actorId);
  if (!pending) throw new Error(`no save owed by ${actorId}`);
  return answerSave(table.state, nextId(), pending.id, "manual", total, true, GM, {
    random: () => 10,
    newRollId: nextId,
    sessionId: IDS.gmSession,
    role: "gm",
    now: NOW,
    resolveDefinition: table.resolve,
    catalog
  });
}

describe("Luck Blade", () => {
  it("casts Wish from its charges once a dawn", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("luck-blade", { attuned: true, baseId: "longsword" }), "gm");
    expect(actionOf(table, IDS.wizard, "item-luck-blade-cast-wish")).toMatchObject({
      uses: { limit: 3, per: "never", pool: "luck-blade-wish" },
      alsoUses: { limit: 1, pool: "luck-blade-wish-dawn" }
    });
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-luck-blade-cast-wish", [], { targetIds: [] });
    expect(table.actor(IDS.wizard).actionUses).toMatchObject({ "luck-blade-wish": 1, "luck-blade-wish-dawn": 1 });
    table.state.combat.turn = { ...table.state.combat.turn, actionUsed: false, actionInstance: null };
    expect(() => resolveAt(table, IDS.wizard, "item-luck-blade-cast-wish", [], { targetIds: [] })).toThrow(
      /can't be used again until a Long Rest/
    );
  });
});

describe("Nine Lives Stealer", () => {
  it("spends a charge on each creature it slays, and slays no more with none left", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("nine-lives-stealer", { attuned: true, baseId: "longsword" }), "gm");
    table.actor(IDS.fighter).actionUses = { "nine-lives-stealer-charges": 8 };
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-nine-lives-stealer", [20, 4, 4, 4, 4, 4, 4]);
    const owed = table.state.combat.pendingSaves.find((save) => save.targetActorId === IDS.foe);
    expect(owed?.spendsOnKill).toEqual({ actorId: IDS.fighter, key: "nine-lives-stealer-charges" });
    expect(table.actor(IDS.fighter).actionUses["nine-lives-stealer-charges"]).toBe(8);
    answerAs(table, IDS.foe, 1);
    expect(table.actor(IDS.fighter).actionUses["nine-lives-stealer-charges"]).toBe(9);

    const spent = tableOf({ [IDS.fighter]: fighterInput() });
    write(spent, IDS.fighter, catalogRow("nine-lives-stealer", { attuned: true, baseId: "longsword" }), "gm");
    spent.actor(IDS.fighter).actionUses = { "nine-lives-stealer-charges": 9 };
    fight(spent, IDS.fighter);
    const hit = resolveAt(spent, IDS.fighter, "item-nine-lives-stealer", [20, 4, 4, 4, 4, 4, 4]);
    expect(hit.warnings?.join(" ")).toContain("has no charges left to slay with");
    expect(spent.state.combat.pendingSaves.some((save) => save.targetActorId === IDS.foe)).toBe(false);
  });
});

describe("Helm of Brilliance", () => {
  it("counts each kind of gem when it is added, and each spell spends one of its kind", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("helm-of-brilliance", { attuned: true }), "gm");
    const actor = table.actor(IDS.wizard);
    const helm = actor.inventory.find((row) => row.id === "helm-of-brilliance")!;
    // Every die shows 1: one diamond, two rubies, three fire opals, four opals.
    rollStartingCharges(actor, helm, table.definition(IDS.wizard), catalog, () => 1);
    expect(actor.actionUses).toMatchObject({
      "helm-of-brilliance-diamonds": 9,
      "helm-of-brilliance-rubies": 18,
      "helm-of-brilliance-fire-opals": 27,
      "helm-of-brilliance-opals": 36
    });
    expect(actionOf(table, IDS.wizard, "item-helm-of-brilliance-cast-fireball")).toMatchObject({
      save: { dc: 18 },
      uses: { limit: 30, per: "never", pool: "helm-of-brilliance-fire-opals" }
    });
  });
});

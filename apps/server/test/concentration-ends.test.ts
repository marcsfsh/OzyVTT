import { describe, expect, it } from "vitest";
import { endEffect } from "../src/effects.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { FOE, FOE2, HERO } from "./spell-casters.js";
import { actorOf, answer, cast, caster, effectNames } from "./spell-lifetimes-kit.js";

// SRD 5.2.1: a spell ends when nothing is left of it. Hold Person on a creature that saves leaves nothing for the caster
// to concentrate on; Phantasmal Killer "On a successful save, the target takes half as much damage, and the spell
// ends"; a spell whose only creature dies or is freed is over. A spell with an area of its own lasts on.

const concentrating = (state: Parameters<typeof actorOf>[0]) =>
  actorOf(state, HERO)
    .effects.filter((effect) => effect.tags.includes("concentrating"))
    .map((effect) => effect.name);

describe("Concentration on nothing ends", () => {
  it("ends Hold Person at once when its only target saves, and tells the table", () => {
    const table = caster();
    cast(table, "hold-person", { targetIds: [FOE] });
    expect(concentrating(table.state)).toEqual(["Concentrating on Hold Person"]);
    const { events } = answer(table.state, FOE, 19);
    expect(concentrating(table.state)).toEqual([]);
    expect(events.map((event) => event.text)).toContain(
      "Hold Person has no creature left under it, so Ansel's Concentration on it ends."
    );
  });

  it("holds while one of two targets is held, and ends when its repeat save frees it", () => {
    const table = caster();
    cast(table, "hold-person", { targetIds: [FOE, FOE2], slotLevel: 3 });
    answer(table.state, FOE, 19);
    expect(concentrating(table.state)).toEqual(["Concentrating on Hold Person"]);
    answer(table.state, FOE2, 2);
    expect(concentrating(table.state)).toEqual(["Concentrating on Hold Person"]);
    // The held orc repeats the save as its turn ends, and succeeds.
    nextInitiativeTurn(table.state);
    nextInitiativeTurn(table.state);
    nextInitiativeTurn(table.state, [], {
      rollDie: () => 3,
      resolveDefinition: () => undefined,
      newId: () => crypto.randomUUID(),
      now: () => "2026-10-18T00:00:00.000Z"
    });
    answer(table.state, FOE2, 19);
    expect(actorOf(table.state, FOE2).conditions).toEqual([]);
    expect(concentrating(table.state)).toEqual([]);
  });

  it("ends when the only creature under the spell dies", () => {
    const table = caster();
    cast(table, "hold-person", { targetIds: [FOE] });
    answer(table.state, FOE, 2);
    const { events } = applyDamageDetailed(table.state, FOE, { amount: 500 }, { role: "gm" });
    expect(concentrating(table.state)).toEqual([]);
    expect(events.map((event) => event.text)).toContain(
      "Hold Person has no creature left under it, so Ansel's Concentration on it ends."
    );
  });

  it("ends when the effect on its only creature is ended another way", () => {
    const table = caster();
    cast(table, "haste", { targetIds: [FOE] });
    const haste = actorOf(table.state, FOE).effects[0]!;
    endEffect(table.state, FOE, haste.id);
    expect(concentrating(table.state)).toEqual([]);
  });

  it("ends Phantasmal Killer on a successful first save, and on a later repeat save's success", () => {
    const saved = caster();
    cast(saved, "phantasmal-killer", {}, [5, 5, 5, 5]);
    answer(saved.state, FOE, 19);
    expect(concentrating(saved.state)).toEqual([]);

    const failed = caster();
    cast(failed, "phantasmal-killer", {}, [5, 5, 5, 5]);
    answer(failed.state, FOE, 2);
    const nightmare = actorOf(failed.state, FOE).effects[0]!;
    expect(nightmare).toMatchObject({ name: "Phantasmal Killer", repeatSave: { ability: "wis", dc: 15 } });
    expect(nightmare.modifiers).toEqual([
      { type: "roll-mode", roll: "attack", mode: "disadvantage" },
      { type: "roll-mode", roll: "check", mode: "disadvantage" }
    ]);
    endEffect(failed.state, FOE, nightmare.id);
    expect(concentrating(failed.state)).toEqual([]);
  });

  it("keeps a spell with an area of its own up when no creature is in it", () => {
    const table = caster();
    cast(table, "spirit-guardians", { targetIds: [] });
    expect(concentrating(table.state)).toEqual(["Concentrating on Spirit Guardians"]);
    applyDamageDetailed(table.state, FOE, { amount: 500 }, { role: "gm" });
    expect(concentrating(table.state)).toEqual(["Concentrating on Spirit Guardians"]);
    expect(effectNames(table.state, HERO)).toEqual(["Concentrating on Spirit Guardians"]);
  });
});

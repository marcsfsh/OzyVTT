import { describe, expect, it } from "vitest";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { effectiveActions } from "../src/effective-actions.js";
import { endEncounter } from "../src/encounter.js";
import { applyRest } from "../src/rests.js";
import { finishPreparing, openPreparation, setPreparedSpell } from "../src/spellcasting.js";
import { spendLooseUses } from "../src/tap-routing.js";
import { build, catalog, clericInput, fight, HERO, wizardInput, WIZARD_SPELLS } from "./spell-casters.js";

// SRD 5.2.1 Spells: a caster casts the level 1+ spells it has prepared, and a Cleric, Druid or Wizard changes that list
// when it finishes a Long Rest (a Paladin or Ranger swaps one), within its prepared cap.

const wizard = build(wizardInput(WIZARD_SPELLS));
const resolveDefinition = () => wizard;
const cleric = build(clericInput(["detect-magic", "cure-wounds"]));

describe("casting a spell that isn't prepared", () => {
  it("is refused while the table polices spellcasting, and advised otherwise", () => {
    const { state, resolve, hero } = fight(wizard);
    hero.preparedSpellIds = hero.preparedSpellIds.filter((id) => id !== "fireball");
    state.combat = { ...state.combat, rulesMode: "assisted" };
    expect(resolve("spell-fireball", {}).warnings?.join(" ")).toMatch(/hasn't prepared Fireball/);
    // The dial starts on Enforce, and slots follow it.
    const strict = fight(wizard);
    strict.hero.preparedSpellIds = strict.hero.preparedSpellIds.filter((id) => id !== "fireball");
    expect(() => strict.resolve("spell-fireball", {})).toThrowError(/hasn't prepared Fireball/);
    expect(state.combat.turn.actionUsed).toBe(true);
  });
});

describe("the prepare step a Long Rest opens", () => {
  it("keeps the list a player chose, and opens the step for a Wizard", () => {
    const { state, hero } = fight(wizard, { combat: false });
    setPreparedSpell(state, HERO, "fireball", false, resolveDefinition);
    applyRest(state, HERO, "long", resolveDefinition, catalog);
    expect(hero.preparedSpellIds).not.toContain("fireball");
    expect(hero.preparation).toEqual({ changesLeft: null });
  });

  it("lets a player change the list only in the step, within the prepared cap, and not mid-fight", () => {
    const { state, hero } = fight(wizard, { combat: false });
    expect(() => setPreparedSpell(state, HERO, "fireball", false, resolveDefinition, "player")).toThrowError(
      /when you finish a Long Rest/
    );
    openPreparation(hero, wizard);
    setPreparedSpell(state, HERO, "fireball", false, resolveDefinition, "player");
    setPreparedSpell(state, HERO, "fireball", true, resolveDefinition, "player");
    // The build's own list is full: another spell needs one out first.
    const extra = { ...wizard, spellcasting: { ...wizard.spellcasting!, spells: [...wizard.spellcasting!.spells] } };
    extra.spellcasting.spells.push({
      id: "fly",
      name: "Fly",
      level: 3,
      prepared: false,
      alwaysPrepared: false,
      classId: "wizard"
    });
    expect(() => setPreparedSpell(state, HERO, "fly", true, () => extra, "player")).toThrowError(
      /can prepare \d+ spells\. Unprepare one first/
    );
    finishPreparing(state, HERO);
    expect(() => setPreparedSpell(state, HERO, "fireball", false, resolveDefinition, "player")).toThrowError(
      /when you finish a Long Rest/
    );
  });

  it("is refused mid-fight", () => {
    const { state, hero } = fight(wizard);
    openPreparation(hero, wizard);
    expect(() => setPreparedSpell(state, HERO, "fireball", false, resolveDefinition, "player")).toThrowError(
      /outside a fight/
    );
    endEncounter(state);
  });

  it("lets a Paladin swap in one spell, and opens nothing for a Sorcerer", () => {
    const sheet = (classId: string) =>
      ActorDefinitionSchema.parse({
        ...wizard,
        spellcasting: { ...wizard.spellcasting!, classes: [{ classId, ability: "cha", prepared: 4 }] }
      });
    const { hero } = fight(wizard, { combat: false });
    openPreparation(hero, sheet("paladin"));
    expect(hero.preparation).toEqual({ changesLeft: 1 });
    hero.preparation = null;
    openPreparation(hero, sheet("sorcerer"));
    expect(hero.preparation).toBeNull();
  });
});

describe("casting a spell as a Ritual (SRD Rituals)", () => {
  it("spends no slot, takes the Magic action each turn, and needs the spell prepared", () => {
    const { hero, action } = fight(wizard, { combat: false });
    const ritual = action("spell-alarm-ritual");
    expect(ritual).toMatchObject({ name: "Alarm (ritual)", activation: "action", spellId: "alarm" });
    expect(ritual.spellSlot).toBeUndefined();
    expect(wizard.spellcasting!.spells.find((spell) => spell.id === "alarm")!.ritualActionId).toBe(
      "spell-alarm-ritual"
    );
    const before = JSON.stringify(hero.spellSlots);
    expect(spendLooseUses(hero, ritual, [], undefined, "strict", wizard)).toEqual({ usesLeft: null, spent: false });
    expect(JSON.stringify(hero.spellSlots)).toBe(before);
  });

  it("lets a Wizard cast a spellbook Ritual unprepared, read from the book (Ritual Adept)", () => {
    const { hero, state, action, resolve } = fight(wizard, { combat: false });
    setPreparedSpell(state, HERO, "alarm", false, resolveDefinition);
    expect(hero.preparedSpellIds).not.toContain("alarm");
    expect(hero.inventory.some((item) => item.id === "spellbook")).toBe(true);
    expect(spendLooseUses(hero, action("spell-alarm-ritual"), [], undefined, "strict", wizard)).toEqual({
      usesLeft: null,
      spent: false
    });
    expect(resolve("spell-alarm-ritual", { targetIds: [] }).actionName).toBe("Alarm (ritual)");
    // "You must read from the book to cast a spell in this way."
    hero.inventory = hero.inventory.filter((item) => item.id !== "spellbook");
    expect(() => resolve("spell-alarm-ritual", { targetIds: [] })).toThrowError(
      "Ansel hasn't prepared Alarm, and casting it as a Ritual unprepared needs the spellbook to read from."
    );
  });

  it("gives a ritual recorded in the book beyond the sheet a Ritual cast, while the book is carried", () => {
    const { hero, resolve } = fight(wizard, { combat: false });
    hero.spellbook = [{ id: "detect-magic", copied: true }];
    expect(
      effectiveActions(wizard, hero, catalog).find((entry) => entry.id === "spell-detect-magic-ritual")
    ).toMatchObject({
      name: "Detect Magic (ritual)",
      spellId: "detect-magic"
    });
    expect(resolve("spell-detect-magic-ritual", { targetIds: [] }).actionName).toBe("Detect Magic (ritual)");
    expect(hero.effects.some((effect) => effect.concentration && effect.name.includes("Detect Magic"))).toBe(true);
    hero.inventory = hero.inventory.filter((item) => item.id !== "spellbook");
    expect(effectiveActions(wizard, hero, catalog).some((entry) => entry.id === "spell-detect-magic-ritual")).toBe(
      false
    );
  });

  it("needs the spell prepared for a caster without Ritual Adept", () => {
    const { hero, state, action } = fight(cleric, { combat: false });
    setPreparedSpell(state, HERO, "detect-magic", false, () => cleric);
    expect(() =>
      spendLooseUses(hero, action("spell-detect-magic-ritual"), [], undefined, "strict", cleric)
    ).toThrowError(/hasn't prepared Detect Magic/);
  });
});

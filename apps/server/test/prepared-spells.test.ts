import { describe, expect, it } from "vitest";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { endEncounter } from "../src/encounter.js";
import { applyRest } from "../src/rests.js";
import { finishPreparing, openPreparation, setPreparedSpell } from "../src/spellcasting.js";
import { spendLooseUses } from "../src/tap-routing.js";
import { build, catalog, fight, HERO, wizardInput, WIZARD_SPELLS } from "./spell-casters.js";

// SRD 5.2.1 Spells: a caster casts the level 1+ spells it has prepared, and a Cleric, Druid or Wizard changes that list
// when it finishes a Long Rest (a Paladin or Ranger swaps one), within its prepared cap.

const wizard = build(wizardInput(WIZARD_SPELLS));
const resolveDefinition = () => wizard;

describe("casting a spell that isn't prepared", () => {
  it("is refused while the table polices spellcasting, and advised otherwise", () => {
    const { state, resolve, hero } = fight(wizard);
    hero.preparedSpellIds = hero.preparedSpellIds.filter((id) => id !== "fireball");
    expect(resolve("spell-fireball", {}).warnings?.join(" ")).toMatch(/hasn't prepared Fireball/);
    const strict = fight(wizard);
    strict.hero.preparedSpellIds = strict.hero.preparedSpellIds.filter((id) => id !== "fireball");
    strict.state.combat = { ...strict.state.combat, ruleExceptions: { slots: "strict" } };
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
      /can prepare \d+ spells - unprepare one first/
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
      /not in a fight/
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
    const { hero, state, action } = fight(wizard, { combat: false });
    const ritual = action("spell-alarm-ritual");
    expect(ritual).toMatchObject({ name: "Alarm (ritual)", activation: "action", spellId: "alarm" });
    expect(ritual.spellSlot).toBeUndefined();
    expect(wizard.spellcasting!.spells.find((spell) => spell.id === "alarm")!.ritualActionId).toBe(
      "spell-alarm-ritual"
    );
    const before = JSON.stringify(hero.spellSlots);
    expect(spendLooseUses(hero, ritual, [], undefined, "strict", wizard)).toEqual({ usesLeft: null, spent: false });
    expect(JSON.stringify(hero.spellSlots)).toBe(before);
    setPreparedSpell(state, HERO, "alarm", false, resolveDefinition);
    expect(() => spendLooseUses(hero, ritual, [], undefined, "strict", wizard)).toThrowError(/hasn't prepared Alarm/);
  });
});

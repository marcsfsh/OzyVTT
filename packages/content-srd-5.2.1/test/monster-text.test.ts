import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions } from "../src/index.js";
import { printedName, statBlockActionText, statBlockTraitText } from "../scripts/monster-text.js";

// Every stat block reads as SRD 5.2.1 prints it: the transcription's link tags, run-together words and stray spell
// lists are cleaned, and an action printed for some forms only keeps its limit in its name.

const monsters = loadMonsterDefinitions();
const byName = (name: string) => monsters.find((monster) => monster.name === name)!;
const actionNamed = (monster: string, id: string) => byName(monster).actions.find((action) => action.id === id)!;
type Bag = { traits: Array<{ name: string; description: string }> };
const traitsOf = (monster: string) => (byName(monster).extensions["open5e.srd-2024"] as Bag).traits;
const everyText = monsters.flatMap((monster) => [
  ...monster.actions.map((action) => ({ where: `${monster.name}: ${action.name}`, text: action.description })),
  ...(monster.extensions["open5e.srd-2024"] as Bag).traits.map((trait) => ({
    where: `${monster.name}: ${trait.name}`,
    text: trait.description
  }))
]);

describe("a stat block's printed words", () => {
  it("keeps an area's shape once where a link tag repeated it", () => {
    expect(
      statBlockActionText("x", "each creature in a 20-foot-radius Sphere [Area of Effect]|XPHB|Sphere centered")
    ).toBe("each creature in a 20-foot-radius Sphere centered");
    const doubled = everyText.filter(({ text }) => /\b(Sphere|Cylinder|Cube|Cone|Line|Emanation) \1\b/.test(text));
    expect(doubled.map(({ where }) => where)).toEqual([]);
  });

  it("keeps the words a named link tag shows, so a curse reads whole", () => {
    expect(statBlockTraitText("a Short Rest|XPHB|Short or Long Rest.")).toBe("a Short or Long Rest.");
    expect(actionNamed("Rakshasa", "cursed-touch").description).toContain(
      "While cursed, the target gains no benefit from finishing a Short or Long Rest."
    );
    expect(actionNamed("Behir", "swallow").description).toContain(
      "has the Blinded and Restrained conditions, has Total Cover against attacks"
    );
    expect(everyText.filter(({ text }) => text.includes("|XPHB|")).map(({ where }) => where)).toEqual([]);
  });

  it("mends the words the transcription ran together", () => {
    expect(actionNamed("Ice Devil", "ice-spear").description).toContain(
      "Hit or Miss: The spear magically returns to the devil's hand"
    );
    expect(traitsOf("Fire Elemental").find((trait) => trait.name === "Fire Aura")!.description).toMatch(
      /in the Emanation start burning\.$/
    );
    expect(everyText.filter(({ text }) => /\bHit(?:om|azard)/.test(text)).map(({ where }) => where)).toEqual([]);
  });

  it("prints spell lists only in a Spellcasting entry, with no empty list line", () => {
    expect(actionNamed("Imp", "invisibility").description).toBe(
      "The imp casts Invisibility on itself, requiring no spell components and using Charisma as the spellcasting ability."
    );
    expect(actionNamed("Oni", "spellcasting").description).toMatch(
      /\(spell save DC 13\):\n\n- \*\*1\/Day Each:\*\* Charm Person, Darkness, Gaseous Form, Sleep$/
    );
    const stray = monsters.flatMap((monster) =>
      monster.actions
        .filter((action) => action.id !== "spellcasting" && /^- \*\*(?:At Will|\d\/Day)/m.test(action.description))
        .map((action) => `${monster.name}: ${action.name}`)
    );
    expect(stray).toEqual([]);
    const empty = monsters.filter((monster) =>
      monster.actions.some((action) => /^- \*\*[^*]+:\*\*\s*$/m.test(action.description))
    );
    expect(empty.map((monster) => monster.name)).toEqual([]);
  });

  it("names an action printed for some forms only with its limit", () => {
    expect(printedName("werewolf", "Bite")).toBe("Bite (Wolf or Hybrid Form Only)");
    expect(printedName("wererat", "Bite ")).toBe("Bite (Rat or Hybrid Form Only)");
    expect(actionNamed("Vampire", "bite-bat-or-vampire-form-only").name).toBe("Bite (Bat or Vampire Form Only)");
    expect(actionNamed("Werebear", "handaxe").name).toBe("Handaxe (Humanoid or Hybrid Form Only)");
    expect(actionNamed("Erinyes", "entangling-rope").name).toBe("Entangling Rope (Requires Magic Rope)");
    const untrimmed = monsters.flatMap((monster) =>
      monster.actions
        .filter((action) => action.name !== action.name.trim())
        .map((action) => `${monster.name}: ${action.name}`)
    );
    expect(untrimmed).toEqual([]);
  });
});

describe("a stat block's header and Gear", () => {
  const bag = (name: string) => byName(name).extensions["open5e.srd-2024"] as Record<string, unknown>;

  it("prints the tags after a creature's type and the sizes an NPC may be", () => {
    expect(bag("Balor").typeTags).toEqual(["Demon"]);
    expect(bag("Adult Red Dragon").typeTags).toEqual(["Chromatic"]);
    expect(bag("Mage")).toMatchObject({ sizes: ["medium", "small"], typeTags: ["Wizard"] });
    expect(bag("Ogre").typeTags).toBeUndefined();
  });

  it("names a swarm's creatures", () => {
    expect(bag("Swarm of Rats").swarm).toEqual({ size: "tiny", of: "Beasts" });
    expect(bag("Swarm of Crawling Claws").swarm).toEqual({ size: "tiny", of: "Undead" });
  });

  it("prints an NPC's Gear", () => {
    expect(bag("Knight").gear).toBe("Greatsword, Heavy Crossbow, Plate Armor");
    expect(bag("Spy").gear).toBe("Hand Crossbow, Shortsword, Thieves' Tools");
    expect(bag("Goblin Boss").gear).toBe("Chain Shirt, Scimitar, Shield, Shortbow");
  });

  it("carries the lair's legendary counts where the stat block prints a lair", () => {
    expect(byName("Adult Red Dragon").legendary).toEqual({
      actionsPerRound: 3,
      resistancesPerDay: 3,
      actionsInLair: 4,
      resistancesInLair: 4
    });
    expect(byName("Lich").legendary).toMatchObject({ resistancesPerDay: 4, resistancesInLair: 5, actionsInLair: 4 });
    expect(byName("Tarrasque").legendary).toEqual({ actionsPerRound: 3, resistancesPerDay: 6 });
    const lairs = monsters.filter((monster) => monster.legendary?.actionsInLair !== undefined);
    expect(lairs).toHaveLength(27);
  });
});

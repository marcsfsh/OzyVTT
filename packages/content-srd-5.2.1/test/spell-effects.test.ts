import { describe, expect, it } from "vitest";
import { loadSpells } from "../src/index.js";
import { healingOfText, spellEffectFromColumns } from "../src/spell-effect.js";
import { SPELL_EFFECT_REVIEWED_IDS } from "../scripts/spell-effects.js";

const effectOf = (id: string) => loadSpells().find((spell) => spell.id === id)!.effect;

describe("what one cast of an SRD spell does", () => {
  it("heals, and deals no damage, where the text restores hit points", () => {
    expect(effectOf("cure-wounds")).toEqual({
      attacks: 0,
      damage: [],
      targets: { count: 1 },
      healing: { formula: "2d8", addsModifier: true }
    });
    expect(effectOf("heal")!.healing).toEqual({ formula: "70", addsModifier: false });
    expect(effectOf("regenerate")!.healing).toEqual({ formula: "4d8 + 15", addsModifier: false });
  });

  it("deals the whole cast's damage, and none the text only threatens", () => {
    // Magic Missile's damage is per dart, each one assigned to its own target.
    expect(effectOf("magic-missile")!.damage).toEqual([{ formula: "1d4 + 1", type: "force" }]);
    expect(effectOf("magic-missile")!.darts).toBe(3);
    expect(effectOf("flame-strike")!.damage).toEqual([
      { formula: "5d6", type: "fire" },
      { formula: "5d6", type: "radiant" }
    ]);
    expect(effectOf("fireball")!.damage).toEqual([{ formula: "8d6", type: "fire" }]);
    for (const id of ["web", "hex", "hunters-mark", "spirit-guardians"]) expect(effectOf(id)!.damage, id).toEqual([]);
  });

  it("attacks only where the caster makes the spell attack", () => {
    expect(effectOf("fire-bolt")!.attacks).toBe(1);
    expect(effectOf("scorching-ray")!.attacks).toBe(3);
    expect(effectOf("bless")!.attackRange).toBeUndefined();
    for (const id of ["faerie-fire", "protection-from-evil-and-good", "ray-of-enfeeblement", "bless"])
      expect(effectOf(id)!.attacks, id).toBe(0);
  });

  it("says how far each spell attack reaches: a ranged one to the spell's range, a melee one 5 feet", () => {
    expect(effectOf("fire-bolt")!.attackRange).toEqual({ kind: "ranged", feet: 120 });
    expect(effectOf("scorching-ray")!.attackRange).toEqual({ kind: "ranged", feet: 120 });
    expect(effectOf("shocking-grasp")!.attackRange).toEqual({ kind: "melee", feet: 5 });
    // A Self spell's touch; a summoned weapon strikes 5 feet past where it appears.
    expect(effectOf("vampiric-touch")!.attackRange).toEqual({ kind: "melee", feet: 5 });
    expect(effectOf("spiritual-weapon")!.attackRange).toEqual({ kind: "melee", feet: 65 });
    // Produce Flame's cast makes no attack; its hurl, "until the spell ends", reaches 60 feet.
    expect(effectOf("produce-flame")!.attacks).toBe(0);
    expect(effectOf("produce-flame")!.laterActions?.[0]?.attackRange).toEqual({ kind: "ranged", feet: 60 });
  });

  it("waits for a later turn only where the text says so", () => {
    const waiting = loadSpells()
      .filter((spell) => spell.effect?.laterActions?.some((row) => row.laterTurnsOnly))
      .map((spell) => spell.id);
    expect(waiting).toEqual([
      "animal-shapes",
      "arcane-sword",
      "conjure-fey",
      "heat-metal",
      "hex",
      "moonbeam",
      "spiritual-weapon"
    ]);
    // "Until the spell ends, you can take a Magic action": the turn of the cast too.
    expect(effectOf("produce-flame")!.laterActions?.[0]?.laterTurnsOnly).toBeUndefined();
  });

  it("declares the reactions the table can offer, and none it can't see the trigger of", () => {
    expect(effectOf("shield")!.reaction).toEqual({
      trigger: "hit-by-attack",
      response: "ac-bonus",
      amount: 5,
      untilNextTurn: true
    });
    expect(effectOf("hellish-rebuke")!.reaction).toEqual({
      trigger: "damaged-by-creature",
      response: "strike-back",
      rangeFeet: 60
    });
    // Feather Fall answers a fall, which the server sees (`falling.ts`).
    expect(effectOf("feather-fall")!.reaction).toEqual({ trigger: "falls", response: "cast-on-faller", rangeFeet: 60 });
    // "When you see a creature within 60 feet of yourself casting a spell": the cast waits on the answer.
    expect(effectOf("counterspell")!.reaction).toEqual({
      trigger: "casts-spell",
      response: "counter",
      ability: "con",
      rangeFeet: 60
    });
  });

  it("deals the damage of a spell that harms as it appears (2024 wording)", () => {
    const appearing: Record<string, string> = {
      "black-tentacles": "3d6 bludgeoning",
      "blade-barrier": "6d10 force",
      cloudkill: "5d8 poison",
      "incendiary-cloud": "10d8 fire",
      "insect-plague": "4d10 piercing",
      "storm-of-vengeance": "2d6 thunder",
      tsunami: "6d10 bludgeoning",
      "wall-of-fire": "5d8 fire",
      "wall-of-ice": "10d6 cold",
      "wall-of-thorns": "7d8 piercing",
      "wind-wall": "4d8 bludgeoning",
      "heat-metal": "2d8 fire"
    };
    for (const [id, damage] of Object.entries(appearing))
      expect(
        effectOf(id)!
          .damage.map((part) => `${part.formula} ${part.type}`)
          .join(", "),
        id
      ).toBe(damage);
    // The summoned thing's attack on appearing adds the caster's modifier.
    for (const id of ["spiritual-weapon", "arcane-sword", "conjure-fey"]) {
      expect(effectOf(id)!.attacks, id).toBe(1);
      expect(effectOf(id)!.damage[0]!.addsModifier, id).toBe(true);
    }
  });

  it("makes no save on the cast where the SRD's save comes later, and models the later one", () => {
    for (const id of ["spirit-guardians", "haste", "web", "stinking-cloud", "sanctuary", "power-word-stun"])
      expect(effectOf(id)!.noCastSave, id).toBe(true);
    expect(effectOf("spirit-guardians")!.laterActions).toEqual([
      expect.objectContaining({
        activation: "other",
        save: { ability: "wis", successDamage: "half", failureConditions: [] },
        damage: [{ formula: "3d8", type: "radiant" }]
      })
    ]);
    expect(effectOf("fireball")!.noCastSave).toBeUndefined();
  });

  it("marks the areas the server watches: when they act, where, on whom, and once a turn where the text says so", () => {
    const zoneOf = (id: string) => effectOf(id)!.laterActions?.find((row) => row.zone)?.zone;
    expect(zoneOf("moonbeam")).toEqual({ on: ["enter", "end-turn"], oncePerTurn: true });
    expect(zoneOf("spirit-guardians")).toEqual({
      on: ["enter", "end-turn"],
      oncePerTurn: true,
      around: "caster",
      feet: 15,
      affects: "enemies",
      // "Any other creature's Speed is halved in the Emanation."
      halvesSpeed: true
    });
    expect(zoneOf("web")).toEqual({ on: ["enter", "start-turn"], terrain: { cost: 2, kind: "webs" } });
    expect(zoneOf("stinking-cloud")).toEqual({ on: ["start-turn"] });
    expect(zoneOf("spike-growth")).toEqual({ on: ["travel"], terrain: { cost: 2, kind: "plants" } });
    expect(zoneOf("flaming-sphere")).toEqual({ on: ["end-turn"], around: "point", feet: 5 });
    expect(zoneOf("guardian-of-faith")).toMatchObject({ affects: "enemies", damageCap: 60 });
    // Damage with no save (a wall of fire), and a fixed amount (the guardian's 20).
    expect(effectOf("wall-of-fire")!.laterActions?.[0]).toMatchObject({ zone: { on: ["enter", "end-turn"] } });
    expect(effectOf("wall-of-fire")!.laterActions?.[0]!.save).toBeUndefined();
    expect(effectOf("guardian-of-faith")!.laterActions?.[0]!.damage).toEqual([{ formula: "20", type: "radiant" }]);
    // What the caster does itself on later turns has no zone.
    for (const id of ["spiritual-weapon", "produce-flame", "call-lightning", "sunbeam", "vampiric-touch"])
      expect(
        effectOf(id)!.laterActions?.every((row) => row.zone === undefined),
        id
      ).toBe(true);
    expect(effectOf("flaming-sphere")!.laterActions?.map((row) => [row.name, row.activation])).toEqual([
      ["save", "other"],
      ["ram", "bonus-action"]
    ]);
  });

  it("marks the wards: an alarm, a glyph that bursts once, a ward by creature type, and barriers", () => {
    const zoneOf = (id: string) => effectOf(id)!.laterActions?.find((row) => row.zone)?.zone;
    expect(zoneOf("alarm")).toEqual({ on: ["enter"], alerts: true, affects: "enemies" });
    expect(zoneOf("glyph-of-warding")).toEqual({
      on: ["enter", "spell-end"],
      around: "point",
      feet: 5,
      once: true,
      hidden: true
    });
    expect(effectOf("glyph-of-warding")!.damageTypes).toEqual(["thunder", "acid", "cold", "fire", "lightning"]);
    expect(zoneOf("forbiddance")).toMatchObject({
      types: ["aberration", "celestial", "elemental", "fey", "fiend", "undead"],
      noTeleport: true
    });
    expect(effectOf("forbiddance")!.laterActions?.[0]!.save).toBeUndefined();
    expect(zoneOf("antilife-shell")?.bars).toEqual({ way: "both", except: ["construct", "undead"], reach: true });
    expect(zoneOf("magic-circle")?.bars).toEqual({
      way: "in",
      types: ["celestial", "elemental", "fey", "fiend", "undead"]
    });
  });

  it("marks the areas that move: by a later action, up to how far, and drifting from their caster", () => {
    const rowOf = (id: string, name: string) => effectOf(id)!.laterActions?.find((row) => row.name === name);
    expect(rowOf("moonbeam", "move")).toMatchObject({
      activation: "action",
      laterTurnsOnly: true,
      movesArea: { feet: 60 }
    });
    expect(rowOf("flaming-sphere", "ram")?.movesArea).toEqual({ feet: 30 });
    expect(rowOf("cloudkill", "save")?.zone?.drifts).toBe(10);
    expect(rowOf("incendiary-cloud", "save")?.zone?.drifts).toBe(10);
  });

  it("marks what an aura gives the creatures in it, and to whom", () => {
    const zoneOf = (id: string) => effectOf(id)!.laterActions?.find((row) => row.zone)?.zone;
    expect(zoneOf("holy-aura")).toMatchObject({ around: "caster", feet: 30, affects: "allies" });
    expect(zoneOf("holy-aura")?.holds?.struck).toEqual({
      creatureTypes: ["fiend", "undead"],
      save: { ability: "con", conditions: ["blinded"] }
    });
    expect(zoneOf("aura-of-life")).toMatchObject({ on: ["start-turn"], affects: "allies", revives: 1 });
    expect(zoneOf("pass-without-trace")?.holds?.modifiers).toEqual([
      {
        type: "check-bonus",
        amount: 10,
        when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["stealth"] }]
      }
    ]);
    expect(zoneOf("silence")).toEqual({ on: [], holds: { conditions: ["deafened"] } });
  });

  it("marks the ground an area makes difficult, and how long the ground stays", () => {
    const zoneOf = (id: string) => effectOf(id)!.laterActions?.find((row) => row.zone)?.zone;
    expect(zoneOf("entangle")).toEqual({ on: [], terrain: { cost: 2, kind: "plants" } });
    // "Until the end of your next turn."
    expect(zoneOf("ice-storm")).toEqual({ on: [], terrain: { cost: 2, kind: "ice" }, untilCasterNextTurnEnd: true });
    // "4 feet of movement for every 1 foot."
    expect(zoneOf("plant-growth")?.terrain).toEqual({ cost: 4, kind: "plants" });
    expect(zoneOf("wall-of-thorns")?.terrain).toEqual({ cost: 4, kind: "plants" });
    expect(zoneOf("conjure-minor-elementals")).toEqual({
      on: [],
      around: "caster",
      feet: 15,
      terrain: { cost: 2, for: "enemies" }
    });
    expect(zoneOf("earthquake")).toEqual({ on: ["caster-turn-end"], terrain: { cost: 2 } });
    for (const id of ["black-tentacles", "blade-barrier", "grease", "insect-plague", "sleet-storm"])
      expect(zoneOf(id)?.terrain?.cost, id).toBe(2);
    // A failed save also ends the creature's Concentration.
    expect(effectOf("sleet-storm")!.laterActions?.[0]!.save?.breaksConcentration).toBe(true);
    expect(loadSpells().find((spell) => spell.id === "earthquake")!.save?.breaksConcentration).toBe(true);
  });

  it("gives a wall and a thing placed at a point an area the GM can place", () => {
    const areaOf = (id: string) => loadSpells().find((spell) => spell.id === id)!.area;
    expect(areaOf("wall-of-fire")).toEqual({ shape: "line", sizeFeet: 60, widthFeet: 5 });
    expect(areaOf("blade-barrier")).toEqual({ shape: "line", sizeFeet: 100, widthFeet: 5 });
    expect(areaOf("flaming-sphere")).toEqual({ shape: "sphere", sizeFeet: 5, widthFeet: null });
    expect(areaOf("moonbeam")).toEqual({ shape: "cylinder", sizeFeet: 5, widthFeet: null });
  });

  it("says how many creatures a cast targets, and how many more a higher slot adds", () => {
    expect(effectOf("bless")!.targets).toEqual({ count: 3, perSlot: 1 });
    expect(effectOf("mass-cure-wounds")!.targets).toEqual({ count: 6 });
    expect(effectOf("fireball")!.targets).toBeUndefined();
  });

  it("lets the caster pick the damage type where the spell does", () => {
    expect(effectOf("chromatic-orb")!.damageTypes).toEqual(["acid", "cold", "fire", "lightning", "poison", "thunder"]);
    expect(effectOf("sorcerous-burst")!.damage).toEqual([{ formula: "1d8", type: "acid" }]);
  });

  it("says what a hit leaves on its target besides the damage, and what a miss still deals", () => {
    expect(effectOf("ray-of-frost")!.grant).toMatchObject({
      target: "target",
      onHit: true,
      duration: { type: "until-source-next-turn" },
      modifiers: [{ type: "speed", amount: -10 }]
    });
    expect(effectOf("shocking-grasp")!.grant).toMatchObject({
      tags: ["no-opportunity-attacks"],
      duration: { type: "until-bearer-next-turn" }
    });
    expect(effectOf("chill-touch")!.grant).toMatchObject({ tags: ["no-healing"], onHit: true });
    expect(effectOf("starry-wisp")!.grant).toMatchObject({ tags: ["outlined"], onHit: true });
    expect(effectOf("ray-of-sickness")!.onHit).toEqual([
      { conditions: [{ id: "poisoned" }], duration: { type: "until-source-turn-end" } }
    ]);
    expect(effectOf("acid-arrow")).toMatchObject({
      missDamage: "half",
      onHit: [{ ongoingDamage: { damage: [{ formula: "2d4", type: "acid" }], at: "bearer-turn-end" } }]
    });
    // Conjure Fey's spirit frightens what it hits, on the cast and on later turns.
    expect(effectOf("conjure-fey")!.onHit).toEqual([
      { conditions: [{ id: "frightened" }], duration: { type: "until-source-next-turn" } }
    ]);
    expect(effectOf("conjure-fey")!.laterActions![0]!.onHit).toEqual(effectOf("conjure-fey")!.onHit);
  });

  it("reviews only spells that exist", () => {
    const ids = new Set(loadSpells().map((spell) => spell.id));
    expect(SPELL_EFFECT_REVIEWED_IDS.filter((id) => !ids.has(id))).toEqual([]);
  });
});

describe("a homebrew spell's cast model, from what its author set", () => {
  const cureWounds = loadSpells().find((spell) => spell.id === "cure-wounds")!;
  it("reads a typed roll as damage and the text's restoring as healing", () => {
    const bolt = { ...cureWounds, description: "A bolt.", attackRoll: true, damage: { roll: "2d10", types: ["fire"] } };
    expect(spellEffectFromColumns(bolt)).toEqual({
      attacks: 1,
      // A Touch spell's attack is a melee one.
      attackRange: { kind: "melee", feet: 5 },
      damage: [{ formula: "2d10", type: "fire" }],
      healing: null
    });
    const ranged = {
      ...bolt,
      description: "Make a ranged spell attack.",
      range: { distance: 60, unit: "feet", text: "60 feet" }
    };
    expect(spellEffectFromColumns(ranged).attackRange).toEqual({ kind: "ranged", feet: 60 });
    expect(spellEffectFromColumns(cureWounds).damage).toEqual([]);
    expect(healingOfText("It deals 2d8 Fire damage.")).toBeNull();
  });
});

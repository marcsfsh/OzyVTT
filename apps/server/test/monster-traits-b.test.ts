import { describe, expect, it } from "vitest";
import { GameStateSchema, isDead, type GameState } from "@vtt/domain";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { addActorFromDefinition } from "../src/actor-roster.js";
import { rollAbilityCheck } from "../src/check-rolls.js";
import { conversionOffers, convertResource } from "../src/conversions.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { ETHEREAL_TAG } from "../src/ethereal.js";
import { mountOrDismount } from "../src/mounts.js";
import { applyRest } from "../src/rests.js";
import type { ResolveInput } from "../src/resolution/context.js";
import { revivalViolations } from "../src/resolution/revival.js";
import { answerSave } from "../src/saving-throws.js";
import { telepathicControlAtTurnStart } from "../src/telepathic-control.js";
import { BERSERK_TAG } from "../src/trait-turns.js";
import { takeForm } from "../src/transform/assume.js";
import { seenToAct, TRANSPARENT_TAG, transparentEffects } from "../src/transparent.js";
import type { TokenMapGeometry } from "../src/token-placement.js";
import { ContentLibrary } from "../src/content-library.js";
import { catalog } from "./equipment-table.js";
import { heroDefinition } from "./monster-table.js";

// SRD 5.2.1 stat block traits and actions: a mimic's Adhesive, a golem's Immutable Form and Berserk, a gelatinous
// cube's Transparent, a tarrasque's Reflective Carapace, a sahuagin's Shark Telepathy, a sphinx's Inscrutable, a
// nightmare's Confer Fire Resistance, an incubus's Succubus Form, a night hag's Nightmare Haunting and a priest's
// Light.

const IDS = {
  foe: "10000000-0000-4000-8000-000000000b01",
  hero: "10000000-0000-4000-8000-000000000b02",
  ally: "10000000-0000-4000-8000-000000000b03",
  map: "20000000-0000-5000-8000-000000000b01",
  gm: "30000000-0000-4000-8000-000000000b0a"
} as const;
const GM = { role: "gm" } as const;
const NOW = () => "2026-10-26T00:00:00.000Z";
let sequence = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;

const hero = heroDefinition("human", {
  proficiencies: { saves: [], skills: [{ id: "insight", proficiency: "proficient" }], armor: [], weapons: [] }
} as unknown as Partial<ActorDefinition>);
const library = new ContentLibrary();
const monster = (slug: string) => library.monsterForInstance(slug)!;
const resolveDefinition = (id: string): ActorDefinition | undefined => (id === "hero" ? hero : monster(id));
const GRID: TokenMapGeometry = {
  width: 3000,
  height: 3000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
};
const cell = (column: number, row: number) => ({ x: 25 + 50 * column, y: 25 + 50 * row });

type Fight = Readonly<{ state: GameState; slug: string }>;

/** The foe (an SRD stat block), the hero and an ally (a second stat block, or the hero's sheet), in that order, the
 *  foe at cell (2, 2), the hero beside it and the ally `allyFeet` away. Outside a fight with `combat: false`. */
function fight(
  slug: string,
  options: Readonly<{ ally?: string; allyFeet?: number; combat?: boolean; foeHp?: number }> = {}
): Fight {
  const definition = monster(slug);
  const allyDefinition = options.ally ? monster(options.ally) : hero;
  const hp = options.foeHp ?? definition.hitPoints.maximum;
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.foe,
        name: definition.name,
        kind: "monster",
        hp: { current: hp, maximum: definition.hitPoints.maximum },
        armorClass: definition.armorClass,
        speedFeet: definition.speedFeet,
        definitionId: slug
      },
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        hp: { current: 100, maximum: 120 },
        armorClass: 12,
        speedFeet: 30,
        definitionId: "hero"
      },
      {
        id: IDS.ally,
        name: allyDefinition.name === "Hero" ? "Ally" : allyDefinition.name,
        kind: options.ally ? "monster" : "player-character",
        hp: { current: 50, maximum: 50 },
        armorClass: 12,
        speedFeet: 30,
        definitionId: options.ally ?? "hero"
      }
    ],
    ...(options.combat === false ? {} : { combat: combatOf(options.allyFeet ?? 20) })
  });
  return { state, slug };
}

function combatOf(allyFeet: number) {
  return {
    active: true,
    round: 1,
    turnActorId: IDS.foe,
    mapAssetId: IDS.map,
    initiative: [
      { actorId: IDS.foe, score: 20 },
      { actorId: IDS.hero, score: 15 },
      { actorId: IDS.ally, score: 10 }
    ],
    tokens: [
      { actorId: IDS.foe, position: cell(2, 2), sizePx: 40, sizeCells: 1 },
      { actorId: IDS.hero, position: cell(3, 2), sizePx: 40, sizeCells: 1 },
      { actorId: IDS.ally, position: cell(2 + allyFeet / 5, 2), sizePx: 40, sizeCells: 1 }
    ]
  };
}

const actor = (fought: Fight, id: string) => fought.state.actors.find((candidate) => candidate.id === id)!;
const feetBetween = (fought: Fight) => (a: string, b: string) => {
  const at = (id: string) => fought.state.combat.tokens.find((token) => token.actorId === id)?.position;
  const [p, q] = [at(a), at(b)];
  return p && q ? (Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)) / 50) * 5 : null;
};
function deps(fought: Fight, faces: number[], definition: ActorDefinition | undefined): ResolveDependencies {
  return {
    random: () => faces.shift() ?? 3,
    newRollId: nextId,
    gmSessionId: IDS.gm,
    now: NOW,
    definition,
    // A form a creature takes is stored on the table.
    resolveDefinition: (id) =>
      fought.state.definitions.find((entry) => entry.id === id)?.definition ?? resolveDefinition(id),
    catalog,
    distanceFeet: feetBetween(fought)
  };
}
/** `actorId` takes `action` on `targetIds`, on its own turn. */
function act(
  fought: Fight,
  actorId: string,
  action: ActorAction,
  targetIds: string[],
  faces: number[] = [],
  extra: Partial<ResolveInput> = {}
) {
  if (fought.state.combat.active)
    fought.state.combat = {
      ...fought.state.combat,
      turnActorId: actorId,
      turn: { ...fought.state.combat.turn, actionUsed: false, bonusActionUsed: false, actionInstance: null }
    };
  const definition =
    actorId === IDS.foe ? monster(fought.slug) : resolveDefinition(actor(fought, actorId).definitionId!);
  return resolveDefinitionAction(
    fought.state,
    action,
    { actorId, targetIds, commandId: nextId(), ...extra },
    deps(fought, faces, definition)
  );
}
const actionOf = (slug: string, actionId: string) => monster(slug).actions.find((action) => action.id === actionId)!;
const dagger = hero.actions.find((action) => action.id === "dagger")!;
const lines = (resolution: { tableNarration?: ReadonlyArray<{ text: string }> }) =>
  (resolution.tableNarration ?? []).map((line) => line.text);
function refusal(call: () => unknown): string | null {
  try {
    call();
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
function failSave(fought: Fight, targetId: string) {
  const pending = fought.state.combat.pendingSaves.find((save) => save.targetActorId === targetId);
  if (!pending) throw new Error("No save is owed.");
  return answerSave(fought.state, nextId(), pending.id, "manual", 1, true, GM, {
    random: () => 3,
    newRollId: nextId,
    sessionId: IDS.gm,
    role: "gm",
    now: NOW,
    resolveDefinition
  });
}

describe("a mimic's Adhesive (Object Form Only)", () => {
  it("sticks to nothing in the mimic's true form", () => {
    const fought = fight("mimic");
    act(fought, IDS.hero, dagger, [IDS.foe], [15, 2]);
    expect(actor(fought, IDS.hero).effects).toHaveLength(0);
  });

  it("sticks the hero that stabs the mimic in its object form, Grappled with escape DC 13 at Disadvantage", () => {
    const fought = fight("mimic");
    act(fought, IDS.foe, actionOf("mimic", "shape-shift"), [], [], { form: "medium-object" });
    const struck = act(fought, IDS.hero, dagger, [IDS.foe], [15, 2]);
    expect(struck.attack?.outcome).toBe("hit");
    const held = actor(fought, IDS.hero).effects.find((effect) => effect.sourceActorId === IDS.foe);
    expect(held).toMatchObject({ escapeDc: 13, linkedConditionIds: ["grappled"] });
    expect(held!.tags).toEqual(expect.arrayContaining(["grapple", "escape-disadvantage"]));
    expect(lines(struck)).toContain("Hero sticks to Mimic and is Grappled (escape DC 13).");
  });
});

describe("a golem's Immutable Form", () => {
  it("leaves a clay golem in its own stat block when a form is given to it", () => {
    const fought = fight("clay-golem");
    const effect = makeEffect({
      id: "polymorph",
      name: "Polymorph",
      duration: { type: "rounds", remaining: 600 },
      form: { name: "Giant Toad", statBlockId: "giant-toad", gear: "merged", keeps: [] }
    } as Parameters<typeof makeEffect>[0]);
    const events = takeForm(fought.state, IDS.foe, effect, { resolveDefinition, catalog });
    expect(events.map((event) => event.text)).toEqual([
      "Clay Golem can't shape-shift (Immutable Form) and is unaffected."
    ]);
    expect(actor(fought, IDS.foe).definitionId).toBe("clay-golem");
    expect(actor(fought, IDS.foe).effects).toHaveLength(0);
  });
});

describe("a golem's Berserk", () => {
  it("holds its attacks to the nearest creature it can see", () => {
    const fought = fight("flesh-golem", { allyFeet: 15 });
    addEffect(
      fought.state,
      IDS.foe,
      makeEffect({ id: "berserk", name: "Berserk", tags: [BERSERK_TAG], duration: { type: "manual" } })
    );
    // The ally is 15 feet off, the hero beside it.
    const slam = actionOf("flesh-golem", "slam");
    expect(
      refusal(() => act(fought, IDS.foe, { ...slam, attack: { ...slam.attack!, reachFeet: 30 } }, [IDS.ally]))
    ).toMatch(/Flesh Golem is berserk and attacks the nearest creature it can see, and Ally isn't: Hero\./);
    expect(refusal(() => act(fought, IDS.foe, slam, [IDS.hero]))).toBeNull();
  });

  it("picks freely while it isn't berserk", () => {
    const fought = fight("flesh-golem", { allyFeet: 15 });
    const slam = actionOf("flesh-golem", "slam");
    expect(
      refusal(() => act(fought, IDS.foe, { ...slam, attack: { ...slam.attack!, reachFeet: 30 } }, [IDS.ally]))
    ).toBeNull();
  });
});

describe("a gelatinous cube's Transparent", () => {
  it("joins the roster hidden, found at DC 15, and is noticed once it moves or acts", () => {
    const [unseen] = transparentEffects(IDS.foe, "Gelatinous Cube", monster("gelatinous-cube"));
    expect(unseen).toMatchObject({ findDc: 15, linkedConditionIds: ["invisible"] });
    expect(unseen!.tags).toEqual(["hidden", TRANSPARENT_TAG]);
    expect(transparentEffects(IDS.foe, "Mimic", monster("mimic"))).toEqual([]);
    // A cube added from the bestiary starts so.
    const roster = fight("mimic", { combat: false });
    addActorFromDefinition(roster.state, monster("gelatinous-cube"), IDS.ally.replace(/3$/, "4"), "public");
    expect(roster.state.actors.at(-1)!.effects.map((effect) => effect.tags)).toEqual([["hidden", TRANSPARENT_TAG]]);
    // Moving.
    const moved = fight("gelatinous-cube");
    addEffect(moved.state, IDS.foe, structuredClone(unseen!));
    expect(seenToAct(moved.state, IDS.foe).map((event) => event.text)).toContain(
      "Gelatinous Cube moved and is noticed."
    );
    expect(actor(moved, IDS.foe).effects).toHaveLength(0);
    // Acting: its Pseudopod.
    const acted = fight("gelatinous-cube");
    addEffect(acted.state, IDS.foe, structuredClone(unseen!));
    act(acted, IDS.foe, actionOf("gelatinous-cube", "pseudopod"), [IDS.hero], [15, 3, 3, 3]);
    expect(actor(acted, IDS.foe).effects.some((effect) => effect.tags.includes(TRANSPARENT_TAG))).toBe(false);
  });
});

describe("a tarrasque's Reflective Carapace", () => {
  const fireBolt: ActorAction = {
    id: "fire-bolt",
    name: "Fire Bolt",
    activation: "action",
    description: "A mote of fire.",
    spellId: "fire-bolt",
    attack: { bonus: 6, rangeFeet: 120 },
    damage: [{ formula: "1d10", type: "fire" }]
  };
  const magicMissile: ActorAction = {
    id: "magic-missile",
    name: "Magic Missile",
    activation: "action",
    description: "Three darts.",
    spellId: "magic-missile",
    darts: 3,
    damage: [{ formula: "1d4+1", type: "force" }]
  };

  it("leaves it unaffected by a ranged spell attack on a 1 to 5", () => {
    const fought = fight("tarrasque");
    const before = actor(fought, IDS.foe).hp.current;
    const shot = act(fought, IDS.hero, fireBolt, [IDS.foe], [4]);
    expect(lines(shot)).toContain("Tarrasque is unaffected by Fire Bolt (Reflective Carapace: rolled 4).");
    expect(shot.attack).toBeNull();
    expect(actor(fought, IDS.foe).hp.current).toBe(before);
    // The cast is spent all the same.
    expect(fought.state.combat.turn.actionUsed).toBe(true);
  });

  it("turns the spell back on its caster on a 6", () => {
    const fought = fight("tarrasque");
    const shot = act(fought, IDS.hero, fireBolt, [IDS.foe], [6, 15, 7]);
    expect(lines(shot)).toContain(
      "Tarrasque's Reflective Carapace reflects Fire Bolt (rolled 6): Hero becomes the target."
    );
    expect(shot.attack?.targetId).toBe(IDS.hero);
  });

  it("wastes the Magic Missile darts aimed at it, and the others strike", () => {
    const fought = fight("tarrasque");
    const shot = act(fought, IDS.hero, magicMissile, [IDS.foe, IDS.ally], [2, 3, 3, 3]);
    expect(lines(shot)).toContain("Tarrasque is unaffected by Magic Missile (Reflective Carapace: rolled 2).");
    expect(shot.damageTargets?.map((target) => target.targetId)).toEqual([IDS.ally]);
    expect(shot.damageTargets?.[0]?.total).toBe(4);
  });
});

describe("a sahuagin's Shark Telepathy", () => {
  it("puts a shark within 120 feet on its side as its turn starts, and frees it beyond that", () => {
    const fought = fight("sahuagin-warrior", { ally: "hunter-shark", allyFeet: 100 });
    const distanceFeet = feetBetween(fought);
    const events = telepathicControlAtTurnStart(fought.state, IDS.foe, { resolveDefinition, distanceFeet });
    expect(actor(fought, IDS.ally).control).toMatchObject({ by: IDS.foe });
    expect(events.map((event) => event.text)).toContain(
      "Hunter Shark follows Sahuagin Warrior's orders (Shark Telepathy)."
    );
    fought.state.combat.tokens = fought.state.combat.tokens.map((token) =>
      token.actorId === IDS.ally ? { ...token, position: cell(30, 2) } : token
    );
    telepathicControlAtTurnStart(fought.state, IDS.foe, { resolveDefinition, distanceFeet });
    expect(actor(fought, IDS.ally).control).toBeUndefined();
    // Nothing for a creature that isn't a shark.
    const other = fight("sahuagin-warrior", { ally: "mimic", allyFeet: 10 });
    telepathicControlAtTurnStart(other.state, IDS.foe, { resolveDefinition, distanceFeet: feetBetween(other) });
    expect(actor(other, IDS.ally).control).toBeUndefined();
  });
});

describe("a sphinx's Inscrutable", () => {
  const insight = (fought: Fight, aboutActorId?: string) =>
    rollAbilityCheck(
      fought.state,
      GM,
      {
        commandId: nextId(),
        actorId: IDS.hero,
        subject: { ability: "wis", skill: "insight" },
        dc: null,
        visibility: "public",
        ...(aboutActorId ? { aboutActorId } : {})
      },
      { random: () => 10, newId: nextId, sessionId: IDS.gm, now: NOW, resolveDefinition, catalog }
    ).outcome;

  it("gives Insight into the sphinx Disadvantage, and no other check", () => {
    const fought = fight("sphinx-of-lore");
    expect(insight(fought, IDS.foe).rollMode?.disadvantage).toContain("Inscrutable");
    expect(insight(fought).rollMode?.disadvantage ?? []).not.toContain("Inscrutable");
    const mimic = fight("mimic");
    expect(insight(mimic, IDS.foe).rollMode?.disadvantage ?? []).toEqual([]);
  });
});

describe("a nightmare's Confer Fire Resistance", () => {
  it("gives its rider Resistance to Fire while it rides", () => {
    const fought = fight("nightmare");
    const mount = actor(fought, IDS.foe);
    mount.kind = "npc";
    mount.size = "large";
    mount.inventory = [{ id: "saddle-exotic", name: "Saddle, Exotic", quantity: 1, equipped: true, attuned: false }];
    fought.state.combat = { ...fought.state.combat, turnActorId: IDS.hero };
    mountOrDismount(
      fought.state,
      {
        riderId: IDS.hero,
        mountId: IDS.foe,
        override: null,
        distanceFeet: () => 5,
        resolveDefinition,
        catalog,
        newId: () => "riding"
      },
      GRID
    );
    const riding = actor(fought, IDS.hero).effects.find((effect) => effect.sourceActorId === IDS.foe);
    expect(riding?.modifiers).toEqual([{ type: "damage-resistance", damageTypes: ["fire"] }]);
  });
});

describe("an incubus's Succubus Form", () => {
  it("is taken in the step a finished Long Rest opens, outside an encounter, swapping the stat block", () => {
    const fought = fight("incubus", { combat: false });
    const offer = () =>
      conversionOffers(fought.state, actor(fought, IDS.foe), { resolveDefinition, catalog }).find(
        (entry) => entry.id === "form-at-rest"
      );
    expect(offer()?.reason).toBe("This is chosen when a Long Rest finishes, in the step it opens.");
    applyRest(fought.state, IDS.foe, "long", resolveDefinition, catalog);
    expect(offer()?.reason).toBeNull();
    const line = convertResource(
      fought.state,
      IDS.foe,
      { conversionId: "form-at-rest" },
      { resolveDefinition, catalog }
    );
    expect(line).toBe("Incubus shape-shifts into Succubus (Succubus Form).");
    expect(actor(fought, IDS.foe)).toMatchObject({ definitionId: "succubus", name: "Succubus" });
    // And back after the next one.
    actor(fought, IDS.foe).restStep = { after: "long-rest" };
    convertResource(fought.state, IDS.foe, { conversionId: "form-at-rest" }, { resolveDefinition, catalog });
    expect(actor(fought, IDS.foe)).toMatchObject({ definitionId: "incubus", name: "Incubus" });
  });

  it("isn't taken in an encounter", () => {
    const fought = fight("incubus");
    actor(fought, IDS.foe).restStep = { after: "long-rest" };
    expect(
      refusal(() =>
        convertResource(fought.state, IDS.foe, { conversionId: "form-at-rest" }, { resolveDefinition, catalog })
      )
    ).toBe("This is chosen after a Long Rest, outside an encounter.");
  });
});

describe("a night hag's Nightmare Haunting", () => {
  const haunting = () => actionOf("night-hag", "nightmare-haunting");
  const message = () =>
    monster("night-hag").actions.find(
      (action) => action.partOf === "nightmare-haunting" && action.name.includes("terrifying")
    )!;
  const ethereal = (fought: Fight) =>
    addEffect(
      fought.state,
      IDS.foe,
      makeEffect({ id: "etherealness", name: "Etherealness", tags: [ETHEREAL_TAG], duration: { type: "manual" } })
    );
  /** A hag with its soul bag, away from a fight. */
  const haunted = (heroHp = 100, ally?: string) => {
    const fought = fight("night-hag", { combat: false, ...(ally ? { ally } : {}) });
    actor(fought, IDS.foe).effects.push(
      makeEffect({
        id: `${IDS.foe}:carried:soul-bag`,
        name: "Soul Bag",
        tags: ["carried-object", "soul-bag"],
        duration: { type: "manual" },
        heldBy: { name: "Soul Bag", armorClass: 15, hitPoints: { current: 20, maximum: 20 } }
      } as Parameters<typeof makeEffect>[0])
    );
    actor(fought, IDS.hero).hp = { current: heroHp, maximum: 120, temporary: 0 };
    return fought;
  };

  it("is cast only from the Ethereal Plane, at a creature on the Material Plane", () => {
    const fought = haunted();
    expect(refusal(() => act(fought, IDS.foe, haunting(), [IDS.hero]))).toBe(
      "Night Hag uses Nightmare Haunting (1/Day) only while on the Ethereal Plane."
    );
    ethereal(fought);
    // "A creature the hag can see."
    actor(fought, IDS.hero).conditions.push({ id: "invisible" } as never);
    expect(refusal(() => act(fought, IDS.foe, haunting(), [IDS.hero]))).toBe(
      "Nightmare Haunting (1/Day) needs a creature Night Hag can see, and it can't see Hero."
    );
    actor(fought, IDS.hero).conditions = [];
    expect(refusal(() => act(fought, IDS.foe, haunting(), [IDS.hero]))).toBeNull();
  });

  it("fails and is wasted on a creature under Protection from Evil and Good", () => {
    const fought = haunted();
    ethereal(fought);
    addEffect(
      fought.state,
      IDS.hero,
      makeEffect({
        id: "pfeg",
        name: "Protection from Evil and Good",
        tags: ["protection-from-evil-and-good"],
        duration: { type: "manual" },
        spell: { id: "protection-from-evil-and-good", level: 1 }
      })
    );
    const wasted = act(fought, IDS.foe, haunting(), [IDS.hero]);
    expect(lines(wasted)).toContain(
      "Nightmare Haunting (1/Day) fails and is wasted: Hero is warded by Protection from Evil and Good."
    );
    expect(actor(fought, IDS.foe).actionUses["nightmare-haunting"]).toBe(1);
    expect(actor(fought, IDS.foe).effects.some((effect) => effect.name === "Dream messenger's trance")).toBe(false);
  });

  it("fails and is wasted on a creature a Magic Circle wards", () => {
    const fought = haunted();
    ethereal(fought);
    addEffect(
      fought.state,
      IDS.hero,
      makeEffect({
        id: "circle",
        name: "Magic Circle",
        tags: ["zone-aura"],
        duration: { type: "manual" },
        spell: { id: "magic-circle", level: 3 }
      })
    );
    expect(lines(act(fought, IDS.foe, haunting(), [IDS.hero]))).toContain(
      "Nightmare Haunting (1/Day) fails and is wasted: Hero is warded by Magic Circle."
    );
  });

  it("lowers the Hit Point maximum by the Psychic damage as the target wakes, and traps the soul it kills", () => {
    const fought = haunted();
    ethereal(fought);
    act(fought, IDS.foe, haunting(), [IDS.hero]);
    act(fought, IDS.foe, message(), [IDS.hero]);
    failSave(fought, IDS.hero);
    applyRest(fought.state, IDS.hero, "long", resolveDefinition, catalog, { random: () => 3, lines: [] });
    // 3d6 of 3s: 9 Psychic, and the maximum is 9 lower.
    expect(actor(fought, IDS.hero).hp).toMatchObject({ current: 91, maximum: 111 });

    // A priest with 5 Hit Points left dies of it.
    const slain = haunted(100, "priest");
    actor(slain, IDS.ally).hp = { current: 5, maximum: 50, temporary: 0 };
    ethereal(slain);
    act(slain, IDS.foe, haunting(), [IDS.ally]);
    act(slain, IDS.foe, message(), [IDS.ally]);
    failSave(slain, IDS.ally);
    const events = applyRest(slain.state, IDS.ally, "long", resolveDefinition, catalog, { random: () => 6, lines: [] });
    expect(isDead(actor(slain, IDS.ally))).toBe(true);
    expect(actor(slain, IDS.ally).death?.soulTrappedBy).toBe(IDS.foe);
    expect(events.map((event) => event.text)).toContain(
      "Priest's soul is trapped in Night Hag's soul bag (Dream's nightmare)."
    );
    const raiseDead = catalog.spellRecord!("raise-dead")!;
    expect(
      revivalViolations({ state: slain.state, spell: raiseDead, targetIds: [IDS.ally], resolveDefinition }).map(
        (violation) => violation.message
      )
    ).toContain("Priest's soul is trapped in a soul bag, and Priest can't be raised until it is released.");
  });
});

describe("a priest's Light", () => {
  it("lights the object the priest holds, 20 feet of Bright Light and 20 more of Dim", () => {
    const fought = fight("priest");
    act(fought, IDS.foe, actionOf("priest", "spellcasting-light"), [IDS.foe]);
    expect(fought.state.combat.vision.lights).toEqual([
      expect.objectContaining({ actorId: IDS.foe, brightFeet: 20, dimFeet: 20 })
    ]);
  });
});

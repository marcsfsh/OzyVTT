import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { loadEquipment } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { startEncounter } from "../src/encounter.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { resolvePendingDamage, settlePlayerDamage } from "../src/player-damage.js";

// SRD "Knocking Out a Creature": a melee hit that would drop its target to 0 can leave it at 1 Hit Point and
// Unconscious instead. The attacker chooses it with the hit, and every apply path lands it.

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const IDS = {
  hero: "10000000-0000-4000-8000-000000000501",
  foe: "10000000-0000-4000-8000-000000000502",
  map: "20000000-0000-5000-8000-000000000501",
  gmSession: "30000000-0000-4000-8000-00000000050a"
};
const definition = {
  name: "Hero",
  armorClass: 15,
  proficiencyBonus: 2,
  abilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
  hitPoints: { maximum: 30 },
  actions: [],
  extensions: {},
  proficiencies: { saves: [], skills: [], weapons: ["simple", "martial"], armor: [], tools: [] }
} as unknown as ActorDefinition;

const weapon = (id: string): InventoryItem => {
  const stats = loadEquipment().find((record) => record.id === id)!.weapon!;
  return InventoryItemSchema.parse({
    id,
    name: id,
    quantity: 1,
    category: "weapon",
    equipped: true,
    attuned: false,
    weapon: {
      category: stats.category,
      damageDice: stats.damageDice,
      damageType: stats.damageType,
      rangeFeet: stats.rangeFeet,
      longRangeFeet: stats.longRangeFeet,
      ...(stats.properties ? { properties: [...stats.properties] } : {})
    }
  });
};

function table(item: InventoryItem) {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: 30, maximum: 30 },
        armorClass: 15,
        inventory: [item]
      },
      {
        id: IDS.foe,
        name: "Foe",
        kind: "monster",
        visibility: "public",
        hp: { current: 4, maximum: 20 },
        armorClass: 10
      }
    ]
  }) as GameState;
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.hero, score: 20 },
        { actorId: IDS.foe, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  return { state, foe: state.actors.find((actor) => actor.id === IDS.foe)! };
}

let command = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`;
const swing = (
  built: ReturnType<typeof table>,
  actionId: string,
  faces: number[],
  options: Readonly<{ commit?: boolean; knockOut?: boolean; apart?: number }> = {}
) =>
  resolveDefinitionAction(
    built.state,
    effectiveActions(definition, built.state.actors[0], catalog).find((entry) => entry.id === actionId)!,
    {
      actorId: IDS.hero,
      targetIds: [IDS.foe],
      commandId: nextId(),
      ...(options.commit === false ? { commit: false } : {}),
      ...(options.knockOut ? { knockOut: true } : {})
    },
    {
      random: () => faces.shift() ?? 1,
      newRollId: nextId,
      gmSessionId: IDS.gmSession,
      now: () => "2026-10-18T00:00:00.000Z",
      definition,
      catalog,
      distanceFeet: () => options.apart ?? 5
    }
  );
const playerDeps = { resolveDefinition: () => undefined, newId: nextId, now: () => 1_760_000_000_000 };

describe("knocking a creature out with a melee hit", () => {
  it("offers the knock-out on a melee hit's preview, and not on a ranged one", () => {
    expect(swing(table(weapon("longsword")), "item-longsword", [15], { commit: false }).knockOut).toBe("offered");
    expect(swing(table(weapon("dart")), "item-dart", [15], { commit: false, apart: 30 }).knockOut).toBeUndefined();
  });

  it("refuses a knock-out with a ranged attack", () => {
    expect(() => swing(table(weapon("dart")), "item-dart", [15, 6], { knockOut: true, apart: 30 })).toThrowError(
      /isn't a melee attack, so it can't knock a creature out/
    );
  });

  it("leaves the target at 1 Hit Point and Unconscious when the GM applies a player's proposal", () => {
    const built = table(weapon("longsword"));
    const hit = swing(built, "item-longsword", [15, 6], { knockOut: true });
    expect(hit.knockOut).toBe("chosen");
    settlePlayerDamage(built.state, hit, "Hero", IDS.hero, "proposal", playerDeps);
    expect(built.state.combat.pendingDamage).toMatchObject([{ nonlethal: true }]);
    resolvePendingDamage(built.state, built.state.combat.pendingDamage[0]!.id, true, undefined, playerDeps);
    expect(built.foe.hp.current).toBe(1);
    expect(built.foe.conditions.map((condition) => condition.id)).toContain("unconscious");
  });

  it("knocks out in direct mode too, and a hit without the choice drops the target", () => {
    const built = table(weapon("longsword"));
    settlePlayerDamage(
      built.state,
      swing(built, "item-longsword", [15, 6], { knockOut: true }),
      "Hero",
      IDS.hero,
      "direct",
      playerDeps
    );
    expect(built.foe.hp.current).toBe(1);
    const plain = table(weapon("longsword"));
    settlePlayerDamage(plain.state, swing(plain, "item-longsword", [15, 6]), "Hero", IDS.hero, "direct", playerDeps);
    expect(plain.foe.hp.current).toBe(0);
  });
});

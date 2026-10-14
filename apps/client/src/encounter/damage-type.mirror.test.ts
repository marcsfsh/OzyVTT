import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { ApplyDamageSchema } from "../../../server/src/game-commands";
import { applyDamageDetailed, damageAdjustmentDetail, isSrdDamageType } from "../../../server/src/hit-points";
import { manualDamagePayload, manualDamageType } from "./manual-damage";

/**
 * The damage type picked beside a hand-entered number changes the hit points lost. Drives the
 * control's value through the doors' payload builder, the server's `.strict()` schema (so a
 * misspelled key fails) and `applyDamageDetailed`, asserting HP lost and the adjustment line:
 *   1. the type reaches the maths (10 fire on a fire-resistant target is 5);
 *   2. the table is told why;
 *   3. an untouched control sends the same payload as no control;
 *   4. a homebrew word travels intact (the vocabulary is open).
 * A `.mirror.test.ts` because only the node project may import server modules.
 */

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  gm: "30000000-0000-4000-8000-00000000000a",
  command: "50000000-0000-4000-8000-000000000001"
} as const;

/** Only the fields the damage maths reads. */
const sheet = (damageResistances: readonly string[]) =>
  ({
    abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    damageResistances: [...damageResistances],
    extensions: {}
  }) as unknown as ActorDefinition;

function tableWith(resistances: readonly string[]) {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.hero,
        name: "Aria",
        kind: "player-character",
        visibility: "public",
        hp: { current: 40, maximum: 40 },
        definitionId: "aria-def"
      }
    ]
  });
  const hp = () => state.actors[0].hp.current;
  return { state, hp, definition: sheet(resistances) };
}

/**
 * One GM gesture end to end: chooser value and number, through the doors' shared builder and the
 * command schema, into the engine. `chosen` is what `DamageTypeField` returns: `null` untouched,
 * an SRD slug when picked, raw words when typed.
 */
function applyFromTheDoor(table: ReturnType<typeof tableWith>, amount: number, chosen: string | null) {
  const payload = manualDamagePayload({
    commandId: IDS.command,
    actorId: IDS.hero,
    amount,
    damageType: manualDamageType(chosen)
  });
  const request = ApplyDamageSchema.parse(payload);
  const before = table.hp();
  const outcome = applyDamageDetailed(
    table.state,
    request.actorId,
    request,
    { role: "gm" },
    { resolveDefinition: (id) => (id === "aria-def" ? table.definition : undefined) }
  );
  return { payload, hpLost: before - table.hp(), detail: damageAdjustmentDetail(outcome.application), outcome };
}

describe("the manual damage entry's type chooser", () => {
  it("takes 5 off a fire-resistant target when the GM picks Fire and types 10", () => {
    const table = tableWith(["fire"]);
    const result = applyFromTheDoor(table, 10, "fire");
    // Hit points first, so a wrong value fails here rather than at a payload guard.
    expect(result.hpLost).toBe(5);
    expect(result.outcome.application.totalApplied).toBe(5);
    expect(result.payload.damageType, "the door sent no type").toBe("fire");
  });

  it("says WHY the ten became five, on the line the table reads", () => {
    const table = tableWith(["fire"]);
    // The feed row is `${attribution} ${totalApplied} damage${detail}.`, i.e. "Aria took 5 damage
    // (10 fire → 5, resistance)."
    expect(applyFromTheDoor(table, 10, "fire").detail).toBe(" (10 fire → 5, resistance)");
  });

  it("is byte-identical to the old fast path while the chooser is untouched", () => {
    for (const chosen of [null, "", "   ", "untyped", "  Untyped "]) {
      const table = tableWith(["fire"]);
      const result = applyFromTheDoor(table, 10, chosen);
      expect("damageType" in result.payload, `an untouched chooser sent a type for ${JSON.stringify(chosen)}`).toBe(
        false
      );
      expect(result.hpLost, `the exact manual number did not land for ${JSON.stringify(chosen)}`).toBe(10);
      expect(result.detail, `an unadjusted hit was explained for ${JSON.stringify(chosen)}`).toBe("");
    }
  });

  it('slugs what the GM typed by hand, so "  Fire " is the fire the engine matches', () => {
    const table = tableWith(["fire"]);
    const result = applyFromTheDoor(table, 10, "  Fire ");
    expect(result.payload.damageType).toBe("fire");
    expect(result.hpLost).toBe(5);
  });

  it("carries a homebrew type through to a homebrew defence - the list is a suggestion, not a gate", () => {
    expect(isSrdDamageType("ooze"), "the premise: this word is not one of the SRD thirteen").toBe(false);
    // Typed as two words, as a GM writes it; the defence stores the slug.
    const resistant = applyFromTheDoor(tableWith(["primordial-ooze"]), 10, "Primordial Ooze");
    expect(resistant.payload.damageType).toBe("primordial-ooze");
    expect(resistant.hpLost).toBe(5);
    // The same word against a target without that defence lands whole rather than being dropped.
    expect(applyFromTheDoor(tableWith(["fire"]), 10, "Primordial Ooze").hpLost).toBe(10);
  });

  it("doubles a vulnerable target's hit, which is the same pipeline running the other way", () => {
    const table = tableWith([]);
    table.definition = { ...(sheet([]) as object), damageVulnerabilities: ["cold"] } as unknown as ActorDefinition;
    const result = applyFromTheDoor(table, 10, "cold");
    expect(result.hpLost).toBe(20);
    expect(result.detail).toBe(" (10 cold → 20, vulnerability)");
  });
});

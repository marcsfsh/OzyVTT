import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { ApplyDamageSchema } from "../../../server/src/game-commands";
import { applyDamageDetailed, damageAdjustmentDetail, isSrdDamageType } from "../../../server/src/hit-points";
import { manualDamagePayload, manualDamageType } from "./manual-damage";

/**
 * REGISTER D7's CLIENT HALF, PROVED AT THE FAR END: the type a GM picks beside a hand-entered number
 * comes off a different number of hit points.
 *
 * The server half shipped with `4a` and is tested in `apps/server/test/typed-damage.test.ts` against
 * payloads the tests write themselves. What nothing tested was the other side of the wire, because
 * there was nothing there: all three hand-entry doors sent a bare `{commandId, actorId, amount}`, so
 * `damageType` was reachable only by an HTTP caller and a GM watched a fire-resistant target lose all
 * ten of a fire bolt.
 *
 * This file drives the control's OWN value through the doors' OWN payload builder, through the
 * server's OWN `.strict()` schema (a misspelled key fails here, loudly - which is the whole reason the
 * payload is not retyped beside the test), into the server's OWN `applyDamageDetailed`, and asserts
 * spent hit points and the rendered adjustment line. A `.mirror.test.ts` because only the node project
 * may import the server's modules.
 *
 * The outcomes, in the order they would break:
 *   1. the picked type reaches the maths at all - 10 fire on a fire-resistant target is 5;
 *   2. the table is TOLD why, which is the difference between this and a silent reduction;
 *   3. an untouched control is byte-identical to the path that shipped before it;
 *   4. a homebrew word travels intact, because the vocabulary is open and the client must not gate it.
 */

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  gm: "30000000-0000-4000-8000-00000000000a",
  command: "50000000-0000-4000-8000-000000000001"
} as const;

/** Only the fields the damage maths reads. */
const sheet = (damageResistances: readonly string[]) => ({
  abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
  damageResistances: [...damageResistances],
  extensions: {}
}) as unknown as ActorDefinition;

function tableWith(resistances: readonly string[]) {
  const state = GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.hero, name: "Aria", kind: "player-character", visibility: "public", hp: { current: 40, maximum: 40 }, definitionId: "aria-def" }
  ] });
  const hp = () => state.actors[0].hp.current;
  return { state, hp, definition: sheet(resistances) };
}

/**
 * One GM gesture, end to end: what the chooser holds and what the number field holds, through the
 * module all three doors emit from, through the command schema, into the engine.
 *
 * `chosen` is exactly what `DamageTypeField` hands back - `null` when untouched, an SRD slug when
 * picked from the list, raw words when typed by hand.
 */
function applyFromTheDoor(table: ReturnType<typeof tableWith>, amount: number, chosen: string | null) {
  const payload = manualDamagePayload({ commandId: IDS.command, actorId: IDS.hero, amount, damageType: manualDamageType(chosen) });
  const request = ApplyDamageSchema.parse(payload);
  const before = table.hp();
  const outcome = applyDamageDetailed(table.state, request.actorId, request, { role: "gm" },
    { resolveDefinition: (id) => (id === "aria-def" ? table.definition : undefined) });
  return { payload, hpLost: before - table.hp(), detail: damageAdjustmentDetail(outcome.application), outcome };
}

describe("the manual damage entry's type chooser", () => {
  it("takes 5 off a fire-resistant target when the GM picks Fire and types 10", () => {
    const table = tableWith(["fire"]);
    const result = applyFromTheDoor(table, 10, "fire");
    // The far end FIRST, so that changing the chooser's value fails on hit points rather than on a
    // payload guard that would have told us less.
    expect(result.hpLost).toBe(5);
    expect(result.outcome.application.totalApplied).toBe(5);
    expect(result.payload.damageType, "the door sent no type").toBe("fire");
  });

  it("says WHY the ten became five, on the line the table reads", () => {
    const table = tableWith(["fire"]);
    // The feed row `actorApplyDamage` broadcasts is `${attribution} ${totalApplied} damage${detail}.`
    // - so this is literally "Aria took 5 damage (10 fire → 5, resistance)." at the table.
    expect(applyFromTheDoor(table, 10, "fire").detail).toBe(" (10 fire → 5, resistance)");
  });

  it("is byte-identical to the old fast path while the chooser is untouched", () => {
    for (const chosen of [null, "", "   ", "untyped", "  Untyped "]) {
      const table = tableWith(["fire"]);
      const result = applyFromTheDoor(table, 10, chosen);
      expect("damageType" in result.payload, `an untouched chooser sent a type for ${JSON.stringify(chosen)}`).toBe(false);
      expect(result.hpLost, `the exact manual number did not land for ${JSON.stringify(chosen)}`).toBe(10);
      expect(result.detail, `an unadjusted hit was explained for ${JSON.stringify(chosen)}`).toBe("");
    }
  });

  it("slugs what the GM typed by hand, so \"  Fire \" is the fire the engine matches", () => {
    const table = tableWith(["fire"]);
    const result = applyFromTheDoor(table, 10, "  Fire ");
    expect(result.payload.damageType).toBe("fire");
    expect(result.hpLost).toBe(5);
  });

  it("carries a homebrew type through to a homebrew defence - the list is a suggestion, not a gate", () => {
    expect(isSrdDamageType("ooze"), "the premise: this word is not one of the SRD thirteen").toBe(false);
    // Typed as two words, because that is how a GM writes it and the slug is what the defence stores.
    const resistant = applyFromTheDoor(tableWith(["primordial-ooze"]), 10, "Primordial Ooze");
    expect(resistant.payload.damageType).toBe("primordial-ooze");
    expect(resistant.hpLost).toBe(5);
    // And the same word against a target with no such defence still lands whole, rather than being
    // quietly dropped for not being on the list.
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

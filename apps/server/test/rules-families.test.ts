import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState, type RuleFamily } from "@vtt/domain";
import { effectiveModeFor, familyModeFor, familyOf, overrideCovers, overrideReason, rememberOverride } from "../src/rules-families.js";

/**
 * The family map is the thing that makes "don't police movement" expressible without also switching
 * off the action economy. Two properties matter and both are tested here:
 *
 *  1. TOTALITY — every rule id the engine can actually throw maps to a real family. `familyOf`
 *     returns null for an unclassified id and `effectiveModeFor` then falls back to the dial, which
 *     fails SAFE (an unknown rule is never silently swept into a family a GM switched off) but is
 *     still a gap. This test reads the rule ids out of the source, so adding one without classifying
 *     it turns the suite red instead of quietly landing in the fallback.
 *  2. PRECEDENCE — a family exception beats the dial, and an absent family follows it.
 */

const SOURCE_DIR = new URL("../src/", import.meta.url).pathname;

/** Every `rule: "..."` violation id and every `RulesBlockedError("...")` id the server can raise. */
function thrownRuleIds(): readonly string[] {
  const ids = new Set<string>();
  for (const file of readdirSync(SOURCE_DIR).filter((name) => name.endsWith(".ts"))) {
    const text = readFileSync(join(SOURCE_DIR, file), "utf8");
    for (const match of text.matchAll(/rule: "([a-z]+\.[a-z-]+)"/g)) ids.add(match[1]);
    for (const match of text.matchAll(/RulesBlockedError\("([a-z]+\.[a-z-]+)"/g)) ids.add(match[1]);
  }
  return [...ids].sort();
}

function stateWith(combat: Partial<GameState["combat"]>): GameState {
  return GameStateSchema.parse({ schemaVersion: 1, combat });
}

describe("rule families", () => {
  it("classifies every rule id the server can throw (no id falls through to the dial by accident)", () => {
    const ids = thrownRuleIds();
    // A guard on the guard: if the extraction stops finding rule ids, the totality claim is vacuous.
    expect(ids.length).toBeGreaterThanOrEqual(15);
    const unclassified = ids.filter((rule) => familyOf(rule) === null);
    expect(unclassified, `these rule ids belong to no family - add them to apps/server/src/rules-families.ts`).toEqual([]);
  });

  it("puts each rule id in the family a GM would expect to switch off", () => {
    const expected: ReadonlyArray<readonly [string, RuleFamily]> = [
      ["movement.exceeds-speed", "movement"],
      ["movement.no-movement-remaining", "movement"],
      ["movement.stand-up-cost", "movement"],
      ["economy.action-used", "economy"],
      ["economy.bonus-action-used", "economy"],
      ["economy.reaction-used", "economy"],
      // Being incapacitated or down is "you have no actions" - economy, not a targeting rule.
      ["condition.incapacitated", "economy"],
      ["condition.down", "economy"],
      ["legendary.own-turn", "economy"],
      ["feature.no-uses-remaining", "resources"],
      ["feature.requires-effect", "resources"],
      ["legendary.no-actions-remaining", "resources"],
      ["range.out-of-range", "targeting"],
      ["range.out-of-reach", "targeting"],
      ["range.underwater", "targeting"],
      ["target.grappled-by-source", "targeting"],
      ["target.too-large-to-grapple", "targeting"],
      ["cover.total", "targeting"],
      ["condition.charmed-charmer", "targeting"],
      // Not thrown yet - the slot checks are a later slice - but the family is the wire vocabulary now.
      ["slots.none-remaining", "slots"]
    ];
    for (const [rule, family] of expected) expect(familyOf(rule), rule).toBe(family);
  });

  it("returns null for an unknown rule id rather than guessing a family", () => {
    expect(familyOf("teapot.short-and-stout")).toBeNull();
  });
});

describe("effective mode", () => {
  it("follows the dial when the family has no exception", () => {
    const state = stateWith({ rulesMode: "assisted", ruleExceptions: {} });
    expect(effectiveModeFor(state.combat, "economy.action-used")).toBe("assisted");
    expect(familyModeFor(state.combat, "movement")).toBe("assisted");
  });

  it("lets a family exception beat the dial in both directions", () => {
    const state = stateWith({ rulesMode: "strict", ruleExceptions: { movement: "freeform", slots: "strict" } });
    expect(effectiveModeFor(state.combat, "movement.exceeds-speed")).toBe("freeform");
    expect(effectiveModeFor(state.combat, "slots.none-remaining")).toBe("strict");
    // Untouched families keep the dial - relaxing movement must not relax the action economy.
    expect(effectiveModeFor(state.combat, "economy.action-used")).toBe("strict");
    expect(effectiveModeFor(state.combat, "cover.total")).toBe("strict");
  });

  it("defaults spell slots to advisory so new enforcement cannot silently start blocking old saves", () => {
    const fresh = GameStateSchema.parse({ schemaVersion: 1 });
    expect(fresh.combat.ruleExceptions).toEqual({ slots: "assisted" });
    expect(fresh.rulesPolicy).toEqual({ dial: "strict", exceptions: { slots: "assisted" } });
    expect(effectiveModeFor(fresh.combat, "slots.none-remaining")).toBe("assisted");
  });

  it("falls back to the dial for an unclassified rule id (fails safe, never into a switched-off family)", () => {
    const state = stateWith({ rulesMode: "strict", ruleExceptions: { movement: "freeform", economy: "freeform", resources: "freeform", targeting: "freeform", slots: "freeform" } });
    expect(effectiveModeFor(state.combat, "teapot.short-and-stout")).toBe("strict");
  });
});

describe("per-turn override memory", () => {
  it("remembers the whole family, so the same kind of block stops re-prompting this turn", () => {
    const state = stateWith({ rulesMode: "strict" });
    expect(overrideCovers(state.combat.turn, "economy.action-used")).toBe(false);
    rememberOverride(state, "economy.action-used");
    expect(overrideCovers(state.combat.turn, "economy.action-used")).toBe(true);
    expect(overrideCovers(state.combat.turn, "economy.bonus-action-used")).toBe(true);
    // ...and only that family. Allowing one economy break must not wave through a range violation.
    expect(overrideCovers(state.combat.turn, "range.out-of-range")).toBe(false);
  });

  it("remembers movement overrides, which the old boolean never covered", () => {
    const state = stateWith({ rulesMode: "strict" });
    rememberOverride(state, "movement.exceeds-speed");
    expect(overrideCovers(state.combat.turn, "movement.exceeds-speed")).toBe(true);
    expect(overrideCovers(state.combat.turn, "movement.stand-up-cost")).toBe(true);
    expect(state.combat.turn.rulesOverriddenFamilies).toEqual(["movement"]);
  });

  it("writes the legacy boolean too, and reads it when an older save carries only that", () => {
    const state = stateWith({ rulesMode: "strict" });
    rememberOverride(state, "range.out-of-range");
    expect(state.combat.turn.rulesOverridden).toBe(true);
    // A turn persisted mid-fight by a build that knew only the boolean keeps its old two-prefix meaning.
    const legacy = stateWith({ rulesMode: "strict", turn: { actionUsed: false, bonusActionUsed: false, actionInstance: null, turnUses: {}, movementUsedFeet: 0, rulesOverridden: true } });
    expect(legacy.combat.turn.rulesOverriddenFamilies).toBeUndefined();
    expect(overrideCovers(legacy.combat.turn, "economy.action-used")).toBe(true);
    expect(overrideCovers(legacy.combat.turn, "range.out-of-range")).toBe(true);
    expect(overrideCovers(legacy.combat.turn, "movement.exceeds-speed")).toBe(false);
  });

  it("does not accumulate duplicates or remember an unclassified rule", () => {
    const state = stateWith({ rulesMode: "strict" });
    rememberOverride(state, "economy.action-used");
    rememberOverride(state, "economy.reaction-used");
    rememberOverride(state, "teapot.short-and-stout");
    expect(state.combat.turn.rulesOverriddenFamilies).toEqual(["economy"]);
  });
});

describe("override reason", () => {
  it("is optional - one tap, never a mandatory modal (D9) - and audits as a plain GM override", () => {
    expect(overrideReason(undefined)).toBe("GM override");
    expect(overrideReason(null)).toBe("GM override");
    expect(overrideReason({})).toBe("GM override");
    expect(overrideReason({ reason: "   " })).toBe("GM override");
    expect(overrideReason({ reason: "House rule" })).toBe("House rule");
  });
});

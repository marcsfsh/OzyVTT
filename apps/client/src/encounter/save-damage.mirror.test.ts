import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { SaveAnswerSchema } from "../../../server/src/game-commands";
import { answerSave, createPendingSaves, type SaveAnswerDependencies } from "../../../server/src/saving-throws";
import { startEncounter } from "../../../server/src/encounter";
import { saveAnswerPayload, saveDamageAmend } from "./save-answer";

/**
 * ISSUE `4b`'s CLIENT HALF, PROVED AT THE FAR END: the number the answerer types into the save
 * prompt comes off somebody's hit points.
 *
 * The server half shipped in `a4abd8f` and is tested over HTTP in
 * `apps/server/test/typed-damage-feed.test.ts`. What NOTHING tested was the other side of the wire:
 * `SavePrompt` never sent a damage field of any kind, so the whole mechanism was reachable only by
 * an HTTP caller. This file runs the prompt's OWN payload builder (`save-answer.ts`, the module the
 * component emits from) through the server's OWN `.strict()` schema and its OWN `answerSave`, and
 * asserts hit points. A `.mirror.test.ts` for exactly that reason - the node project may import the
 * server's modules, which reach `node:sqlite` through `game-store.js`.
 *
 * The three engine outcomes, in the order they would break:
 *   1. the amended number is what lands at all;
 *   2. it lands as FIRE, so a fire-resistant target still halves it (the regression that would
 *      return the moment someone "simplifies" this to sending a bare total);
 *   3. it is halved ONCE. `damageOverride` is the PRE-halving proposal and the preview reports the
 *      POST-halving number, so a client that echoed the previewed number back as the override would
 *      quarter the damage on every successful half-on-success save. That is the whole reason the
 *      field is bound to `proposedDamage` and not to what the preview showed.
 */

const IDS = {
  dragon: "10000000-0000-4000-8000-000000000001",
  borin: "10000000-0000-4000-8000-000000000002",
  borinSession: "30000000-0000-4000-8000-000000000001",
  strangerSession: "30000000-0000-4000-8000-000000000002",
  gm: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001",
  save: "60000000-0000-4000-8000-000000000001",
  roll: "40000000-0000-4000-8000-000000000000"
} as const;
const command = "50000000-0000-4000-8000-000000000001";
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

/** Borin's sheet, with fire resistance when the case needs it. Only the fields the damage math reads. */
const sheet = (damageResistances: readonly string[]) => ({
  abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
  damageResistances: [...damageResistances],
  extensions: {}
}) as unknown as ActorDefinition;

/**
 * A live fight with a 17-damage breath owed by Borin, exactly as `action.resolve` would have parked
 * it. `parts` defaults to one fire component; hand it two and the halving stops agreeing with
 * `floor(total / 2)`, which is what makes the two-type case worth having.
 */
function tableWith(options: Readonly<{ resistant: boolean; halfOnSuccess: boolean; parts?: ReadonlyArray<{ amount: number; type: string }> }>) {
  const state = GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.dragon, name: "Dragon", kind: "monster", visibility: "public", hp: { current: 100, maximum: 100 } },
    { id: IDS.borin, name: "Borin", kind: "player-character", visibility: "public", hp: { current: 40, maximum: 40 }, ownerSessionId: IDS.borinSession, definitionId: "borin-def" }
  ] });
  startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.dragon, score: 20 }, { actorId: IDS.borin, score: 12 }] }, () => 1, GEOMETRY);
  createPendingSaves(state, {
    sourceActorId: IDS.dragon, sourceName: "Dragon", actionName: "Fire Breath", ability: "dex", dc: 15,
    targetIds: [IDS.borin], proposedDamage: 17, proposedDamageParts: [...(options.parts ?? [{ amount: 17, type: "fire" }])],
    halfOnSuccess: options.halfOnSuccess, conditionId: null, newSaveId: () => IDS.save, createdAt: 0
  });
  const definition = sheet(options.resistant ? ["fire"] : []);
  const deps = (role: "gm" | "player", sessionId: string): SaveAnswerDependencies => ({
    random: () => 1, newRollId: () => IDS.roll, sessionId, role, now: () => "2026-08-10T00:00:00.000Z",
    resolveDefinition: (id) => (id === "borin-def" ? definition : undefined)
  });
  const hp = () => state.actors.find((actor) => actor.id === IDS.borin)!.hp.current;
  return { state, deps, hp };
}

/**
 * The prompt's own gesture, end to end: what the answerer typed into the damage field, through the
 * builder `SavePrompt` emits from, through the server's `.strict()` schema (a mistyped key fails
 * here, loudly), into the engine.
 *
 * `method: "manual"` with the rolled total is what Confirm sends - the auto-rolled preview is a
 * separate, uncommitted round trip whose only job is to reveal the die.
 */
function answerFromThePrompt(
  table: ReturnType<typeof tableWith>,
  typedDamage: string | null,
  rolledTotal: number,
  who: Readonly<{ role: "gm" | "player"; sessionId: string }> = { role: "gm", sessionId: IDS.gm },
  commit = true
) {
  const payload = saveAnswerPayload({
    commandId: command, saveId: IDS.save, method: "manual", commit, total: rolledTotal,
    ...(saveDamageAmend(17, typedDamage) !== undefined ? { damageOverride: saveDamageAmend(17, typedDamage) } : {})
  });
  const request = SaveAnswerSchema.parse(payload);
  const scope = who.role === "gm" ? { role: "gm" as const } : { role: "player" as const, sessionId: who.sessionId };
  return {
    payload,
    ...answerSave(table.state, request.commandId, request.saveId, request.method, request.total, request.commit, scope,
      table.deps(who.role, who.sessionId), request.legendaryResistance, request.rollMode, request.damageOverride)
  };
}

describe("the save prompt's damage field", () => {
  it("takes 3 off the target when the answerer types 3 over a proposal of 17", () => {
    const table = tableWith({ resistant: false, halfOnSuccess: false });
    const before = table.hp();
    // 5 vs DC 15 is a clean failure: the full amended proposal applies.
    const { outcome, payload } = answerFromThePrompt(table, "3", 5);
    expect(payload.damageOverride, "the prompt sent no amend").toBe(3);
    expect(before - table.hp()).toBe(3);
    expect(outcome.appliedDamage).toBe(3);
    expect(table.state.combat.pendingSaves).toHaveLength(0);
  });

  it("amends the number without untyping it - 12 typed against fire resistance lands as 6", () => {
    const table = tableWith({ resistant: true, halfOnSuccess: false });
    const before = table.hp();
    const { outcome } = answerFromThePrompt(table, "12", 5);
    expect(before - table.hp()).toBe(6);
    expect(outcome.parts).toEqual([{ amount: 12, type: "fire", adjusted: 6, adjustment: "resistance", adjustmentSource: null }]);
  });

  it("halves the amend ONCE on a successful half-on-success save - 12 typed lands as 6, not 3", () => {
    const table = tableWith({ resistant: false, halfOnSuccess: true });
    const before = table.hp();
    // 18 vs DC 15 succeeds, so "half on a success" applies to the amended proposal.
    const { outcome } = answerFromThePrompt(table, "12", 18);
    expect(outcome.success).toBe(true);
    expect(before - table.hp()).toBe(6);
  });

  /**
   * THE NUMBER `SavePrompt` PRINTS AFTER AN AMEND, sourced.
   *
   * The prompt's summary line used to print the PRE-halving proposal in the same "N dmg" grammar
   * that had meant applied damage a keystroke earlier - 12 shown, 6 landing. It now re-asks the
   * server with Confirm's own payload and `commit: false`, and prints whatever comes back. These
   * two cases are what comes back, from the server's own code: the 6 and the 0 that
   * `save-damage.test.tsx` acknowledges are these, not numbers a test author chose.
   */
  it("answers an uncommitted recheck with the number the commit will apply, and applies nothing", () => {
    const table = tableWith({ resistant: false, halfOnSuccess: true });
    const { outcome } = answerFromThePrompt(table, "12", 18, { role: "gm", sessionId: IDS.gm }, false);
    expect(outcome.committed).toBe(false);
    expect(outcome.appliedDamage).toBe(6);
    // A recheck is a question, not an answer: no hit points moved and the save is still owed.
    expect(table.hp()).toBe(40);
    expect(table.state.combat.pendingSaves).toHaveLength(1);
    // And the commit that follows lands exactly the number the recheck projected.
    expect(40 - answerFromThePrompt(table, "12", 18).outcome.appliedDamage).toBe(34);
    expect(table.hp()).toBe(34);
  });

  it("answers a TWO-TYPE save with 5 for an amended 12, which no halving of the total can produce", () => {
    // 9 fire + 8 cold. `rescaleDamageParts` re-weights 12 across them as 7 + 5, and the success
    // halving floors EACH part: 3 + 2 = 5. `floor(12 / 2)` is 6. That gap is the point of this case -
    // it is the fixture `save-damage.test.tsx` renders, so the string it asserts cannot be reached
    // by any arithmetic the client could have done on the number in its own field.
    const table = tableWith({ resistant: false, halfOnSuccess: true, parts: [{ amount: 9, type: "fire" }, { amount: 8, type: "cold" }] });
    const { outcome } = answerFromThePrompt(table, "12", 18, { role: "gm", sessionId: IDS.gm }, false);
    expect(outcome.appliedDamage).toBe(5);
    expect(Math.floor(12 / 2), "the fixture stopped distinguishing the server's halving").not.toBe(5);
    // And the commit lands the same 5, per type.
    const committed = answerFromThePrompt(table, "12", 18);
    expect(committed.outcome.parts).toEqual([
      { amount: 3, type: "fire", adjusted: 3, adjustment: null, adjustmentSource: null },
      { amount: 2, type: "cold", adjusted: 2, adjustment: null, adjustmentSource: null }
    ]);
    expect(40 - table.hp()).toBe(5);
  });

  it("answers the recheck with ZERO on a success that does not halve - the case the old line got most wrong", () => {
    const table = tableWith({ resistant: false, halfOnSuccess: false });
    const { outcome } = answerFromThePrompt(table, "12", 18, { role: "gm", sessionId: IDS.gm }, false);
    expect(outcome.success).toBe(true);
    expect(outcome.appliedDamage).toBe(0);
    expect(table.hp()).toBe(40);
  });

  it("sends nothing at all when the field is untouched, cleared, or retyped to the same number", () => {
    for (const typed of [null, "", "   ", "17"]) {
      const table = tableWith({ resistant: false, halfOnSuccess: false });
      const before = table.hp();
      const { payload } = answerFromThePrompt(table, typed, 5);
      expect("damageOverride" in payload, `an untouched field sent an amend for ${JSON.stringify(typed)}`).toBe(false);
      expect(before - table.hp(), `the rolled proposal did not land for ${JSON.stringify(typed)}`).toBe(17);
    }
  });

  it("takes a typed 0 as an amend to none, which is not the same as leaving the field empty", () => {
    const table = tableWith({ resistant: false, halfOnSuccess: false });
    const before = table.hp();
    const { payload } = answerFromThePrompt(table, "0", 5);
    expect(payload.damageOverride).toBe(0);
    expect(before - table.hp()).toBe(0);
  });

  it("lets the owner amend their own save and refuses the stranger who tries", () => {
    const mine = tableWith({ resistant: false, halfOnSuccess: false });
    const before = mine.hp();
    answerFromThePrompt(mine, "3", 5, { role: "player", sessionId: IDS.borinSession });
    expect(before - mine.hp()).toBe(3);

    const theirs = tableWith({ resistant: false, halfOnSuccess: false });
    expect(() => answerFromThePrompt(theirs, "3", 5, { role: "player", sessionId: IDS.strangerSession }))
      // THIS is the ownership boundary, and it is the only one: `adjustableActor` turns a player
      // away from somebody else's target before the amend is looked at. `answerSave` used to carry
      // a second guard saying "You can only amend your own character's save damage." that could
      // never fire, which made the sheet's boundary look like it was in two places; it was deleted
      // 2026-08-10 and this message is what a player really gets.
      .toThrow(/only track your own character/);
    expect(theirs.hp(), "a refused amend still moved hit points").toBe(40);
  });

  it("is refused IN WORDS by the server's own bound rather than silently applying the rolled number", () => {
    // The client does NOT range-check: a fat-fingered 9999 must come back as a refusal the prompt
    // can show, never as a quiet fallback to the 17 nobody asked for. The refusal lands one step
    // earlier than `answerSave` - `SaveAnswerSchema`'s 0..1000 bound turns it away before the
    // command runs, which is the same door the HTTP and socket paths post through.
    const table = tableWith({ resistant: false, halfOnSuccess: false });
    expect(saveDamageAmend(17, "9999")).toBe(9999);

    // THE MESSAGE, not the path. This assertion used to read `.toThrow(/damageOverride/)`, which
    // matches the ZodError's serialized JSON - the issue's `path` - and so passed just as happily
    // while the sentence a GM read was zod's "Number must be less than or equal to 1000". Every
    // arm of the bound answers with the same sentence, because `save.answer` surfaces
    // `issues[0].message` verbatim (`game-operations.ts`, `preferIssueMessage`).
    for (const typed of ["9999", "1001"]) {
      const refusal = SaveAnswerSchema.safeParse(saveAnswerPayload({
        commandId: command, saveId: IDS.save, method: "manual", commit: true, total: 5,
        damageOverride: saveDamageAmend(17, typed)
      }));
      expect(refusal.success, `${typed} was accepted`).toBe(false);
      expect(refusal.error!.issues[0].message).toBe("Enter the damage as a whole number from 0 to 1000.");
    }
    // 1000 is inside the bound, so the sentence is a refusal and not a wall.
    expect(SaveAnswerSchema.safeParse(saveAnswerPayload({ commandId: command, saveId: IDS.save, method: "manual", commit: true, total: 5, damageOverride: 1000 })).success).toBe(true);

    expect(() => answerFromThePrompt(table, "9999", 5)).toThrow();
    expect(table.hp()).toBe(40);
  });
});
